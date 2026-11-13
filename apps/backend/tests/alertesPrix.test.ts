import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "../src/env.js";
import { trackingKeyOf } from "../src/lib/alertKeys.js";
import { flushObservations, type Observation } from "../src/lib/wishObserve.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Alertes prix et stock (lot 2, migrations 0036, 0040 et 0041) sur la VRAIE
// base de développement (spotto-dev-2 seulement : tests:ci refuse toute autre
// base), sans aucun appel à SerpApi ni à Expo : les fonctions de la base
// (wish_observe, wish_alerts_claim, wish_alerts_mark_sent, wish_stock_report,
// wish_mark_bought, wish_alerts_purge), leurs contraintes, les cascades,
// l'export et la suppression du compte. Sauté tant que 0041 (nouvelle
// version, sonde à 3) n'est pas appliquée : sans elle, le serveur coupe les
// alertes. Les mêmes règles sont vérifiées sans Supabase sur une base
// Postgres locale et jetable (scénarios de la migration 0041).
// Instants fixés dans une année tirée au hasard entre 2080 et 2099 : jamais
// dus pour un vrai serveur qui tournerait sur la même base (rien n'expire ni
// ne part tout seul : une alerte est due dès sa création, mais à un instant
// de cette année-là). Boutiques et pièces fictives.

const probe = await createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).rpc("wish_alerts_version");
const migrated = !probe.error && probe.data === 3;

const HOUR = 3_600_000;
const YEAR = 2080 + Math.floor(Math.random() * 20);
/** 10 h UTC (11 h ou midi à Paris) du 10 mars de l'année d'essai, plus `hours`. */
const at = (hours = 0) => new Date(Date.UTC(YEAR, 2, 10, 10) + hours * HOUR).toISOString();
const parisDay = (hours = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(at(hours)));

const OBSERVE_ROWS = z.array(z.object({ matched: z.number(), events: z.number() })).length(1);
// 0041 : la file ne renvoie que l'alerte, sa sorte, l'envie et la langue (ni titre, ni boutique, ni prix).
const CLAIM_ROWS = z.array(z.object({ event_id: z.string(), user_id: z.string(), wishlist_item_id: z.string(), kind: z.string(), locale: z.string().nullable() }).strict());
const EVENT_ROWS = z.array(
  z.object({
    id: z.string(),
    kind: z.string(),
    status: z.string(),
    old_price: z.union([z.number(), z.string()]).nullable(),
    new_price: z.union([z.number(), z.string()]).nullable(),
    currency: z.string().nullable(),
    created_on: z.string(),
    sent_on: z.string().nullable(),
    claimed_at: z.string().nullable(),
    pushing_at: z.string().nullable(),
  })
);

let counter = 0;
const uniqueUrl = (label: string) => `https://boutique-essai-${YEAR}.example/${label}-${Date.now().toString(36)}-${(counter += 1)}`;

describe.skipIf(!migrated)("alertes prix et stock sur la base (0036, 0040 et 0041)", () => {
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

  async function bell(who: TestUser, wishId: string, choice: { priceDrop: boolean; restock: boolean; soldOut?: boolean; targetPrice?: number | null }) {
    const res = await app.inject({ method: "PUT", url: `/api/wishlist/${wishId}/alerts`, headers: authHeaders(who.token), payload: { ...choice, enableAlerts: true } });
    expect(res.statusCode).toBe(200);
    return res.json().state as Record<string, unknown>;
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

  /** « Aider les autres membres » (0041). */
  async function helpOthers(who: TestUser, helpOthers: boolean) {
    const res = await app.inject({ method: "PUT", url: "/api/alerts/settings", headers: authHeaders(who.token), payload: { helpOthers } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ helpOthers });
  }

  /** « Je l'ai achetée » sur la proposition d'origine de l'envie (POST /api/vault). */
  async function buy(who: TestUser, wishId: string) {
    const { data: row } = await app.supabaseAdmin.from("wishlist_items").select("product_match_id").eq("id", wishId).single();
    const form = buildMultipart({ title: "Veste Essai", category: "clothing", productMatchId: String(row!.product_match_id) });
    const res = await app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(who.token), ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(200);
    await flushObservations();
    return res.json() as { id: string };
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

  const obs = (url: string, cents: number | null, extra: Partial<Observation> = {}): Observation => {
    const key = trackingKeyOf(url, "Boutique Essai")!;
    return { k: key.hash, m: key.merchant, p: cents, c: cents === null ? null : "EUR", n: cents === null ? null : "fr", s: null, ...extra };
  };

  /** Une observation, faite par la recherche de `by` (par défaut : searcher, qui aide les autres membres). */
  async function observe(batch: Observation[], hours = 0, by: TestUser = searcher) {
    const { data, error } = await app.supabaseAdmin.rpc("wish_observe", { p_batch: batch, p_observer: by.id, p_now: at(hours) });
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

  /** Les alertes d'une envie, par jour de création puis par sorte (aucune heure n'est gardée). */
  async function events(wishId: string) {
    const { data, error } = await app.supabaseAdmin.from("wish_alert_events").select("*").eq("wishlist_item_id", wishId).order("created_on", { ascending: true }).order("kind", { ascending: true });
    expect(error).toBeNull();
    return EVENT_ROWS.parse(data);
  }

  async function watch(wishId: string) {
    const { data, error } = await app.supabaseAdmin.from("wish_watches").select("*").eq("wishlist_item_id", wishId).single();
    expect(error).toBeNull();
    return data as Record<string, unknown>;
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

  it("création d'une envie : suivi avec l'empreinte et le dernier prix vu du SERVEUR (100 €, jamais le prix envoyé par l'app) ; la cloche pré-remplit son seuil avec lui", async () => {
    const url = uniqueUrl("creation");
    const wish = await wishFromResult(owner, url);
    expect(await tracking(wish)).toMatchObject({ match_key_hash: trackingKeyOf(url, "Boutique Essai")!.hash, key_version: 2, merchant_key: "boutiqueessai", last_currency: "EUR", last_country: "fr", member_country: "fr", stock_state: "unknown", sold_out_source: null, bought_on: null });
    expect(Number((await tracking(wish)).last_price)).toBe(100);
    expect(await tracking(wish)).not.toHaveProperty("ref_price");
    const state = await bell(owner, wish, { priceDrop: true, restock: false });
    expect(state).toMatchObject({ targetPrice: 100, targetCurrency: "EUR", lastPrice: 100, lastCurrency: "EUR" });
    expect(await watch(wish)).toMatchObject({ target_currency: "EUR", target_country: "fr", below_target: false });
  });

  it("seuil : une alerte quand le prix PASSE sous lui, due TOUT DE SUITE ; une seule par passage ; réarmée au seuil ou au-dessus ; le jour seulement, la réservation effacée", async () => {
    const member = await freshOwner("apb1");
    const url = uniqueUrl("seuil");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true, targetPrice: 95 });
    expect(await observe([obs(url, 9800)])).toEqual({ matched: 1, events: 0 });
    expect(await observe([obs(url, 8990)], 1)).toEqual({ matched: 1, events: 1 });
    const [event] = await events(wish);
    expect(event).toMatchObject({ kind: "price_drop", status: "pending", currency: "EUR", created_on: parisDay(1), sent_on: null, claimed_at: null });
    expect([Number(event!.old_price), Number(event!.new_price)]).toEqual([95, 89.9]);
    expect(await watch(wish)).toMatchObject({ below_target: true });
    // Toujours sous le seuil : rien de plus, à chaque recherche.
    expect(await observe([obs(url, 8500)], 2)).toEqual({ matched: 1, events: 0 });
    // Réservée au même instant que l'observation (le serveur la réclame juste après).
    const claimed = await claimFor(wish, 2);
    expect(claimed).toEqual([expect.objectContaining({ event_id: event!.id, user_id: member.id, wishlist_item_id: wish, kind: "price_drop" })]);
    expect(Object.keys(claimed[0]!).sort()).toEqual(["event_id", "kind", "locale", "user_id", "wishlist_item_id"]);
    expect((await events(wish))[0]!.claimed_at).not.toBeNull();
    expect(await markSent([claimed[0]!.event_id], 2)).toBe(1);
    // Envoyée : le jour seulement, aucune heure de réservation gardée ; le seuil ne bouge pas.
    expect((await events(wish))[0]).toMatchObject({ status: "sent", sent_on: parisDay(2), claimed_at: null, pushing_at: null });
    expect(Number((await watch(wish)).target_price)).toBe(95);
    expect(await observe([obs(url, 8000)], 3)).toEqual({ matched: 1, events: 0 });
    // Revenu au seuil : réarmée ; repasse dessous : une nouvelle alerte (plus de limite de 7 jours).
    await observe([obs(url, 9500)], 4);
    expect(await watch(wish)).toMatchObject({ below_target: false });
    expect(await observe([obs(url, 9400)], 5)).toEqual({ matched: 1, events: 1 });
    expect(await claimFor(wish, 5)).toHaveLength(1);
  });

  it("sans seuil (aucun prix connu) : le premier prix vu dans le pays et la devise du membre le devient, sans alerte", async () => {
    const member = await freshOwner("apb9");
    const url = uniqueUrl("premier-prix");
    const res = await app.inject({ method: "POST", url: "/api/wishlist", headers: { ...authHeaders(member.token), "accept-language": "fr-FR" }, payload: { title: "Veste Essai", imageUrl: "https://images.example/veste.jpg", merchantUrl: url } });
    expect(res.statusCode).toBe(200);
    const wish = res.json().id as string;
    expect(await bell(member, wish, { priceDrop: true, restock: false })).toMatchObject({ targetPrice: null, targetCurrency: "EUR" });
    expect(await observe([obs(url, 12000)])).toEqual({ matched: 1, events: 0 });
    expect(await watch(wish)).toMatchObject({ target_currency: "EUR", target_country: "fr", below_target: false });
    expect(Number((await watch(wish)).target_price)).toBe(120);
    expect(await observe([obs(url, 11000)], 1)).toEqual({ matched: 1, events: 1 });
  });

  it("pièce absente des résultats, semblable mais différente, autre boutique moins chère : aucune alerte", async () => {
    const url = uniqueUrl("absente");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: true });
    // Absente : d'autres pièces seulement.
    await observe([obs(uniqueUrl("autre-piece"), 5000)]);
    // Semblable mais différente : une autre variante (paramètre gardé dans l'empreinte).
    await observe([obs(`${url}?couleur=rouge`, 5000)]);
    // Autre boutique moins chère : même chemin, autre site.
    await observe([obs(url.replace("boutique-essai", "boutique-concurrente"), 5000)]);
    // Même empreinte, autre boutique annoncée : ce n'est pas la même pièce.
    await observe([{ ...obs(url, 5000), m: "boutiqueconcurrente" }]);
    expect(await events(wish)).toEqual([]);
    expect(Number((await tracking(wish)).last_price)).toBe(100);
  });

  it("devise ou pays différents de ceux du seuil : aucune alerte ; un autre pays que celui du membre : ignoré", async () => {
    const url = uniqueUrl("devise");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: true });
    await observe([{ ...obs(url, 5000), c: "USD" }]);
    await observe([{ ...obs(url, 4000), n: "gb" }], 1);
    expect(await events(wish)).toEqual([]);
    expect(await tracking(wish)).toMatchObject({ last_country: "fr" });
    expect(await watch(wish)).toMatchObject({ target_currency: "EUR", target_country: "fr", below_target: false });
  });

  it("pays du membre (0040) : envie gardée en anglais depuis le Royaume-Uni → seuil fixé et comparé seulement avec les observations « gb » en livres", async () => {
    const member = await freshOwner("apb8");
    const url = uniqueUrl("pays-membre");
    const res = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { ...authHeaders(member.token), "accept-language": "en-GB" },
      payload: { title: "Veste Essai", imageUrl: "https://images.example/veste.jpg", merchantUrl: url },
    });
    expect(res.statusCode).toBe(200);
    const wish = res.json().id as string;
    expect(await bell(member, wish, { priceDrop: true, restock: false })).toMatchObject({ targetPrice: null, targetCurrency: "GBP" });
    const key = (await tracking(wish)).match_key_hash as string;
    const seen = (cents: number, country: string, currency = "GBP"): Observation => ({ k: key, m: null, p: cents, c: currency, n: country, s: null });
    expect(await tracking(wish)).toMatchObject({ member_country: "gb", last_price: null });
    // Une observation venue d'ailleurs ne fixe rien.
    await observe([seen(10000, "nz")]);
    await observe([seen(10000, "fr", "EUR")], 1);
    expect((await watch(wish)).target_price).toBeNull();
    await observe([seen(10000, "gb")], 2);
    expect(await watch(wish)).toMatchObject({ target_currency: "GBP", target_country: "gb" });
    await observe([seen(5000, "fr", "EUR")], 3);
    expect(await events(wish)).toEqual([]);
    await observe([seen(5000, "gb")], 4);
    expect((await events(wish)).map((event) => event.kind)).toEqual(["price_drop"]);
  });

  it("Google annonce la rupture (« in_stock: false ») : établie tout de suite ; alerte « épuisée » seulement avec sa cloche (cachée dans l'app) ; retour en stock ensuite", async () => {
    const url = uniqueUrl("epuise");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: false, restock: true, soldOut: true });
    await observe([obs(url, null, { s: false })]);
    expect(await tracking(wish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "shop" });
    expect((await events(wish)).map((event) => event.kind)).toEqual(["sold_out"]);
    await observe([obs(url, null, { s: true })], 1);
    expect((await tracking(wish)).stock_state).toBe("in_stock");
    expect((await events(wish)).map((event) => event.kind).sort()).toEqual(["restock", "sold_out"]);
  });

  it("« Plus disponible » (0041) : 1 ou 2 membres ne touchent que LEURS envies ; 3 membres différents d'affilée établissent la rupture pour tous ; un « en stock » entre deux signalements remet la série à zéro", async () => {
    const url = uniqueUrl("signalement");
    const key = trackingKeyOf(url, "Boutique Essai")!.hash;
    const watcher = await freshOwner("apc1");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: true, restock: true, soldOut: true });
    const [first, second, third] = [await freshOwner("apc2"), await freshOwner("apc3"), await freshOwner("apc6")];
    const firstWish = await wishFromResult(first, url);
    // Un seul auteur : seule son envie change.
    expect(await report(first, url)).toEqual([{ allowed: true, matched: 1 }]);
    expect(await tracking(firstWish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "reported" });
    expect(await tracking(wish)).toMatchObject({ stock_state: "unknown", sold_out_source: null });
    // Le signalement garde son auteur, dans sa propre table.
    const { data: reports } = await app.supabaseAdmin.from("stock_reports").select("user_id, match_key_hash, created_on, in_streak, helps_others").eq("user_id", first.id);
    expect(reports).toContainEqual({ user_id: first.id, match_key_hash: key, created_on: parisDay(), in_streak: true, helps_others: true });
    // Le même membre encore, puis un deuxième : 2 auteurs, pas assez.
    await report(first, url, 1);
    await report(second, url, 2);
    expect((await tracking(wish)).stock_state).toBe("unknown");
    // Une recherche voit la pièce en stock : la série repart de zéro.
    await observe([obs(url, null, { s: true })], 3);
    const { data: open } = await app.supabaseAdmin.from("stock_reports").select("id").eq("match_key_hash", key).eq("in_streak", true);
    expect(open).toEqual([]);
    await report(third, url, 4);
    expect((await tracking(wish)).stock_state).toBe("in_stock");
    // Trois membres différents d'affilée : rupture établie pour tous, sans aucune alerte qui désigne un auteur.
    await report(first, url, 5);
    await report(second, url, 6);
    expect(await tracking(wish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    const sold = await events(wish);
    expect(sold.map((event) => event.kind)).toEqual(["sold_out"]);
    for (const user of [first, second, third]) expect(JSON.stringify(sold)).not.toContain(user.id);
    // Une baisse sur une pièce en rupture : aucune alerte.
    expect(await observe([obs(url, 5000)], 7)).toMatchObject({ events: 0 });
  });

  it("retour en stock après une rupture établie par des membres : jamais quand c'est l'un des auteurs de la série qui la voit en stock ; un autre membre, oui", async () => {
    const url = uniqueUrl("auteur-voit-stock");
    const watcher = await freshOwner("apc7");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: false, restock: true });
    const reporters = [await freshOwner("apc8"), await freshOwner("apc9"), await freshOwner("apca")];
    for (const [index, who] of reporters.entries()) await report(who, url, index);
    expect(await tracking(wish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "members" });
    // L'un des auteurs cherche et la voit en stock : aucune alerte (la série est close, la pièce disponible).
    expect(await observe([obs(url, null, { s: true })], 4, reporters[0]!)).toMatchObject({ events: 0 });
    expect(await events(wish)).toEqual([]);
    expect((await tracking(wish)).stock_state).toBe("in_stock");
    // Nouvelle série de 3, puis un membre qui n'en est pas auteur : « De retour en stock ».
    for (const [index, who] of reporters.entries()) await report(who, url, 5 + index);
    expect(await observe([obs(url, null, { s: true })], 9)).toMatchObject({ events: 1 });
    expect((await events(wish)).map((event) => event.kind)).toEqual(["restock"]);
  });

  it("« Aider les autres membres » coupé : ses recherches et ses signalements ne servent qu'à SES envies, et ses signalements ne comptent pas parmi les 3", async () => {
    const url = uniqueUrl("aide-coupee");
    const watcher = await freshOwner("apcb");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: true, restock: true });
    const loner = await freshOwner("apcc");
    const lonerWish = await wishFromResult(loner, url);
    await bell(loner, lonerWish, { priceDrop: true, restock: false });
    await helpOthers(loner, false);
    // Sa recherche : prix sous le seuil, puis rupture annoncée — seulement chez lui.
    expect(await observe([obs(url, 5000)], 0, loner)).toEqual({ matched: 1, events: 1 });
    expect(await observe([obs(url, null, { s: false })], 0.5, loner)).toEqual({ matched: 1, events: 0 });
    expect((await events(lonerWish)).map((event) => event.kind)).toEqual(["price_drop"]);
    expect(await tracking(lonerWish)).toMatchObject({ stock_state: "sold_out", sold_out_source: "shop" });
    expect(await tracking(wish)).toMatchObject({ stock_state: "unknown" });
    expect(Number((await tracking(wish)).last_price)).toBe(100);
    expect(await events(wish)).toEqual([]);
    // Ses signalements : ses envies seulement, et il ne compte pas (2 autres + lui : pas établie).
    const others = [await freshOwner("apcd"), await freshOwner("apce")];
    await report(others[0]!, url, 1);
    await report(loner, url, 2);
    await report(others[1]!, url, 3);
    expect((await tracking(wish)).stock_state).toBe("unknown");
    const { data: mine } = await app.supabaseAdmin.from("stock_reports").select("helps_others").eq("user_id", loner.id);
    expect(mine).toEqual([{ helps_others: false }]);
    // Sa recherche « en stock » ne clôt pas la série des autres.
    await observe([obs(url, null, { s: true })], 4, loner);
    const { data: open } = await app.supabaseAdmin.from("stock_reports").select("user_id").eq("match_key_hash", trackingKeyOf(url, "Boutique Essai")!.hash).eq("in_streak", true).eq("helps_others", true);
    expect((open ?? []).map((row) => row.user_id).sort()).toEqual([others[0]!.id, others[1]!.id].sort());
    await helpOthers(loner, true);
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

  it("« Je l'ai achetée » (0041) : ne compare rien avec les envies des autres membres — aucun retour en stock, aucun changement chez eux ; seules les envies de l'acheteur sont notées achetées", async () => {
    const url = uniqueUrl("achat");
    const watcher = await freshOwner("apcf");
    const wish = await wishFromResult(watcher, url);
    await bell(watcher, wish, { priceDrop: true, restock: true });
    // Google annonce la pièce épuisée : un retour en stock serait possible.
    await observe([obs(url, null, { s: false })], -1);
    const before = await tracking(wish);
    const buyer = await freshOwner("apcg");
    const buyerWish = await wishFromResult(buyer, url);
    await bell(buyer, buyerWish, { priceDrop: false, restock: true });
    await buy(buyer, buyerWish);
    expect(await events(wish)).toEqual([]);
    expect(await events(buyerWish)).toEqual([]);
    expect(await tracking(wish)).toEqual(before);
    expect((await tracking(buyerWish)).bought_on).not.toBeNull();
  });

  it("cloche absente, ou cloche coupée après la création d'une alerte : suivi mis à jour, aucune alerte ; coupée après coup : « désactivée »", async () => {
    const noBell = await wishFromResult(owner, uniqueUrl("sans-cloche"));
    const url = uniqueUrl("coupe-apres");
    const later = await wishFromResult(owner, url);
    await bell(owner, later, { priceDrop: true, restock: false });
    await observe([obs(url, 5000)]);
    await app.inject({ method: "PUT", url: `/api/wishlist/${later}/alerts`, headers: authHeaders(owner.token), payload: { priceDrop: false, restock: false } });
    await claim(0, 9);
    expect((await events(later))[0]).toMatchObject({ status: "disabled", claimed_at: null });
    const { data: noBellTracking } = await app.supabaseAdmin.from("wish_tracking").select("match_key_hash").eq("wishlist_item_id", noBell).single();
    await observe([{ k: noBellTracking!.match_key_hash as string, m: "boutiqueessai", p: 5000, c: "EUR", n: "fr", s: null }]);
    expect(await events(noBell)).toEqual([]);
    expect(Number((await tracking(noBell)).last_price)).toBe(50);
  });

  it("interrupteur des Réglages coupé (cloche allumée) : aucune alerte (le passage sous le seuil est quand même noté) ; coupé après la création d'une alerte : « désactivée » à l'envoi", async () => {
    const member = await freshOwner("apb4");
    const base = 24 * 270;
    const url = uniqueUrl("interrupteur");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true });
    await alertsSwitch(member, false);
    expect(await observe([obs(url, 9000)], base)).toEqual({ matched: 1, events: 0 });
    expect(await events(wish)).toEqual([]);
    expect(await watch(wish)).toMatchObject({ below_target: true });
    // Rallumé : revenu au seuil puis repassé dessous, une alerte ; recoupé avant l'envoi : « désactivée ».
    await alertsSwitch(member, true);
    await observe([obs(url, 10000)], base + 1);
    expect(await observe([obs(url, 8500)], base + 2)).toEqual({ matched: 1, events: 1 });
    await alertsSwitch(member, false);
    await claim(0, base + 10);
    expect((await events(wish)).map((event) => event.status)).toEqual(["disabled"]);
  });

  it("pièce achetée (dans le Vault) : aucune alerte pour une baisse ; une baisse déjà en attente devient « périmée » à l'envoi", async () => {
    const member = await freshOwner("apb5");
    const base = 24 * 300;
    const boughtUrl = uniqueUrl("achetee-avant");
    const boughtFirst = await wishFromResult(member, boughtUrl);
    await bell(member, boughtFirst, { priceDrop: true, restock: true });
    await buy(member, boughtFirst);
    expect(await observe([obs(boughtUrl, 8000)], base)).toEqual({ matched: 1, events: 0 });
    expect(await events(boughtFirst)).toEqual([]);
    const url = uniqueUrl("achetee-apres");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], base + 1);
    await buy(member, wish);
    expect(await claimFor(wish, base + 12)).toEqual([]);
    expect((await events(wish))[0]).toMatchObject({ status: "stale", claimed_at: null });
  });

  it("baisse sur une pièce en rupture : aucune alerte ; baisse en attente puis rupture annoncée : « périmée » à l'envoi", async () => {
    const member = await freshOwner("apb7");
    const base = 24 * 330;
    const soldOutUrl = uniqueUrl("baisse-epuisee");
    const soldOut = await wishFromResult(member, soldOutUrl);
    await bell(member, soldOut, { priceDrop: true, restock: false });
    expect(await observe([obs(soldOutUrl, 8000, { s: false })], base)).toEqual({ matched: 1, events: 0 });
    expect(await tracking(soldOut)).toMatchObject({ stock_state: "sold_out", sold_out_source: "shop" });
    // Le passage sous le seuil n'est pas consommé : il comptera une fois la pièce disponible.
    expect(await watch(soldOut)).toMatchObject({ below_target: false });
    const url = uniqueUrl("baisse-puis-rupture");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 8000)], base);
    await observe([obs(url, null, { s: false })], base + 1);
    expect(await claimFor(wish, base + 12)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("stale");
  });

  it("« Je l'ai achetée » depuis un AUTRE résultat de la même pièce (alertes-04) : toutes les envies du membre de cette pièce sont achetées — cloche cachée, aucune alerte ; retirée du Vault : les alertes reviennent", async () => {
    const member = await freshOwner("apc5");
    const url = uniqueUrl("autre-resultat");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: true });
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
    const removed = await app.inject({ method: "DELETE", url: `/api/vault/${bought.json().id}`, headers: authHeaders(member.token) });
    expect(removed.statusCode).toBe(204);
    expect((await tracking(wish)).bought_on).toBeNull();
  });

  it("envoi demandé à Expo mais jamais noté : jamais renvoyé, noté « envoyée » au passage suivant (le jour de la demande, réservation effacée) ; jamais expiré pendant son envoi", async () => {
    const member = await freshOwner("apb8");
    const base = 24 * 360;
    const url = uniqueUrl("jamais-renvoyee");
    const wish = await wishFromResult(member, url);
    await bell(member, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], base);
    const [claimed] = await claimFor(wish, base + 9);
    expect(await markPushing([claimed!.event_id], base + 9)).toBe(1);
    expect((await events(wish))[0]!.pushing_at).not.toBeNull();
    // 10 minutes après : toujours réservée, pas reprise.
    expect(await claimFor(wish, base + 9 + 10 / 60)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("pending");
    // Réservation échue : notée « envoyée », jamais renvoyée ; plus aucune heure.
    expect(await claimFor(wish, base + 9 + 20 / 60)).toEqual([]);
    expect((await events(wish))[0]).toMatchObject({ status: "sent", sent_on: parisDay(base + 9), claimed_at: null, pushing_at: null });
    // Réservée la veille du 3e jour, l'expiration de ce 3e jour ne la prend pas pendant son envoi.
    const lateUrl = uniqueUrl("envoi-au-3e-jour");
    const late = await wishFromResult(member, lateUrl);
    await bell(member, late, { priceDrop: true, restock: false });
    const created = base + 24 * 10;
    await observe([obs(lateUrl, 9000)], created);
    // La veille du 3e jour à 23 h 54 (Paris), puis 9 minutes plus tard (réservation de 15 minutes encore en cours).
    const lastMinute = created + 60.9;
    const thirdDay = created + 61.05;
    expect(parisDay(thirdDay)).not.toBe(parisDay(lastMinute));
    const [lateClaim] = await claimFor(late, lastMinute);
    await claim(0, thirdDay);
    expect((await events(late))[0]!.status).toBe("pending");
    expect(await markSent([lateClaim!.event_id], thirdDay)).toBe(1);
    expect((await events(late))[0]!.status).toBe("sent");
  });

  it("périmée : le prix est revenu au seuil avant l'envoi", async () => {
    const url = uniqueUrl("perimee");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)]);
    await observe([obs(url, 8000)], 1);
    // Une alerte par passage : le prix vu au passage est gardé.
    expect((await events(wish)).map((event) => Number(event.new_price))).toEqual([90]);
    await observe([obs(url, 10000)], 2);
    expect(await claimFor(wish, 12)).toEqual([]);
    expect((await events(wish))[0]!.status).toBe("stale");
  });

  it("5 alertes envoyées par personne et par jour de Paris (gardée) ; au-delà, elles attendent le lendemain (retour en stock compris) ; réservation atomique", async () => {
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
    const [first, second] = await Promise.all([claim(200, day + 9), claim(200, day + 9)]);
    const mine = [...first, ...second].filter((row) => wishes.includes(row.wishlist_item_id));
    expect(mine).toHaveLength(5);
    expect(new Set(mine.map((row) => row.event_id)).size).toBe(5);
    expect(await markSent(mine.map((row) => row.event_id), day + 9)).toBe(5);
    const held = (await Promise.all(wishes.map(async (wish) => (await events(wish))[0]!))).filter((event) => event.status === "pending");
    expect(held).toHaveLength(2);
    for (const event of held) expect(event).toMatchObject({ claimed_at: null, created_on: parisDay(day) });
    const restockUrl = uniqueUrl("cinq-retour");
    const restockWish = await wishFromResult(member, restockUrl);
    await bell(member, restockWish, { priceDrop: false, restock: true });
    await observe([obs(restockUrl, null, { s: false })], day);
    await observe([obs(restockUrl, null, { s: true })], day + 0.5);
    expect(await claimFor(restockWish, day + 9.5)).toEqual([]);
    expect((await events(restockWish))[0]).toMatchObject({ kind: "restock", status: "pending" });
    // Le lendemain : les trois partent (revérifiées alors).
    const nextDay = await claim(200, day + 24);
    expect(nextDay.filter((row) => [...wishes, restockWish].includes(row.wishlist_item_id))).toHaveLength(3);
  });

  it("notifications coupées (p_limit 0) ou sans appareil : en attente ; expire le 3e jour après sa création (par date), jamais envoyée", async () => {
    const url = uniqueUrl("expiration");
    const wish = await wishFromResult(reporter, url);
    await bell(reporter, wish, { priceDrop: true, restock: false });
    const created = 24 * 60;
    await observe([obs(url, 9000)], created);
    expect(await claimFor(wish, created + 9)).toEqual([]);
    await claim(0, created + 48);
    expect((await events(wish))[0]!.status).toBe("pending");
    await claim(0, created + 72);
    expect((await events(wish))[0]).toMatchObject({ status: "expired", claimed_at: null });
  });

  it("contraintes : empreinte, devise du seuil, prix d'une baisse, une seule alerte en attente, jour d'envoi, réservation effacée, même membre que l'envie", async () => {
    const wish = await wishFromResult(owner, uniqueUrl("contraintes"));
    expect((await app.supabaseAdmin.from("wish_tracking").update({ match_key_hash: "https://boutique.example/p" }).eq("wishlist_item_id", wish)).error?.code).toBe("23514");
    await bell(owner, wish, { priceDrop: true, restock: false });
    expect((await app.supabaseAdmin.from("wish_watches").update({ target_currency: "€" }).eq("wishlist_item_id", wish)).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_watches").update({ target_country: null }).eq("wishlist_item_id", wish)).error?.code).toBe("23514");
    const base = { wishlist_item_id: wish, user_id: owner.id, created_on: parisDay() };
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "price_drop" })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "restock" })).error).toBeNull();
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "restock" })).error?.code).toBe("23505");
    // « Peut-être envoyée » sans réservation ; envoyée sans jour ; close avec une heure : refusé.
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "sold_out", pushing_at: at() })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "sold_out", status: "sent" })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_alert_events").insert({ ...base, kind: "sold_out", status: "expired", claimed_at: at() })).error?.code).toBe("23514");
    expect((await app.supabaseAdmin.from("wish_watches").insert({ wishlist_item_id: wish, user_id: searcher.id })).error?.code).toBe("23503");
  });

  it("purge à 30 jours (par date) : alertes et signalements", async () => {
    const url = uniqueUrl("purge");
    const wish = await wishFromResult(owner, url);
    await bell(owner, wish, { priceDrop: true, restock: false });
    await observe([obs(url, 9000)], -24 * 400);
    const { error } = await app.supabaseAdmin.rpc("wish_alerts_purge", { p_limit: 5000, p_now: at() });
    expect(error).toBeNull();
    expect(await events(wish)).toEqual([]);
  });

  it("export RGPD : cloches (et seuil), suivi, alertes (jours de création et d'envoi, aucune heure) et signalements du membre (avec son réglage), sans empreinte ni pays d'observation", async () => {
    const wish = await wishFromResult(owner, uniqueUrl("export"));
    const closed = await app.supabaseAdmin.from("wish_alert_events").insert({ wishlist_item_id: wish, user_id: owner.id, kind: "restock", created_on: "2026-11-01", status: "expired" }).select("id").single();
    expect(closed.error).toBeNull();
    const pending = await app.supabaseAdmin.from("wish_alert_events").insert({ wishlist_item_id: wish, user_id: owner.id, kind: "sold_out", created_on: parisDay() }).select("id").single();
    expect(pending.error).toBeNull();
    const body = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(owner.token) })).json();
    const exportedIds = body.wishAlertEvents.map((row: { id: string }) => row.id);
    expect(exportedIds).toContain(closed.data!.id);
    expect(exportedIds).toContain(pending.data!.id);
    expect(body.wishWatches.length).toBeGreaterThan(0);
    for (const row of body.wishWatches) expect(row).toHaveProperty("target_price");
    for (const row of body.wishTracking) {
      expect(row).not.toHaveProperty("match_key_hash");
      expect(row).not.toHaveProperty("last_country");
      expect(row).not.toHaveProperty("updated_at");
      expect(row).not.toHaveProperty("ref_price");
    }
    for (const row of body.wishAlertEvents) {
      expect(Object.keys(row).sort()).toEqual(["created_on", "currency", "id", "kind", "new_price", "old_price", "sent_on", "status", "wishlist_item_id", "wishlist_item_title"]);
    }
    expect(body.profile).toMatchObject({ help_others: true });
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
