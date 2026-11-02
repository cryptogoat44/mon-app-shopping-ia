import { describe, expect, it } from "vitest";
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
});
