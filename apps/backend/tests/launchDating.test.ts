import { describe, expect, it } from "vitest";
import { launchDating } from "../src/lib/launchDating.js";

// Jour du lancement (lot quota, 2026-11-02) : une recherche préparée avant
// minuit (heure de Paris) et lancée après prend l'heure du lancement comme
// date de création, pour compter dans la part du jour où elle part ; lancée le
// jour même, rien ne change. Calcul pur : ni base, ni réseau. Les dates de
// création ont la forme renvoyée par la base.

/** Lancée à `launchedAt` : l'heure du lancement, et la même date de création. */
const redated = (launchedAt: string) => ({ run_started_at: launchedAt, created_at: launchedAt });
/** Lancée à `launchedAt` : l'heure du lancement seulement. */
const kept = (launchedAt: string) => ({ run_started_at: launchedAt });
const launch = (createdAt: string, launchedAt: string) => launchDating(createdAt, new Date(launchedAt));

describe("jour du lancement : date de création d'une recherche lancée", () => {
  it("préparée la veille à 23 h 59 (heure de Paris), lancée à 0 h 01 : datée de son lancement, comme une recherche restée plusieurs jours en attente", () => {
    // Minuit à Paris le 2 novembre 2026 (heure d'hiver) : 23 h 00 en heure universelle, la veille.
    expect(launch("2026-11-01T22:59:00.123456+00:00", "2026-11-01T23:01:00.000Z")).toEqual(redated("2026-11-01T23:01:00.000Z"));
    expect(launch("2026-11-01T22:59:59.999+00:00", "2026-11-01T23:00:00.000Z")).toEqual(redated("2026-11-01T23:00:00.000Z"));
    expect(launch("2026-10-20T08:00:00+00:00", "2026-11-02T10:00:00.000Z")).toEqual(redated("2026-11-02T10:00:00.000Z"));
  });

  it("préparée et lancée le même jour de Paris : sa date de création ne change pas, même préparée à minuit pile", () => {
    expect(launch("2026-11-01T23:01:00.123456+00:00", "2026-11-02T22:59:00.000Z")).toEqual(kept("2026-11-02T22:59:00.000Z"));
    expect(launch("2026-11-01T23:00:00+00:00", "2026-11-01T23:05:00.000Z")).toEqual(kept("2026-11-01T23:05:00.000Z"));
    expect(launch("2026-11-02T09:59:30.5+00:00", "2026-11-02T10:00:00.000Z")).toEqual(kept("2026-11-02T10:00:00.000Z"));
  });

  it("changement d'heure du 25 octobre 2026 (journée de 25 heures) : minuit de Paris avant et après, jamais un jour de 24 heures", () => {
    // Le 25 octobre commence à 22 h 00 UTC le 24 (heure d'été) et finit à 23 h 00 UTC le 25 (heure d'hiver).
    expect(launch("2026-10-24T21:59:00+00:00", "2026-10-24T22:01:00.000Z")).toEqual(redated("2026-10-24T22:01:00.000Z"));
    expect(launch("2026-10-24T22:30:00+00:00", "2026-10-25T22:30:00.000Z")).toEqual(kept("2026-10-25T22:30:00.000Z"));
    expect(launch("2026-10-25T22:59:00+00:00", "2026-10-25T23:01:00.000Z")).toEqual(redated("2026-10-25T23:01:00.000Z"));
  });

  it("changement d'heure du 28 mars 2027 (journée de 23 heures) : minuit de Paris avant et après", () => {
    // Le 28 mars commence à 23 h 00 UTC le 27 (heure d'hiver) et finit à 22 h 00 UTC le 28 (heure d'été).
    expect(launch("2027-03-27T22:59:00+00:00", "2027-03-27T23:01:00.000Z")).toEqual(redated("2027-03-27T23:01:00.000Z"));
    expect(launch("2027-03-27T23:30:00+00:00", "2027-03-28T21:30:00.000Z")).toEqual(kept("2027-03-28T21:30:00.000Z"));
    expect(launch("2027-03-28T21:59:00+00:00", "2027-03-28T22:01:00.000Z")).toEqual(redated("2027-03-28T22:01:00.000Z"));
  });

  it("date de création illisible : jamais changée, comme avant", () => {
    expect(launch("pas une date", "2026-11-02T10:00:00.000Z")).toEqual(kept("2026-11-02T10:00:00.000Z"));
    expect(launch("", "2026-11-02T10:00:00.000Z")).toEqual(kept("2026-11-02T10:00:00.000Z"));
  });
});
