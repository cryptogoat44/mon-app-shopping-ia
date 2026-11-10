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
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { resetPushProbe } from "../src/lib/push.js";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";
import { backfillWishTracking } from "../src/lib/wishAlerts.js";
import { readFileSync } from "node:fs";
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
  /** Réponse de wish_stock_report. */
  reportAllowed?: boolean;
}

let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

function seeded(setup: Setup = {}) {
  const migrated = setup.migrated ?? true;
  const rpc: Rpc = async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (!migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
    if (fn === "wish_alerts_version") return { data: 1, error: null };
    if (fn === "wish_stock_report") return { data: [{ allowed: setup.reportAllowed ?? true, matched: 2 }], error: null };
    return { data: null, error: { code: "PGRST202", message: "absente" } };
  };
  const fake = fakeSupabase({ rpc });
  fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr", price_alerts_enabled: false }, { id: BOB, username: "bob", locale: "fr", price_alerts_enabled: false });
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

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user, "accept-language": "fr-FR" };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
  };
}

async function newWish(target: FastifyInstance, body: Record<string, unknown>, user: string = ALICE): Promise<string> {
  const res = await as(target, user).post("/api/wishlist", { title: "Veste Nuage 07", imageUrl: "https://images.example/veste.jpg", ...body });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

beforeEach(() => {
  resetWishAlertsProbe();
  resetPushProbe();
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
    expect(status.json()).toEqual({ available: false, enabled: false, push: false } satisfies WishAlertsStatus);
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

describe("création d'une envie : le suivi (chaque chemin, une seule fois)", () => {
  it("depuis un résultat : clé de la pièce, et prix de référence relu dans la base (jamais celui envoyé par l'app), daté du jour de Paris de la recherche", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    // L'app envoie un autre prix et une autre devise : ignorés pour la référence.
    const id = await newWish(target, { productMatchId: MATCH, priceMin: 1, currency: "USD", merchantName: "Autre nom" });
    expect(fake.table("wish_tracking")).toEqual([
      {
        wishlist_item_id: id,
        user_id: ALICE,
        match_key_hash: KEY.hash,
        key_version: 1,
        merchant_key: "boutiqueexemple",
        ref_price: 120,
        ref_currency: "EUR",
        ref_country: "fr",
        // 23 h 30 UTC le 8 novembre : déjà le 9 à Paris.
        ref_set_on: "2026-11-09",
        stock_state: "unknown",
      },
    ]);
    // La même envie gardée deux fois : un seul suivi.
    await newWish(target, { productMatchId: MATCH });
    expect(fake.table("wish_tracking")).toHaveLength(1);
    // Jamais l'adresse dans le suivi.
    expect(JSON.stringify(fake.table("wish_tracking"))).not.toContain("boutique-exemple.fr");
  });

  it("envie à la main : clé de la pièce, aucune référence ; devise inconnue de la proposition : aucune référence", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const manual = await newWish(target, { merchantUrl: "https://boutique-exemple.fr/sacs/cabas", merchantName: "Boutique Exemple", priceMin: 80 });
    expect(fake.table("wish_tracking").find((row) => row.wishlist_item_id === manual)).toEqual({
      wishlist_item_id: manual,
      user_id: ALICE,
      match_key_hash: trackingKeyOf("https://boutique-exemple.fr/sacs/cabas", "Boutique Exemple")!.hash,
      key_version: 1,
      merchant_key: "boutiqueexemple",
      stock_state: "unknown",
    });
    fake.table("product_matches")[0]!.currency = "$";
    fake.table("wishlist_items").length = 1;
    fake.table("wish_tracking").length = 0;
    await newWish(target, { productMatchId: MATCH });
    expect(fake.table("wish_tracking")[0]).not.toHaveProperty("ref_price");
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
      state: { wishlistItemId: id, trackable: true, bought: false, priceDrop: true, restock: true, soldOut: false, stock: "unknown" },
      status: { available: true, enabled: true, push: true },
    } satisfies UpdateWishAlertResponse);
    expect(fake.table("wish_watches")).toEqual([expect.objectContaining({ wishlist_item_id: id, user_id: ALICE, notify_price_drop: true, notify_restock: true, notify_sold_out: false })]);
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
    expect(res.json()).toEqual({ wishlistItemId: OLD_WISH, trackable: true, bought: false, priceDrop: false, restock: false, soldOut: false, stock: "unknown" } satisfies WishAlertState);
    expect(fake.table("wish_tracking")).toEqual([expect.objectContaining({ wishlist_item_id: OLD_WISH, match_key_hash: KEY.hash })]);
  });

  it("envie d'avant 0036 gardée depuis un résultat : suivi créé SANS référence, comme au rattrapage (le pays de sa recherche n'est connu nulle part)", async () => {
    const fake = seeded();
    fake.table("wishlist_items")[0]!.product_match_id = MATCH;
    const target = await alertsApp(fake.db);
    expect((await as(target, ALICE).get(`/api/wishlist/${OLD_WISH}/alerts`)).statusCode).toBe(200);
    const [row] = fake.table("wish_tracking");
    expect(row).toMatchObject({ wishlist_item_id: OLD_WISH, match_key_hash: KEY.hash });
    expect(row).not.toHaveProperty("ref_price");
    // Le rattrapage, passé ensuite, ne change rien : même résultat, quel que soit l'ordre.
    expect(await backfillWishTracking(target)).toMatchObject({ created: 0, unchanged: 1 });
  });

  it("proposition rangée avant le 4 novembre 2026 (« EUR » par défaut quand la devise manquait) : jamais de référence", async () => {
    const fake = seeded();
    fake.table("product_matches")[0]!.created_at = "2026-11-02T10:00:00+00:00";
    const target = await alertsApp(fake.db);
    const id = await newWish(target, { productMatchId: MATCH });
    const row = fake.table("wish_tracking").find((tracking) => tracking.wishlist_item_id === id)!;
    expect(row).toMatchObject({ match_key_hash: KEY.hash });
    expect(row).not.toHaveProperty("ref_price");
  });

  it("pièce sans clé (page Google sans productid, place de marché) : pas de cloche (422) ; l'envie d'un autre : 404", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    const google = await newWish(target, { merchantUrl: "https://www.google.fr/search?ibp=oshop&q=veste", merchantName: "Boutique" });
    const amazon = await newWish(target, { merchantUrl: "https://www.amazon.fr/dp/B000123", merchantName: "Amazon" });
    for (const id of [google, amazon]) {
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
    expect(on.json()).toEqual({ available: true, enabled: true, push: true });
    expect(fake.table("push_tokens")).toHaveLength(2);
    // Alertes coupées : l'appareil des seules alertes est oublié, l'autre reste.
    const off = await as(target, ALICE).put("/api/alerts/settings", { enabled: false });
    expect(off.json()).toEqual({ available: true, enabled: false, push: true });
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
      { fn: "wish_stock_report", args: { p_user_id: ALICE, p_key: KEY.hash, p_merchant: "boutiqueexemple", p_daily_cap: 20 } },
    ]);
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
      fake.table("profiles").push({ id: CAROL, username: "carol", locale: "fr", price_alerts_enabled: false });
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

  it("journal : des codes, jamais un compte, une clé ni une adresse", async () => {
    const fake = seeded();
    const target = await alertsApp(fake.db);
    await as(target, ALICE).post("/api/alerts/stock-reports", { wishlistItemId: OLD_WISH });
    await newWish(target, { productMatchId: MATCH });
    const journal = logs.join("\n");
    expect(journal).not.toContain(ALICE);
    expect(journal).not.toContain(KEY.hash);
    expect(journal).not.toContain("boutique-exemple.fr");
    expect(journal).not.toContain("Veste Nuage");
  });
});

describe("export RGPD et suppression du compte", () => {
  it("export : les cloches, le suivi (au jour près, sans clé ni pays ni heure d'observation), les alertes (au jour près) et les signalements", async () => {
    const fake = seeded();
    fake.table("wish_tracking").push({
      wishlist_item_id: OLD_WISH,
      user_id: ALICE,
      match_key_hash: KEY.hash,
      key_version: 1,
      merchant_key: "boutiqueexemple",
      ref_price: 120,
      ref_currency: "EUR",
      ref_country: "gb",
      ref_set_on: "2026-11-01",
      last_price: 99,
      last_currency: "EUR",
      last_country: "gb",
      last_seen_on: "2026-11-08",
      stock_state: "in_stock",
      stock_on: "2026-11-08",
      updated_at: "2026-11-08T17:42:13.123+00:00",
    });
    fake.table("wish_watches").push({ wishlist_item_id: OLD_WISH, user_id: ALICE, notify_price_drop: true, notify_restock: false, notify_sold_out: false, last_sent_price_drop_at: "2026-11-08T19:42:13+00:00", created_at: "2026-11-02T10:00:00+00:00", updated_at: "2026-11-02T10:00:00+00:00" });
    fake.table("wish_alert_events").push({ id: "0e000000-0000-4000-8000-000000000001", wishlist_item_id: OLD_WISH, user_id: ALICE, kind: "price_drop", old_price: 120, new_price: 99, currency: "EUR", status: "sent", created_on: "2026-11-08", created_at: "2026-11-08T17:42:13+00:00", send_after: "2026-11-08T21:42:13+00:00", sent_at: "2026-11-08T22:00:00+00:00", claimed_at: null });
    fake.table("stock_reports").push({ id: "5c000000-0000-4000-8000-000000000001", user_id: ALICE, match_key_hash: KEY.hash, created_on: "2026-11-09" }, { id: "5c000000-0000-4000-8000-000000000002", user_id: BOB, match_key_hash: KEY.hash, created_on: "2026-11-09" });
    const target = await alertsApp(fake.db);
    const res = await as(target, ALICE).get("/api/me/export");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wishWatches).toEqual([
      { wishlist_item_id: OLD_WISH, notify_price_drop: true, notify_restock: false, notify_sold_out: false, created_at: "2026-11-02T10:00:00+00:00", updated_at: "2026-11-02T10:00:00+00:00", wishlist_item_title: "Ancienne envie" },
    ]);
    expect(body.wishTracking).toEqual([
      {
        wishlist_item_id: OLD_WISH,
        ref_price: 120,
        ref_currency: "EUR",
        ref_set_on: "2026-11-01",
        last_price: 99,
        last_currency: "EUR",
        last_seen_on: "2026-11-08",
        stock_state: "in_stock",
        stock_on: "2026-11-08",
        wishlist_item_title: "Ancienne envie",
      },
    ]);
    expect(body.wishAlertEvents).toEqual([
      { id: "0e000000-0000-4000-8000-000000000001", wishlist_item_id: OLD_WISH, kind: "price_drop", old_price: 120, new_price: 99, currency: "EUR", status: "sent", created_on: "2026-11-08", wishlist_item_title: "Ancienne envie" },
    ]);
    // Seulement ses propres signalements, au jour près.
    expect(body.stockReports).toEqual([{ id: "5c000000-0000-4000-8000-000000000001", match_key_hash: KEY.hash, created_on: "2026-11-09" }]);
    // Jamais le pays ni l'heure d'une observation, ni d'où elle vient.
    const json = JSON.stringify(body);
    expect(json).not.toContain('"gb"');
    expect(json).not.toContain("17:42");
    expect(json).not.toContain("last_sent_price_drop_at");
    // Le profil dit l'état de l'interrupteur (colonne price_alerts_enabled, lue avec « * »).
    expect(body.profile).toMatchObject({ price_alerts_enabled: false });
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
  it("crée le suivi manquant (sans référence), rejouable sans effet, et recalcule une clé d'une version plus ancienne", async () => {
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
    expect(fake.table("wish_tracking").map((row) => [row.wishlist_item_id, row.match_key_hash, row.ref_price ?? null])).toEqual([
      [OLD_WISH, KEY.hash, null],
      ["e0000000-0000-4000-8000-000000000009", null, null],
    ]);
    expect(await backfillWishTracking(target)).toEqual({ scanned: 2, created: 0, updated: 0, unchanged: 2 });
    // Une clé d'une version plus ancienne : recalculée, le reste du suivi gardé.
    Object.assign(fake.table("wish_tracking")[0]!, { key_version: 0, match_key_hash: "0".repeat(64), last_price: 99 });
    expect(await backfillWishTracking(target)).toEqual({ scanned: 2, created: 0, updated: 1, unchanged: 1 });
    expect(fake.table("wish_tracking")[0]).toMatchObject({ match_key_hash: KEY.hash, key_version: 1, last_price: 99 });
  });

  it("le script refuse toute base qui n'est pas spotto-dev-2, avant toute connexion", () => {
    const script = readFileSync(join(__dirname, "../scripts/rattraper-suivi-envies-dev.ts"), "utf8");
    expect(script.indexOf("assertDevSupabaseUrl(")).toBeGreaterThan(0);
    expect(script.indexOf("assertDevSupabaseUrl(")).toBeLessThan(script.indexOf("buildApp("));
  });
});

// Une ligne de la fausse base, pour TypeScript.
export type { Row };
