import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { flushObservations, type Observation } from "../src/lib/wishObserve.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Alertes prix et stock (lot 2, migrations 0036 et 0040) sur la VRAIE base de
// développement (spotto-dev-2 seulement : tests:ci refuse toute autre base),
// sans aucun appel à SerpApi ni à Expo : les fonctions de la base
// (wish_observe, wish_alerts_claim, wish_alerts_mark_sent, wish_stock_report,
// wish_mark_bought, wish_alerts_purge), leurs contraintes, les cascades,
// l'export et la suppression du compte. Sauté tant que 0036 ET ses
// garde-fous (0040, sonde à 2) ne sont pas appliqués : sans 0040, le serveur
// coupe les alertes.
// Instants fixés dans une année tirée au hasard entre 2080 et 2099 : jamais
// dus pour un vrai serveur qui tournerait sur la même base (rien n'expire ni
// ne part tout seul : une alerte est due dès sa création, mais à un instant
// de cette année-là). Boutiques et pièces fictives.

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("wish_alerts_version");
const migrated = !probe.error && probe.data === 2;

const HOUR = 3_600_000;
const YEAR = 2080 + Math.floor(Math.random() * 20);
/** 10 h UTC (11 h ou midi à Paris) du 10 mars de l'année d'essai, plus `hours`. */
const at = (hours = 0) => new Date(Date.UTC(YEAR, 2, 10, 10) + hours * HOUR).toISOString();
const parisDay = (hours = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(at(hours)));

const OBSERVE_ROWS = z.array(z.object({ matched: z.number(), events: z.number() })).length(1);
const CLAIM_ROWS = z.array(z.object({ event_id: z.string(), user_id: z.string(), wishlist_item_id: z.string(), kind: z.string(), title: z.string(), locale: z.string().nullable() }));
const EVENT_ROWS = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    old_price: z.union([z.number(), z.string()]).nullable(),
    new_price: z.union([z.number(), z.string()]).nullable(),
    currency: z.string().nullable(),
    created_on: z.string(),
    created_at: z.string(),
    send_after: z.string(),
  })
);

let counter = 0;
const uniqueUrl = (label: string) => `https://boutique-essai-${YEAR}.example/${label}-${Date.now().toString(36)}-${(counter += 1)}`;

describe.skipIf(!migrated)("alertes prix et stock sur la base (0036 et 0040)", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let searcher: TestUser;
  let reporter: TestUser;
  const extra: TestUser[] = [];

  /** Un membre à part, avec un appareil : les limites (par personne) d'un test ne gênent jamais un autre. */
  async function freshOwner(label: string): Promise<TestUser> {
    const user = await createTestUser(app, label);
    extra.push(user);
    await device(user);
    return user;
  }

  /** Une envie de `who`, gardée depuis un résultat de sa recherche (prix rangé par le serveur : 100 €). */
  async function wishFromResult(who: TestUser, url: string, price = 100, merchant = "Boutique Essai", language = "fr-FR"): Promise<string> {
    const { data: search, error } = await app.supabaseAdmin.from("product_searches").insert({ user_id: who.id, source_platform: "photo", method: "manual_screenshot", status: "completed" }).select("id").single();
    if (error) throw error;
    const { data: match, error: matchError } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Veste Essai", image_url: "https://images.example/veste.jpg", merchant_url: url, merchant_name: merchant, price_min: price, price_max: price, currency: "€" })
      .select("id")
      .single();
    if (matchError) throw matchError;
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { ...authHeaders(who.token), "accept-language": language },
      payload: { title: "Veste Essai", imageUrl: "https://images.example/veste.jpg", productMatchId: match!.id, priceMin: 1, currency: "USD" },
    });
    expect(res.statusCode).toBe(200);
    return res.json().id as string;
  }

  async function bell(who: TestUser, wishId: string, choice: { priceDrop: boolean; restock: boolean; soldOut?: boolean }) {
    const res = await app.inject({ method: "PUT", url: `/api/wishlist/${wishId}/alerts`, headers: authHeaders(who.token), payload: { ...choice, enableAlerts: true } });
    expect(res.statusCode).toBe(200);
  }

  /** Un appareil qui a accepté les alertes (notify_alerts) et les messages. */
  async function device(who: TestUser) {
    const { error } = await app.supabaseAdmin.from("push_tokens").upsert({ token: `ExponentPushToken[alertes${who.id.slice(0, 8)}]`, user_id: who.id, platform: "ios", notify_messages: true, notify_alerts: true });
    if (error) throw error;
  }

  /** L'interrupteur « Alertes prix et stock » des Réglages. */
  async function alertsSwitch(who: TestUser, enabled: boolean) {
    const res = await app.inject({ method: "PUT", url: "/api/alerts/settings", headers: authHeaders(who.token), payload: { enabled } });
    expect(res.statusCode).toBe(200);
  }

  /** « Je l'ai achetée » sur la proposition d'origine de l'envie (POST /api/vault). */
  async function buy(who: TestUser, wishId: string) {
    const { data: row } = await app.supabaseAdmin.from("wishlist_items").select("product_match_id").eq("id", wishId).single();
    const form = buildMultipart({ title: "Veste Essai", category: "clothing", productMatchId: String(row!.product_match_id) });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(who.token), ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(200);
    await flushObservations();
  }

  /** « Plus disponible » de `who` sur la pièce de `url` (wish_stock_report). */
  async function report(who: TestUser, url: string, hours = 0) {
    const key = trackingKeyOf(url, "Boutique Essai")!;
    const { data, error } = await app.supabaseAdmin.rpc("wish_stock_report", { p_user_id: who.id, p_key: key.hash, p_merchant: key.merchant, p_daily_cap: 20, p_now: at(hours) });
    expect(error).toBeNull();
    return data as { allowed: boolean; matched: number }[];
  }

  async function markPushing(ids: string[], hours: number) {
    const { data, error } = await app.supabaseAdmin.rpc("wish_alerts_mark_pushing", { p_ids: ids, p_now: at(hours) });
    expect(error).toBeNull();
    return data as number;
  }

  /** Jour et heure (Paris) d'un instant. */
  const parisClock = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  const obs = (url: string, cents: number | null, extra: Partial<Observation> = {}): Observation => {
    const key = trackingKeyOf(url, "Boutique Essai")!;
    return { k: key.hash, m: key.merchant, p: cents, c: cents === null ? null : "EUR", n: cents === null ? null : "fr", s: null, ...extra };
  };

  async function observe(batch: Observation[], hours = 0) {
    const { data, error } = await app.supabaseAdmin.rpc("wish_observe", { p_batch: batch, p_now: at(hours) });
    expect(error).toBeNull();
    return OBSERVE_ROWS.parse(data)[0]!;
  }

  async function claim(limit: number, hours: number) {
    const { data, error } = await app.supabaseAdmin.rpc("wish_alerts_claim", { p_limit: limit, p_now: at(hours) });
    expect(error).toBeNull();
    return CLAIM_ROWS.parse(data ?? []);
  }

  async function markSent(ids: string[], hours: number) {
    const { data, error } = await app.supabaseAdmin.rpc("wish_alerts_mark_sent", { p_ids: ids, p_now: at(hours) });
    expect(error).toBeNull();
    return data as number;
  }

  async function events(wishId: string) {
    const { data, error } = await app.supabaseAdmin.from("wish_alert_events").select("*").eq("wishlist_item_id", wishId).order("created_at", { ascending: true });
    expect(error).toBeNull();
    return EVENT_ROWS.parse(data);
  }

  async function tracking(wishId: string) {
    const { data, error } = await app.supabaseAdmin.from("wish_tracking").select("*").eq("wishlist_item_id", wishId).single();
    expect(error).toBeNull();
    return data as Record<string, unknown>;
  }

  /** Les alertes réservées de cette envie (les autres envies de la file sont rendues). */
  async function claimFor(wishId: string, hours: number) {
    const claimed = await claim(200, hours);
    const others = claimed.filter((row) => row.wishlist_item_id !== wishId).map((row) => row.event_id);
    if (others.length > 0) await app.supabaseAdmin.rpc("wish_alerts_release", { p_ids: others });
    return claimed.filter((row) => row.wishlist_item_id === wishId);
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [owner, searcher, reporter] = await Promise.all([createTestUser(app, "apa"), createTestUser(app, "apb"), createTestUser(app, "apc")]);
    await device(owner);
  });

  afterAll(async () => {
    for (const user of extra) await deleteTestUser(app, user.id);
    await deleteTestUser(app, owner.id);
    await deleteTestUser(app, searcher.id);
    await deleteTestUser(app, reporter.id);
    await app.close();
  });

  it("création d'une envie : suivi avec la clé et la référence du SERVEUR (100 €, jamais le prix envoyé par l'app)", async () => {
    const url = uniqueUrl("creation");
    const wish = await wishFromResult(owner, url);
    expect(await tracking(wish)).toMatchObject({ match_key_hash: trackingKeyOf(url, "Boutique Essai")!.hash, merchant_key: "boutiqueessai", ref_currency: "EUR", ref_country: "fr", member_country: "fr", stock_state: "unknown", sold_out_source: null, bought_on: null });
    expect(Number((await tracking(wish)).ref_price)).toBe(100);
  });

  it("baisse de prix : une alerte due TOUT DE SUITE (décision du fondateur, « à la seconde près ») ; la référence ne bouge qu'à l'envoi (règle B)", async () => {
    const member = await freshOwner("apb1");
    const url = uniqueUrl("baisse");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true });
    expect(await observe([obs(url, 8990)])).toEqual({ matched: 1, events: 1 });
    const [event] = await events(wish);
    expect(event).toMatchObject({ kind: "price_drop", status: "pending", currency: "EUR", created_on: parisDay() });
    expect([Number(event!.old_price), Number(event!.new_price)]).toEqual([100, 89.9]);
    // Due dès sa création : aucun délai.
    expect(Date.parse(event!.send_after)).toBe(Date.parse(event!.created_at));
    expect(Number((await tracking(wish)).ref_price)).toBe(100);
    // Réservée au même instant que l'observation (le serveur la réclame juste après).
    const claimed = await claimFor(wish, 0);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ user_id: member.id, kind: "price_drop", title: "Veste Essai" });
    expect(await markSent([claimed[0]!.event_id], 0)).toBe(1);
    expect(Number((await tracking(wish)).ref_price)).toBe(89.9);
    expect((await events(wish))[0]!.status).toBe("sent");
  });

  it("règle B : 100 → 120 → 110, aucune alerte", async () => {
    const url = uniqueUrl("regle-b");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 12000)]);
    await observe([obs(url, 11000)], 1);
    expect(await events(wish)).toEqual([]);
    expect(Number((await tracking(wish)).ref_price)).toBe(100);
    expect(Number((await tracking(wish)).last_price)).toBe(110);
  });

  it("pièce absente des résultats, semblable mais différente, autre boutique moins chère : aucune alerte", async () => {
    const url = uniqueUrl("absente");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: true });
    // Absente : d'autres pièces seulement.
    await observe([obs(uniqueUrl("autre-piece"), 5000)]);
    // Semblable mais différente : une autre variante (paramètre gardé dans la clé).
    await observe([obs(`${url}?couleur=rouge`, 5000)]);
    // Autre boutique moins chère : même chemin, autre site.
    await observe([obs(url.replace("boutique-essai", "boutique-concurrente"), 5000)]);
    // Même clé, autre boutique annoncée : ce n'est pas la même pièce.
    await observe([{ ...obs(url, 5000), m: "boutiqueconcurrente" }]);
    expect(await events(wish)).toEqual([]);
    expect((await tracking(wish)).last_price).toBeNull();
  });

  it("devise différente : aucune alerte (le dernier prix vu est noté) ; autre pays que celui du membre : ignoré (0040)", async () => {
    const url = uniqueUrl("devise");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: true });
    await observe([{ ...obs(url, 5000), c: "USD" }]);
    await observe([{ ...obs(url, 4000), n: "gb" }], 1);
    expect(await events(wish)).toEqual([]);
    expect(await tracking(wish)).toMatchObject({ last_currency: "USD", last_country: "fr", ref_country: "fr" });
    expect(Number((await tracking(wish)).last_price)).toBe(50);
  });

  it("pays du membre (0040) : envie gardée en anglais depuis le Royaume-Uni → référence fixée et comparée seulement avec les observations « gb »", async () => {
    const member = await freshOwner("apb8");
    const url = uniqueUrl("pays-membre");
    // Envie à la main (aucune référence de départ), en anglais depuis le Royaume-Uni.
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { ...authHeaders(member.token), "accept-language": "en-GB" },
      payload: { title: "Veste Essai", imageUrl: "https://images.example/veste.jpg", merchantUrl: url },
    });
    expect(res.statusCode).toBe(200);
    const wish = res.json().id as string;
    await bell(member, wish, { priceDrop: true, restock: false });
    const key = (await tracking(wish)).match_key_hash as string;
    const seen = (cents: number, country: string): Observation => ({ k: key, m: null, p: cents, c: "EUR", n: country, s: null });
    expect(await tracking(wish)).toMatchObject({ member_country: "gb", ref_price: null });
    // Une observation venue d'ailleurs ne fixe rien (avant 0040 : elle figeait la référence).
    await observe([seen(10000, "nz")]);
    await observe([seen(10000, "fr")], 1);
    expect(await tracking(wish)).toMatchObject({ ref_price: null, last_price: null });
    await observe([seen(10000, "gb")], 2);
    expect(await tracking(wish)).toMatchObject({ ref_country: "gb" });
    await observe([seen(5000, "fr")], 3);
    expect(await events(wish)).toEqual([]);
    await observe([seen(5000, "gb")], 4);
    expect((await events(wish)).map((event) => event.kind)).toEqual(["price_drop"]);
  });

  it("épuisé explicite (Google « in_stock: false ») : épuisé, alerte seulement avec la cloche « épuisé » ; retour en stock ensuite", async () => {
    const url = uniqueUrl("epuise");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: false, restock: true, soldOut: true });
    await observe([obs(url, null, { s: false })]);
    expect((await tracking(wish)).stock_state).toBe("sold_out");
    expect((await events(wish)).map((event) => event.kind)).toEqual(["sold_out"]);
    await observe([obs(url, null, { s: true })], 1);
    expect((await tracking(wish)).stock_state).toBe("in_stock");
    expect((await events(wish)).map((event) => event.kind)).toEqual(["sold_out", "restock"]);
  });

  it("« Plus disponible » (0040) : un seul membre ne touche que SES envies ; à deux membres différents, toutes passent épuisée — en SILENCE, et le retour en stock ensuite n'envoie RIEN", async () => {
    const url = uniqueUrl("signalement");
    const watcher = await freshOwner("apc1");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: true, restock: true, soldOut: true });
    const first = await freshOwner("apc2");
    const firstWish = await wishFromResult(first, url);
    // Un seul auteur : seule son envie change.
    expect(await report(first, url)).toEqual([{ allowed: true, matched: 1 }]);
    expect(await tracking(firstWish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    expect(await tracking(wish)).toMatchObject({ stock_state: "unknown", sold_out_source: null });
    // Le même membre encore : toujours un seul auteur.
    expect(await report(first, url, 1)).toEqual([{ allowed: true, matched: 0 }]);
    expect((await tracking(wish)).stock_state).toBe("unknown");
    const { data: reports } = await app.supabaseAdmin.from("stock_reports").select("user_id, match_key_hash, created_on").eq("user_id", first.id);
    expect(reports).toContainEqual({ user_id: first.id, match_key_hash: trackingKeyOf(url, "Boutique Essai")!.hash, created_on: parisDay() });
    // Un deuxième membre : toutes les envies de la pièce, sans alerte.
    const second = await freshOwner("apc3");
    expect((await report(second, url, 2))[0]!.allowed).toBe(true);
    expect(await tracking(wish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    expect(await events(wish)).toEqual([]);
    // Une baisse de prix n'est pas bloquée par des signalements.
    await observe([obs(url, 8000)], 3);
    expect((await events(wish)).map((event) => event.kind)).toEqual(["price_drop"]);
    // La pièce revue en stock : l'état revient, sans « De retour en stock ».
    await observe([obs(url, 8000, { s: true })], 4);
    expect(await tracking(wish)).toMatchObject({ stock_state: "in_stock", sold_out_source: null });
    expect((await events(wish)).map((event) => event.kind)).toEqual(["price_drop"]);
  });

  it("une seule envie regardée par membre et par pièce (0040) : trois envies de la même pièce chez un membre, une seule mise à jour", async () => {
    const member = await freshOwner("apc4");
    const url = uniqueUrl("trois-envies");
    const wishes = [];
    for (let index = 0; index < 3; index += 1) {
      const res = await app.inject({ method: "POST", url: "/api/wishlist", headers: { ...authHeaders(member.token), "accept-language": "fr-FR" }, payload: { title: `Veste ${index}`, imageUrl: "https://images.example/veste.jpg", merchantUrl: url } });
      expect(res.statusCode).toBe(200);
      wishes.push(res.json().id as string);
    }
    const key = (await tracking(wishes[0]!)).match_key_hash as string;
    expect(await observe([{ k: key, m: null, p: 9000, c: "EUR", n: "fr", s: true }])).toMatchObject({ matched: 1 });
    const seen = await Promise.all(wishes.map(async (wish) => (await tracking(wish)).last_seen_on));
    expect(seen.filter((day) => day !== null)).toHaveLength(1);
  });

  it("« Plus disponible » : au plus N par membre et par jour de Paris ; le lendemain, de nouveau permis", async () => {
    const key = trackingKeyOf(uniqueUrl("limite-signalement"), "Boutique Essai")!;
    const report = (hours: number) => app.supabaseAdmin.rpc("wish_stock_report", { p_user_id: searcher.id, p_key: key.hash, p_merchant: null, p_daily_cap: 2, p_now: at(hours) });
    expect((await report(0)).data).toEqual([{ allowed: true, matched: 0 }]);
    expect((await report(1)).data).toEqual([{ allowed: true, matched: 0 }]);
    expect((await report(2)).data).toEqual([{ allowed: false, matched: 0 }]);
    expect((await report(24)).data).toEqual([{ allowed: true, matched: 0 }]);
  });

  it("achat via Spotto (« Je l'ai achetée ») : disponibilité annoncée → retour en stock pour les AUTRES membres, jamais pour l'acheteur, et jamais l'acheteur gardé", async () => {
    const url = uniqueUrl("achat");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: false, restock: true });
    // La boutique annonce la pièce épuisée (seul un tel « épuisé » est suivi d'un retour en stock, 0040).
    await observe([obs(url, null, { s: false })], -1);
    // L'acheteur (searcher) a la même pièce dans ses envies, et l'achète.
    const buyerWish = await wishFromResult(searcher, url);
    await app.inject({ method: "PUT", url: `/api/wishlist/${buyerWish}/alerts`, headers: authHeaders(searcher.token), payload: { priceDrop: false, restock: true, enableAlerts: true } });
    const { data: buyerRow } = await app.supabaseAdmin.from("wishlist_items").select("product_match_id").eq("id", buyerWish).single();
    const form = buildMultipart({ title: "Veste Essai", category: "clothing", productMatchId: String(buyerRow!.product_match_id) });
    const bought = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(searcher.token), ...form.headers }, payload: form.payload });
    expect(bought.statusCode).toBe(200);
    await flushObservations();
    expect((await events(wish)).map((event) => event.kind)).toEqual(["restock"]);
    expect(await events(buyerWish)).toEqual([]);
    // Les envies de l'acheteur de cette pièce sont notées achetées (0040).
    expect((await tracking(buyerWish)).bought_on).not.toBeNull();
    const { data: rows } = await app.supabaseAdmin.from("wish_alert_events").select("*").eq("wishlist_item_id", wish);
    for (const row of rows ?? []) {
      expect(row.user_id).toBe(owner.id);
      expect(JSON.stringify(row)).not.toContain(searcher.id);
    }
  });

  it("cloche absente, ou cloche coupée après la création d'une alerte : suivi mis à jour, aucune alerte ; coupée après coup : « désactivée »", async () => {
    const noBell = await wishFromResult(owner, uniqueUrl("sans-cloche"));
    const url = uniqueUrl("coupe-apres");
    const later = await wishFromResult(owner, url);
    await bell(owner, later, { priceDrop: true, restock: false });
    await observe([obs(url, 5000)]);
    await app.inject({ method: "PUT", url: `/api/wishlist/${later}/alerts`, headers: authHeaders(owner.token), payload: { priceDrop: false, restock: false } });
    await claim(0, 9);
    expect((await events(later))[0]!.status).toBe("disabled");
    const { data: noBellTracking } = await app.supabaseAdmin.from("wish_tracking").select("match_key_hash").eq("wishlist_item_id", noBell).single();
    await observe([{ k: noBellTracking!.match_key_hash as string, m: "boutiqueessai", p: 5000, c: "EUR", n: "fr", s: null }]);
    expect(await events(noBell)).toEqual([]);
    expect(Number((await tracking(noBell)).last_price)).toBe(50);
  });

  it("interrupteur des Réglages coupé (cloche allumée) : aucune alerte ; coupé après la création d'une alerte : « désactivée » à l'envoi", async () => {
    const member = await freshOwner("apb4");
    const base = 24 * 270;
    const url = uniqueUrl("interrupteur");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true });
    await alertsSwitch(member, false);
    expect(await observe([obs(url, 9000)], base)).toEqual({ matched: 1, events: 0 });
    expect(await events(wish)).toEqual([]);
    expect(Number((await tracking(wish)).last_price)).toBe(90);
    // Rallumé : la baisse (référence inchangée) crée une alerte ; recoupé avant l'envoi : « désactivée ».
    await alertsSwitch(member, true);
    expect(await observe([obs(url, 8500)], base + 1)).toEqual({ matched: 1, events: 1 });
    await alertsSwitch(member, false);
    await claim(0, base + 10);
    expect((await events(wish)).map((event) => event.status)).toEqual(["disabled"]);
    expect(Number((await tracking(wish)).ref_price)).toBe(100);
  });

  it("pièce achetée (dans le Vault) : aucune alerte pour une baisse ; une baisse déjà en attente devient « périmée » à l'envoi", async () => {
    const member = await freshOwner("apb5");
    const base = 24 * 300;
    // Achetée d'abord, puis une baisse : aucune alerte.
    const boughtUrl = uniqueUrl("achetee-avant");
    const boughtFirst = await wishFromResult(member, boughtUrl);
    await bell(member, boughtFirst, { priceDrop: true, restock: true });
    await buy(member, boughtFirst);
    expect(await observe([obs(boughtUrl, 8000)], base)).toEqual({ matched: 1, events: 0 });
    expect(await events(boughtFirst)).toEqual([]);
    // Une baisse en attente, puis l'achat : jamais envoyée, et jamais mise à jour par une baisse suivante.
    const url = uniqueUrl("achetee-apres");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], base + 1);
    await buy(member, wish);
    await observe([obs(url, 7000)], base + 2);
    expect((await events(wish)).map((event) => [event.status, Number(event.new_price)])).toEqual([["pending", 90]]);
    expect(await claimFor(wish, base + 12)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("stale");
    expect(Number((await tracking(wish)).ref_price)).toBe(100);
  });

  it("baisse de prix d'une pièce épuisée par la boutique : aucune alerte (« in_stock: false ») ; baisse en attente puis épuisé annoncé : « périmée » à l'envoi ; puis signalements : PAS périmée (0040)", async () => {
    const member = await freshOwner("apb7");
    const base = 24 * 330;
    const soldOutUrl = uniqueUrl("baisse-epuisee");
    const soldOut = await wishFromResult(member, soldOutUrl);
    await bell(member, soldOut, { priceDrop: true, restock: false });
    expect(await observe([obs(soldOutUrl, 8000, { s: false })], base)).toEqual({ matched: 1, events: 0 });
    expect(await tracking(soldOut)).toMatchObject({ stock_state: "sold_out" });
    const url = uniqueUrl("baisse-puis-signalement");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 8000)], base);
    await observe([obs(url, null, { s: false })], base + 1);
    expect(await claimFor(wish, base + 12)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("stale");
    // Une baisse en attente, puis deux signalements « Plus disponible » : elle part quand même.
    const reportedUrl = uniqueUrl("baisse-puis-signalements");
    const reportedWish = await wishFromResult(member, reportedUrl);
    await bell(member, reportedWish, { priceDrop: true, restock: false });
    await observe([obs(reportedUrl, 8000)], base + 24);
    await report(reporter, reportedUrl, base + 25);
    await report(searcher, reportedUrl, base + 25);
    expect(await tracking(reportedWish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    expect(await claimFor(reportedWish, base + 26)).toHaveLength(1);
  });

  it("« Plus disponible » (un ou deux comptes), puis une recherche ou un achat : jamais de faux « De retour en stock » chez les autres (acces-2, alertes-01, entrees-06)", async () => {
    const url = uniqueUrl("signale-puis-achete");
    const watcher = await freshOwner("apb6");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: false, restock: true });
    const cheater = await freshOwner("apb6b");
    const cheaterWish = await wishFromResult(cheater, url);
    const reported = await app.inject({ method: "POST", url: "/api/alerts/stock-reports", headers: authHeaders(cheater.token), payload: { wishlistItemId: cheaterWish } });
    expect(reported.statusCode).toBe(204);
    // Un seul membre : l'envie du membre qui surveille ne change pas.
    expect((await tracking(wish)).stock_state).toBe("unknown");
    // Sa propre recherche montre la pièce en stock : rien chez les autres.
    await observe([obs(url, null, { s: true })], 1);
    expect(await events(wish)).toEqual([]);
    // Avec un deuxième compte : épuisée chez tous… puis achat et recherche : toujours rien.
    const accomplice = await freshOwner("apb6c");
    const accompliceWish = await wishFromResult(accomplice, url);
    expect((await app.inject({ method: "POST", url: "/api/alerts/stock-reports", headers: authHeaders(accomplice.token), payload: { wishlistItemId: accompliceWish } })).statusCode).toBe(204);
    expect(await tracking(wish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    await buy(accomplice, accompliceWish);
    await observe([obs(url, null, { s: true })], 2);
    expect(await events(wish)).toEqual([]);
    expect((await tracking(wish)).stock_state).toBe("in_stock");
  });

  it("« Je l'ai achetée » depuis un AUTRE résultat de la même pièce (alertes-04) : toutes les envies du membre de cette pièce sont achetées — cloche cachée, aucune alerte ; retirée du Vault : les alertes reviennent", async () => {
    const member = await freshOwner("apc5");
    const url = uniqueUrl("autre-resultat");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true });
    // Une autre recherche retrouve la même pièce (autre proposition) : achetée là.
    const other = await wishFromResult(member, url);
    const { data: otherRow } = await app.supabaseAdmin.from("wishlist_items").select("product_match_id").eq("id", other).single();
    await app.supabaseAdmin.from("wishlist_items").delete().eq("id", other);
    const form = buildMultipart({ title: "Veste Essai", category: "clothing", productMatchId: String(otherRow!.product_match_id) });
    const bought = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(member.token), ...form.headers }, payload: form.payload });
    expect(bought.statusCode).toBe(200);
    await flushObservations();
    expect((await tracking(wish)).bought_on).not.toBeNull();
    const state = await app.inject({ method: "GET", url: `/api/wishlist/${wish}/alerts`, headers: authHeaders(member.token) });
    expect(state.json()).toMatchObject({ bought: true });
    await observe([obs(url, 7000)], 1);
    expect(await events(wish)).toEqual([]);
    // Retirée du Vault : de nouveau suivie.
    const removed = await app.inject({ method: "DELETE", url: `/api/vault/${bought.json().id}`, headers: authHeaders(member.token) });
    expect(removed.statusCode).toBe(204);
    expect((await tracking(wish)).bought_on).toBeNull();
  });

  it("envoi demandé à Expo mais jamais noté : jamais renvoyé, noté « envoyée » au passage suivant (référence comprise) ; jamais expiré pendant son envoi", async () => {
    const member = await freshOwner("apb8");
    const base = 24 * 360;
    const url = uniqueUrl("jamais-renvoyee");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], base);
    const [claimed] = await claimFor(wish, base + 9);
    expect(await markPushing([claimed!.event_id], base + 9)).toBe(1);
    // L'envoi n'a pas pu être noté. 10 minutes après : toujours réservée, pas reprise.
    expect(await claimFor(wish, base + 9 + 10 / 60)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("pending");
    // Réservation échue : notée « envoyée », jamais renvoyée ; la référence bouge (règle B).
    expect(await claimFor(wish, base + 9 + 20 / 60)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("sent");
    expect(Number((await tracking(wish)).ref_price)).toBe(90);
    // Réservée juste avant 72 h : l'expiration ne la prend pas pendant son envoi.
    const lateUrl = uniqueUrl("envoi-a-72h");
    const late = await wishFromResult(member, lateUrl);
    await bell(member, late, { priceDrop: true, restock: false });
    await observe([obs(lateUrl, 9000)], base + 24 * 10);
    const [lateClaim] = await claimFor(late, base + 24 * 10 + 71.9);
    await claim(0, base + 24 * 10 + 72.05);
    expect((await events(late))[0]!.status).toBe("pending");
    expect(await markSent([lateClaim!.event_id], base + 24 * 10 + 72.05)).toBe(1);
    expect((await events(late))[0]!.status).toBe("sent");
  });

  it("périmée : le prix est remonté avant l'envoi ; une alerte en attente garde le prix le plus bas", async () => {
    const url = uniqueUrl("perimee");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)]);
    await observe([obs(url, 8000)], 1);
    expect((await events(wish)).map((event) => Number(event.new_price))).toEqual([80]);
    await observe([obs(url, 9500)], 2);
    expect(await claimFor(wish, 12)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("stale");
  });

  it("anti-répétition : une alerte par envie et par sorte sur 7 jours (« limitée », la référence ne bouge pas), puis la même baisse revient", async () => {
    const member = await freshOwner("apb2");
    const url = uniqueUrl("sept-jours");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)]);
    await markSent((await claimFor(wish, 9)).map((row) => row.event_id), 9);
    await observe([obs(url, 8000)], 24);
    expect(await claimFor(wish, 33)).toEqual([]);
    expect((await events(wish))[1]!.status).toBe("limited");
    expect(Number((await tracking(wish)).ref_price)).toBe(90);
    await observe([obs(url, 8000)], 24 * 8);
    const again = await claimFor(wish, 24 * 8 + 9);
    expect(again).toHaveLength(1);
    await markSent([again[0]!.event_id], 24 * 8 + 9);
    expect(Number((await tracking(wish)).ref_price)).toBe(80);
  });

  it("anti-répétition : 5 alertes par personne et par jour de Paris ; au-delà, elles attendent le lendemain (retour en stock compris) ; réservation atomique", async () => {
    const member = await freshOwner("apb3");
    const day = 24 * 30;
    const wishes: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const url = uniqueUrl(`cinq-${index}`);
      const wish = await wishFromResult(member, url);
      await bell(member, wish, { priceDrop: true, restock: false });
      await observe([obs(url, 9000)], day);
      wishes.push(wish);
    }
    // Deux passages simultanés ne prennent jamais la même.
    const [first, second] = await Promise.all([claim(200, day + 9), claim(200, day + 9)]);
    const mine = [...first, ...second].filter((row) => wishes.includes(row.wishlist_item_id));
    expect(mine).toHaveLength(5);
    expect(new Set(mine.map((row) => row.event_id)).size).toBe(5);
    expect(await markSent(mine.map((row) => row.event_id), day + 9)).toBe(5);
    // Les deux autres attendent le début du jour de Paris suivant (dans leurs 72 h), jamais « limitée ».
    const held = (await Promise.all(wishes.map(async (wish) => (await events(wish))[0]!))).filter((event) => event.status === "pending");
    expect(held).toHaveLength(2);
    for (const event of held) expect(parisClock(event.send_after)).toBe(`${parisDay(day + 24)}, 00:00`);
    // Un retour en stock dû le même jour : il attend aussi (sans référence, il ne reviendrait jamais sinon).
    const restockUrl = uniqueUrl("cinq-retour");
    const restockWish = await wishFromResult(member, restockUrl);
    await bell(member, restockWish, { priceDrop: false, restock: true });
    await observe([obs(restockUrl, null, { s: false })], day);
    await observe([obs(restockUrl, null, { s: true })], day + 0.5);
    expect(await claimFor(restockWish, day + 9.5)).toEqual([]);
    const [restock] = await events(restockWish);
    expect(restock).toMatchObject({ kind: "restock", status: "pending" });
    expect(parisClock(restock!.send_after)).toBe(`${parisDay(day + 24)}, 00:00`);
    // Le lendemain : les trois partent (revérifiées alors).
    const nextDay = await claim(200, day + 24);
    expect(nextDay.filter((row) => [...wishes, restockWish].includes(row.wishlist_item_id))).toHaveLength(3);
  });

  it("notifications coupées (p_limit 0) ou sans appareil : en attente ; expiration à 72 h, jamais envoyée", async () => {
    const url = uniqueUrl("expiration");
    const wish = await wishFromResult(reporter, url);
    await bell(reporter, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], 24 * 60);
    expect(await claimFor(wish, 24 * 60 + 9)).toEqual([]);
    await claim(0, 24 * 60 + 10);
    expect((await events(wish))[0]!.status).toBe("pending");
    await claim(0, 24 * 60 + 73);
    expect((await events(wish))[0]!.status).toBe("expired");
  });

  it("contraintes : empreinte, devise, prix d'une baisse, une seule alerte en attente, même membre que l'envie", async () => {
    const wish = await wishFromResult(owner, uniqueUrl("contraintes"));
    expect((await app.supabaseAdmin.from("wish_tracking").update({ match_key_hash: "https://boutique.example/p" }).eq("wishlist_item_id", wish)).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_tracking").update({ ref_currency: "€" }).eq("wishlist_item_id", wish)).error?.code).toBe("23514");
    const base = { wishlist_item_id: wish, user_id: owner.id, created_on: parisDay(), send_after: at() };
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "price_drop" })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "restock" })).error).toBeNull();
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "restock" })).error?.code).toBe("23505");
    // « Peut-être envoyée » sans réservation : refusé.
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "sold_out", pushing_at: at() })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_watches").insert({ wishlist_item_id: wish, user_id: searcher.id })).error?.code).toBe("23503");
  });

  it("purge à 30 jours : alertes et signalements", async () => {
    const url = uniqueUrl("purge");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], -24 * 400);
    const { error } = await app.supabaseAdmin.rpc("wish_alerts_purge", { p_limit: 5000, p_now: at() });
    expect(error).toBeNull();
    expect(await events(wish)).toEqual([]);
  });

  it("export RGPD : cloches, suivi, alertes (en attente comprises) et signalements du membre, au jour près, sans clé ni pays d'observation", async () => {
    const wish = await wishFromResult(owner, uniqueUrl("export"));
    const closed = await app.supabaseAdmin
      .from("wish_alert_events")
      .insert({ wishlist_item_id: wish, user_id: owner.id, kind: "restock", created_on: "2026-11-01", created_at: "2026-11-01T10:00:00Z", send_after: "2026-11-01T10:00:00Z", status: "expired" })
      .select("id")
      .single();
    expect(closed.error).toBeNull();
    const pending = await app.supabaseAdmin
      .from("wish_alert_events")
      .insert({ wishlist_item_id: wish, user_id: owner.id, kind: "sold_out", created_on: parisDay(), created_at: at(), send_after: at() })
      .select("id")
      .single();
    expect(pending.error).toBeNull();
    const body = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(owner.token) })).json();
    const exportedIds = body.wishAlertEvents.map((row: { id: string }) => row.id);
    expect(exportedIds).toContain(closed.data!.id);
    expect(exportedIds).toContain(pending.data!.id);
    expect(body.wishWatches.length).toBeGreaterThan(0);
    expect(body.wishTracking.length).toBeGreaterThan(0);
    expect(body.wishAlertEvents.length).toBeGreaterThan(0);
    for (const row of body.wishTracking) {
      expect(row).not.toHaveProperty("match_key_hash");
      expect(row).not.toHaveProperty("last_country");
      expect(row).not.toHaveProperty("updated_at");
    }
    for (const row of body.wishAlertEvents) {
      expect(Object.keys(row).sort()).toEqual(["created_on", "currency", "id", "kind", "new_price", "old_price", "status", "wishlist_item_id", "wishlist_item_title"]);
    }
    const reporterExport = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(reporter.token) })).json();
    expect(reporterExport.stockReports.length).toBeGreaterThan(0);
  });

  it("suppression du compte : suivi, cloches, alertes et signalements partent avec lui (cascade)", async () => {
    const gone = await createTestUser(app, "apd");
    const url = uniqueUrl("suppression");
    const wish = await wishFromResult(gone, url);
    await bell(gone, wish, { priceDrop: true, restock: true });
    await observe([obs(url, 9000)]);
    await app.supabaseAdmin.rpc("wish_stock_report", { p_user_id: gone.id, p_key: trackingKeyOf(url, "Boutique Essai")!.hash, p_merchant: null, p_daily_cap: 20, p_now: at() });
    const res = await app.inject({ method: "DELETE", url: "/api/me", headers: authHeaders(gone.token), payload: { confirmation: "SUPPRIMER" } });
    expect(res.statusCode).toBe(204);
    for (const table of ["wish_tracking", "wish_watches", "wish_alert_events", "stock_reports"]) {
      const { count, error } = await app.supabaseAdmin.from(table).select("*", { count: "exact", head: true }).eq("user_id", gone.id);
      expect(error, table).toBeNull();
      expect(count, table).toBe(0);
    }
    await deleteTestUser(app, gone.id);
  });
});
