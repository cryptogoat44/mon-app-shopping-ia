import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { MAX_CALLS_PER_PHOTO } from "../src/lib/deadline.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { readSearchCounts, SearchCapacityError, type QuotaRow, type SearchCaps } from "../src/lib/searchCapacity.js";
import { callsPerPhoto, capacityStatus, nextParisMidnight, parisMidnight } from "../src/lib/searchCapacityStatus.js";
import searchCapacityRoutes, { CAPACITY_UNREADABLE } from "../src/routes/searchCapacity.js";

// Lot limites annoncées : le compteur lu AVANT l'effort, sans base ni réseau.
// La route elle-même, contre la base de développement, est vérifiée par
// searchCapacityRoute.test.ts (sur le Mac).

const CAPS: SearchCaps = { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 };
// 13 h à Paris, un jour d'hiver.
const NOON = new Date("2026-11-03T12:00:00Z");

function row(counts: { day?: number; month?: number; user?: number; nextRenewal?: string }): QuotaRow {
  return {
    allowed: true,
    refused_by: null,
    reservation_id: null,
    day_count: counts.day ?? 0,
    month_count: counts.month ?? 0,
    user_day_count: counts.user ?? 0,
    next_renewal: counts.nextRenewal ?? "2026-12-03",
  };
}

describe("minuit, heure de Paris (là où la base fait commencer ses journées)", () => {
  it("23 h UTC la veille l'hiver, 22 h l'été ; les jours de changement d'heure aussi", () => {
    expect(parisMidnight("2026-11-04").toISOString()).toBe("2026-11-03T23:00:00.000Z");
    expect(parisMidnight("2026-07-14").toISOString()).toBe("2026-07-13T22:00:00.000Z");
    // Passage à l'heure d'été le 29 mars 2026, à l'heure d'hiver le 25 octobre 2026.
    expect(parisMidnight("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(parisMidnight("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(parisMidnight("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(parisMidnight("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(parisMidnight("2027-01-01").toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("le minuit qui vient : jamais l'instant présent, même à minuit pile", () => {
    expect(nextParisMidnight(NOON).toISOString()).toBe("2026-11-03T23:00:00.000Z");
    expect(nextParisMidnight(new Date("2026-11-03T22:59:59Z")).toISOString()).toBe("2026-11-03T23:00:00.000Z");
    expect(nextParisMidnight(new Date("2026-11-03T23:00:00Z")).toISOString()).toBe("2026-11-04T23:00:00.000Z");
    expect(nextParisMidnight(new Date("2026-11-03T23:30:00Z")).toISOString()).toBe("2026-11-04T23:00:00.000Z");
    // Journées de 23 h et de 25 h.
    expect(nextParisMidnight(new Date("2026-03-28T23:30:00Z")).toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(nextParisMidnight(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});

describe("état du compteur montré par l'app", () => {
  it("service ouvert : la part de la personne, ce qui lui reste, et minuit (heure de Paris) pour la remise à zéro", () => {
    expect(capacityStatus(row({ day: 4, month: 40, user: 2 }), CAPS, 1, NOON)).toEqual({
      user: { used: 2, limit: 8, remaining: 6, resetsAt: "2026-11-03T23:00:00.000Z" },
      service: { status: "open" },
      remainingToday: 6,
    });
  });

  it("part de la personne épuisée : rien ne reste, le service peut rester ouvert ; part abaissée en cours de journée : jamais négatif", () => {
    expect(capacityStatus(row({ day: 10, month: 40, user: 8 }), CAPS, 1, NOON)).toMatchObject({ user: { remaining: 0 }, service: { status: "open" }, remainingToday: 0 });
    expect(capacityStatus(row({ day: 10, month: 40, user: 9 }), { ...CAPS, userDaily: 3 }, 1, NOON)).toMatchObject({ user: { used: 9, limit: 3, remaining: 0 }, remainingToday: 0 });
  });

  it("plafond du jour atteint : en pause jusqu'à minuit, heure de Paris ; même quand la part de la personne l'est aussi", () => {
    const paused = { status: "paused", reason: "day", reopensAt: "2026-11-03T23:00:00.000Z" };
    expect(capacityStatus(row({ day: 25, month: 40, user: 2 }), CAPS, 1, NOON)).toMatchObject({ service: paused, user: { remaining: 6 }, remainingToday: 0 });
    expect(capacityStatus(row({ day: 31, month: 40, user: 8 }), CAPS, 1, NOON)).toMatchObject({ service: paused, remainingToday: 0 });
  });

  it("plafond du mois atteint : en pause jusqu'à minuit (heure de Paris) du jour du renouvellement, avant le plafond du jour", () => {
    expect(capacityStatus(row({ day: 25, month: 225, user: 1, nextRenewal: "2026-12-03" }), CAPS, 1, NOON)).toMatchObject({
      service: { status: "paused", reason: "month", reopensAt: "2026-12-02T23:00:00.000Z" },
      remainingToday: 0,
    });
  });

  it("le plus petit des deux restes : ce que le service peut encore servir compte, converti prudemment en photos avec la voie C", () => {
    // 2 appels restants aujourd'hui, la personne n'a rien utilisé.
    expect(capacityStatus(row({ day: 23, month: 40 }), CAPS, 1, NOON).remainingToday).toBe(2);
    // Voie C : jusqu'à 3 appels par photo ; 2 appels laissent passer 1 photo à coup sûr (Lens d'abord).
    expect(capacityStatus(row({ day: 23, month: 40 }), CAPS, 3, NOON).remainingToday).toBe(1);
    // 7 appels : 3 + 3 + 1, trois photos passent à coup sûr.
    expect(capacityStatus(row({ day: 18, month: 40 }), CAPS, 3, NOON).remainingToday).toBe(3);
    // Le mois peut être plus serré que le jour.
    expect(capacityStatus(row({ day: 3, month: 224 }), CAPS, 1, NOON).remainingToday).toBe(1);
    // La part de la personne est plus serrée que le service.
    expect(capacityStatus(row({ day: 3, month: 40, user: 6 }), CAPS, 3, NOON).remainingToday).toBe(2);
  });

  it("appels par photo : 1 sans la voie C ; avec elle, le plus possible", () => {
    expect(callsPerPhoto(false)).toBe(1);
    expect(callsPerPhoto(true)).toBe(MAX_CALLS_PER_PHOTO);
  });
});

/** Un serveur réduit à ce que la lecture utilise : serpapi_quota, et un journal espionné. */
function fakeServer(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => answer);
  const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const fastify = { supabaseAdmin: { rpc } } as unknown as FastifyInstance;
  return { fastify, rpc, log: log as unknown as FastifyInstance["log"], spies: log };
}

describe("lecture pour l'app : rien n'est réservé, rien n'est journalisé", () => {
  it("serpapi_quota appelée avec p_reserve = false, sans recherche à exclure ; aucune ligne « Plafond recherches », même service fermé", async () => {
    const refused = { ...row({ day: 25, month: 40, user: 2 }), allowed: false, refused_by: "day" };
    const { fastify, rpc, log, spies } = fakeServer({ data: [refused], error: null });
    const counts = await readSearchCounts(fastify, log, "personne-1");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual([
      "serpapi_quota",
      {
        p_daily_cap: env.SERPAPI_DAILY_CAP,
        p_monthly_cap: env.SERPAPI_MONTHLY_CAP,
        p_user_daily_cap: env.SERPAPI_USER_DAILY_CAP,
        p_renewal_day: env.SERPAPI_RENEWAL_DAY,
        p_user_id: "personne-1",
        p_reserve: false,
        p_exclude_search: null,
      },
    ]);
    expect(counts.row).toMatchObject({ allowed: false, refused_by: "day", day_count: 25 });
    expect(counts.caps).toEqual({ daily: env.SERPAPI_DAILY_CAP, monthly: env.SERPAPI_MONTHLY_CAP, userDaily: env.SERPAPI_USER_DAILY_CAP, renewalDay: env.SERPAPI_RENEWAL_DAY });
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("base en erreur ou réponse illisible : une erreur propre, jamais une valeur inventée", async () => {
    for (const answer of [
      { data: null, error: { message: "base injoignable" } },
      { data: [{ allowed: true }], error: null },
      { data: [], error: null },
    ]) {
      const { fastify, log } = fakeServer(answer);
      await expect(readSearchCounts(fastify, log, "personne-1")).rejects.toBeInstanceOf(SearchCapacityError);
    }
  });
});

describe("route GET /api/searches/capacity", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /** La vraie route, avec une connexion et une limite de débit factices (aucun réseau). */
  async function routeWith(answer: { data: unknown; error: unknown }, signedIn = true) {
    const app = Fastify({ logger: false });
    apps.push(app);
    const rpc = vi.fn(async (_name: string, _params: Record<string, unknown>) => answer);
    const limits: string[] = [];
    app.decorateRequest("user", null);
    app.decorate("supabaseAdmin", { rpc } as unknown as SupabaseClient);
    app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
      if (!signedIn) return void (await reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." }));
      request.user = { id: "personne-1", email: null };
    });
    app.decorate("rateLimit", (name) => {
      limits.push(name);
      return async () => undefined;
    });
    app.decorate("rateLimitCheck", () => async () => undefined);
    app.decorate("countRateLimitHit", () => undefined);
    await app.register(searchCapacityRoutes);
    return { app, rpc, limits };
  }

  it("connecté : l'état lu pour cette personne, jamais mis en cache, avec sa propre limite de débit", async () => {
    const { app, rpc, limits } = await routeWith({ data: [row({ day: 4, month: 40, user: 6 })], error: null });
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(["remainingToday", "service", "user"]);
    expect(body).toMatchObject({ user: { used: 6, limit: env.SERPAPI_USER_DAILY_CAP }, service: { status: "open" } });
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_user_id: "personne-1", p_reserve: false });
    expect(limits).toEqual(["searchCapacityRead"]);
    expect(RATE_LIMITS.searchCapacityRead).toEqual({ max: 30, windowMs: 10 * 60 * 1000 });
  });

  it("compteur illisible : 503 et un message clair (l'app n'affiche rien et ne bloque rien)", async () => {
    const { app } = await routeWith({ data: null, error: { message: "base injoignable" } });
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(CAPACITY_UNREADABLE);
  });

  it("sans connexion : refusée avant toute lecture", async () => {
    const { app, rpc } = await routeWith({ data: [row({})], error: null }, false);
    expect((await app.inject({ method: "GET", url: "/api/searches/capacity" })).statusCode).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enregistrée dans le vrai serveur, derrière la connexion", async () => {
    const app = await buildApp({ logger: false });
    apps.push(app);
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/api/searches/capacity" })).toBe(true);
    const anonymous = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    expect(anonymous.statusCode).toBe(401);
  });
});
