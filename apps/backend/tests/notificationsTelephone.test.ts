import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import conversationsRoutes from "../src/routes/conversations.js";
import accountRoutes from "../src/routes/account.js";
import pushTokensRoutes from "../src/routes/pushTokens.js";
import { env } from "../src/env.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import {
  COLLAPSE_WINDOW_MS,
  EXPO_PUSH_URL,
  MAX_DEVICES_PER_ACCOUNT,
  flushPushes,
  notifyNewMessage,
  pushBody,
  resetPushCollapse,
  resetPushProbe,
} from "../src/lib/push.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Notifications des nouveaux messages sur le téléphone (lot notifications,
// migration 0035), SANS base ni réseau : les vraies routes sur une fausse
// base en mémoire (tests/fakeSupabase.ts), et un faux service d'Expo — aucun
// test n'envoie une vraie notification (tests/setup/noPaidCalls.ts refuse
// d'ailleurs exp.host). Le même parcours sur la vraie base de développement :
// notificationsTelephoneBase.test.ts (sur le Mac, une fois 0035 appliquée).

vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: false, EXPO_ACCESS_TOKEN: undefined } };
});

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const BOB_PHONE = "ExponentPushToken[bobBobBobBobBobBob0001]";
const BOB_TABLET = "ExponentPushToken[bobBobBobBobBobBob0002]";
const ALICE_PHONE = "ExpoPushToken[aliceAliceAlice-_00001]";
const CHLOE_PHONE = "ExponentPushToken[chloeChloeChloe00001]";
const SECRET = "Texte privé à ne jamais montrer";

function profile(id: string, username: string, locale = "fr", messagesFrom = "everyone"): Row {
  return { id, username, display_name: username, avatar_url: null, messages_from: messagesFrom, piece_sends_from: "following", locale };
}

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  tokens?: { token: string; user_id: string; platform?: string }[];
  bobLocale?: string;
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profile(ALICE, "alice"), profile(BOB, "bob", seed.bobLocale ?? "fr"), profile(CHLOE, "chloe"));
  for (const [follower, followee] of seed.follows ?? []) fake.table("follows").push({ follower_id: follower, followee_id: followee });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  for (const token of seed.tokens ?? []) {
    fake.table("push_tokens").push({ platform: "ios", created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-01T10:00:00.000Z", last_error: null, ...token });
  }
  return fake;
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];

/** La base a la migration 0036 (sonde wish_alerts_version). */
const migrated0036: FakeDbOptions = { rpc: async (fn) => (fn === "wish_alerts_version" ? { data: 1, error: null } : { data: null, error: { code: "PGRST202", message: "absente" } }) };

// ---- Faux service d'Expo ----

interface ExpoCall {
  url: string;
  headers: Record<string, string>;
  messages: Record<string, unknown>[];
}
let expoCalls: ExpoCall[] = [];
type ExpoReply = (messages: Record<string, unknown>[]) => Response | Promise<Response>;

const okTickets: ExpoReply = (messages) => Response.json({ data: messages.map((_, index) => ({ status: "ok", id: `ticket-${index}` })) });

/** Remplace fetch : seule l'adresse d'Expo est attendue, et rien ne part. */
function stubExpo(reply: ExpoReply = okTickets) {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://exp.host/")) throw new Error(`Adresse inattendue dans un test : ${new URL(url).hostname}`);
    const messages = JSON.parse(String(init?.body)) as Record<string, unknown>[];
    expoCalls.push({ url, headers: init?.headers as Record<string, string>, messages });
    return reply(messages);
  });
}

let app: FastifyInstance | null = null;

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête,
 * et le journal du serveur avec ses vraies règles (lib/logPrivacy.ts). */
async function pushApp(db: unknown, logLines?: string[]): Promise<FastifyInstance> {
  app = Fastify({
    logger: logLines
      ? {
          level: "info",
          stream: { write: (line: string) => void logLines.push(line) },
          serializers: { req: requestLogFields },
          formatters: { log: withoutErrorDetails },
          hooks: { streamWrite: scrubLogLine },
        }
      : false,
  });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(conversationsRoutes);
  await app.register(accountRoutes);
  await app.register(pushTokensRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    del: (url: string, payload?: object) => target.inject({ method: "DELETE", url, headers, ...(payload ? { payload } : {}) }),
  };
}

async function send(target: FastifyInstance, from: string, to: string, text = SECRET) {
  const res = await as(target, from).post("/api/messages", { recipientId: to, text });
  await flushPushes();
  return res;
}

const tokensOf = (fake: ReturnType<typeof fakeSupabase>, user: string) =>
  fake
    .table("push_tokens")
    .filter((row) => row.user_id === user)
    .map((row) => row.token);

beforeEach(() => {
  resetMessagesProbe();
  resetPushProbe();
  resetPushCollapse();
  resetWishAlertsProbe();
  expoCalls = [];
  env.PUSH_ENABLED = false;
  env.EXPO_ACCESS_TOKEN = undefined;
  stubExpo();
});

afterEach(async () => {
  await flushPushes();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await app?.close();
  app = null;
});

describe("interrupteur coupé (par défaut)", () => {
  it("rien n'est enregistré ni envoyé, et l'app est prévenue (push: false)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0, push: false });

    const refused = await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "ios" });
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toEqual({ error: "push_unavailable", message: "Les notifications ne sont pas disponibles." });
    expect(tokensOf(fake, ALICE)).toEqual([]);

    // Un appareil enregistré avant que l'interrupteur soit coupé ne reçoit rien.
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
  });

  it("oublier un appareil reste possible (ce qui a été enregistré peut partir)", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).del("/api/me/push-token", { token: BOB_PHONE })).statusCode).toBe(204);
    expect(tokensOf(fake, BOB)).toEqual([]);
  });

  // Registre des migrations : interrupteur coupé, rien ne dépend de la base.
  // « Ni 0035 ni 0036 » est la production tant que ces migrations sont « à
  // appliquer ». (Avec 0035, sans 0036 : les deux tests ci-dessus. Les
  // alertes dans chaque combinaison : alertesPrixRoutes.test.ts.)
  it.each<[string, FakeDbOptions]>([
    ["sans 0035 ni 0036", { missing: ["push_tokens"] }],
    ["avec 0035 et 0036", migrated0036],
  ])("%s : push false, rien d'enregistré ni d'envoyé ; l'envoi des messages, l'export et la suppression du compte marchent", async (_base, options) => {
    const with0035 = !options.missing?.includes("push_tokens");
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: with0035 ? [{ token: BOB_PHONE, user_id: BOB }] : [] }, options);
    const target = await pushApp(fake.db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0, push: false });
    expect((await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "ios", messages: true, alerts: true })).statusCode).toBe(404);
    expect(tokensOf(fake, ALICE)).toEqual([]);
    expect((await as(target, ALICE).del("/api/me/push-token", { token: ALICE_PHONE })).statusCode).toBe(204);
    // Le message part ; aucune notification, même vers un appareil déjà enregistré.
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
    const exported = await as(target, ALICE).get("/api/me/export");
    expect(exported.statusCode).toBe(200);
    expect(exported.json().pushDevices).toEqual([]);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });
});

describe("alertes prix et stock (migration 0036) : un appareil gardé pour les seules alertes", () => {
  it("ne reçoit aucune notification de message ; un appareil qui les reçoit, si ; sans 0036, tous comme avant", async () => {
    env.PUSH_ENABLED = true;
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: BOB_TABLET, user_id: BOB }] }, migrated0036);
    fake.table("push_tokens").find((row) => row.token === BOB_PHONE)!.notify_messages = false;
    fake.table("push_tokens").find((row) => row.token === BOB_TABLET)!.notify_messages = true;
    const target = await pushApp(fake.db);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toHaveLength(1);
    expect(expoCalls[0]!.messages.map((message) => message.to)).toEqual([BOB_TABLET]);
    expect(expoCalls[0]!.messages[0]).toMatchObject({ title: "Spotto", body: "Nouveau message de @alice", data: { conversationId: expect.any(String) } });
  });

  it("base qui ne dit pas si 0036 est là (sonde en panne) : AUCUNE notification de message (un appareil des seules alertes la recevrait), l'envoi du message marche", async () => {
    env.PUSH_ENABLED = true;
    const unknown = { rpc: async () => ({ data: null, error: { code: "57014", message: "délai dépassé" } }) };
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] }, unknown);
    fake.table("push_tokens")[0]!.notify_messages = false;
    const target = await pushApp(fake.db);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
  });

  it("enregistré avec « messages: false » : gardé (pour les alertes), mais sans notification de message", async () => {
    env.PUSH_ENABLED = true;
    const fake = seeded({ follows: friends(ALICE, BOB) }, migrated0036);
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).put("/api/me/push-token", { token: BOB_PHONE, platform: "ios", messages: false, alerts: true })).statusCode).toBe(204);
    expect(fake.table("push_tokens")).toEqual([expect.objectContaining({ token: BOB_PHONE, user_id: BOB, notify_messages: false, notify_alerts: true })]);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
    // De nouveau « messages: true » : les notifications de message reviennent.
    expect((await as(target, BOB).put("/api/me/push-token", { token: BOB_PHONE, platform: "ios", messages: true })).statusCode).toBe(204);
    resetPushCollapse();
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toHaveLength(1);
  });
});

describe("sans la migration 0035", () => {
  const missing = { missing: ["push_tokens"] };

  it("interrupteur allumé : push false, rien d'enregistré ni d'envoyé, l'envoi des messages marche", async () => {
    env.PUSH_ENABLED = true;
    const fake = seeded({ follows: friends(ALICE, BOB) }, missing);
    const target = await pushApp(fake.db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toMatchObject({ enabled: true, push: false });
    expect((await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "ios" })).statusCode).toBe(404);
    expect((await as(target, ALICE).del("/api/me/push-token", { token: ALICE_PHONE })).statusCode).toBe(204);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
  });

  it("l'export (aucun appareil) et la suppression du compte fonctionnent", async () => {
    env.PUSH_ENABLED = true;
    const fake = seeded({}, missing);
    const target = await pushApp(fake.db);
    const exported = await as(target, ALICE).get("/api/me/export");
    expect(exported.statusCode).toBe(200);
    expect(exported.json().pushDevices).toEqual([]);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });

  it("sans 0032 non plus : la messagerie indisponible dit push false", async () => {
    env.PUSH_ENABLED = true;
    const fake = seeded({}, { missing: ["push_tokens", "conversations", "conversation_participants", "messages"] });
    const target = await pushApp(fake.db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: false, unreadCount: 0, push: false });
  });
});

describe("enregistrer et oublier un appareil", () => {
  beforeEach(() => {
    env.PUSH_ENABLED = true;
  });

  it("interrupteur et 0035 présents : push true", async () => {
    const target = await pushApp(seeded().db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0, push: true });
  });

  it("refuse tout ce qui n'est pas un jeton d'Expo, ou un système inconnu ; rien n'est enregistré", async () => {
    const fake = seeded();
    const target = await pushApp(fake.db);
    const invalid: object[] = [
      {},
      { token: ALICE_PHONE },
      { token: ALICE_PHONE, platform: "windows" },
      { token: "abc", platform: "ios" },
      { token: "ExponentPushToken[]", platform: "ios" },
      { token: "ExponentPushToken[court]", platform: "ios" },
      { token: "ExponentPushToken[avec espace 123]", platform: "ios" },
      { token: "ExponentPushToken[abcdefghij]\n", platform: "ios" },
      { token: "exponentpushtoken[abcdefghijkl]", platform: "ios" },
      { token: "FakePushToken[abcdefghijkl]", platform: "ios" },
      { token: `ExponentPushToken[${"a".repeat(129)}]`, platform: "ios" },
      { token: "ExponentPushToken[abcdefghijkl]<script>", platform: "ios" },
      { token: 12345, platform: "ios" },
    ];
    for (const payload of invalid) {
      const res = await as(target, ALICE).put("/api/me/push-token", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_push_token", message: "Jeton de notification invalide." });
    }
    expect((await as(target, ALICE).del("/api/me/push-token", { token: "abc" })).statusCode).toBe(400);
    expect(fake.table("push_tokens")).toEqual([]);
    expect((await target.inject({ method: "PUT", url: "/api/me/push-token", payload: { token: ALICE_PHONE, platform: "ios" } })).statusCode).toBe(401);
  });

  it("enregistre, rafraîchit sans doublon (erreur oubliée), puis oublie ; les deux formes de jeton", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const fake = seeded();
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).put("/api/me/push-token", { token: BOB_PHONE, platform: "ios" })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "android" })).statusCode).toBe(204);
    expect(fake.table("push_tokens").map(({ token, user_id, platform }) => ({ token, user_id, platform }))).toEqual([
      { token: BOB_PHONE, user_id: BOB, platform: "ios" },
      { token: ALICE_PHONE, user_id: ALICE, platform: "android" },
    ]);

    fake.table("push_tokens")[0]!.last_error = "MessageRateExceeded";
    vi.setSystemTime(new Date("2026-11-09T11:00:00Z"));
    expect((await as(target, BOB).put("/api/me/push-token", { token: BOB_PHONE, platform: "ios" })).statusCode).toBe(204);
    const bob = fake.table("push_tokens").filter((row) => row.token === BOB_PHONE);
    expect(bob).toHaveLength(1);
    expect(bob[0]).toMatchObject({ user_id: BOB, last_error: null, created_at: "2026-11-09T10:00:00.000Z", updated_at: "2026-11-09T11:00:00.000Z" });

    // Alice ne peut pas oublier l'appareil de Bob ; Bob, oui.
    expect((await as(target, ALICE).del("/api/me/push-token", { token: BOB_PHONE })).statusCode).toBe(204);
    expect(tokensOf(fake, BOB)).toEqual([BOB_PHONE]);
    expect((await as(target, BOB).del("/api/me/push-token", { token: BOB_PHONE })).statusCode).toBe(204);
    expect(tokensOf(fake, BOB)).toEqual([]);
    expect(tokensOf(fake, ALICE)).toEqual([ALICE_PHONE]);
  });

  it("un téléphone n'est qu'à un compte : connecté à un autre compte, il change de propriétaire", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await as(target, CHLOE).put("/api/me/push-token", { token: BOB_PHONE, platform: "ios" })).statusCode).toBe(204);
    expect(fake.table("push_tokens").map((row) => [row.token, row.user_id])).toEqual([[BOB_PHONE, CHLOE]]);
  });

  it(`${MAX_DEVICES_PER_ACCOUNT} appareils au plus par compte : le plus ancien est oublié`, async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fake = seeded();
    const target = await pushApp(fake.db);
    const tokens = Array.from({ length: MAX_DEVICES_PER_ACCOUNT + 1 }, (_, index) => `ExponentPushToken[appareil${String(index).padStart(4, "0")}]`);
    for (const [index, token] of tokens.entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 10, 9, 10, index)));
      expect((await as(target, ALICE).put("/api/me/push-token", { token, platform: "ios" })).statusCode).toBe(204);
    }
    expect(tokensOf(fake, ALICE).sort()).toEqual(tokens.slice(1).sort());
  });

  it("une écriture impossible : 500, sans le jeton dans la réponse", async () => {
    const fake = seeded({}, { failWrite: (table) => (table === "push_tokens" ? { code: "XX000", message: `ligne ${ALICE_PHONE}` } : null) });
    const target = await pushApp(fake.db);
    const res = await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "ios" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("PushToken");
  });
});

describe("envoi d'une notification à la personne qui reçoit", () => {
  beforeEach(() => {
    env.PUSH_ENABLED = true;
  });

  it("seulement ses appareils, « Spotto », qui écrit, l'identifiant de la conversation — jamais le texte", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: BOB_TABLET, user_id: BOB }, { token: ALICE_PHONE, user_id: ALICE }] });
    const target = await pushApp(fake.db);
    const res = await send(target, ALICE, BOB);
    expect(res.statusCode).toBe(201);
    const conversationId = res.json().conversationId as string;
    expect(expoCalls).toHaveLength(1);
    expect(expoCalls[0]!.url).toBe(EXPO_PUSH_URL);
    expect(expoCalls[0]!.messages.map((message) => message.to).sort()).toEqual([BOB_PHONE, BOB_TABLET].sort());
    for (const message of expoCalls[0]!.messages) {
      expect(message).toEqual({ to: message.to, title: "Spotto", body: "Nouveau message de @alice", data: { conversationId }, sound: "default" });
    }
    expect(JSON.stringify(expoCalls)).not.toContain("privé");
    // Sans jeton d'accès d'Expo : aucun en-tête d'autorisation.
    expect(expoCalls[0]!.headers.authorization).toBeUndefined();
  });

  it("dans la langue de la personne qui reçoit ; une invitation se dit « Invitation de @… »", async () => {
    const fake = seeded({ bobLocale: "en", tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await send(target, ALICE, BOB)).json().state).toBe("invitation_sent");
    expect(expoCalls[0]!.messages[0]!.body).toBe("Invitation from @alice");
    expect(pushBody("invitation", "alice", "fr")).toBe("Invitation de @alice");
    expect(pushBody("direct", "alice", "en")).toBe("New message from @alice");
    expect(pushBody("direct", "alice", null)).toBe("Nouveau message de @alice");
  });

  it("jeton d'accès d'Expo réglé : envoyé dans l'en-tête d'autorisation", async () => {
    env.EXPO_ACCESS_TOKEN = "jeton-factice-des-tests";
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    await send(target, ALICE, BOB);
    expect(expoCalls[0]!.headers.authorization).toBe("Bearer jeton-factice-des-tests");
  });

  it("jamais pour ses propres messages, ni sans appareil", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: ALICE_PHONE, user_id: ALICE }] });
    const target = await pushApp(fake.db);
    const res = await send(target, ALICE, BOB);
    expect(res.statusCode).toBe(201);
    expect(expoCalls).toEqual([]);
    notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: ALICE, conversationId: res.json().conversationId });
    await flushPushes();
    expect(expoCalls).toEqual([]);
  });

  it("jamais entre deux comptes en blocage (dans un sens ou dans l'autre)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    const conversationId = (await send(target, ALICE, BOB)).json().conversationId as string;
    expect(expoCalls).toHaveLength(1);
    for (const block of [{ blocker_id: BOB, blocked_id: ALICE }, { blocker_id: ALICE, blocked_id: BOB }]) {
      fake.table("blocks").splice(0, Infinity, block);
      resetPushCollapse();
      // La route refuse déjà l'envoi…
      expect((await send(target, ALICE, BOB)).statusCode).toBe(404);
      // … et la notification le revérifie elle-même.
      notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: BOB, conversationId });
      await flushPushes();
    }
    expect(expoCalls).toHaveLength(1);
  });

  it("jamais depuis un compte suspendu", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    const conversationId = (await send(target, ALICE, BOB)).json().conversationId as string;
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    resetPushCollapse();
    expect((await send(target, ALICE, BOB)).statusCode).toBe(403);
    notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: BOB, conversationId });
    await flushPushes();
    expect(expoCalls).toHaveLength(1);
  });

  it("règles des invitations : refusée, ou une seconde invitation en attente, rien ne part", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    const conversationId = (await send(target, ALICE, BOB)).json().conversationId as string;
    expect(expoCalls).toHaveLength(1);
    resetPushCollapse();
    // Invitation en attente : la route refuse un second message (409), rien ne part.
    expect((await send(target, ALICE, BOB, "Encore moi")).statusCode).toBe(409);
    expect(expoCalls).toHaveLength(1);
    // Bob refuse : même appelée directement, la notification ne part pas.
    expect((await as(target, BOB).post(`/api/conversations/${conversationId}/decline`)).statusCode).toBe(204);
    notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: BOB, conversationId });
    await flushPushes();
    expect(expoCalls).toHaveLength(1);
    // Réglage « Qui peut m'écrire » de Chloé à « personne » : l'envoi est refusé, rien ne part.
    fake.table("profiles").find((row) => row.id === CHLOE)!.messages_from = "nobody";
    fake.table("push_tokens").push({ token: CHLOE_PHONE, user_id: CHLOE, platform: "ios" });
    expect((await send(target, ALICE, CHLOE)).statusCode).toBe(403);
    expect(expoCalls).toHaveLength(1);
  });

  it("regroupement : une notification par conversation toutes les 2 minutes, même pour des envois simultanés", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const fake = seeded({ follows: [...friends(ALICE, BOB), ...friends(CHLOE, BOB)], tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    const conversationId = (await send(target, ALICE, BOB, "un")).json().conversationId as string;
    await send(target, ALICE, BOB, "deux");
    await send(target, ALICE, BOB, "trois");
    expect(expoCalls).toHaveLength(1);
    // Une autre conversation n'est pas regroupée avec la première.
    await send(target, CHLOE, BOB, "bonjour");
    expect(expoCalls).toHaveLength(2);
    expect(expoCalls[1]!.messages[0]!.body).toBe("Nouveau message de @chloe");
    // Passé 2 minutes, la conversation d'Alice notifie de nouveau.
    vi.setSystemTime(new Date(Date.parse("2026-11-09T10:00:00Z") + COLLAPSE_WINDOW_MS + 1000));
    await send(target, ALICE, BOB, "quatre");
    expect(expoCalls).toHaveLength(3);
    // Deux notifications lancées au même instant : une seule part.
    resetPushCollapse();
    notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: BOB, conversationId });
    notifyNewMessage(target, target.log, { senderId: ALICE, recipientId: BOB, conversationId });
    await flushPushes();
    expect(expoCalls).toHaveLength(4);
  });

  it("« DeviceNotRegistered » : l'appareil est oublié ; une autre erreur est notée (son code seulement)", async () => {
    stubExpo((messages) =>
      Response.json({
        data: messages.map((message) =>
          message.to === BOB_PHONE
            ? { status: "error", message: `"${BOB_PHONE}" is not a registered push notification recipient`, details: { error: "DeviceNotRegistered" } }
            : { status: "error", message: "Trop d'envois", details: { error: "MessageRateExceeded" } }
        ),
      })
    );
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: BOB_TABLET, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect(tokensOf(fake, BOB)).toEqual([BOB_TABLET]);
    expect(fake.table("push_tokens")[0]).toMatchObject({ token: BOB_TABLET, last_error: "MessageRateExceeded" });
  });

  it("une panne d'Expo ou de la base ne change rien à l'envoi du message (lancé puis oublié)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    // Réseau en panne.
    stubExpo(() => {
      throw new TypeError("fetch failed");
    });
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    // Expo répond 500, puis une réponse illisible.
    for (const reply of [() => new Response("panne", { status: 500 }), () => new Response("pas du JSON")]) {
      resetPushCollapse();
      stubExpo(reply);
      expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    }
    // Expo ne répond pas : la réponse de l'envoi n'attend pas.
    let answer: (response: Response) => void = () => {};
    resetPushCollapse();
    stubExpo(() => new Promise<Response>((resolve) => (answer = resolve)));
    const started = Date.now();
    const pending = await as(target, ALICE).post("/api/messages", { recipientId: BOB, text: "sans attendre" });
    expect(pending.statusCode).toBe(201);
    expect(Date.now() - started).toBeLessThan(2_000);
    await vi.waitFor(() => expect(expoCalls).toHaveLength(4));
    answer(new Response("fin", { status: 503 }));
    await flushPushes();
    // Lecture de la base impossible pendant la notification (langue du profil).
    resetPushCollapse();
    const broken = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] }, { missingColumns: { profiles: ["locale"] } });
    await app!.close();
    const other = await pushApp(broken.db);
    expect((await send(other, ALICE, BOB)).statusCode).toBe(201);
  });

  it("l'envoi du message échoue : aucune notification", async () => {
    const fake = seeded(
      { follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }] },
      { failWrite: (table, action) => (table === "messages" && action === "insert" ? { code: "XX000", message: "panne" } : null) }
    );
    const target = await pushApp(fake.db);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(500);
    expect(expoCalls).toEqual([]);
  });

  it("journal : des nombres et des codes, jamais un jeton, un texte ni un nom", async () => {
    stubExpo((messages) =>
      Response.json({ data: messages.map((message) => (message.to === BOB_PHONE ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: "x" })) })
    );
    const lines: string[] = [];
    const fake = seeded({ follows: friends(ALICE, BOB), tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: BOB_TABLET, user_id: BOB }] });
    const target = await pushApp(fake.db, lines);
    expect((await send(target, ALICE, BOB)).statusCode).toBe(201);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: ALICE_PHONE, platform: "ios" })).statusCode).toBe(204);
    expect((await as(target, ALICE).put("/api/me/push-token", { token: "ExponentPushToken[mauvais jeton]", platform: "ios" })).statusCode).toBe(400);
    stubExpo(() => {
      throw new Error(`panne avec ${BOB_TABLET}`);
    });
    resetPushCollapse();
    await send(target, ALICE, BOB);
    const journal = lines.join("\n");
    const sent = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === "Notification de message envoyée");
    expect(sent).toMatchObject({ devices: 2, sent: 1, failed: 1, removed: 1, codes: ["DeviceNotRegistered"] });
    expect(journal).toContain("Notification de message non envoyée");
    for (const forbidden of ["PushToken", "bobBobBob", "aliceAlice", "mauvais", SECRET, "privé", "@alice", "alice"]) expect(journal).not.toContain(forbidden);
  });
});

describe("données personnelles", () => {
  beforeEach(() => {
    env.PUSH_ENABLED = true;
  });

  it("l'export liste les appareils : système et dates, jamais le jeton (JSON et fichier lisible)", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: ALICE_PHONE, user_id: ALICE }] });
    const target = await pushApp(fake.db);
    const json = await as(target, BOB).get("/api/me/export");
    expect(json.statusCode).toBe(200);
    expect(json.json().pushDevices).toEqual([{ platform: "ios", created_at: "2026-11-01T10:00:00.000Z", updated_at: "2026-11-01T10:00:00.000Z" }]);
    expect(json.body).not.toContain("PushToken");
    const page = await target.inject({ method: "GET", url: "/api/me/export?format=html", headers: { "x-test-user": BOB, "accept-language": "fr" } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Vos appareils pour les notifications");
    expect(page.body).toContain("iPhone");
    expect(page.body).not.toContain("PushToken");
    const pageEn = await target.inject({ method: "GET", url: "/api/me/export?format=html", headers: { "x-test-user": BOB, "accept-language": "en" } });
    expect(pageEn.body).toContain("Your devices for notifications");
  });

  it("l'export reste complet même interrupteur coupé (des appareils enregistrés avant)", async () => {
    env.PUSH_ENABLED = false;
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }] });
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).get("/api/me/export")).json().pushDevices).toHaveLength(1);
  });

  it("la suppression du compte efface ses appareils, pas ceux des autres", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }, { token: BOB_TABLET, user_id: BOB }, { token: ALICE_PHONE, user_id: ALICE }] });
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([BOB]);
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([ALICE_PHONE]);
  });

  it("la suppression du compte se fait même si l'effacement des appareils échoue (la base les efface en cascade)", async () => {
    const fake = seeded({ tokens: [{ token: BOB_PHONE, user_id: BOB }] }, { failWrite: (table) => (table === "push_tokens" ? { code: "XX000", message: "panne" } : null) });
    const target = await pushApp(fake.db);
    expect((await as(target, BOB).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([BOB]);
  });
});
