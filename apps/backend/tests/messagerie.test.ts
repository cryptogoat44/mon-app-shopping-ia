import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_MAX_LENGTH, type ConversationThread, type ConversationsPage, type SendMessageResponse } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import conversationsRoutes from "../src/routes/conversations.js";
import reportsRoutes from "../src/routes/reports.js";
import accountRoutes from "../src/routes/account.js";
import meRoutes from "../src/routes/me.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { acceptsInvitation, cooldownOver, matchCard, messagesReady, planSend, resetMessagesProbe, sendModeFor, viewerState } from "../src/lib/messaging.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Messages privés (lot messages, migration 0032), SANS base ni réseau : les
// routes sur une fausse base en mémoire (tests/fakeSupabase.ts). Le même
// parcours sur la vraie base de développement : messagerieBase.test.ts (à
// lancer sur le Mac, une fois 0032 appliquée sur spotto-dev-2).

// Images des marchands : jamais téléchargées pour de vrai.
const downloads = vi.hoisted(() => ({ images: new Map<string, Buffer>(), calls: [] as string[] }));
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return {
    ...original,
    downloadPublicImage: async (url: string) => {
      downloads.calls.push(url);
      const image = downloads.images.get(url);
      if (!image) throw new original.PublicImageError("Image refusée", 403);
      return image;
    },
  };
});

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const DAN = "d0000000-0000-4000-8000-000000000004";
const WISH = "e0000000-0000-4000-8000-000000000005";
const MATCH = "f0000000-0000-4000-8000-000000000006";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const DAY = 24 * 60 * 60 * 1000;

const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:vignette";
const HD = "https://boutique.example/images/sac-hd.jpg";

function profile(id: string, username: string, messagesFrom = "everyone"): Row {
  return { id, username, display_name: username[0]!.toUpperCase() + username.slice(1), avatar_url: null, messages_from: messagesFrom, piece_sends_from: "following" };
}

interface Seed {
  profiles?: Row[];
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(...(seed.profiles ?? [profile(ALICE, "alice"), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(DAN, "dan")]));
  for (const [follower, followee] of seed.follows ?? []) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  return fake;
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];

let app: FastifyInstance | null = null;

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête,
 * et le journal du serveur avec ses vraies règles (lib/logPrivacy.ts). */
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
  await app.register(accountRoutes);
  await app.register(meRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    del: (url: string, payload: object) => target.inject({ method: "DELETE", url, headers, payload }),
  };
}

async function send(target: FastifyInstance, from: string, to: string, body: { text?: string; wishId?: string; collectionItemId?: string; matchId?: string }) {
  return as(target, from).post("/api/messages", { recipientId: to, ...body });
}

async function list(target: FastifyInstance, user: string): Promise<ConversationsPage> {
  const res = await as(target, user).get("/api/conversations");
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function unread(target: FastifyInstance, user: string): Promise<number> {
  const res = await as(target, user).get("/api/messages/status");
  expect(res.json().enabled).toBe(true);
  return res.json().unreadCount;
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg().toBuffer();
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetMessagesProbe();
  downloads.images.clear();
  downloads.calls.length = 0;
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

describe("règles d'envoi (sans réseau)", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const relation = (mutual: boolean, recipientAccepts: boolean) => ({ mutual, recipientAccepts });

  it("deux amis s'écrivent directement ; sinon une invitation, selon le réglage de la personne", () => {
    expect(planSend(null, null, relation(true, false), now)).toMatchObject({ ok: true, create: true, invitation: false, mine: "none", theirs: "none" });
    expect(planSend(null, null, relation(false, true), now)).toMatchObject({ ok: true, create: true, invitation: true, mine: "sent", theirs: "received" });
    expect(planSend(null, null, relation(false, false), now)).toEqual({ ok: false, refusal: "not_accepting" });
  });

  it("« Qui peut m'écrire » : tout le monde, les comptes que je suis, ou seulement mes amis", () => {
    expect(acceptsInvitation("everyone", false)).toBe(true);
    expect(acceptsInvitation("following", true)).toBe(true);
    expect(acceptsInvitation("following", false)).toBe(false);
    expect(acceptsInvitation("nobody", true)).toBe(false);
  });

  it("une seule invitation : rien d'autre ne part avant la réponse, et un refus compte 30 jours", () => {
    const sent = { invitation: "sent" as const };
    expect(planSend(sent, { invitation: "received", invitation_at: null }, relation(false, true), now)).toEqual({ ok: false, refusal: "pending" });
    const declined = (daysAgo: number) => ({ invitation: "declined" as const, invitation_at: new Date(now - daysAgo * DAY).toISOString() });
    expect(planSend(sent, declined(29), relation(false, true), now)).toEqual({ ok: false, refusal: "pending" });
    expect(planSend(sent, declined(31), relation(false, true), now)).toMatchObject({ ok: true, invitation: true, mine: "sent", theirs: "received" });
    expect(planSend(sent, declined(31), relation(false, false), now)).toEqual({ ok: false, refusal: "not_accepting" });
    expect(cooldownOver(null, now)).toBe(false);
    expect(cooldownOver("illisible", now)).toBe(false);
  });

  it("devenus amis entre-temps, ou réponse de la personne invitée : la conversation s'ouvre", () => {
    expect(planSend({ invitation: "sent" }, { invitation: "received", invitation_at: null }, relation(true, false), now)).toMatchObject({ ok: true, mine: "none", theirs: "none" });
    expect(planSend({ invitation: "received" }, { invitation: "sent", invitation_at: null }, relation(false, false), now)).toMatchObject({ ok: true, invitation: false, mine: "none", theirs: "none" });
    expect(planSend({ invitation: "declined" }, { invitation: "sent", invitation_at: null }, relation(false, false), now)).toMatchObject({ ok: true, clearMine: true, mine: "none" });
  });

  it("ce que voit la personne qui lit", () => {
    expect(viewerState(null)).toBe("new");
    expect(viewerState({ invitation: "declined" })).toBe("new");
    expect(viewerState({ invitation: "received" })).toBe("invitation_received");
    expect(sendModeFor({ invitation: "received" }, { invitation: "sent", invitation_at: null }, relation(false, false), now)).toBe("answer");
    expect(sendModeFor({ invitation: "sent" }, { invitation: "received", invitation_at: null }, relation(false, true), now)).toBe("waiting");
    expect(sendModeFor(null, null, relation(false, false), now)).toBe("not_allowed");
    expect(sendModeFor(null, null, relation(false, true), now)).toBe("invitation");
  });
});

describe("sans la migration 0032", () => {
  const missing = { missing: ["conversations", "conversation_participants", "messages"] };

  it("la messagerie se dit indisponible ; chaque route répond « indisponible », rien n'est écrit", async () => {
    const fake = seeded({}, missing);
    const target = await messagesApp(fake.db);
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toEqual({ enabled: false, unreadCount: 0, push: false });
    for (const res of [
      await as(target, ALICE).get("/api/conversations"),
      await as(target, ALICE).get(`/api/conversations/with/${BOB}`),
      await as(target, ALICE).get(`/api/conversations/${UNKNOWN}`),
      await send(target, ALICE, BOB, { text: "Bonjour" }),
      await as(target, ALICE).put("/api/me/messages-from", { messagesFrom: "nobody" }),
      await as(target, ALICE).post("/api/reports", { targetType: "message", targetId: UNKNOWN, reason: "spam" }),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("messages_unavailable");
    }
    expect(fake.table("reports")).toHaveLength(0);
  });

  it("sonde du schéma : absente, un seul avertissement puis 5 minutes sans relire la base ; présente, mémorisée", async () => {
    let calls = 0;
    const warnings: unknown[] = [];
    const db = (error: object | null) => ({
      from: () => ({
        select: () => ({
          limit: async () => {
            calls += 1;
            return { error };
          },
        }),
      }),
    });
    const log = { warn: (fields: unknown) => void warnings.push(fields) };
    const missing = { supabaseAdmin: db({ code: "42P01" }), log } as unknown as FastifyInstance;
    let now = 0;
    const clock = () => now;
    expect(await messagesReady(missing, clock)).toBe(false);
    const perProbe = calls;
    expect(warnings).toEqual([{ code: "42P01" }]);
    now = 4 * 60_000;
    expect(await messagesReady(missing, clock)).toBe(false);
    expect(calls).toBe(perProbe);
    now = 6 * 60_000;
    expect(await messagesReady(missing, clock)).toBe(false);
    expect(calls).toBe(perProbe * 2);
    resetMessagesProbe();
    expect(await messagesReady({ supabaseAdmin: db(null), log } as unknown as FastifyInstance, clock)).toBe(true);
    // Une fois vue, la migration est mémorisée.
    expect(await messagesReady(missing, clock)).toBe(true);
  });

  it("l'export et la suppression du compte fonctionnent quand même (aucun message)", async () => {
    const fake = seeded({}, missing);
    const target = await messagesApp(fake.db);
    const exported = await as(target, ALICE).get("/api/me/export");
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ conversations: [], messages: [] });
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });
});

describe("amis et invitations", () => {
  it("deux amis : le premier message ouvre la conversation, non lue pour l'autre jusqu'à l'ouverture", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { text: "  Tu as vu ce sac ?  " });
    expect(res.statusCode).toBe(201);
    const sent: SendMessageResponse = res.json();
    expect(sent).toMatchObject({ state: "open", sendMode: "direct", message: { mine: true, text: "Tu as vu ce sac ?", wish: null } });

    expect(await unread(target, BOB)).toBe(1);
    expect(await unread(target, ALICE)).toBe(0);
    const page = await list(target, BOB);
    expect(page.invitations).toEqual([]);
    expect(page.conversations).toHaveLength(1);
    expect(page.conversations[0]).toMatchObject({ id: sent.conversationId, state: "open", unread: true, other: { id: ALICE, username: "alice" } });
    expect(page.conversations[0]!.lastMessage).toMatchObject({ text: "Tu as vu ce sac ?", mine: false, hidden: false });

    const thread: ConversationThread = (await as(target, BOB).get(`/api/conversations/${sent.conversationId}`)).json();
    expect(thread).toMatchObject({ state: "open", sendMode: "direct", hasOlder: false });
    expect(thread.messages.map((m) => [m.text, m.mine])).toEqual([["Tu as vu ce sac ?", false]]);
    expect((await as(target, BOB).post(`/api/conversations/${sent.conversationId}/read`)).statusCode).toBe(204);
    expect(await unread(target, BOB)).toBe(0);

    // Une seule conversation par paire, dans les deux sens.
    const reply = await send(target, BOB, ALICE, { text: "Oui, superbe" });
    expect(reply.json().conversationId).toBe(sent.conversationId);
    expect(fake.table("conversations")).toHaveLength(1);
  });

  it("un non-ami : UNE invitation, rangée dans « Invitations » ; rien d'autre ne part avant l'acceptation", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, { text: "Bonjour, j'aime votre style" });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ state: "invitation_sent", sendMode: "waiting" });
    const second = await send(target, ALICE, BOB, { text: "Vous êtes là ?" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("invitation_pending");
    expect(fake.table("messages")).toHaveLength(1);

    const bobPage = await list(target, BOB);
    expect(bobPage.conversations).toEqual([]);
    expect(bobPage.invitations).toHaveLength(1);
    expect(bobPage.invitations[0]).toMatchObject({ state: "invitation_received", unread: true });
    expect(await unread(target, BOB)).toBe(1);
    expect((await list(target, ALICE)).conversations[0]).toMatchObject({ state: "invitation_sent", unread: false });

    const id = first.json().conversationId as string;
    expect((await as(target, BOB).get(`/api/conversations/${id}`)).json()).toMatchObject({ state: "invitation_received", sendMode: "answer" });
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).json()).toMatchObject({ state: "invitation_sent", sendMode: "waiting" });

    // Seule la personne invitée accepte ; ensuite, la conversation est ouverte pour les deux.
    expect((await as(target, ALICE).post(`/api/conversations/${id}/accept`)).statusCode).toBe(409);
    expect((await as(target, BOB).post(`/api/conversations/${id}/accept`)).statusCode).toBe(204);
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).json()).toMatchObject({ state: "open", sendMode: "direct" });
    expect((await list(target, BOB)).conversations[0]).toMatchObject({ state: "open", unread: false });
    expect((await send(target, ALICE, BOB, { text: "Merci !" })).statusCode).toBe(201);
  });

  it("répondre à une invitation vaut acceptation", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, { text: "Bonjour" })).json().conversationId;
    const reply = await send(target, BOB, ALICE, { text: "Bonjour à vous" });
    expect(reply.json()).toMatchObject({ conversationId: id, state: "open" });
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).json().sendMode).toBe("direct");
  });

  it("réglage « Qui peut m'écrire » : les comptes que je suis, seulement mes amis ; les amis passent toujours", async () => {
    const fake = seeded({
      profiles: [profile(ALICE, "alice"), profile(BOB, "bob", "following"), profile(CHLOE, "chloe", "nobody"), profile(DAN, "dan")],
      follows: [[BOB, DAN], ...friends(CHLOE, DAN)],
    });
    const target = await messagesApp(fake.db);
    const refused = await send(target, ALICE, BOB, { text: "Bonjour" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("recipient_not_accepting");
    expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()).toMatchObject({ id: null, state: "new", sendMode: "not_allowed" });
    // Bob suit Dan (sans réciproque) : Dan peut l'inviter.
    expect((await as(target, DAN).get(`/api/conversations/with/${BOB}`)).json()).toMatchObject({ id: null, sendMode: "invitation" });
    expect((await send(target, DAN, BOB, { text: "Bonjour Bob" })).json().state).toBe("invitation_sent");
    // Chloé : seulement ses amis. Dan est son ami ; Alice non.
    expect((await send(target, ALICE, CHLOE, { text: "Bonjour" })).statusCode).toBe(403);
    expect((await send(target, DAN, CHLOE, { text: "Salut Chloé" })).json().state).toBe("open");
    expect(fake.table("reports")).toHaveLength(0);
  });

  it("le réglage s'enregistre (même pour un compte suspendu), et se relit dans le profil", async () => {
    const fake = seeded({ suspended: [ALICE] });
    const target = await messagesApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/messages-from", { messagesFrom: "nobody" })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.messages_from).toBe("nobody");
    expect((await as(target, ALICE).put("/api/me/messages-from", { messagesFrom: "personne" })).statusCode).toBe(400);
  });

  it("refus : l'invitation disparaît pour la personne invitée ; celle qui invite voit toujours « en attente » ; nouvelle invitation après 30 jours seulement", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, { text: "Première invitation" })).json().conversationId as string;
    expect((await as(target, BOB).post(`/api/conversations/${id}/decline`)).statusCode).toBe(204);

    expect(await list(target, BOB)).toMatchObject({ conversations: [], invitations: [] });
    expect(await unread(target, BOB)).toBe(0);
    const gone = await as(target, BOB).get(`/api/conversations/${id}`);
    expect(gone.statusCode).toBe(404);
    expect((await as(target, BOB).post(`/api/conversations/${id}/accept`)).statusCode).toBe(404);
    // Rien ne trahit le refus : même réponse qu'une invitation en attente.
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).json()).toMatchObject({ state: "invitation_sent", sendMode: "waiting" });
    const blocked = await send(target, ALICE, BOB, { text: "Encore moi" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("invitation_pending");

    // 31 jours plus tard (date du refus reculée dans la fausse base).
    const bobSide = fake.table("conversation_participants").find((row) => row.user_id === BOB)!;
    bobSide.invitation_at = new Date(Date.now() - 31 * DAY).toISOString();
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).json().sendMode).toBe("invitation");
    expect((await send(target, ALICE, BOB, { text: "Deuxième invitation" })).statusCode).toBe(201);
    const page = await list(target, BOB);
    expect(page.invitations).toHaveLength(1);
    const thread: ConversationThread = (await as(target, BOB).get(`/api/conversations/${id}`)).json();
    // L'invitation refusée reste cachée pour Bob.
    expect(thread.messages.map((m) => m.text)).toEqual(["Deuxième invitation"]);
    expect((await send(target, ALICE, BOB, { text: "Troisième" })).statusCode).toBe(409);
  });

  it("refuser n'a de sens que pour une invitation reçue", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, { text: "Salut" })).json().conversationId;
    const res = await as(target, BOB).post(`/api/conversations/${id}/decline`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("not_an_invitation");
  });
});

describe("sécurité", () => {
  it("blocage dans un sens ou dans l'autre : conversation cachée, envoi refusé, même réponse « introuvable »", async () => {
    for (const block of [[ALICE, BOB] as [string, string], [BOB, ALICE] as [string, string]]) {
      const fake = seeded({ follows: friends(ALICE, BOB) });
      const target = await messagesApp(fake.db);
      const id = (await send(target, ALICE, BOB, { text: "Avant le blocage" })).json().conversationId;
      fake.table("blocks").push({ blocker_id: block[0], blocked_id: block[1], created_at: "2026-11-01T00:00:00+00:00" });
      for (const user of [ALICE, BOB]) {
        expect((await list(target, user)).conversations).toEqual([]);
        expect(await unread(target, user)).toBe(0);
        const res = await as(target, user).get(`/api/conversations/${id}`);
        expect(res.statusCode).toBe(404);
        expect(res.json().error).toBe("conversation_not_found");
      }
      const refused = await send(target, ALICE, BOB, { text: "Après le blocage" });
      expect(refused.statusCode).toBe(404);
      expect(refused.json().error).toBe("recipient_not_found");
      expect((await as(target, BOB).get(`/api/conversations/with/${ALICE}`)).statusCode).toBe(404);
      expect(fake.table("messages")).toHaveLength(1);
      await app?.close();
      app = null;
    }
  });

  it("un compte suspendu ne peut pas écrire ; il lit toujours ses conversations", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, BOB, ALICE, { text: "Coucou" })).json().conversationId;
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    const res = await send(target, ALICE, BOB, { text: "Réponse" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("account_suspended");
    expect((await as(target, ALICE).get(`/api/conversations/${id}`)).statusCode).toBe(200);
    expect(fake.table("messages")).toHaveLength(1);
  });

  it("mots interdits, longueur et message vide : 400, rien n'est écrit", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const banned = await send(target, ALICE, BOB, { text: "Espèce de connard" });
    expect(banned.statusCode).toBe(400);
    expect(banned.json().error).toBe("content_not_allowed");
    const tooLong = await send(target, ALICE, BOB, { text: "a".repeat(MESSAGE_MAX_LENGTH + 1) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().message).toBe(`Le message est trop long (${MESSAGE_MAX_LENGTH} caractères maximum).`);
    for (const body of [{ text: "   " }, {}]) {
      const empty = await send(target, ALICE, BOB, body);
      expect(empty.statusCode).toBe(400);
      expect(empty.json().message).toBe("Le message est vide.");
    }
    expect((await send(target, ALICE, ALICE, { text: "Moi" })).statusCode).toBe(400);
    expect((await send(target, ALICE, UNKNOWN, { text: "Personne" })).statusCode).toBe(404);
    expect(fake.table("messages")).toHaveLength(0);
    expect(fake.table("conversations")).toHaveLength(0);
    // 1 000 caractères, espaces autour retirés : accepté.
    expect((await send(target, ALICE, BOB, { text: ` ${"a".repeat(MESSAGE_MAX_LENGTH)} ` })).statusCode).toBe(201);
  });

  it("404 uniforme pour une conversation dont on ne fait pas partie (ou inexistante)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, { text: "Entre nous" })).json().conversationId;
    const bodies = new Set<string>();
    for (const url of [`/api/conversations/${id}`, `/api/conversations/${UNKNOWN}`]) {
      const res = await as(target, CHLOE).get(url);
      expect(res.statusCode).toBe(404);
      bodies.add(res.body);
    }
    for (const action of ["read", "accept", "decline"]) {
      for (const conversation of [id, UNKNOWN]) {
        const res = await as(target, CHLOE).post(`/api/conversations/${conversation}/${action}`);
        expect(res.statusCode).toBe(404);
        bodies.add(res.body);
      }
    }
    expect([...bodies]).toEqual([JSON.stringify({ error: "conversation_not_found", message: "Conversation introuvable." })]);
    expect((await as(target, CHLOE).get("/api/conversations/pas-un-id")).statusCode).toBe(400);
  });

  it("limites de débit : messages par heure, invitations par heure", async () => {
    process.env.NODE_ENV = "development";
    const recipients = Array.from({ length: RATE_LIMITS.messageInvite.max + 1 }, (_, i) => profile(`10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `membre${i}`));
    const sender = "20000000-0000-4000-8000-000000000001";
    const fake = seeded({ profiles: [profile(sender, "rapide"), ...recipients] });
    const target = await messagesApp(fake.db);
    for (const recipient of recipients.slice(0, -1)) expect((await send(target, sender, String(recipient.id), { text: "Bonjour" })).statusCode).toBe(201);
    const limited = await send(target, sender, String(recipients.at(-1)!.id), { text: "Bonjour" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "invitation_limit", message: RATE_LIMITS.messageInvite.message });

    // Messages : entre amis, au-delà de la limite par heure.
    const chatty = "20000000-0000-4000-8000-000000000002";
    const friend = "20000000-0000-4000-8000-000000000003";
    fake.table("profiles").push(profile(chatty, "bavard"), profile(friend, "ami"));
    fake.table("follows").push({ follower_id: chatty, followee_id: friend }, { follower_id: friend, followee_id: chatty });
    for (let i = 0; i < RATE_LIMITS.messageSend.max; i += 1) await send(target, chatty, friend, { text: `Message ${i}` });
    const tooMany = await send(target, chatty, friend, { text: "Un de trop" });
    expect(tooMany.statusCode).toBe(429);
    expect(tooMany.json().error).toBe("message_send_limit");
  });

  it("signaler un message : seulement un message reçu, dans sa conversation ; il disparaît ensuite pour qui l'a signalé", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const sent: SendMessageResponse = (await send(target, ALICE, BOB, { text: "Message gênant" })).json();
    const report = (user: string) => as(target, user).post("/api/reports", { targetType: "message", targetId: sent.message.id, reason: "harassment" });
    expect((await report(ALICE)).statusCode).toBe(404);
    expect((await report(CHLOE)).statusCode).toBe(404);
    expect((await as(target, BOB).post("/api/reports", { targetType: "message", targetId: UNKNOWN, reason: "spam" })).statusCode).toBe(404);
    expect(fake.table("reports")).toHaveLength(0);
    expect((await report(BOB)).statusCode).toBe(204);
    expect(fake.table("reports")).toEqual([expect.objectContaining({ reporter_id: BOB, target_type: "message", target_id: sent.message.id })]);
    expect((await as(target, BOB).get(`/api/conversations/${sent.conversationId}`)).json().messages).toEqual([]);
    expect((await list(target, BOB)).conversations[0]!.lastMessage).toMatchObject({ text: null, hidden: true });
    // L'autre membre le voit toujours, tant que la modération ne l'a pas masqué.
    expect((await as(target, ALICE).get(`/api/conversations/${sent.conversationId}`)).json().messages).toHaveLength(1);
    fake.table("messages")[0]!.hidden_at = "2026-11-08T12:00:00+00:00";
    expect((await as(target, ALICE).get(`/api/conversations/${sent.conversationId}`)).json().messages).toEqual([]);
  });

  it("le journal du serveur ne contient jamais le texte d'un message, même quand l'envoi échoue", async () => {
    const secret = "Mon code secret est 4242 violette";
    const lines: string[] = [];
    let failNext = false;
    const fake = seeded(
      { follows: friends(ALICE, BOB) },
      {
        failWrite: (table, action, values) =>
          failNext && table === "messages" && action === "insert"
            ? { code: "23514", message: `new row violates check constraint, Failing row contains (${JSON.stringify(values)})` }
            : null,
      }
    );
    const target = await messagesApp(fake.db, lines);
    expect((await send(target, ALICE, BOB, { text: secret })).statusCode).toBe(201);
    expect((await as(target, BOB).get(`/api/conversations?cursor=${encodeURIComponent("2030-01-01T00:00:00Z")}`)).statusCode).toBe(200);
    failNext = true;
    expect((await send(target, ALICE, BOB, { text: secret })).statusCode).toBe(500);
    expect((await send(target, ALICE, BOB, { text: "Espèce de connard" })).statusCode).toBe(400);
    const log = lines.join("\n");
    expect(log).toContain("Échec de l'envoi d'un message");
    expect(log).toContain("23514");
    expect(log).not.toContain("4242");
    expect(log).not.toContain("violette");
    expect(log).not.toContain("connard");
  });
});

describe("relecture d'une conversation (sans temps réel)", () => {
  it("`after` ne renvoie que les nouveaux messages ; une date mal formée est refusée", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first: SendMessageResponse = (await send(target, ALICE, BOB, { text: "Un" })).json();
    await send(target, BOB, ALICE, { text: "Deux" });
    await send(target, ALICE, BOB, { text: "Trois" });
    const url = `/api/conversations/${first.conversationId}?after=${encodeURIComponent(first.message.createdAt)}`;
    const thread: ConversationThread = (await as(target, BOB).get(url)).json();
    expect(thread.messages.map((m) => [m.text, m.mine])).toEqual([
      ["Deux", true],
      ["Trois", false],
    ]);
    for (const bad of ["hier", "2026-11-08T10:00:00Z)", "2026-11-08"]) {
      expect((await as(target, BOB).get(`/api/conversations/${first.conversationId}?after=${encodeURIComponent(bad)}`)).statusCode).toBe(400);
    }
  });
});

describe("envie jointe", () => {
  function withWish(fake: ReturnType<typeof seeded>, overrides: Row = {}) {
    fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: HD });
    fake.table("affiliate_links").push({ product_match_id: MATCH, affiliate_url: "https://partenaire.example/sac?aff=spotto" });
    fake.table("wishlist_items").push({
      id: WISH,
      user_id: ALICE,
      title: "Sac cabas en cuir",
      image_url: THUMB,
      price_min: "129.00",
      currency: "EUR",
      merchant_name: "Boutique",
      merchant_url: "https://boutique.example/sac",
      product_match_id: MATCH,
      created_at: "2026-11-01T00:00:00+00:00",
      ...overrides,
    });
  }

  it("copie de l'image dans notre stockage (la plus grande des sources), jamais l'adresse du marchand ; lien affilié signalé", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withWish(fake);
    downloads.images.set(THUMB, await jpeg(180, 240));
    downloads.images.set(HD, await jpeg(600, 800));
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { wishId: WISH, text: "Regarde" });
    expect(res.statusCode).toBe(201);
    const sent: SendMessageResponse = res.json();
    const card = sent.message.wish!;
    expect(card).toMatchObject({ title: "Sac cabas en cuir", priceMin: 129, currency: "EUR", merchantName: "Boutique", isAffiliate: true });
    expect(card.merchantUrl).toBe("https://partenaire.example/sac?aff=spotto");
    for (const url of [card.imageUrl, card.imageThumbUrl]) expect(url.startsWith(`${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${ALICE}/`)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("gstatic");
    expect(JSON.stringify(sent)).not.toContain("sac-hd.jpg");
    expect(fake.uploads.filter((path) => path.startsWith(`post-media/${ALICE}/`))).toHaveLength(2);
    expect(downloads.calls.sort()).toEqual([HD, THUMB].sort());
    // Bob voit la même carte.
    const thread: ConversationThread = (await as(target, BOB).get(`/api/conversations/${sent.conversationId}`)).json();
    expect(thread.messages[0]!.wish).toEqual(card);
    expect((await list(target, BOB)).conversations[0]!.lastMessage).toMatchObject({ hasWish: true, text: "Regarde" });
  });

  it("une envie seule (sans texte) part ; un lien marchand qui n'est pas un lien web n'est jamais recopié", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withWish(fake, { merchant_url: "javascript:alert(1)", product_match_id: null });
    downloads.images.set(THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { wishId: WISH });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({ text: null, wish: { merchantUrl: null, isAffiliate: false } });
    expect(fake.table("messages")[0]!.wish_merchant_url).toBeNull();
  });

  it("l'envie d'un autre : introuvable ; image irrécupérable : 422, rien n'est écrit ni gardé", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withWish(fake);
    const target = await messagesApp(fake.db);
    expect((await send(target, BOB, ALICE, { wishId: WISH })).statusCode).toBe(404);
    const unavailable = await send(target, ALICE, BOB, { wishId: WISH, text: "Regarde" });
    expect(unavailable.statusCode).toBe(422);
    expect(unavailable.json().error).toBe("wish_image_unavailable");
    expect(fake.table("messages")).toHaveLength(0);
    expect(fake.uploads).toEqual([]);
  });

  it("l'envoi échoue après la copie : la copie est effacée", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) }, { failWrite: (table, action) => (table === "messages" && action === "insert" ? { code: "XX000", message: "panne" } : null) });
    withWish(fake);
    downloads.images.set(THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    expect((await send(target, ALICE, BOB, { wishId: WISH })).statusCode).toBe(500);
    expect(fake.removed.sort()).toEqual(fake.uploads.sort());
    // La conversation créée pour ce message est retirée aussi.
    expect(fake.table("conversations")).toHaveLength(0);
  });

  it("une envie jointe compte aussi comme une pièce envoyée (limite par heure)", async () => {
    process.env.NODE_ENV = "development";
    const sender = "30000000-0000-4000-8000-000000000001";
    const fake = seeded({ profiles: [profile(sender, "partage"), profile(BOB, "bob")], follows: friends(sender, BOB) });
    withWish(fake, { user_id: sender });
    downloads.images.set(THUMB, await jpeg(200, 200));
    const target = await messagesApp(fake.db);
    for (let i = 0; i < RATE_LIMITS.pieceSend.max; i += 1) expect((await send(target, sender, BOB, { wishId: WISH })).statusCode).toBe(201);
    const limited = await send(target, sender, BOB, { wishId: WISH });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("piece_send_limit");
    // Un message sans envie part toujours.
    expect((await send(target, sender, BOB, { text: "Sans envie" })).statusCode).toBe(201);
  });
});

describe("résultat envoyé à un ami (sans passer par les Envies)", () => {
  const ALICE_SEARCH = "a1000000-0000-4000-8000-000000000011";
  const BOB_SEARCH = "b1000000-0000-4000-8000-000000000012";
  const RESULT = "a2000000-0000-4000-8000-000000000021";
  const BOB_RESULT = "b2000000-0000-4000-8000-000000000022";
  const RESULT_THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:resultat";
  const RESULT_HD = "https://boutique.example/images/veste-hd.jpg";
  const RESULT_LINK = "https://boutique.example/veste-daim";
  const NOT_FOUND = { error: "product_match_not_found", message: "Produit introuvable." };

  const resultRow = (overrides: Row = {}): Row => ({
    id: RESULT,
    search_id: ALICE_SEARCH,
    rank: 1,
    product_name: "Veste en daim marron",
    brand: "Maison",
    image_url: RESULT_THUMB,
    image_hd_url: RESULT_HD,
    price_min: "189.00",
    price_max: "189.00",
    currency: "EUR",
    merchant_name: "Boutique",
    merchant_url: RESULT_LINK,
    ...overrides,
  });

  /** Un résultat d'une recherche d'Alice, et un d'une recherche de Bob. */
  function withResults(fake: ReturnType<typeof seeded>, overrides: Row = {}, owner = ALICE) {
    fake.table("product_searches").push({ id: ALICE_SEARCH, user_id: owner }, { id: BOB_SEARCH, user_id: BOB });
    fake.table("product_matches").push(resultRow(overrides), resultRow({ id: BOB_RESULT, search_id: BOB_SEARCH, product_name: "Sac de Bob", merchant_url: "https://autre.example/sac" }));
    // Lien « direct » : le lien du marchand tel quel, comme saveMatches le range.
    fake.table("affiliate_links").push({ product_match_id: RESULT, affiliate_url: String(overrides.merchant_url ?? RESULT_LINK) });
  }

  it("la carte reprend le résultat (sans réseau) : nom, sinon marque puis boutique ; titre coupé proprement ; lien trop long écarté", () => {
    const row = { ...resultRow(), price_min: "189.00" } as Parameters<typeof matchCard>[0];
    expect(matchCard(row)?.columns).toEqual({
      wish_title: "Veste en daim marron",
      wish_merchant_name: "Boutique",
      wish_merchant_url: RESULT_LINK,
      wish_product_match_id: RESULT,
      wish_price_min: "189.00",
      wish_currency: "EUR",
    });
    expect(matchCard(row)?.imageSource).toEqual({ image_url: RESULT_THUMB, product_match_id: RESULT });
    expect(matchCard({ ...row, product_name: "   ", brand: null })?.columns.wish_title).toBe("Boutique");
    expect(matchCard({ ...row, product_name: "", brand: " ", merchant_name: null })).toBeNull();
    // 119 caractères puis un émoji : jamais une moitié d'émoji en fin de titre.
    expect(matchCard({ ...row, product_name: `${"a".repeat(119)}👜 suite` })?.columns.wish_title).toBe("a".repeat(119));
    const long = matchCard({ ...row, merchant_url: `https://boutique.example/${"a".repeat(2100)}` })!;
    expect(long.columns).toMatchObject({ wish_merchant_url: null, wish_product_match_id: null });
    // L'image haute définition du résultat sert quand même à la copie.
    expect(long.imageSource.product_match_id).toBe(RESULT);
  });

  it("son propre résultat : carte complète, image copiée dans notre stockage (jamais l'adresse du marchand) ; rien n'est ajouté à ses Envies", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(180, 240));
    downloads.images.set(RESULT_HD, await jpeg(600, 800));
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { matchId: RESULT, text: "Regarde cette veste" });
    expect(res.statusCode).toBe(201);
    const sent: SendMessageResponse = res.json();
    expect(sent.message.text).toBe("Regarde cette veste");
    const card = sent.message.wish!;
    expect(card).toMatchObject({
      title: "Veste en daim marron",
      merchantName: "Boutique",
      merchantUrl: RESULT_LINK,
      isAffiliate: false,
      productMatchId: RESULT,
      priceMin: 189,
      currency: "EUR",
    });
    for (const url of [card.imageUrl, card.imageThumbUrl]) expect(url.startsWith(`${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${ALICE}/`)).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("gstatic");
    expect(JSON.stringify(sent)).not.toContain("veste-hd.jpg");
    expect(fake.uploads.filter((path) => path.startsWith(`post-media/${ALICE}/`))).toHaveLength(2);
    // Même choix que pour une envie : les deux sources, la plus grande gardée.
    expect(downloads.calls.sort()).toEqual([RESULT_HD, RESULT_THUMB].sort());
    expect(fake.table("messages")[0]).toMatchObject({ wish_image_url: card.imageUrl, wish_product_match_id: RESULT });
    expect(fake.table("wishlist_items")).toEqual([]);
    // Bob voit la même carte.
    const thread: ConversationThread = (await as(target, BOB).get(`/api/conversations/${sent.conversationId}`)).json();
    expect(thread.messages[0]!.wish).toEqual(card);
    // Lien affilié, comme ailleurs : seulement s'il diffère du lien du marchand.
    fake.table("affiliate_links")[0]!.affiliate_url = "https://partenaire.example/veste?aff=spotto";
    const again: ConversationThread = (await as(target, BOB).get(`/api/conversations/${sent.conversationId}`)).json();
    expect(again.messages[0]!.wish).toMatchObject({ merchantUrl: "https://partenaire.example/veste?aff=spotto", isAffiliate: true });
  });

  it("le résultat d'une autre personne : même 404 qu'un résultat inexistant ; rien n'est téléchargé ni écrit", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    const bodies = new Set<string>();
    for (const matchId of [BOB_RESULT, UNKNOWN]) {
      const res = await send(target, ALICE, BOB, { matchId, text: "Regarde" });
      expect(res.statusCode).toBe(404);
      bodies.add(res.body);
    }
    // Celui d'Alice, envoyé par Bob : introuvable aussi.
    const fromBob = await send(target, BOB, ALICE, { matchId: RESULT });
    expect(fromBob.statusCode).toBe(404);
    bodies.add(fromBob.body);
    expect([...bodies]).toEqual([JSON.stringify(NOT_FOUND)]);
    expect(downloads.calls).toEqual([]);
    expect(fake.uploads).toEqual([]);
    expect(fake.table("messages")).toHaveLength(0);
    expect(fake.table("conversations")).toHaveLength(0);
  });

  it("aucune image récupérable : 422 (même code que pour une envie), rien n'est écrit ni gardé", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withResults(fake);
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { matchId: RESULT, text: "Regarde" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "wish_image_unavailable", message: "L'image de cette pièce n'a pas pu être récupérée. Réessayez plus tard." });
    expect(downloads.calls.sort()).toEqual([RESULT_HD, RESULT_THUMB].sort());
    expect(fake.uploads).toEqual([]);
    expect(fake.table("messages")).toHaveLength(0);
    expect(fake.table("conversations")).toHaveLength(0);
  });

  it("un lien marchand qui n'est pas un lien web ordinaire, ou trop long, n'est jamais recopié (ni remplacé par son lien affilié)", async () => {
    for (const unsafe of ["javascript:alert(1)", `https://boutique.example/${"a".repeat(2100)}`]) {
      const fake = seeded({ follows: friends(ALICE, BOB) });
      withResults(fake, { merchant_url: unsafe });
      downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
      const target = await messagesApp(fake.db);
      const res = await send(target, ALICE, BOB, { matchId: RESULT });
      expect(res.statusCode).toBe(201);
      expect(res.json().message).toMatchObject({ text: null, wish: { title: "Veste en daim marron", merchantUrl: null, isAffiliate: false, productMatchId: null } });
      expect(fake.table("messages")[0]).toMatchObject({ wish_merchant_url: null, wish_product_match_id: null });
      // L'image haute définition du résultat a quand même été essayée.
      expect(downloads.calls).toContain(RESULT_HD);
      await app?.close();
      app = null;
    }
  });

  it("une seule carte par message : jamais avec une envie ou une envie de collection ; identifiant mal formé refusé", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    for (const body of [{ matchId: RESULT, wishId: WISH }, { matchId: RESULT, collectionItemId: UNKNOWN }, { matchId: "pas-un-id" }]) {
      const res = await send(target, ALICE, BOB, { text: "Regarde", ...body });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Message invalide." });
    }
    expect(downloads.calls).toEqual([]);
    expect(fake.table("messages")).toHaveLength(0);
  });

  it("blocage, compte suspendu, mots interdits : les mêmes règles qu'un message ; rien n'est copié", async () => {
    for (const block of [[ALICE, BOB] as [string, string], [BOB, ALICE] as [string, string]]) {
      const fake = seeded({ follows: friends(ALICE, BOB), blocks: [block] });
      withResults(fake);
      downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
      const target = await messagesApp(fake.db);
      const res = await send(target, ALICE, BOB, { matchId: RESULT });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("recipient_not_found");
      await app?.close();
      app = null;
    }
    const fake = seeded({ follows: friends(ALICE, BOB), suspended: [ALICE] });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    const suspended = await send(target, ALICE, BOB, { matchId: RESULT });
    expect(suspended.statusCode).toBe(403);
    expect(suspended.json().error).toBe("account_suspended");
    fake.table("suspensions").length = 0;
    const banned = await send(target, ALICE, BOB, { matchId: RESULT, text: "Espèce de connard" });
    expect(banned.statusCode).toBe(400);
    expect(banned.json().error).toBe("content_not_allowed");
    expect(downloads.calls).toEqual([]);
    expect(fake.uploads).toEqual([]);
    expect(fake.table("messages")).toHaveLength(0);
  });

  it("invitations : refusé selon le réglage de la personne ; sinon UNE invitation, avec la carte, puis rien avant sa réponse", async () => {
    const fake = seeded({ profiles: [profile(ALICE, "alice"), profile(BOB, "bob"), profile(CHLOE, "chloe", "nobody"), profile(DAN, "dan")] });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    const refused = await send(target, ALICE, CHLOE, { matchId: RESULT });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("recipient_not_accepting");
    expect(downloads.calls).toEqual([]);
    const invitation = await send(target, ALICE, DAN, { matchId: RESULT, text: "Elle vous plairait" });
    expect(invitation.statusCode).toBe(201);
    expect(invitation.json()).toMatchObject({ state: "invitation_sent", sendMode: "waiting", message: { wish: { title: "Veste en daim marron" } } });
    expect((await list(target, DAN)).invitations[0]!.lastMessage).toMatchObject({ hasWish: true, text: "Elle vous plairait" });
    const pending = await send(target, ALICE, DAN, { matchId: RESULT });
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error).toBe("invitation_pending");
    expect(fake.table("messages")).toHaveLength(1);
  });

  it("compte comme une pièce envoyée (limite par heure)", async () => {
    process.env.NODE_ENV = "development";
    const sender = "30000000-0000-4000-8000-000000000002";
    const fake = seeded({ profiles: [profile(sender, "envoi"), profile(BOB, "bob")], follows: friends(sender, BOB) });
    withResults(fake, {}, sender);
    downloads.images.set(RESULT_THUMB, await jpeg(200, 200));
    const target = await messagesApp(fake.db);
    for (let i = 0; i < RATE_LIMITS.pieceSend.max; i += 1) expect((await send(target, sender, BOB, { matchId: RESULT })).statusCode).toBe(201);
    const limited = await send(target, sender, BOB, { matchId: RESULT });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe("piece_send_limit");
    expect((await send(target, sender, BOB, { text: "Sans carte" })).statusCode).toBe(201);
  });

  it("sans la migration 0032 : « indisponible », comme les autres routes des messages ; rien n'est lu ni copié", async () => {
    const fake = seeded({}, { missing: ["conversations", "conversation_participants", "messages"] });
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    const res = await send(target, ALICE, BOB, { matchId: RESULT });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("messages_unavailable");
    expect(downloads.calls).toEqual([]);
  });

  it("le journal ne contient jamais le texte, ni le titre, ni l'adresse du résultat ; échec après la copie : copie effacée", async () => {
    const secret = "Mon code secret est 4242 violette";
    const lines: string[] = [];
    let failNext = false;
    const fake = seeded(
      { follows: friends(ALICE, BOB) },
      {
        failWrite: (table, action, values) =>
          failNext && table === "messages" && action === "insert"
            ? { code: "23514", message: `new row violates check constraint, Failing row contains (${JSON.stringify(values)})` }
            : null,
      }
    );
    withResults(fake);
    downloads.images.set(RESULT_THUMB, await jpeg(180, 240));
    downloads.images.set(RESULT_HD, await jpeg(600, 800));
    const target = await messagesApp(fake.db, lines);
    expect((await send(target, ALICE, BOB, { matchId: RESULT, text: secret })).statusCode).toBe(201);
    failNext = true;
    const uploadedBefore = fake.uploads.length;
    expect((await send(target, ALICE, BOB, { matchId: RESULT, text: secret })).statusCode).toBe(500);
    expect(fake.removed.sort()).toEqual(fake.uploads.slice(uploadedBefore).sort());
    const log = lines.join("\n");
    expect(log).toContain("Échec de l'envoi d'un message");
    expect(log).toContain("Message envoyé");
    for (const hidden of ["4242", "violette", "Veste en daim", "veste-daim", "veste-hd.jpg", "tbn:resultat", RESULT]) expect(log).not.toContain(hidden);
  });
});

describe("données personnelles", () => {
  it("l'export contient les conversations, les messages envoyés et reçus, et le @nom de l'autre membre", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    await send(target, ALICE, BOB, { text: "Message d'Alice" });
    await send(target, BOB, ALICE, { text: "Réponse de Bob" });
    await send(target, CHLOE, ALICE, { text: "Invitation de Chloé" });
    fake.table("blocks").push({ blocker_id: CHLOE, blocked_id: ALICE, created_at: "2026-11-08T00:00:00+00:00" });

    const json = (await as(target, ALICE).get("/api/me/export")).json();
    expect(json.conversations).toHaveLength(2);
    const withBob = json.conversations.find((row: Row) => row.other_user_id === BOB);
    expect(withBob).toMatchObject({ other_username: "bob", invitation: "none" });
    // Un compte en relation de blocage n'est jamais nommé.
    expect(json.conversations.find((row: Row) => row.other_user_id === CHLOE)).toMatchObject({ other_username: null, invitation: "received" });
    expect(json.messages.map((row: Row) => row.body).sort()).toEqual(["Invitation de Chloé", "Message d'Alice", "Réponse de Bob"]);
    // Jamais le côté de l'autre membre (il dirait, par exemple, s'il a refusé).
    expect(json.conversations.every((row: Row) => !("user_id" in row))).toBe(true);
    expect(JSON.stringify(json.conversations)).not.toContain('"sent"');
    // Bob n'exporte que ses propres conversations.
    expect((await as(target, BOB).get("/api/me/export")).json().messages.map((row: Row) => row.body).sort()).toEqual(["Message d'Alice", "Réponse de Bob"]);

    const page = await as(target, ALICE).get("/api/me/export?format=html");
    expect(page.statusCode).toBe(200);
    const text = page.body.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'");
    expect(text).toContain("Vos messages");
    expect(text).toContain("Conversation avec @bob");
    expect(text).toContain("Conversation avec un compte Spotto");
    expect(text).toContain("Réponse de Bob");
  });

  it("suppression du compte : les copies des envies jointes par l'autre membre sont effacées (la conversation part avec le compte)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: null });
    fake.table("wishlist_items").push({ id: WISH, user_id: BOB, title: "Montre", image_url: THUMB, price_min: null, currency: null, merchant_name: null, merchant_url: null, product_match_id: MATCH, created_at: "2026-11-01T00:00:00+00:00" });
    downloads.images.set(THUMB, await jpeg(300, 300));
    const target = await messagesApp(fake.db);
    expect((await send(target, BOB, ALICE, { wishId: WISH })).statusCode).toBe(201);
    const bobCopies = fake.uploads.filter((path) => path.startsWith(`post-media/${BOB}/`));
    expect(bobCopies).toHaveLength(2);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.removed.sort()).toEqual(bobCopies.sort());
    expect(fake.deletedUsers).toEqual([ALICE]);
  });
});
