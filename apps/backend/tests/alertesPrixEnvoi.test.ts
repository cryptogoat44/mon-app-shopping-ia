import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Alertes prix et stock (lot 2, migration 0036) : l'envoi, SANS base ni
// réseau. La file (wish_alerts_claim, ses limites et son expiration) est
// imitée ici par une fausse fonction de la base ; sa vraie logique est
// vérifiée sur spotto-dev-2 (alertesPrix.test.ts). Aucun test n'envoie une
// vraie notification : le service d'Expo est remplacé par un faux
// (tests/setup/noPaidCalls.ts refuse d'ailleurs exp.host).

vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: true, EXPO_ACCESS_TOKEN: undefined } };
});

import { env } from "../src/env.js";
import { resetPushProbe } from "../src/lib/push.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import {
  alertPushContent,
  FLUSH_BATCH,
  FLUSH_INTERVAL_MS,
  flushAfterResponse,
  flushWishAlerts,
  groupByRecipient,
  purgeWishAlerts,
  resetWishAlertsFlush,
  scheduleWishAlertsFlush,
  waitForWishAlertsFlush,
  type ClaimedAlert,
} from "../src/lib/wishAlertsSend.js";
import { flushObservations, observeResults } from "../src/lib/wishObserve.js";
import { scrubLogLine } from "../src/lib/logPrivacy.js";
import { fakeSupabase } from "./fakeSupabase.js";

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const WISH_A = "e0000000-0000-4000-8000-00000000000a";
const WISH_B = "e0000000-0000-4000-8000-00000000000b";
const WISH_C = "e0000000-0000-4000-8000-00000000000c";
const ALICE_PHONE = "ExponentPushToken[alicePhoneAlicePhone01]";
const BOB_PHONE = "ExponentPushToken[bobPhoneBobPhoneBob0001]";

let counter = 0;
function alert(fields: Partial<ClaimedAlert> = {}): ClaimedAlert {
  counter += 1;
  return {
    event_id: `0e000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    user_id: ALICE,
    wishlist_item_id: WISH_A,
    kind: "price_drop",
    old_price: 120,
    new_price: 89.9,
    currency: "EUR",
    title: "Veste Nuage 07",
    merchant_name: "Boutique Exemple",
    locale: "fr",
    ...fields,
  };
}

/** Espaces insécables d'Intl ramenées à des espaces. */
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("texte de la notification (FR/EN) et regroupement", () => {
  it("baisse de prix : « Baisse de prix : {titre} à {prix} chez {boutique} (au lieu de {ancien}) » ; données : la sorte et l'envie, rien d'autre", () => {
    const [group] = groupByRecipient([alert()]);
    const content = alertPushContent(group!);
    expect(plain(content.body)).toBe("Baisse de prix : Veste Nuage 07 à 89,90 € chez Boutique Exemple (au lieu de 120 €)");
    expect(content.data).toEqual({ kind: "wish_alert", wishlistItemId: WISH_A });
    const en = alertPushContent(groupByRecipient([alert({ locale: "en" })])[0]!);
    expect(plain(en.body)).toBe("Price drop: Veste Nuage 07 now €89.90 at Boutique Exemple (was €120)");
  });

  it("retour en stock et épuisé (caché dans l'app) ; sans boutique, sans « chez » ; titre trop long raccourci", () => {
    expect(alertPushContent(groupByRecipient([alert({ kind: "restock", old_price: null, new_price: null, currency: null })])[0]!).body).toBe("De retour en stock : Veste Nuage 07 chez Boutique Exemple");
    expect(alertPushContent(groupByRecipient([alert({ kind: "restock", old_price: null, new_price: null, currency: null, locale: "en" })])[0]!).body).toBe("Back in stock: Veste Nuage 07 at Boutique Exemple");
    expect(alertPushContent(groupByRecipient([alert({ kind: "sold_out", old_price: null, new_price: null, currency: null, merchant_name: null })])[0]!).body).toBe("Épuisé : Veste Nuage 07");
    const long = alertPushContent(groupByRecipient([alert({ kind: "restock", title: "V".repeat(90) })])[0]!).body;
    expect(long).toBe(`De retour en stock : ${"V".repeat(59)}… chez Boutique Exemple`);
  });

  it("plusieurs envies pour une personne : UNE notification « {n} de vos envies ont du nouveau », sans envie jointe (toucher ouvre vos Envies)", () => {
    const groups = groupByRecipient([alert(), alert({ wishlist_item_id: WISH_B, kind: "restock" }), alert({ user_id: BOB, wishlist_item_id: WISH_C, locale: "en" }), alert({ wishlist_item_id: WISH_C })]);
    expect(groups.map((group) => [group.userId, group.alerts.length])).toEqual([
      [ALICE, 3],
      [BOB, 1],
    ]);
    expect(alertPushContent(groups[0]!)).toEqual({ body: "3 de vos envies ont du nouveau", data: { kind: "wish_alert" } });
    expect(alertPushContent(groupByRecipient([alert({ locale: "en" }), alert({ locale: "en", wishlist_item_id: WISH_B })])[0]!).body).toBe("2 of your wishes have news");
    // Deux alertes pour la même envie : la baisse est montrée, l'envie est jointe.
    const same = alertPushContent(groupByRecipient([alert({ kind: "restock", old_price: null, new_price: null, currency: null }), alert()])[0]!);
    expect(plain(same.body)).toContain("Baisse de prix");
    expect(same.data).toEqual({ kind: "wish_alert", wishlistItemId: WISH_A });
  });
});

// ---- Le passage d'envoi ----

interface ExpoCall {
  messages: Record<string, unknown>[];
}
let expoCalls: ExpoCall[] = [];
let expoReply: (messages: Record<string, unknown>[]) => Response = (messages) => Response.json({ data: messages.map(() => ({ status: "ok" })) });
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let claimRows: ClaimedAlert[] = [];
let lines: string[] = [];
let app: FastifyInstance | null = null;

function seeded(options: { migrated?: boolean } = {}) {
  const migrated = options.migrated ?? true;
  const fake = fakeSupabase({
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      if (!migrated) return { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "wish_alerts_version") return { data: 1, error: null };
      if (fn === "wish_alerts_claim") return { data: (args.p_limit as number) > 0 ? claimRows : [], error: null };
      if (fn === "wish_alerts_mark_sent" || fn === "wish_alerts_release") return { data: (args.p_ids as string[]).length, error: null };
      if (fn === "wish_alerts_purge") return { data: 0, error: null };
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  });
  fake.table("push_tokens").push(
    { token: ALICE_PHONE, user_id: ALICE, platform: "ios", notify_messages: false, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", last_error: null },
    { token: BOB_PHONE, user_id: BOB, platform: "ios", notify_messages: true, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", last_error: null }
  );
  return fake;
}

async function senderApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) }, hooks: { streamWrite: scrubLogLine } } });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  await app.ready();
  return app;
}

const calls = (fn: string) => rpcCalls.filter((call) => call.fn === fn);

beforeEach(async () => {
  resetWishAlertsProbe();
  resetPushProbe();
  await resetWishAlertsFlush();
  env.PUSH_ENABLED = true;
  rpcCalls = [];
  claimRows = [];
  lines = [];
  expoCalls = [];
  expoReply = (messages) => Response.json({ data: messages.map(() => ({ status: "ok" })) });
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://exp.host/")) throw new Error(`Adresse inattendue dans un test : ${new URL(url).hostname}`);
    const messages = JSON.parse(String(init?.body)) as Record<string, unknown>[];
    expoCalls.push({ messages });
    return expoReply(messages);
  });
});

afterEach(async () => {
  await resetWishAlertsFlush();
  await flushObservations();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await app?.close();
  app = null;
  resetWishAlertsProbe();
});

describe("flushWishAlerts", () => {
  it("une notification par personne, à TOUS ses appareils (même gardés pour les seules alertes) ; acceptée : « envoyée »", async () => {
    claimRows = [alert(), alert({ wishlist_item_id: WISH_B, kind: "restock", old_price: null, new_price: null, currency: null }), alert({ user_id: BOB, wishlist_item_id: WISH_C, locale: "en" })];
    const target = await senderApp(seeded().db);
    const summary = await flushWishAlerts(target);
    expect(summary).toEqual({ claimed: 3, recipients: 2, sent: 3, released: 0, push: true });
    expect(calls("wish_alerts_claim")).toEqual([{ fn: "wish_alerts_claim", args: { p_limit: FLUSH_BATCH } }]);
    expect(expoCalls.map((call) => call.messages.map((message) => message.to))).toEqual([[ALICE_PHONE], [BOB_PHONE]]);
    expect(expoCalls[0]!.messages[0]).toEqual({ to: ALICE_PHONE, title: "Spotto", body: "2 de vos envies ont du nouveau", data: { kind: "wish_alert" }, sound: "default" });
    expect(expoCalls[1]!.messages[0]!.data).toEqual({ kind: "wish_alert", wishlistItemId: WISH_C });
    expect(calls("wish_alerts_mark_sent")).toEqual([{ fn: "wish_alerts_mark_sent", args: { p_ids: claimRows.map((row) => row.event_id) } }]);
    expect(calls("wish_alerts_release")).toEqual([]);
    // Journal : des nombres, jamais un compte, un titre ni un prix.
    const journal = lines.join("\n");
    expect(journal).toContain("Alerte prix envoyée");
    expect(journal).not.toContain(ALICE);
    expect(journal).not.toContain("Veste");
    expect(journal).not.toMatch(/89[.,]9/);
    expect(journal).not.toContain("Boutique Exemple");
  });

  it("Expo refuse ou ne répond pas lisiblement : la réservation est rendue (retentée plus tard, jusqu'à 72 h), rien n'est noté « envoyée »", async () => {
    claimRows = [alert()];
    expoReply = () => new Response("panne", { status: 500 });
    const target = await senderApp(seeded().db);
    expect(await flushWishAlerts(target)).toMatchObject({ claimed: 1, sent: 0, released: 1 });
    expect(calls("wish_alerts_mark_sent")).toEqual([]);
    expect(calls("wish_alerts_release")).toEqual([{ fn: "wish_alerts_release", args: { p_ids: [claimRows[0]!.event_id] } }]);
  });

  it("appareil désinscrit : oublié, et l'alerte rendue (sans appareil, elle restera en attente puis expirera)", async () => {
    claimRows = [alert()];
    expoReply = (messages) => Response.json({ data: messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })) });
    const fake = seeded();
    const target = await senderApp(fake.db);
    expect(await flushWishAlerts(target)).toMatchObject({ sent: 0, released: 1 });
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([BOB_PHONE]);
  });

  it("notifications coupées sur le serveur (PUSH_ENABLED) : seulement l'entretien de la file (p_limit 0), aucune notification ; les alertes restent en attente", async () => {
    env.PUSH_ENABLED = false;
    claimRows = [alert()];
    const target = await senderApp(seeded().db);
    expect(await flushWishAlerts(target)).toEqual({ claimed: 0, recipients: 0, sent: 0, released: 0, push: false });
    expect(calls("wish_alerts_claim")).toEqual([{ fn: "wish_alerts_claim", args: { p_limit: 0 } }]);
    expect(expoCalls).toEqual([]);
    expect(calls("wish_alerts_mark_sent")).toEqual([]);
  });

  it("sans la migration 0036 : aucune file lue, rien n'est envoyé", async () => {
    const target = await senderApp(seeded({ migrated: false }).db);
    expect(await flushWishAlerts(target)).toMatchObject({ claimed: 0, push: false });
    expect(rpcCalls.map((call) => call.fn)).toEqual(["wish_alerts_version"]);
    expect(expoCalls).toEqual([]);
  });

  it("rien n'est jamais envoyé par la demande qui crée l'alerte : une observation n'ouvre pas la file", async () => {
    const target = await senderApp(seeded().db);
    observeResults(target, { source: "lens", rows: [{ merchantUrl: "https://boutique-exemple.fr/p/1", merchantName: "Boutique", priceValue: 50, currency: "€" }], country: "fr" });
    await flushObservations();
    expect(rpcCalls.map((call) => call.fn)).not.toContain("wish_alerts_claim");
    expect(expoCalls).toEqual([]);
  });
});

describe("déclenchement par les routes fréquentes, au plus une fois par minute", () => {
  it("deux demandes dans la même minute : un seul passage ; une minute plus tard : un autre", async () => {
    const target = await senderApp(seeded().db);
    const now = Date.now();
    scheduleWishAlertsFlush(target, now);
    scheduleWishAlertsFlush(target, now + 1_000);
    await waitForWishAlertsFlush();
    scheduleWishAlertsFlush(target, now + FLUSH_INTERVAL_MS - 1);
    await waitForWishAlertsFlush();
    expect(calls("wish_alerts_claim")).toHaveLength(1);
    scheduleWishAlertsFlush(target, now + FLUSH_INTERVAL_MS);
    await waitForWishAlertsFlush();
    expect(calls("wish_alerts_claim")).toHaveLength(2);
  });

  it("seulement après une route fréquente d'un membre connecté, réussie", async () => {
    const db = seeded().db;
    app = Fastify({ logger: false });
    app.decorate("supabaseAdmin", db as unknown as FastifyInstance["supabaseAdmin"]);
    app.decorateRequest("user", null);
    const target = app;
    target.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => flushAfterResponse(target, request, reply));
    target.addHook("preHandler", async (request: FastifyRequest) => {
      if (request.headers["x-test-user"]) request.user = { id: String(request.headers["x-test-user"]), email: null };
    });
    target.get("/api/notifications", async () => ({ items: [] }));
    target.get("/api/autre", async () => ({ ok: true }));
    target.get("/api/messages/status", async (_request, reply) => reply.code(500).send({ error: "x" }));
    await target.ready();
    // Le crochet « onResponse » passe après la réponse : quelques tours de boucle pour lui laisser le temps.
    const settle = async () => {
      for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      await waitForWishAlertsFlush();
    };
    await target.inject({ method: "GET", url: "/api/notifications" });
    await target.inject({ method: "GET", url: "/api/autre", headers: { "x-test-user": ALICE } });
    await target.inject({ method: "GET", url: "/api/messages/status", headers: { "x-test-user": ALICE } });
    await settle();
    expect(calls("wish_alerts_claim")).toEqual([]);
    await target.inject({ method: "GET", url: "/api/notifications", headers: { "x-test-user": ALICE } });
    await vi.waitFor(() => expect(calls("wish_alerts_claim")).toHaveLength(1));
    await settle();
  });
});

describe("purge à 30 jours", () => {
  it("par lots bornés, à côté de la purge du cache ; jamais d'erreur ; sans 0036, rien", async () => {
    const target = await senderApp(seeded().db);
    await purgeWishAlerts(target, target.log);
    expect(calls("wish_alerts_purge")).toEqual([{ fn: "wish_alerts_purge", args: { p_limit: 500 } }]);
    resetWishAlertsProbe();
    rpcCalls = [];
    const without = await senderApp(seeded({ migrated: false }).db);
    await expect(purgeWishAlerts(without, without.log)).resolves.toBeUndefined();
    expect(calls("wish_alerts_purge")).toEqual([]);
  });
});
