import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WishAlertNews, WishAlertNewsList } from "@monapp/shared-types";

// Lot « alertes visibles » : GET /api/alerts/news, SANS base ni réseau, sur
// une fausse base en mémoire (tests/fakeSupabase.ts). Les vraies routes des
// alertes ; seule la sonde wish_alerts_version est imitée. Une règle, un cas
// refusé et un cas permis. Boutiques et pièces fictives.

import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import wishAlertsRoutes from "../src/routes/wishAlerts.js";
import { MAX_WISH_ALERT_NEWS, parisDay, readWishAlertNews } from "../src/lib/wishAlerts.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const MATCH = "f0000000-0000-4000-8000-000000000007";

/** Le jour de Paris d'aujourd'hui moins `days` jours. */
function day(days: number): string {
  const date = new Date(`${parisDay(new Date())!}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

let counter = 0;
function uuid(prefix: string): string {
  counter += 1;
  return `${prefix}0000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

interface WishSetup {
  user?: string;
  title?: string;
  merchant?: string | null;
  stock?: "unknown" | "in_stock" | "sold_out";
  boughtOn?: string | null;
  priceDrop?: boolean;
  restock?: boolean;
  below?: boolean;
  /** Seuil actuel de la cloche (défaut « 89.00 » EUR, celui des alertes). */
  target?: string | null;
  targetCurrency?: string | null;
  productMatchId?: string | null;
  watch?: boolean;
}

function seeded(options: { version?: number | null } = {}) {
  const rpcCalls: string[] = [];
  const fake = fakeSupabase({
    rpc: async (fn) => {
      rpcCalls.push(fn);
      if (fn === "wish_alerts_version" && options.version !== null) return { data: options.version ?? 3, error: null };
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  });
  fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr" }, { id: BOB, username: "bob", locale: "fr" });

  function wish(setup: WishSetup = {}): string {
    const id = uuid("e");
    const user = setup.user ?? ALICE;
    fake.table("wishlist_items").push({
      id,
      user_id: user,
      title: setup.title ?? "Veste Nuage 07",
      merchant_name: setup.merchant === undefined ? "Boutique Exemple" : setup.merchant,
      merchant_url: "https://boutique-exemple.fr/vestes/nuage-07",
      product_match_id: setup.productMatchId ?? null,
      price_min: null,
      currency: "EUR",
      created_at: "2026-11-01T10:00:00+00:00",
    });
    fake.table("wish_tracking").push({
      wishlist_item_id: id,
      user_id: user,
      match_key_hash: "a".repeat(64),
      stock_state: setup.stock ?? "in_stock",
      bought_on: setup.boughtOn ?? null,
    });
    if (setup.watch !== false) {
      fake.table("wish_watches").push({
        wishlist_item_id: id,
        user_id: user,
        notify_price_drop: setup.priceDrop ?? true,
        notify_restock: setup.restock ?? true,
        notify_sold_out: false,
        below_target: setup.below ?? true,
        target_price: setup.target === undefined ? "89.00" : setup.target,
        target_currency: setup.targetCurrency === undefined ? "EUR" : setup.targetCurrency,
      });
    }
    return id;
  }

  function alert(wishId: string, event: Partial<Row> = {}): string {
    const id = uuid("d");
    const owner = fake.table("wishlist_items").find((row) => row.id === wishId)!.user_id;
    const kind = event.kind ?? "price_drop";
    fake.table("wish_alert_events").push({
      id,
      wishlist_item_id: wishId,
      user_id: owner,
      kind,
      old_price: kind === "price_drop" ? "89.00" : null,
      new_price: kind === "price_drop" ? "69.00" : null,
      currency: kind === "price_drop" ? "EUR" : null,
      created_on: day(1),
      status: "pending",
      ...event,
    });
    return id;
  }

  return { fake, wish, alert, rpcCalls };
}

let app: FastifyInstance | null = null;
let logs: string[] = [];

async function newsApp(db: unknown): Promise<FastifyInstance> {
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
  await app.register(wishAlertsRoutes);
  await app.ready();
  return app;
}

async function newsOf(target: FastifyInstance, user: string): Promise<WishAlertNews[]> {
  const res = await target.inject({ method: "GET", url: "/api/alerts/news", headers: { "x-test-user": user } });
  expect(res.statusCode).toBe(200);
  return (res.json() as WishAlertNewsList).items;
}

beforeEach(() => {
  resetWishAlertsProbe();
  logs = [];
});

afterEach(async () => {
  await app?.close();
  app = null;
  resetWishAlertsProbe();
});

describe("GET /api/alerts/news : accès", () => {
  it("refusé sans compte connecté (401) ; permis à un membre connecté (200)", async () => {
    const { fake } = seeded();
    const target = await newsApp(fake.db);
    const anonymous = await target.inject({ method: "GET", url: "/api/alerts/news" });
    expect(anonymous.statusCode).toBe(401);
    expect(await newsOf(target, ALICE)).toEqual([]);
  });

  it("un membre ne lit JAMAIS les alertes d'un autre membre : Bob ne voit rien des alertes d'Alice, Alice voit les siennes", async () => {
    const { fake, wish, alert } = seeded();
    const aliceWish = wish({ user: ALICE, title: "Veste d'Alice" });
    const aliceAlert = alert(aliceWish);
    const bobWish = wish({ user: BOB, title: "Robe de Bob" });
    const bobAlert = alert(bobWish, { kind: "restock" });
    const target = await newsApp(fake.db);
    const bob = await newsOf(target, BOB);
    expect(bob.map((item) => item.id)).toEqual([bobAlert]);
    expect(JSON.stringify(bob)).not.toContain("Alice");
    const alice = await newsOf(target, ALICE);
    expect(alice.map((item) => item.id)).toEqual([aliceAlert]);
    expect(JSON.stringify(alice)).not.toContain("Bob");
  });

  it("une alerte rangée par erreur sous un autre membre que celui de l'envie n'est jamais montrée (l'envie doit être la sienne)", async () => {
    const { fake, wish, alert } = seeded();
    const aliceWish = wish({ user: ALICE });
    // Ligne incohérente (impossible en base : clé étrangère (id, user_id)) : l'alerte dit Bob, l'envie est à Alice.
    alert(aliceWish, { user_id: BOB });
    const target = await newsApp(fake.db);
    expect(await newsOf(target, BOB)).toEqual([]);
    expect(await newsOf(target, ALICE)).toEqual([]);
  });
});

describe("sans la version 0041 des alertes : rien", () => {
  it("refusé : base sans 0036 ou avec 0040 seule → 200 et aucune nouveauté ; permis : avec 0041 → la nouveauté", async () => {
    for (const version of [null, 2]) {
      resetWishAlertsProbe();
      const { fake, wish, alert } = seeded({ version });
      alert(wish());
      const target = await newsApp(fake.db);
      expect(await newsOf(target, ALICE)).toEqual([]);
      await app?.close();
      app = null;
    }
    resetWishAlertsProbe();
    const { fake, wish, alert } = seeded({ version: 3 });
    alert(wish());
    const target = await newsApp(fake.db);
    expect(await newsOf(target, ALICE)).toHaveLength(1);
  });
});

describe("ce qui est montré", () => {
  it("une baisse : le prix vu, VOTRE SEUIL (jamais un « ancien prix »), la devise, le jour, la boutique et le titre de l'envie", async () => {
    const { fake, wish, alert } = seeded();
    const wishId = wish({ title: "Veste Nuage 07", merchant: "Boutique Exemple" });
    const id = alert(wishId, { old_price: "89.00", new_price: "69.50", currency: "EUR", created_on: day(2) });
    const target = await newsApp(fake.db);
    expect(await newsOf(target, ALICE)).toEqual([
      { id, wishlistItemId: wishId, kind: "price_drop", title: "Veste Nuage 07", merchantName: "Boutique Exemple", price: 69.5, threshold: 89, currency: "EUR", seenOn: day(2) },
    ] satisfies WishAlertNews[]);
  });

  it("un retour en stock : ni prix, ni seuil, ni devise ; boutique absente : null", async () => {
    const { fake, wish, alert } = seeded();
    const wishId = wish({ merchant: null });
    const id = alert(wishId, { kind: "restock" });
    const target = await newsApp(fake.db);
    expect(await newsOf(target, ALICE)).toEqual([
      { id, wishlistItemId: wishId, kind: "restock", title: "Veste Nuage 07", merchantName: null, price: null, threshold: null, currency: null, seenOn: day(1) },
    ] satisfies WishAlertNews[]);
  });

  it("l'expiration du 3e jour ne sert qu'à l'envoi : une alerte « expirée » (non envoyée) ou « envoyée » reste montrée ; « périmée », « désactivée » ou « limitée » : jamais", async () => {
    const { fake, wish, alert } = seeded();
    const shown = [alert(wish(), { status: "expired", created_on: day(10) }), alert(wish(), { status: "sent", sent_on: day(3), created_on: day(3) }), alert(wish(), { status: "pending" })];
    for (const status of ["stale", "disabled", "limited"]) alert(wish(), { status });
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id).sort()).toEqual([...shown].sort());
  });

  it("30 jours : une alerte d'il y a 30 jours est montrée ; d'il y a 31 jours (en attente de la purge), non ; datée d'après aujourd'hui, non", async () => {
    const { fake, wish, alert } = seeded();
    const kept = alert(wish(), { status: "expired", created_on: day(30) });
    alert(wish(), { status: "expired", created_on: day(31) });
    alert(wish(), { created_on: day(-1) });
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([kept]);
  });

  it("« Épuisé » (caché dans l'app) n'est jamais montré ; baisse et retour en stock, si", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ stock: "sold_out" }), { kind: "sold_out" });
    const drop = alert(wish());
    const back = alert(wish(), { kind: "restock" });
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id).sort()).toEqual([drop, back].sort());
  });
});

describe("encore vraie aujourd'hui (aucune contradiction avec « Baisse de prix » de la grille)", () => {
  it("baisse : prix revenu au seuil ou au-dessus (below_target faux) → cachée ; toujours sous le seuil → montrée", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ below: false }));
    const still = alert(wish({ below: true }));
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([still]);
  });

  it("baisse : pièce épuisée depuis → cachée ; disponible ou état inconnu → montrée", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ stock: "sold_out" }));
    const shown = [alert(wish({ stock: "in_stock" })), alert(wish({ stock: "unknown" }))];
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id).sort()).toEqual([...shown].sort());
  });

  it("retour en stock : de nouveau épuisée ou état inconnu → caché ; en stock → montré", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ stock: "sold_out" }), { kind: "restock" });
    alert(wish({ stock: "unknown" }), { kind: "restock" });
    const shown = alert(wish({ stock: "in_stock" }), { kind: "restock" });
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([shown]);
  });

  it("pièce achetée (« Je l'ai achetée » : même pièce notée, ou sa proposition dans le Vault) → cachée ; pas achetée → montrée", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ boughtOn: day(1) }));
    alert(wish({ productMatchId: MATCH }));
    fake.table("vault_items").push({ id: uuid("c"), user_id: ALICE, product_match_id: MATCH });
    const shown = alert(wish());
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([shown]);
  });

  it("cloche de cette sorte coupée, ou cloche retirée → cachée ; cloche allumée → montrée", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish({ priceDrop: false }));
    alert(wish({ restock: false }), { kind: "restock" });
    alert(wish({ watch: false }));
    const shown = alert(wish({ priceDrop: true }));
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([shown]);
  });

  it("seuil changé depuis l'alerte : l'écart se mesure avec le seuil d'AUJOURD'HUI (89 → 100 : seuil 100, écart 31 €) ; seuil baissé sous le prix vu, sans seuil ou dans une autre devise → cachée", async () => {
    const { fake, wish, alert } = seeded();
    const raised = alert(wish({ target: "100.00" }), { old_price: "89.00", new_price: "69.00" });
    alert(wish({ target: "65.00" }), { old_price: "89.00", new_price: "69.00" });
    alert(wish({ target: "69.00" }), { old_price: "89.00", new_price: "69.00" });
    alert(wish({ target: null, targetCurrency: null }), { old_price: "89.00", new_price: "69.00" });
    alert(wish({ targetCurrency: "GBP" }), { old_price: "89.00", new_price: "69.00" });
    const target = await newsApp(fake.db);
    const news = await newsOf(target, ALICE);
    expect(news.map((item) => item.id)).toEqual([raised]);
    expect(news[0]).toMatchObject({ price: 69, threshold: 100, currency: "EUR" });
  });

  it("une baisse sans prix complet ni devise lisible → cachée ; complète → montrée", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish(), { currency: "€" });
    alert(wish(), { new_price: "95.00" });
    const shown = alert(wish());
    const target = await newsApp(fake.db);
    expect((await newsOf(target, ALICE)).map((item) => item.id)).toEqual([shown]);
  });
});

describe("bornée et sans doublon", () => {
  it("une seule ligne par envie et par sorte : la plus récente ; deux sortes sur une envie : deux lignes", async () => {
    const { fake, wish, alert } = seeded();
    const wishId = wish();
    alert(wishId, { status: "expired", created_on: day(9), new_price: "79.00" });
    const latest = alert(wishId, { created_on: day(1), new_price: "65.00" });
    const back = alert(wishId, { kind: "restock", created_on: day(4) });
    const target = await newsApp(fake.db);
    const news = await newsOf(target, ALICE);
    expect(news.map((item) => item.id)).toEqual([latest, back]);
    expect(news[0]!.price).toBe(65);
  });

  it(`au plus ${MAX_WISH_ALERT_NEWS} nouveautés, les plus récentes d'abord`, async () => {
    const { fake, wish, alert } = seeded();
    const ids = Array.from({ length: MAX_WISH_ALERT_NEWS + 5 }, (_, index) => alert(wish(), { created_on: day(index % 28) }));
    const target = await newsApp(fake.db);
    const news = await newsOf(target, ALICE);
    expect(news).toHaveLength(MAX_WISH_ALERT_NEWS);
    expect(ids).toEqual(expect.arrayContaining(news.map((item) => item.id)));
    const days = news.map((item) => item.seenOn);
    expect([...days].sort().reverse()).toEqual(days);
  });
});

describe("une lecture seule, discrète", () => {
  it("rien n'est écrit (aucune table changée, seule la sonde est appelée) ; le journal ne dit ni le membre, ni la pièce, ni la boutique", async () => {
    const { fake, wish, alert, rpcCalls } = seeded();
    alert(wish({ title: "Veste Nuage 07", merchant: "Boutique Exemple" }));
    const before = JSON.stringify([...fake.tables.entries()]);
    const target = await newsApp(fake.db);
    expect(await newsOf(target, ALICE)).toHaveLength(1);
    expect(JSON.stringify([...fake.tables.entries()])).toBe(before);
    expect(rpcCalls).toEqual(["wish_alerts_version"]);
    const journal = logs.join("\n");
    expect(journal).not.toContain(ALICE);
    expect(journal).not.toContain("Veste Nuage");
    expect(journal).not.toContain("Boutique Exemple");
  });

  it("base illisible : 500 générique, sans détail ; base lisible : 200", async () => {
    const { fake, wish, alert } = seeded();
    alert(wish());
    const broken = { ...fake.db, from: (name: string) => (name === "wish_alert_events" ? fakeSupabase({ missing: ["wish_alert_events"] }).db.from(name) : fake.db.from(name)) };
    const target = await newsApp(broken);
    const res = await target.inject({ method: "GET", url: "/api/alerts/news", headers: { "x-test-user": ALICE } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal_error", message: expect.any(String) });
    expect(JSON.stringify(res.json())).not.toContain("wish_alert_events");
    expect(await readWishAlertNews({ supabaseAdmin: fake.db, log: target.log } as unknown as FastifyInstance, ALICE)).toHaveLength(1);
  });
});
