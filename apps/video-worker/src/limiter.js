// Demandes traitées à la fois (2 par défaut) et petite file d'attente. Au-delà,
// ou après une attente trop longue, « busy » : le serveur principal revient
// alors à la capture d'écran.
import { WorkerError } from "./contract.js";

export class Limiter {
  /**
   * @param {{ maxActive: number, maxQueued: number, maxWaitMs: number }} limits
   */
  constructor({ maxActive, maxQueued, maxWaitMs }) {
    this.maxActive = maxActive;
    this.maxQueued = maxQueued;
    this.maxWaitMs = maxWaitMs;
    this.active = 0;
    /** @type {{ grant: () => void }[]} */
    this.queue = [];
  }

  get queued() {
    return this.queue.length;
  }

  /**
   * Une place ; la fonction rendue la libère (une seule fois).
   * @param {AbortSignal} signal
   * @returns {Promise<() => void>}
   */
  acquire(signal) {
    if (signal.aborted) return Promise.reject(new WorkerError("timeout", "deadline"));
    if (this.active < this.maxActive && this.queue.length === 0) {
      this.active += 1;
      return Promise.resolve(this.#releaser());
    }
    if (this.queue.length >= this.maxQueued) return Promise.reject(new WorkerError("busy", "queue_full"));
    return new Promise((resolve, reject) => {
      const entry = {
        grant: () => {
          cleanup();
          this.active += 1;
          resolve(this.#releaser());
        },
      };
      const leave = (/** @type {WorkerError} */ error) => {
        cleanup();
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(error);
      };
      const timer = setTimeout(() => leave(new WorkerError("busy", "queue_wait")), this.maxWaitMs);
      const onAbort = () => leave(new WorkerError("timeout", "deadline"));
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  #releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.queue.shift();
      next?.grant();
    };
  }
}
