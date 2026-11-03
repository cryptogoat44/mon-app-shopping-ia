import { describe, expect, it, vi } from "vitest";
import { singleFlight, singleFlightPending } from "../src/lib/singleFlight.js";

// Lot c, voie C : un seul appel à la fois pour une même clé.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("singleFlight", () => {
  it("deux appels simultanés de même clé : fn tourne une seule fois, même résultat pour les deux", async () => {
    const gate = deferred<string>();
    let runs = 0;
    const fn = () => {
      runs += 1;
      return gate.promise;
    };
    const first = singleFlight("cle-a", fn);
    const second = singleFlight("cle-a", fn);
    expect(singleFlightPending()).toBe(1);
    gate.resolve("réponse");
    expect(await Promise.all([first, second])).toEqual(["réponse", "réponse"]);
    expect(runs).toBe(1);
    expect(singleFlightPending()).toBe(0);
  });

  it("clés différentes : deux appels", async () => {
    let runs = 0;
    const fn = async () => ++runs;
    await Promise.all([singleFlight("cle-b", fn), singleFlight("cle-c", fn)]);
    expect(runs).toBe(2);
  });

  it("un échec est partagé pendant l'appel, jamais après : l'appel suivant relance fn", async () => {
    const gate = deferred<string>();
    let runs = 0;
    const failing = () => {
      runs += 1;
      return gate.promise;
    };
    const first = singleFlight("cle-d", failing);
    const second = singleFlight("cle-d", failing);
    gate.reject(new Error("panne"));
    await expect(first).rejects.toThrow("panne");
    await expect(second).rejects.toThrow("panne");
    expect(singleFlightPending()).toBe(0);
    expect(await singleFlight("cle-d", async () => "neuf")).toBe("neuf");
    expect(runs).toBe(1);
  });

  it("une erreur levée tout de suite par fn devient un rejet, et l'entrée est retirée", async () => {
    await expect(
      singleFlight("cle-e", () => {
        throw new Error("immédiate");
      })
    ).rejects.toThrow("immédiate");
    expect(singleFlightPending()).toBe(0);
  });

  it("réussite gardée par holdUntil : un appel arrivé avant la fin du maintien reçoit le même résultat sans relancer fn ; retirée ensuite", async () => {
    const hold = deferred<void>();
    let runs = 0;
    const fn = async () => ++runs;
    expect(await singleFlight("cle-f", fn, () => hold.promise)).toBe(1);
    expect(singleFlightPending()).toBe(1);
    expect(await singleFlight("cle-f", fn)).toBe(1);
    expect(runs).toBe(1);
    hold.resolve();
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
    expect(await singleFlight("cle-f", fn)).toBe(2);
  });

  it("maintien en échec, holdUntil qui lève une erreur ou rend null : l'entrée est retirée quand même", async () => {
    const failingHold = deferred<void>();
    await singleFlight("cle-g", async () => "a", () => failingHold.promise);
    expect(singleFlightPending()).toBe(1);
    failingHold.reject(new Error("écriture en panne"));
    await vi.waitFor(() => expect(singleFlightPending()).toBe(0));
    await singleFlight("cle-h", async () => "b", () => {
      throw new Error("bogue");
    });
    expect(singleFlightPending()).toBe(0);
    await singleFlight("cle-i", async () => "c", () => null);
    expect(singleFlightPending()).toBe(0);
  });

  it("un échec n'est jamais gardé, même avec holdUntil : l'appel suivant relance fn", async () => {
    const holdUntil = vi.fn(() => new Promise<void>(() => undefined));
    await expect(
      singleFlight(
        "cle-j",
        async () => {
          throw new Error("panne");
        },
        holdUntil
      )
    ).rejects.toThrow("panne");
    expect(holdUntil).not.toHaveBeenCalled();
    expect(singleFlightPending()).toBe(0);
    expect(await singleFlight("cle-j", async () => "neuf")).toBe("neuf");
  });
});
