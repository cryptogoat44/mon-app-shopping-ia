import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BREAKER_LOG_MESSAGE, breakerPause, observeBreakerAfter, SEARCH_PAUSED } from "../src/lib/searchBreaker.js";
import { ALERT_LOG_MESSAGE, resetAlertsForTests } from "../src/lib/alerts.js";
import { EN_MESSAGES } from "../src/lib/messages.js";

// Disjoncteur de la recherche par image (lot garde-fous, point 15) : il
// bloque pendant la pause, et son ouverture envoie une alerte. La table des
// recherches est simulée (aucun réseau) ; les règles elles-mêmes sont testées
// avec la base dans searchBreaker.test.ts.

const MINUTE = 60_000;

/** Une requête Supabase simulée : chaque méthode renvoie la requête, et l'attente renvoie `answer`. */
function fakeQuery(answer: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "in", "gte", "not", "or", "order", "limit"]) query[method] = () => query;
  query.then = (resolve: (value: unknown) => void) => resolve(answer);
  return query;
}

function fakeApp(rows: unknown, error: unknown = null) {
  const lines: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const log = {
    info: (fields: Record<string, unknown>, message: string) => lines.push({ level: "info", fields, message }),
    warn: (fields: Record<string, unknown>, message: string) => lines.push({ level: "warn", fields, message }),
  };
  const app = { supabaseAdmin: { from: () => fakeQuery({ data: rows, error }) }, log } as unknown as FastifyInstance;
  return { app, lines };
}

/** `count` recherches, la plus récente lancée il y a `fromMinutesAgo` minutes, une par minute. */
function judged(count: number, fromMinutesAgo: number, outcome: string, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    user_id: `personne-${prefix}${index}`,
    run_started_at: new Date(Date.now() - (fromMinutesAgo + index) * MINUTE).toISOString(),
    outcome,
  }));
}

const originalNodeEnv = process.env.NODE_ENV;
beforeAll(() => {
  // Sous Vitest, le disjoncteur ne bloque pas ; on le rallume pour ces tests.
  process.env.NODE_ENV = "development";
});
afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});
beforeEach(() => resetAlertsForTests());

describe("disjoncteur qui bloque", () => {
  it("6 pannes sur les 10 dernières : la recherche suivante est refusée, et la ligne « Disjoncteur » le dit", async () => {
    const { app, lines } = fakeApp([...judged(6, 1, "failure", "p"), ...judged(4, 7, "found", "b")]);
    const pause = await breakerPause(app, "image", "serpapi");
    expect(pause).not.toBeNull();
    expect(pause!.minutesLeft).toBeGreaterThan(0);
    expect(pause!.minutesLeft).toBeLessThanOrEqual(15);
    expect(lines).toEqual([
      { level: "info", fields: { provider: "serpapi", searchType: "image", mode: "block", event: "blocked", judged: 10, bad: 6, minutesLeft: pause!.minutesLeft }, message: BREAKER_LOG_MESSAGE },
    ]);
  });

  it("assez de bonnes recherches : rien n'est bloqué", async () => {
    const { app, lines } = fakeApp([...judged(5, 1, "failure", "p"), ...judged(5, 6, "found", "b")]);
    expect(await breakerPause(app, "image", "serpapi")).toBeNull();
    expect(lines).toEqual([]);
  });

  it("disjoncteur illisible : rien n'est bloqué (le plafond protège toujours la dépense)", async () => {
    const { app, lines } = fakeApp(null, { message: "panne" });
    expect(await breakerPause(app, "image", "serpapi")).toBeNull();
    expect(lines.map((line) => line.level)).toEqual(["warn"]);
  });

  it("l'ouverture envoie une alerte (une par heure au plus), jamais la fermeture", async () => {
    const opening = [...judged(6, 0, "failure", "p"), ...judged(4, 7, "found", "b")];
    const { app, lines } = fakeApp(opening);
    await observeBreakerAfter(app, "image", "serpapi", "p0");
    expect(lines.map((line) => line.message)).toEqual([BREAKER_LOG_MESSAGE, ALERT_LOG_MESSAGE]);
    expect(lines[1]!.fields).toEqual({ alerte: "disjoncteur", fournisseur: "serpapi", evenement: "opened" });
    // Même ouverture relue : pas de seconde alerte dans l'heure.
    await observeBreakerAfter(app, "image", "serpapi", "p0");
    expect(lines.filter((line) => line.message === ALERT_LOG_MESSAGE)).toHaveLength(1);

    const closing = fakeApp([...judged(1, 0, "found", "n"), ...judged(6, 16, "failure", "p"), ...judged(3, 22, "found", "b")]);
    await observeBreakerAfter(closing.app, "image", "serpapi", "n0");
    expect(closing.lines.map((line) => [line.fields.event, line.message])).toEqual([["closed", BREAKER_LOG_MESSAGE]]);
  });

  it("sous Vitest (NODE_ENV « test »), il ne bloque pas : les tests avec la base simulent beaucoup de pannes", async () => {
    process.env.NODE_ENV = "test";
    try {
      const { app } = fakeApp([...judged(6, 1, "failure", "p"), ...judged(4, 7, "found", "b")]);
      expect(await breakerPause(app, "image", "serpapi")).toBeNull();
    } finally {
      process.env.NODE_ENV = "development";
    }
  });

  it("le refus a son code et son message, traduit en anglais", () => {
    expect(SEARCH_PAUSED.error).toBe("search_paused");
    expect(EN_MESSAGES[SEARCH_PAUSED.message]).toBeDefined();
  });
});
