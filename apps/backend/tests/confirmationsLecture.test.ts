import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationThread, Profile, SendMessageResponse } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import conversationsRoutes from "../src/routes/conversations.js";
import accountRoutes from "../src/routes/account.js";
import meRoutes from "../src/routes/me.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import { laterSince, openBothWays, readReceiptsReady, readStamp, resetReadReceiptsProbe, saveReadReceipts, seenStamp, shownReadAt, sinceStamp } from "../src/lib/readReceipts.js";
import { EN_MESSAGES } from "../src/lib/messages.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Confirmations de lecture (lot « messages vus », migration 0043), SANS base
// ni réseau : les vraies routes sur une fausse base en mémoire
// (tests/fakeSupabase.ts). « Vu » ou « Envoyé » sous son dernier message :
// ce que le serveur renvoie (`readReceipts`) à chaque lecture, relecture et
// envoi ; réciproque ; jamais pour une invitation, ni pour une lecture faite
// avant qu'elle soit acceptée ; jamais une lecture du passé (faite avant que
// « Vu » existe pour ce membre, ou pendant que son réglage était éteint) ;
// rien pour un blocage ou un compte suspendu ;
// rien sans la migration. Le même parcours sur la vraie base de
// développement : messagerieBase.test.ts (sur le Mac, une fois 0043
// appliquée sur spotto-dev-2).

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Depuis quand les lectures des profils de ces tests peuvent être montrées :
 * la création de leur profil, comme pour tout nouveau membre (migration 0043). */
const SINCE = "2026-10-01T00:00:00+00:00";

/** Un profil complet (GET /api/me le relit en entier). `receipts` : la valeur
 * du réglage ; null : colonnes absentes (base sans 0043). */
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
    ...(receipts === null ? {} : { read_receipts: receipts, read_receipts_since: SINCE }),
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

const friends = (a: string, b: string): [string, string][] => [
  [a, b],
  [b, a],
];
const WITHOUT_0043: FakeDbOptions = { missingColumns: { profiles: ["read_receipts", "read_receipts_since"] } };

interface Seed {
  follows?: [string, string][];
  /** Base sans la migration 0043 : colonnes absentes, profils sans réglage. */
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
const profileRow = (fake: Fake, user: string): Row => fake.table("profiles").find((row) => row.id === user)!;
/** La date du dernier message écrit par ce membre : ce que le serveur renvoie
 * dans `seenAt` quand l'autre l'a lu (« Vu »), jamais l'heure de la lecture. */
const ownLast = (fake: Fake, user: string): string =>
  String(
    fake
      .table("messages")
      .filter((row) => row.sender_id === user)
      .map((row) => String(row.created_at))
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1)
  );
/** « Vu » pour ce membre : son dernier message est couvert par une lecture montrée. */
const seen = (fake: Fake, user: string) => ({ seenAt: ownLast(fake, user) });

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
    expect(shownReadAt({ ...base, last_read_at: null }, SINCE)).toBeNull();
    // Lue avant l'acceptation (la personne invitée regardait l'invitation) : jamais montrée.
    expect(shownReadAt({ ...base, last_read_at: "2026-11-09T18:30:00.000+00:00" }, SINCE)).toBeNull();
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T09:59:59.999+00:00" }, SINCE)).toBeNull();
    // À l'acceptation (« Accepter » date la lecture du même instant) ou après : montrée telle quelle.
    expect(shownReadAt({ ...base, last_read_at: opened }, SINCE)).toBe(opened);
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T10:00:00.001+00:00" }, SINCE)).toBe("2026-11-10T10:00:00.001+00:00");
    // Même instant, écrit autrement (serveur, puis base).
    expect(shownReadAt({ ...base, last_read_at: "2026-11-10T10:00:00.000Z" }, SINCE)).toBe("2026-11-10T10:00:00.000Z");
    // Conversation ouverte dès le premier message (entre amis) : aucune invitation, toute lecture d'après « depuis » compte.
    expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: "2026-11-09T18:30:00+00:00" }, SINCE)).toBe("2026-11-09T18:30:00+00:00");
  });

  it("jamais une lecture d'avant « depuis » (read_receipts_since) : avant que « Vu » existe pour ce membre, ou pendant que son réglage était éteint", () => {
    const since = "2026-11-18T09:00:00.000Z";
    const friends = { invitation: "none" as const, invitation_at: null };
    // La veille, une heure avant, une milliseconde avant : jamais.
    for (const read of ["2026-11-17T21:00:00.000Z", "2026-11-18T08:00:00+00:00", "2026-11-18T08:59:59.999Z", "2026-11-18T08:59:59.999999+00:00"]) {
      expect(shownReadAt({ ...friends, last_read_at: read }, since), read).toBeNull();
    }
    // Au même instant, ou après : montrée telle quelle (une lecture faite juste après avoir rallumé n'est pas perdue).
    for (const read of ["2026-11-18T09:00:00.000Z", "2026-11-18T09:00:00+00:00", "2026-11-18T09:00:00.001Z", "2026-11-19T07:00:00.123456+00:00"]) {
      expect(shownReadAt({ ...friends, last_read_at: read }, since), read).toBe(read);
    }
    // La date « depuis » écrite par la base (microsecondes) : la même règle.
    expect(shownReadAt({ ...friends, last_read_at: "2026-11-18T08:59:59.999Z" }, "2026-11-18T09:00:00.000431+00:00")).toBeNull();
    expect(shownReadAt({ ...friends, last_read_at: "2026-11-18T09:00:00.001Z" }, "2026-11-18T09:00:00.000431+00:00")).toBe("2026-11-18T09:00:00.001Z");
  });

  it("les deux bornes ensemble : ni avant « depuis », ni avant l'ouverture de la conversation, dans un ordre comme dans l'autre", () => {
    const early = "2026-11-10T10:00:00.000Z";
    const late = "2026-11-12T10:00:00.000Z";
    const between = "2026-11-11T10:00:00.000Z";
    const after = "2026-11-13T10:00:00.000Z";
    for (const [opened, since] of [
      [early, late],
      [late, early],
    ] as const) {
      const sideAt = (read: string) => ({ invitation: "none" as const, invitation_at: opened, last_read_at: read });
      expect(shownReadAt(sideAt("2026-11-09T10:00:00.000Z"), since)).toBeNull();
      expect(shownReadAt(sideAt(between), since)).toBeNull();
      expect(shownReadAt(sideAt(late), since)).toBe(late);
      expect(shownReadAt(sideAt(after), since)).toBe(after);
    }
  });

  it("un côté qui n'est pas ouvert, une date illisible, ou pas de date « depuis » : rien", () => {
    const read = "2026-11-10T12:00:00+00:00";
    for (const invitation of ["sent", "received", "declined"] as const) {
      expect(shownReadAt({ invitation, invitation_at: "2026-11-10T10:00:00+00:00", last_read_at: read }, SINCE)).toBeNull();
      expect(shownReadAt({ invitation, invitation_at: null, last_read_at: read }, SINCE)).toBeNull();
    }
    expect(shownReadAt({ invitation: "none", invitation_at: "illisible", last_read_at: read }, SINCE)).toBeNull();
    expect(shownReadAt({ invitation: "none", invitation_at: "2026-11-10T10:00:00+00:00", last_read_at: "illisible" }, SINCE)).toBeNull();
    expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: "illisible" }, SINCE)).toBeNull();
    // Sans date « depuis » lisible, aucune lecture n'est montrée : jamais « toutes » par défaut.
    for (const since of [null, undefined, "", "illisible"]) {
      expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: read }, since), String(since)).toBeNull();
      expect(shownReadAt({ invitation: "none", invitation_at: "2026-11-10T10:00:00+00:00", last_read_at: read }, since), String(since)).toBeNull();
    }
  });

  it("date « depuis » écrite quand le réglage est rallumé : maintenant, et toujours après la lecture la plus récente déjà enregistrée", () => {
    const now = Date.parse("2026-11-18T09:00:00.000Z");
    // Aucune lecture, ou des lectures plus anciennes : l'heure du serveur.
    expect(sinceStamp(null, now)).toBe("2026-11-18T09:00:00.000Z");
    expect(sinceStamp("2026-11-17T21:00:00.000Z", now)).toBe("2026-11-18T09:00:00.000Z");
    expect(sinceStamp("2026-11-18T08:59:59.999Z", now)).toBe("2026-11-18T09:00:00.000Z");
    expect(sinceStamp("2026-11-18T08:59:59.999999+00:00", now)).toBe("2026-11-18T09:00:00.000Z");
    // Une lecture datée de maintenant ou « du futur » (dernier message daté par la base, en avance) : une milliseconde après elle.
    expect(sinceStamp("2026-11-18T09:00:00.000Z", now)).toBe("2026-11-18T09:00:00.001Z");
    expect(sinceStamp("2026-11-18T09:00:00.250123+00:00", now)).toBe("2026-11-18T09:00:00.251Z");
    expect(sinceStamp("2026-11-18T09:00:02.999999+00:00", now)).toBe("2026-11-18T09:00:03.000Z");
    expect(sinceStamp("illisible", now)).toBe("2026-11-18T09:00:00.000Z");
    // Dans tous les cas, la lecture déjà faite n'est plus montrée, et une lecture datée de « depuis » ou d'après l'est.
    for (const latest of ["2026-11-17T21:00:00.000Z", "2026-11-18T08:59:59.999999+00:00", "2026-11-18T09:00:00.000Z", "2026-11-18T09:00:00.250123+00:00", "2026-11-18T09:00:02.999999+00:00"]) {
      const since = sinceStamp(latest, now);
      expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: latest }, since), latest).toBeNull();
      expect(shownReadAt({ invitation: "none", invitation_at: null, last_read_at: since }, since), latest).toBe(since);
      expect(Date.parse(since)).toBeGreaterThanOrEqual(now);
    }
  });

  it("réciproque dans le temps : la borne est la plus tardive des deux dates « depuis » ; l'une absente ou illisible : rien", () => {
    const early = "2026-11-18T09:00:00.000Z";
    const late = "2026-11-19T09:00:00.000431+00:00";
    expect(laterSince(early, late)).toBe(late);
    expect(laterSince(late, early)).toBe(late);
    expect(laterSince(early, early)).toBe(early);
    for (const missing of [null, undefined, "", "illisible"]) {
      expect(laterSince(missing, late), String(missing)).toBeNull();
      expect(laterSince(early, missing), String(missing)).toBeNull();
    }
    // Une lecture faite entre les deux dates (un seul réglage allumé) n'est jamais montrée.
    const friends = { invitation: "none" as const, invitation_at: null };
    expect(shownReadAt({ ...friends, last_read_at: "2026-11-18T15:00:00.000Z" }, laterSince(early, late))).toBeNull();
    expect(shownReadAt({ ...friends, last_read_at: "2026-11-19T15:00:00.000Z" }, laterSince(late, early))).toBe("2026-11-19T15:00:00.000Z");
  });

  it("ce que l'app reçoit : la date de SON dernier message si la lecture le couvre, jamais l'heure de la lecture", () => {
    const mine = "2026-11-18T09:00:00.250123+00:00";
    // Lu au même instant ou après : la date du message, telle quelle (l'app compare « pas antérieur »).
    for (const read of ["2026-11-18T09:00:00.250Z", "2026-11-18T09:00:00.250123+00:00", "2026-11-18T09:00:01.000Z", "2026-11-25T14:03:07.123Z"]) expect(seenStamp(read, mine), read).toBe(mine);
    // Lu avant ce message : « Envoyé ».
    for (const read of ["2026-11-18T09:00:00.249Z", "2026-11-17T21:00:00.000Z"]) expect(seenStamp(read, mine), read).toBeNull();
    // Aucune lecture à montrer, aucun message de la personne qui regarde, date illisible : rien.
    expect(seenStamp(null, mine)).toBeNull();
    for (const none of [null, undefined, "", "illisible"]) expect(seenStamp("2026-11-18T10:00:00.000Z", none), String(none)).toBeNull();
    expect(seenStamp("illisible", mine)).toBeNull();
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
  it("« Envoyé » tant que l'autre n'a pas ouvert la conversation, puis « Vu » (la date de son propre message) : lecture complète, relecture et envoi", async () => {
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
    // « Vu » : Alice reçoit la date de SON message, jamais l'heure à laquelle Bob l'a lu.
    expect(full.readReceipts).toEqual({ seenAt: first.message.createdAt });
    expect(JSON.stringify(full)).not.toContain(readAt);
    // La relecture de l'app (aucun nouveau message) la renvoie aussi.
    const poll = await thread(target, ALICE, id, first.message.createdAt);
    expect(poll.messages).toEqual([]);
    expect(poll.readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Le bouton « Message » d'un profil : la même conversation, la même réponse.
    expect((await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json().readReceipts).toEqual({ seenAt: first.message.createdAt });

    // Un nouveau message : pas encore lu, « Envoyé » (la lecture d'avant ne le couvre pas).
    later();
    const second = await send(target, ALICE, BOB, "Il te plaît ?");
    expect(second.readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id, second.message.createdAt)).readReceipts).toEqual({ seenAt: null });
    const reread = later();
    await open(target, BOB, id);
    const after = await thread(target, ALICE, id, second.message.createdAt);
    expect(after.readReceipts).toEqual({ seenAt: second.message.createdAt });
    expect(JSON.stringify(after)).not.toContain(reread);
  });

  it("rouvrir la conversation ne change rien à ce que l'autre reçoit : l'heure de chaque visite ne sort jamais du serveur", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Tu as vu ce sac ?");
    const id = first.conversationId;
    const visits = [later()];
    await open(target, BOB, id);
    const answers = async () => [await thread(target, ALICE, id), await thread(target, ALICE, id, first.message.createdAt), (await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()];
    const before = await answers();
    for (const read of before) expect(read.readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Bob revient deux jours plus tard, puis encore, sans répondre : sa lecture est datée dans la base (non-lus, export)…
    for (const wait of [48 * HOUR, 7 * MINUTE, 26 * HOUR]) {
      visits.push(later(wait));
      await open(target, BOB, id);
      expect(side(fake, BOB).last_read_at).toBe(visits.at(-1));
      // … et Alice reçoit exactement la même réponse qu'avant, mot pour mot.
      const now = await answers();
      expect(now).toEqual(before);
      for (const visit of visits) expect(JSON.stringify(now)).not.toContain(visit);
    }
    // L'envoi suivant ne dit rien de ces visites non plus.
    later();
    const second = await send(target, ALICE, BOB, "Alors ?");
    expect(second.readReceipts).toEqual({ seenAt: null });
    for (const visit of visits) expect(JSON.stringify(second)).not.toContain(visit);
  });

  it("le dernier message de la personne qui regarde, tel que SA conversation le montre : ni masqué par la modération, ni effacé de son côté ; aucun message d'elle : « Envoyé »", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    later();
    const second = await send(target, ALICE, BOB, "Tu es là ?");
    // Bob n'a rien écrit : rien n'est « Vu » pour lui, même si Alice a tout ouvert.
    later();
    await open(target, ALICE, id);
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: second.message.createdAt });
    // Le second message est masqué par la modération : l'app d'Alice ne le montre plus, « Vu » passe sous le premier.
    fake.table("messages").find((row) => row.id === second.message.id)!.hidden_at = new Date().toISOString();
    const read = await thread(target, ALICE, id);
    expect(read.messages.map((message) => message.id)).toEqual([first.message.id]);
    expect(read.readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Alice n'a plus aucun message à l'écran (tout est d'avant ce qu'elle a effacé) : « Envoyé », sans date.
    side(fake, ALICE).cleared_at = second.message.createdAt;
    const cleared = await thread(target, ALICE, id);
    expect(cleared.messages).toEqual([]);
    expect(cleared.readReceipts).toEqual({ seenAt: null });
  });

  it("l'horloge de la base avance sur celle du serveur : le message tout juste reçu, une fois lu, est bien « Vu »", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    // La fausse base date ses messages au moins une seconde après l'heure du serveur.
    expect(Date.parse(first.message.createdAt)).toBeGreaterThan(Date.now());
    await open(target, BOB, id);
    expect(Date.parse(String(side(fake, BOB).last_read_at))).toBeGreaterThanOrEqual(Date.parse(first.message.createdAt));
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
    // Un message envoyé ensuite n'est pas couvert par cette lecture.
    later();
    const second = await send(target, ALICE, BOB, "Encore moi");
    expect(second.readReceipts).toEqual({ seenAt: null });
  });

  it("dans les deux sens : chacun reçoit la lecture de l'autre, jamais la sienne", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    const bobRead = later();
    await open(target, BOB, id);
    later();
    const reply = await send(target, BOB, ALICE, "Bonjour Alice");
    // Alice n'a jamais marqué la conversation comme lue.
    expect(reply.readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
    const aliceRead = later();
    await open(target, ALICE, id);
    // Chacun reçoit la date de son propre message, jamais l'heure de la lecture de l'autre.
    const forBob = await thread(target, BOB, id);
    const forAlice = await thread(target, ALICE, id);
    expect(forBob.readReceipts).toEqual({ seenAt: reply.message.createdAt });
    expect(forAlice.readReceipts).toEqual({ seenAt: first.message.createdAt });
    for (const read of [forBob, forAlice]) for (const hidden of [bobRead, aliceRead]) expect(JSON.stringify(read)).not.toContain(hidden);
  });

  it("aucune conversation encore avec cette personne : rien", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const res = await as(target, ALICE).get(`/api/conversations/with/${BOB}`);
    expect(res.json()).toMatchObject({ id: null, state: "new", sendMode: "direct", readReceipts: null });
  });
});

describe("réglage « Confirmations de lecture » : allumé par défaut, réciproque", () => {
  it("dès que l'un des deux l'éteint, aucun des deux ne reçoit rien ; rallumé, aucune lecture d'avant ne revient, pour l'un comme pour l'autre", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    const bobRead = later();
    await open(target, BOB, id);
    const aliceRead = later();
    await open(target, ALICE, id);
    const other = (user: string) => (user === ALICE ? BOB : ALICE);
    const nothingForAnyone = async (off: string) => {
      for (const viewer of [ALICE, BOB]) {
        expect((await thread(target, viewer, id)).readReceipts, `${off} éteint, vu par ${viewer}`).toBeNull();
        expect((await thread(target, viewer, id, first.message.createdAt)).readReceipts).toBeNull();
        expect((await as(target, viewer).get(`/api/conversations/with/${other(viewer)}`)).json().readReceipts).toBeNull();
      }
      later();
      expect((await send(target, ALICE, BOB, "Encore un mot")).readReceipts).toBeNull();
      expect((await send(target, BOB, ALICE, "Réponse")).readReceipts).toBeNull();
      // Rien d'autre ne change : la conversation, ses messages, l'envoi.
      expect(await thread(target, ALICE, id)).toMatchObject({ state: "open", sendMode: "direct" });
    };

    // Avant : chacun voit « Vu » sous son dernier message… quand il en a écrit un (Bob n'a encore rien écrit).
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });

    // Alice éteint, puis rallume : réciproque, aucune lecture d'avant ne revient,
    // ni celles d'Alice pour Bob, ni celles de Bob pour Alice (« Envoyé »).
    await setReceipts(target, ALICE, false);
    await nothingForAnyone(ALICE);
    later();
    await open(target, BOB, id);
    later();
    await open(target, ALICE, id);
    later();
    await setReceipts(target, ALICE, true);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    expect(JSON.stringify(await thread(target, BOB, id))).not.toContain(aliceRead);

    // Bob éteint à son tour, puis rallume : ses lectures d'avant ne sont plus montrées non plus.
    await setReceipts(target, BOB, false);
    await nothingForAnyone(BOB);
    later();
    await setReceipts(target, BOB, true);
    for (const viewer of [ALICE, BOB]) {
      const read = await thread(target, viewer, id);
      expect(read.readReceipts, viewer).toEqual({ seenAt: null });
      for (const past of [bobRead, aliceRead]) expect(JSON.stringify(read)).not.toContain(past);
    }
    // Chacun rouvre la conversation, réglage allumé : ces lectures-là sont montrées.
    const bobAgain = later();
    await open(target, BOB, id);
    const aliceAgain = later();
    await open(target, ALICE, id);
    const forAlice = await thread(target, ALICE, id);
    const forBob = await thread(target, BOB, id);
    expect(forAlice.readReceipts).toEqual(seen(fake, ALICE));
    expect(forBob.readReceipts).toEqual(seen(fake, BOB));
    for (const read of [forAlice, forBob]) for (const hidden of [bobAgain, aliceAgain]) expect(JSON.stringify(read)).not.toContain(hidden);
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

  it("l'export des données contient le réglage, et la date depuis laquelle vos lectures peuvent être montrées", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    await setReceipts(target, ALICE, false);
    const turnedOn = later();
    await setReceipts(target, ALICE, true);
    const exported = (await as(target, ALICE).get("/api/me/export")).json();
    expect(exported.profile.read_receipts).toBe(true);
    expect(exported.profile.read_receipts_since).toBe(turnedOn);
    const page = (await as(target, ALICE).get("/api/me/export?format=html")).body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    expect(page).toContain("Confirmations de lecture Oui");
    // La date, sous son libellé (jamais sous le nom de la colonne, dans « Autres informations »).
    expect(page).toMatch(/Confirmations de lecture activées pour la dernière fois le \d{1,2}(er)? [a-zéû]+ 2031 à \d{2}:\d{2} /);
    expect(page).not.toContain("Autres informations read_receipts_since");
  });
});

describe("jamais une lecture du passé", () => {
  it("une lecture faite AVANT que « Vu » existe (avant la migration 0043) n'est jamais montrée, même réglage allumé par défaut", async () => {
    // La base n'a pas encore 0043 : Bob lit, sa lecture est datée comme depuis toujours.
    const options: FakeDbOptions = { missingColumns: { profiles: ["read_receipts", "read_receipts_since"] } };
    const fake = seeded({ follows: friends(ALICE, BOB), without0043: true }, options);
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Tu as vu ce sac ?");
    const id = first.conversationId;
    const before = later();
    await open(target, BOB, id);
    expect(side(fake, BOB)).toMatchObject({ unread: false, last_read_at: before });
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();

    // La migration passe : réglage allumé pour tous, « depuis » = ce moment-là.
    const migrated = later();
    options.missingColumns!.profiles = [];
    for (const row of fake.table("profiles")) Object.assign(row, { read_receipts: true, read_receipts_since: migrated });
    // La sonde du schéma est refaite au bout de 5 minutes.
    later(6 * MINUTE);
    expect((await as(target, BOB).get("/api/me")).json().readReceipts).toBe(true);
    for (const read of [await thread(target, ALICE, id), await thread(target, ALICE, id, first.message.createdAt), (await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()]) {
      // « Envoyé » : la lecture de la veille n'est pas montrée, ni sa date.
      expect(read.readReceipts).toEqual({ seenAt: null });
      expect(JSON.stringify(read)).not.toContain(before);
    }
    expect((await send(target, ALICE, BOB, "Alors ?")).readReceipts).toEqual({ seenAt: null });
    // La lecture d'avant est restée telle quelle dans la base (non-lus, export).
    expect(side(fake, BOB).last_read_at).toBe(before);
    // Bob rouvre la conversation, « Vu » existe désormais pour lui : montrée.
    const after = later();
    await open(target, BOB, id);
    const shown = await thread(target, ALICE, id);
    expect(shown.readReceipts).toEqual(seen(fake, ALICE));
    expect(JSON.stringify(shown)).not.toContain(after);
  });

  it("une lecture faite réglage ÉTEINT n'est jamais montrée, même une fois le réglage rallumé ; les non-lus, eux, ne changent pas", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Tu as vu ce sac ?");
    const id = first.conversationId;
    await setReceipts(target, BOB, false);
    expect((await as(target, BOB).get("/api/messages/status")).json()).toMatchObject({ enabled: true, unreadCount: 1 });
    // Bob lit, réglage éteint : la lecture est datée comme avant, le « non lu » disparaît.
    const whileOff = later();
    await open(target, BOB, id);
    expect(side(fake, BOB)).toMatchObject({ unread: false, last_read_at: whileOff });
    expect((await as(target, BOB).get("/api/messages/status")).json()).toMatchObject({ enabled: true, unreadCount: 0 });
    expect(profileRow(fake, BOB).read_receipts_since).toBe(SINCE);

    // Il rallume : « depuis » = ce moment-là.
    const turnedOn = later();
    await setReceipts(target, BOB, true);
    expect(profileRow(fake, BOB)).toMatchObject({ read_receipts: true, read_receipts_since: turnedOn, updated_at: turnedOn });
    for (const read of [await thread(target, ALICE, id), await thread(target, ALICE, id, first.message.createdAt), (await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()]) {
      expect(read.readReceipts).toEqual({ seenAt: null });
      expect(JSON.stringify(read)).not.toContain(whileOff);
    }
    expect((await send(target, ALICE, BOB, "Alors ?")).readReceipts).toEqual({ seenAt: null });
    expect(side(fake, BOB).last_read_at).toBe(whileOff);
    // Plus tard, toujours rien : le temps qui passe ne la fait pas apparaître.
    later(48 * HOUR);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    // Une lecture faite réglage allumé, elle, est montrée.
    const whileOn = later();
    await open(target, BOB, id);
    const shown = await thread(target, ALICE, id);
    expect(shown.readReceipts).toEqual(seen(fake, ALICE));
    expect(JSON.stringify(shown)).not.toContain(whileOn);
  });

  it("éteint, lu, rallumé aussitôt, horloge de la base en avance : la lecture datée « du futur » n'est pas montrée ; la lecture suivante l'est", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    await setReceipts(target, BOB, false);
    // La fausse base date ses messages au moins une seconde après l'heure du
    // serveur : la lecture de Bob est datée de ce message (readStamp), donc d'après « maintenant ».
    await open(target, BOB, id);
    const whileOff = String(side(fake, BOB).last_read_at);
    expect(Date.parse(whileOff)).toBeGreaterThan(Date.now());
    // Rallumé dans le même instant : « depuis » passe juste après cette lecture, jamais avant.
    await setReceipts(target, BOB, true);
    const since = String(profileRow(fake, BOB).read_receipts_since);
    expect(Date.parse(since)).toBe(Date.parse(whileOff) + 1);
    // (Cette lecture porte la date du message lui-même : seul `readReceipts` dit si elle est montrée.)
    expect(whileOff).toBe(first.message.createdAt);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    expect((await thread(target, ALICE, id, first.message.createdAt)).readReceipts).toEqual({ seenAt: null });
    // Un nouveau message, lu réglage allumé, toujours dans le même instant : « Vu ».
    const second = await send(target, ALICE, BOB, "Encore moi");
    await open(target, BOB, id);
    expect(Date.parse(String(side(fake, BOB).last_read_at))).toBeGreaterThanOrEqual(Date.parse(since));
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: second.message.createdAt });
  });

  it("une lecture faite juste après avoir rallumé (même milliseconde, horloges d'accord) est montrée ; celle de juste avant ne l'est pas", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    await setReceipts(target, BOB, false);
    const justBefore = later();
    await open(target, BOB, id);
    const turnedOn = later(1);
    await setReceipts(target, BOB, true);
    expect(profileRow(fake, BOB).read_receipts_since).toBe(turnedOn);
    expect(Date.parse(turnedOn) - Date.parse(justBefore)).toBe(1);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    // Même milliseconde que « depuis » : montrée.
    await open(target, BOB, id);
    expect(side(fake, BOB).last_read_at).toBe(turnedOn);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
  });

  it("allumer un réglage déjà allumé ne déplace rien : ni « depuis », ni ce qui est montré", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    later();
    await open(target, BOB, id);
    const before = { ...profileRow(fake, BOB) };
    for (let again = 0; again < 2; again += 1) {
      later();
      await setReceipts(target, BOB, true);
      expect(profileRow(fake, BOB)).toEqual(before);
      expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
    }
    // Éteindre ne déplace pas « depuis » non plus : seul le passage d'éteint à allumé l'écrit.
    later();
    await setReceipts(target, BOB, false);
    expect(profileRow(fake, BOB)).toMatchObject({ read_receipts: false, read_receipts_since: SINCE });
    later();
    await setReceipts(target, BOB, false);
    expect(profileRow(fake, BOB)).toMatchObject({ read_receipts: false, read_receipts_since: SINCE });
  });

  it("deux demandes « allumer » en même temps : une seule écrit la date (écriture conditionnelle, jamais lu puis écrit)", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    await setReceipts(target, BOB, false);
    later();
    await open(target, BOB, id);
    // Une autre demande de Bob passe juste avant l'écriture de celle-ci : le réglage est déjà rallumé, avec sa date.
    const winner = later();
    const original = fake.db.from;
    let raced = 0;
    const conditions: [string, unknown][] = [];
    fake.db.from = ((name: string) => {
      const chain = original(name);
      if (name !== "profiles") return chain;
      const update = chain.update;
      const eq = chain.eq;
      chain.update = (values: Row) => {
        if (values.read_receipts === true) {
          raced += 1;
          Object.assign(profileRow(fake, BOB), { read_receipts: true, read_receipts_since: winner, updated_at: winner });
          chain.eq = (column: string, value: unknown) => {
            conditions.push([column, value]);
            return eq(column, value);
          };
        }
        return update(values);
      };
      return chain;
    }) as typeof original;
    later();
    await setReceipts(target, BOB, true);
    fake.db.from = original;
    expect(raced).toBe(1);
    // La seconde écriture n'a rien trouvé à écrire : la date de la première reste.
    expect(profileRow(fake, BOB)).toMatchObject({ read_receipts: true, read_receipts_since: winner, updated_at: winner });
    // La condition « était éteint » fait partie de l'écriture elle-même.
    expect(conditions).toEqual([
      ["id", BOB],
      ["read_receipts", false],
    ]);
  });

  it("réciproque dans le temps : rallumer son réglage ne fait jamais apparaître ce que l'autre a lu pendant qu'il était éteint", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) });
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    const id = first.conversationId;
    // Alice éteint ; Bob, réglage allumé, lit pendant ce temps (on lui dit « aucun des deux ne voit rien ») ; Alice rallume.
    await setReceipts(target, ALICE, false);
    const bobRead = later();
    await open(target, BOB, id);
    later();
    await setReceipts(target, ALICE, true);
    expect(Date.parse(String(profileRow(fake, ALICE).read_receipts_since))).toBeGreaterThan(Date.parse(bobRead));
    expect(profileRow(fake, BOB).read_receipts_since).toBe(SINCE);
    // La lecture de Bob date d'avant le « depuis » d'Alice : elle ne la voit pas, ni tout de suite, ni plus tard, ni à l'envoi.
    for (const read of [await thread(target, ALICE, id), await thread(target, ALICE, id, first.message.createdAt), (await as(target, ALICE).get(`/api/conversations/with/${BOB}`)).json()]) {
      expect(read.readReceipts).toEqual({ seenAt: null });
      expect(JSON.stringify(read)).not.toContain(bobRead);
    }
    later(48 * HOUR);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    // Éteindre et rallumer encore n'y change rien.
    await setReceipts(target, ALICE, false);
    later();
    await setReceipts(target, ALICE, true);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: null });
    // Une lecture faite pendant que les DEUX réglages sont allumés, elle, est montrée.
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });

    // « Depuis » de l'un ou de l'autre dans le futur (horloge), absent ou illisible (ligne abîmée) : rien, jamais « tout ».
    for (const user of [BOB, ALICE]) {
      const kept = profileRow(fake, user).read_receipts_since;
      for (const broken of [new Date(Date.now() + HOUR).toISOString(), null, "illisible"]) {
        profileRow(fake, user).read_receipts_since = broken;
        expect((await thread(target, ALICE, id)).readReceipts, `${user} ${String(broken)}`).toEqual({ seenAt: null });
      }
      delete profileRow(fake, user).read_receipts_since;
      expect((await thread(target, ALICE, id)).readReceipts, user).toEqual({ seenAt: null });
      profileRow(fake, user).read_receipts_since = kept;
      expect((await thread(target, ALICE, id)).readReceipts, user).toEqual({ seenAt: first.message.createdAt });
    }
  });

  it("invitation acceptée réglage éteint, puis réglage rallumé : ni la lecture de l'invitation, ni celle de l'acceptation ne sont montrées", async () => {
    const fake = seeded();
    const target = await messagesApp(fake.db);
    const id = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    await setReceipts(target, BOB, false);
    const looked = later();
    await open(target, BOB, id);
    const accepted = later();
    expect((await as(target, BOB).post(`/api/conversations/${id}/accept`)).statusCode).toBe(204);
    expect(side(fake, BOB)).toMatchObject({ invitation: "none", last_read_at: accepted });
    later();
    await setReceipts(target, BOB, true);
    const read = await thread(target, ALICE, id);
    expect(read).toMatchObject({ state: "open", readReceipts: { seenAt: null } });
    for (const past of [looked, accepted]) expect(JSON.stringify(read)).not.toContain(past);
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
  });

  it("rallumer : la lecture la plus récente du membre, toutes conversations confondues, borne la date ; illisible ou en panne, rien n'est écrit", async () => {
    const fake = seeded({ follows: [...friends(ALICE, BOB), ...friends(BOB, CHLOE)] });
    const target = await messagesApp(fake.db);
    const withAlice = (await send(target, ALICE, BOB, "Bonjour")).conversationId;
    const withChloe = (await send(target, CHLOE, BOB, "Coucou")).conversationId;
    await setReceipts(target, BOB, false);
    later();
    await open(target, BOB, withAlice);
    // La conversation avec Chloé, lue réglage éteint, est datée « du futur » (base en avance).
    later();
    await send(target, CHLOE, BOB, "Tu es là ?");
    await open(target, BOB, withChloe);
    const latest = String(fake.table("conversation_participants").find((row) => row.user_id === BOB && row.conversation_id === withChloe)!.last_read_at);
    expect(Date.parse(latest)).toBeGreaterThan(Date.now());

    // La lecture de la base échoue : 500, le réglage reste éteint, la date ne bouge pas.
    const original = fake.db.from;
    fake.db.from = ((name: string) => (name === "conversation_participants" ? fakeSupabase({ missing: ["conversation_participants"] }).db.from(name) : original(name))) as typeof original;
    // (La sonde des messages est déjà mémorisée : seule la lecture des dates échoue.)
    const failed = await as(target, BOB).put("/api/me/read-receipts", { readReceipts: true });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: "internal_error", message: "Une erreur est survenue." });
    expect(profileRow(fake, BOB)).toMatchObject({ read_receipts: false, read_receipts_since: SINCE });
    fake.db.from = original;

    await setReceipts(target, BOB, true);
    expect(Date.parse(String(profileRow(fake, BOB).read_receipts_since))).toBe(Date.parse(latest) + 1);
    for (const [viewer, conversation] of [
      [ALICE, withAlice],
      [CHLOE, withChloe],
    ] as const) {
      expect((await thread(target, viewer, conversation)).readReceipts, viewer).toEqual({ seenAt: null });
    }
    // Le réglage d'un autre membre et sa date n'ont pas bougé.
    expect(profileRow(fake, ALICE)).toMatchObject({ read_receipts: true, read_receipts_since: SINCE });
  });

  it("saveReadReceipts : ce qui est écrit, et à quelle condition", async () => {
    const fake = seeded();
    const now = () => Date.parse("2031-06-01T12:00:00.000Z");
    const server = { supabaseAdmin: fake.db } as unknown as FastifyInstance;
    // Déjà allumé : rien n'est écrit.
    expect(await saveReadReceipts(server, ALICE, true, now)).toBeNull();
    expect(profileRow(fake, ALICE)).toEqual(profile(ALICE, "alice"));
    // Éteindre : le réglage et la date de modification du profil, jamais « depuis ».
    expect(await saveReadReceipts(server, ALICE, false, now)).toBeNull();
    expect(profileRow(fake, ALICE)).toEqual({ ...profile(ALICE, "alice", false), updated_at: "2031-06-01T12:00:00.000Z" });
    // Rallumer : le réglage et « depuis », ensemble.
    const later2 = () => Date.parse("2031-06-02T12:00:00.000Z");
    expect(await saveReadReceipts(server, ALICE, true, later2)).toBeNull();
    expect(profileRow(fake, ALICE)).toEqual({ ...profile(ALICE, "alice"), read_receipts_since: "2031-06-02T12:00:00.000Z", updated_at: "2031-06-02T12:00:00.000Z" });
    // Les autres profils n'ont pas bougé.
    expect(profileRow(fake, BOB)).toEqual(profile(BOB, "bob"));
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
    const shown = await thread(target, ALICE, id);
    expect(shown).toMatchObject({ state: "open", sendMode: "direct", readReceipts: seen(fake, ALICE) });
    for (const hidden of [looked, accepted]) expect(JSON.stringify(shown)).not.toContain(hidden);
    // Alice a ouvert sa propre invitation avant l'acceptation : Bob n'en sait rien non plus.
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: null });
    // Ensuite, comme toute conversation ouverte.
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
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
    const shown = await thread(target, ALICE, id);
    expect(shown.readReceipts).toEqual(seen(fake, ALICE));
    expect(JSON.stringify(shown)).not.toContain(looked);
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
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
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
    const shown = await thread(target, ALICE, id);
    expect(shown.readReceipts).toEqual({ seenAt: null });
    expect(JSON.stringify(shown)).not.toContain(looked);
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
    expect(side(fake, BOB).last_read_at).toBe(wrote);
    const shown = await thread(target, ALICE, id);
    expect(shown.readReceipts).toEqual(seen(fake, ALICE));
    expect(JSON.stringify(shown)).not.toContain(looked);
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
      expect((await thread(target, ALICE, id)).readReceipts).toEqual({ seenAt: first.message.createdAt });
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
    later();
    const reply = await send(target, BOB, ALICE, "Bonjour Alice");
    later();
    await open(target, ALICE, id);
    fake.table("suspensions").push({ user_id: BOB, moderation_action_id: UNKNOWN });
    // Un compte suspendu lit toujours ses conversations (et les marque comme lues).
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();
    expect((await thread(target, ALICE, id, first.message.createdAt)).readReceipts).toBeNull();
    expect((await send(target, ALICE, BOB, "Toujours là ?")).readReceipts).toBeNull();
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toBeNull();
    expect((await thread(target, BOB, id)).readReceipts).toEqual({ seenAt: reply.message.createdAt });
    // Suspension levée : tout revient.
    fake.table("suspensions").length = 0;
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
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
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
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
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(fake, ALICE));
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
    expect(fake.table("profiles").find((row) => row.id === ALICE)).not.toHaveProperty("read_receipts_since");
    expect(EN_MESSAGES["Les confirmations de lecture ne sont pas encore disponibles."]).toBe("Read receipts aren't available yet.");
    // Les autres réglages restent là.
    expect((await as(target, ALICE).put("/api/me/messages-from", { messagesFrom: "nobody" })).statusCode).toBe(204);
  });

  it("base qui n'aurait que le réglage, sans la date « depuis » : comme sans 0043, rien n'est montré ni proposé, rien n'est écrit", async () => {
    const fake = seeded({ follows: friends(ALICE, BOB) }, { missingColumns: { profiles: ["read_receipts_since"] } });
    for (const row of fake.table("profiles")) delete row.read_receipts_since;
    const target = await messagesApp(fake.db);
    const first = await send(target, ALICE, BOB, "Bonjour");
    expect(first).toMatchObject({ state: "open", readReceipts: null });
    later(MINUTE);
    await open(target, BOB, first.conversationId);
    expect((await thread(target, ALICE, first.conversationId)).readReceipts).toBeNull();
    expect((await as(target, ALICE).get("/api/me")).json()).not.toHaveProperty("readReceipts");
    for (const value of [false, true]) expect((await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: value })).statusCode).toBe(404);
    expect(profileRow(fake, ALICE).read_receipts).toBe(true);
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
    // Les deux colonnes de la migration 0043, et rien d'autre.
    expect(asked).toEqual(["profiles.read_receipts, read_receipts_since"]);
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
    later();
    await open(target, BOB, id);
    expect((await thread(target, ALICE, id)).readReceipts).toEqual(seen(present, ALICE));
    // Les colonnes disparaissent : la même base, lue comme une base sans 0043.
    const original = present.db.from;
    const gone = fakeSupabase(WITHOUT_0043);
    for (const [name, rows] of present.tables) gone.tables.set(name, rows);
    for (const row of present.table("profiles")) {
      delete row.read_receipts;
      delete row.read_receipts_since;
    }
    present.db.from = gone.db.from as typeof original;
    const read = await thread(target, ALICE, id);
    expect(read.readReceipts).toBeNull();
    expect(read.messages.map((message) => message.text)).toEqual(["Bonjour"]);
    expect((await as(target, ALICE).get("/api/me")).json()).not.toHaveProperty("readReceipts");
    expect((await as(target, ALICE).put("/api/me/read-receipts", { readReceipts: false })).statusCode).toBe(404);
  });
});
