import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateWishAlertResponse, WishAlertState, WishAlertStatesList, WishAlertsStatus } from "@monapp/shared-types";

// Alertes prix et stock (lot 2, migration 0036), SANS base ni réseau : les
// vraies routes (cloche, interrupteur, « Plus disponible », création d'une
// envie, appareils des notifications) sur une fausse base en mémoire
// (tests/fakeSupabase.ts). Les fonctions de la base (wish_stock_report…) sont
// imitées ici ; leur vraie logique est vérifiée sur la base de développement
// (alertesPrix.test.ts). Boutiques et pièces fictives.

vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: undefined } };
});
vi.mock("../src/lib/ownMatches.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/ownMatches.js")>();
  return { ...original, findOwnMatch: vi.fn() };
});

import rateLimitPlugin from "../src/plugins/rateLimit.js";
import wishlistRoutes from "../src/routes/wishlist.js";
import wishAlertsRoutes from "../src/routes/wishAlerts.js";
import pushTokensRoutes from "../src/routes/pushTokens.js";
import accountRoutes from "../src/routes/account.js";
import moderationPlugin from "../src/plugins/moderation.js";
import { findOwnMatch } from "../src/lib/ownMatches.js";
import { env } from "../src/env.js";
import { resetPushProbe } from "../src/lib/push.js";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";
import { backfillWishTracking, forgetPurchase, markPurchase } from "../src/lib/wishAlerts.js";
import { resetWishAlertsProbe, wishAlertsReady, wishAlertsSchemaState } from "../src/lib/wishAlertsSchema.js";
import { WISHLIST_ITEMS_MAX } from "@monapp/shared-types";
import { readFileSync } from "node:fs";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { join } from "node:path";

const ownMatchMock = vi.mocked(findOwnMatch);

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const MATCH = "f0000000-0000-4000-8000-000000000007";
const OLD_WISH = "e0000000-0000-4000-8000-000000000008";
// Un membre à part pour la limite en mémoire (compteurs gardés d'un test à l'autre).
const CAROL = "c0000000-0000-4000-8000-00000000000c";
const CAROL_WISH = "e0000000-0000-4000-8000-0000000000c1";
const CAROL_AMAZON = "e0000000-0000-4000-8000-0000000000c2";
const SHOP_URL = "https://boutique-exemple.fr/vestes/nuage-07?couleur=bleu&utm_source=google";
const KEY = trackingKeyOf(SHOP_URL, "Boutique Exemple")!;
const PHONE = "ExponentPushToken[alicePhoneAlicePhone01]";
const TABLET = "ExponentPushToken[aliceTabletAliceTabl02]";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

interface Setup {
  /** La base a la migration 0036 (sonde wish_alerts_version). */
  migrated?: boolean;
  /** La base n'a pas la migration 0035 (table push_tokens absente). */
  without0035?: boolean;
  /** Réponse de wish_stock_report. */
  reportAllowed?: boolean;
  /** Réponse de la sonde wish_alerts_version : 3 avec 0041, 2 avec 0040 seule, 1 avec 0036 seule. */
  version?: number;
  /** wish_mark_bought refusé par la base. */
  markBoughtFails?: boolean;
}

let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

function seeded(setup: Setup = {}) {
  const migrated = setup.migrated ?? true;
  const rpc: Rpc = async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (!migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
    if (fn === "wish_alerts_version") return { data: setup.version ?? 3, error: null };
    if (fn === "wish_stock_report") return { data: [{ allowed: setup.reportAllowed ?? true, matched: 2 }], error: null };
    if (fn === "wish_mark_bought") return setup.markBoughtFails ? { data: null, error: { code: "57014", message: "délai dépassé" } } : { data: 1, error: null };
    return { data: null, error: { code: "PGRST202", message: "absente" } };
  };
  const fake = fakeSupabase({ rpc, ...(setup.without0035 ? { missing: ["push_tokens"] } : {}) });
  fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr", price_alerts_enabled: false, help_others: true }, { id: BOB, username: "bob", locale: "fr", price_alerts_enabled: false, help_others: true });
  // La proposition d'origine, telle que le SERVEUR l'a rangée (prix en symbole, comme Lens).
  fake.table("product_matches").push({ id: MATCH, price_min: "120.00", currency: "€  ", merchant_name: "Boutique Exemple", merchant_url: SHOP_URL, created_at: "2026-11-08T23:30:00+00:00" });
  // Une envie d'avant 0036, sans suivi.
  fake.table("wishlist_items").push({
    id: OLD_WISH,
    user_id: ALICE,
    title: "Ancienne envie",
    image_url: "https://images.example/ancienne.jpg",
    price_min: null,
    currency: "EUR",
    merchant_name: "Boutique Exemple",
    merchant_url: SHOP_URL,
    product_match_id: null,
    created_at: "2026-10-01T10:00:00+00:00",
  });
  return fake;
}

let app: FastifyInstance | null = null;
let logs: string[] = [];

async function alertsApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => void logs.push(line) },
      serializers: { req: requestLogFields },
      formatters: { log: withoutErrorDetails },
      hooks: { streamWrite: scrubLogLine },
    },
  });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: null };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(accountRoutes);
  await app.register(wishlistRoutes);
  await app.register(wishAlertsRoutes);
  await app.register(pushTokensRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string, language = "fr-FR") {
  const headers = { "x-test-user": user, "accept-language": language };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
  };
}

async function newWish(target: FastifyInstance, body: Record<string, unknown>, user: string = ALICE, language = "fr-FR"): Promise<string> {
  const res = await as(target, user, language).post("/api/wishlist", { title: "Veste Nuage 07", imageUrl: "https://images.example/veste.jpg", ...body });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

beforeEach(() => {
  resetWishAlertsProbe();
  resetPushProbe();
  env.PUSH_ENABLED = true;
  rpcCalls = [];
  logs = [];
  ownMatchMock.mockReset();
  ownMatchMock.mockResolvedValue({ id: MATCH, imageUrl: "https://images.example/veste.jpg", merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" });
});

afterEach(async () => {
  await app?.close();
  app = null;
  resetWishAlertsProbe();
});

describe("sans la migration 0036 : tout se tait, l'app cache tout", () => {
  it("GET /api/alerts/status répond tout faux ; les autres routes : 404 « alerts_unavailable » ; une envie est créée sans suivi", async () => {
    const fake = seeded({ migrated: false });
    const target = await alertsApp(fake.db);
    const status = await as(target, ALICE).get("/api/alerts/status");
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ available: false, enabled: false, helpOthers: true, push: false } satisfies WishAlertsStatus);
    for (const res of [
      await as(target, ALICE).put("/api/alerts/settings", { enabled: true }),
      await as(target, ALICE).get("/api/alerts/wishes"),
      await as(target, ALICE).get(`/api/wishlist/${OLD_WISH}/alerts`),
      await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: false }),
      await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "alerts_unavailable" });
    }
    await newWish(target, { productMatchId: MATCH });
    expect(fake.table("wish_tracking")).toHaveLength(0);
    expect(fake.table("wish_watches")).toHaveLength(0);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.price_alerts_enabled).toBe(false);
  });

  it("appareil des notifications : « messages: true » enregistré comme avant (colonnes absentes) ; « messages: false » l'oublie, comme avant 0036 (jamais gardé avec les messages)", async () => {
    const fake = seeded({ migrated: false });
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: true, alerts: true })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([expect.not.objectContaining({ notify_messages: expect.anything(), notify_alerts: expect.anything() })]);
    // Messages coupés : sans 0036, l'appareil ne peut pas être gardé pour les seules alertes.
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: false, alerts: true })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([]);
  });

  it("base qui ne répond pas à la sonde (ni présente ni absente) : « messages: false » oublie l'appareil, un autre choix est refusé (500), jamais perdu en silence", async () => {
    const fake = fakeSupabase({ rpc: async () => ({ data: null, error: { code: "57014", message: "délai dépassé" } }) });
    fake.table("push_tokens").push({ token: PHONE, user_id: ALICE, platform: "ios", notify_messages: true, notify_alerts: true });
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: true, alerts: false })).statusCode).toBe(500);
    expect(fake.table("push_tokens")).toEqual([expect.objectContaining({ token: PHONE, notify_messages: true, notify_alerts: true })]);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: false, alerts: true })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([]);
  });
});

// Lot « durcissement des alertes » (revue de sécurité) puis nouvelle version
// (0041) : 0036 seule (sonde à 1) ou avec 0040 sans 0041 (sonde à 2) vaut
// « alertes indisponibles » ; les colonnes de 0036 (ce que reçoit chaque
// appareil) restent utilisées.
describe("avec 0036 ou 0040 sans 0041 (nouvelle version absente) : les alertes se taisent", () => {
  it.each([1, 2])("sonde à %i : état tout faux, routes 404, envie créée sans suivi, et le journal le dit ; l'appareil gardé pour les seules alertes reste possible", async (version) => {
    const fake = seeded({ version });
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).get("/api/alerts/status")).json()).toEqual({ available: false, enabled: false, helpOthers: true, push: false } satisfies WishAlertsStatus);
    for (const res of [
      await as(target, ALICE).put("/api/alerts/settings", { enabled: true }),
      await as(target, ALICE).get("/api/alerts/wishes"),
      await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: false }),
      await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "alerts_unavailable" });
    }
    await newWish(target, { productMatchId: MATCH });
    expect(fake.table("wish_tracking")).toHaveLength(0);
    expect(rpcCalls.map((call) => call.fn).filter((fn) => fn !== "wish_alerts_version")).toEqual([]);
    expect(logs.join("\n")).toContain("Alertes prix coupées : version de la migration 0041 absente");
    // Les colonnes de 0036 sont là : « messages: false » garde l'appareil pour les alertes.
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: false, alerts: true })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([expect.objectContaining({ token: PHONE, notify_messages: false, notify_alerts: true })]);
  });

  it("0041 appliquée ensuite : vue au plus tard 5 minutes après (sonde refaite)", async () => {
    let version = 2;
    const fake = fakeSupabase({ rpc: async (fn) => (fn === "wish_alerts_version" ? { data: version, error: null } : { data: null, error: { code: "PGRST202", message: "absente" } }) });
    const server = { supabaseAdmin: fake.db, log: { warn: () => {}, info: () => {} } } as unknown as Pick<FastifyInstance, "supabaseAdmin" | "log">;
    let clock = 1_000_000;
    const now = () => clock;
    expect(await wishAlertsReady(server, now)).toBe(false);
    expect(await wishAlertsSchemaState(server, now)).toBe("ready");
    version = 3;
    clock += 60_000;
    expect(await wishAlertsReady(server, now)).toBe(false);
    clock += 5 * 60_000;
    expect(await wishAlertsReady(server, now)).toBe(true);
    // Vue une fois : gardée (plus aucune sonde).
    version = 1;
    clock += 60 * 60_000;
    expect(await wishAlertsReady(server, now)).toBe(true);
  });
});

describe("pays de la personne sur le suivi (entrees-08)", () => {
  it("gardé à la création, seulement pour un pays pris en charge par les alertes ; le rattrapage donne « fr » aux membres francophones", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const british = await newWish(target, { merchantUrl: "https://boutique-exemple.fr/a", merchantName: "Boutique Exemple" }, ALICE, "en-GB");
    const kiwi = await newWish(target, { merchantUrl: "https://boutique-exemple.fr/b", merchantName: "Boutique Exemple" }, ALICE, "en-NZ");
    const countryOf = (id: string) => fake.table("wish_tracking").find((row) => row.wishlist_item_id === id)?.member_country;
    expect(countryOf(british)).toBe("gb");
    // Région non prise en charge : la recherche garde « nz », mais aucun pays n'est gardé pour les alertes.
    expect(countryOf(kiwi) ?? null).toBeNull();
    // Le rattrapage (envies d'avant) : « fr » pour un membre francophone (la recherche se fait alors toujours en France),
    // aucun pays pour un membre anglophone (sa région n'est pas connue ici).
    fake.table("wish_tracking").length = 0;
    fake.table("profiles").find((row) => row.id === BOB)!.locale = "en";
    fake.table("wishlist_items").push({ id: "e0000000-0000-4000-8000-0000000000b9", user_id: BOB, title: "Sac", image_url: "https://images.example/sac.jpg", merchant_url: "https://boutique-exemple.fr/sac", merchant_name: "Boutique Exemple", product_match_id: null, created_at: "2026-11-01T10:00:00+00:00" });
    await backfillWishTracking(target);
    const tracked = fake.table("wish_tracking");
    expect(tracked.filter((row) => row.user_id === ALICE).length).toBeGreaterThan(0);
    expect(tracked.filter((row) => row.user_id === ALICE).every((row) => row.member_country === "fr")).toBe(true);
    expect(tracked.filter((row) => row.user_id === BOB).every((row) => (row.member_country ?? null) === null)).toBe(true);
  });
});

describe("plafond d'envies par membre (entrees-07, alertes-02)", () => {
  function fill(fake: ReturnType<typeof seeded>, count: number, matchId: string | null = null) {
    for (let index = fake.table("wishlist_items").filter((row) => row.user_id === BOB).length; index < count; index += 1) {
      fake.table("wishlist_items").push({ id: `e1000000-0000-4000-8000-${String(index).padStart(12, "0")}`, user_id: BOB, title: "x", image_url: "https://images.example/x.jpg", merchant_url: SHOP_URL, product_match_id: index === 0 ? matchId : null, created_at: "2026-11-01T10:00:00+00:00" });
    }
  }

  it(`au-delà de ${WISHLIST_ITEMS_MAX} envies : 409 « wishlist_full », en français et en anglais, rien n'est créé ni suivi`, async () => {
    const fake = seeded();
    fill(fake, WISHLIST_ITEMS_MAX - 1);
    const target = await alertsApp(fake.db);
    await newWish(target, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" }, BOB);
    const before = fake.table("wishlist_items").length;
    const refused = await as(target, BOB).post("/api/wishlist", { title: "Une de trop", imageUrl: "https://images.example/x.jpg", merchantUrl: SHOP_URL });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "wishlist_full", message: `Vous avez déjà ${WISHLIST_ITEMS_MAX} envies : retirez-en une pour en garder une autre.` });
    expect(fake.table("wishlist_items")).toHaveLength(before);
    expect(fake.table("wish_tracking").filter((row) => row.user_id === BOB)).toHaveLength(1);
  });

  it("garder de nouveau une proposition déjà gardée reste permis (rien n'est créé) ; les autres membres ne sont pas touchés", async () => {
    const fake = seeded();
    fill(fake, WISHLIST_ITEMS_MAX, MATCH);
    ownMatchMock.mockResolvedValue({ id: MATCH, imageUrl: "https://images.example/veste.jpg", merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" });
    const target = await alertsApp(fake.db);
    expect((await as(target, BOB).post("/api/wishlist", { title: "Veste", imageUrl: "https://images.example/x.jpg", productMatchId: MATCH })).statusCode).toBe(200);
    expect(fake.table("wishlist_items").filter((row) => row.user_id === BOB)).toHaveLength(WISHLIST_ITEMS_MAX);
    await newWish(target, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" }, ALICE);
  });
});

describe("oublier un appareil par son seul jeton, sans session (alertes-03, app-06)", () => {
  const forget = (target: FastifyInstance, payload: object, ip = "203.0.113.7") =>
    target.inject({ method: "POST", url: "/api/push-token/forget", payload, remoteAddress: ip });

  it("204, et seules les lignes de ce jeton partent, quel que soit le compte ; un jeton inconnu : la même réponse", async () => {
    const fake = seeded();
    fake.table("push_tokens").push({ token: PHONE, user_id: ALICE, platform: "ios" }, { token: TABLET, user_id: BOB, platform: "ios" });
    const target = await alertsApp(fake.db);
    const known = await forget(target, { token: PHONE });
    expect(known.statusCode).toBe(204);
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([TABLET]);
    const unknown = await forget(target, { token: "ExponentPushToken[inconnuInconnuInconnu]" });
    expect([unknown.statusCode, unknown.body]).toEqual([known.statusCode, known.body]);
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([TABLET]);
    // Jeton mal formé : refusé, sans rien toucher.
    expect((await forget(target, { token: "pas-un-jeton" })).statusCode).toBe(400);
    expect(fake.table("push_tokens")).toHaveLength(1);
  });

  it("limite par appareil (jamais par adresse IP, souvent commune chez l'hébergeur) : au-delà de 10 par heure pour un même jeton, 429 ; un autre appareil, même depuis la même adresse, n'est pas touché", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      // Même adresse pour tout le monde, comme derrière le relais de l'hébergeur.
      const relay = "10.0.0.1";
      for (let index = 0; index < 10; index += 1) expect((await forget(target, { token: TABLET }, relay)).statusCode).toBe(204);
      const limited = await forget(target, { token: TABLET }, relay);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: "push_token_forget_limit" });
      // Changer d'adresse ne contourne pas la limite de cet appareil…
      expect((await forget(target, { token: TABLET }, "198.51.100.43")).statusCode).toBe(429);
      // … et un autre appareil, derrière la même adresse, oublie normalement.
      expect((await forget(target, { token: PHONE }, relay)).statusCode).toBe(204);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  it("plafond commun large pour tout le service, et jamais le jeton dans la clé de la limite", () => {
    expect(RATE_LIMITS.pushTokenForget).toMatchObject({ max: 10, windowMs: 60 * 60 * 1000 });
    expect(RATE_LIMITS.pushTokenForgetGlobal).toMatchObject({ max: 3000, scope: "global" });
    const route = readFileSync(join(__dirname, "../src/routes/pushTokens.ts"), "utf8");
    expect(route).toContain('createHash("sha256").update(body.token)');
    expect(route).not.toMatch(/consumeRateLimitFor\(body\.token/);
  });

  it("sans la migration 0035 : 204, rien à oublier", async () => {
    const fake = seeded({ without0035: true });
    const target = await alertsApp(fake.db);
    expect((await forget(target, { token: PHONE }, "192.0.2.9")).statusCode).toBe(204);
  });
});

describe("« Je l'ai achetée » : toutes les envies de la même pièce (alertes-04)", () => {
  const server = (fake: ReturnType<typeof seeded>) => ({ supabaseAdmin: fake.db, log: { warn: () => {}, info: () => {} } }) as unknown as FastifyInstance;
  const silent = { warn: () => {} } as unknown as FastifyInstance["log"];

  it("markPurchase : la clé de la pièce achetée part à wish_mark_bought (la personne, l'empreinte, la boutique) ; refus de la base : false", async () => {
    const fake = seeded();
    expect(await markPurchase(server(fake), silent, ALICE, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" })).toBe(true);
    expect(rpcCalls.filter((call) => call.fn === "wish_mark_bought")).toEqual([{ fn: "wish_mark_bought", args: { p_user_id: ALICE, p_key: KEY.hash, p_merchant: KEY.merchant, p_bought: true } }]);
    // Sans clé (place de marché…) : rien à noter, l'achat continue.
    rpcCalls = [];
    expect(await markPurchase(server(fake), silent, ALICE, { merchantUrl: "pas une adresse", merchantName: null })).toBe(true);
    expect(rpcCalls.filter((call) => call.fn === "wish_mark_bought")).toEqual([]);
    resetWishAlertsProbe();
    expect(await markPurchase(server(seeded({ markBoughtFails: true })), silent, ALICE, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" })).toBe(false);
  });

  it("forgetPurchase : la pièce quitte le Vault — remise seulement si aucune autre pièce du Vault n'a la même empreinte", async () => {
    const OTHER = "f0000000-0000-4000-8000-000000000009";
    const fake = seeded();
    fake.table("product_matches").push({ id: OTHER, merchant_name: "Boutique Exemple", merchant_url: "https://www.boutique-exemple.fr/vestes/nuage-07?couleur=bleu", created_at: "2026-11-10T10:00:00+00:00" });
    // Une autre pièce du Vault, rangée avec une autre proposition de la même pièce.
    fake.table("vault_items").push({ id: "v1", user_id: ALICE, product_match_id: OTHER });
    await forgetPurchase(server(fake), silent, ALICE, MATCH);
    expect(rpcCalls.filter((call) => call.fn === "wish_mark_bought")).toEqual([]);
    fake.table("vault_items").length = 0;
    await forgetPurchase(server(fake), silent, ALICE, MATCH);
    expect(rpcCalls.filter((call) => call.fn === "wish_mark_bought")).toEqual([{ fn: "wish_mark_bought", args: { p_user_id: ALICE, p_key: KEY.hash, p_merchant: KEY.merchant, p_bought: false } }]);
  });

  it("la cloche d'une envie notée achetée (bought_on) est cachée, et ne peut pas être allumée", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" });
    fake.table("wish_tracking").find((row) => row.wishlist_item_id === id)!.bought_on = "2026-11-13";
    expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toMatchObject({ bought: true });
    expect((await as(target, ALICE).get("/api/alerts/wishes")).json().items.find((state: WishAlertState) => state.wishlistItemId === id)).toMatchObject({ bought: true });
    const refused = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true });
    expect(refused.statusCode).toBe(422);
  });
});

// Registre des migrations (supabase/REGISTRE-MIGRATIONS.md) : le serveur
// fonctionne avec ou sans 0035, avec ou sans PUSH_ENABLED, avec ou sans 0036.
// Les huit combinaisons, vues par l'app : l'état des alertes (ce qui montre
// ou cache la cloche, l'interrupteur et « Plus disponible »), l'appareil des
// notifications, le suivi d'une envie et sa cloche. La première est celle
// de la production tant que 0035 et 0036 sont « à appliquer » et que
// l'interrupteur est coupé. 0036 refuse de s'appliquer sans 0035
// (alertesPrixMigration.test.ts) : les deux dernières ne peuvent pas
// exister ; le serveur tient quand même. Les messages, l'export et la
// suppression du compte : notificationsTelephone.test.ts.
describe("avec ou sans 0035, PUSH_ENABLED et 0036 (registre des migrations)", () => {
  // [nom, 0035 présente, interrupteur PUSH_ENABLED allumé, 0036 présente]
  it.each<[string, boolean, boolean, boolean]>([
    ["sans 0035, interrupteur coupé, sans 0036 : ni appareil, ni cloche", false, false, false],
    ["sans 0035, interrupteur allumé, sans 0036 : ni appareil, ni cloche", false, true, false],
    ["avec 0035, interrupteur coupé, sans 0036 : ni appareil, ni cloche", true, false, false],
    ["avec 0035, interrupteur allumé, sans 0036 : l'appareil est enregistré, pas de cloche", true, true, false],
    ["avec 0035, interrupteur coupé, avec 0036 : la cloche est enregistrée, sans appareil ni notification", true, false, true],
    ["avec 0035, interrupteur allumé, avec 0036 : l'appareil et la cloche", true, true, true],
    ["sans 0035, interrupteur coupé, avec 0036 (ordre refusé par la migration) : la cloche, sans appareil", false, false, true],
    ["sans 0035, interrupteur allumé, avec 0036 (ordre refusé par la migration) : la cloche, sans appareil", false, true, true],
  ])("%s", async (_name, with0035, pushOn, with0036) => {
    env.PUSH_ENABLED = pushOn;
    const fake = seeded({ migrated: with0036, without0035: !with0035 });
    const target = await alertsApp(fake.db);
    // Une notification n'est possible qu'avec 0035 ET l'interrupteur.
    const push = with0035 && pushOn;

    const status = await as(target, ALICE).get("/api/alerts/status");
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ available: with0036, enabled: false, helpOthers: true, push: with0036 && push } satisfies WishAlertsStatus);

    // L'appareil : enregistré seulement si une notification est possible.
    const device = await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: true, alerts: with0036 });
    expect(device.statusCode).toBe(push ? 204 : 404);
    expect(fake.table("push_tokens")).toHaveLength(push ? 1 : 0);

    // Garder une envie marche toujours ; son suivi et sa cloche n'existent qu'avec 0036.
    const id = await newWish(target, { productMatchId: MATCH });
    const bell = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false, enableAlerts: true });
    if (with0036) {
      expect(bell.statusCode).toBe(200);
      expect(bell.json().status).toEqual({ available: true, enabled: true, helpOthers: true, push } satisfies WishAlertsStatus);
    } else {
      expect(bell.statusCode).toBe(404);
      expect(bell.json()).toMatchObject({ error: "alerts_unavailable" });
    }
    expect([fake.table("wish_tracking").length, fake.table("wish_watches").length]).toEqual(with0036 ? [1, 1] : [0, 0]);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.price_alerts_enabled).toBe(with0036);
  });
});

describe("création d'une envie : le suivi (chaque chemin, une seule fois)", () => {
  it("depuis un résultat : empreinte de la pièce, et dernier prix vu relu dans la base (jamais celui envoyé par l'app), daté du jour de Paris de la recherche", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    // L'app envoie un autre prix et une autre devise : ignorés pour la référence.
    const id = await newWish(target, { productMatchId: MATCH, priceMin: 1, currency: "USD", merchantName: "Autre nom" });
    expect(fake.table("wish_tracking")).toEqual([
      {
        wishlist_item_id: id,
        user_id: ALICE,
        match_key_hash: KEY.hash,
        key_version: 2,
        merchant_key: "boutiqueexemple",
        // 0041 : le prix de la proposition d'origine est le dernier prix vu
        // (il pré-remplit le seuil de la cloche) ; plus de prix de référence.
        last_price: 120,
        last_currency: "EUR",
        last_country: "fr",
        // 23 h 30 UTC le 8 novembre : déjà le 9 à Paris.
        last_seen_on: "2026-11-09",
        // Migration 0040 : le pays de la personne (sa recherche), gardé sur le suivi.
        member_country: "fr",
        stock_state: "unknown",
      },
    ]);
    // La même envie gardée deux fois : un seul suivi.
    await newWish(target, { productMatchId: MATCH });
    expect(fake.table("wish_tracking")).toHaveLength(1);
    // Jamais l'adresse dans le suivi.
    expect(JSON.stringify(fake.table("wish_tracking"))).not.toContain("boutique-exemple.fr");
  });

  it("envie à la main : empreinte de la pièce, aucun prix ; devise inconnue (ou d'un autre pays) de la proposition : aucun prix", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const manual = await newWish(target, { merchantUrl: "https://boutique-exemple.fr/sacs/cabas", merchantName: "Boutique Exemple", priceMin: 80 });
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === manual)).toEqual({
      wishlist_item_id: manual,
      user_id: ALICE,
      match_key_hash: trackingKeyOf("https://boutique-exemple.fr/sacs/cabas", "Boutique Exemple")!.hash,
      key_version: 2,
      merchant_key: "boutiqueexemple",
      member_country: "fr",
      stock_state: "unknown",
    });
    for (const currency of ["$", "£"]) {
      fake.table("product_matches")[0]!.currency = currency;
      fake.table("wishlist_items").length = 1;
      fake.table("wish_tracking").length = 0;
      await newWish(target, { productMatchId: MATCH });
      expect(fake.table("wish_tracking")[0], currency).not.toHaveProperty("last_price");
    }
  });
});

describe("la cloche d'une envie", () => {
  it("première cloche avec enableAlerts : la cloche est enregistrée et l'interrupteur s'allume ; tout coupé : la cloche est retirée", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    const res = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true, enableAlerts: true });
    expect(res.statusCode).toBe(200);
    const body: UpdateWishAlertResponse = res.json();
    expect(body).toEqual({
      state: {
        wishlistItemId: id,
        trackable: true,
        bought: false,
        priceDrop: true,
        restock: true,
        soldOut: false,
        stock: "unknown",
        // Le seuil, pré-rempli avec le dernier prix vu (pays et devise du membre).
        targetPrice: 120,
        targetCurrency: "EUR",
        lastPrice: 120,
        lastCurrency: "EUR",
      },
      status: { available: true, enabled: true, helpOthers: true, push: true },
    } satisfies UpdateWishAlertResponse);
    expect(fake.table("wish_watches")).toEqual([
      expect.objectContaining({ wishlist_item_id: id, user_id: ALICE, notify_price_drop: true, notify_restock: true, notify_sold_out: false, target_price: 120, target_currency: "EUR", target_country: "fr", below_target: false }),
    ]);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.price_alerts_enabled).toBe(true);
    // Lire la cloche, et toutes les cloches.
    expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toEqual(body.state);
    const list: WishAlertStatesList = (await as(target, ALICE).get("/api/alerts/wishes")).json();
    expect(list.items).toContainEqual(body.state);
    // Tout coupé : la cloche part, l'interrupteur reste.
    const off = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: false, restock: false });
    expect(off.json().state).toMatchObject({ priceDrop: false, restock: false, soldOut: false });
    expect(fake.table("wish_watches")).toHaveLength(0);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.price_alerts_enabled).toBe(true);
  });

  it("l'état de stock en direct (décision du fondateur), mais jamais qui a signalé, cherché ou acheté la pièce", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true, enableAlerts: true });
    // Bob a la même pièce dans ses envies, et la signale « Plus disponible ».
    const bobWish = await newWish(target, { productMatchId: MATCH }, BOB);
    expect((await as(target, BOB).post("/api/alerts/stock-reports", { wishlistItemId: bobWish })).statusCode).toBe(204);
    // La base passe la pièce « épuisée » (wish_stock_report) : Alice le voit tout de suite.
    Object.assign(fake.table("wish_tracking").find((row) => row.wishlist_item_id === id)!, { stock_state: "sold_out", stock_on: "2026-11-09" });
    const reads = [
      (await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json(),
      ((await as(target, ALICE).get("/api/alerts/wishes")).json() as WishAlertStatesList).items.find((item) => item.wishlistItemId === id),
      (await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true })).json().state,
    ];
    for (const state of reads) expect(state).toMatchObject({ wishlistItemId: id, stock: "sold_out" });
    // Jamais Bob : ni son compte, ni son envie.
    expect(JSON.stringify(reads)).not.toContain(BOB);
    expect(JSON.stringify(reads)).not.toContain(bobWish);
  });

  it("pièce déjà dans votre Vault : `bought`, et pas de cloche (422 « alert_wish_bought ») — aucune alerte ne partirait", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toMatchObject({ trackable: true, bought: false });
    fake.table("vault_items").push({ id: "0a000000-0000-4000-8000-000000000001", user_id: ALICE, product_match_id: MATCH });
    expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toMatchObject({ trackable: true, bought: true });
    expect(((await as(target, ALICE).get("/api/alerts/wishes")).json() as WishAlertStatesList).items.find((item) => item.wishlistItemId === id)).toMatchObject({ bought: true });
    const res = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "alert_wish_bought" });
    expect(fake.table("wish_watches")).toHaveLength(0);
    // Le Vault d'un AUTRE membre ne compte pas.
    fake.table("vault_items").length = 0;
    fake.table("vault_items").push({ id: "0a000000-0000-4000-8000-000000000002", user_id: BOB, product_match_id: MATCH });
    expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toMatchObject({ bought: false });
    // Couper une cloche reste toujours permis.
    expect((await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: false, restock: false })).statusCode).toBe(200);
  });

  it("envie d'avant 0036 : son suivi est créé à la première lecture de la cloche", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const res = await as(target, ALICE).get(`/api/wishlist/${OLD_WISH}/alerts`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      wishlistItemId: OLD_WISH,
      trackable: true,
      bought: false,
      priceDrop: false,
      restock: false,
      soldOut: false,
      stock: "unknown",
      targetPrice: null,
      // Suivi sans pays : la devise du pays de la recherche en cours (France), comme à l'enregistrement.
      targetCurrency: "EUR",
      lastPrice: null,
      lastCurrency: null,
    } satisfies WishAlertState);
    expect(fake.table("wish_tracking")).toEqual([expect.objectContaining({ wishlist_item_id: OLD_WISH, match_key_hash: KEY.hash })]);
    // Depuis une région que les alertes ne prennent pas en charge : aucune devise, donc pas de champ de seuil.
    expect((await as(target, ALICE, "en-NZ").get(`/api/wishlist/${OLD_WISH}/alerts`)).json()).toMatchObject({ targetCurrency: null });
    expect((await as(target, ALICE, "en-GB").get("/api/alerts/wishes")).json().items.find((state: WishAlertState) => state.wishlistItemId === OLD_WISH)).toMatchObject({ targetCurrency: "GBP" });
  });

  it("envie d'avant 0036 gardée depuis un résultat : suivi créé SANS prix, comme au rattrapage (le pays de sa recherche n'est connu nulle part)", async () => {
    const fake = seeded();
    fake.table("wishlist_items")[0]!.product_match_id = MATCH;
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).get(`/api/wishlist/${OLD_WISH}/alerts`)).statusCode).toBe(200);
    const [row] = fake.table("wish_tracking");
    expect(row).toMatchObject({ wishlist_item_id: OLD_WISH, match_key_hash: KEY.hash });
    expect(row).not.toHaveProperty("last_price");
    // Le rattrapage, passé ensuite, ne change rien : même résultat, quel que soit l'ordre.
    expect(await backfillWishTracking(target)).toMatchObject({ created: 0, unchanged: 1 });
  });

  it("proposition rangée avant le 4 novembre 2026 (« EUR » par défaut quand la devise manquait) : jamais de dernier prix vu", async () => {
    const fake = seeded();
    fake.table("product_matches")[0]!.created_at = "2026-11-02T10:00:00+00:00";
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    const row = fake.table("wish_tracking").find((tracking) => tracking.wishlist_item_id === id)!;
    expect(row).toMatchObject({ match_key_hash: KEY.hash });
    expect(row).not.toHaveProperty("last_price");
  });

  it("pièce sans empreinte (page de Google, même avec un productid ; place de marché) : pas de cloche (422) ; l'envie d'un autre : 404", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const google = await newWish(target, { merchantUrl: "https://www.google.fr/search?ibp=oshop&q=veste", merchantName: "Boutique" });
    const googleProduct = await newWish(target, { merchantUrl: "https://www.google.fr/shopping/product/1?prds=productid:4455667788", merchantName: "Boutique" });
    const amazon = await newWish(target, { merchantUrl: "https://www.amazon.fr/dp/B000123", merchantName: "Amazon" });
    for (const id of [google, googleProduct, amazon]) {
      expect((await as(target, ALICE).get(`/api/wishlist/${id}/alerts`)).json()).toMatchObject({ trackable: false });
      const res = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: "alert_not_trackable" });
    }
    expect((await as(target, BOB).get(`/api/wishlist/${OLD_WISH}/alerts`)).statusCode).toBe(404);
    expect((await as(target, BOB).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: true })).statusCode).toBe(404);
    expect(fake.table("wish_watches")).toHaveLength(0);
    expect((await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: "oui" })).statusCode).toBe(400);
  });
});

// Assemblage du build : ces routes, écrites pour zod 3, relisent maintenant
// leurs identifiants avec z.guid() (zod 4). Mêmes refus et mêmes codes
// d'erreur qu'avant ; et un identifiant accepté par zod 3 l'est toujours.
describe("entrées des routes après le passage à zod 4 : mêmes refus, mêmes codes d'erreur", () => {
  const MAL_FORMES = [
    "pas-un-identifiant",
    "e0000000-0000-4000-8000-00000000000", // un caractère de moins
    "e0000000-0000-4000-8000-0000000000088", // un caractère de plus
    "e0000000000040008000000000000008", // sans tirets
    "{e0000000-0000-4000-8000-000000000008}",
    "e0000000-0000-4000-8000-00000000000g",
    "e0000000-0000-4000-8000-000000000008\n",
    " e0000000-0000-4000-8000-000000000008",
    "e0000000-0000-4000-8000-000000000008,id.neq.x",
  ];
  // Sans numéro de version ni variante RFC : lus par le .uuid() de zod 3,
  // donc toujours lus (le z.uuid() de zod 4, plus strict, les refuserait).
  const SANS_VERSION = ["00000000-0000-0000-0000-000000000000", "E0000000-0000-0000-0000-00000000ABCD", "ffffffff-ffff-ffff-ffff-ffffffffffff"];

  it("identifiant d'une envie dans l'adresse : mal formé, 400 « invalid_params », rien n'est lu ni écrit ; bien formé mais inconnu, 404", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    for (const id of MAL_FORMES) {
      const url = `/api/wishlist/${encodeURIComponent(id)}/alerts`;
      for (const res of [await as(target, ALICE).get(url), await as(target, ALICE).put(url, { priceDrop: true, restock: true })]) {
        expect(res.statusCode, JSON.stringify(id)).toBe(400);
        expect(res.json()).toEqual({ error: "invalid_params", message: "Identifiant invalide." });
      }
    }
    for (const id of SANS_VERSION) {
      for (const res of [await as(target, ALICE).get(`/api/wishlist/${id}/alerts`), await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true })]) {
        expect(res.statusCode, id).toBe(404);
        expect(res.json()).toMatchObject({ error: "wishlist_item_not_found" });
      }
    }
    expect(fake.table("wish_watches")).toHaveLength(0);
    expect(fake.table("wish_tracking")).toHaveLength(0);
  });

  // Revue de sécurité du 12 novembre 2026 (point « entrees-05 »).
  it("« Plus disponible » : les demandes refusées comptent dans la limite par défaut (300 par minute), plus jamais sans limite", async () => {
    const target = await alertsApp(seeded().db);
    const member = "d0000000-0000-4000-8000-00000000000d";
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      for (let attempt = 0; attempt < 300; attempt++) {
        const res = await as(target, member).post("/api/alerts/stock-reports", {});
        if (res.statusCode !== 400) throw new Error(`demande ${attempt + 1} : ${res.statusCode}`);
      }
      const refused = await as(target, member).post("/api/alerts/stock-reports", {});
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ error: "rate_limited" });
      // Un autre membre n'est pas touché.
      expect((await as(target, ALICE).post("/api/alerts/stock-reports", {})).statusCode).toBe(400);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  // Revue de sécurité du 12 novembre 2026 (point « app-02 ») : le nom de la
  // boutique d'une envie ne vient jamais de la requête quand un lien est rangé.
  it("envie créée : le nom de la boutique est celui du résultat ; sans résultat, le nom de domaine du lien (jamais « Zara » vers un autre site)", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const stored = (id: string) => fake.table("wishlist_items").find((row) => row.id === id)!;

    // Appel direct, sans résultat : un nom de confiance et un lien vers un autre site.
    const forged = await newWish(target, { title: "Veste piégée", merchantName: "Zara", merchantUrl: "https://www.zara.exemple-pirate.com/connexion?x=1" });
    expect(stored(forged)).toMatchObject({ merchant_name: "zara.exemple-pirate.com", merchant_url: "https://www.zara.exemple-pirate.com/connexion?x=1", product_match_id: null });

    // Sans lien, il n'y a pas de bouton : le nom envoyé reste un simple texte.
    const noLink = await newWish(target, { title: "Veste sans lien", merchantName: "Friperie du coin" });
    expect(stored(noLink)).toMatchObject({ merchant_name: "Friperie du coin", merchant_url: null });

    // Avec un résultat de recherche : lien ET nom rangés avec ce résultat, quoi que dise la requête.
    const kept = await newWish(target, { title: "Veste Nuage 07", merchantName: "Zara", merchantUrl: "https://exemple-pirate.com/", productMatchId: MATCH });
    expect(stored(kept)).toMatchObject({ merchant_name: "Boutique Exemple", merchant_url: SHOP_URL, product_match_id: MATCH });
  });

  it("« Plus disponible » : identifiant mal formé, champ en trop, deux identifiants, aucun ou corps absent : 400 « invalid_body », rien n'est signalé", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const refuses: (object | undefined)[] = [
      ...MAL_FORMES.flatMap((id) => [{ wishlistItemId: id }, { productMatchId: id }]),
      { wishlistItemId: OLD_WISH, autre: 1 },
      { productMatchId: MATCH, autre: 1 },
      { wishlistItemId: OLD_WISH, productMatchId: MATCH },
      { wishlistItemId: [OLD_WISH] },
      { productMatchId: null },
      {},
      undefined,
    ];
    for (const payload of refuses) {
      const res = await as(target, ALICE).post("/api/alerts/stock-reports", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Requête invalide." });
    }
    expect(ownMatchMock).not.toHaveBeenCalled();
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report")).toEqual([]);
    // Bien formés (même sans numéro de version) : lus, puis introuvables.
    ownMatchMock.mockResolvedValue(null);
    for (const id of SANS_VERSION) {
      const wish = await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: id });
      expect(wish.statusCode, id).toBe(404);
      expect(wish.json()).toMatchObject({ error: "wishlist_item_not_found" });
      const match = await as(target, ALICE).post("/api/alerts/stock-reports", { productMatchId: id });
      expect(match.statusCode, id).toBe(404);
      expect(match.json()).toMatchObject({ error: "product_match_not_found" });
      expect(ownMatchMock).toHaveBeenLastCalledWith(expect.anything(), ALICE, id);
    }
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report")).toEqual([]);
  });

  it("cloche et interrupteur : un réglage absent ou qui n'est pas un vrai booléen : 400 « invalid_body », rien n'est enregistré", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const wish = await newWish(target, { merchantUrl: SHOP_URL, merchantName: "Boutique Exemple" });
    const cloches: object[] = [
      {},
      { priceDrop: true },
      { restock: true },
      { priceDrop: "true", restock: true },
      { priceDrop: 1, restock: 0 },
      { priceDrop: null, restock: true },
      { priceDrop: true, restock: false, soldOut: "oui" },
      { priceDrop: true, restock: false, soldOut: null },
      { priceDrop: true, restock: false, enableAlerts: "true" },
      { priceDrop: true, restock: false, enableAlerts: 1 },
      [true, true],
    ];
    for (const payload of cloches) {
      const res = await as(target, ALICE).put(`/api/wishlist/${wish}/alerts`, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Requête invalide." });
    }
    expect(fake.table("wish_watches")).toHaveLength(0);
    for (const payload of [{}, { enabled: "true" }, { enabled: 1 }, { enabled: null }, { activé: true }, [true], { helpOthers: "non" }, { helpOthers: null }, { helpOthers: false, autre: 1 }] as object[]) {
      const res = await as(target, ALICE).put("/api/alerts/settings", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Requête invalide." });
    }
    expect((await as(target, ALICE).get("/api/alerts/status")).json()).toMatchObject({ enabled: false, helpOthers: true });
    for (const targetPrice of [0, -5, "89", 100_000_000, [89], { prix: 89 }]) {
      const res = await as(target, ALICE).put(`/api/wishlist/${wish}/alerts`, { priceDrop: true, restock: false, targetPrice });
      expect(res.statusCode, String(targetPrice)).toBe(400);
    }
    expect(fake.table("wish_watches")).toHaveLength(0);
  });
});

// Nouvelle version des alertes (0041) : « Aider les autres membres », un
// réglage à part de « Alertes prix et stock » (allumé par défaut).
describe("« Aider les autres membres »", () => {
  it("allumé par défaut, distinct de « Alertes prix et stock » (coupé par défaut) ; se coupe et se rallume seul, sans toucher à l'autre ni aux appareils", async () => {
    const fake = seeded();
    fake.table("push_tokens").push({ token: PHONE, user_id: ALICE, platform: "ios", notify_messages: false, notify_alerts: true });
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).get("/api/alerts/status")).json()).toEqual({ available: true, enabled: false, helpOthers: true, push: true });
    const off = await as(target, ALICE).put("/api/alerts/settings", { helpOthers: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ available: true, enabled: false, helpOthers: false, push: true });
    expect(fake.table("profiles").find((row) => row.id === ALICE)).toMatchObject({ help_others: false, price_alerts_enabled: false });
    // Couper l'aide n'oublie aucun appareil (seul « Alertes prix et stock » coupé le fait).
    expect(fake.table("push_tokens")).toHaveLength(1);
    // Les deux à la fois.
    expect((await as(target, ALICE).put("/api/alerts/settings", { enabled: true, helpOthers: true })).json()).toEqual({ available: true, enabled: true, helpOthers: true, push: true });
    // Bob n'est pas touché.
    expect(fake.table("profiles").find((row) => row.id === BOB)).toMatchObject({ help_others: true, price_alerts_enabled: false });
  });

  it("le réglage est lu par la base (wish_observe, wish_stock_report) : le serveur ne l'envoie jamais avec un signalement, et le signalement de qui n'aide pas part pareil", async () => {
    const fake = seeded();
    fake.table("profiles").find((row) => row.id === ALICE)!.help_others = false;
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH })).statusCode).toBe(204);
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report")).toEqual([
      { fn: "wish_stock_report", args: { p_user_id: ALICE, p_key: KEY.hash, p_merchant: "boutiqueexemple", p_daily_cap: 20, p_country: "fr" } },
    ]);
  });
});

// Nouvelle version des alertes (0041) : « Prévenez-moi si le prix passe sous… ».
describe("le seuil de la baisse de prix, sur la cloche", () => {
  it("pré-rempli avec le dernier prix vu (pays et devise du membre) ; la personne peut le baisser ; le garder tel quel ne le change pas", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    const first = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false });
    expect(first.json().state).toMatchObject({ targetPrice: 120, targetCurrency: "EUR", lastPrice: 120, lastCurrency: "EUR" });
    const lower = await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: true, targetPrice: 99.999 });
    expect(lower.statusCode).toBe(200);
    expect(lower.json().state).toMatchObject({ targetPrice: 100, targetCurrency: "EUR" });
    expect(fake.table("wish_watches")[0]).toMatchObject({ target_price: 100, target_currency: "EUR", target_country: "fr", below_target: false });
    // Sans seuil dans la demande : celui qui est enregistré reste.
    await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false });
    expect(fake.table("wish_watches")[0]).toMatchObject({ target_price: 100 });
    // null : de nouveau le dernier prix vu.
    await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false, targetPrice: null });
    expect(fake.table("wish_watches")[0]).toMatchObject({ target_price: 120 });
  });

  it("un seuil au-dessus du dernier prix vu : noté « déjà sous le seuil » (l'alerte ne part qu'au prochain passage sous lui, jamais tout de suite)", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    await as(target, ALICE).put(`/api/wishlist/${id}/alerts`, { priceDrop: true, restock: false, targetPrice: 150 });
    expect(fake.table("wish_watches")[0]).toMatchObject({ target_price: 150, below_target: true });
  });

  it("aucun prix connu : pas de seuil (le premier prix vu le deviendra) ; un seuil choisi prend la devise du pays du membre ; sans pays connu : 422", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const manual = await newWish(target, { merchantUrl: "https://boutique-exemple.fr/sacs/cabas", merchantName: "Boutique Exemple" });
    const auto = await as(target, ALICE).put(`/api/wishlist/${manual}/alerts`, { priceDrop: true, restock: false });
    expect(auto.json().state).toMatchObject({ targetPrice: null, targetCurrency: "EUR", lastPrice: null });
    const chosen = await as(target, ALICE, "en-GB").put(`/api/wishlist/${manual}/alerts`, { priceDrop: true, restock: false, targetPrice: 70 });
    // Le pays gardé sur le suivi (sa recherche, à la création : France) l'emporte sur celui de la demande.
    expect(chosen.json().state).toMatchObject({ targetPrice: 70, targetCurrency: "EUR" });
    // Envie d'avant 0036, membre sans pays pris en charge : impossible, et rien n'est gardé sur le suivi.
    const kiwi = await as(target, ALICE, "en-NZ").put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: false, targetPrice: 70 });
    expect(kiwi.statusCode).toBe(422);
    expect(fake.table("wish_watches").filter((row) => row.wishlist_item_id === OLD_WISH)).toHaveLength(0);
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)?.member_country ?? null).toBeNull();
    // … mais la même demande depuis la France : le pays de la recherche en cours, gardé sur le suivi au même moment
    // (les prix et le stock de France sont alors ceux comparés ; un premier prix d'un autre pays ne le change plus).
    const french = await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: false, targetPrice: 70 });
    expect(french.json().state).toMatchObject({ targetPrice: 70, targetCurrency: "EUR" });
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)).toMatchObject({ member_country: "fr" });
    expect(fake.table("wish_watches").find((row) => row.wishlist_item_id === OLD_WISH)).toMatchObject({ target_country: "fr", target_currency: "EUR" });
  });

  it("une cloche enregistrée sur un suivi sans pays depuis une région prise en charge garde ce pays sur le suivi (retour en stock compris) ; un pays déjà connu n'est jamais remplacé", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE, "en-GB").put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: false, restock: true })).statusCode).toBe(200);
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)).toMatchObject({ member_country: "gb" });
    expect((await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: true })).statusCode).toBe(200);
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)).toMatchObject({ member_country: "gb" });
    // Depuis une région non prise en charge : la cloche est gardée, le suivi reste sans pays.
    fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)!.member_country = null;
    expect((await as(target, ALICE, "en-NZ").put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: true })).statusCode).toBe(200);
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === OLD_WISH)?.member_country ?? null).toBeNull();
  });
});

describe("l'interrupteur des Réglages et les appareils", () => {
  it("un appareil reste enregistré tant que les messages OU les alertes sont allumés", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    // Le téléphone : alertes seulement (messages coupés) ; la tablette : messages (ancienne app, sans les champs).
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: false, alerts: true })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: TABLET, platform: "ios" })).statusCode).toBe(204);
    expect(fake.table("push_tokens").map((row) => [row.token, row.notify_messages ?? "défaut (oui)", row.notify_alerts ?? "défaut (non)"])).toEqual([
      [PHONE, false, true],
      [TABLET, "défaut (oui)", "défaut (non)"],
    ]);
    // Rafraîchi sans les champs : les choix restent.
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios" })).statusCode).toBe(204);
    expect(fake.table("push_tokens").find((row) => row.token === PHONE)).toMatchObject({ notify_messages: false, notify_alerts: true });

    const on = await as(target, ALICE).put("/api/alerts/settings", { enabled: true });
    expect(on.json()).toEqual({ available: true, enabled: true, helpOthers: true, push: true });
    expect(fake.table("push_tokens")).toHaveLength(2);
    // Alertes coupées : l'appareil des seules alertes est oublié, l'autre reste.
    const off = await as(target, ALICE).put("/api/alerts/settings", { enabled: false });
    expect(off.json()).toEqual({ available: true, enabled: false, helpOthers: true, push: true });
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([TABLET]);
    expect((await as(target, ALICE).put("/api/alerts/settings", { enabled: "non" })).statusCode).toBe(400);
  });

  it("un appareil qui ne reçoit plus rien (messages et alertes coupés) est oublié", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: true, alerts: true })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: PHONE, platform: "ios", messages: false, alerts: false })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([]);
    // Messages coupés, alertes laissées telles quelles (coupées) : oublié aussi.
    expect((await as(target, ALICE).put("/api/me/push-token", { token: TABLET, platform: "ios", messages: true, alerts: false })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: TABLET, platform: "ios", messages: false })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([]);
  });
});

describe("« Plus disponible »", () => {
  it("sur une envie : la clé de la pièce, jamais une adresse ; 20 par jour au plus (429) ; sans clé : 422", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH })).statusCode).toBe(204);
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report")).toEqual([
      { fn: "wish_stock_report", args: { p_user_id: ALICE, p_key: KEY.hash, p_merchant: "boutiqueexemple", p_daily_cap: 20, p_country: "fr" } },
    ]);
    // Le pays de la recherche part avec le signalement (seulement un pays pris en charge par les alertes).
    rpcCalls = [];
    await as(target, ALICE, "en-GB").post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    await as(target, ALICE, "en-NZ").post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report").map((call) => call.args.p_country)).toEqual(["gb", null]);
    const amazon = await newWish(target, { merchantUrl: "https://www.amazon.fr/dp/B000123", merchantName: "Amazon" });
    const none = await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: amazon });
    expect(none.statusCode).toBe(422);
    expect((await as(target, BOB).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH })).statusCode).toBe(404);
    expect((await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH, productMatchId: MATCH })).statusCode).toBe(400);
    expect((await as(target, ALICE).post("/api/alerts/stock-reports", {})).statusCode).toBe(400);
  });

  it("sur un résultat d'une de vos recherches : la clé vient du lien et de la boutique rangés par le serveur ; d'une autre personne : 404", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).post("/api/alerts/stock-reports", { productMatchId: MATCH })).statusCode).toBe(204);
    expect(rpcCalls.find((call) => call.fn === "wish_stock_report")!.args).toMatchObject({ p_key: KEY.hash, p_merchant: "boutiqueexemple" });
    ownMatchMock.mockResolvedValueOnce(null);
    expect((await as(target, BOB).post("/api/alerts/stock-reports", { productMatchId: MATCH })).statusCode).toBe(404);
  });

  it("compte suspendu : refusé (403) — un signalement change les envies des autres membres ; la cloche, elle, reste permise", async () => {
    const fake = seeded();
    fake.table("suspensions").push({ user_id: ALICE });
    const target = await alertsApp(fake.db);
    const res = await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    expect(res.statusCode).toBe(403);
    expect(rpcCalls.filter((call) => call.fn === "wish_stock_report")).toEqual([]);
    expect((await as(target, ALICE).put(`/api/wishlist/${OLD_WISH}/alerts`, { priceDrop: true, restock: false })).statusCode).toBe(200);
  });

  it("limite en mémoire : une demande refusée (pièce sans clé : 422, introuvable : 404) n'use jamais la part du jour", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const fake = seeded();
      fake.table("profiles").push({ id: CAROL, username: "carol", locale: "fr", price_alerts_enabled: false, help_others: true });
      fake.table("wishlist_items").push({ ...fake.table("wishlist_items")[0]!, id: CAROL_WISH, user_id: CAROL });
      fake.table("wishlist_items").push({ ...fake.table("wishlist_items")[0]!, id: CAROL_AMAZON, user_id: CAROL, merchant_url: "https://www.amazon.fr/dp/B000123", merchant_name: "Amazon" });
      const target = await alertsApp(fake.db);
      for (let index = 0; index < 25; index += 1) {
        expect((await as(target, CAROL).post("/api/alerts/stock-reports", { wishlistItemId: CAROL_AMAZON })).statusCode).toBe(422);
        expect((await as(target, CAROL).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH })).statusCode).toBe(404);
      }
      // Le vrai signalement passe ; puis 20 signalements possibles au plus.
      for (let index = 0; index < 20; index += 1) expect((await as(target, CAROL).post("/api/alerts/stock-reports", { wishlistItemId: CAROL_WISH })).statusCode).toBe(204);
      const limited = await as(target, CAROL).post("/api/alerts/stock-reports", { wishlistItemId: CAROL_WISH });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: "stock_report_limit" });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("limite du jour atteinte dans la base : 429 « stock_report_limit »", async () => {
    const fake = seeded({ reportAllowed: false });
    const target = await alertsApp(fake.db);
    const res = await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: "stock_report_limit" });
  });

  it("journal : des codes, jamais un compte, une envie, une empreinte ni une adresse (le signalement garde son auteur dans sa table, jamais au journal avec les envies touchées)", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    await newWish(target, { productMatchId: MATCH });
    const journal = logs.join("\n");
    expect(journal).not.toContain(ALICE);
    expect(journal).not.toContain(OLD_WISH);
    expect(journal).not.toMatch(/"matched"/);
    expect(journal).not.toContain(KEY.hash);
    expect(journal).not.toContain("boutique-exemple.fr");
    expect(journal).not.toContain("Veste Nuage");
  });
});

describe("export RGPD et suppression du compte", () => {
  it("export : les cloches et leur seuil, le suivi (au jour près, sans clé ni pays d'observation), les alertes (jour de création et d'envoi, aucune heure), les signalements avec leur auteur, et « Aider les autres membres »", async () => {
    const fake = seeded();
    fake.table("wish_tracking").push({
      wishlist_item_id: OLD_WISH,
      user_id: ALICE,
      match_key_hash: KEY.hash,
      key_version: 2,
      merchant_key: "boutiqueexemple",
      last_price: 99,
      last_currency: "EUR",
      last_country: "gb",
      last_seen_on: "2026-11-08",
      stock_state: "in_stock",
      stock_on: "2026-11-08",
      updated_at: "2026-11-08T17:42:13.123+00:00",
    });
    fake.table("wish_watches").push({ wishlist_item_id: OLD_WISH, user_id: ALICE, notify_price_drop: true, notify_restock: false, notify_sold_out: false, target_price: 100, target_currency: "EUR", target_country: "fr", below_target: true, created_at: "2026-11-02T10:00:00+00:00", updated_at: "2026-11-02T10:00:00+00:00" });
    fake.table("wish_alert_events").push({ id: "0e000000-0000-4000-8000-000000000001", wishlist_item_id: OLD_WISH, user_id: ALICE, kind: "price_drop", old_price: 100, new_price: 99, currency: "EUR", status: "sent", created_on: "2026-11-08", sent_on: "2026-11-08", claimed_at: null, pushing_at: null });
    fake.table("stock_reports").push(
      { id: "5c000000-0000-4000-8000-000000000001", user_id: ALICE, match_key_hash: KEY.hash, created_on: "2026-11-09", country: "fr", helps_others: true, in_streak: true },
      { id: "5c000000-0000-4000-8000-000000000002", user_id: BOB, match_key_hash: KEY.hash, created_on: "2026-11-09", country: "fr", helps_others: true, in_streak: true }
    );
    fake.table("profiles").find((row) => row.id === ALICE)!.help_others = false;
    const target = await alertsApp(fake.db);
    const res = await as(target, ALICE).get("/api/me/export");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wishWatches).toEqual([
      {
        wishlist_item_id: OLD_WISH,
        notify_price_drop: true,
        notify_restock: false,
        notify_sold_out: false,
        created_at: "2026-11-02T10:00:00+00:00",
        updated_at: "2026-11-02T10:00:00+00:00",
        target_price: 100,
        target_currency: "EUR",
        target_country: "fr",
        below_target: true,
        wishlist_item_title: "Ancienne envie",
      },
    ]);
    expect(body.wishTracking).toEqual([
      {
        wishlist_item_id: OLD_WISH,
        last_price: 99,
        last_currency: "EUR",
        last_seen_on: "2026-11-08",
        stock_state: "in_stock",
        stock_on: "2026-11-08",
        // SON pays, l'origine d'un « épuisée », son achat. Jamais le pays des observations (last_country).
        member_country: null,
        sold_out_source: null,
        bought_on: null,
        wishlist_item_title: "Ancienne envie",
      },
    ]);
    expect(body.wishTracking[0]).not.toHaveProperty("last_country");
    expect(body.wishAlertEvents).toEqual([
      { id: "0e000000-0000-4000-8000-000000000001", wishlist_item_id: OLD_WISH, kind: "price_drop", old_price: 100, new_price: 99, currency: "EUR", status: "sent", created_on: "2026-11-08", sent_on: "2026-11-08", wishlist_item_title: "Ancienne envie" },
    ]);
    // Seulement ses propres signalements (leur auteur : elle), au jour près, s'ils aidaient les autres et s'ils sont dans la série en cours.
    expect(body.stockReports).toEqual([{ id: "5c000000-0000-4000-8000-000000000001", match_key_hash: KEY.hash, created_on: "2026-11-09", country: "fr", helps_others: true, in_streak: true }]);
    // Jamais le pays ni l'heure d'une observation, ni d'où vient une alerte.
    const json = JSON.stringify(body);
    expect(json).not.toContain('"gb"');
    expect(json).not.toContain("17:42");
    expect(json).not.toMatch(/sent_at|send_after|last_sent|claimed_at|pushing_at/);
    // Le profil dit les deux réglages (colonnes lues avec « * »).
    expect(body.profile).toMatchObject({ price_alerts_enabled: false, help_others: false });
  });

  it("export d'une base avec 0040 sans 0041 : les colonnes de 0040 (les données restent exportées, alertes coupées)", async () => {
    const fake = seeded({ version: 2 });
    fake.table("wish_tracking").push({ wishlist_item_id: OLD_WISH, user_id: ALICE, match_key_hash: KEY.hash, ref_price: 120, ref_currency: "EUR", ref_country: "fr", ref_set_on: "2026-11-01", stock_state: "unknown" });
    const target = await alertsApp(fake.db);
    const body = (await as(target, ALICE).get("/api/me/export")).json();
    expect(body.wishTracking[0]).toMatchObject({ ref_price: 120, ref_set_on: "2026-11-01", member_country: null });
    expect(body.wishTracking[0]).not.toHaveProperty("ref_country");
  });

  it("sans 0036 : les sections des alertes sont vides ; la suppression du compte marche avec ou sans 0036", async () => {
    const without = seeded({ migrated: false });
    const before = await alertsApp(without.db);
    const exported = (await as(before, ALICE).get("/api/me/export")).json();
    expect([exported.wishWatches, exported.wishTracking, exported.wishAlertEvents, exported.stockReports]).toEqual([[], [], [], []]);
    expect((await before.inject({ method: "DELETE", url: "/api/me", headers: { "x-test-user": ALICE }, payload: { confirmation: "SUPPRIMER" } })).statusCode).toBe(204);
    await app?.close();
    resetWishAlertsProbe();
    const fake = seeded();
    const target = await alertsApp(fake.db);
    expect((await target.inject({ method: "DELETE", url: "/api/me", headers: { "x-test-user": ALICE }, payload: { confirmation: "SUPPRIMER" } })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });
});

describe("rattrapage des envies d'avant 0036 (scripts/rattraper-suivi-envies-dev.ts)", () => {
  it("crée le suivi manquant (sans prix), rejouable sans effet, et recalcule une empreinte d'une version plus ancienne (version 2 : le lien normalisé)", async () => {
    const fake = seeded();
    fake.table("wishlist_items").push({
      id: "e0000000-0000-4000-8000-000000000009",
      user_id: BOB,
      title: "Envie à la main, sans lien",
      image_url: "https://images.example/b.jpg",
      merchant_name: null,
      merchant_url: null,
      product_match_id: null,
      created_at: "2026-10-02T10:00:00+00:00",
    });
    const target = await alertsApp(fake.db);
    const first = await backfillWishTracking(target);
    expect(first).toEqual({ scanned: 2, created: 2, updated: 0, unchanged: 0 });
    expect(fake.table("wish_tracking").map((row) => [row.wishlist_item_id, row.match_key_hash, row.last_price ?? null])).toEqual([
      [OLD_WISH, KEY.hash, null],
      ["e0000000-0000-4000-8000-000000000009", null, null],
    ]);
    expect(await backfillWishTracking(target)).toEqual({ scanned: 2, created: 0, updated: 0, unchanged: 2 });
    // Une empreinte de la version 1 (0036 : « v1|u|… ») : recalculée, le reste du suivi gardé.
    Object.assign(fake.table("wish_tracking")[0]!, { key_version: 1, match_key_hash: "0".repeat(64), last_price: 99 });
    expect(await backfillWishTracking(target)).toEqual({ scanned: 2, created: 0, updated: 1, unchanged: 1 });
    expect(fake.table("wish_tracking")[0]).toMatchObject({ match_key_hash: KEY.hash, key_version: 2, last_price: 99 });
  });

  it("le script refuse toute base qui n'est pas spotto-dev-2, avant toute connexion", () => {
    const script = readFileSync(join(__dirname, "../scripts/rattraper-suivi-envies-dev.ts"), "utf8");
    expect(script.indexOf("assertDevSupabaseUrl(")).toBeGreaterThan(0);
    expect(script.indexOf("assertDevSupabaseUrl(")).toBeLessThan(script.indexOf("buildApp("));
  });
});

// Une ligne de la fausse base, pour TypeScript.
export type { Row };
