import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationThread, Profile, SendMessageResponse } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import conversationsRoutes from "../src/routes/conversations.js";
import accountRoutes from "../src/routes/account.js";
import meRoutes from "../src/routes/me.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import { openBothWays, readReceiptsReady, readStamp, resetReadReceiptsProbe, shownReadAt } from "../src/lib/readReceipts.js";
import { EN_MESSAGES } from "../src/lib/messages.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Confirmations de lecture (lot « messages vus », migration 0043), SANS base
// ni réseau : les vraies routes sur une fausse base en mémoire
// (tests/fakeSupabase.ts). « Vu » ou « Envoyé » sous son dernier message :
// ce que le serveur renvoie (`readReceipts`) à chaque lecture, relecture et
// envoi ; réciproque ; jamais pour une invitation, ni pour une lecture faite
// avant qu'elle soit acceptée ; rien pour un blocage ou un compte suspendu ;
// rien sans la migration. Le même parcours sur la vraie base de
// développement : messagerieBase.test.ts (sur le Mac, une fois 0043
// appliquée sur spotto-dev-2).

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Un profil complet (GET /api/me le relit en entier). `receipts` : la valeur
 * du réglage ; null : colonne absente (base sans 0043). */
function profile(id: string, username: string, receipts: boolean | null = true): Row {
  return {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: null,
    bio: null,
    locale: "fr",
    default_privacy: "followers",
    messages_from: "everyone",
    piece_sends_from: "following",
    ...(receipts === null ? {} : { read_receipts: receipts }),
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];
const WITHOUT_0043: FakeDbOptions = { missingColumns: { profiles: ["read_receipts"] } };

interface Seed {
  follows?: [string, string][];
  /** Base sans la migration 0043 : colonne absente, profils sans réglage. */
  without0043?: boolean;
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase({ ...(seed.without0043 ? WITHOUT_0043 : {}), ...options });
  const receipts = seed.without0043 ? null : true;
  fake.table("profiles").push(profile(ALICE, "alice", receipts), profile(BOB, "bob", receipts), profile(CHLOE, "chloe", receipts));
  for (const [follower, followee] of seed.follows ?? []) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  return fake;
}
type Fake = ReturnType<typeof seeded>;

let app: FastifyInstance | null = null;

/** Les vraies routes, une fausse base, un compte par en-tête, et le journal
 * du serveur avec ses vraies règles (lib/logPrivacy.ts). */
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
  };
}

async function send(target: FastifyInstance, from: string, to: string, text: string): Promise<SendMessageResponse> {
  const res = await as(target, from).post("/api/messages", { recipientId: to, text });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** La conversation, telle que l'app la reçoit : lecture complète, ou relecture `after`. */
async function thread(target: FastifyInstance, user: string, id: string, after?: string): Promise<ConversationThread> {
  const res = await as(target, user).get(`/api/conversations/${id}${after ? `?after=${encodeURIComponent(after)}` : ""}`);
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** Ouvrir la conversation dans l'app : elle est marquée comme lue. */
async function open(target: FastifyInstance, user: string, id: string): Promise<void> {
  expect((await as(target, user).post(`/api/conversations/${id}/read`)).statusCode).toBe(204);
}

async function setReceipts(target: FastifyInstance, user: string, value: boolean): Promise<void> {
  expect((await as(target, user).put("/api/me/read-receipts", { readReceipts: value })).statusCode).toBe(204);
}

const side = (fake: Fake, user: string): Row => fake.table("conversation_participants").find((row) => row.user_id === user)!;

// L'horloge du serveur avance à la demande (une heure entre deux gestes) :
// une lecture, une acceptation et un message ont chacun leur date. Jamais en
// arrière : la fausse base date ses lignes d'après la même horloge.
let clock = Date.parse("2031-03-01T08:00:00.000Z");
function later(ms = HOUR): string {
  clock += ms;
  vi.setSystemTime(clock);
  return new Date(clock).toISOString();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  later();
  resetMessagesProbe();
  resetReadReceiptsProbe();
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = null;
});

describe("règles (sans réseau)", () => {
  it("rien tant que la conversation n'est pas ouverte des deux côtés", () => {
    const states = ["none", "sent", "received", "declined"] as const;
    const shown = states.flatMap((mine) => states.filter((theirs) => openBothWays({ invitation: mine }, { invitation: theirs })).map((theirs) => `${mine}/${theirs}`));
    expect(shown).toEqual(["none/none"]);
    expect(openBothWays(null, { invitation: "none" })).toBe(false);
    expect(openBothWays({ invitation: "none" }, null)).toBe(false);
  });

  it("la lecture montrée : la dernière, jamais une lecture d'avant l'ouverture de la conversation", () => {
    const opened = "2026-11-10T10:00:00.000+00:00";
    const base = { invitation: "none" as const, invitation_at: opened };
    // Pas encore lue.
    expect(shownReadAt({ ...base, last_read_at: null })).toBeNull();
    // Lue avant l'acceptation (la personne invitée regardait l'invitation) : jamais montrée.
    expect(shownReadAt({ ...base, last_read_at: "2026-11-09T18:30:00.000+00:00" })).toBeNull();
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T09:59:59.999+00:00" })).toBeNull();
    // À l'acceptation (« Accepter » date la lecture du même instant) ou après : montrée telle quelle.
    expect(shownReadAt({ ...base, last_read_at: opened })).toBe(opened);
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T10:00:00.001+00:00" })).toBe("2026-11-10T10:00:00.001+00:00");
    // Même instant, écrit autrement (serveur, puis base).
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T10:00:00.000Z" })).toBe("2026-11-10T10:00:00.000Z");
    // Conversation ouverte dès le premier message (entre amis) : aucune invitation, toute lecture compte.
    expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: "2026-11-09T18:30:00+00:00" })).toBe("2026-11-09T18:30:00+00:00");
  });

  it("un côté qui n'est pas ouvert, ou une date illisible : rien", () => {
    const read = "2026-11-10T12:00:00+00:00";
    for (const invitation of ["sent", "received", "declined"] as const) {
      expect(shownReadAt({ invitation, invitation_at: "2026-11-10T10:00:00+00:00", last_read_at: read })).toBeNull();
      expect(shownReadAt({ invitation, invitation_at: null, last_read_at: read })).toBeNull();
    }
    expect(shownReadAt({ invitation: "none", invitation_at: "illisible", last_read_at: read })).toBeNull();
    expect(shownReadAt({ invitation: "none", invitation_at: "2026-11-10T10:00:00+00:00", last_read_at: "illisible" })).toBeNull();
    expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: "illisible" })).toBeNull();
  });

  it("date d'une lecture : maintenant ; dans une conversation ouverte, jamais avant le dernier message lu (horloge de la base en avance)", () => {
    const now = Date.parse("2026-11-10T10:00:00.000Z");
    const ahead = "2026-11-10T10:00:00.250123+00:00";
    // Horloges d'accord, ou base en retard : l'heure du serveur.
    expect(readStamp({ invitation: "none", last_message_at: "2026-11-10T09:59:58.000000+00:00" }, now)).toBe("2026-11-10T10:00:00.000Z");
    expect(readStamp({ invitation: "none", last_message_at: "2026-11-10T10:00:00.000000+00:00" }, now)).toBe("2026-11-10T10:00:00.000Z");
    // Le dernier message est daté « plus tard » que maintenant : la lecture le couvre quand même.
    expect(readStamp({ invitation: "none", last_message_at: ahead }, now)).toBe(ahead);
    expect(Date.parse(readStamp({ invitation: "none", last_message_at: ahead }, now))).toBeGreaterThanOrEqual(Date.parse(ahead));
    // Une invitation (reçue, envoyée, refusée) : toujours l'horloge du serveur, comme la date de l'acceptation.
    for (const invitation of ["received", "sent", "declined"] as const) expect(readStamp({ invitation, last_message_at: ahead }, now)).toBe("2026-11-10T10:00:00.000Z");
    expect(readStamp({ invitation: "none", last_message_at: "illisible" }, now)).toBe("2026-11-10T10:00:00.000Z");
  });
});

describe("conversation ouverte entre amis", () => {
  it("« Envoyé » tant que l'autre n'a pas ouvert la conversation, puis la date de sa lecture : lecture complète, relecture et envoi", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Tu as vu ce sac ?");
    const id = first.conversationId;
    // Pas encore ouverte par Bob : la confirmation existe, sans date.
    expect(first.readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id, first.message.createdAt)).readReceipts).toEqual({ seenAt: null });
    // Lire la conversation sans la marquer comme lue ne change rien.
    await thread(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });

    const readAt = later();
    await open(target, BOB, id);
    const full = await thread(target, ALICE, id);
    expect(full.readReceipts).toEqual({ seenAt: readAt });
    // « Vu » : la lecture n'est pas antérieure au message.
    expect(Date.parse(full.readReceipts!.seenAt!)).toBeGreaterThanOrEqual(Date.parse(first.message.createdAt));
    // La relecture de l'app (aucun nouveau message) la renvoie aussi.
    const poll = await thread(target, ALICE, id, first.message.createdAt);
    expect(poll.messages).toEqual([]);
    expect(poll.readReceipts).toEqual({ seenAt: readAt });
    // Le bouton « Message » d'un profil : la même conversation, la même réponse.
    expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json().readReceipts).toEqual({ seenAt: readAt });

    // Un nouveau message : la réponse de l'envoi garde la lecture d'avant (« Envoyé » sous ce message).
    later();
    const second = await send(target, ALICE, BOB, "Il te plaît ?");
    expect(second.readReceipts).toEqual({ seenAt: readAt });
    expect(Date.parse(second.readReceipts!.seenAt!)).toBeLessThan(Date.parse(second.message.createdAt));
    const reread = later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id, second.message.createdAt)).readReceipts).toEqual({ seenAt: reread });
  });

  it("l'horloge de la base avance sur celle du serveur : le message tout juste reçu, une fois lu, est bien « Vu »", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    // La fausse base date ses messages au moins une seconde après l'heure du serveur.
    expect(Date.parse(first.message.createdAt)).toBeGreaterThan(Date.now());
    await open(target, BOB, id);
    const seenAt = (await thread(target, ALICE, id)).readReceipts!.seenAt!;
    expect(Date.parse(seenAt)).toBeGreaterThanOrEqual(Date.parse(first.message.createdAt));
    // Un message envoyé ensuite n'est pas couvert par cette lecture.
    const second = await send(target, ALICE, BOB, "Encore moi");
    expect(Date.parse(second.readReceipts!.seenAt!)).toBeLessThan(Date.parse(second.message.createdAt));
  });

  it("dans les deux sens : chacun reçoit la lecture de l'autre, jamais la sienne", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const bobRead = later();
    await open(target, BOB, id);
    later();
    const reply = await send(target, BOB, ALICE, "Bonjour Alice");
    // Alice n'a jamais marqué la conversation comme lue.
    expect(reply.readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: bobRead });
    const aliceRead = later();
    await open(target, ALICE, id);
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: aliceRead });
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: bobRead });
  });

  it("aucune conversation encore avec cette personne : rien", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const res = await as(target, ALICE).get(`/api/conversations/with/${BOB}`);
    expect(res.json()).toMatchObject({ id: null, state: "new", sendMode: "direct", readReceipts: null });
  });
});

describe("réglage « Confirmations de lecture » : allumé par défaut, réciproque", () => {
  it("dès que l'un des deux l'éteint, aucun des deux ne reçoit rien ; rallumé, tout revient", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    const bobRead = later();
    await open(target, BOB, id);
    const aliceRead = later();
    await open(target, ALICE, id);

    for (const off of [ALICE, BOB]) {
      await setReceipts(target, off, false);
      for (const viewer of [ALICE, BOB]) {
        expect((await thread(target, viewer, id)).readReceipts, `${off} éteint, vu par ${viewer}`).toBeNull();
        expect((await thread(target, viewer, id, first.message.createdAt)).readReceipts).toBeNull();
        expect((await as(target, viewer).get(`/api/conversations/with/${viewer === ALICE ? BOB : ALICE}`)).json().readReceipts).toBeNull();
      }
      later();
      expect((await send(target, ALICE, BOB, "Encore un mot")).readReceipts).toBeNull();
      expect((await send(target, BOB, ALICE, "Réponse")).readReceipts).toBeNull();
      // Rien d'autre ne change : la conversation, ses messages, l'envoi.
      expect(await thread(target, ALICE, id)).toMatchObject({ state: "open", sendMode: "direct" });
      await setReceipts(target, off, true);
    }
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: bobRead });
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: aliceRead });
  });

  it("le réglage s'enregistre (même pour un compte suspendu), se relit dans le profil, et n'accepte qu'un vrai oui ou non", async () => {
    const fake = seeded();
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    const target = await messagesApp(fake.db);
    const me = async (): Promise<Profile> => (await as(target, ALICE).get("/api/me")).json();
    expect((await me()).readReceipts).toBe(true);
    await setReceipts(target, ALICE, false);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.read_receipts).toBe(false);
    expect((await me()).readReceipts).toBe(false);
    // Le réglage d'un autre membre n'a pas bougé.
    expect(fake.table("profiles").find((row) => row.id === BOB)!.read_receipts).toBe(true);
    for (const body of [{ readReceipts: "true" }, { readReceipts: 1 }, { readReceipts: null }, {}, { read_receipts: true }]) {
      const res = await as(target, ALICE).put("/api/me/read-receipts", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Réglage invalide." });
    }
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.read_receipts).toBe(false);
    await setReceipts(target, ALICE, true);
    expect((await me()).readReceipts).toBe(true);
    // Sans compte connecté : refusé.
    expect((await target.inject({ method: "PUT", url: "/api/me/read-receipts", payload: { readReceipts: false } })).statusCode).toBe(401);
  });

  it("une panne à l'enregistrement : 500, et le réglage ne change pas", async () => {
    const fake = seeded({}, { failWrite: (table, action) => (table === "profiles" && action === "update" ? { code: "XX000", message: "panne" } : null) });
    const target = await messagesApp(fake.db);
    const res = await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: false });
    expect(res.statusCode).toBe(500);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.read_receipts).toBe(true);
  });

  it("l'export des données contient le réglage", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    await setReceipts(target, ALICE, false);
    const exported = (await as(target, ALICE).get("/api/me/export")).json();
    expect(exported.profile.read_receipts).toBe(false);
    const page = (await as(target, ALICE).get("/api/me/export?format=html")).body.replace(/<[^>]*>/g, " ");
    expect(page).toContain("Confirmations de lecture");
  });
});

describe("jamais pour une invitation", () => {
  it("la personne qui invite ne reçoit rien, que l'invitation ait été regardée, ignorée ou refusée : la même réponse, mot pour mot", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const sent = await send(target, ALICE, BOB, "Bonjour, j'aime votre style");
    const id = sent.conversationId;
    expect(sent).toMatchObject({ state: "invitation_sent", sendMode: "waiting", readReceipts: null });
    const before = await thread(target, ALICE, id);
    const pollBefore = await thread(target, ALICE, id, sent.message.createdAt);
    expect(before.readReceipts).toBeNull();
    expect(pollBefore.readReceipts).toBeNull();

    // Bob regarde l'invitation : son app la marque comme lue (date gardée de son côté).
    const looked = later();
    expect((await thread(target, BOB, id)).readReceipts).toBeNull();
    await open(target, BOB, id);
    expect(side(fake, BOB)).toMatchObject({ invitation: "received", unread: false, last_read_at: looked });
    const afterLook = await thread(target, ALICE, id);
    expect(afterLook).toEqual(before);
    expect(await thread(target, ALICE, id, sent.message.createdAt)).toEqual(pollBefore);
    expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()).toEqual(before);
    expect(JSON.stringify(afterLook)).not.toContain(looked);
    expect((await thread(target, BOB, id)).readReceipts).toBeNull();

    // Bob refuse : rien ne change pour Alice.
    later();
    expect((await as(target, BOB).post(`/api/conversations/${id}/decline`)).statusCode).toBe(204);
    expect(await thread(target, ALICE, id)).toEqual(before);
    expect(await thread(target, ALICE, id, sent.message.createdAt)).toEqual(pollBefore);
  });

  it("« Accepter » : la lecture montrée date de l'acceptation, jamais du moment où l'invitation a été regardée", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const looked = later();
    await open(target, BOB, id);
    const accepted = later(3 * HOUR);
    expect((await as(target, BOB).post(`/api/conversations/${id}/accept`)).statusCode).toBe(204);
    const seen = await thread(target, ALICE, id);
    expect(seen).toMatchObject({ state: "open", sendMode: "direct", readReceipts: { seenAt: accepted } });
    expect(JSON.stringify(seen)).not.toContain(looked);
    // Alice a ouvert sa propre invitation avant l'acceptation : Bob n'en sait rien non plus.
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    // Ensuite, comme toute conversation ouverte.
    const reread = later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: reread });
  });

  it("répondre à l'invitation vaut acceptation : la lecture est datée de la réponse, jamais d'avant", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const looked = later();
    await open(target, BOB, id);
    const answered = later(2 * HOUR);
    const reply = await send(target, BOB, ALICE, "Bonjour à vous");
    expect(reply).toMatchObject({ conversationId: id, state: "open" });
    expect(side(fake, BOB)).toMatchObject({ invitation: "none", invitation_at: answered, last_read_at: answered });
    const seen = await thread(target, ALICE, id);
    expect(seen.readReceipts).toEqual({ seenAt: answered });
    expect(JSON.stringify(seen)).not.toContain(looked);
    // Le « non lu » d'Alice n'a pas changé de règle : le message de Bob l'attend.
    expect(side(fake, ALICE)).toMatchObject({ invitation: "none", unread: true });
  });

  it("une lecture d'avant l'ouverture restée dans la base (conversation ouverte par une version plus ancienne du serveur) n'est jamais renvoyée", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const looked = later();
    await open(target, BOB, id);
    // Comme l'ancien serveur : la réponse ouvre la conversation sans dater la lecture.
    const opened = later();
    for (const row of fake.table("conversation_participants")) Object.assign(row, { invitation: "none", invitation_at: opened });
    expect(side(fake, BOB).last_read_at).toBe(looked);
    for (const read of [await thread(target, ALICE, id), await thread(target, ALICE, id, "2020-01-01T00:00:00Z")]) {
      expect(read.readReceipts).toEqual({ seenAt: null });
      expect(JSON.stringify(read)).not.toContain(looked);
    }
    // Dès que Bob rouvre la conversation, sa lecture compte.
    const reread = later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: reread });
  });

  it("devenus amis : le message suivant ouvre la conversation, sans révéler que l'invitation avait été regardée", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const looked = later();
    await open(target, BOB, id);
    for (const [follower, followee] of friends(ALICE, BOB)) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-11-01T00:00:00+00:00" });
    later();
    const second = await send(target, ALICE, BOB, "On se suit maintenant");
    expect(second).toMatchObject({ state: "open", sendMode: "direct", readReceipts: { seenAt: null } });
    const seen = await thread(target, ALICE, id);
    expect(seen.readReceipts).toEqual({ seenAt: null });
    expect(JSON.stringify(seen)).not.toContain(looked);
    // Alice n'a fait qu'écrire : sa propre lecture n'est pas datée par l'envoi.
    expect(side(fake, ALICE).last_read_at).toBeNull();
  });

  it("refusée, puis la personne invitée écrit la première : la lecture date de ce message, jamais d'avant le refus", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const looked = later();
    await open(target, BOB, id);
    later();
    expect((await as(target, BOB).post(`/api/conversations/${id}/decline`)).statusCode).toBe(204);
    const wrote = later(24 * HOUR);
    expect(await send(target, BOB, ALICE, "Finalement, bonjour")).toMatchObject({ conversationId: id, state: "open" });
    const seen = await thread(target, ALICE, id);
    expect(seen.readReceipts).toEqual({ seenAt: wrote });
    expect(JSON.stringify(seen)).not.toContain(looked);
  });

  it("ouverte d'un seul côté (écriture interrompue) : rien, pour l'un comme pour l'autre", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    later();
    await open(target, BOB, id);
    await open(target, ALICE, id);
    // Le côté de Bob est passé à « ouvert », celui d'Alice est resté « invitation envoyée ».
    Object.assign(side(fake, BOB), { invitation: "none", invitation_at: later() });
    later();
    await open(target, BOB, id);
    await open(target, ALICE, id);
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();
    expect((await thread(target, BOB, id)).readReceipts).toBeNull();
  });
});

describe("blocage, compte suspendu, compte disparu", () => {
  it("blocage dans un sens ou dans l'autre : la conversation est introuvable, aucune confirmation ne sort ; elle revient au déblocage", async () => {
    for (const block of [[ALICE, BOB] as const, [BOB, ALICE] as const]) {
      const fake = seeded({ follows: friends(ALICE, BOB) });
      const target = await messagesApp(fake.db);
      const first = await send(target, ALICE, BOB, "Avant le blocage");
      const id = first.conversationId;
      const readAt = later();
      await open(target, BOB, id);
      fake.table("blocks").push({ blocker_id: block[0], blocked_id: block[1], created_at: "2026-11-01T00:00:00+00:00" });
      for (const user of [ALICE, BOB]) {
        for (const url of [`/api/conversations/${id}`, `/api/conversations/${id}?after=${encodeURIComponent(first.message.createdAt)}`]) {
          const res = await as(target, user).get(url);
          expect(res.statusCode).toBe(404);
          expect(res.body).not.toContain("readReceipts");
          expect(res.body).not.toContain(readAt);
        }
      }
      expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).body).not.toContain("readReceipts");
      const refused = await as(target, ALICE).post("/api/messages", { recipientId: BOB, text: "Après le blocage" });
      expect(refused.statusCode).toBe(404);
      expect(refused.body).not.toContain("readReceipts");
      fake.table("blocks").length = 0;
      expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: readAt });
      await app?.close();
      app = null;
    }
  });

  it("l'autre compte est suspendu : ses lectures ne sont plus montrées ; lui voit toujours celles de l'autre", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    later();
    await open(target, BOB, id);
    const aliceRead = later();
    await open(target, ALICE, id);
    fake.table("suspensions").push({ user_id: BOB, moderation_action_id: UNKNOWN });
    // Un compte suspendu lit toujours ses conversations (et les marque comme lues).
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();
    expect((await thread(target, ALICE, id, first.message.createdAt)).readReceipts).toBeNull();
    expect((await send(target, ALICE, BOB, "Toujours là ?")).readReceipts).toBeNull();
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: aliceRead });
    // Suspension levée : tout revient.
    fake.table("suspensions").length = 0;
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: side(fake, BOB).last_read_at });
  });

  it("le profil de l'autre membre a disparu : rien", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    later();
    await open(target, BOB, id);
    const profiles = fake.table("profiles");
    profiles.splice(profiles.findIndex((row) => row.id === BOB), 1);
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();
  });

  it("une lecture de la base échoue (suspensions illisibles) : rien n'est montré, la conversation s'affiche quand même", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const lines: string[] = [];
    const target = await messagesApp(fake.db, lines);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const readAt = later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: readAt });
    const original = fake.db.from;
    fake.db.from = ((name: string) => (name === "suspensions" ? fakeSupabase({ missing: ["suspensions"] }).db.from(name) : original(name))) as typeof original;
    const read = await thread(target, ALICE, id);
    expect(read.readReceipts).toBeNull();
    expect(read.messages.map((message) => message.text)).toEqual(["Bonjour"]);
    const warnings = lines.filter((line) => line.includes("Confirmations de lecture : lecture impossible, rien n'est montré"));
    expect(warnings).toHaveLength(1);
    // Ni identifiant ni date de lecture dans cet avertissement.
    for (const hidden of [ALICE, BOB, readAt]) expect(warnings[0]).not.toContain(hidden);
    fake.db.from = original;
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: readAt });
  });
});

describe("sans la migration 0043", () => {
  it("aucune confirmation n'est renvoyée, nulle part ; la messagerie fonctionne comme avant", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB), without0043: true });
    const lines: string[] = [];
    const target = await messagesApp(fake.db, lines);
    const first = await send(target, ALICE, BOB, "Tu as vu ce sac ?");
    const id = first.conversationId;
    expect(first).toMatchObject({ state: "open", sendMode: "direct", readReceipts: null });
    // Une minute plus tard seulement : la sonde n'est pas refaite avant 5 minutes.
    const readAt = later(MINUTE);
    await open(target, BOB, id);
    // La lecture reste datée, comme avant (export), mais n'est montrée à personne.
    expect(side(fake, BOB)).toMatchObject({ unread: false, last_read_at: readAt });
    for (const viewer of [ALICE, BOB]) {
      const full = await thread(target, viewer, id);
      expect(full).toMatchObject({ state: "open", sendMode: "direct", readReceipts: null });
      expect(full.messages.map((message) => message.text)).toEqual(["Tu as vu ce sac ?"]);
      expect((await thread(target, viewer, id, "2020-01-01T00:00:00Z")).readReceipts).toBeNull();
      expect(JSON.stringify(full)).not.toContain(readAt);
    }
    expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json().readReceipts).toBeNull();
    expect((await send(target, BOB, ALICE, "Oui, superbe")).readReceipts).toBeNull();
    expect((await as(target, ALICE).get("/api/messages/status")).json()).toMatchObject({ enabled: true, unreadCount: 1 });
    // Un seul avertissement, avec le code de l'erreur seulement.
    const warnings = lines.filter((line) => line.includes("Confirmations de lecture coupées : migration 0043 absente"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"code":"42703"');
  });

  it("le réglage n'est pas proposé : absent du profil, et l'enregistrer répond « indisponible » sans rien écrire", async () => {
    const fake = seeded({ without0043: true });
    const target = await messagesApp(fake.db);
    const me = (await as(target, ALICE).get("/api/me")).json();
    expect(me).toMatchObject({ id: ALICE, messagesFrom: "everyone", pieceSendsFrom: "following" });
    expect(me).not.toHaveProperty("readReceipts");
    for (const value of [false, true]) {
      const res = await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: value });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "read_receipts_unavailable", message: "Les confirmations de lecture ne sont pas encore disponibles." });
    }
    expect(fake.table("profiles").find((row) => row.id === ALICE)).not.toHaveProperty("read_receipts");
    expect(EN_MESSAGES["Les confirmations de lecture ne sont pas encore disponibles."]).toBe("Read receipts aren't available yet.");
    // Les autres réglages restent là.
    expect((await as(target, ALICE).put("/api/me/messages-from", { messagesFrom: "nobody" })).statusCode).toBe(204);
  });

  it("sans les messages privés (0032) non plus : « indisponible »", async () => {
    const fake = seeded({}, { missing: ["conversations", "conversation_participants", "messages"] });
    const target = await messagesApp(fake.db);
    const res = await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: false });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("read_receipts_unavailable");
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.read_receipts).toBe(true);
  });

  it("sonde du schéma : absente, un seul avertissement puis 5 minutes sans relire la base ; présente, mémorisée", async () => {
    let calls = 0;
    const asked: string[] = [];
    const warnings: unknown[] = [];
    const db = (error: object | null) => ({
      from: (table: string) => ({
        select: (columns: string) => ({
          limit: async () => {
            calls += 1;
            asked.push(`${table}.${columns}`);
            return { error };
          },
        }),
      }),
    });
    const log = { warn: (fields: unknown) => void warnings.push(fields) };
    const missing = { supabaseAdmin: db({ code: "42703" }), log } as unknown as FastifyInstance;
    let now = 0;
    const clockNow = () => now;
    expect(await readReceiptsReady(missing, clockNow)).toBe(false);
    expect(calls).toBe(1);
    // La colonne de la migration 0043, et rien d'autre.
    expect(asked).toEqual(["profiles.read_receipts"]);
    expect(warnings).toEqual([{ code: "42703" }]);
    now = 4 * MINUTE;
    expect(await readReceiptsReady(missing, clockNow)).toBe(false);
    expect(calls).toBe(1);
    now = 6 * MINUTE;
    expect(await readReceiptsReady(missing, clockNow)).toBe(false);
    expect(calls).toBe(2);
    resetReadReceiptsProbe();
    expect(await readReceiptsReady({ supabaseAdmin: db(null), log } as unknown as FastifyInstance, clockNow)).toBe(true);
    // Une fois vue, la migration est mémorisée.
    expect(await readReceiptsReady(missing, clockNow)).toBe(true);
    expect(calls).toBe(3);
  });

  it("retour en arrière de 0043 sur un serveur qui l'avait vue : plus rien n'est montré, la conversation s'affiche, le réglage redevient « indisponible »", async () => {
    const present = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(present.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const readAt = later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: readAt });
    // La colonne disparaît : la même base, lue comme une base sans 0043.
    const original = present.db.from;
    const gone = fakeSupabase(WITHOUT_0043);
    for (const [name, rows] of present.tables) gone.tables.set(name, rows);
    for (const row of present.table("profiles")) delete row.read_receipts;
    present.db.from = gone.db.from as typeof original;
    const read = await thread(target, ALICE, id);
    expect(read.readReceipts).toBeNull();
    expect(read.messages.map((message) => message.text)).toEqual(["Bonjour"]);
    expect((await as(target, ALICE).get("/api/me")).json()).not.toHaveProperty("readReceipts");
    expect((await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: false })).statusCode).toBe(404);
  });
});
