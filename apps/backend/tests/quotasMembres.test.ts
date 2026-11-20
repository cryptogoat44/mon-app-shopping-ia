import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSearchCapacity, parseSearchCapacityError, parseSearchMonthlyQuotaError, SEARCH_CAPACITY_ERRORS, SEARCH_MONTHLY_QUOTA_ERROR, type SearchCapacityStatus } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { resetAlertsForTests } from "../src/lib/alerts.js";
import {
  entitlementActive,
  FREE_MONTHLY_SEARCH_CAP,
  isSubscriber,
  logQuotaSettings,
  memberQuotasReady,
  readQuotaSettings,
  reducedCap,
  resetMemberQuotasProbe,
  searchTierFor,
  tierFor,
  type QuotaEnvSource,
} from "../src/lib/memberQuotas.js";
import { monthlyQuotaForExport } from "../src/lib/exportData.js";
import { renderExportHtml } from "../src/lib/exportHtml.js";
import { localizeMessage } from "../src/lib/messages.js";
import { capacityReachedBody, readSearchCounts, reserveSearch, SEARCH_CAPACITY_MESSAGES, searchCapacityForVideoAi, sendCapacityReached } from "../src/lib/searchCapacity.js";
import { capacityForOlderApp, capacityStatus, nextParisMonthStart, parisMidnight } from "../src/lib/searchCapacityStatus.js";
import searchCapacityRoutes from "../src/routes/searchCapacity.js";
import videoMomentsRoutes from "../src/routes/videoMoments.js";
import { fixture, lookups, sectionHtml, STORAGE, visibleText } from "./exportFixture.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

// Quotas par membre (lot quotas, décisions du fondateur du 19 novembre 2026,
// migration 0053), sans base ni réseau. La fonction de la base
// (serpapi_quota_v2) est imitée en mémoire, avec les mêmes comptes et le même
// ordre de refus que le SQL ; le SQL lui-même est vérifié par
// quotasMigration.test.ts, par une base Postgres locale et jetable, et par
// quotasMembresBase.test.ts (sur le Mac). Chaque règle a un cas refusé et un
// cas permis.

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const PROBE = "member_quotas_version";
const CAPS = { SERPAPI_DAILY_CAP: 25, SERPAPI_MONTHLY_CAP: 225, SERPAPI_USER_DAILY_CAP: 8, SERPAPI_RENEWAL_DAY: 1 };
const SETTINGS_KEYS = ["SUBSCRIPTIONS_ENABLED", "SUBSCRIBER_MONTHLY_SEARCH_CAP", "SUBSCRIBER_RESERVE_PERCENT", "ANTHROPIC_API_KEY", ...Object.keys(CAPS)] as const;
const saved = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, env[key as keyof typeof env]]));

/** 19 novembre 2026, 13 h à Paris. */
const NOW = new Date("2026-11-19T12:00:00Z");
const HOUR = 3_600_000;
const parisDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

interface FakeSearch {
  id: string;
  userId: string;
  createdAt: Date;
  status?: "pending" | "processing" | "completed" | "failed";
  failureKind?: string | null;
  servedFromCache?: boolean;
}

/** La base imitée : appels réservés (sans compte), recherches des membres,
 * droits d'abonnement, et serpapi_quota_v2 (mêmes règles que le SQL de 0053,
 * cycle de SerpApi = mois civil ici : renouvellement le 1er). */
function quotaDatabase(options: { migration?: boolean; clock?: () => Date } = {}) {
  const clock = options.clock ?? (() => NOW);
  const calls: Date[] = [];
  const searches: FakeSearch[] = [];
  const rpcCalls: [string, Record<string, unknown>][] = [];
  let failEntitlements = false;
  const parisDay = (at: Date) => parisDate.format(at);
  const monthOf = (at: Date) => parisDay(at).slice(0, 7);

  function quotaV2(p: Record<string, unknown>) {
    const at = clock();
    const reserve = Number(p.p_reserve_percent);
    const dailyCap = reducedCap(Number(p.p_daily_cap), reserve);
    const monthlyCap = reducedCap(Number(p.p_monthly_cap), reserve);
    const live = calls.filter((call) => call <= at && monthOf(call) === monthOf(at));
    const day = live.filter((call) => parisDay(call) === parisDay(at)).length;
    const month = live.length;
    const counted = searches.filter(
      (s) =>
        s.userId === p.p_user_id &&
        (s.status ?? "completed") !== "pending" &&
        s.createdAt <= at &&
        monthOf(s.createdAt) === monthOf(at) &&
        s.id !== p.p_exclude_search &&
        !s.failureKind &&
        !s.servedFromCache
    );
    const userMonth = counted.length;
    const user = counted.filter((s) => parisDay(s.createdAt) === parisDay(at)).length;
    const resetsOn = nextParisMonthStart(at);
    const base = { day_count: day, month_count: month, user_day_count: user, next_renewal: resetsOn, user_month_count: userMonth, month_resets_on: resetsOn };
    const refused = (by: string) => ({ allowed: false, refused_by: by, reservation_id: null, ...base });
    if (month >= monthlyCap) return refused("month");
    if (p.p_user_monthly_cap !== null && userMonth >= Number(p.p_user_monthly_cap)) return refused("user_month");
    if (user >= Number(p.p_user_daily_cap)) return refused("user");
    if (day >= dailyCap) return refused("day");
    if (p.p_reserve) calls.push(at);
    const added = p.p_reserve ? 1 : 0;
    return {
      allowed: true,
      refused_by: null,
      reservation_id: p.p_reserve ? calls.length : null,
      ...base,
      day_count: day + added,
      month_count: month + added,
      user_day_count: user + added,
      user_month_count: userMonth + added,
    };
  }

  const fake = fakeSupabase({
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      if (fn === PROBE) return options.migration === false ? { data: null, error: { code: "PGRST202", message: "absente" } } : { data: 1, error: null };
      if (fn === "serpapi_quota_v2" && options.migration !== false) return { data: [quotaV2(args)], error: null };
      if (fn === "serpapi_quota") {
        // La fonction de 0029 : ni part du mois, ni réserve.
        const row = quotaV2({ ...args, p_user_monthly_cap: null, p_reserve_percent: 0 }) as Record<string, unknown>;
        delete row.user_month_count;
        delete row.month_resets_on;
        return { data: [row], error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
    missing: ["table_absente_pour_le_test"],
  });
  const db = fake.db as unknown as SupabaseClient;
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fastify = { supabaseAdmin: db, log } as unknown as FastifyInstance;
  const originalFrom = fake.db.from;
  // Lecture des droits en échec, à la demande.
  fake.db.from = ((table: string) => (failEntitlements && table === "member_entitlements" ? originalFrom("table_absente_pour_le_test") : originalFrom(table))) as typeof fake.db.from;

  return {
    fake,
    fastify,
    log,
    calls,
    rpcCalls,
    /** `count` recherches de la personne, une par heure en remontant depuis `until` (même jour si possible). */
    addSearches(userId: string, count: number, until: Date, extra: Partial<FakeSearch> = {}) {
      for (let index = 0; index < count; index += 1) {
        searches.push({ id: `s-${searches.length}`, userId, createdAt: new Date(until.getTime() - (index + 1) * 60_000), ...extra });
      }
    },
    /** `count` recherches des jours passés du mois (le 2 novembre). */
    addEarlierInMonth(userId: string, count: number, extra: Partial<FakeSearch> = {}) {
      this.addSearches(userId, count, new Date("2026-11-02T20:00:00Z"), extra);
    },
    addCalls(count: number, at: Date = new Date(NOW.getTime() - HOUR)) {
      for (let index = 0; index < count; index += 1) calls.push(at);
    },
    entitle(userId: string, entitlement: "video" | "miroir", expiresAt: string | null = null) {
      fake.table("member_entitlements").push({ user_id: userId, entitlement, expires_at: expiresAt, source: "revenuecat", updated_at: NOW.toISOString() });
    },
    failEntitlementReads() {
      failEntitlements = true;
    },
  };
}

function settings(values: Partial<Record<(typeof SETTINGS_KEYS)[number], unknown>>) {
  Object.assign(env, values);
}

beforeEach(() => {
  // Le serveur calcule « minuit, heure de Paris » et « le 1er du mois » avec l'heure courante :
  // on la fixe à NOW, l'heure de la fausse base, sinon ces attentes ne tiennent qu'un seul jour.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetMemberQuotasProbe();
  resetAlertsForTests();
  settings({ ...CAPS, SUBSCRIPTIONS_ENABLED: false, SUBSCRIBER_MONTHLY_SEARCH_CAP: undefined, SUBSCRIBER_RESERVE_PERCENT: undefined });
});

afterEach(() => {
  Object.assign(env, saved);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("réglages : lecture tolérante, jamais un arrêt du serveur", () => {
  const source = (values: Partial<QuotaEnvSource>): QuotaEnvSource => ({ SUBSCRIPTIONS_ENABLED: false, SUBSCRIBER_MONTHLY_SEARCH_CAP: undefined, SUBSCRIBER_RESERVE_PERCENT: undefined, ...values });

  it("par défaut : abonnements coupés, aucune limite du mois pour un abonné, réserve de 30 %", () => {
    const problems: string[] = [];
    expect(readQuotaSettings(source({}), problems)).toEqual({ subscriptionsEnabled: false, subscriberMonthlyCap: null, reservePercent: 30 });
    expect(problems).toEqual([]);
  });

  it("valeurs valides : le garde-fou des abonnés et la réserve (0 à 90)", () => {
    const problems: string[] = [];
    expect(readQuotaSettings(source({ SUBSCRIPTIONS_ENABLED: true, SUBSCRIBER_MONTHLY_SEARCH_CAP: " 300 ", SUBSCRIBER_RESERVE_PERCENT: "0" }), problems)).toEqual({
      subscriptionsEnabled: true,
      subscriberMonthlyCap: 300,
      reservePercent: 0,
    });
    expect(readQuotaSettings(source({ SUBSCRIBER_RESERVE_PERCENT: "90" }), problems).reservePercent).toBe(90);
    expect(problems).toEqual([]);
  });

  it("valeurs invalides : ignorées (abonnés sans limite du mois, réserve à 30), avec la variable à corriger, jamais sa valeur", () => {
    for (const cap of ["0", "-3", "1.5", "abc", "1e3", "100000000"]) {
      const problems: string[] = [];
      expect(readQuotaSettings(source({ SUBSCRIBER_MONTHLY_SEARCH_CAP: cap }), problems).subscriberMonthlyCap, cap).toBeNull();
      expect(problems, cap).toHaveLength(1);
      expect(problems[0]).toMatch(/^SUBSCRIBER_MONTHLY_SEARCH_CAP : /);
      expect(problems[0]).not.toContain(` ${cap} `);
    }
    for (const percent of ["91", "-1", "30%", "abc", "100", "3.5"]) {
      const problems: string[] = [];
      expect(readQuotaSettings(source({ SUBSCRIBER_RESERVE_PERCENT: percent }), problems).reservePercent, percent).toBe(30);
      expect(problems[0], percent).toMatch(/^SUBSCRIBER_RESERVE_PERCENT : /);
    }
  });

  it("un avertissement au démarrage pour un réglage invalide, sans la valeur ; rien si tout va bien", () => {
    const log = { warn: vi.fn() };
    logQuotaSettings(log, source({ SUBSCRIBER_MONTHLY_SEARCH_CAP: "beaucoup", SUBSCRIBER_RESERVE_PERCENT: "95" }));
    expect(log.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.warn.mock.calls[0])).not.toMatch(/beaucoup|95/);
    const quiet = { warn: vi.fn() };
    logQuotaSettings(quiet, source({}));
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it("SUBSCRIPTIONS_ENABLED : seule la valeur exacte « true » allume les abonnements (comme les autres interrupteurs)", () => {
    const source = readFileSync(join(__dirname, "../src/env.ts"), "utf8");
    expect(source).toMatch(/SUBSCRIPTIONS_ENABLED: z\s*\.string\(\)\s*\.optional\(\)\s*\.transform\(\(value\) => value === "true"\)/);
    // Les deux autres réglages restent du texte, vérifié par lib/memberQuotas.ts (jamais un arrêt du serveur).
    expect(source).toContain("SUBSCRIBER_MONTHLY_SEARCH_CAP: z.string().optional(),");
    expect(source).toContain("SUBSCRIBER_RESERVE_PERCENT: z.string().optional(),");
  });
});

describe("la formule d'une personne", () => {
  const off = { subscriptionsEnabled: false, subscriberMonthlyCap: null, reservePercent: 30 };
  const on = { ...off, subscriptionsEnabled: true };

  it("compte gratuit : 100 recherches par mois ; réserve des abonnés seulement quand les abonnements sont allumés", () => {
    expect(tierFor(false, off)).toEqual({ subscriber: false, monthlyCap: FREE_MONTHLY_SEARCH_CAP, reservePercent: 0 });
    expect(tierFor(false, on)).toEqual({ subscriber: false, monthlyCap: 100, reservePercent: 30 });
  });

  it("abonné : pas de part du mois (sauf garde-fou réglé), jamais de réserve", () => {
    expect(tierFor(true, on)).toEqual({ subscriber: true, monthlyCap: null, reservePercent: 0 });
    expect(tierFor(true, { ...on, subscriberMonthlyCap: 400 })).toEqual({ subscriber: true, monthlyCap: 400, reservePercent: 0 });
  });

  it("plafonds réduits de la réserve, arrondis à l'entier inférieur (comme la base)", () => {
    expect(reducedCap(25, 30)).toBe(17);
    expect(reducedCap(225, 30)).toBe(157);
    expect(reducedCap(225, 0)).toBe(225);
    expect(reducedCap(1, 30)).toBe(0);
  });
});

describe("qui est abonné", () => {
  it("abonnements coupés : personne, et rien n'est lu", async () => {
    const base = quotaDatabase();
    base.entitle(ALICE, "video");
    const from = vi.spyOn(base.fake.db, "from");
    expect(await isSubscriber(base.fastify, base.log, ALICE, NOW)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("abonnements allumés : un droit « video » ou « miroir » en cours ; expiré : non ; d'un autre membre : non", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "miroir", "2026-12-19T00:00:00+00:00");
    base.entitle(BRUNO, "video", "2026-11-19T11:59:59+00:00");
    expect(await isSubscriber(base.fastify, base.log, ALICE, NOW)).toBe(true);
    expect(await isSubscriber(base.fastify, base.log, BRUNO, NOW)).toBe(false);
    base.entitle(BRUNO, "video", null);
    expect(await isSubscriber(base.fastify, base.log, BRUNO, NOW)).toBe(true);
    expect(entitlementActive(null, NOW)).toBe(true);
    expect(entitlementActive("pas une date", NOW)).toBe(false);
  });

  it("base sans 0053 : personne n'est abonné, rien n'est lu", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase({ migration: false });
    base.entitle(ALICE, "video");
    const from = vi.spyOn(base.fake.db, "from");
    expect(await isSubscriber(base.fastify, base.log, ALICE, NOW)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("lecture des droits en échec : règles d'un compte gratuit, écrit au journal sans le compte, jamais une erreur", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "video");
    base.failEntitlementReads();
    expect(await isSubscriber(base.fastify, base.log, ALICE, NOW)).toBe(false);
    expect(base.log.warn).toHaveBeenCalledWith(expect.objectContaining({ code: expect.anything() }), "Droits d'abonnement illisibles : règles d'un compte gratuit");
    expect(JSON.stringify(base.log.warn.mock.calls)).not.toContain(ALICE);
    expect(await searchTierFor(base.fastify, base.log, ALICE, NOW)).toEqual({ subscriber: false, monthlyCap: 100, reservePercent: 30 });
  });
});

describe("recherches : part du mois, part du jour, réserve des abonnés (serpapi_quota_v2)", () => {
  it("101e recherche du mois d'un compte gratuit : refusée, reprise le 1er décembre ; la 100e passait", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 99);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle")).toMatchObject({ allowed: true });
    base.addSearches(ALICE, 1, NOW);
    const refused = await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle-2");
    expect(refused).toEqual({ allowed: false, limit: "user_month", resumesOn: "2026-12-01" });
    // La base a reçu la part du mois (100) et aucune réserve (abonnements coupés).
    const params = base.rpcCalls.filter(([fn]) => fn === "serpapi_quota_v2").map(([, args]) => args);
    expect(params.at(-1)).toMatchObject({ p_user_monthly_cap: 100, p_reserve_percent: 0, p_reserve: true, p_exclude_search: "nouvelle-2" });
  });

  it("le refus de la part du mois : 429, son propre code, la date du retour ; traduit en anglais", async () => {
    const app = Fastify({ logger: false });
    app.get("/refus", async (_request, reply) => sendCapacityReached(reply, { limit: "user_month", resumesOn: "2026-12-01" }, true));
    const response = await app.inject({ method: "GET", url: "/refus" });
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({ error: SEARCH_MONTHLY_QUOTA_ERROR, message: SEARCH_CAPACITY_MESSAGES.user_month, resumesOn: "2026-12-01" });
    expect(parseSearchMonthlyQuotaError(response.json())).toEqual({ resumesOn: "2026-12-01" });
    // Les autres refus gardent leurs codes ; ils ne sont pas lus comme la part du mois.
    expect(parseSearchMonthlyQuotaError({ error: SEARCH_CAPACITY_ERRORS.month, resumesOn: "2026-12-03" })).toBeNull();
    expect(localizeMessage(SEARCH_CAPACITY_MESSAGES.user_month, 429, "en")).toBe("You've used all your searches for this month.");
    await app.close();
  });

  it("abonné au-delà de 100 recherches dans le mois : permis (seule la part du jour s'applique)", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "video");
    base.addEarlierInMonth(ALICE, 150);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle")).toMatchObject({ allowed: true });
    expect(base.rpcCalls.find(([fn]) => fn === "serpapi_quota_v2")![1]).toMatchObject({ p_user_monthly_cap: null, p_reserve_percent: 0 });
  });

  it("garde-fou des abonnés réglé : il plafonne aussi leur mois", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true, SUBSCRIBER_MONTHLY_SEARCH_CAP: "120" });
    const base = quotaDatabase();
    base.entitle(ALICE, "miroir");
    base.addEarlierInMonth(ALICE, 120);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle")).toEqual({ allowed: false, limit: "user_month", resumesOn: "2026-12-01" });
    settings({ SUBSCRIBER_MONTHLY_SEARCH_CAP: "121" });
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle")).toMatchObject({ allowed: true });
  });

  it("9e recherche du jour : refusée pour tous, abonné compris ; la 8e passait", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(BRUNO, "video");
    for (const user of [ALICE, BRUNO]) {
      base.addSearches(user, 7, NOW);
      expect(await reserveSearch(base.fastify, base.log as never, user, `s-${user}-8`), user).toMatchObject({ allowed: true });
      base.addSearches(user, 1, NOW);
      expect(await reserveSearch(base.fastify, base.log as never, user, `s-${user}-9`), user).toEqual({ allowed: false, limit: "user", resumesOn: null });
    }
  });

  it("réserve des abonnés : un compte gratuit s'arrête à 70 % du plafond du jour, un abonné va jusqu'à 100 %", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(BRUNO, "video");
    base.addCalls(16);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit-1")).toMatchObject({ allowed: true });
    // 17 appels : 70 % de 25, arrondi à 17.
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit-2")).toEqual({ allowed: false, limit: "day", resumesOn: null });
    for (let index = 17; index < 25; index += 1) expect(await reserveSearch(base.fastify, base.log as never, BRUNO, `abonne-${index}`), String(index)).toMatchObject({ allowed: true });
    expect(await reserveSearch(base.fastify, base.log as never, BRUNO, "abonne-25")).toEqual({ allowed: false, limit: "day", resumesOn: null });
  });

  it("réserve des abonnés sur le mois : un compte gratuit s'arrête à 157 appels sur 225 (reprise au renouvellement), un abonné continue", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(BRUNO, "miroir");
    base.addCalls(157, new Date("2026-11-03T10:00:00Z"));
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit")).toEqual({ allowed: false, limit: "month", resumesOn: "2026-12-01" });
    expect(await reserveSearch(base.fastify, base.log as never, BRUNO, "abonne")).toMatchObject({ allowed: true });
  });

  it("abonnements coupés : réserve à 0, un compte gratuit va jusqu'au plafond total", async () => {
    const base = quotaDatabase();
    base.addCalls(20);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit")).toMatchObject({ allowed: true });
    expect(base.rpcCalls.find(([fn]) => fn === "serpapi_quota_v2")![1]).toMatchObject({ p_reserve_percent: 0 });
    base.addCalls(4);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit-25")).toEqual({ allowed: false, limit: "day", resumesOn: null });
  });

  it("une recherche servie par le cache, ou en panne, ne compte pas dans les 100", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 95);
    base.addEarlierInMonth(ALICE, 3, { servedFromCache: true });
    base.addEarlierInMonth(ALICE, 2, { failureKind: "provider_error" });
    const counts = await readSearchCounts(base.fastify, base.log as never, ALICE);
    expect(counts.row.user_month_count).toBe(95);
    expect(capacityStatus(counts.row, counts.caps, 1, NOW, counts.tier).monthlyQuota).toMatchObject({ used: 95, remaining: 5 });
  });

  it("une analyse de vidéo qui n'aboutit pas à une recherche ne compte pas : la lecture avant l'IA ne réserve rien", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 99);
    expect(await searchCapacityForVideoAi(base.fastify, base.log as never, ALICE)).toEqual({ allowed: true });
    expect(await searchCapacityForVideoAi(base.fastify, base.log as never, ALICE)).toEqual({ allowed: true });
    expect(base.calls).toHaveLength(0);
    expect(base.rpcCalls.filter(([fn]) => fn === "serpapi_quota_v2").every(([, args]) => args.p_reserve === false)).toBe(true);
    // À 100, l'analyse est refusée avant tout envoi à l'IA (aucune recherche ne pourrait suivre).
    base.addSearches(ALICE, 1, NOW);
    expect(await searchCapacityForVideoAi(base.fastify, base.log as never, ALICE)).toEqual({ allowed: false, limit: "user_month", resumesOn: "2026-12-01" });
  });
});

describe("le mois change à minuit, heure de Paris, y compris aux changements d'heure", () => {
  it("le 1er du mois suivant, vu de Paris", () => {
    expect(nextParisMonthStart(new Date("2026-11-19T12:00:00Z"))).toBe("2026-12-01");
    expect(nextParisMonthStart(new Date("2026-12-31T22:59:59Z"))).toBe("2027-01-01");
    // 31 décembre 23 h 00 UTC = 1er janvier 0 h à Paris.
    expect(nextParisMonthStart(new Date("2026-12-31T23:00:00Z"))).toBe("2027-02-01");
    // Heure d'hiver (depuis le 25 octobre 2026) : le 1er novembre commence à 23 h UTC la veille.
    expect(nextParisMonthStart(new Date("2026-10-31T22:59:59Z"))).toBe("2026-11-01");
    expect(nextParisMonthStart(new Date("2026-10-31T23:00:00Z"))).toBe("2026-12-01");
    // Heure d'été (depuis le 28 mars 2027) : le 1er avril commence à 22 h UTC la veille.
    expect(nextParisMonthStart(new Date("2027-03-31T21:59:59Z"))).toBe("2027-04-01");
    expect(nextParisMonthStart(new Date("2027-03-31T22:00:00Z"))).toBe("2027-05-01");
    expect(parisMidnight("2026-12-01").toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(parisMidnight("2027-04-01").toISOString()).toBe("2027-03-31T22:00:00.000Z");
  });

  it("100 recherches en octobre (heure d'hiver) : refusée le 31 à 23 h 59 (Paris), permise le 1er novembre à 0 h 00 (Paris)", async () => {
    let now = new Date("2026-10-31T22:59:00Z");
    const base = quotaDatabase({ clock: () => now });
    base.addSearches(ALICE, 100, new Date("2026-10-31T22:30:00Z"));
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "fin-octobre")).toEqual({ allowed: false, limit: "user_month", resumesOn: "2026-11-01" });
    now = new Date("2026-10-31T23:00:30Z");
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "debut-novembre")).toMatchObject({ allowed: true });
  });

  it("même chose fin mars (heure d'été) : le 1er avril commence à 22 h UTC", async () => {
    let now = new Date("2027-03-31T21:59:00Z");
    const base = quotaDatabase({ clock: () => now });
    base.addSearches(ALICE, 100, new Date("2027-03-31T21:30:00Z"));
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "fin-mars")).toEqual({ allowed: false, limit: "user_month", resumesOn: "2027-04-01" });
    now = new Date("2027-03-31T22:00:30Z");
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "debut-avril")).toMatchObject({ allowed: true });
  });
});

describe("sans la migration 0053 : exactement comme avant", () => {
  it("serpapi_quota avec ses paramètres d'avant, ni part du mois ni réserve ; journal une seule fois", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase({ migration: false });
    base.entitle(ALICE, "video");
    base.addEarlierInMonth(ALICE, 150);
    base.addCalls(20);
    expect(await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle")).toMatchObject({ allowed: true });
    expect(await reserveSearch(base.fastify, base.log as never, BRUNO, "autre")).toMatchObject({ allowed: true });
    const quotaCalls = base.rpcCalls.filter(([fn]) => fn !== PROBE);
    expect(quotaCalls.map(([fn]) => fn)).toEqual(["serpapi_quota", "serpapi_quota"]);
    expect(quotaCalls[0]![1]).toEqual({
      p_daily_cap: 25,
      p_monthly_cap: 225,
      p_user_daily_cap: 8,
      p_renewal_day: 1,
      p_user_id: ALICE,
      p_reserve: true,
      p_exclude_search: "nouvelle",
    });
    // Aucune lecture des droits : sans 0053, personne n'est abonné.
    expect(base.fake.table("member_entitlements")).toHaveLength(1);
    const absent = base.log.warn.mock.calls.filter(([, message]) => String(message).includes("migration 0053 absente"));
    expect(absent).toHaveLength(1);
    const counts = await readSearchCounts(base.fastify, base.log as never, ALICE);
    expect(counts.tier).toBeNull();
    expect(Object.keys(capacityStatus(counts.row, counts.caps, 1, NOW, counts.tier)).sort()).toEqual(["remainingToday", "service", "user"]);
  });

  it("la sonde est mémorisée une fois vue, refaite au bout de 5 minutes quand elle manque", async () => {
    let clock = 0;
    const base = quotaDatabase({ migration: false });
    expect(await memberQuotasReady(base.fastify, () => clock)).toBe(false);
    clock = 4 * 60_000;
    expect(await memberQuotasReady(base.fastify, () => clock)).toBe(false);
    expect(base.rpcCalls.filter(([fn]) => fn === PROBE)).toHaveLength(1);
    clock = 6 * 60_000;
    await memberQuotasReady(base.fastify, () => clock);
    expect(base.rpcCalls.filter(([fn]) => fn === PROBE)).toHaveLength(2);
  });
});

describe("compteur lu par l'app (GET /api/searches/capacity) : la part du mois", () => {
  async function routeWith(base: ReturnType<typeof quotaDatabase>, userId = ALICE) {
    const app = Fastify({ logger: false });
    app.decorateRequest("user", null);
    app.decorate("supabaseAdmin", base.fastify.supabaseAdmin);
    app.decorate("requireAuth", async (request: FastifyRequest, _reply: FastifyReply) => {
      request.user = { id: userId, email: null };
    });
    app.decorate("rateLimit", () => async () => undefined);
    await app.register(searchCapacityRoutes);
    return app;
  }

  it("compte gratuit : { limit, used, remaining, resetsOn, resetsAt } ; ce qui reste aujourd'hui en tient compte", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 97);
    const app = await routeWith(base);
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.monthlyQuota).toEqual({ limit: 100, used: 97, remaining: 3, resetsOn: "2026-12-01", resetsAt: "2026-11-30T23:00:00.000Z" });
    expect(body.remainingToday).toBe(3);
    expect(parseSearchCapacity(body)?.monthlyQuota).toEqual(body.monthlyQuota);
    await app.close();
  });

  it("abonné sans garde-fou : monthlyQuota null ; rien de son droit d'abonnement dans la réponse", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "miroir", "2027-01-01T00:00:00+00:00");
    base.addEarlierInMonth(ALICE, 140);
    const app = await routeWith(base);
    const response = await app.inject({ method: "GET", url: "/api/searches/capacity" });
    const body = response.json();
    expect(body.monthlyQuota).toBeNull();
    expect(Object.keys(body).sort()).toEqual(["monthlyQuota", "remainingToday", "service", "user"]);
    expect(response.body).not.toMatch(/miroir|video|subscri|abonn|entitlement|2027-01-01|revenuecat/i);
    await app.close();
  });

  it("compte gratuit arrêté par la réserve : le service lui est annoncé en pause ; un abonné le voit ouvert", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(BRUNO, "video");
    base.addCalls(17);
    const free = await (await routeWith(base, ALICE)).inject({ method: "GET", url: "/api/searches/capacity" });
    expect(free.json().service).toEqual({ status: "paused", reason: "day", reopensAt: "2026-11-19T23:00:00.000Z" });
    expect(free.json().remainingToday).toBe(0);
    const subscriber = await (await routeWith(base, BRUNO)).inject({ method: "GET", url: "/api/searches/capacity" });
    expect(subscriber.json().service).toEqual({ status: "open" });
    expect(subscriber.json().remainingToday).toBe(8);
  });
});

describe("alertes au fondateur : la réserve des abonnés atteinte, puis le plafond total", () => {
  it("un compte gratuit arrêté à 70 % : une alerte « reserve_day » par jour ; le plafond total : « day »", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(BRUNO, "video");
    base.addCalls(17);
    await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit-1");
    await reserveSearch(base.fastify, base.log as never, ALICE, "gratuit-2");
    const alerts = () => base.log.warn.mock.calls.filter(([, message]) => message === "Alerte").map(([fields]) => fields);
    expect(alerts()).toEqual([{ alerte: "plafond_recherches", plafond: "reserve_day" }]);
    base.addCalls(8);
    await reserveSearch(base.fastify, base.log as never, BRUNO, "abonne");
    expect(alerts()).toEqual([
      { alerte: "plafond_recherches", plafond: "reserve_day" },
      { alerte: "plafond_recherches", plafond: "day" },
    ]);
  });

  it("le mois : « reserve_month » une fois par cycle ; la part d'une personne n'alerte jamais", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.addCalls(160, new Date("2026-11-03T10:00:00Z"));
    await reserveSearch(base.fastify, base.log as never, ALICE, "a");
    await reserveSearch(base.fastify, base.log as never, ALICE, "b");
    base.addEarlierInMonth(BRUNO, 100);
    base.calls.splice(0);
    await reserveSearch(base.fastify, base.log as never, BRUNO, "c");
    const alerts = base.log.warn.mock.calls.filter(([, message]) => message === "Alerte").map(([fields]) => fields);
    expect(alerts).toEqual([{ alerte: "plafond_recherches", plafond: "reserve_month" }]);
  });
});

describe("confidentialité des droits d'abonnement", () => {
  const SRC = join(__dirname, "../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
    });

  it("aucune route ne permet à un membre d'écrire dans member_entitlements : le serveur ne fait que la lire, à un seul endroit", () => {
    const mentions = files(SRC).filter((path) => readFileSync(path, "utf8").includes("member_entitlements"));
    expect(mentions.map((path) => relative(SRC, path)).sort()).toEqual(["lib/exportData.ts", "lib/memberQuotas.ts"]);
    for (const path of mentions) {
      const source = readFileSync(path, "utf8");
      // Chaque lecture de la table, jusqu'à la fin de son instruction : jamais une écriture.
      for (const match of source.matchAll(/"member_entitlements"/g)) {
        const statement = source.slice(match.index, source.indexOf(";", match.index));
        expect(statement, path).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      }
    }
    for (const path of files(join(SRC, "routes"))) expect(readFileSync(path, "utf8"), path).not.toContain("member_entitlements");
  });

  it("une lecture des droits en échec n'écrit jamais le compte ni le droit dans le journal", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "miroir");
    base.failEntitlementReads();
    await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle");
    const logged = JSON.stringify([...base.log.warn.mock.calls, ...base.log.info.mock.calls, ...base.log.error.mock.calls]);
    expect(logged).not.toContain(ALICE);
    expect(logged).not.toMatch(/miroir|revenuecat/);
  });

  it("la ligne « Plafond recherches » ne dit jamais si la personne est abonnée", async () => {
    settings({ SUBSCRIPTIONS_ENABLED: true });
    const base = quotaDatabase();
    base.entitle(ALICE, "video");
    await reserveSearch(base.fastify, base.log as never, ALICE, "nouvelle");
    const line = base.log.info.mock.calls.find(([, message]) => message === "Plafond recherches")![0] as Row;
    // La part du mois prise, oui ; ni la formule, ni la limite du mois, ni la réserve (elles la trahiraient).
    expect(line).toMatchObject({ userMonth: 1 });
    for (const key of ["subscriber", "userMonthCap", "reserve", "tier"]) expect(Object.keys(line)).not.toContain(key);
    expect(JSON.stringify(line)).not.toMatch(/video|miroir|abonn|subscri/);
  });
});

describe("export des données : le droit d'abonnement, les compteurs du mois, le solde d'essais offerts", () => {
  const spaces = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
  const account = (locale: "fr" | "en", data = fixture()) =>
    spaces(visibleText(sectionHtml(renderExportHtml(data, lookups(), { locale, timeZone: "Europe/Paris", storageOrigin: STORAGE }), "account")));

  it("compteurs du mois (heure de Paris) : recherches comptées comme la base, essais gratuits du mois, essais offerts non expirés", () => {
    const now = new Date("2026-11-01T08:00:00Z");
    const searches = [
      { status: "completed", failure_kind: null, served_from_cache: false, created_at: "2026-10-31T23:30:00+00:00" }, // 1er novembre 0 h 30 à Paris
      { status: "failed", failure_kind: null, served_from_cache: false, created_at: "2026-11-01T07:00:00+00:00" }, // rien trouvé : compte
      { status: "completed", failure_kind: null, served_from_cache: true, created_at: "2026-11-01T07:10:00+00:00" }, // cache : jamais
      { status: "failed", failure_kind: "provider_error", served_from_cache: false, created_at: "2026-11-01T07:20:00+00:00" }, // panne : jamais
      { status: "pending", failure_kind: null, served_from_cache: false, created_at: "2026-11-01T07:30:00+00:00" }, // jamais lancée
      { status: "completed", failure_kind: null, served_from_cache: false, created_at: "2026-10-31T22:30:00+00:00" }, // 31 octobre 23 h 30 à Paris
    ];
    const events = [
      { status: "succeeded", quota_source: "free", month: "2026-11" },
      { status: "succeeded", quota_source: "bonus", month: "2026-11" },
      { status: "succeeded", quota_source: "free", month: "2026-10" },
      { status: "failed", quota_source: null, month: "2026-11" },
    ];
    const grants = [
      { remaining: 4, expires_at: "2027-10-06T18:00:00+00:00" },
      { remaining: 3, expires_at: "2026-10-31T00:00:00+00:00" },
    ];
    expect(monthlyQuotaForExport(searches, events, grants, true, now)).toEqual({ month: "2026-11", searches_counted: 2, tryon_free_used: 1, tryon_bonus_remaining: 4 });
    expect(monthlyQuotaForExport(searches, events, grants, false, now)).toEqual({ month: "2026-11", searches_counted: 2, tryon_free_used: null, tryon_bonus_remaining: null });
  });

  it("fichier lisible : l'abonnement et sa date de fin, les compteurs du mois, en français et en anglais", () => {
    const fr = account("fr");
    expect(fr).toContain("Votre abonnement");
    expect(fr).toContain("Spotto Miroir");
    expect(fr).toContain("Vos compteurs du mois");
    expect(fr).toMatch(/Recherches comptées ce mois-ci\s*37/);
    expect(fr).toMatch(/Essais offerts restants\s*4/);
    const en = account("en");
    expect(en).toContain("Your subscription");
    expect(en).toMatch(/Searches counted this month\s*37/);
    // Sans droit ni compteur (base sans 0053) : rien de plus dans la section.
    const none = { ...fixture(), memberEntitlements: [], monthlyQuota: null };
    expect(account("fr", none)).not.toMatch(/Votre abonnement|Vos compteurs du mois/);
  });

  it("le fichier lisible ne montre ni le compte ni d'où vient le droit (information technique)", () => {
    const fr = account("fr");
    expect(fr).not.toContain("revenuecat");
  });
});

// Les iPhone d'avant ce lot restent longtemps en circulation (lib/clientLevel.ts)
// et ne connaissent pas le code de la part du mois : ils l'expliqueraient par
// « 10 identifications par heure… un peu plus tard ». Seule l'app qui le dit
// (`v=2`) le reçoit ; les autres reçoivent le plafond du mois, qu'elles
// connaissent, avec le 1er du mois suivant, et le compteur le leur annonce
// avant « Lancer ».
describe("une app d'avant ce lot (sans v=2) : un refus et un compteur qu'elle comprend", () => {
  it("le refus : sans v=2, le code du plafond du mois et le 1er du mois suivant ; avec v=2, la part du mois ; les autres refus inchangés", () => {
    const older = capacityReachedBody({ limit: "user_month", resumesOn: "2026-12-01" }, false);
    expect(older).toEqual({ error: SEARCH_CAPACITY_ERRORS.month, message: SEARCH_CAPACITY_MESSAGES.user_month, resumesOn: "2026-12-01" });
    // Ce que l'ancienne app en lit : le plafond du mois et sa date, jamais « trop de recherches d'un coup ».
    expect(parseSearchCapacityError(older)).toEqual({ limit: "month", resumesOn: "2026-12-01" });
    expect(parseSearchMonthlyQuotaError(older)).toBeNull();
    const newer = capacityReachedBody({ limit: "user_month", resumesOn: "2026-12-01" }, true);
    expect(newer).toEqual({ error: SEARCH_MONTHLY_QUOTA_ERROR, message: SEARCH_CAPACITY_MESSAGES.user_month, resumesOn: "2026-12-01" });
    // Date inconnue : le 1er du mois suivant, vu de Paris (le 31 décembre à 23 h 30 UTC, c'est déjà janvier).
    expect(capacityReachedBody({ limit: "user_month", resumesOn: null }, false, new Date("2026-12-31T23:30:00Z")).resumesOn).toBe("2027-02-01");
    for (const capacity of [
      { limit: "day", resumesOn: null },
      { limit: "month", resumesOn: "2026-12-03" },
      { limit: "user", resumesOn: null },
    ] as const) {
      expect(capacityReachedBody(capacity, false), capacity.limit).toEqual(capacityReachedBody(capacity, true));
      expect(capacityReachedBody(capacity, false).error, capacity.limit).toBe(SEARCH_CAPACITY_ERRORS[capacity.limit]);
    }
  });

  it("POST /api/video-moments, 101e recherche du mois : sans v=2, « search_capacity_month » et le 1er décembre ; avec v=2, la part du mois ; rien n'est lu", async () => {
    settings({ ANTHROPIC_API_KEY: "cle-factice-des-tests" });
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 100);
    const app = Fastify({ logger: false });
    app.decorateRequest("user", null);
    app.decorate("supabaseAdmin", base.fastify.supabaseAdmin);
    app.decorate("requireAuth", async (request: FastifyRequest, _reply: FastifyReply) => {
      request.user = { id: ALICE, email: null };
    });
    await app.register(videoMomentsRoutes);
    const older = await app.inject({ method: "POST", url: "/api/video-moments", payload: {} });
    expect(older.statusCode).toBe(429);
    expect(older.json()).toEqual({ error: SEARCH_CAPACITY_ERRORS.month, message: SEARCH_CAPACITY_MESSAGES.user_month, resumesOn: "2026-12-01" });
    const newer = await app.inject({ method: "POST", url: "/api/video-moments?v=2", payload: {} });
    expect(newer.statusCode).toBe(429);
    expect(newer.json()).toEqual({ error: SEARCH_MONTHLY_QUOTA_ERROR, message: SEARCH_CAPACITY_MESSAGES.user_month, resumesOn: "2026-12-01" });
    // Lecture seule : aucune place réservée.
    expect(base.calls).toHaveLength(0);
    await app.close();
  });

  async function capacityRoute(base: ReturnType<typeof quotaDatabase>) {
    const app = Fastify({ logger: false });
    app.decorateRequest("user", null);
    app.decorate("supabaseAdmin", base.fastify.supabaseAdmin);
    app.decorate("requireAuth", async (request: FastifyRequest, _reply: FastifyReply) => {
      request.user = { id: ALICE, email: null };
    });
    app.decorate("rateLimit", () => async () => undefined);
    await app.register(searchCapacityRoutes);
    return app;
  }

  it("le compteur, part du mois épuisée : sans v=2, Spotter annoncé en pause jusqu'au 1er décembre (« Lancer » désactivé) ; avec v=2, la part du mois", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 100);
    const app = await capacityRoute(base);
    const older = (await app.inject({ method: "GET", url: "/api/searches/capacity" })).json();
    expect(older.service).toEqual({ status: "paused", reason: "month", reopensAt: "2026-11-30T23:00:00.000Z" });
    expect(older.remainingToday).toBe(0);
    // La part du jour, elle, n'est pas prise : seule la pause du mois explique le refus.
    expect(older.user.remaining).toBe(8);
    const newer = (await app.inject({ method: "GET", url: "/api/searches/capacity?v=2" })).json();
    expect(newer.service).toEqual({ status: "open" });
    expect(newer.monthlyQuota).toMatchObject({ limit: 100, used: 100, remaining: 0, resetsOn: "2026-12-01" });
    expect(newer.remainingToday).toBe(0);
    await app.close();
  });

  it("le compteur, part du mois pas épuisée, abonné, ou base sans 0053 : la même réponse pour les deux apps", async () => {
    const base = quotaDatabase();
    base.addEarlierInMonth(ALICE, 97);
    const app = await capacityRoute(base);
    const older = (await app.inject({ method: "GET", url: "/api/searches/capacity" })).json();
    expect(older).toEqual((await app.inject({ method: "GET", url: "/api/searches/capacity?v=2" })).json());
    expect(older.service).toEqual({ status: "open" });
    await app.close();
    const open: SearchCapacityStatus = { user: { used: 2, limit: 8, remaining: 6, resetsAt: "2026-11-19T23:00:00.000Z" }, service: { status: "open" }, remainingToday: 6 };
    expect(capacityForOlderApp(open)).toBe(open);
    expect(capacityForOlderApp({ ...open, monthlyQuota: null })).toEqual({ ...open, monthlyQuota: null });
  });

  it("service déjà fermé plus longtemps que la part du mois : la date la plus lointaine est gardée", () => {
    const quota = { limit: 100, used: 100, remaining: 0, resetsOn: "2026-12-01", resetsAt: "2026-11-30T23:00:00.000Z" };
    const user = { used: 0, limit: 8, remaining: 8, resetsAt: "2026-11-19T23:00:00.000Z" };
    const later: SearchCapacityStatus = { user, service: { status: "paused", reason: "month", reopensAt: "2026-12-02T23:00:00.000Z" }, remainingToday: 0, monthlyQuota: quota };
    expect(capacityForOlderApp(later).service).toEqual({ status: "paused", reason: "month", reopensAt: "2026-12-02T23:00:00.000Z" });
    const tonight: SearchCapacityStatus = { ...later, service: { status: "paused", reason: "day", reopensAt: "2026-11-19T23:00:00.000Z" } };
    expect(capacityForOlderApp(tonight).service).toEqual({ status: "paused", reason: "month", reopensAt: "2026-11-30T23:00:00.000Z" });
  });
});
