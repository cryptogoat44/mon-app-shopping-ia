import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ConversationThread, ConversationsPage, MessagesStatus, SendMessageResponse } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import conversationsRoutes from "../src/routes/conversations.js";
import reportsRoutes from "../src/routes/reports.js";
import { speaksV2 } from "../src/lib/clientLevel.js";
import { collectExport, messagesForExport } from "../src/lib/exportData.js";
import { EN_MESSAGES } from "../src/lib/messages.js";
import { FALLBACK_TEXT } from "../src/lib/messageActions.js";
import { messageActionsReady, resetMessageActionsProbe, resetMessagesProbe } from "../src/lib/messaging.js";
import { buildModerationItems, type QueueRow } from "../src/lib/moderationQueue.js";
import { pushBody } from "../src/lib/push.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { resetReadReceiptsProbe } from "../src/lib/readReceipts.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Messages, plus de confort (migration 0044), SANS base ni réseau : les
// vraies routes sur une fausse base en mémoire (tests/fakeSupabase.ts).
// Aimer un message, répondre à un message précis, supprimer un de ses
// messages, envoyer une publication. Chaque règle de confidentialité de la
// fiche a son test, avec le cas où elle doit refuser. Le même parcours sur la
// vraie base de développement : messagerieConfortBase.test.ts (sur le Mac,
// une fois 0044 appliquée sur spotto-dev-2).

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const DAN = "d0000000-0000-4000-8000-000000000004";
const POST = "e0000000-0000-4000-8000-000000000005";
const POST_2 = "e0000000-0000-4000-8000-000000000006";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const SINCE = "2026-10-01T00:00:00+00:00";
const CAPTION = "Ma veste en daim, légende secrète";
const POST_IMAGE = "https://stockage.example/post-media/veste.jpg";
const POST_THUMB = "https://stockage.example/post-media/veste-mini.jpg";
const INSULT = "Texte très blessant à garder pour la modération";

function profile(id: string, username: string, messagesFrom = "everyone"): Row {
  return {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: `https://stockage.example/avatars/${username}.jpg`,
    messages_from: messagesFrom,
    piece_sends_from: "following",
    read_receipts: true,
    read_receipts_since: SINCE,
  };
}

function post(id: string, author: string, privacy: "public" | "followers" | "private" = "public"): Row {
  return { id, user_id: author, type: "lifestyle", caption: CAPTION, media_url: POST_IMAGE, media_thumb_url: POST_THUMB, media_removed_at: null, privacy, hidden_at: null, created_at: SINCE };
}

/** Une base sans la migration 0044 : ni ses colonnes, ni sa table. */
const WITHOUT_0044: FakeDbOptions = {
  missing: ["message_reactions"],
  missingColumns: { messages: ["reply_to_id", "post_id", "shared_post", "deleted_at", "updated_at"] },
};
const WITHOUT_0043: FakeDbOptions = { missingColumns: { profiles: ["read_receipts", "read_receipts_since"] } };

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  posts?: Row[];
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profile(ALICE, "alice"), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(DAN, "dan"));
  for (const [follower, followee] of seed.follows ?? friends(ALICE, BOB)) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: SINCE });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: SINCE });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  fake.table("posts").push(...(seed.posts ?? []));
  return fake;
}
type Fake = ReturnType<typeof seeded>;

let app: FastifyInstance | null = null;

async function messagesApp(db: unknown, logLines?: string[]): Promise<FastifyInstance> {
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
  await app.register(reportsRoutes);
  await app.ready();
  return app;
}

/** Les demandes d'un membre. `english` : l'app est en anglais sur cet appareil. */
function as(target: FastifyInstance, user: string, english = false) {
  const headers = { "x-test-user": user, ...(english ? { "accept-language": "en-GB" } : {}) };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
  };
}

type Body = { text?: string; postId?: string; replyToId?: string; wishId?: string };

/** Envoi par la nouvelle app (`v=2`). */
async function send(target: FastifyInstance, from: string, to: string, body: Body): Promise<SendMessageResponse> {
  const res = await as(target, from).post("/api/messages?v=2", { recipientId: to, ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/** La conversation, telle que la nouvelle app la reçoit. */
async function thread(target: FastifyInstance, user: string, id: string, query = ""): Promise<ConversationThread> {
  const res = await as(target, user).get(`/api/conversations/${id}?v=2${query}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function list(target: FastifyInstance, user: string, v2 = true): Promise<ConversationsPage> {
  const res = await as(target, user).get(`/api/conversations${v2 ? "?v=2" : ""}`);
  expect(res.statusCode).toBe(200);
  return res.json();
}

const like = (target: FastifyInstance, user: string, messageId: string, liked = true) => as(target, user).put(`/api/messages/${messageId}/reaction`, { liked });
const remove = (target: FastifyInstance, user: string, messageId: string) => as(target, user).del(`/api/messages/${messageId}`);
const report = (target: FastifyInstance, user: string, targetType: "message" | "post", targetId: string) =>
  as(target, user).post("/api/reports", { targetType, targetId, reason: "harassment" });

const messageRow = (fake: Fake, id: string): Row => fake.table("messages").find((row) => row.id === id)!;
const sideRow = (fake: Fake, user: string): Row => fake.table("conversation_participants").find((row) => row.user_id === user)!;
const byId = (messages: ChatMessage[], id: string): ChatMessage => messages.find((message) => message.id === id)!;

/** Compte les lectures et écritures d'une table de la fausse base. */
function counting(fake: Fake, table: string): { db: unknown; count: () => number } {
  let calls = 0;
  const db = {
    ...fake.db,
    from: (name: string) => {
      if (name === table) calls += 1;
      return fake.db.from(name);
    },
  };
  return { db, count: () => calls };
}

// L'horloge du serveur avance à la demande : chaque geste a sa date, et la
// fausse base date ses lignes d'après la même horloge (jamais en arrière).
let clock = Date.parse("2032-03-01T08:00:00.000Z");
function later(ms = 60 * 60_000): string {
  clock += ms;
  vi.setSystemTime(clock);
  return new Date(clock).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  later();
  resetMessagesProbe();
  resetMessageActionsProbe();
  resetReadReceiptsProbe();
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = null;
});

describe("niveau de l'app (paramètre v)", () => {
  it("seule une app qui dit « v=2 » (ou plus) reçoit le nouveau vocabulaire", () => {
    for (const v of ["2", "3", "10"]) expect(speaksV2({ query: { v } }), v).toBe(true);
    for (const query of [{}, { v: "1" }, { v: "" }, { v: "deux" }, { v: "2.5" }, { v: ["2", "2"] }, { v: 2 }, null, undefined, "v=2"]) {
      expect(speaksV2({ query }), JSON.stringify(query)).toBe(false);
    }
  });
});

describe("sans la migration 0044", () => {
  it("la messagerie fonctionne comme avant ; l'app est prévenue (actions: false) ; réponse, publication, « j'aime » et suppression répondent « indisponible »", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] }, WITHOUT_0044);
    const target = await messagesApp(fake.db);
    expect(await messageActionsReady(target)).toBe(false);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: true, unreadCount: 0, push: false, actions: false } satisfies MessagesStatus);
    // Un message ordinaire part et se lit, avec ou sans « v=2 » : aucune colonne de 0044 n'est demandée.
    const sent = await send(target, ALICE, BOB, { text: "Bonjour" });
    expect(sent.message).toEqual({ id: sent.message.id, mine: true, text: "Bonjour", wish: null, createdAt: sent.message.createdAt });
    const read = await thread(target, BOB, sent.conversationId, "&changedSince=2020-01-01T00:00:00.000Z");
    expect(read.messages).toEqual([{ id: sent.message.id, mine: false, text: "Bonjour", wish: null, createdAt: sent.message.createdAt }]);
    expect(read).not.toHaveProperty("changed");
    expect(read).not.toHaveProperty("syncedAt");
    expect((await list(target, BOB)).conversations[0]!.lastMessage).toEqual({ text: "Bonjour", hasWish: false, mine: false, hidden: false, createdAt: sent.message.createdAt });

    const unavailable = { error: "message_actions_unavailable", message: "Cette action sur les messages n'est pas encore disponible." };
    for (const body of [{ text: "Réponse", replyToId: sent.message.id }, { postId: POST }, { text: "Regarde", postId: POST }]) {
      const res = await as(target, BOB).post("/api/messages?v=2", { recipientId: ALICE, ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(404);
      expect(res.json()).toEqual(unavailable);
    }
    expect((await like(target, BOB, sent.message.id)).json()).toEqual(unavailable);
    expect((await remove(target, ALICE, sent.message.id)).json()).toEqual(unavailable);
    // Rien n'a été écrit, et le message est toujours là.
    expect(fake.table("messages")).toHaveLength(1);
    expect(messageRow(fake, sent.message.id).body).toBe("Bonjour");
    expect(EN_MESSAGES[unavailable.message]).toBe("This action on messages isn't available yet.");
  });

  it("la sonde est refaite au bout de 5 minutes, puis mémorisée une fois la migration vue", async () => {
    const options: FakeDbOptions = { missing: ["message_reactions"] };
    const fake = seeded({}, options);
    const target = await messagesApp(fake.db);
    expect(await messageActionsReady(target)).toBe(false);
    options.missing = [];
    expect(await messageActionsReady(target)).toBe(false);
    later(5 * 60_000);
    expect(await messageActionsReady(target)).toBe(true);
    options.missing = ["message_reactions"];
    expect(await messageActionsReady(target)).toBe(true);
  });
});

describe("envoyer une publication", () => {
  it("la personne qui la reçoit et qui a le droit de la voir reçoit la carte ; rien de la publication n'est recopié dans le message, aucune image n'est copiée", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] });
    const logLines: string[] = [];
    const target = await messagesApp(fake.db, logLines);
    expect((await as(target, ALICE).get("/api/messages/status")).json().actions).toBe(true);
    const sent = await send(target, ALICE, BOB, { postId: POST });
    const card = { available: true, id: POST, author: { id: ALICE, username: "alice", displayName: "Alice", avatarUrl: "https://stockage.example/avatars/alice.jpg" }, thumbUrl: POST_THUMB, caption: CAPTION };
    expect(sent.message).toEqual({ id: sent.message.id, mine: true, text: null, wish: null, createdAt: sent.message.createdAt, liked: { mine: false, theirs: false }, replyTo: null, post: card });
    expect(byId((await thread(target, BOB, sent.conversationId)).messages, sent.message.id).post).toEqual(card);
    // La ligne ne porte que l'identifiant : ni légende, ni image, ni auteur.
    const stored = messageRow(fake, sent.message.id);
    expect(stored).toMatchObject({ post_id: POST, shared_post: true, body: null, wish_title: null, wish_image_url: null, wish_image_thumb_url: null });
    expect(JSON.stringify(stored)).not.toContain("daim");
    expect(JSON.stringify(stored)).not.toContain("veste");
    expect(fake.uploads).toEqual([]);
    // L'aperçu de la liste dit seulement qu'il y a une publication.
    expect((await list(target, BOB)).conversations[0]!.lastMessage).toEqual({ text: null, hasWish: false, mine: false, hidden: false, createdAt: sent.message.createdAt, hasPost: true });
    // Le journal dit la nature du message, jamais la légende ni l'identifiant de la publication.
    const journal = logLines.join("\n");
    expect(journal).toContain('"withPost":true');
    expect(journal).not.toContain("daim");
    expect(journal).not.toContain(POST);
  });

  it("règle 1 : la personne qui la reçoit sans avoir le droit de la voir reçoit « indisponible », jamais l'auteur, la légende ni l'image", async () => {
    // Publication « abonnés » de Chloé : Alice la suit, Bob non.
    const fake = seeded({ follows: [...friends(ALICE, BOB), [ALICE, CHLOE]], posts: [post(POST, CHLOE, "followers")] });
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Regarde", postId: POST });
    expect(sent.message.post).toMatchObject({ available: true, author: { username: "chloe" } });
    const res = await as(target, BOB).get(`/api/conversations/${sent.conversationId}?v=2`);
    expect(byId((res.json() as ConversationThread).messages, sent.message.id)).toMatchObject({ text: "Regarde", post: { available: false } });
    expect(byId((res.json() as ConversationThread).messages, sent.message.id).post).toEqual({ available: false });
    for (const secret of ["chloe", "Chloe", CHLOE, CAPTION, "daim", POST_IMAGE, POST_THUMB, POST]) expect(res.body, secret).not.toContain(secret);
    // Relu à chaque lecture : dès que Bob suit Chloé, il la voit ; dès qu'elle le bloque, plus rien.
    fake.table("follows").push({ follower_id: BOB, followee_id: CHLOE, created_at: SINCE });
    expect(byId((await thread(target, BOB, sent.conversationId)).messages, sent.message.id).post).toMatchObject({ available: true, id: POST, caption: CAPTION });
    fake.table("blocks").push({ blocker_id: CHLOE, blocked_id: BOB, created_at: SINCE });
    expect(byId((await thread(target, BOB, sent.conversationId)).messages, sent.message.id).post).toEqual({ available: false });
  });

  it("règle 1 : une publication que la personne qui lit a signalée est « indisponible » pour elle, pas pour l'autre", async () => {
    const fake = seeded({ posts: [post(POST, CHLOE)] });
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { postId: POST });
    expect(byId((await thread(target, BOB, sent.conversationId)).messages, sent.message.id).post).toMatchObject({ available: true });
    expect((await report(target, BOB, "post", POST)).statusCode).toBe(204);
    const res = await as(target, BOB).get(`/api/conversations/${sent.conversationId}?v=2`);
    expect(byId((res.json() as ConversationThread).messages, sent.message.id).post).toEqual({ available: false });
    expect(res.body).not.toContain("daim");
    expect(byId((await thread(target, ALICE, sent.conversationId)).messages, sent.message.id).post).toMatchObject({ available: true });
    // Et elle ne peut pas l'envoyer à son tour.
    expect((await as(target, BOB).post("/api/messages?v=2", { recipientId: ALICE, postId: POST })).statusCode).toBe(404);
  });

  it("règle 1 : une seule vérification par publication et par réponse, quel que soit le nombre de messages qui la portent", async () => {
    const fake = seeded({ posts: [post(POST, CHLOE), post(POST_2, CHLOE)] });
    const plain = await messagesApp(fake.db);
    let conversationId = "";
    for (let index = 0; index < 6; index += 1) conversationId = (await send(plain, ALICE, BOB, { postId: index === 5 ? POST_2 : POST })).conversationId;
    await plain.close();
    const counted = counting(fake, "posts");
    const target = await messagesApp(counted.db);
    const read = await thread(target, BOB, conversationId);
    expect(read.messages.filter((message) => message.post?.available === true)).toHaveLength(6);
    // Deux publications distinctes : une vérification chacune, puis une lecture commune pour les cartes.
    expect(counted.count()).toBe(3);
  });

  it("règle 2 : la personne qui l'a envoyée reçoit aussi « indisponible » quand la publication est masquée, supprimée, ou qu'elle n'a plus le droit de la voir", async () => {
    const fake = seeded({ follows: [...friends(ALICE, BOB), [ALICE, CHLOE]], posts: [post(POST, CHLOE, "followers")] });
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { postId: POST });
    const seenByAlice = async () => byId((await thread(target, ALICE, sent.conversationId)).messages, sent.message.id).post;
    expect(await seenByAlice()).toMatchObject({ available: true });
    const stored = fake.table("posts")[0]!;
    // Masquée par la modération.
    stored.hidden_at = later();
    expect(await seenByAlice()).toEqual({ available: false });
    stored.hidden_at = null;
    // Alice ne suit plus Chloé : la publication « abonnés » ne lui est plus montrée.
    fake.tables.set("follows", fake.table("follows").filter((row) => !(row.follower_id === ALICE && row.followee_id === CHLOE)));
    expect(await seenByAlice()).toEqual({ available: false });
    fake.table("follows").push({ follower_id: ALICE, followee_id: CHLOE, created_at: SINCE });
    expect(await seenByAlice()).toMatchObject({ available: true });
    // Passée en privé par son auteur.
    stored.privacy = "private";
    expect(await seenByAlice()).toEqual({ available: false });
    stored.privacy = "followers";
    // Supprimée : la base vide post_id, shared_post reste vrai, la ligne reste valide.
    fake.tables.set("posts", []);
    messageRow(fake, sent.message.id).post_id = null;
    const res = await as(target, ALICE).get(`/api/conversations/${sent.conversationId}?v=2`);
    expect(byId((res.json() as ConversationThread).messages, sent.message.id)).toMatchObject({ text: null, post: { available: false } });
    expect(res.body).not.toContain("daim");
  });

  it("une publication que l'expéditeur ne peut pas voir ne part pas (404, la même réponse qu'une publication inexistante) ; une seule carte par message", async () => {
    const fake = seeded({ posts: [post(POST, CHLOE, "private"), post(POST_2, CHLOE, "followers")] });
    const target = await messagesApp(fake.db);
    const notFound = { error: "post_not_found", message: "Publication introuvable." };
    for (const postId of [POST, POST_2, UNKNOWN]) {
      const res = await as(target, ALICE).post("/api/messages?v=2", { recipientId: BOB, postId });
      expect(res.statusCode, postId).toBe(404);
      expect(res.json()).toEqual(notFound);
    }
    expect(fake.table("messages")).toHaveLength(0);
    expect(fake.table("conversations")).toHaveLength(0);
    // Une envie ET une publication : refusé avant toute lecture.
    const both = await as(target, ALICE).post("/api/messages?v=2", { recipientId: BOB, postId: POST, wishId: UNKNOWN });
    expect(both.statusCode).toBe(400);
    expect(both.json().error).toBe("invalid_body");
    for (const extra of [{ matchId: UNKNOWN }, { collectionItemId: UNKNOWN }]) {
      expect((await as(target, ALICE).post("/api/messages?v=2", { recipientId: BOB, postId: POST, ...extra })).statusCode).toBe(400);
    }
  });

  it("règle 8 : la notification sur le téléphone ne dit rien de la publication (phrase fixe)", () => {
    for (const locale of ["fr", "en"]) {
      const body = pushBody("direct", "alice", locale);
      expect(body).toContain("alice");
      expect(body).not.toMatch(/publication|post\b|daim/i);
    }
    // La phrase ne dépend que de la nature de l'envoi (direct ou invitation) et du nom : jamais du contenu.
    expect(pushBody.length).toBe(3);
  });
});

describe("répondre à un message", () => {
  it("le message cité est renvoyé avec un extrait de 80 caractères au plus, à chacun des deux membres", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const long = `Une très longue phrase pour dire que ce sac est beau. ${"x".repeat(100)}`;
    const first = await send(target, ALICE, BOB, { text: long });
    const reply = await send(target, BOB, ALICE, { text: "Oui !", replyToId: first.message.id });
    expect(reply.message.replyTo).toEqual({ id: first.message.id, mine: false, kind: "text", excerpt: long.slice(0, 80) });
    expect(messageRow(fake, reply.message.id).reply_to_id).toBe(first.message.id);
    expect(byId((await thread(target, ALICE, first.conversationId)).messages, reply.message.id).replyTo).toEqual({ id: first.message.id, mine: true, kind: "text", excerpt: long.slice(0, 80) });
    expect(byId((await thread(target, ALICE, first.conversationId)).messages, first.message.id).replyTo).toBeNull();
  });

  it("une publication citée ne montre jamais rien d'elle dans la citation", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] });
    const target = await messagesApp(fake.db);
    const shared = await send(target, ALICE, BOB, { postId: POST });
    const reply = await send(target, BOB, ALICE, { text: "Jolie", replyToId: shared.message.id });
    expect(reply.message.replyTo).toEqual({ id: shared.message.id, mine: false, kind: "post", excerpt: null });
  });

  it("on ne répond qu'à un message de CETTE conversation qui vous est montré : sinon 404, la même réponse", async () => {
    const fake = seeded({ follows: [...friends(ALICE, BOB), ...friends(ALICE, CHLOE)] });
    const target = await messagesApp(fake.db);
    const withBob = await send(target, ALICE, BOB, { text: "Pour Bob" });
    const withChloe = await send(target, ALICE, CHLOE, { text: "Pour Chloé" });
    const hidden = await send(target, BOB, ALICE, { text: "Masqué par la modération" });
    const reported = await send(target, BOB, ALICE, { text: "Signalé par Alice" });
    const deleted = await send(target, BOB, ALICE, { text: "Supprimé" });
    messageRow(fake, hidden.message.id).hidden_at = later();
    expect((await report(target, ALICE, "message", reported.message.id)).statusCode).toBe(204);
    expect((await remove(target, BOB, deleted.message.id)).statusCode).toBe(204);
    const notFound = { error: "message_not_found", message: "Message introuvable." };
    const refused = async (from: string, to: string, replyToId: string, why: string) => {
      const res = await as(target, from).post("/api/messages?v=2", { recipientId: to, text: "Réponse", replyToId });
      expect(res.statusCode, why).toBe(404);
      expect(res.json(), why).toEqual(notFound);
    };
    await refused(ALICE, BOB, withChloe.message.id, "message d'une autre de ses conversations");
    await refused(BOB, ALICE, withChloe.message.id, "message d'une conversation dont il n'est pas membre");
    await refused(ALICE, BOB, UNKNOWN, "message inexistant");
    await refused(ALICE, BOB, hidden.message.id, "message masqué");
    await refused(ALICE, BOB, reported.message.id, "message qu'elle a signalé");
    await refused(ALICE, BOB, deleted.message.id, "message supprimé");
    await refused(ALICE, DAN, withBob.message.id, "première prise de contact : aucune conversation");
    // Bob, lui, peut encore répondre au message qu'Alice a signalé (il le voit toujours).
    expect((await send(target, BOB, ALICE, { text: "Suite", replyToId: reported.message.id })).message.replyTo).toMatchObject({ kind: "text", mine: true });
    expect(fake.table("messages").filter((row) => row.body === "Réponse")).toHaveLength(0);
    expect(EN_MESSAGES[notFound.message]).toBe("Message not found.");
  });

  it("règle 4 : un message cité masqué, supprimé, signalé par la personne qui lit ou d'avant ce qu'elle a effacé est « indisponible », sans extrait", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const secret = "Secret du message cité";
    const quoted = await send(target, ALICE, BOB, { text: secret });
    const reply = await send(target, BOB, ALICE, { text: "Réponse", replyToId: quoted.message.id });
    const id = quoted.conversationId;
    const unavailable = { id: quoted.message.id, mine: false, kind: "unavailable", excerpt: null };
    const quoteFor = async (user: string) => {
      const res = await as(target, user).get(`/api/conversations/${id}?v=2`);
      return { quote: byId((res.json() as ConversationThread).messages, reply.message.id).replyTo, body: res.body };
    };
    expect((await quoteFor(ALICE)).quote).toMatchObject({ kind: "text", excerpt: secret });

    // Signalé par Bob : indisponible pour lui (le message lui-même a disparu de sa vue), encore cité pour Alice.
    expect((await report(target, BOB, "message", quoted.message.id)).statusCode).toBe(204);
    const forBob = await quoteFor(BOB);
    expect(forBob.quote).toEqual(unavailable);
    expect(forBob.body).not.toContain(secret);
    expect((await quoteFor(ALICE)).quote).toMatchObject({ kind: "text", excerpt: secret });
    fake.tables.set("reports", []);

    // D'avant ce que Bob a effacé de sa vue.
    sideRow(fake, BOB).cleared_at = messageRow(fake, quoted.message.id).created_at;
    const cleared = await quoteFor(BOB);
    expect(cleared.quote).toEqual(unavailable);
    expect(cleared.body).not.toContain(secret);
    sideRow(fake, BOB).cleared_at = null;
    expect((await quoteFor(BOB)).quote).toMatchObject({ kind: "text" });

    // Masqué par la modération : pour les deux.
    messageRow(fake, quoted.message.id).hidden_at = later();
    for (const user of [ALICE, BOB]) {
      const seen = await quoteFor(user);
      expect(seen.quote, user).toEqual(unavailable);
      expect(seen.body, user).not.toContain(secret);
    }
    messageRow(fake, quoted.message.id).hidden_at = null;

    // Supprimé par son auteur : pour les deux, et l'app de Bob l'apprend à sa relecture.
    const before = (await thread(target, BOB, id)).syncedAt!;
    later();
    expect((await remove(target, ALICE, quoted.message.id)).statusCode).toBe(204);
    for (const user of [ALICE, BOB]) {
      const seen = await quoteFor(user);
      expect(seen.quote, user).toEqual(unavailable);
      expect(seen.body, user).not.toContain(secret);
    }
    const changed = (await thread(target, BOB, id, `&after=${encodeURIComponent(reply.message.createdAt)}&changedSince=${encodeURIComponent(before)}`)).changed!;
    expect(changed.map((message) => message.id).sort()).toEqual([quoted.message.id, reply.message.id].sort());
    expect(byId(changed, reply.message.id).replyTo).toEqual(unavailable);
  });
});

describe("aimer un message", () => {
  it("le sien ou celui de l'autre ; refaire la même demande ne change rien ; chacun voit « le mien » et « le sien »", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Tu as vu ce sac ?" });
    const first = await like(target, BOB, sent.message.id);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ message: { id: sent.message.id, mine: false, text: "Tu as vu ce sac ?", wish: null, createdAt: sent.message.createdAt, liked: { mine: true, theirs: false }, replyTo: null, post: null } });
    const touched = messageRow(fake, sent.message.id).updated_at;
    expect(touched).toBe(new Date(clock).toISOString());
    later();
    expect((await like(target, BOB, sent.message.id)).json().message.liked).toEqual({ mine: true, theirs: false });
    expect(fake.table("message_reactions")).toHaveLength(1);
    // Déjà aimé : rien n'est réécrit, l'app de l'autre membre n'a rien à relire.
    expect(messageRow(fake, sent.message.id).updated_at).toBe(touched);
    expect((await like(target, ALICE, sent.message.id)).json().message.liked).toEqual({ mine: true, theirs: true });
    expect(byId((await thread(target, BOB, sent.conversationId)).messages, sent.message.id).liked).toEqual({ mine: true, theirs: true });
    expect((await like(target, BOB, sent.message.id, false)).json().message.liked).toEqual({ mine: false, theirs: true });
    expect((await like(target, BOB, sent.message.id, false)).json().message.liked).toEqual({ mine: false, theirs: true });
    expect(fake.table("message_reactions")).toEqual([expect.objectContaining({ message_id: sent.message.id, user_id: ALICE })]);
    // Demande illisible.
    for (const payload of [{}, { liked: "oui" }, { liked: null }]) expect((await as(target, BOB).put(`/api/messages/${sent.message.id}/reaction`, payload)).statusCode).toBe(400);
    expect((await as(target, BOB).put("/api/messages/pas-un-id/reaction", { liked: true })).statusCode).toBe(400);
    expect(EN_MESSAGES["Réaction invalide."]).toBe("Invalid reaction.");
  });

  it("règle 8 : un « j'aime » ne prévient personne : ni « non lu », ni aperçu, ni ordre de la liste, ni notification", async () => {
    const fake = seeded();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Bonjour" });
    expect((await as(target, BOB).post(`/api/conversations/${sent.conversationId}/read`)).statusCode).toBe(204);
    const before = JSON.stringify([fake.table("conversations"), fake.table("conversation_participants")]);
    fetchSpy.mockClear();
    later();
    expect((await like(target, ALICE, sent.message.id)).statusCode).toBe(200);
    expect((await remove(target, ALICE, sent.message.id)).statusCode).toBe(204);
    expect(JSON.stringify([fake.table("conversations"), fake.table("conversation_participants")])).toBe(before);
    expect(sideRow(fake, BOB).unread).toBe(false);
    expect((await as(target, BOB).get("/api/messages/status")).json().unreadCount).toBe(0);
    expect(fake.table("notifications")).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    // Et dans le code : ni l'une ni l'autre de ces routes n'appelle l'envoi d'une notification.
    const routes = readFileSync(join(__dirname, "../src/routes/conversations.ts"), "utf8");
    const actions = routes.slice(routes.indexOf('"/api/messages/:id/reaction"'), routes.indexOf("function sendLimit"));
    expect(actions).toContain('fastify.delete("/api/messages/:id"');
    expect(actions).not.toMatch(/notifyNewMessage|notifications|unread/);
  });

  it("seulement dans une conversation ouverte aux deux : 409 pour une invitation en attente, d'un côté comme de l'autre", async () => {
    // Bob ne suit pas Alice : son premier message est une invitation.
    const fake = seeded({ follows: [] });
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Bonjour, on se connaît ?" });
    expect(sent.state).toBe("invitation_sent");
    const notOpen = { error: "conversation_not_open", message: "Cette conversation n'est pas encore ouverte : vous pourrez aimer un message quand elle le sera." };
    for (const user of [ALICE, BOB]) {
      const res = await like(target, user, sent.message.id);
      expect(res.statusCode, user).toBe(409);
      expect(res.json()).toEqual(notOpen);
    }
    expect(fake.table("message_reactions")).toHaveLength(0);
    expect(messageRow(fake, sent.message.id).updated_at).toBeNull();
    expect(EN_MESSAGES[notOpen.message]).toBeTruthy();
    // Acceptée : possible.
    expect((await as(target, BOB).post(`/api/conversations/${sent.conversationId}/accept`)).statusCode).toBe(204);
    expect((await like(target, BOB, sent.message.id)).statusCode).toBe(200);
  });

  it("règle 5 : ni « j'aime », ni réponse, ni suppression à travers un blocage ou depuis une conversation refusée : 404", async () => {
    const fake = seeded({ follows: [] });
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Bonjour" });
    const notFound = { error: "message_not_found", message: "Message introuvable." };
    // Refusée par Bob : pour lui, la conversation n'existe plus.
    expect((await as(target, BOB).post(`/api/conversations/${sent.conversationId}/decline`)).statusCode).toBe(204);
    expect((await like(target, BOB, sent.message.id)).json()).toEqual(notFound);
    expect((await as(target, BOB).post("/api/messages?v=2", { recipientId: ALICE, text: "Réponse", replyToId: sent.message.id })).json()).toEqual(notFound);
    expect(fake.table("messages")).toHaveLength(1);

    // Blocage, dans un sens comme dans l'autre.
    for (const [blocker, blocked] of [
      [ALICE, BOB],
      [BOB, ALICE],
    ] as const) {
      const blockedFake = seeded({ blocks: [] });
      await app?.close();
      const blockedTarget = await messagesApp(blockedFake.db);
      const message = await send(blockedTarget, ALICE, BOB, { text: "Avant le blocage" });
      blockedFake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: SINCE });
      for (const user of [ALICE, BOB]) {
        const liked = await like(blockedTarget, user, message.message.id);
        expect(liked.statusCode, `${blocker} bloque, ${user} aime`).toBe(404);
        expect(liked.json()).toEqual(notFound);
      }
      const deleted = await remove(blockedTarget, ALICE, message.message.id);
      expect(deleted.statusCode).toBe(404);
      expect(deleted.json()).toEqual(notFound);
      expect((await as(blockedTarget, BOB).post("/api/messages?v=2", { recipientId: ALICE, text: "Réponse", replyToId: message.message.id })).statusCode).toBe(404);
      expect(messageRow(blockedFake, message.message.id)).toMatchObject({ body: "Avant le blocage", deleted_at: null });
      expect(blockedFake.table("message_reactions")).toHaveLength(0);
    }
  });

  it("règle 6 : une personne qui n'est pas membre de la conversation ne peut ni aimer, ni supprimer, ni voir les « j'aime »", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Entre nous" });
    expect((await like(target, BOB, sent.message.id)).statusCode).toBe(200);
    const notFound = { error: "message_not_found", message: "Message introuvable." };
    for (const liked of [true, false]) {
      const res = await like(target, CHLOE, sent.message.id, liked);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual(notFound);
      expect(res.body).not.toContain("Entre nous");
    }
    const deleted = await remove(target, CHLOE, sent.message.id);
    expect(deleted.statusCode).toBe(404);
    expect(deleted.json()).toEqual(notFound);
    // Le message de l'autre membre non plus : seul son auteur le supprime.
    expect((await remove(target, BOB, sent.message.id)).json()).toEqual(notFound);
    expect((await as(target, CHLOE).get(`/api/conversations/${sent.conversationId}?v=2`)).statusCode).toBe(404);
    expect(fake.table("message_reactions")).toEqual([expect.objectContaining({ user_id: BOB })]);
    expect(messageRow(fake, sent.message.id)).toMatchObject({ body: "Entre nous", deleted_at: null });
    // Sans compte : rien.
    expect((await target.inject({ method: "PUT", url: `/api/messages/${sent.message.id}/reaction`, payload: { liked: true } })).statusCode).toBe(401);
    expect((await target.inject({ method: "DELETE", url: `/api/messages/${sent.message.id}` })).statusCode).toBe(401);
  });

  it("un compte suspendu ne peut plus aimer, mais peut toujours supprimer ses messages ; la limite est de 300 par heure", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Avant la suspension" });
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    expect((await like(target, ALICE, sent.message.id)).statusCode).toBe(403);
    expect(fake.table("message_reactions")).toHaveLength(0);
    expect((await remove(target, ALICE, sent.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, sent.message.id).body).toBeNull();
    expect(RATE_LIMITS.messageReact).toMatchObject({ max: 300, windowMs: 60 * 60_000, error: "message_react_limit" });
    expect(EN_MESSAGES[RATE_LIMITS.messageReact.message]).toBeTruthy();
  });

  it("on n'aime ni un message supprimé, ni un message masqué, ni un message qu'on a signalé", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const deleted = await send(target, ALICE, BOB, { text: "Supprimé" });
    const hidden = await send(target, ALICE, BOB, { text: "Masqué" });
    const reported = await send(target, ALICE, BOB, { text: "Signalé" });
    expect((await remove(target, ALICE, deleted.message.id)).statusCode).toBe(204);
    messageRow(fake, hidden.message.id).hidden_at = later();
    expect((await report(target, BOB, "message", reported.message.id)).statusCode).toBe(204);
    for (const id of [deleted.message.id, hidden.message.id, reported.message.id, UNKNOWN]) expect((await like(target, BOB, id)).statusCode, id).toBe(404);
    expect(fake.table("message_reactions")).toHaveLength(0);
  });
});

describe("supprimer un de ses messages", () => {
  it("règle 3 : un message supprimé arrive vide aux deux membres, dans la conversation, dans « changed » et dans l'aperçu ; son contenu est effacé de la base, ses « j'aime » aussi", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, { text: "Premier" });
    const sent = await send(target, ALICE, BOB, { text: "À effacer", postId: POST, replyToId: first.message.id });
    expect((await like(target, BOB, sent.message.id)).statusCode).toBe(200);
    const id = sent.conversationId;
    const before = (await thread(target, BOB, id)).syncedAt!;
    later();
    const res = await remove(target, ALICE, sent.message.id);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    const at = new Date(clock).toISOString();
    expect(messageRow(fake, sent.message.id)).toMatchObject({ body: null, wish_title: null, post_id: null, shared_post: false, reply_to_id: null, deleted_at: at, updated_at: at });
    expect(fake.table("message_reactions")).toHaveLength(0);
    const empty = (mine: boolean) => ({ id: sent.message.id, mine, text: null, wish: null, post: null, deleted: true, createdAt: sent.message.createdAt });
    for (const user of [ALICE, BOB]) {
      const page = await as(target, user).get(`/api/conversations/${id}?v=2&changedSince=${encodeURIComponent(before)}`);
      const read: ConversationThread = page.json();
      expect(byId(read.messages, sent.message.id), user).toEqual(empty(user === ALICE));
      expect(read.changed, user).toEqual([empty(user === ALICE)]);
      expect(page.body, user).not.toContain("À effacer");
      expect(page.body, user).not.toContain("daim");
      const preview = (await list(target, user)).conversations[0]!.lastMessage;
      expect(preview, user).toEqual({ text: null, hasWish: false, mine: user === ALICE, hidden: false, createdAt: sent.message.createdAt, deleted: true });
    }
    // Une seconde suppression : 204, rien ne change.
    later();
    expect((await remove(target, ALICE, sent.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, sent.message.id)).toMatchObject({ deleted_at: at, updated_at: at });
  });

  it("déjà signalé (signalement ouvert OU déjà traité) : le contenu reste dans la base pour la modération, mais n'est plus jamais renvoyé aux deux membres", async () => {
    for (const handled of [false, true]) {
      const fake = seeded();
      await app?.close();
      const logLines: string[] = [];
      const target = await messagesApp(fake.db, logLines);
      const sent = await send(target, BOB, ALICE, { text: INSULT });
      const id = sent.conversationId;
      const next = await send(target, BOB, ALICE, { text: "Suite" });
      expect((await like(target, ALICE, sent.message.id)).statusCode).toBe(200);
      // Signalé par un autre chemin que la personne qui lit (elle le verrait disparaître) : la ligne seule compte.
      fake.table("reports").push({ id: UNKNOWN, reporter_id: CHLOE, target_type: "message", target_id: sent.message.id, reason: "harassment", handled_at: handled ? later() : null });
      later();
      expect((await remove(target, BOB, sent.message.id)).statusCode, String(handled)).toBe(204);
      const at = new Date(clock).toISOString();
      // Conservé : seules les deux dates sont écrites.
      expect(messageRow(fake, sent.message.id)).toMatchObject({ body: INSULT, deleted_at: at, updated_at: at });
      expect(fake.table("message_reactions")).toHaveLength(0);
      expect(logLines.join("\n")).toContain('"kept":true');
      expect(logLines.join("\n")).not.toContain("blessant");
      // Règle 3 : conservé ou non, la réponse est la même, et le texte ne sort plus.
      for (const user of [ALICE, BOB]) {
        for (const url of [`/api/conversations/${id}?v=2`, `/api/conversations/${id}?v=2&changedSince=2020-01-01T00:00:00.000Z`, `/api/conversations/${id}`, `/api/conversations/with/${user === ALICE ? BOB : ALICE}?v=2`, "/api/conversations?v=2", "/api/conversations"]) {
          const page = await as(target, user).get(url);
          expect(page.statusCode, url).toBe(200);
          expect(page.body, `${user} ${url}`).not.toContain("blessant");
        }
        const read = await thread(target, user, id, "&changedSince=2020-01-01T00:00:00.000Z");
        const empty = { id: sent.message.id, mine: user === BOB, text: null, wish: null, post: null, deleted: true, createdAt: sent.message.createdAt };
        expect(byId(read.messages, sent.message.id)).toEqual(empty);
        expect(byId(read.changed!, sent.message.id)).toEqual(empty);
      }
      // Ni par une réponse, ni par un « j'aime » : le message n'est plus atteignable.
      expect((await as(target, ALICE).post("/api/messages?v=2", { recipientId: BOB, text: "Réponse", replyToId: sent.message.id })).statusCode).toBe(404);
      const liked = await like(target, ALICE, sent.message.id);
      expect(liked.statusCode).toBe(404);
      expect(liked.body).not.toContain("blessant");
      expect(messageRow(fake, next.message.id).body).toBe("Suite");
    }
  });

  it("la copie de l'image d'une envie jointe est effacée du stockage, sauf si le contenu est conservé pour la modération", async () => {
    for (const reportedBefore of [false, true]) {
      const fake = seeded();
      await app?.close();
      const target = await messagesApp(fake.db);
      const opened = await send(target, ALICE, BOB, { text: "Bonjour" });
      const image = `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${ALICE}/copie.jpg`;
      const thumb = `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${ALICE}/copie-mini.jpg`;
      fake.files.set(`post-media/${ALICE}/copie.jpg`, Buffer.alloc(1));
      fake.files.set(`post-media/${ALICE}/copie-mini.jpg`, Buffer.alloc(1));
      const inserted = await fake.db
        .from("messages")
        .insert({ conversation_id: opened.conversationId, sender_id: ALICE, wish_title: "Sac cabas", wish_image_url: image, wish_image_thumb_url: thumb, wish_merchant_url: "https://boutique.example/sac" })
        .select("id")
        .single();
      const wishMessage = (inserted.data as { id: string }).id;
      if (reportedBefore) expect((await report(target, BOB, "message", wishMessage)).statusCode).toBe(204);
      expect((await remove(target, ALICE, wishMessage)).statusCode).toBe(204);
      if (reportedBefore) {
        expect(fake.removed).toEqual([]);
        expect(messageRow(fake, wishMessage)).toMatchObject({ wish_title: "Sac cabas", wish_image_url: image, wish_image_thumb_url: thumb });
      } else {
        expect(fake.removed.sort()).toEqual([`post-media/${ALICE}/copie-mini.jpg`, `post-media/${ALICE}/copie.jpg`]);
        expect(messageRow(fake, wishMessage)).toMatchObject({ wish_title: null, wish_image_url: null, wish_image_thumb_url: null, wish_merchant_url: null });
      }
      // Dans les deux cas, la carte ne sort plus.
      const page = await as(target, ALICE).get(`/api/conversations/${opened.conversationId}?v=2`);
      expect(byId((page.json() as ConversationThread).messages, wishMessage)).toMatchObject({ wish: null, deleted: true });
      expect(page.body).not.toContain("Sac cabas");
    }
  });

  it("si les signalements ne peuvent pas être lus, rien n'est effacé (500)", async () => {
    const fake = seeded();
    // La table des signalements tombe en panne à la demande ; le reste de la base répond.
    let failing = false;
    const broken = fakeSupabase({ missing: ["reports"] });
    const db = { ...fake.db, from: (name: string) => (name === "reports" && failing ? broken.db.from(name) : fake.db.from(name)) };
    const target = await messagesApp(db);
    const sent = await send(target, ALICE, BOB, { text: "À garder dans le doute" });
    failing = true;
    expect((await remove(target, ALICE, sent.message.id)).statusCode).toBe(500);
    expect(messageRow(fake, sent.message.id)).toMatchObject({ body: "À garder dans le doute", deleted_at: null, updated_at: null });
    failing = false;
    expect((await remove(target, ALICE, sent.message.id)).statusCode).toBe(204);
  });

  it("un message supprimé peut encore être signalé par la personne qui l'a reçu ; supprimé AVANT le signalement, son contenu est vraiment effacé", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const sent = await send(target, BOB, ALICE, { text: INSULT });
    expect((await remove(target, BOB, sent.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, sent.message.id).body).toBeNull();
    expect((await report(target, ALICE, "message", sent.message.id)).statusCode).toBe(204);
    expect(fake.table("reports")).toEqual([expect.objectContaining({ reporter_id: ALICE, target_type: "message", target_id: sent.message.id })]);
    // Jamais le sien, ni celui d'une conversation dont on n'est pas membre.
    expect((await report(target, BOB, "message", sent.message.id)).statusCode).toBe(404);
    expect((await report(target, CHLOE, "message", sent.message.id)).statusCode).toBe(404);
    // Limite connue (décision 3) : la modération voit qui, quand, et la date de suppression, pas le contenu.
    const [item] = await buildModerationItems(target, [queueRow(sent.message.id)]);
    expect(item!.preview).toMatchObject({ kind: "message", author: { id: BOB }, text: null, wishTitle: null, createdAt: sent.message.createdAt, deletedAt: messageRow(fake, sent.message.id).deleted_at });
    expect(JSON.stringify(item)).not.toContain("blessant");
  });
});

function queueRow(targetId: string): QueueRow {
  return { target_type: "message", target_id: targetId, report_count: 1, reasons: { harassment: 1 }, notes: [], first_at: "2032-03-01T09:00:00.000Z", last_at: "2032-03-01T09:00:00.000Z" };
}

describe("file de modération", () => {
  it("règle 3 : le message signalé montre son contenu conservé et la date de suppression ; un message supprimé AUTOUR de lui ne montre que « supprimé »", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] });
    const target = await messagesApp(fake.db);
    const around = await send(target, ALICE, BOB, { text: "Message voisin supprimé, jamais montré" });
    const shared = await send(target, ALICE, BOB, { postId: POST });
    const reportedMessage = await send(target, BOB, ALICE, { text: INSULT });
    const after = await send(target, ALICE, BOB, { text: "Voisin conservé" });
    expect((await report(target, ALICE, "message", reportedMessage.message.id)).statusCode).toBe(204);
    // Le voisin est lui aussi conservé dans la base (signalé par ailleurs) : la file ne le montre pas pour autant.
    fake.table("reports").push({ id: UNKNOWN, reporter_id: CHLOE, target_type: "message", target_id: around.message.id, reason: "spam", handled_at: null });
    expect((await remove(target, ALICE, around.message.id)).statusCode).toBe(204);
    expect((await remove(target, BOB, reportedMessage.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, around.message.id).body).toBe("Message voisin supprimé, jamais montré");

    const [item] = await buildModerationItems(target, [queueRow(reportedMessage.message.id)]);
    const preview = item!.preview;
    if (preview.kind !== "message") throw new Error("aperçu inattendu");
    expect(preview).toMatchObject({ text: INSULT, deletedAt: messageRow(fake, reportedMessage.message.id).deleted_at, hidden: false });
    expect(preview.context).toEqual([
      { authorUsername: "alice", text: null, wishTitle: null, createdAt: around.message.createdAt, reported: false, hidden: false, deleted: true },
      { authorUsername: "alice", text: null, wishTitle: null, createdAt: shared.message.createdAt, reported: false, hidden: false, sharedPost: true },
      { authorUsername: "bob", text: INSULT, wishTitle: null, createdAt: reportedMessage.message.createdAt, reported: true, hidden: false, deleted: true },
      { authorUsername: "alice", text: "Voisin conservé", wishTitle: null, createdAt: after.message.createdAt, reported: false, hidden: false },
    ]);
    expect(JSON.stringify(item)).not.toContain("jamais montré");
    // Rien de la publication envoyée : ni légende, ni image.
    expect(JSON.stringify(item)).not.toContain("daim");
  });

  it("sans la migration 0044, la file se lit comme avant (aucune de ses colonnes n'est demandée)", async () => {
    const fake = seeded({}, WITHOUT_0044);
    const target = await messagesApp(fake.db);
    const sent = await send(target, BOB, ALICE, { text: INSULT });
    const [item] = await buildModerationItems(target, [queueRow(sent.message.id)]);
    expect(item!.preview).toMatchObject({ kind: "message", text: INSULT });
    expect(item!.preview).not.toHaveProperty("deletedAt");
  });
});

describe("relecture : ce qui a changé", () => {
  it("« changed » n'est lu que si l'app envoie changedSince : une seule lecture de plus ; « syncedAt » recule de 10 secondes sur l'horloge du serveur", async () => {
    const fake = seeded();
    const plain = await messagesApp(fake.db);
    const sent = await send(plain, ALICE, BOB, { text: "Bonjour" });
    await plain.close();
    const counted = counting(fake, "messages");
    const target = await messagesApp(counted.db);
    const id = sent.conversationId;
    const first = await thread(target, BOB, id);
    const without = counted.count();
    expect(first).not.toHaveProperty("changed");
    expect(first.syncedAt).toBe(new Date(clock - 10_000).toISOString());
    const second = await thread(target, BOB, id, `&changedSince=${encodeURIComponent(first.syncedAt!)}`);
    expect(counted.count() - without).toBe(without + 1);
    expect(second.changed).toEqual([]);
    // Un « j'aime » d'Alice : le message revient par « changed », pas par « after ».
    later();
    expect((await like(target, ALICE, sent.message.id)).statusCode).toBe(200);
    // Dans les 10 secondes qui suivent, il serait renvoyé deux fois (sans effet : l'app le remplace par son identifiant).
    later();
    const polled = await thread(target, BOB, id, `&after=${encodeURIComponent(sent.message.createdAt)}&changedSince=${encodeURIComponent(second.syncedAt!)}`);
    expect(polled.messages).toEqual([]);
    expect(polled.changed).toEqual([{ id: sent.message.id, mine: false, text: "Bonjour", wish: null, createdAt: sent.message.createdAt, liked: { mine: false, theirs: true }, replyTo: null, post: null }]);
    // Relu une fois, il ne revient plus.
    later();
    expect((await thread(target, BOB, id, `&changedSince=${encodeURIComponent(polled.syncedAt!)}`)).changed).toEqual([]);
    // Date illisible : refusée.
    expect((await as(target, BOB).get(`/api/conversations/${id}?v=2&changedSince=hier`)).statusCode).toBe(400);
  });

  it("« changed » suit les mêmes filtres que la conversation : jamais un message masqué, signalé par la personne qui lit, ou d'avant ce qu'elle a effacé", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const hidden = await send(target, ALICE, BOB, { text: "Masqué" });
    const reported = await send(target, ALICE, BOB, { text: "Signalé par Bob" });
    const cleared = await send(target, ALICE, BOB, { text: "Effacé de la vue de Bob" });
    const shown = await send(target, ALICE, BOB, { text: "Montré" });
    const id = shown.conversationId;
    for (const message of [hidden, reported, cleared, shown]) expect((await like(target, ALICE, message.message.id)).statusCode).toBe(200);
    const all = (await thread(target, BOB, id, "&changedSince=2020-01-01T00:00:00.000Z")).changed!;
    expect(all).toHaveLength(4);
    messageRow(fake, hidden.message.id).hidden_at = later();
    expect((await report(target, BOB, "message", reported.message.id)).statusCode).toBe(204);
    const page = await as(target, BOB).get(`/api/conversations/${id}?v=2&changedSince=2020-01-01T00:00:00.000Z`);
    expect((page.json() as ConversationThread).changed!.map((message) => message.id).sort()).toEqual([cleared.message.id, shown.message.id].sort());
    sideRow(fake, BOB).cleared_at = messageRow(fake, cleared.message.id).created_at;
    const after = await as(target, BOB).get(`/api/conversations/${id}?v=2&changedSince=2020-01-01T00:00:00.000Z`);
    expect((after.json() as ConversationThread).changed!.map((message) => message.id)).toEqual([shown.message.id]);
    for (const secret of ["Masqué", "Signalé par Bob", "Effacé de la vue"]) expect(after.body).not.toContain(secret);
    // Alice, elle, les reçoit tous sauf le message masqué.
    expect((await thread(target, ALICE, id, "&changedSince=2020-01-01T00:00:00.000Z")).changed).toHaveLength(3);
  });
});

describe("anciennes versions de l'app (sans v=2)", () => {
  it("un message supprimé ou qui ne porte qu'une publication arrive avec une phrase fixe, dans la langue de l'app, sur les quatre lectures ; aucun nouveau champ", async () => {
    const fake = seeded({ posts: [post(POST, ALICE)] });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, { text: "Premier" });
    const id = first.conversationId;
    const reply = await send(target, BOB, ALICE, { text: "Réponse", replyToId: first.message.id });
    const withText = await send(target, ALICE, BOB, { text: "Regarde ça", postId: POST });
    const deleted = await send(target, ALICE, BOB, { text: "À effacer" });
    expect((await like(target, BOB, first.message.id)).statusCode).toBe(200);
    expect((await remove(target, ALICE, deleted.message.id)).statusCode).toBe(204);
    // POST /api/messages, sans « v=2 » : la réponse garde l'ancien vocabulaire.
    const posted = await as(target, ALICE).post("/api/messages", { recipientId: BOB, postId: POST });
    expect(posted.statusCode).toBe(201);
    const postOnly: ChatMessage = posted.json().message;
    expect(postOnly).toEqual({ id: postOnly.id, mine: true, text: "Publication partagée", wish: null, createdAt: postOnly.createdAt });
    expect((await as(target, ALICE, true).post("/api/messages", { recipientId: BOB, postId: POST })).json().message.text).toBe("Shared post");
    fake.tables.set("messages", fake.table("messages").slice(0, 5));
    Object.assign(fake.table("conversations")[0]!, { last_message_id: postOnly.id });

    const old = (message: ChatMessage, mine: boolean, text: string) => ({ id: message.id, mine, text, wish: null, createdAt: message.createdAt });
    for (const [english, removedText, sharedText] of [
      [false, "Message supprimé", "Publication partagée"],
      [true, "Message deleted", "Shared post"],
    ] as const) {
      expect([removedText, sharedText]).toEqual([FALLBACK_TEXT.deleted[english ? "en" : "fr"], FALLBACK_TEXT.sharedPost[english ? "en" : "fr"]]);
      const expected = [old(first.message, false, "Premier"), old(reply.message, true, "Réponse"), old(withText.message, false, "Regarde ça"), old(deleted.message, false, removedText), old(postOnly, false, sharedText)];
      for (const url of [`/api/conversations/${id}`, `/api/conversations/with/${ALICE}`, `/api/conversations/${id}?v=1`, `/api/conversations/${id}?changedSince=2020-01-01T00:00:00.000Z`]) {
        const page = await as(target, BOB, english).get(url);
        expect(page.statusCode, url).toBe(200);
        const read: ConversationThread = page.json();
        expect(read.messages, url).toEqual(expected);
        expect(read, url).not.toHaveProperty("changed");
        expect(read, url).not.toHaveProperty("syncedAt");
        for (const field of ['"liked"', '"replyTo"', '"post"', '"deleted"', "daim", "À effacer"]) expect(page.body, `${url} ${field}`).not.toContain(field);
      }
      // GET /api/conversations : l'aperçu.
      const listed = await as(target, BOB, english).get("/api/conversations");
      expect((listed.json() as ConversationsPage).conversations[0]!.lastMessage).toEqual({ text: sharedText, hasWish: false, mine: false, hidden: false, createdAt: postOnly.createdAt });
      Object.assign(fake.table("conversations")[0]!, { last_message_id: deleted.message.id });
      expect(((await as(target, BOB, english).get("/api/conversations")).json() as ConversationsPage).conversations[0]!.lastMessage).toEqual({
        text: removedText,
        hasWish: false,
        mine: false,
        hidden: false,
        createdAt: deleted.message.createdAt,
      });
      Object.assign(fake.table("conversations")[0]!, { last_message_id: postOnly.id });
    }
    // La nouvelle app, elle, reçoit tout sur la même conversation.
    const rich = await thread(target, BOB, id);
    expect(byId(rich.messages, reply.message.id).replyTo).toMatchObject({ kind: "text", excerpt: "Premier" });
    expect(byId(rich.messages, withText.message.id).post).toMatchObject({ available: true });
    expect(byId(rich.messages, deleted.message.id)).toMatchObject({ text: null, deleted: true });
    expect(byId(rich.messages, first.message.id).liked).toEqual({ mine: true, theirs: false });
  });
});

describe("règle 7 : « Vu » jamais sous un message supprimé", () => {
  /** Ouvrir la conversation dans l'app : elle est marquée comme lue. */
  const open = async (target: FastifyInstance, user: string, id: string) => expect((await as(target, user).post(`/api/conversations/${id}/read`)).statusCode).toBe(204);

  it("le serveur renvoie la date d'un message encore montré : après la suppression du dernier, celle du précédent ; sans autre message, rien", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, { text: "Premier" });
    later();
    const second = await send(target, ALICE, BOB, { text: "Second" });
    const id = first.conversationId;
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: second.message.createdAt });
    expect((await remove(target, ALICE, second.message.id)).statusCode).toBe(204);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Un message supprimé AVANT d'être lu : « Envoyé » porte sur le précédent, déjà vu.
    later();
    const third = await send(target, ALICE, BOB, { text: "Troisième" });
    expect(third.readReceipts).toEqual({ seenAt: null });
    expect((await remove(target, ALICE, third.message.id)).statusCode).toBe(204);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Plus aucun message d'Alice encore montré : aucune date.
    expect((await remove(target, ALICE, first.message.id)).statusCode).toBe(204);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    // Le contenu conservé pour la modération ne compte pas davantage.
    later();
    const kept = await send(target, ALICE, BOB, { text: INSULT });
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: kept.message.createdAt });
    fake.table("reports").push({ id: UNKNOWN, reporter_id: CHLOE, target_type: "message", target_id: kept.message.id, reason: "harassment", handled_at: null });
    expect((await remove(target, ALICE, kept.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, kept.message.id).body).toBe(INSULT);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
  });

  it("0044 sans 0043 : les actions fonctionnent, aucune confirmation de lecture ; 0043 sans 0044 : « Vu » fonctionne, sans jamais nommer deleted_at", async () => {
    // 0044 présente, 0043 absente.
    const without0043 = seeded({}, WITHOUT_0043);
    for (const row of without0043.table("profiles")) {
      delete row.read_receipts;
      delete row.read_receipts_since;
    }
    const first = await messagesApp(without0043.db);
    const sent = await send(first, ALICE, BOB, { text: "Bonjour" });
    await open(first, BOB, sent.conversationId);
    expect(sent.readReceipts).toBeNull();
    expect((await thread(first, ALICE, sent.conversationId)).readReceipts).toBeNull();
    expect((await like(first, BOB, sent.message.id)).statusCode).toBe(200);
    expect((await send(first, BOB, ALICE, { text: "Réponse", replyToId: sent.message.id })).message.replyTo).toMatchObject({ kind: "text" });
    expect((await remove(first, ALICE, sent.message.id)).statusCode).toBe(204);
    expect((await as(first, ALICE).get("/api/messages/status")).json().actions).toBe(true);
    await first.close();

    // 0043 présente, 0044 absente : nommer deleted_at ferait échouer la lecture (et « Vu » disparaîtrait).
    resetMessagesProbe();
    resetMessageActionsProbe();
    resetReadReceiptsProbe();
    const without0044 = seeded({}, WITHOUT_0044);
    const second = await messagesApp(without0044.db);
    const message = await send(second, ALICE, BOB, { text: "Bonjour" });
    expect(message.readReceipts).toEqual({ seenAt: null });
    later();
    await open(second, BOB, message.conversationId);
    expect((await thread(second, ALICE, message.conversationId)).readReceipts).toEqual({ seenAt: message.message.createdAt });
    expect((await as(second, ALICE).get("/api/messages/status")).json().actions).toBe(false);
  });
});

describe("règle 9 : export des données", () => {
  it("l'export de l'AUTRE membre ne contient jamais le contenu conservé d'un message supprimé ; celui de son auteur le garde", async () => {
    const fake = seeded({ posts: [post(POST, BOB)] });
    const target = await messagesApp(fake.db);
    const insult = await send(target, BOB, ALICE, { text: INSULT, postId: POST });
    const kept = await send(target, BOB, ALICE, { text: "Message ordinaire" });
    expect((await like(target, ALICE, kept.message.id)).statusCode).toBe(200);
    expect((await report(target, ALICE, "message", insult.message.id)).statusCode).toBe(204);
    expect((await remove(target, BOB, insult.message.id)).statusCode).toBe(204);
    expect(messageRow(fake, insult.message.id)).toMatchObject({ body: INSULT, post_id: POST });

    const forAlice = (await collectExport(target, ALICE, "alice@example.com")).data;
    const forBob = (await collectExport(target, BOB, "bob@example.com")).data;
    const row = (rows: Record<string, unknown>[], id: string) => rows.find((entry) => entry.id === id)!;
    // Alice (qui l'a reçu, et signalé) : la ligne, sa date de suppression, aucun contenu.
    expect(row(forAlice.messages, insult.message.id)).toMatchObject({ sender_id: BOB, body: null, post_id: null, shared_post: false, reply_to_id: null, deleted_at: messageRow(fake, insult.message.id).deleted_at });
    expect(JSON.stringify(forAlice)).not.toContain("blessant");
    expect(row(forAlice.messages, kept.message.id).body).toBe("Message ordinaire");
    // Bob (qui l'a écrit) : son propre contenu, conservé.
    expect(row(forBob.messages, insult.message.id)).toMatchObject({ sender_id: BOB, body: INSULT, post_id: POST, shared_post: true });
    // « J'aime » : seulement les siens, avec l'autre membre de la conversation.
    expect(forAlice.messageReactions).toEqual([{ message_id: kept.message.id, conversation_id: kept.conversationId, other_user_id: BOB, created_at: expect.any(String) }]);
    expect(forBob.messageReactions).toEqual([]);
  });

  it("une publication reçue n'est jamais désignée dans l'export ; sans la migration 0044, les messages sont exportés comme avant et la section des « j'aime » est vide", async () => {
    const mine = { id: "1", sender_id: ALICE, body: "à moi", post_id: POST, shared_post: true, deleted_at: "2032-03-01T10:00:00+00:00" };
    const received = { id: "2", sender_id: BOB, body: "Regarde", post_id: POST, shared_post: true, deleted_at: null };
    const receivedDeleted = { id: "3", sender_id: BOB, body: INSULT, wish_title: "Envie", wish_image_url: "https://x.example/a.jpg", post_id: POST, shared_post: true, reply_to_id: "1", deleted_at: "2032-03-01T10:00:00+00:00" };
    const old = { id: "4", sender_id: BOB, body: "Base sans 0044" };
    expect(messagesForExport([mine, received, receivedDeleted, old], ALICE)).toEqual([
      mine,
      { ...received, post_id: null },
      { id: "3", sender_id: BOB, body: null, wish_title: null, wish_image_url: null, post_id: null, shared_post: false, reply_to_id: null, deleted_at: "2032-03-01T10:00:00+00:00" },
      old,
    ]);

    const fake = seeded({}, WITHOUT_0044);
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, { text: "Bonjour" });
    const exported = await collectExport(target, BOB, "bob@example.com");
    expect(exported.failures).toEqual([]);
    expect(exported.data.messages.map((entry) => entry.id)).toEqual([sent.message.id]);
    expect(exported.data.messageReactions).toEqual([]);
  });
});
