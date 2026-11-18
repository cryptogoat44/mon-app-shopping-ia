import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMENT_LIKE_LIMIT_ERROR,
  COMMENT_THREADS_UNAVAILABLE_ERROR,
  DEFAULT_MENTIONS_FROM,
  LEGACY_NOTIFICATION_TYPES,
  MENTIONS_FROM,
  MENTION_MAX_PER_TEXT,
  extractMentions,
  findMentions,
  type AppNotification,
  type CommentsPage,
  type LikeCommentResponse,
  type MentionsFrom,
  type Post,
  type PostComment,
  type PrivacyLevel,
  type Profile,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import commentsRoutes from "../src/routes/comments.js";
import notificationsRoutes from "../src/routes/notifications.js";
import blocksRoutes from "../src/routes/blocks.js";
import meRoutes from "../src/routes/me.js";
import accountRoutes from "../src/routes/account.js";
import { readViewersAudience, resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { commentThreadsReady, resetCommentThreadsProbe } from "../src/lib/comments.js";
import { mayMention, resolveMentions } from "../src/lib/mentions.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { DatabaseReadError } from "../src/lib/validation.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Commentaires : réponses, « j'aime », mentions (lot « vie sociale »,
// migration 0046), SANS base ni réseau : les vraies routes sur une fausse
// base en mémoire (tests/fakeSupabase.ts). Chaque règle de visibilité de la
// fiche a son cas « refusé » ET son cas « permis ». Le même parcours sur la
// vraie base de développement : commentairesBase.test.ts (Mac, 0046 appliquée).

// Bruno a un compte public : c'est sous SES publications qu'on commente.
// Paula a un compte PRIVÉ. Anna est une inconnue. Dora suit Bruno. Carl, Eve,
// Fred et Gina servent aux blocages, aux suspensions et aux mentions.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const FRED = "f0000000-0000-4000-8000-000000000006";
const PAULA = "70000000-0000-4000-8000-000000000007";
const GINA = "80000000-0000-4000-8000-000000000008";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const BRUNO_PUBLIC = "b1000000-0000-4000-8000-000000000001";
const BRUNO_FOLLOWERS = "b1000000-0000-4000-8000-000000000002";
const BRUNO_PRIVATE = "b1000000-0000-4000-8000-000000000003";
const BRUNO_HIDDEN = "b1000000-0000-4000-8000-000000000004";
const BRUNO_OTHER = "b1000000-0000-4000-8000-000000000005";
const PAULA_PUBLIC = "71000000-0000-4000-8000-000000000001";

// Commentaires semés : C1 (Carl) et ses réponses R1 (Dora), R2 (Eve) ; C2 (Dora).
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c1000000-0000-4000-8000-000000000002";
const R1 = "c1000000-0000-4000-8000-0000000000a1";
const R2 = "c1000000-0000-4000-8000-0000000000a2";

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };
const COMMENT_NOT_FOUND = { error: "comment_not_found", message: "Commentaire introuvable." };
const UNAVAILABLE = { error: COMMENT_THREADS_UNAVAILABLE_ERROR, message: "Les réponses et les mentions ne sont pas encore disponibles." };

function profile(id: string, username: string | null, options: { isPrivate?: boolean; mentionsFrom?: MentionsFrom } = {}): Row {
  return {
    id,
    username,
    display_name: username ? username[0]!.toUpperCase() + username.slice(1) : "Sans nom",
    avatar_url: null,
    bio: null,
    locale: "fr",
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
    caption: `Publication ${privacy}`,
    media_url: null,
    media_thumb_url: null,
    media_removed_at: null,
    privacy,
    hidden_at: hidden ? "2026-11-12T00:00:00+00:00" : null,
    created_at: "2026-11-01T10:00:00+00:00",
  };
}

/** Date du n-ième commentaire (le plus grand est le plus récent). */
const at = (index: number) => new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString();

function comment(id: string, postId: string, userId: string, body: string, minute: number, extra: { parent?: string; hidden?: boolean } = {}): Row {
  return { id, post_id: postId, user_id: userId, body, parent_id: extra.parent ?? null, hidden_at: extra.hidden ? "2026-11-12T00:00:00+00:00" : null, created_at: at(minute) };
}

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  /** Réglage « Qui peut me mentionner » par compte (sinon « tout le monde », pour que les mentions passent). */
  mentionsFrom?: Record<string, MentionsFrom>;
  /** Sans le fil semé (C1, R1, R2, C2). */
  empty?: boolean;
  /** [qui aime, commentaire]. */
  likes?: [string, string][];
  /** [commentaire, auteur, mentionné, pseudo]. */
  mentions?: [string, string, string, string][];
  /** [qui signale, commentaire]. */
  reports?: [string, string][];
  hiddenComments?: string[];
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const absentProfileColumns = options.missingColumns?.profiles ?? [];
  const withThreads = !(options.missingColumns?.comments ?? []).includes("parent_id");
  const setting = (id: string) => ({ mentionsFrom: seed.mentionsFrom?.[id] });
  const rows = [
    profile(ANNA, "anna", setting(ANNA)),
    profile(BRUNO, "bruno", setting(BRUNO)),
    profile(CARL, "carl", setting(CARL)),
    profile(DORA, "dora", setting(DORA)),
    profile(EVE, "eve", setting(EVE)),
    profile(FRED, "fred", setting(FRED)),
    profile(PAULA, "paula", { ...setting(PAULA), isPrivate: true }),
    profile(GINA, "gina", setting(GINA)),
  ];
  for (const row of rows) for (const column of absentProfileColumns) delete row[column];
  fake.table("profiles").push(...rows);
  fake.table("posts").push(
    post(BRUNO_PUBLIC, BRUNO, "public"),
    post(BRUNO_FOLLOWERS, BRUNO, "followers"),
    post(BRUNO_PRIVATE, BRUNO, "private"),
    post(BRUNO_HIDDEN, BRUNO, "public", true),
    post(BRUNO_OTHER, BRUNO, "public"),
    post(PAULA_PUBLIC, PAULA, "public")
  );
  if (!seed.empty) {
    const hidden = (id: string) => ({ hidden: seed.hiddenComments?.includes(id) ?? false });
    const thread = [
      comment(C1, BRUNO_PUBLIC, CARL, "Très beau manteau", 1, hidden(C1)),
      comment(R1, BRUNO_PUBLIC, DORA, "Je confirme", 2, { parent: C1, ...hidden(R1) }),
      comment(C2, BRUNO_PUBLIC, DORA, "Où l'avez-vous trouvé ?", 3, hidden(C2)),
      comment(R2, BRUNO_PUBLIC, EVE, "Moi aussi je le veux", 4, { parent: C1, ...hidden(R2) }),
    ];
    // Base sans 0046 : la colonne des réponses n'existe pas, tout est à plat.
    for (const row of thread) if (!withThreads) delete row.parent_id;
    fake.table("comments").push(...thread);
  }
  for (const [user, commentId] of seed.likes ?? []) fake.table("comment_reactions").push({ comment_id: commentId, user_id: user, created_at: at(30) });
  for (const [commentId, author, user, handle] of seed.mentions ?? []) fake.table("comment_mentions").push({ comment_id: commentId, author_id: author, user_id: user, handle, created_at: at(31) });
  for (const [reporter, commentId] of seed.reports ?? []) fake.table("reports").push({ reporter_id: reporter, target_type: "comment", target_id: commentId, reason: "spam" });
  for (const [follower, followee] of seed.follows ?? [[DORA, BRUNO]]) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  return fake;
}

/** Base sans la migration 0046 : ni la colonne des réponses, ni les deux tables, ni le réglage. */
const WITHOUT_0046: FakeDbOptions = { missing: ["comment_reactions", "comment_mentions"], missingColumns: { comments: ["parent_id"], profiles: ["mentions_from"] } };

let app: FastifyInstance | null = null;
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête. */
async function commentsApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  limitNames = new Map();
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
  app.addHook("onRoute", (route) => {
    limitNames.set(`${String(route.method)} ${route.url}`, route.config?.rateLimitName);
  });
  await app.register(postsRoutes);
  await app.register(commentsRoutes);
  await app.register(notificationsRoutes);
  await app.register(blocksRoutes);
  await app.register(meRoutes);
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
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
  };
}

type Fake = ReturnType<typeof fakeSupabase>;
const commentsUrl = (postId: string) => `/api/posts/${postId}/comments`;
/** Les commentaires d'origine, tels qu'une app récente les reçoit. */
async function thread(target: FastifyInstance, viewer: string, postId = BRUNO_PUBLIC): Promise<PostComment[]> {
  const response = await as(target, viewer).get(`${commentsUrl(postId)}?v=2`);
  expect(response.statusCode).toBe(200);
  return (response.json() as CommentsPage).comments;
}
/** La liste à plat d'une app d'avant le lot. */
async function flat(target: FastifyInstance, viewer: string, postId = BRUNO_PUBLIC): Promise<PostComment[]> {
  const response = await as(target, viewer).get(commentsUrl(postId));
  expect(response.statusCode).toBe(200);
  return (response.json() as CommentsPage).comments;
}
async function replies(target: FastifyInstance, viewer: string, commentId: string): Promise<PostComment[]> {
  const response = await as(target, viewer).get(`/api/comments/${commentId}/replies`);
  expect(response.statusCode).toBe(200);
  return (response.json() as CommentsPage).comments;
}
const idsOf = (comments: PostComment[]) => comments.map((item) => item.id);
const byId = (comments: PostComment[], id: string) => comments.find((item) => item.id === id)!;
const mentionRows = (fake: Fake) => fake.table("comment_mentions").map((row) => `${String(row.author_id)}>${String(row.user_id)}:${String(row.handle)}`);
const noticesOf = (fake: Fake, type: string) => fake.table("notifications").filter((row) => row.type === type);
const noticePairs = (fake: Fake, type: string) => noticesOf(fake, type).map((row) => `${String(row.actor_id)}>${String(row.user_id)}`);
async function comments(target: FastifyInstance, author: string, body: string, options: { postId?: string; parentId?: string } = {}) {
  return as(target, author).post(commentsUrl(options.postId ?? BRUNO_PUBLIC), { body, ...(options.parentId ? { parentId: options.parentId } : {}) });
}
async function postSeenBy(target: FastifyInstance, viewer: string, postId: string): Promise<Post> {
  const response = await as(target, viewer).get(`/api/posts/${postId}`);
  expect(response.statusCode).toBe(200);
  return response.json();
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetPrivateAccountsProbe();
  resetCommentThreadsProbe();
});

afterEach(async () => {
  vi.useRealTimers();
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("extractMentions : les « @pseudo » d'un texte", () => {
  it("minuscules, sans doublon, dans l'ordre d'écriture", () => {
    expect(extractMentions("Bravo @Anna et @BRUNO, merci @anna !")).toEqual(["anna", "bruno"]);
    expect(extractMentions("@carl")).toEqual(["carl"]);
    expect(extractMentions("(@dora) « @eve_2 » @fred.")).toEqual(["dora", "eve_2", "fred"]);
    expect(extractMentions("ligne\n@gina\t@anna")).toEqual(["gina", "anna"]);
  });

  it("refusé : une adresse e-mail, un « @ » collé à un mot, un pseudo trop court ou trop long", () => {
    expect(extractMentions("écrivez à anna@example.com ou bruno.b@carl.fr")).toEqual([]);
    expect(extractMentions("mot@dora et point.@eve et a_@fred et @@gina")).toEqual([]);
    expect(extractMentions("@ab et @")).toEqual([]);
    // 21 caractères : ce n'est pas le pseudo de 20 caractères suivi d'une lettre.
    expect(extractMentions(`@${"a".repeat(21)}`)).toEqual([]);
    expect(extractMentions(`@${"a".repeat(20)}`)).toEqual(["a".repeat(20)]);
    expect(extractMentions("@anna-b @carl'")).toEqual(["anna", "carl"]);
    expect(extractMentions("@éric @anne-élise")).toEqual(["anne"]);
  });

  it(`au plus ${MENTION_MAX_PER_TEXT} : la sixième reste un simple texte`, () => {
    expect(MENTION_MAX_PER_TEXT).toBe(5);
    expect(extractMentions("@aaa @bbb @ccc @ddd @eee @fff @ggg")).toEqual(["aaa", "bbb", "ccc", "ddd", "eee"]);
    // Un doublon ne prend pas de place.
    expect(extractMentions("@aaa @aaa @bbb @ccc @ddd @eee @fff")).toEqual(["aaa", "bbb", "ccc", "ddd", "eee"]);
  });

  it("findMentions donne la place de chaque « @pseudo » (pour en faire un lien)", () => {
    const text = "Vu @Anna, et @bruno.";
    expect(findMentions(text).map((span) => [span.handle, text.slice(span.start, span.end)])).toEqual([
      ["anna", "@Anna"],
      ["bruno", "@bruno"],
    ]);
    // Un « @ » collé à la fin d'un pseudo n'ouvre pas une seconde mention.
    expect(findMentions("@anna@bruno").map((span) => span.handle)).toEqual(["anna"]);
    expect(findMentions("@anna")).toEqual([{ handle: "anna", start: 0, end: 5 }]);
  });
});

describe("mayMention : le réglage « Qui peut me mentionner »", () => {
  it("la table complète", () => {
    const table: [MentionsFrom, boolean, boolean][] = [
      ["everyone", true, true],
      ["everyone", false, true],
      ["following", true, true],
      ["following", false, false],
      ["nobody", true, false],
      ["nobody", false, false],
    ];
    for (const [setting, targetFollowsAuthor, allowed] of table) expect(mayMention(setting, targetFollowsAuthor), `${setting} / ${String(targetFollowsAuthor)}`).toBe(allowed);
    expect([...MENTIONS_FROM].sort()).toEqual(["everyone", "following", "nobody"]);
  });

  it("valeur de départ : « les comptes que je suis », pour un nouveau profil comme pour un profil sans valeur lisible", async () => {
    expect(DEFAULT_MENTIONS_FROM).toBe("following");
    const fake = seeded({ empty: true });
    // Un profil tout neuf : la base n'a encore rien de particulier pour lui.
    const NEW = randomUUID();
    fake.table("profiles").push({ ...profile(NEW, "nouveau"), mentions_from: null });
    const target = await commentsApp(fake.db);
    // Anna ne suit pas ce compte, et ce compte ne suit pas Anna : pas de mention.
    expect((await comments(target, ANNA, "Bonjour @nouveau")).statusCode).toBe(200);
    expect(mentionRows(fake)).toEqual([]);
    // Dès que ce compte suit Anna, elle peut le mentionner.
    fake.table("follows").push({ follower_id: NEW, followee_id: ANNA });
    expect((await comments(target, ANNA, "Rebonjour @nouveau")).statusCode).toBe(200);
    expect(mentionRows(fake)).toEqual([`${ANNA}>${NEW}:nouveau`]);
  });
});

describe("sonde de la migration 0046", () => {
  it("présente : mémorisée ; absente : faux, puis refaite au bout de cinq minutes seulement", async () => {
    const ready = seeded();
    const target = await commentsApp(ready.db);
    expect(await commentThreadsReady(target)).toBe(true);

    resetCommentThreadsProbe();
    let clock = 1_000_000;
    const absences: FakeDbOptions[] = [{ missingColumns: { comments: ["parent_id"] } }, { missing: ["comment_reactions"] }, { missing: ["comment_mentions"] }, { missingColumns: { profiles: ["mentions_from"] } }, { missingColumns: { comment_mentions: ["author_id"] } }];
    for (const options of absences) {
      resetCommentThreadsProbe();
      const absent = fakeSupabase(options);
      let probes = 0;
      const counting = { supabaseAdmin: { from: (name: string) => (probes++, (absent.db as { from: (table: string) => unknown }).from(name)) }, log: target.log } as unknown as FastifyInstance;
      expect(await commentThreadsReady(counting, () => clock), JSON.stringify(options)).toBe(false);
      const after = probes;
      expect(await commentThreadsReady(counting, () => clock + 4 * 60_000)).toBe(false);
      expect(probes).toBe(after);
      expect(await commentThreadsReady(counting, () => clock + 6 * 60_000)).toBe(false);
      expect(probes).toBeGreaterThan(after);
      clock += 60 * 60_000;
    }
  });

  it("base illisible : une erreur, jamais « à plat par défaut » (une réponse à un commentaire masqué réapparaîtrait)", async () => {
    const fake = seeded();
    const broken = Promise.resolve({ data: null, error: { code: "57014", message: "délai dépassé" } });
    const real = fake.db as { from: (name: string) => unknown };
    const db = { ...real, from: (name: string) => (name === "comment_reactions" ? { select: () => ({ limit: () => broken }) } : real.from(name)) };
    const target = await commentsApp(db);
    await expect(commentThreadsReady(target)).rejects.toBeInstanceOf(DatabaseReadError);
    expect((await as(target, ANNA).get(commentsUrl(BRUNO_PUBLIC))).statusCode).toBe(500);
    // Publier ne réussit pas non plus : rien n'est écrit.
    expect((await comments(target, ANNA, "Bonjour")).statusCode).toBe(500);
    expect(fake.table("comments")).toHaveLength(4);
    // Le profil, lui, reste lisible, sans le réglage.
    const me = await as(target, ANNA).get("/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).not.toHaveProperty("mentionsFrom");
  });
});

describe("règle 1 : tout commence par « peut-il voir la publication ? »", () => {
  const cases: [string, string, string][] = [
    ["publication inconnue", ANNA, UNKNOWN],
    ["masquée par la modération, même pour un abonné", DORA, BRUNO_HIDDEN],
    ["bloqué par l'auteur", CARL, BRUNO_FOLLOWERS],
    ["a bloqué l'auteur", EVE, BRUNO_FOLLOWERS],
    ["réservée aux abonnés, lue par une inconnue", ANNA, BRUNO_FOLLOWERS],
    ["privée, lue par un abonné", DORA, BRUNO_PRIVATE],
    ["compte privé, lue par une inconnue", ANNA, PAULA_PUBLIC],
  ];

  it("refusé : 404 pour lire les commentaires, lire les réponses, aimer, commenter et répondre — la même réponse qu'une publication inconnue", async () => {
    const fake = seeded({ follows: [[DORA, BRUNO], [FRED, PAULA], [CARL, BRUNO], [EVE, BRUNO]], blocks: [[BRUNO, CARL], [EVE, BRUNO]] });
    // Un commentaire et sa réponse sous chaque publication fermée (écrits par des comptes qui, eux, la voient).
    const secret: Record<string, string> = {};
    for (const [index, postId] of [BRUNO_FOLLOWERS, BRUNO_PRIVATE, BRUNO_HIDDEN, PAULA_PUBLIC].entries()) {
      const id = randomUUID();
      secret[postId] = id;
      fake.table("comments").push(comment(id, postId, postId === PAULA_PUBLIC ? FRED : BRUNO, "Commentaire réservé", 10 + index));
      fake.table("comments").push(comment(randomUUID(), postId, postId === PAULA_PUBLIC ? FRED : BRUNO, "Réponse réservée", 20 + index, { parent: id }));
    }
    const target = await commentsApp(fake.db);
    const before = fake.table("comments").length;

    for (const [label, viewer, postId] of cases) {
      const commentId = secret[postId] ?? UNKNOWN;
      for (const url of [commentsUrl(postId), `${commentsUrl(postId)}?v=2`]) {
        const response = await as(target, viewer).get(url);
        expect(response.statusCode, `${label} : ${url}`).toBe(404);
        expect(response.json(), label).toEqual(POST_NOT_FOUND);
        expect(response.body, label).not.toContain("réservé");
      }
      const repliesResponse = await as(target, viewer).get(`/api/comments/${commentId}/replies`);
      expect(repliesResponse.statusCode, `${label} : réponses`).toBe(404);
      expect(repliesResponse.json(), label).toEqual(COMMENT_NOT_FOUND);
      expect(repliesResponse.body, label).not.toContain("réservé");
      const like = await as(target, viewer).put(`/api/comments/${commentId}/like`, { liked: true });
      expect(like.statusCode, `${label} : j'aime`).toBe(404);
      expect(like.json(), label).toEqual(COMMENT_NOT_FOUND);
      expect((await comments(target, viewer, "Je passe quand même", { postId })).json(), `${label} : commenter`).toEqual(POST_NOT_FOUND);
      expect((await comments(target, viewer, "Je réponds quand même", { postId, parentId: commentId })).statusCode, `${label} : répondre`).toBe(404);
    }
    expect(fake.table("comments")).toHaveLength(before);
    expect(fake.table("comment_reactions")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
  });

  it("permis : qui voit la publication lit ses commentaires et leurs réponses, aime et répond", async () => {
    const fake = seeded({ follows: [[DORA, BRUNO], [FRED, PAULA]] });
    const reserved = randomUUID();
    fake.table("comments").push(comment(reserved, BRUNO_FOLLOWERS, BRUNO, "Entre abonnés", 10), comment(randomUUID(), BRUNO_FOLLOWERS, BRUNO, "Réponse entre abonnés", 11, { parent: reserved }));
    const paulas = randomUUID();
    fake.table("comments").push(comment(paulas, PAULA_PUBLIC, PAULA, "Chez Paula", 12));
    const target = await commentsApp(fake.db);

    // Dora, abonnée de Bruno : sa publication « abonnés ».
    expect(idsOf(await thread(target, DORA, BRUNO_FOLLOWERS))).toEqual([reserved]);
    expect((await replies(target, DORA, reserved)).map((item) => item.body)).toEqual(["Réponse entre abonnés"]);
    expect((await as(target, DORA).put(`/api/comments/${reserved}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    expect((await comments(target, DORA, "Merci", { postId: BRUNO_FOLLOWERS, parentId: reserved })).statusCode).toBe(200);
    // Bruno, l'auteur : sa publication privée.
    expect((await as(target, BRUNO).get(`${commentsUrl(BRUNO_PRIVATE)}?v=2`)).statusCode).toBe(200);
    // Fred, abonné accepté de Paula (compte privé).
    expect(idsOf(await thread(target, FRED, PAULA_PUBLIC))).toEqual([paulas]);
    // Anna, inconnue : la publication publique d'un compte public.
    expect(idsOf(await thread(target, ANNA))).toEqual([C1, C2]);
  });
});

describe("le fil : commentaires d'origine, réponses à part (app récente, « v=2 »)", () => {
  it("la première page ne contient que les commentaires d'origine, chacun avec ses « j'aime », ses mentions et le nombre de ses réponses", async () => {
    const fake = seeded({ likes: [[ANNA, C1], [DORA, C1], [BRUNO, C2]], mentions: [[C2, DORA, CARL, "carl"]] });
    const target = await commentsApp(fake.db);
    const list = await thread(target, ANNA);
    expect(idsOf(list)).toEqual([C1, C2]);
    expect(byId(list, C1)).toMatchObject({ parentId: null, likeCount: 2, viewerHasLiked: true, mentions: [], replyCount: 2, canDelete: false });
    expect(byId(list, C2)).toMatchObject({ parentId: null, likeCount: 1, viewerHasLiked: false, mentions: [{ handle: "carl", userId: CARL }], replyCount: 0 });
    // Aucune réponse n'est jointe : pas de liste dans un commentaire.
    expect(JSON.stringify(list)).not.toContain("Je confirme");
    expect(list.every((item) => !("replies" in item))).toBe(true);
  });

  it("les réponses se lisent à part, les plus anciennes d'abord, avec leurs « j'aime » et leur commentaire d'origine", async () => {
    const fake = seeded({ likes: [[ANNA, R2]] });
    const target = await commentsApp(fake.db);
    const list = await replies(target, ANNA, C1);
    expect(idsOf(list)).toEqual([R1, R2]);
    expect(byId(list, R1)).toMatchObject({ parentId: C1, likeCount: 0, viewerHasLiked: false, mentions: [], replyCount: 0 });
    expect(byId(list, R2)).toMatchObject({ parentId: C1, likeCount: 1, viewerHasLiked: true });
    // Une réponse n'a pas de réponses ; un commentaire inconnu : 404.
    expect(await replies(target, ANNA, R1)).toEqual([]);
    expect((await as(target, ANNA).get(`/api/comments/${UNKNOWN}/replies`)).json()).toEqual(COMMENT_NOT_FOUND);
    expect((await as(target, ANNA).get("/api/comments/pas-un-identifiant/replies")).statusCode).toBe(400);
  });

  it("pagination : 30 par page, curseur vers les plus récents, pour les commentaires comme pour les réponses", async () => {
    const fake = seeded({ empty: true });
    const root = randomUUID();
    fake.table("comments").push(comment(root, BRUNO_PUBLIC, CARL, "Origine", 0));
    for (let index = 1; index <= 35; index += 1) {
      fake.table("comments").push(comment(randomUUID(), BRUNO_PUBLIC, DORA, `Commentaire ${index}`, index));
      fake.table("comments").push(comment(randomUUID(), BRUNO_PUBLIC, DORA, `Réponse ${index}`, 100 + index, { parent: root }));
    }
    const target = await commentsApp(fake.db);
    for (const url of [`${commentsUrl(BRUNO_PUBLIC)}?v=2`, `/api/comments/${root}/replies`]) {
      const first: CommentsPage = (await as(target, ANNA).get(url)).json();
      expect(first.comments, url).toHaveLength(30);
      expect(first.nextCursor, url).toBe(first.comments.at(-1)!.createdAt);
      const second: CommentsPage = (await as(target, ANNA).get(`${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(first.nextCursor!)}`)).json();
      expect(second.comments.length, url).toBe(url.includes("replies") ? 5 : 6);
      expect(second.nextCursor, url).toBeNull();
      expect(new Set([...idsOf(first.comments), ...idsOf(second.comments)]).size, url).toBe(first.comments.length + second.comments.length);
    }
    expect((await as(target, ANNA).get(`/api/comments/${root}/replies?cursor=hier`)).statusCode).toBe(400);
  });

  it("le nombre de lectures ne dépend pas du nombre de commentaires (jamais une lecture par commentaire)", async () => {
    const count = async (extra: number) => {
      resetPrivateAccountsProbe();
      resetCommentThreadsProbe();
      const fake = seeded();
      for (let index = 0; index < extra; index += 1) {
        const id = randomUUID();
        fake.table("comments").push(comment(id, BRUNO_PUBLIC, index % 2 ? CARL : DORA, `Autre @anna ${index}`, 40 + index));
        fake.table("comment_reactions").push({ comment_id: id, user_id: FRED });
        fake.table("comment_mentions").push({ comment_id: id, author_id: CARL, user_id: ANNA, handle: "anna" });
      }
      let reads = 0;
      const real = fake.db as { from: (name: string) => unknown };
      const target = await commentsApp({ ...real, from: (name: string) => (reads++, real.from(name)) });
      await thread(target, GINA);
      reads = 0;
      const list = await thread(target, GINA);
      expect(list).toHaveLength(2 + extra);
      await app?.close();
      return reads;
    };
    expect(await count(20)).toBe(await count(0));
  });
});

describe("règle 2 : une réponse n'est montrée que si son commentaire d'origine l'est", () => {
  it("refusé : commentaire d'origine masqué par la modération — ses réponses disparaissent partout, même à plat", async () => {
    const fake = seeded({ hiddenComments: [C1] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await thread(target, ANNA))).toEqual([C2]);
    expect((await as(target, ANNA).get(`/api/comments/${C1}/replies`)).json()).toEqual(COMMENT_NOT_FOUND);
    // App d'avant : les réponses R1 et R2 ne remontent pas comme des commentaires ordinaires.
    expect(idsOf(await flat(target, ANNA))).toEqual([C2]);
    // On n'aime pas, et on ne répond pas à, une réponse dont l'origine est masquée.
    expect((await as(target, ANNA).put(`/api/comments/${R1}/like`, { liked: true })).json()).toEqual(COMMENT_NOT_FOUND);
    expect((await comments(target, ANNA, "Je réponds", { parentId: R1 })).json()).toEqual(COMMENT_NOT_FOUND);
    expect((await as(target, ANNA).get(`/api/comments/${R1}/replies`)).json()).toEqual(COMMENT_NOT_FOUND);
    // Même pour l'auteur de la réponse et pour l'auteur de la publication.
    expect(idsOf(await flat(target, DORA))).toEqual([C2]);
    expect(idsOf(await flat(target, BRUNO))).toEqual([C2]);
  });

  it("refusé : commentaire d'origine signalé par le lecteur, ou écrit par un compte en blocage avec lui", async () => {
    const fake = seeded({ reports: [[ANNA, C1]], blocks: [[FRED, CARL], [CARL, GINA]] });
    const target = await commentsApp(fake.db);
    for (const viewer of [ANNA, FRED, GINA]) {
      expect(idsOf(await thread(target, viewer)), viewer).toEqual([C2]);
      expect(idsOf(await flat(target, viewer)), viewer).toEqual([C2]);
      expect((await as(target, viewer).get(`/api/comments/${C1}/replies`)).json(), viewer).toEqual(COMMENT_NOT_FOUND);
      expect((await as(target, viewer).put(`/api/comments/${R2}/like`, { liked: true })).json(), viewer).toEqual(COMMENT_NOT_FOUND);
      expect((await comments(target, viewer, "Je réponds", { parentId: C1 })).json(), viewer).toEqual(COMMENT_NOT_FOUND);
    }
    expect(fake.table("comment_reactions")).toEqual([]);
  });

  it("refusé : une réponse masquée ou signalée seule disparaît, sans emporter les autres", async () => {
    const fake = seeded({ hiddenComments: [R1], reports: [[ANNA, R2]] });
    const target = await commentsApp(fake.db);
    expect(await replies(target, ANNA, C1)).toEqual([]);
    expect(byId(await thread(target, ANNA), C1).replyCount).toBe(0);
    // Gina n'a rien signalé : elle voit R2, pas R1 (masquée pour tous).
    expect(idsOf(await replies(target, GINA, C1))).toEqual([R2]);
    expect(byId(await thread(target, GINA), C1).replyCount).toBe(1);
  });

  it("permis : sans masquage, signalement ni blocage, les réponses sont là, dans le fil comme à plat", async () => {
    const fake = seeded({ reports: [[ANNA, C1]] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await replies(target, GINA, C1))).toEqual([R1, R2]);
    expect(idsOf(await flat(target, GINA))).toEqual([C1, R1, C2, R2]);
    expect((await as(target, GINA).put(`/api/comments/${R2}/like`, { liked: true })).statusCode).toBe(200);
  });
});

describe("règle 2, pour ceux qu'une réponse touche : ni mention ni notification à qui ne voit pas le fil", () => {
  it("refusé (mention) : un membre en blocage avec l'auteur du commentaire d'origine n'est pas mentionné — ni ligne, ni notification, ni budget consommé", async () => {
    // Gina a bloqué Carl (auteur de C1), Carl a bloqué Fred : aucun des deux ne voit le fil de C1.
    const fake = seeded({ blocks: [[GINA, CARL], [CARL, FRED]] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await thread(target, GINA))).toEqual([C2]);
    // Anna répond à C1, puis à la réponse de Dora (R1) : c'est toujours le fil de Carl.
    for (const parentId of [C1, R1]) {
      const response = await comments(target, ANNA, "Regardez @gina et @fred", { parentId });
      expect(response.statusCode, parentId).toBe(200);
      expect((response.json() as PostComment).mentions, parentId).toEqual([]);
    }
    expect(mentionRows(fake)).toEqual([]);
    expect(noticesOf(fake, "mention")).toEqual([]);
    // Aucun lien vers elles sous le fil de Carl, pour aucun lecteur.
    expect((await replies(target, DORA, C1)).flatMap((item) => item.mentions ?? [])).toEqual([]);
    // Écartées AVANT le budget de l'heure.
    let consumed = 0;
    const post = { user_id: BRUNO, privacy: "public" as const };
    expect(await resolveMentions(target, { authorId: ANNA, text: "@gina @fred", post, threadAuthorId: CARL, consume: () => (consumed++, true) })).toEqual([]);
    expect(consumed).toBe(0);
  });

  it("permis (mention) : sans blocage avec l'auteur du commentaire d'origine — même en blocage avec l'auteur de la réponse visée ; un commentaire d'origine n'a pas de fil", async () => {
    // Gina a bloqué Dora (auteure de R1), pas Carl : la réponse d'Anna est rattachée à C1, que Gina voit.
    // Fred a bloqué Carl : un commentaire d'origine le mentionne quand même.
    const fake = seeded({ blocks: [[GINA, DORA], [FRED, CARL]] });
    const target = await commentsApp(fake.db);
    const reply: PostComment = (await comments(target, ANNA, "Regardez @gina et @carl", { parentId: R1 })).json();
    expect(reply.mentions).toEqual([
      { handle: "gina", userId: GINA },
      { handle: "carl", userId: CARL },
    ]);
    const top: PostComment = (await comments(target, ANNA, "Regarde @fred")).json();
    expect(top.mentions).toEqual([{ handle: "fred", userId: FRED }]);
    expect(noticePairs(fake, "mention").sort()).toEqual([`${ANNA}>${CARL}`, `${ANNA}>${FRED}`, `${ANNA}>${GINA}`].sort());
    expect(idsOf(await replies(target, GINA, C1))).toContain(reply.id);
    expect(byId(await replies(target, EVE, C1), reply.id).mentions).toHaveLength(2);
    let consumed = 0;
    const post = { user_id: BRUNO, privacy: "public" as const };
    expect(await resolveMentions(target, { authorId: ANNA, text: "@gina", post, threadAuthorId: CARL, consume: () => (consumed++, true) })).toEqual([{ handle: "gina", userId: GINA }]);
    expect(consumed).toBe(1);
  });

  it("refusé (notification) : ni « reply » ni « comment » à un membre en blocage avec l'auteur du commentaire d'origine", async () => {
    // Dora a répondu à Carl (R1), puis Carl l'a bloquée ; Eve (auteure de R2) a bloqué Carl ; Bruno aussi.
    const fake = seeded({ blocks: [[CARL, DORA], [EVE, CARL], [BRUNO, CARL]] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await thread(target, DORA))).toEqual([C2]);
    expect((await comments(target, ANNA, "Je réponds à Dora", { parentId: R1 })).statusCode).toBe(200);
    expect((await comments(target, ANNA, "Je réponds à Eve", { parentId: R2 })).statusCode).toBe(200);
    expect(noticesOf(fake, "reply")).toEqual([]);
    expect(noticesOf(fake, "comment")).toEqual([]);
    // Un commentaire d'origine, lui, prévient Bruno comme avant.
    await comments(target, ANNA, "Un commentaire à part");
    expect(noticePairs(fake, "comment")).toEqual([`${ANNA}>${BRUNO}`]);
  });

  it("permis (notification) : sans blocage avec l'auteur du commentaire d'origine, l'auteur de la réponse visée et celui de la publication sont prévenus", async () => {
    // Dora a bloqué Gina, Bruno a bloqué Fred : aucun lien avec Carl.
    const fake = seeded({ blocks: [[DORA, GINA], [BRUNO, FRED]] });
    const target = await commentsApp(fake.db);
    await comments(target, ANNA, "Je réponds à Dora", { parentId: R1 });
    await comments(target, ANNA, "Je réponds à Carl", { parentId: C1 });
    expect(noticePairs(fake, "reply")).toEqual([`${ANNA}>${DORA}`, `${ANNA}>${CARL}`]);
    expect(noticePairs(fake, "comment")).toEqual([`${ANNA}>${BRUNO}`, `${ANNA}>${BRUNO}`]);
  });

  it("panne de la lecture des blocages de l'auteur du commentaire d'origine : la réponse est publiée, sans mention ni notification", async () => {
    const fake = seeded();
    const real = fake.db as { from: (name: string) => { select: (columns: string) => { eq: (column: string, value: string) => unknown } } };
    const broken = Promise.resolve({ data: null, error: { message: "panne" } });
    const db = {
      ...real,
      from: (name: string) => {
        const query = real.from(name);
        if (name !== "blocks") return query;
        return { select: (columns: string) => ({ eq: (column: string, value: string) => (value === CARL ? Object.assign(broken, { in: () => broken }) : query.select(columns).eq(column, value)) }) };
      },
    };
    const target = await commentsApp(db);
    const response = await comments(target, ANNA, "Regardez @gina", { parentId: C1 });
    expect(response.statusCode).toBe(200);
    expect((response.json() as PostComment).mentions).toEqual([]);
    expect(fake.table("comments").some((row) => row.id === (response.json() as PostComment).id)).toBe(true);
    expect(mentionRows(fake)).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
  });
});

describe("règle 3 : les comptes en blocage avec le lecteur sont absents, leurs « j'aime » ne comptent pas", () => {
  it("refusé : ni leurs commentaires, ni leurs réponses, ni leurs « j'aime », dans un sens comme dans l'autre", async () => {
    // Anna a bloqué Eve (auteure de R2) ; Dora (auteure de R1 et C2) a bloqué Gina.
    const fake = seeded({ blocks: [[ANNA, EVE], [DORA, GINA]], likes: [[EVE, C1], [DORA, C1], [FRED, C1], [EVE, R1]] });
    const target = await commentsApp(fake.db);

    expect(idsOf(await replies(target, ANNA, C1))).toEqual([R1]);
    expect(byId(await thread(target, ANNA), C1)).toMatchObject({ replyCount: 1, likeCount: 2 });
    expect(byId(await replies(target, ANNA, C1), R1).likeCount).toBe(0);
    expect(idsOf(await flat(target, ANNA))).toEqual([C1, R1, C2]);
    expect((await as(target, ANNA).put(`/api/comments/${R2}/like`, { liked: true })).json()).toEqual(COMMENT_NOT_FOUND);

    // Gina, bloquée par Dora : ni C2 ni R1, et le « j'aime » de Dora ne compte pas pour elle.
    expect(idsOf(await thread(target, GINA))).toEqual([C1]);
    expect(idsOf(await replies(target, GINA, C1))).toEqual([R2]);
    expect(byId(await thread(target, GINA), C1)).toMatchObject({ replyCount: 1, likeCount: 2 });
    // Le nombre rendu après un « j'aime » suit la même règle.
    const liked: LikeCommentResponse = (await as(target, GINA).put(`/api/comments/${C1}/like`, { liked: true })).json();
    expect(liked).toEqual({ likeCount: 3, viewerHasLiked: true });
    expect(fake.table("comment_reactions").filter((row) => row.comment_id === C1)).toHaveLength(4);
  });

  it("permis : pour un lecteur sans blocage, tout le monde est là et tous les « j'aime » comptent", async () => {
    const fake = seeded({ blocks: [[ANNA, EVE], [DORA, GINA]], likes: [[EVE, C1], [DORA, C1], [FRED, C1], [EVE, R1]] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await thread(target, FRED))).toEqual([C1, C2]);
    expect(idsOf(await replies(target, FRED, C1))).toEqual([R1, R2]);
    expect(byId(await thread(target, FRED), C1)).toMatchObject({ replyCount: 2, likeCount: 3, viewerHasLiked: true });
    expect(byId(await replies(target, FRED, C1), R1).likeCount).toBe(1);
  });

  it("panne de la lecture des blocages : une erreur, jamais une liste où personne n'est bloqué", async () => {
    const fake = seeded({ blocks: [[ANNA, EVE]] });
    const real = fake.db as { from: (name: string) => unknown };
    const broken = Promise.resolve({ data: null, error: { message: "panne" } });
    const db = { ...real, from: (name: string) => (name === "blocks" ? { select: () => ({ eq: () => Object.assign(broken, { in: () => broken }) }) } : real.from(name)) };
    const target = await commentsApp(db);
    for (const url of [`${commentsUrl(BRUNO_PUBLIC)}?v=2`, commentsUrl(BRUNO_PUBLIC), `/api/comments/${C1}/replies`]) {
      const response = await as(target, ANNA).get(url);
      expect(response.statusCode, url).toBe(500);
      expect(response.body, url).not.toContain("Moi aussi");
    }
  });
});

describe("aimer un commentaire", () => {
  it("l'app dit l'état voulu : répéter ne change rien ; aucune notification ; le corps est vérifié", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    const anna = as(target, ANNA);
    expect((await anna.put(`/api/comments/${C1}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    expect((await anna.put(`/api/comments/${C1}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    expect(fake.table("comment_reactions")).toHaveLength(1);
    expect((await as(target, FRED).put(`/api/comments/${C1}/like`, { liked: true })).json()).toEqual({ likeCount: 2, viewerHasLiked: true });
    expect((await anna.put(`/api/comments/${C1}/like`, { liked: false })).json()).toEqual({ likeCount: 1, viewerHasLiked: false });
    expect((await anna.put(`/api/comments/${C1}/like`, { liked: false })).json()).toEqual({ likeCount: 1, viewerHasLiked: false });
    // Une réponse s'aime comme un commentaire.
    expect((await anna.put(`/api/comments/${R1}/like`, { liked: true })).json()).toEqual({ likeCount: 1, viewerHasLiked: true });
    // Pas de notification pour un « j'aime » sur un commentaire (décision 9).
    expect(fake.table("notifications")).toEqual([]);

    for (const payload of [{}, { liked: "oui" }, { liked: 1 }]) expect((await anna.put(`/api/comments/${C1}/like`, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    expect((await anna.put("/api/comments/pas-un-identifiant/like", { liked: true })).statusCode).toBe(400);
    expect((await target.inject({ method: "PUT", url: `/api/comments/${C1}/like`, payload: { liked: true } })).statusCode).toBe(401);
  });

  it("limite « commentLike » : 300 par heure, sa propre phrase, traduite", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    expect(limitNames.get(`PUT /api/comments/:id/like`)).toBe("commentLike");
    expect(RATE_LIMITS.commentLike).toEqual({ max: 300, windowMs: 60 * 60 * 1000, error: COMMENT_LIKE_LIMIT_ERROR, message: "Trop de j'aime en peu de temps. Réessayez dans un moment." });
    expect(localizeMessage(RATE_LIMITS.commentLike.message, 429, "en")).toBe("Too many likes in a short time. Please try again in a moment.");
    expect(localizeMessage(UNAVAILABLE.message, 404, "en")).toBe("Replies and mentions aren't available yet.");
    // Commenter garde sa limite d'avant.
    expect(limitNames.get("POST /api/posts/:id/comments")).toBe("comment");
    expect(RATE_LIMITS.comment).toEqual({ max: 30, windowMs: 60 * 60 * 1000 });

    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const liker = randomUUID();
    fake.table("profiles").push(profile(liker, "aimeur"));
    let last = 200;
    for (let index = 0; index < RATE_LIMITS.commentLike.max + 1; index += 1) last = (await as(target, liker).put(`/api/comments/${C1}/like`, { liked: index % 2 === 0 })).statusCode;
    expect(last).toBe(429);
    const refused = await as(target, liker).put(`/api/comments/${C1}/like`, { liked: true });
    expect(refused.json()).toEqual({ error: COMMENT_LIKE_LIMIT_ERROR, message: RATE_LIMITS.commentLike.message });
  });
});

describe("répondre à un commentaire", () => {
  it("la réponse est rattachée au commentaire, et son auteur est prévenu (« reply »)", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    const response = await comments(target, ANNA, "  Merci du conseil  ", { parentId: C1 });
    expect(response.statusCode).toBe(200);
    const created: PostComment = response.json();
    expect(created).toMatchObject({ body: "Merci du conseil", parentId: C1, likeCount: 0, viewerHasLiked: false, mentions: [], replyCount: 0, canDelete: true });
    expect(fake.table("comments").find((row) => row.id === created.id)?.parent_id).toBe(C1);
    // Bruno (auteur de la publication) reçoit « comment », Carl (auteur de C1) reçoit « reply ».
    expect(noticePairs(fake, "comment")).toEqual([`${ANNA}>${BRUNO}`]);
    expect(noticePairs(fake, "reply")).toEqual([`${ANNA}>${CARL}`]);
    expect(noticesOf(fake, "reply")[0]).toMatchObject({ post_id: BRUNO_PUBLIC, comment_id: created.id });
    expect(idsOf(await replies(target, GINA, C1))).toEqual([R1, R2, created.id]);
  });

  it("un seul niveau : une réponse à une réponse est rattachée au commentaire d'origine, et c'est l'auteur de la réponse visée qui est prévenu", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    const created: PostComment = (await comments(target, ANNA, "Je réponds à Dora", { parentId: R1 })).json();
    expect(created.parentId).toBe(C1);
    expect(fake.table("comments").find((row) => row.id === created.id)?.parent_id).toBe(C1);
    expect(noticePairs(fake, "reply")).toEqual([`${ANNA}>${DORA}`]);
    expect(fake.table("comments").every((row) => row.parent_id === null || fake.table("comments").find((parent) => parent.id === row.parent_id)?.parent_id === null)).toBe(true);
  });

  it("une seule notification par personne : jamais à soi-même, jamais « reply » en plus de « comment »", async () => {
    const fake = seeded({ empty: true });
    const brunos = randomUUID();
    const annas = randomUUID();
    fake.table("comments").push(comment(brunos, BRUNO_PUBLIC, BRUNO, "Merci à tous", 1), comment(annas, BRUNO_PUBLIC, ANNA, "Bravo", 2));
    const target = await commentsApp(fake.db);
    // Anna répond à Bruno, auteur de la publication : « comment » seulement.
    await comments(target, ANNA, "Avec plaisir", { parentId: brunos });
    expect(fake.table("notifications").map((row) => `${String(row.type)}:${String(row.user_id)}`)).toEqual([`comment:${BRUNO}`]);
    // Anna répond à son propre commentaire : rien pour elle.
    await comments(target, ANNA, "J'ajoute un mot", { parentId: annas });
    expect(noticesOf(fake, "reply")).toEqual([]);
    // Bruno répond à Anna sous sa propre publication : « reply » pour Anna, rien pour lui.
    await comments(target, BRUNO, "Merci Anna", { parentId: annas });
    expect(noticePairs(fake, "reply")).toEqual([`${BRUNO}>${ANNA}`]);
    expect(noticesOf(fake, "comment").every((row) => row.user_id === BRUNO && row.actor_id === ANNA)).toBe(true);
  });

  it("refusé : un commentaire d'une autre publication, inconnu, ou un identifiant illisible — rien n'est écrit", async () => {
    const fake = seeded();
    const elsewhere = randomUUID();
    fake.table("comments").push(comment(elsewhere, BRUNO_OTHER, CARL, "Ailleurs", 9));
    const target = await commentsApp(fake.db);
    const before = fake.table("comments").length;
    expect((await comments(target, ANNA, "Je réponds", { parentId: elsewhere })).json()).toEqual(COMMENT_NOT_FOUND);
    expect((await comments(target, ANNA, "Je réponds", { parentId: UNKNOWN })).json()).toEqual(COMMENT_NOT_FOUND);
    const invalid = await as(target, ANNA).post(commentsUrl(BRUNO_PUBLIC), { body: "Je réponds", parentId: "pas-un-identifiant" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: "invalid_body", message: "Commentaire invalide." });
    expect(fake.table("comments")).toHaveLength(before);
    expect(fake.table("notifications")).toEqual([]);
  });

  it("refusé : personne ne répond à un membre qui l'a bloqué ; permis pour les autres", async () => {
    const fake = seeded({ blocks: [[CARL, ANNA]] });
    const target = await commentsApp(fake.db);
    expect((await comments(target, ANNA, "Je réponds quand même", { parentId: C1 })).json()).toEqual(COMMENT_NOT_FOUND);
    expect(noticesOf(fake, "reply")).toEqual([]);
    expect((await comments(target, GINA, "Moi je peux", { parentId: C1 })).statusCode).toBe(200);
    expect(noticePairs(fake, "reply")).toEqual([`${GINA}>${CARL}`]);
  });

  it("supprimer un commentaire emporte ses réponses, leurs « j'aime », leurs mentions et leurs notifications ; la règle de suppression ne change pas", async () => {
    const fake = seeded({ likes: [[ANNA, R1], [ANNA, C1]], mentions: [[R1, DORA, FRED, "fred"]] });
    const target = await commentsApp(fake.db);
    await comments(target, ANNA, "Une réponse de plus", { parentId: C1 });
    expect(noticesOf(fake, "reply")).toHaveLength(1);
    // Ni Anna (une inconnue) ni Dora (auteure d'une réponse) ne peuvent supprimer le commentaire de Carl.
    expect((await as(target, ANNA).del(`/api/comments/${C1}`)).statusCode).toBe(404);
    expect((await as(target, DORA).del(`/api/comments/${C1}`)).statusCode).toBe(404);
    // Bruno, auteur de la publication, le peut.
    expect((await as(target, BRUNO).del(`/api/comments/${C1}`)).statusCode).toBe(204);
    expect(fake.table("comments").map((row) => row.id)).toEqual([C2]);
    expect(fake.table("comment_reactions")).toEqual([]);
    expect(fake.table("comment_mentions")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
  });
});

describe("règle 4 : une mention n'est renvoyée que si elle mène encore à ce compte, et pas à un compte en blocage avec le lecteur", () => {
  it("refusé : le lecteur et le compte mentionné sont en blocage — le texte reste, sans lien", async () => {
    const fake = seeded({ mentions: [[C2, DORA, CARL, "carl"]], blocks: [[ANNA, CARL], [CARL, GINA]] });
    // C1 est de Carl : pour Anna et Gina il est absent ; on lit donc C2.
    const target = await commentsApp(fake.db);
    for (const viewer of [ANNA, GINA]) {
      const list = await thread(target, viewer);
      expect(idsOf(list), viewer).toEqual([C2]);
      expect(byId(list, C2).mentions, viewer).toEqual([]);
      expect(JSON.stringify(list), viewer).not.toContain(CARL);
    }
  });

  it("refusé : le compte a changé de pseudo, ou n'en a plus — « @ancien » ne mène plus à personne", async () => {
    const fake = seeded({ mentions: [[C2, DORA, CARL, "carl"], [C2, DORA, FRED, "fred"]] });
    fake.table("profiles").find((row) => row.id === CARL)!.username = "charles";
    fake.table("profiles").find((row) => row.id === FRED)!.username = null;
    const target = await commentsApp(fake.db);
    expect(byId(await thread(target, ANNA), C2).mentions).toEqual([]);
  });

  it("permis : les autres lecteurs reçoivent la mention, dans le fil comme dans les réponses", async () => {
    const fake = seeded({ mentions: [[C2, DORA, CARL, "carl"], [R1, DORA, FRED, "fred"]], blocks: [[ANNA, CARL]] });
    const target = await commentsApp(fake.db);
    expect(byId(await thread(target, FRED), C2).mentions).toEqual([{ handle: "carl", userId: CARL }]);
    expect(byId(await replies(target, GINA, C1), R1).mentions).toEqual([{ handle: "fred", userId: FRED }]);
    // Une app d'avant ne reçoit aucune mention : simple texte.
    expect(byId(await flat(target, FRED), C2)).not.toHaveProperty("mentions");
  });
});

describe("règle 5 : le réglage « Qui peut me mentionner »", () => {
  it("refusé : « personne » ; « les comptes que je suis » quand le membre ne suit pas l'auteur — ni ligne, ni notification, ni erreur, ni indice", async () => {
    const fake = seeded({ mentionsFrom: { [CARL]: "nobody", [FRED]: "following", [GINA]: "following" }, follows: [[GINA, BRUNO], [ANNA, FRED]] });
    const target = await commentsApp(fake.db);
    // Fred ne suit pas Anna (c'est Anna qui le suit) ; Gina suit Bruno, pas Anna.
    const response = await comments(target, ANNA, "Regardez @carl, @fred et @gina");
    expect(response.statusCode).toBe(200);
    const created: PostComment = response.json();
    expect(created.body).toBe("Regardez @carl, @fred et @gina");
    expect(created.mentions).toEqual([]);
    expect(response.body).not.toMatch(/refus|setting|nobody|following|mentions_from/i);
    expect(mentionRows(fake)).toEqual([]);
    expect(noticesOf(fake, "mention")).toEqual([]);
    // Le même corps de réponse que pour un pseudo qui n'existe pas.
    const unknown: PostComment = (await comments(target, ANNA, "Regardez @personne_ici")).json();
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(created).sort());
    expect(unknown.mentions).toEqual([]);
  });

  it("permis : « tout le monde » ; « les comptes que je suis » quand le membre suit l'auteur", async () => {
    const fake = seeded({ mentionsFrom: { [CARL]: "everyone", [FRED]: "following", [GINA]: "nobody" }, follows: [[FRED, ANNA]] });
    const target = await commentsApp(fake.db);
    const created: PostComment = (await comments(target, ANNA, "Regardez @Carl, @fred et @gina")).json();
    expect(created.mentions).toEqual([
      { handle: "carl", userId: CARL },
      { handle: "fred", userId: FRED },
    ]);
    expect(mentionRows(fake)).toEqual([`${ANNA}>${CARL}:carl`, `${ANNA}>${FRED}:fred`]);
    expect(noticePairs(fake, "mention").sort()).toEqual([`${ANNA}>${CARL}`, `${ANNA}>${FRED}`].sort());
    expect(noticesOf(fake, "mention")[0]).toMatchObject({ post_id: BRUNO_PUBLIC, comment_id: created.id });
    // Les autres lecteurs voient les deux liens.
    expect(byId(await thread(target, DORA), created.id).mentions).toHaveLength(2);
  });

  it("le réglage : lu dans le profil, modifiable (même par un compte suspendu), valeurs vérifiées, jamais rétroactif", async () => {
    const fake = seeded({ mentionsFrom: { [CARL]: "everyone" }, suspended: [CARL] });
    fake.table("suspensions").length = 0;
    const target = await commentsApp(fake.db);
    await comments(target, ANNA, "Coucou @carl");
    expect(mentionRows(fake)).toEqual([`${ANNA}>${CARL}:carl`]);
    fake.table("suspensions").push({ user_id: CARL, moderation_action_id: UNKNOWN });

    expect(((await as(target, CARL).get("/api/me")).json() as Profile).mentionsFrom).toBe("everyone");
    expect((await as(target, CARL).put("/api/me/mentions-from", { mentionsFrom: "nobody" })).statusCode).toBe(204);
    expect(((await as(target, CARL).get("/api/me")).json() as Profile).mentionsFrom).toBe("nobody");
    for (const payload of [{}, { mentionsFrom: "friends" }, { mentionsFrom: null }, { mentions_from: "nobody" }]) {
      const refused = await as(target, CARL).put("/api/me/mentions-from", payload);
      expect(refused.statusCode, JSON.stringify(payload)).toBe(400);
      expect(refused.json()).toEqual({ error: "invalid_body", message: "Réglage invalide." });
    }
    expect((await target.inject({ method: "PUT", url: "/api/me/mentions-from", payload: { mentionsFrom: "nobody" } })).statusCode).toBe(401);
    // Le réglage d'un autre compte ne bouge pas.
    expect(fake.table("profiles").find((row) => row.id === ANNA)?.mentions_from).toBe("everyone");
    // Pas rétroactif : la mention déjà faite reste, tant que Carl ne la retire pas.
    expect(mentionRows(fake)).toEqual([`${ANNA}>${CARL}:carl`]);
  });
});

describe("règle 6 : mentionner un membre qui ne peut pas voir la publication ne crée rien", () => {
  it("refusé : publication « abonnés » (non abonné), publication privée, compte privé (non abonné, ou demande en attente)", async () => {
    const fake = seeded({ follows: [[DORA, BRUNO], [FRED, PAULA]] });
    fake.table("follow_requests").push({ requester_id: GINA, target_id: PAULA });
    const target = await commentsApp(fake.db);
    // Dora, abonnée de Bruno, mentionne Anna (pas abonnée) sous une publication « abonnés ».
    expect(((await comments(target, DORA, "Viens voir @anna", { postId: BRUNO_FOLLOWERS })).json() as PostComment).mentions).toEqual([]);
    // Bruno mentionne Dora sous sa publication privée : elle ne la voit pas.
    expect(((await comments(target, BRUNO, "Note pour @dora", { postId: BRUNO_PRIVATE })).json() as PostComment).mentions).toEqual([]);
    // Fred, abonné de Paula (compte privé), mentionne Anna (inconnue) et Gina (demande en attente).
    expect(((await comments(target, FRED, "Regardez @anna et @gina", { postId: PAULA_PUBLIC })).json() as PostComment).mentions).toEqual([]);
    expect(mentionRows(fake)).toEqual([]);
    expect(noticesOf(fake, "mention")).toEqual([]);
  });

  it("permis : le membre mentionné voit la publication (abonné, ou abonné accepté du compte privé, ou l'auteur d'une publication privée)", async () => {
    const fake = seeded({ follows: [[DORA, BRUNO], [GINA, BRUNO], [FRED, PAULA], [GINA, PAULA]] });
    const target = await commentsApp(fake.db);
    expect(((await comments(target, DORA, "Viens voir @gina", { postId: BRUNO_FOLLOWERS })).json() as PostComment).mentions).toEqual([{ handle: "gina", userId: GINA }]);
    expect(((await comments(target, FRED, "Regardez @gina", { postId: PAULA_PUBLIC })).json() as PostComment).mentions).toEqual([{ handle: "gina", userId: GINA }]);
    expect(noticePairs(fake, "mention").sort()).toEqual([`${DORA}>${GINA}`, `${FRED}>${GINA}`].sort());
  });

  it("readViewersAudience : le lien de plusieurs lecteurs avec un auteur, en un nombre fixe de lectures", async () => {
    const fake = seeded({ follows: [[DORA, PAULA]], blocks: [[PAULA, EVE], [FRED, PAULA]], suspended: [PAULA] });
    let reads = 0;
    const real = fake.db as { from: (name: string) => unknown };
    const target = await commentsApp({ ...real, from: (name: string) => (reads++, real.from(name)) });
    await readViewersAudience(target, [ANNA], PAULA);
    reads = 0;
    const links = await readViewersAudience(target, [ANNA, DORA, EVE, FRED, PAULA], PAULA);
    expect(reads).toBe(5);
    expect(links.get(ANNA)).toEqual({ self: false, blocked: false, suspended: true, isPrivate: true, follows: false, requested: false });
    expect(links.get(DORA)).toMatchObject({ blocked: false, follows: true, isPrivate: true });
    expect(links.get(EVE)).toMatchObject({ blocked: true, follows: false });
    expect(links.get(FRED)).toMatchObject({ blocked: true });
    expect(links.get(PAULA)).toMatchObject({ self: true, blocked: false, follows: false });
    expect((await readViewersAudience(target, [], PAULA)).size).toBe(0);
  });
});

describe("règle 7 : un compte suspendu ne commente pas, ne répond pas, n'aime pas, et n'est pas mentionnable", () => {
  it("refusé : 403 pour commenter, répondre et aimer ; sa mention ne crée rien", async () => {
    const fake = seeded({ suspended: [EVE, CARL] });
    const target = await commentsApp(fake.db);
    const before = fake.table("comments").length;
    for (const response of [await comments(target, EVE, "Je commente"), await comments(target, EVE, "Je réponds", { parentId: C1 }), await as(target, EVE).put(`/api/comments/${C1}/like`, { liked: true })]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("account_suspended");
    }
    expect(fake.table("comments")).toHaveLength(before);
    expect(fake.table("comment_reactions")).toEqual([]);

    expect(((await comments(target, ANNA, "Bonjour @carl et @eve")).json() as PostComment).mentions).toEqual([]);
    expect(mentionRows(fake)).toEqual([]);
    expect(noticesOf(fake, "mention")).toEqual([]);
  });

  it("permis : il lit toujours les commentaires ; un compte actif commente, aime et est mentionné", async () => {
    const fake = seeded({ suspended: [EVE] });
    const target = await commentsApp(fake.db);
    expect(idsOf(await thread(target, EVE))).toEqual([C1, C2]);
    expect(idsOf(await replies(target, EVE, C1))).toEqual([R1, R2]);
    expect((await as(target, ANNA).put(`/api/comments/${C1}/like`, { liked: true })).statusCode).toBe(200);
    expect(((await comments(target, ANNA, "Bonjour @carl")).json() as PostComment).mentions).toEqual([{ handle: "carl", userId: CARL }]);
  });
});

describe("règle 8 : ni lien de mention ni notification de mention ne survit à un blocage", () => {
  it("un blocage retire les mentions entre les deux comptes, dans les deux sens, et leurs notifications", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    const annaMentionsCarl: PostComment = (await comments(target, ANNA, "Bravo @carl et @fred")).json();
    const carlMentionsAnna: PostComment = (await comments(target, CARL, "Merci @anna")).json();
    expect(mentionRows(fake).sort()).toEqual([`${ANNA}>${CARL}:carl`, `${ANNA}>${FRED}:fred`, `${CARL}>${ANNA}:anna`].sort());
    expect(noticePairs(fake, "mention").sort()).toEqual([`${ANNA}>${CARL}`, `${ANNA}>${FRED}`, `${CARL}>${ANNA}`].sort());

    expect((await as(target, CARL).post(`/api/blocks/${ANNA}`)).statusCode).toBe(204);

    // Cas refusé : plus aucun lien entre Anna et Carl, pour AUCUN lecteur.
    expect(mentionRows(fake)).toEqual([`${ANNA}>${FRED}:fred`]);
    expect(noticePairs(fake, "mention")).toEqual([`${ANNA}>${FRED}`]);
    for (const viewer of [GINA, FRED, BRUNO]) {
      const list = await thread(target, viewer);
      expect(byId(list, annaMentionsCarl.id).mentions, viewer).toEqual([{ handle: "fred", userId: FRED }]);
      expect(byId(list, carlMentionsAnna.id).mentions, viewer).toEqual([]);
    }
    // Le texte, lui, reste.
    expect(byId(await thread(target, GINA), annaMentionsCarl.id).body).toBe("Bravo @carl et @fred");
    // Et Anna ne peut plus mentionner Carl, ni Carl Anna.
    await comments(target, ANNA, "Encore @carl");
    await comments(target, CARL, "Encore @anna");
    expect(mentionRows(fake)).toEqual([`${ANNA}>${FRED}:fred`]);
    // Débloquer ne fait pas revenir les anciennes mentions.
    expect((await as(target, CARL).del(`/api/blocks/${ANNA}`)).statusCode).toBe(204);
    expect(mentionRows(fake)).toEqual([`${ANNA}>${FRED}:fred`]);
  });

  it("cas permis : un blocage ne touche pas les mentions des autres comptes", async () => {
    const fake = seeded({ mentions: [[C2, DORA, CARL, "carl"], [C1, CARL, DORA, "dora"], [R2, EVE, ANNA, "anna"]] });
    const target = await commentsApp(fake.db);
    expect((await as(target, ANNA).post(`/api/blocks/${CARL}`)).statusCode).toBe(204);
    expect(mentionRows(fake).sort()).toEqual([`${DORA}>${CARL}:carl`, `${CARL}>${DORA}:dora`, `${EVE}>${ANNA}:anna`].sort());
  });
});

describe("règle 9 : les nombres suivent ce que la liste montre", () => {
  it("refusé : ni la réponse à un commentaire masqué, ni le commentaire ou la réponse d'un compte en blocage, ni les réponses à ce compte", async () => {
    // C1 masqué : ses deux réponses ne comptent pas. Reste C2.
    const hidden = seeded({ hiddenComments: [C1] });
    let target = await commentsApp(hidden.db);
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).commentCount).toBe(1);
    await app?.close();

    resetPrivateAccountsProbe();
    resetCommentThreadsProbe();
    // Anna a bloqué Carl (auteur de C1) : C1 et ses deux réponses ne comptent pas pour elle.
    // Gina est bloquée par Eve (auteure de R2) : R2 ne compte pas pour elle.
    const blocked = seeded({ blocks: [[ANNA, CARL], [EVE, GINA]] });
    target = await commentsApp(blocked.db);
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).commentCount).toBe(1);
    expect(idsOf(await flat(target, ANNA))).toEqual([C2]);
    expect((await postSeenBy(target, GINA, BRUNO_PUBLIC)).commentCount).toBe(3);
    expect(byId(await thread(target, GINA), C1).replyCount).toBe(1);
    expect(idsOf(await flat(target, GINA))).toEqual([C1, R1, C2]);
  });

  it("permis : pour un lecteur sans blocage, tout compte — commentaires et réponses", async () => {
    const fake = seeded({ blocks: [[ANNA, CARL], [EVE, GINA]] });
    const target = await commentsApp(fake.db);
    expect((await postSeenBy(target, FRED, BRUNO_PUBLIC)).commentCount).toBe(4);
    expect(byId(await thread(target, FRED), C1).replyCount).toBe(2);
    expect(idsOf(await flat(target, FRED))).toHaveLength(4);
  });
});

describe("règle 10 : mentions en masse", () => {
  it("la 21e mention retenue en une heure ne crée rien ; le commentaire est publié quand même ; une heure plus tard, c'est reparti", async () => {
    expect(RATE_LIMITS.mentionNotify).toEqual({ max: 20, windowMs: 60 * 60 * 1000 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    const fake = seeded({ empty: true });
    const target = await commentsApp(fake.db);
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const author = randomUUID();
    fake.table("profiles").push(profile(author, "bavard"));
    const five = "@anna @carl @dora @eve @fred";
    for (let round = 0; round < 4; round += 1) {
      const created: PostComment = (await comments(target, author, `Tour ${round} ${five}`)).json();
      expect(created.mentions, `tour ${round}`).toHaveLength(5);
    }
    expect(fake.table("comment_mentions")).toHaveLength(20);

    // 21e : le commentaire part, sans lien, sans erreur.
    const over = await comments(target, author, "Et encore @gina et @anna");
    expect(over.statusCode).toBe(200);
    expect((over.json() as PostComment).mentions).toEqual([]);
    expect((over.json() as PostComment).body).toBe("Et encore @gina et @anna");
    expect(fake.table("comment_mentions")).toHaveLength(20);
    expect(noticesOf(fake, "mention").filter((row) => row.user_id === GINA)).toEqual([]);
    // Le budget est par auteur : un autre membre mentionne normalement.
    expect(((await comments(target, BRUNO, "Merci @gina")).json() as PostComment).mentions).toEqual([{ handle: "gina", userId: GINA }]);

    vi.setSystemTime(new Date("2026-11-18T11:00:01Z"));
    expect(((await comments(target, author, "Une heure après @gina")).json() as PostComment).mentions).toEqual([{ handle: "gina", userId: GINA }]);
  });

  it("une mention écartée par une règle ne consomme pas le budget", async () => {
    const fake = seeded({ empty: true, mentionsFrom: { [CARL]: "nobody" } });
    const target = await commentsApp(fake.db);
    let consumed = 0;
    const accepted = await resolveMentions(target, { authorId: ANNA, text: "@carl @inconnu @anna @dora", post: { user_id: BRUNO, privacy: "public" }, consume: () => (consumed++, true) });
    expect(accepted).toEqual([{ handle: "dora", userId: DORA }]);
    expect(consumed).toBe(1);
    // Budget épuisé : rien, et la suite n'est même pas essayée.
    consumed = 0;
    expect(await resolveMentions(target, { authorId: ANNA, text: "@dora @eve", post: { user_id: BRUNO, privacy: "public" }, consume: () => (consumed++, false) })).toEqual([]);
    expect(consumed).toBe(1);
  });

  it("au plus une notification de mention par auteur, membre et publication ; au plus cinq mentions par commentaire", async () => {
    const fake = seeded({ empty: true });
    const target = await commentsApp(fake.db);
    const first: PostComment = (await comments(target, ANNA, "Regarde @carl")).json();
    const second: PostComment = (await comments(target, ANNA, "Regarde encore @carl")).json();
    // Deux liens (un par commentaire), une seule notification.
    expect(first.mentions).toHaveLength(1);
    expect(second.mentions).toHaveLength(1);
    expect(noticesOf(fake, "mention")).toHaveLength(1);
    expect(noticesOf(fake, "mention")[0]).toMatchObject({ user_id: CARL, actor_id: ANNA, comment_id: first.id });
    // Sous une AUTRE publication : une notification de plus.
    await comments(target, ANNA, "Ici aussi @carl", { postId: BRUNO_OTHER });
    expect(noticesOf(fake, "mention")).toHaveLength(2);
    // Six pseudos : cinq liens.
    const six: PostComment = (await comments(target, DORA, "@anna @carl @eve @fred @gina @bruno")).json();
    expect(six.mentions!.map((mention) => mention.handle)).toEqual(["anna", "carl", "eve", "fred", "gina"]);
  });

  it("jamais soi-même ; l'auteur de la publication mentionné ne reçoit que « comment » ; le membre à qui l'on répond, que « reply »", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    const created: PostComment = (await comments(target, ANNA, "Merci @anna, @bruno et @carl", { parentId: C1 })).json();
    expect(created.mentions!.map((mention) => mention.handle)).toEqual(["bruno", "carl"]);
    expect(fake.table("notifications").map((row) => `${String(row.type)}:${String(row.user_id)}`).sort()).toEqual([`comment:${BRUNO}`, `reply:${CARL}`].sort());
  });
});

describe("règle 11 : retirer sa propre mention", () => {
  it("permis : le membre mentionné retire sa mention et sa notification ; le texte reste ; sans effet la seconde fois", async () => {
    const fake = seeded({ empty: true });
    const target = await commentsApp(fake.db);
    const created: PostComment = (await comments(target, ANNA, "Bravo @carl et @fred")).json();
    expect(noticePairs(fake, "mention").sort()).toEqual([`${ANNA}>${CARL}`, `${ANNA}>${FRED}`].sort());

    expect((await as(target, CARL).del(`/api/comments/${created.id}/mentions/me`)).statusCode).toBe(204);
    expect(mentionRows(fake)).toEqual([`${ANNA}>${FRED}:fred`]);
    expect(noticePairs(fake, "mention")).toEqual([`${ANNA}>${FRED}`]);
    const seen = byId(await thread(target, GINA), created.id);
    expect(seen.body).toBe("Bravo @carl et @fred");
    expect(seen.mentions).toEqual([{ handle: "fred", userId: FRED }]);
    expect((await as(target, CARL).del(`/api/comments/${created.id}/mentions/me`)).statusCode).toBe(204);
    expect(mentionRows(fake)).toEqual([`${ANNA}>${FRED}:fred`]);
    // Même suspendu (geste de confidentialité).
    fake.table("suspensions").push({ user_id: FRED, moderation_action_id: UNKNOWN });
    expect((await as(target, FRED).del(`/api/comments/${created.id}/mentions/me`)).statusCode).toBe(204);
    expect(mentionRows(fake)).toEqual([]);
  });

  it("refusé : personne d'autre ne peut la retirer — ni l'auteur du commentaire, ni l'auteur de la publication, ni un tiers", async () => {
    const fake = seeded({ empty: true });
    const target = await commentsApp(fake.db);
    const created: PostComment = (await comments(target, ANNA, "Bravo @carl")).json();
    for (const other of [ANNA, BRUNO, GINA]) {
      // La route ne vise que les lignes de l'appelant : rien ne change.
      expect((await as(target, other).del(`/api/comments/${created.id}/mentions/me`)).statusCode, other).toBe(204);
      expect(mentionRows(fake), other).toEqual([`${ANNA}>${CARL}:carl`]);
      expect(noticePairs(fake, "mention"), other).toEqual([`${ANNA}>${CARL}`]);
    }
    // Aucune route ne retire la mention d'un autre.
    expect((await as(target, ANNA).del(`/api/comments/${created.id}/mentions/${CARL}`)).statusCode).toBe(404);
    expect((await target.inject({ method: "DELETE", url: `/api/comments/${created.id}/mentions/me` })).statusCode).toBe(401);
    expect((await as(target, CARL).del("/api/comments/pas-un-identifiant/mentions/me")).statusCode).toBe(400);
  });
});

describe("apps d'avant le lot (sans « v=2 »)", () => {
  it("la liste à plat d'avant : ordre chronologique, réponses comme des commentaires ordinaires, aucun champ nouveau", async () => {
    const fake = seeded({ likes: [[ANNA, C1]], mentions: [[C2, DORA, CARL, "carl"]] });
    const target = await commentsApp(fake.db);
    const list = await flat(target, ANNA);
    expect(idsOf(list)).toEqual([C1, R1, C2, R2]);
    for (const item of list) expect(Object.keys(item).sort()).toEqual(["author", "body", "canDelete", "createdAt", "id"]);
    // « v=1 » ou toute autre valeur : l'ancien vocabulaire.
    expect(idsOf(((await as(target, ANNA).get(`${commentsUrl(BRUNO_PUBLIC)}?v=1`)).json() as CommentsPage).comments)).toEqual([C1, R1, C2, R2]);
  });

  it("un commentaire sans « parentId » reste un commentaire ordinaire ; les notifications « reply » et « mention » ne lui sont ni envoyées ni comptées", async () => {
    const fake = seeded();
    const target = await commentsApp(fake.db);
    await comments(target, ANNA, "Bonjour @carl");
    await comments(target, ANNA, "Je réponds", { parentId: C2 });
    expect(noticesOf(fake, "mention")).toHaveLength(1);
    expect(noticesOf(fake, "reply")).toHaveLength(1);
    expect(LEGACY_NOTIFICATION_TYPES).not.toContain("reply");
    expect(LEGACY_NOTIFICATION_TYPES).not.toContain("mention");

    const typesFor = async (user: string, query: string) => ((await as(target, user).get(`/api/notifications${query}`)).json() as AppNotification[]).map((item) => item.type);
    expect(await typesFor(CARL, "")).toEqual([]);
    expect(await typesFor(CARL, "?v=2")).toEqual(["mention"]);
    expect(await typesFor(DORA, "")).toEqual([]);
    expect(await typesFor(DORA, "?v=2")).toEqual(["reply"]);
    expect((await as(target, CARL).get("/api/notifications/unread-count")).json()).toEqual({ count: 0 });
    expect((await as(target, CARL).get("/api/notifications/unread-count?v=2")).json()).toEqual({ count: 1 });
    // Elles mènent à la publication.
    const [mention] = (await as(target, CARL).get("/api/notifications?v=2")).json() as AppNotification[];
    expect(mention).toMatchObject({ type: "mention", postId: BRUNO_PUBLIC, actor: { id: ANNA, username: "anna" } });
  });
});

describe("base sans la migration 0046 : tout fonctionne comme avant", () => {
  it("commentaires à plat, avec les colonnes d'avant, même pour une app récente", async () => {
    const fake = seeded({}, WITHOUT_0046);
    const target = await commentsApp(fake.db);
    expect(await commentThreadsReady(target)).toBe(false);
    for (const url of [commentsUrl(BRUNO_PUBLIC), `${commentsUrl(BRUNO_PUBLIC)}?v=2`]) {
      const page: CommentsPage = (await as(target, ANNA).get(url)).json();
      expect(idsOf(page.comments), url).toEqual([C1, R1, C2, R2]);
      for (const item of page.comments) expect(Object.keys(item).sort(), url).toEqual(["author", "body", "canDelete", "createdAt", "id"]);
    }
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).commentCount).toBe(4);

    const created = await comments(target, ANNA, "Bonjour @carl");
    expect(created.statusCode).toBe(200);
    expect(Object.keys(created.json()).sort()).toEqual(["author", "body", "canDelete", "createdAt", "id"]);
    // Les mentions ne sont pas résolues : simple texte, aucune notification de mention.
    expect(fake.table("notifications").map((row) => row.type)).toEqual(["comment"]);
    // (La fausse base aurait refusé l'écriture ou la lecture de « parent_id », colonne absente.)
  });

  it("répondre, aimer, lire les réponses, le réglage et le retrait d'une mention répondent « indisponible » (404) ; le profil ne dit rien du réglage", async () => {
    const fake = seeded({}, WITHOUT_0046);
    const target = await commentsApp(fake.db);
    const anna = as(target, ANNA);
    const before = fake.table("comments").length;
    for (const response of [
      await comments(target, ANNA, "Je réponds", { parentId: C1 }),
      await anna.put(`/api/comments/${C1}/like`, { liked: true }),
      await anna.get(`/api/comments/${C1}/replies`),
      await anna.put("/api/me/mentions-from", { mentionsFrom: "nobody" }),
      await anna.del(`/api/comments/${C1}/mentions/me`),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(UNAVAILABLE);
    }
    expect(fake.table("comments")).toHaveLength(before);
    const me = await anna.get("/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).not.toHaveProperty("mentionsFrom");
    // Bloquer fonctionne, sans toucher une table qui n'existe pas.
    expect((await anna.post(`/api/blocks/${CARL}`)).statusCode).toBe(204);
    // Supprimer un commentaire aussi.
    expect((await as(target, BRUNO).del(`/api/comments/${C2}`)).statusCode).toBe(204);
  });

  it("avec la migration : le profil donne le réglage", async () => {
    const fake = seeded({ mentionsFrom: { [ANNA]: "following" } });
    const target = await commentsApp(fake.db);
    expect(((await as(target, ANNA).get("/api/me")).json() as Profile).mentionsFrom).toBe("following");
  });
});

describe("export des données", () => {
  it("les commentaires aimés, les mentions reçues et écrites, le réglage ; jamais celles des autres, jamais un compte en blocage", async () => {
    // Anna a aimé C1 ; Carl et Eve la mentionnent ; elle mentionne Dora et Eve. Eve l'a bloquée depuis.
    const fake = seeded({
      likes: [[ANNA, C1], [FRED, C1]],
      mentions: [[C1, CARL, ANNA, "anna"], [R2, EVE, ANNA, "anna"], [C2, DORA, FRED, "fred"]],
      mentionsFrom: { [ANNA]: "nobody" },
    });
    const mine = randomUUID();
    fake.table("comments").push(comment(mine, BRUNO_PUBLIC, ANNA, "Bravo @dora et @eve", 9, { parent: C1 }));
    fake.table("comment_mentions").push({ comment_id: mine, author_id: ANNA, user_id: DORA, handle: "dora", created_at: at(40) }, { comment_id: mine, author_id: ANNA, user_id: EVE, handle: "eve", created_at: at(41) });
    // Un blocage efface les mentions ; s'il en restait une, elle ne serait pas exportée.
    fake.table("blocks").push({ blocker_id: EVE, blocked_id: ANNA, created_at: "2026-11-11T00:00:00+00:00" });
    const target = await commentsApp(fake.db);

    const body = (await as(target, ANNA).get("/api/me/export")).json();
    expect(body.profile.mentions_from).toBe("nobody");
    expect(body.commentReactionsGiven).toEqual([{ comment_id: C1, created_at: at(30) }]);
    expect(body.mentionsReceived).toEqual([{ comment_id: C1, author_id: CARL, handle: "anna", created_at: at(31) }]);
    expect(body.mentionsMade).toEqual([{ comment_id: mine, user_id: DORA, handle: "dora", created_at: at(40) }]);
    expect(body.comments.map((row: Row) => [row.id, row.parent_id])).toEqual([[mine, C1]]);
    // Clés ajoutées à la fin : les anciennes gardent leur ordre.
    expect(Object.keys(body).slice(-5)).toEqual(["followRequestsSent", "followRequestsReceived", "commentReactionsGiven", "mentionsReceived", "mentionsMade"]);
    const added = JSON.stringify([body.commentReactionsGiven, body.mentionsReceived, body.mentionsMade]);
    expect(added).not.toContain(EVE);
    expect(added).not.toContain(FRED);

    // Fichier lisible : le nom des comptes, jamais celui du compte en blocage.
    const page = (await as(target, ANNA).get("/api/me/export?format=html")).body;
    expect(page).toContain("Mentions de vous (1)");
    expect(page).toContain("Mentions que vous avez écrites (1)");
    expect(page).toContain("Commentaires aimés (1)");
    expect(page).toContain("@carl (Carl)");
    expect(page).toContain("@dora (Dora)");
    // Son propre commentaire garde son texte (« @eve » compris) ; Eve, elle, n'est nommée nulle part.
    expect(page).not.toContain("(Eve)");
    expect(page).toContain("Qui peut vous mentionner");

    // L'autre côté : Dora voit la mention reçue d'Anna et celle qu'elle a écrite pour Fred.
    const dora = (await as(target, DORA).get("/api/me/export")).json();
    expect(dora.mentionsReceived).toEqual([{ comment_id: mine, author_id: ANNA, handle: "dora", created_at: at(40) }]);
    expect(dora.mentionsMade).toEqual([{ comment_id: C2, user_id: FRED, handle: "fred", created_at: at(31) }]);
    expect(dora.commentReactionsGiven).toEqual([]);
  });

  it("sans la migration 0046 : trois sections vides, et l'export réussit", async () => {
    const fake = seeded({}, WITHOUT_0046);
    const target = await commentsApp(fake.db);
    const response = await as(target, ANNA).get("/api/me/export");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect([body.commentReactionsGiven, body.mentionsReceived, body.mentionsMade]).toEqual([[], [], []]);
    expect(body.profile).not.toHaveProperty("mentions_from");
  });
});
