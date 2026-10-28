import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BREAKER_RULES, breakerEvent, breakerState, readJudgedSearches, type JudgedSearch } from "../src/lib/searchBreaker.js";
import { buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Disjoncteur de la recherche par image (0027 ; réglages acceptés par le
// fondateur le 25 octobre) : 6 mauvaises sur les 10 dernières recherches des
// 30 dernières minutes (au moins 6 pour juger), pause de 15 minutes après la
// dernière mauvaise, puis une recherche de test ; une panne compte toujours,
// les réponses vides d'une même personne pour 2 au plus.

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 26, 10, 0);

let sequence = 0;
/** Une recherche jugée, lancée `minutesAgo` minutes avant NOW. */
function search(minutesAgo: number, bad: JudgedSearch["bad"], userId = "personne-a"): JudgedSearch {
  sequence += 1;
  return { id: `r${sequence}`, userId, startedAt: NOW - minutesAgo * MINUTE, bad };
}

/** `count` recherches, la plus récente lancée `fromMinutesAgo` minutes avant NOW, une par minute. */
function series(count: number, fromMinutesAgo: number, bad: JudgedSearch["bad"], userId?: string): JudgedSearch[] {
  return Array.from({ length: count }, (_, index) => search(fromMinutesAgo + index, bad, userId));
}

describe("disjoncteur : règles (calcul pur)", () => {
  it("6 pannes sur les 10 dernières : ouvert pour 15 minutes après la dernière", () => {
    const searches = [...series(6, 1, "failure"), ...series(4, 7, null)];
    expect(breakerState(searches, NOW)).toEqual({ open: true, tripped: true, judged: 10, bad: 6, minutesLeft: 14 });
  });

  it("5 pannes sur 10 : fermé ; moins de 6 recherches : on ne juge pas, même toutes en panne", () => {
    expect(breakerState([...series(5, 1, "failure"), ...series(5, 6, null)], NOW)).toMatchObject({ open: false, tripped: false, bad: 5 });
    expect(breakerState(series(5, 1, "failure"), NOW)).toMatchObject({ open: false, tripped: false, judged: 5, bad: 5 });
  });

  it("seules comptent les 10 dernières, et seulement celles des 30 dernières minutes", () => {
    // 5 pannes récentes, 5 bonnes, puis une 11e plus ancienne en panne : ignorée.
    const onze = [...series(5, 1, "failure"), ...series(5, 6, null), search(11, "failure")];
    expect(breakerState(onze, NOW)).toMatchObject({ tripped: false, judged: 10, bad: 5 });
    // 6 pannes, dont la plus ancienne il y a 31 minutes : 5 dans la fenêtre.
    const fenetre = [...series(5, 1, "failure"), search(31, "failure"), ...series(4, 6, null)];
    expect(breakerState(fenetre, NOW)).toMatchObject({ tripped: false, judged: 9, bad: 5 });
  });

  it("les réponses vides d'une même personne comptent pour 2 au plus ; celles de plusieurs personnes s'additionnent ; une panne compte toujours", () => {
    expect(breakerState(series(10, 1, "empty", "une-seule"), NOW)).toMatchObject({ tripped: false, bad: 2 });
    const troisPersonnes = [...series(2, 1, "empty", "p1"), ...series(2, 3, "empty", "p2"), ...series(2, 5, "empty", "p3"), ...series(4, 7, null)];
    expect(breakerState(troisPersonnes, NOW)).toMatchObject({ open: true, bad: 6 });
    const mixte = [...series(4, 1, "failure", "p1"), ...series(4, 5, "empty", "p1"), ...series(2, 9, null)];
    expect(breakerState(mixte, NOW)).toMatchObject({ open: true, bad: 6 });
  });

  it("la dernière recherche est bonne : tout repart, même avec 6 mauvaises dans la fenêtre", () => {
    const searches = [search(1, null), ...series(6, 2, "failure"), ...series(3, 8, null)];
    expect(breakerState(searches, NOW)).toMatchObject({ open: false, tripped: false, bad: 6 });
  });

  it("après 15 minutes de pause : plus ouvert, la recherche suivante sert de test", () => {
    const searches = [...series(6, 16, "failure"), ...series(4, 22, null)];
    expect(breakerState(searches, NOW)).toEqual({ open: false, tripped: true, judged: 10, bad: 6, minutesLeft: null });
  });

  it("événements : ouverture, réouverture après une recherche de test mauvaise, fermeture après une bonne, rien sinon", () => {
    const avant = [...series(5, 16, "failure"), ...series(4, 21, null)];
    const ouvrante = search(1, "failure");
    expect(breakerEvent([ouvrante, ...avant], ouvrante.id, NOW)).toBe("opened");

    const enPause = [...series(6, 16, "failure"), ...series(4, 22, null)];
    const testMauvais = search(0, "failure");
    expect(breakerEvent([testMauvais, ...enPause], testMauvais.id, NOW)).toBe("reopened");
    const testBon = search(0, null);
    expect(breakerEvent([testBon, ...enPause], testBon.id, NOW)).toBe("closed");

    const calme = [...series(9, 2, null)];
    const bonne = search(1, null);
    expect(breakerEvent([bonne, ...calme], bonne.id, NOW)).toBeNull();
    // Encore ouvert (observation : la recherche est passée), et elle est mauvaise : pas de nouvel événement.
    const ouvert = [...series(6, 2, "failure"), ...series(4, 8, null)];
    const pendantLaPause = search(1, "failure");
    expect(breakerEvent([pendantLaPause, ...ouvert], pendantLaPause.id, NOW)).toBeNull();
  });

  it("réglages acceptés le 25 octobre", () => {
    expect(BREAKER_RULES).toEqual({ windowMs: 30 * MINUTE, last: 10, minJudged: 6, badToOpen: 6, pauseMs: 15 * MINUTE, emptiesPerPerson: 2 });
  });
});

describe("disjoncteur : lecture de la base (spotto-dev)", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "dj");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  /** Une recherche par image lancée `secondsAgo` secondes plus tôt, avec son issue (aucun appel réel).
   * Les recherches des fichiers de tests précédents sont plus anciennes : les nôtres sont les dernières lues. */
  async function launched(secondsAgo: number, outcome: string | null, failureKind: string | null = null): Promise<string> {
    const startedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
    const { data, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({
        user_id: user.id,
        source_platform: "photo",
        method: "manual_screenshot",
        status: outcome === null ? "processing" : "failed",
        outcome,
        failure_kind: failureKind,
        run_started_at: startedAt,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    return z.object({ id: z.string() }).parse(data).id;
  }

  it("lit les recherches qui ont atteint le fournisseur : pannes (refus compris) et réponses vides ; écarte nos pannes d'enregistrement, les recherches interrompues, celles en cours et les anciennes", async () => {
    const refus = await launched(1, "failure", "provider_refused");
    const delai = await launched(1, "failure", "timeout");
    const vide = await launched(1, "empty_lens");
    const enregistrement = await launched(1, "failure", "save_failed");
    const interrompue = await launched(1, "failure", "interrupted");
    const enCours = await launched(1, null);
    const ancienne = await launched(40 * 60, "failure", "timeout");

    const lues = await readJudgedSearches(app, "image", Date.now());
    const miennes = new Map(lues.filter((s) => s.userId === user.id).map((s) => [s.id, s.bad]));
    expect(miennes.get(refus)).toBe("failure");
    expect(miennes.get(delai)).toBe("failure");
    expect(miennes.get(vide)).toBe("empty");
    for (const ecartee of [enregistrement, interrompue, enCours, ancienne]) expect(miennes.has(ecartee)).toBe(false);
    expect(lues.length).toBeLessThanOrEqual(BREAKER_RULES.last + 1);
  });
});
