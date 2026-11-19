import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_PUSH_KINDS, type ActivityPushKind, type MentionsFrom, type PrivacyLevel } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import commentsRoutes from "../src/routes/comments.js";
import followsRoutes from "../src/routes/follows.js";
import conversationsRoutes from "../src/routes/conversations.js";
import pushTokensRoutes from "../src/routes/pushTokens.js";
import accountRoutes from "../src/routes/account.js";
import { env } from "../src/env.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import { notify, type MemberNotificationType } from "../src/lib/notify.js";
import { resetPostExtrasProbe } from "../src/lib/postExtras.js";
import {
  ACTIVITY_COLLAPSE_WINDOW_MS,
  ACTIVITY_KIND,
  ACTIVITY_PUSH_DAILY_MAX,
  activityPushBody,
  activityPushData,
  flushPushes,
  forgetAlertsOnlyDevices,
  notifyActivity,
  registerPushTokenSchema,
  resetPushCollapse,
  resetPushProbe,
} from "../src/lib/push.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { resetWishAlertsProbe } from "../src/lib/wishAlertsSchema.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Notifications d'activité sur le téléphone (lot « découverte », migration
// 0051), SANS base ni réseau : les vraies routes (« j'aime », commentaires,
// abonnements, appareils, état de la messagerie) sur une fausse base en
// mémoire (tests/fakeSupabase.ts), et un faux service d'Expo — aucun test
// n'envoie une vraie notification (tests/setup/noPaidCalls.ts refuse exp.host).
// Chaque règle de la fiche a son cas « refusé » à côté de son cas « permis ».
// Le même parcours sur la vraie base : notificationsActiviteBase.test.ts.

vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, PUSH_ENABLED: false, EXPO_ACCESS_TOKEN: undefined } };
});

// Anna agit. Bruno reçoit (compte public, en français). Carl écrit en
// anglais. Dora suit Bruno. Eve est une inconnue. Paula a un compte privé.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const PAULA = "70000000-0000-4000-8000-000000000007";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const BRUNO_PUBLIC = "b1000000-0000-4000-8000-000000000001";
const BRUNO_FOLLOWERS = "b1000000-0000-4000-8000-000000000002";
const BRUNO_HIDDEN = "b1000000-0000-4000-8000-000000000003";
const BRUNO_OTHER = "b1000000-0000-4000-8000-000000000004";
const CARL_PUBLIC = "c1000000-0000-4000-8000-000000000001";
const PAULA_PUBLIC = "71000000-0000-4000-8000-000000000001";
/** Publications de Bruno en plus (plafond des 24 heures). */
const extraPost = (index: number) => `b2000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const CAPTION = "Légende secrète du manteau";
const MEDIA = "https://exemple.supabase.co/storage/v1/object/public/post-media/secret-manteau.jpg";
const SECRET_COMMENT = "Texte secret du commentaire";

const BRUNO_PHONE = "ExponentPushToken[brunoBrunoBruno00001]";
const BRUNO_TABLET = "ExponentPushToken[brunoBrunoBruno00002]";
const ANNA_PHONE = "ExponentPushToken[annaAnnaAnnaAnna0001]";
const DORA_PHONE = "ExponentPushToken[doraDoraDoraDora0001]";
const EVE_PHONE = "ExponentPushToken[eveEveEveEveEve00001]";

const ACTIVITY_COLUMNS = ["notify_likes", "notify_comments", "notify_follows", "notify_mentions"];

/** Ce que reçoit un appareil : messages, alertes, et les quatre sortes d'activité. */
type Switches = Partial<Record<"messages" | "alerts" | ActivityPushKind, boolean>>;

function device(token: string, userId: string, on: Switches = {}): Row {
  return {
    token,
    user_id: userId,
    platform: "ios",
    created_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:00:00.000Z",
    last_error: null,
    notify_messages: on.messages ?? false,
    notify_alerts: on.alerts ?? false,
    notify_likes: on.likes ?? false,
    notify_comments: on.comments ?? false,
    notify_follows: on.follows ?? false,
    notify_mentions: on.mentions ?? false,
  };
}
const ALL_ACTIVITY: Switches = { likes: true, comments: true, follows: true, mentions: true };

function profile(id: string, username: string | null, options: { locale?: string; isPrivate?: boolean; mentionsFrom?: MentionsFrom } = {}): Row {
  return {
    id,
    username,
    display_name: username ? username[0]!.toUpperCase() + username.slice(1) : "Sans nom",
    avatar_url: null,
    bio: null,
    locale: options.locale ?? "fr",
    default_privacy: "followers",
    piece_sends_from: "following",
    messages_from: "everyone",
    is_private: options.isPrivate ?? false,
    mentions_from: options.mentionsFrom ?? "everyone",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

function post(id: string, userId: string, privacy: PrivacyLevel, hidden = false): Row {
  return {
    id,
    user_id: userId,
    type: "lifestyle",
    vault_item_id: null,
    wishlist_item_id: null,
    caption: CAPTION,
    media_url: MEDIA,
    media_thumb_url: null,
    media_removed_at: null,
    privacy,
    hidden_at: hidden ? "2026-11-12T00:00:00+00:00" : null,
    created_at: "2026-11-01T10:00:00+00:00",
  };
}

interface Seed {
  devices?: Row[];
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  brunoLocale?: string;
  brunoMentionsFrom?: MentionsFrom;
  /** Publications de Bruno en plus (plafond des 24 heures). */
  extraPosts?: number;
}

/** 0036 dans sa nouvelle version (sonde à 3) : les appareils disent ce qu'ils reçoivent. */
const rpc0036: NonNullable<FakeDbOptions["rpc"]> = async (fn) =>
  fn === "wish_alerts_version" ? { data: 3, error: null } : { data: null, error: { code: "PGRST202", message: "absente" } };
/** La base de production une fois 0051 appliquée. */
const WITH_0051: FakeDbOptions = { rpc: rpc0036 };
/** 0035 et 0036 en production, 0051 « à appliquer » (aujourd'hui). */
const WITHOUT_0051: FakeDbOptions = { rpc: rpc0036, missingColumns: { push_tokens: ACTIVITY_COLUMNS } };

function seeded(seed: Seed = {}, options: FakeDbOptions = WITH_0051) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(
    profile(ANNA, "anna"),
    profile(BRUNO, "bruno", { locale: seed.brunoLocale ?? "fr", mentionsFrom: seed.brunoMentionsFrom ?? "everyone" }),
    profile(CARL, "carl", { locale: "en" }),
    profile(DORA, "dora"),
    profile(EVE, "eve"),
    profile(PAULA, "paula", { isPrivate: true })
  );
  fake.table("posts").push(
    post(BRUNO_PUBLIC, BRUNO, "public"),
    post(BRUNO_FOLLOWERS, BRUNO, "followers"),
    post(BRUNO_HIDDEN, BRUNO, "public", true),
    post(BRUNO_OTHER, BRUNO, "public"),
    post(CARL_PUBLIC, CARL, "public"),
    post(PAULA_PUBLIC, PAULA, "public"),
    ...Array.from({ length: seed.extraPosts ?? 0 }, (_, index) => post(extraPost(index), BRUNO, "public"))
  );
  for (const [follower, followee] of [[DORA, BRUNO] as [string, string], ...(seed.follows ?? [])]) {
    fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  }
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  fake.table("push_tokens").push(...(seed.devices ?? []));
  return fake;
}

// ---- Faux service d'Expo ----

interface ExpoCall {
  url: string;
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
    expoCalls.push({ url, messages });
    return reply(messages);
  });
}
/** Les appareils prévenus, dans l'ordre. */
const sentTo = () => expoCalls.flatMap((call) => call.messages.map((message) => message.to));
const bodies = () => expoCalls.flatMap((call) => call.messages.map((message) => message.body));

let app: FastifyInstance | null = null;

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête,
 * et (au besoin) le journal du serveur avec ses vraies règles. */
async function activityApp(db: unknown, logLines?: string[]): Promise<FastifyInstance> {
  await app?.close();
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
  await app.register(multipart);
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(postsRoutes);
  await app.register(commentsRoutes);
  await app.register(followsRoutes);
  await app.register(conversationsRoutes);
  await app.register(pushTokensRoutes);
  await app.register(accountRoutes);
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

async function like(target: FastifyInstance, user: string, postId: string) {
  const res = await as(target, user).post(`/api/posts/${postId}/react`);
  await flushPushes();
  return res;
}
async function commentOn(target: FastifyInstance, user: string, postId: string, body: string, parentId?: string) {
  const res = await as(target, user).post(`/api/posts/${postId}/comments`, { body, ...(parentId ? { parentId } : {}) });
  await flushPushes();
  return res;
}
async function followUser(target: FastifyInstance, user: string, followee: string) {
  const res = await as(target, user).post(`/api/follows/${followee}?v=2`);
  await flushPushes();
  return res;
}
/** La notification de l'onglet Activité, écrite par la seule porte (lib/notify.ts), puis ses envois. */
async function notifyNow(target: FastifyInstance, input: Parameters<typeof notify>[2]) {
  const created = await notify(target, target.log, input);
  await flushPushes();
  return created;
}
const status = async (target: FastifyInstance) => (await as(target, ANNA).get("/api/messages/status")).json() as Record<string, unknown>;
const devicesOf = (fake: ReturnType<typeof fakeSupabase>, user: string) => fake.table("push_tokens").filter((row) => row.user_id === user);

beforeEach(() => {
  resetPushProbe();
  resetPushCollapse();
  resetWishAlertsProbe();
  resetMessagesProbe();
  resetPrivateAccountsProbe();
  resetCommentThreadsProbe();
  resetPostExtrasProbe();
  expoCalls = [];
  env.PUSH_ENABLED = true;
  env.EXPO_ACCESS_TOKEN = undefined;
  stubExpo();
});

afterEach(async () => {
  await flushPushes();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await app?.close();
  app = null;
  env.PUSH_ENABLED = false;
});

// ---------------------------------------------------------------------------

describe("ce que l'app apprend : activityPush (GET /api/messages/status)", () => {
  it("interrupteur coupé (par défaut) : false, même avec 0051 ; rien n'est proposé", async () => {
    env.PUSH_ENABLED = false;
    const target = await activityApp(seeded().db);
    expect(await status(target)).toMatchObject({ enabled: true, push: false, activityPush: false });
  });

  it("allumé : true seulement avec 0035, 0036 et 0051 ; sans l'une d'elles, false", async () => {
    const cases: [string, FakeDbOptions, boolean][] = [
      ["0035, 0036 et 0051", WITH_0051, true],
      ["sans 0051 (aujourd'hui)", WITHOUT_0051, false],
      ["sans 0036", {}, false],
      ["sans 0035", { rpc: rpc0036, missing: ["push_tokens"] }, false],
    ];
    for (const [label, options, expected] of cases) {
      resetPushProbe();
      resetWishAlertsProbe();
      const target = await activityApp(seeded({}, options).db);
      expect((await status(target)).activityPush, label).toBe(expected);
    }
  });

  it("sans la messagerie (0032), activityPush dit quand même si l'activité est possible", async () => {
    const target = await activityApp(seeded({}, { rpc: rpc0036, missing: ["conversations", "conversation_participants", "messages"] }).db);
    expect(await status(target)).toEqual({ enabled: false, unreadCount: 0, push: false, actions: false, activityPush: true });
  });

  it("base qui ne répond pas à la sonde de 0051 : false, sans le mémoriser ; true dès qu'elle répond", async () => {
    const fake = seeded();
    const target = await activityApp(unreadableActivityProbe(fake.db, 1));
    expect((await status(target)).activityPush).toBe(false);
    expect((await status(target)).activityPush).toBe(true);
  });
});

/** Une base dont la sonde de 0051 (les quatre colonnes, sans ligne) ne répond
 * pas les `times` premières fois : ni présente ni absente. */
function unreadableActivityProbe(db: unknown, times: number): unknown {
  let left = times;
  const base = db as { from: (table: string) => Record<string, unknown> };
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property !== "from") return Reflect.get(target, property, receiver);
      return (table: string) => {
        const builder = base.from(table);
        if (table !== "push_tokens") return builder;
        return new Proxy(builder, {
          get(inner, key, innerReceiver) {
            if (key !== "select") return Reflect.get(inner, key, innerReceiver);
            return (columns: string, ...rest: unknown[]) => {
              if (columns === "notify_likes, notify_comments, notify_follows, notify_mentions" && left > 0) {
                left -= 1;
                return { limit: async () => ({ data: null, error: { code: "57014", message: "délai dépassé" } }) };
              }
              return (inner.select as (...args: unknown[]) => unknown)(columns, ...rest);
            };
          },
        });
      };
    },
  });
}

describe("enregistrer les quatre réponses de l'appareil (PUT /api/me/push-token)", () => {
  it("le corps : chaque réponse est facultative ; autre chose qu'un oui / non est refusé", async () => {
    const base = { token: BRUNO_PHONE, platform: "ios" };
    expect(registerPushTokenSchema.parse(base)).toEqual(base);
    expect(registerPushTokenSchema.parse({ ...base, likes: true })).toEqual({ ...base, likes: true });
    expect(registerPushTokenSchema.parse({ ...base, comments: false, mentions: true })).toEqual({ ...base, comments: false, mentions: true });
    for (const field of ACTIVITY_PUSH_KINDS) {
      for (const value of ["true", 1, null, "oui"]) expect(registerPushTokenSchema.safeParse({ ...base, [field]: value }).success, `${field} = ${String(value)}`).toBe(false);
    }
    const fake = seeded();
    const target = await activityApp(fake.db);
    const refused = await as(target, BRUNO).put("/api/me/push-token", { ...base, likes: "oui" });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ error: "invalid_push_token", message: "Jeton de notification invalide." });
    expect(devicesOf(fake, BRUNO)).toEqual([]);
  });

  it("avec 0051 : un nouvel appareil n'a aucune sorte allumée ; chaque réponse s'écrit à part, absente elle ne change pas", async () => {
    const fake = seeded();
    const target = await activityApp(fake.db);
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", messages: true })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_likes: false, notify_comments: false, notify_follows: false, notify_mentions: false });
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", likes: true, mentions: true })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_messages: true, notify_likes: true, notify_comments: false, notify_follows: false, notify_mentions: true });
    // Une ancienne app rafraîchit son jeton sans les quatre champs : rien ne change pour l'activité.
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", messages: true, alerts: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_likes: true, notify_mentions: true });
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", likes: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_likes: false, notify_mentions: true });
  });

  it("règle 9 : un appareil n'est oublié que quand ses six réponses sont à false", async () => {
    const fake = seeded();
    const target = await activityApp(fake.db);
    const put = (payload: object) => as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", ...payload });
    expect((await put({ messages: false, alerts: false, likes: true, comments: false, follows: false, mentions: false })).statusCode).toBe(204);
    // Messages et alertes coupés, « j'aime » allumés : gardé (refusé : l'oublier).
    expect(devicesOf(fake, BRUNO)).toEqual([expect.objectContaining({ token: BRUNO_PHONE, notify_messages: false, notify_alerts: false, notify_likes: true })]);
    expect((await put({ messages: false, alerts: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)).toHaveLength(1);
    // Les quatre interrupteurs coupés, sans autre réponse : oublié.
    expect((await put({ likes: false, comments: false, follows: false, mentions: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)).toEqual([]);
    // Les six à false d'un coup : oublié sans être écrit.
    expect((await put({ messages: true, likes: true })).statusCode).toBe(204);
    expect((await put({ messages: false, alerts: false, likes: false, comments: false, follows: false, mentions: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)).toEqual([]);
  });

  it("sans 0051 : les quatre réponses sont ignorées (jamais écrites) ; messages et alertes coupés oublient l'appareil, comme avant", async () => {
    const fake = seeded({}, WITHOUT_0051);
    const target = await activityApp(fake.db);
    // Si le serveur nommait une colonne absente, la fausse base répondrait 42703 (500).
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", messages: true, likes: true })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)).toEqual([expect.objectContaining({ token: BRUNO_PHONE, notify_messages: true, notify_likes: false })]);
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", messages: false, alerts: false, likes: true })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)).toEqual([]);
  });

  it("base qui ne répond pas à la sonde de 0051 : une réponse de l'activité est refusée (500), jamais perdue en silence ; sans elle, l'appareil s'enregistre", async () => {
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { messages: true, likes: true })] });
    const target = await activityApp(unreadableActivityProbe(fake.db, 1));
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", likes: false })).statusCode).toBe(500);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_likes: true });
    // La sonde répond de nouveau : le même choix passe.
    expect((await as(target, BRUNO).put("/api/me/push-token", { token: BRUNO_PHONE, platform: "ios", likes: false })).statusCode).toBe(204);
    expect(devicesOf(fake, BRUNO)[0]).toMatchObject({ notify_likes: false, notify_messages: true });
    const later = seeded();
    resetPushProbe();
    const other = await activityApp(unreadableActivityProbe(later.db, 1));
    expect((await as(other, BRUNO).put("/api/me/push-token", { token: BRUNO_TABLET, platform: "ios", messages: true })).statusCode).toBe(204);
  });

  it("« Alertes prix et stock » coupé : l'appareil gardé pour l'activité reste, celui des seules alertes part ; sans 0051, comme avant", async () => {
    const fake = seeded({
      devices: [device(BRUNO_PHONE, BRUNO, { alerts: true, likes: true }), device(BRUNO_TABLET, BRUNO, { alerts: true }), device(DORA_PHONE, DORA, { alerts: true })],
    });
    const server = { supabaseAdmin: fake.db, log: { warn: () => {}, info: () => {} } } as unknown as FastifyInstance;
    await forgetAlertsOnlyDevices(server, BRUNO);
    expect(fake.table("push_tokens").map((row) => row.token)).toEqual([BRUNO_PHONE, DORA_PHONE]);
    resetPushProbe();
    const before = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { alerts: true, likes: true })] }, WITHOUT_0051);
    await forgetAlertsOnlyDevices({ supabaseAdmin: before.db, log: { warn: () => {}, info: () => {} } } as unknown as FastifyInstance, BRUNO);
    expect(before.table("push_tokens")).toEqual([]);
  });
});

describe("règle 1 : seulement les appareils où cette sorte est allumée", () => {
  it("un « j'aime » va à la tablette (« j'aime » allumés), jamais au téléphone (commentaires seulement)", async () => {
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { comments: true, messages: true, alerts: true }), device(BRUNO_TABLET, BRUNO, { likes: true })] });
    const target = await activityApp(fake.db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect(sentTo()).toEqual([BRUNO_TABLET]);
    // Le cas refusé seul : « j'aime » éteints, commentaires allumés → rien.
    expoCalls = [];
    fake.table("push_tokens").splice(1, 1);
    resetPushCollapse();
    expect((await like(target, CARL, BRUNO_OTHER)).statusCode).toBe(200);
    expect(sentTo()).toEqual([]);
    // Un commentaire, lui, part vers le téléphone.
    expect((await commentOn(target, CARL, BRUNO_OTHER, "Très beau")).statusCode).toBe(200);
    expect(sentTo()).toEqual([BRUNO_PHONE]);
  });

  it("chaque notification de l'onglet Activité a sa sorte : seul un appareil où elle est allumée la reçoit", async () => {
    expect(ACTIVITY_KIND).toEqual({
      like: "like",
      comment: "comment",
      reply: "comment",
      follow: "follow",
      follow_request: "follow",
      follow_accepted: "follow",
      mention: "mention",
      tag: "mention",
    });
    const families: Record<string, ActivityPushKind> = { like: "likes", comment: "comments", follow: "follows", mention: "mentions" };
    const types = Object.keys(ACTIVITY_KIND) as MemberNotificationType[];
    for (const type of types) {
      const family = families[ACTIVITY_KIND[type]]!;
      const others: Switches = { messages: true, alerts: true, ...Object.fromEntries(ACTIVITY_PUSH_KINDS.filter((kind) => kind !== family).map((kind) => [kind, true])) };
      const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { [family]: true }), device(BRUNO_TABLET, BRUNO, others)] });
      const target = await activityApp(fake.db);
      resetPushCollapse();
      expoCalls = [];
      const postId = type.startsWith("follow") ? undefined : BRUNO_PUBLIC;
      expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type, ...(postId ? { postId } : {}) }), type).toBe(true);
      expect(sentTo(), type).toEqual([BRUNO_PHONE]);
    }
  });
});

describe("règle 2 : jamais entre deux comptes en blocage", () => {
  it("dans un sens ou dans l'autre : ni « j'aime », ni commentaire, ni abonnement ; rien ne part, même appelé directement", async () => {
    for (const block of [[BRUNO, ANNA], [ANNA, BRUNO]] as [string, string][]) {
      const fake = seeded({ blocks: [block], devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
      const target = await activityApp(fake.db);
      expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(404);
      expect((await commentOn(target, ANNA, BRUNO_PUBLIC, "Bonjour")).statusCode).toBe(404);
      expect((await followUser(target, ANNA, BRUNO)).statusCode).toBe(403);
      for (const type of ["like", "comment", "mention", "follow"] as const) {
        expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type, ...(type === "follow" ? {} : { postId: BRUNO_PUBLIC }) }), type).toBe(false);
      }
      expect(fake.table("notifications")).toEqual([]);
    }
    expect(expoCalls).toEqual([]);
    // Sans blocage, le même « j'aime » part.
    const target = await activityApp(seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] }).db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect(sentTo()).toEqual([BRUNO_PHONE]);
  });
});

describe("règle 3 : rien d'un compte suspendu, ni vers lui", () => {
  it("auteur suspendu : il ne peut plus agir ; et même si une notification de l'onglet Activité est écrite, rien ne part", async () => {
    const fake = seeded({ suspended: [ANNA], devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(403);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: BRUNO_PUBLIC, oncePerPost: true })).toBe(true);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "follow" })).toBe(true);
    expect(fake.table("notifications")).toHaveLength(2);
    expect(expoCalls).toEqual([]);
  });

  it("destinataire suspendu : rien ne part ; levée la suspension, la notification suivante part", async () => {
    const fake = seeded({ suspended: [BRUNO], devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "follow" })).toBe(true);
    expect(expoCalls).toEqual([]);
    fake.table("suspensions").splice(0, Infinity);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: CARL, type: "follow" })).toBe(true);
    expect(sentTo()).toEqual([BRUNO_PHONE]);
  });
});

describe("règle 4 : rien sans la notification de l'onglet Activité", () => {
  it("sa propre publication, un « j'aime » déjà notifié, une écriture refusée : rien ne part", async () => {
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    expect((await like(target, BRUNO, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect(expoCalls).toEqual([]);
    // Le même « j'aime », de nouveau (une seule notification par auteur et publication) — même après le regroupement.
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: BRUNO_PUBLIC, oncePerPost: true })).toBe(true);
    resetPushCollapse();
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: BRUNO_PUBLIC, oncePerPost: true })).toBe(false);
    expect(sentTo()).toEqual([BRUNO_PHONE]);
    const refused = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] }, { ...WITH_0051, failWrite: (table) => (table === "notifications" ? { code: "XX000", message: "panne" } : null) });
    expoCalls = [];
    const other = await activityApp(refused.db);
    expect((await like(other, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect(await notifyNow(other, { recipientId: BRUNO, actorId: CARL, type: "follow" })).toBe(false);
    expect(expoCalls).toEqual([]);
  });

  it("une mention refusée par « Qui peut me mentionner » : ni notification ni envoi ; permise, elle part", async () => {
    const fake = seeded({ brunoMentionsFrom: "nobody", devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    expect((await commentOn(target, ANNA, CARL_PUBLIC, "Regardez @bruno")).statusCode).toBe(200);
    expect(fake.table("notifications").filter((row) => row.user_id === BRUNO)).toEqual([]);
    expect(expoCalls).toEqual([]);
    const open = seeded({ brunoMentionsFrom: "everyone", devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const other = await activityApp(open.db);
    expect((await commentOn(other, ANNA, CARL_PUBLIC, "Regardez @bruno")).statusCode).toBe(200);
    expect(bodies()).toEqual(["@anna vous a mentionné(e)"]);
  });
});

describe("règle 5 : rien au sujet d'une publication que la personne ne voit pas", () => {
  it("réservée aux abonnés, masquée par la modération, d'un compte privé : rien ne part ; visible, elle part", async () => {
    const fake = seeded({ devices: [device(EVE_PHONE, EVE, ALL_ACTIVITY), device(DORA_PHONE, DORA, ALL_ACTIVITY), device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    // Eve ne suit pas Bruno : sa publication « Abonnés » lui est cachée.
    expect(await notifyNow(target, { recipientId: EVE, actorId: ANNA, type: "mention", postId: BRUNO_FOLLOWERS, oncePerPost: true })).toBe(false);
    expect(await notifyNow(target, { recipientId: EVE, actorId: ANNA, type: "tag", postId: PAULA_PUBLIC, oncePerPost: true })).toBe(false);
    expect(await notifyNow(target, { recipientId: EVE, actorId: ANNA, type: "reply", postId: BRUNO_HIDDEN })).toBe(false);
    // Masquée par la modération : même son auteur n'en est plus prévenu.
    expect((await like(target, ANNA, BRUNO_HIDDEN)).statusCode).toBe(404);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "comment", postId: BRUNO_HIDDEN })).toBe(false);
    expect(expoCalls).toEqual([]);
    // Dora, abonnée, voit la publication « Abonnés » : la mention part.
    expect(await notifyNow(target, { recipientId: DORA, actorId: ANNA, type: "mention", postId: BRUNO_FOLLOWERS, oncePerPost: true })).toBe(true);
    expect(sentTo()).toEqual([DORA_PHONE]);
  });
});

describe("règle 6 : le nom de l'auteur et une phrase fixe, rien d'autre", () => {
  it("un commentaire : « Spotto », « @anna a commenté votre publication » et la publication ; jamais le texte, la légende ni l'image", async () => {
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    expect((await commentOn(target, ANNA, BRUNO_PUBLIC, SECRET_COMMENT)).statusCode).toBe(200);
    expect(expoCalls).toHaveLength(1);
    expect(expoCalls[0]!.messages).toEqual([{ to: BRUNO_PHONE, title: "Spotto", body: "@anna a commenté votre publication", data: { postId: BRUNO_PUBLIC }, sound: "default" }]);
    const payload = JSON.stringify(expoCalls);
    for (const secret of [SECRET_COMMENT, "secret", CAPTION, MEDIA, "post-media", ANNA, "Anna"]) expect(payload, secret).not.toContain(secret);
  });

  it("dans la langue de la personne qui la reçoit : les huit phrases, en français et en anglais", async () => {
    const expected: Record<MemberNotificationType, [string, string]> = {
      like: ["@anna a aimé votre publication", "@anna liked your post"],
      comment: ["@anna a commenté votre publication", "@anna commented on your post"],
      reply: ["@anna a répondu à votre commentaire", "@anna replied to your comment"],
      follow: ["@anna s'est abonné(e) à vous", "@anna started following you"],
      follow_request: ["@anna demande à vous suivre", "@anna asked to follow you"],
      follow_accepted: ["@anna a accepté votre demande d'abonnement", "@anna accepted your follow request"],
      mention: ["@anna vous a mentionné(e)", "@anna mentioned you"],
      tag: ["@anna vous a identifié(e) dans une publication", "@anna tagged you in a post"],
    };
    for (const [type, [fr, en]] of Object.entries(expected) as [MemberNotificationType, [string, string]][]) {
      expect(activityPushBody(type, "anna", "fr")).toBe(fr);
      expect(activityPushBody(type, "anna", "en")).toBe(en);
      expect(activityPushBody(type, "anna", null)).toBe(fr);
    }
    // Par la route : Bruno lit l'app en anglais.
    const target = await activityApp(seeded({ brunoLocale: "en", devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] }).db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect(bodies()).toEqual(["@anna liked your post"]);
  });

  it("les données : la publication, le membre, ou la liste des demandes ; rien d'autre", async () => {
    expect(activityPushData("like", ANNA, BRUNO_PUBLIC)).toEqual({ postId: BRUNO_PUBLIC });
    expect(activityPushData("tag", ANNA, BRUNO_PUBLIC)).toEqual({ postId: BRUNO_PUBLIC });
    expect(activityPushData("follow", ANNA, undefined)).toEqual({ userId: ANNA });
    expect(activityPushData("follow_accepted", ANNA, undefined)).toEqual({ userId: ANNA });
    expect(activityPushData("follow_request", ANNA, undefined)).toEqual({ screen: "requests" });
    // Une notification qui parle d'une publication sans la nommer ne part pas.
    expect(activityPushData("comment", ANNA, undefined)).toBeNull();
    // Par les routes : un abonnement, une demande à un compte privé, puis son acceptation.
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { follows: true }), device(EVE_PHONE, EVE, { follows: true }), device(ANNA_PHONE, ANNA, { follows: true })] });
    fake.table("profiles").find((row) => row.id === EVE)!.is_private = true;
    const target = await activityApp(fake.db);
    expect((await followUser(target, ANNA, BRUNO)).statusCode).toBe(200);
    expect((await followUser(target, ANNA, EVE)).json()).toEqual({ state: "requested" });
    expect((await as(target, EVE).post(`/api/follow-requests/${ANNA}/accept`)).statusCode).toBe(204);
    await flushPushes();
    expect(expoCalls.map((call) => [call.messages[0]!.to, call.messages[0]!.body, call.messages[0]!.data])).toEqual([
      [BRUNO_PHONE, "@anna s'est abonné(e) à vous", { userId: ANNA }],
      [EVE_PHONE, "@anna demande à vous suivre", { screen: "requests" }],
      [ANNA_PHONE, "@eve a accepté votre demande d'abonnement", { userId: EVE }],
    ]);
  });
});

describe("règle 7 : interrupteur coupé ou 0051 absente : aucun appel à Expo", () => {
  it.each<[string, FakeDbOptions, boolean]>([
    ["interrupteur coupé, 0051 appliquée", WITH_0051, false],
    ["interrupteur allumé, sans 0051 (des appareils prétendent recevoir l'activité)", WITHOUT_0051, true],
    ["interrupteur allumé, sans 0036", {}, true],
  ])("%s : « j'aime », commentaire et abonnement marchent, rien ne part", async (_label, options, enabled) => {
    env.PUSH_ENABLED = enabled;
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { ...ALL_ACTIVITY, messages: true })] }, options);
    const target = await activityApp(fake.db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect((await commentOn(target, ANNA, BRUNO_PUBLIC, SECRET_COMMENT)).statusCode).toBe(200);
    expect((await followUser(target, ANNA, BRUNO)).statusCode).toBe(200);
    expect(fake.table("notifications").map((row) => row.type).sort()).toEqual(["comment", "follow", "like"]);
    expect(expoCalls).toEqual([]);
  });

  it("sans 0035 : rien ne part, les actions marchent", async () => {
    const fake = seeded({}, { rpc: rpc0036, missing: ["push_tokens"] });
    const target = await activityApp(fake.db);
    expect((await like(target, ANNA, BRUNO_PUBLIC)).statusCode).toBe(200);
    expect((await followUser(target, ANNA, BRUNO)).statusCode).toBe(200);
    expect(expoCalls).toEqual([]);
  });
});

describe("règle 8 : regroupement et plafond (horloge simulée)", () => {
  it("une par personne, sorte et publication toutes les 10 minutes ; une autre publication ou une autre sorte passe", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-19T10:00:00Z");
    vi.setSystemTime(start);
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    await like(target, ANNA, BRUNO_PUBLIC);
    await like(target, CARL, BRUNO_PUBLIC);
    await like(target, DORA, BRUNO_PUBLIC);
    expect(bodies()).toEqual(["@anna a aimé votre publication"]);
    await like(target, CARL, BRUNO_OTHER);
    await commentOn(target, CARL, BRUNO_PUBLIC, "Superbe");
    expect(bodies()).toEqual(["@anna a aimé votre publication", "@carl a aimé votre publication", "@carl a commenté votre publication"]);
    // Passé 10 minutes, la même publication notifie de nouveau.
    vi.setSystemTime(start + ACTIVITY_COLLAPSE_WINDOW_MS + 1_000);
    await like(target, EVE, BRUNO_PUBLIC);
    expect(bodies()).toHaveLength(4);
  });

  it("abonnés : une par auteur toutes les 10 minutes (s'abonner, se désabonner, s'abonner de nouveau n'en fait qu'une)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-19T10:00:00Z"));
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, { follows: true })] });
    const target = await activityApp(fake.db);
    await followUser(target, ANNA, BRUNO);
    expect((await as(target, ANNA).del(`/api/follows/${BRUNO}`)).statusCode).toBe(204);
    await followUser(target, ANNA, BRUNO);
    await followUser(target, CARL, BRUNO);
    expect(bodies()).toEqual(["@anna s'est abonné(e) à vous", "@carl s'est abonné(e) à vous"]);
  });

  it("deux notifications lancées au même instant : une seule part", async () => {
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    notifyActivity(target, target.log, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: BRUNO_PUBLIC });
    notifyActivity(target, target.log, { recipientId: BRUNO, actorId: CARL, type: "like", postId: BRUNO_PUBLIC });
    await flushPushes();
    expect(expoCalls).toHaveLength(1);
  });

  it(`au plus ${ACTIVITY_PUSH_DAILY_MAX} sur 24 heures glissantes : la suivante ne part pas, puis de nouveau quand la plus ancienne a 24 heures`, async () => {
    expect(ACTIVITY_PUSH_DAILY_MAX).toBe(30);
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-19T08:00:00Z");
    vi.setSystemTime(start);
    const fake = seeded({ extraPosts: ACTIVITY_PUSH_DAILY_MAX + 2, devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    for (let index = 0; index < ACTIVITY_PUSH_DAILY_MAX + 1; index += 1) {
      vi.setSystemTime(start + index * 60_000);
      expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: extraPost(index), oncePerPost: true })).toBe(true);
    }
    // 31 « j'aime » notifiés dans l'onglet Activité ; 30 sur le téléphone.
    expect(fake.table("notifications")).toHaveLength(ACTIVITY_PUSH_DAILY_MAX + 1);
    expect(expoCalls).toHaveLength(ACTIVITY_PUSH_DAILY_MAX);
    // Un abonnement aussi est retenu : le plafond vaut pour toute l'activité.
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: CARL, type: "follow" })).toBe(true);
    expect(expoCalls).toHaveLength(ACTIVITY_PUSH_DAILY_MAX);
    // Une autre personne n'est pas concernée par le plafond de Bruno.
    fake.table("push_tokens").push(device(DORA_PHONE, DORA, ALL_ACTIVITY));
    expect(await notifyNow(target, { recipientId: DORA, actorId: CARL, type: "follow" })).toBe(true);
    expect(expoCalls).toHaveLength(ACTIVITY_PUSH_DAILY_MAX + 1);
    // 24 heures après la première : une place se libère.
    vi.setSystemTime(start + 24 * 60 * 60_000 + 1_000);
    expect(await notifyNow(target, { recipientId: BRUNO, actorId: ANNA, type: "like", postId: extraPost(ACTIVITY_PUSH_DAILY_MAX + 1), oncePerPost: true })).toBe(true);
    expect(expoCalls).toHaveLength(ACTIVITY_PUSH_DAILY_MAX + 2);
  });
});

describe("une seule porte, lancée puis oubliée", () => {
  const SRC = join(__dirname, "../src");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : name.endsWith(".ts") ? [path] : [];
    });
  }

  it("notifyActivity n'est appelée que par lib/notify.ts, juste après l'écriture de la notification", () => {
    const callers = files(SRC)
      .filter((path) => /\bnotifyActivity\(/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path))
      .sort();
    expect(callers).toEqual(["lib/notify.ts", "lib/push.ts"]);
    const source = readFileSync(join(SRC, "lib/notify.ts"), "utf8");
    const insert = source.indexOf('.from("notifications").insert(');
    const call = source.indexOf("notifyActivity(fastify, log,");
    expect(insert).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(insert);
    expect(source.slice(insert, call)).toContain("return false;");
    expect(source).not.toContain("await notifyActivity");
  });

  it("Expo ne répond pas : le « j'aime » répond tout de suite ; une panne d'Expo ne change rien à l'action", async () => {
    let answer: (response: Response) => void = () => {};
    stubExpo(() => new Promise<Response>((resolve) => (answer = resolve)));
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db);
    const started = Date.now();
    const res = await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`);
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(2_000);
    await vi.waitFor(() => expect(expoCalls).toHaveLength(1));
    answer(new Response("panne", { status: 503 }));
    await flushPushes();
    stubExpo(() => {
      throw new TypeError("fetch failed");
    });
    expect((await commentOn(target, ANNA, BRUNO_PUBLIC, "Encore")).statusCode).toBe(200);
  });

  it("journal : des nombres et des codes, jamais un jeton, un nom ni un texte", async () => {
    const lines: string[] = [];
    stubExpo((messages) => Response.json({ data: messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })) }));
    const fake = seeded({ devices: [device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY)] });
    const target = await activityApp(fake.db, lines);
    expect((await commentOn(target, ANNA, BRUNO_PUBLIC, SECRET_COMMENT)).statusCode).toBe(200);
    // « DeviceNotRegistered » : l'appareil est oublié.
    expect(devicesOf(fake, BRUNO)).toEqual([]);
    const sent = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === "Notification d'activité envoyée");
    expect(sent).toMatchObject({ devices: 1, sent: 0, failed: 1, removed: 1, codes: ["DeviceNotRegistered"] });
    fake.table("push_tokens").push(device(BRUNO_PHONE, BRUNO, ALL_ACTIVITY));
    await commentOn(target, CARL, BRUNO_PUBLIC, SECRET_COMMENT);
    expect(lines.join("\n")).toContain("Notification d'activité regroupée");
    const journal = lines.join("\n");
    for (const forbidden of ["PushToken", "brunoBruno", SECRET_COMMENT, CAPTION, "@anna", "anna", "@carl", "carl"]) expect(journal, forbidden).not.toContain(forbidden);
  });
});
