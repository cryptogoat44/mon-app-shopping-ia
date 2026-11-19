import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PEOPLE_TAGS_MAX,
  POST_EXTRAS_UNAVAILABLE_ERROR,
  POST_MEDIA_CLOSED_ERROR,
  POST_MEDIA_CONFLICT_ERROR,
  POST_MEDIA_FULL_ERROR,
  POST_MEDIA_LIMIT_ERROR,
  POST_MEDIA_WINDOW_MIN,
  POST_PHOTOS_MAX,
  type AddPostMediaResponse,
  type AppNotification,
  type MentionsFrom,
  type Post,
  type PostExtrasStatus,
  type PrivacyLevel,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import usersRoutes from "../src/routes/users.js";
import followsRoutes from "../src/routes/follows.js";
import blocksRoutes from "../src/routes/blocks.js";
import meRoutes from "../src/routes/me.js";
import notificationsRoutes from "../src/routes/notifications.js";
import accountRoutes from "../src/routes/account.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { postExtrasReady, resetPostExtrasProbe } from "../src/lib/postExtras.js";
import { dropUnseeableTags } from "../src/lib/peopleTags.js";
import { buildModerationItems, type QueueRow } from "../src/lib/moderationQueue.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { DatabaseReadError } from "../src/lib/validation.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Plusieurs photos par publication, identifier des personnes (lot « vie
// sociale », migration 0047), SANS base ni réseau : les vraies routes sur une
// fausse base en mémoire (tests/fakeSupabase.ts). Chaque règle de visibilité
// de la fiche a son cas « refusé » ET son cas « permis ». Le même parcours sur
// la vraie base de développement : photosIdentificationsBase.test.ts (Mac,
// 0047 appliquée).

// Anna a un compte public : c'est sur SES publications qu'on identifie.
// Bruno et Dora la suivent ; Carl est un inconnu ; Paula a un compte PRIVÉ
// (Bruno la suit) ; Fred est suspendu ; Gina refuse toute mention ; Eve sert
// aux blocages ; Hugo au budget de l'heure.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const FRED = "f0000000-0000-4000-8000-000000000006";
const PAULA = "70000000-0000-4000-8000-000000000007";
const GINA = "80000000-0000-4000-8000-000000000008";
const HUGO = "90000000-0000-4000-8000-000000000009";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const ANNA_PUBLIC = "a1000000-0000-4000-8000-000000000001";
const ANNA_FOLLOWERS = "a1000000-0000-4000-8000-000000000002";
const ANNA_PRIVATE = "a1000000-0000-4000-8000-000000000003";
const ANNA_HIDDEN = "a1000000-0000-4000-8000-000000000004";
const ANNA_PURCHASE = "a1000000-0000-4000-8000-000000000005";
const ANNA_OLD = "a1000000-0000-4000-8000-000000000006";
const PAULA_PUBLIC = "71000000-0000-4000-8000-000000000001";
const BRUNO_PUBLIC = "b1000000-0000-4000-8000-000000000001";

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };
const UNAVAILABLE = { error: POST_EXTRAS_UNAVAILABLE_ERROR, message: "Les photos multiples et les identifications ne sont pas encore disponibles." };
const TAG_NOT_FOUND = { error: "people_tag_not_found", message: "Identification introuvable." };

const PHOTO = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#7A5A44" } }).jpeg().toBuffer();
const NOT_AN_IMAGE = Buffer.from("ceci n'est pas une photo");

const stored = (user: string, name: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/${name}`;

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

/** Il y a quelques secondes (dans la fenêtre des 10 minutes), sauf `minutesAgo`. */
function post(id: string, userId: string, privacy: PrivacyLevel, extra: { hidden?: boolean; type?: string; minutesAgo?: number } = {}): Row {
  const type = extra.type ?? "lifestyle";
  return {
    id,
    user_id: userId,
    type,
    vault_item_id: null,
    wishlist_item_id: null,
    caption: `Publication ${privacy}`,
    media_url: stored(userId, `${id}.jpg`),
    media_thumb_url: type === "lifestyle" ? stored(userId, `${id}-mini.jpg`) : null,
    media_removed_at: null,
    privacy,
    hidden_at: extra.hidden ? "2026-11-12T00:00:00+00:00" : null,
    created_at: new Date(Date.now() - (extra.minutesAgo ?? 0.1) * 60_000).toISOString(),
  };
}

interface Seed {
  /** [abonné, compte suivi] ; par défaut Bruno et Dora suivent Anna, Bruno suit Paula. */
  follows?: [string, string][];
  blocks?: [string, string][];
  suspended?: string[];
  mentionsFrom?: Record<string, MentionsFrom>;
  /** [publication, membre identifié] (l'auteur est celui de la publication). */
  tags?: [string, string][];
  /** [publication, nombre de photos 2 à 5 déjà là]. */
  media?: [string, number][];
}

const POSTS = (): Row[] => [
  post(ANNA_PUBLIC, ANNA, "public"),
  post(ANNA_FOLLOWERS, ANNA, "followers"),
  post(ANNA_PRIVATE, ANNA, "private"),
  post(ANNA_HIDDEN, ANNA, "public", { hidden: true }),
  post(ANNA_PURCHASE, ANNA, "public", { type: "purchase" }),
  post(ANNA_OLD, ANNA, "public", { minutesAgo: POST_MEDIA_WINDOW_MIN + 1 }),
  post(PAULA_PUBLIC, PAULA, "public"),
  post(BRUNO_PUBLIC, BRUNO, "public"),
];

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const setting = (id: string) => ({ mentionsFrom: seed.mentionsFrom?.[id] });
  fake
    .table("profiles")
    .push(
      profile(ANNA, "anna", setting(ANNA)),
      profile(BRUNO, "bruno", setting(BRUNO)),
      profile(CARL, "carl", setting(CARL)),
      profile(DORA, "dora", setting(DORA)),
      profile(EVE, "eve", setting(EVE)),
      profile(FRED, "fred", setting(FRED)),
      profile(PAULA, "paula", { ...setting(PAULA), isPrivate: true }),
      profile(GINA, "gina", { mentionsFrom: seed.mentionsFrom?.[GINA] ?? "nobody" }),
      profile(HUGO, "hugo", setting(HUGO))
    );
  const posts = POSTS();
  fake.table("posts").push(...posts);
  const authorOf = new Map(posts.map((row) => [row.id as string, row.user_id as string]));
  for (const [follower, followee] of seed.follows ?? [
    [BRUNO, ANNA],
    [DORA, ANNA],
    [BRUNO, PAULA],
  ])
    fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const id of seed.suspended ?? [FRED]) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  for (const [postId, user] of seed.tags ?? []) fake.table("post_people_tags").push({ post_id: postId, user_id: user, author_id: authorOf.get(postId), created_at: "2026-11-18T09:00:00+00:00" });
  for (const [postId, count] of seed.media ?? []) {
    const author = authorOf.get(postId)!;
    for (let position = 1; position <= count; position += 1) {
      fake.table("post_media").push({ id: `${postId.slice(0, 30)}${String(position).padStart(6, "0")}`, user_id: author, post_id: postId, position, media_url: stored(author, `${postId}-${position}.jpg`), media_thumb_url: stored(author, `${postId}-${position}-mini.jpg`), created_at: "2026-11-18T09:00:00+00:00" });
      fake.files.set(`post-media/${author}/${postId}-${position}.jpg`, Buffer.alloc(1));
      fake.files.set(`post-media/${author}/${postId}-${position}-mini.jpg`, Buffer.alloc(1));
    }
  }
  return fake;
}

/** Base sans la migration 0047 : ni les photos 2 à 5, ni les identifications. */
const WITHOUT_0047: FakeDbOptions = { missing: ["post_media", "post_people_tags"] };

type Fake = ReturnType<typeof fakeSupabase>;
type Db = Fake["db"];

/** Une table qui ne répond plus (délai dépassé), quand `broken()` le dit ; les autres, normalement. */
function withBrokenTable(db: Db, table: string, broken: () => boolean): Db {
  const failure = { data: null, error: { code: "57014", message: "délai dépassé" }, count: null };
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "then") return (resolve: (value: unknown) => unknown) => Promise.resolve(failure).then(resolve);
        if (property === "single" || property === "maybeSingle" || property === "range") return () => Promise.resolve(failure);
        return () => chain;
      },
    }
  );
  return { ...db, from: (name: string) => (name === table && broken() ? (chain as unknown as ReturnType<Db["from"]>) : db.from(name)) };
}

/** Compte les requêtes faites à chaque table. */
function counting(db: Db): { db: Db; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    db: {
      ...db,
      from: (name: string) => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        return db.from(name);
      },
    },
  };
}

let app: FastifyInstance | null = null;
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

async function photosApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  limitNames = new Map();
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(multipart, { limits: { files: 1 } });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  app.addHook("onRoute", (route) => {
    limitNames.set(`${String(route.method)} ${route.url}`, route.config?.rateLimitName);
  });
  await app.register(postsRoutes);
  await app.register(usersRoutes);
  await app.register(followsRoutes);
  await app.register(blocksRoutes);
  await app.register(meRoutes);
  await app.register(notificationsRoutes);
  await app.register(accountRoutes);
  await app.ready();
  return app;
}

const BOUNDARY = "----spotto-photos";
function multipartBody(fields: Record<string, string>, file?: { data: Buffer; type?: string }) {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: ${file.type ?? "image/jpeg"}\r\n\r\n`), file.data, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    patch: (url: string, payload: object) => target.inject({ method: "PATCH", url, headers, payload }),
    /** Publier : une photo (« Une photo ») ou une pièce du Vault (« achat »), et des identifications. */
    publish: (options: { privacy?: PrivacyLevel; peopleTags?: unknown; type?: "lifestyle" | "purchase" } = {}) => {
      const fields: Record<string, string> = { type: options.type ?? "lifestyle", privacy: options.privacy ?? "public" };
      if (options.peopleTags !== undefined) fields.peopleTags = typeof options.peopleTags === "string" ? options.peopleTags : JSON.stringify(options.peopleTags);
      if (options.type === "purchase") fields.vaultItemId = UNKNOWN;
      const body = multipartBody(fields, options.type === "purchase" ? undefined : { data: PHOTO });
      return target.inject({ method: "POST", url: "/api/posts", headers: { ...headers, ...body.headers }, payload: body.payload });
    },
    /** Ajouter une photo à une publication. */
    addPhoto: (postId: string, file: { data: Buffer; type?: string } = { data: PHOTO }) => {
      const body = multipartBody({}, file);
      return target.inject({ method: "POST", url: `/api/posts/${postId}/media`, headers: { ...headers, ...body.headers }, payload: body.payload });
    },
  };
}

const tagsOf = (fake: Fake) =>
  fake
    .table("post_people_tags")
    .map((row) => `${String(row.post_id).slice(0, 2)}${String(row.post_id).slice(-1)}>${String(row.user_id).slice(0, 1)}`)
    .sort();
const tagKey = (postId: string, user: string) => `${postId.slice(0, 2)}${postId.slice(-1)}>${user.slice(0, 1)}`;
const tagNotices = (fake: Fake) => fake.table("notifications").filter((row) => row.type === "tag");
const noticePairs = (fake: Fake) => tagNotices(fake).map((row) => `${String(row.actor_id).slice(0, 1)}>${String(row.user_id).slice(0, 1)}`).sort();
const peopleIds = (value: Post) => (value.people ?? []).map((person) => person.id);
async function seen(target: FastifyInstance, viewer: string, postId: string): Promise<Post> {
  const response = await as(target, viewer).get(`/api/posts/${postId}`);
  expect(response.statusCode, `${viewer} voit ${postId}`).toBe(200);
  return response.json();
}
/** Toutes les photos de la base pour une publication (positions). */
const positionsOf = (fake: Fake, postId: string) =>
  fake
    .table("post_media")
    .filter((row) => row.post_id === postId)
    .map((row) => Number(row.position))
    .sort();

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetPrivateAccountsProbe();
  resetCommentThreadsProbe();
  resetPostExtrasProbe();
});

afterEach(async () => {
  vi.useRealTimers();
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("sans la migration 0047 : tout répond comme avant", () => {
  it("l'app l'apprend par GET /api/posts/status (une photo, pas d'identification)", async () => {
    const target = await photosApp(seeded({}, WITHOUT_0047).db);
    const status: PostExtrasStatus = (await as(target, ANNA).get("/api/posts/status")).json();
    expect(status).toEqual({ carousel: false, peopleTags: false });
  });

  it("refusé : une publication AVEC des identifications répond 404 avant toute écriture (ni publication, ni fichier)", async () => {
    const fake = seeded({}, WITHOUT_0047);
    const target = await photosApp(fake.db);
    const before = fake.table("posts").length;
    const response = await as(target, ANNA).publish({ peopleTags: [BRUNO] });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(UNAVAILABLE);
    expect(fake.table("posts")).toHaveLength(before);
    expect(fake.uploads).toEqual([]);
    expect(tagNotices(fake)).toEqual([]);
  });

  it("permis : une publication sans identification part comme avant, sans `media` ni `people`", async () => {
    const fake = seeded({}, WITHOUT_0047);
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).publish();
    expect(response.statusCode).toBe(200);
    const created: Post = response.json();
    expect(created).not.toHaveProperty("media");
    expect(created).not.toHaveProperty("people");
    // Une liste vide d'identifications ne demande rien à la base absente.
    expect((await as(target, ANNA).publish({ peopleTags: [] })).statusCode).toBe(200);
    const feed = (await as(target, BRUNO).get("/api/feed")).json() as { posts: Post[] };
    for (const item of feed.posts) {
      expect(item).not.toHaveProperty("media");
      expect(item).not.toHaveProperty("people");
    }
  });

  it("ajouter une photo, retirer une identification : 404 « indisponible », rien n'est envoyé ; supprimer une publication marche", async () => {
    const fake = seeded({}, WITHOUT_0047);
    const target = await photosApp(fake.db);
    const added = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
    expect(added.statusCode).toBe(404);
    expect(added.json()).toEqual(UNAVAILABLE);
    expect(fake.uploads).toEqual([]);
    const removed = await as(target, BRUNO).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${BRUNO}`);
    expect(removed.statusCode).toBe(404);
    expect(removed.json()).toEqual(UNAVAILABLE);
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}`)).statusCode).toBe(204);
    // Les gestes qui retirent les identifications ne cassent rien non plus.
    expect((await as(target, BRUNO).del(`/api/follows/${ANNA}`)).statusCode).toBe(204);
    expect((await as(target, ANNA).post(`/api/blocks/${CARL}`)).statusCode).toBe(204);
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_FOLLOWERS}`, { privacy: "private" })).statusCode).toBe(200);
  });

  it("sonde illisible (base qui ne répond plus) : jamais « absente » par défaut — 500 avant toute écriture ; le statut dit « non »", async () => {
    const fake = seeded();
    const target = await photosApp(withBrokenTable(fake.db, "post_media", () => true));
    expect((await as(target, ANNA).get("/api/posts/status")).json()).toEqual({ carousel: false, peopleTags: false });
    const before = fake.table("posts").length;
    expect((await as(target, ANNA).publish({ peopleTags: [BRUNO] })).statusCode).toBe(500);
    expect(fake.table("posts")).toHaveLength(before);
    expect((await as(target, ANNA).addPhoto(ANNA_PUBLIC)).statusCode).toBe(500);
    expect(fake.uploads).toEqual([]);
    // Supprimer : rien n'est supprimé (les photos 2 à 5 ne sauraient être effacées), à réessayer.
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}`)).statusCode).toBe(500);
    expect(fake.table("posts").some((row) => row.id === ANNA_PUBLIC)).toBe(true);
    await expect(postExtrasReady({ supabaseAdmin: withBrokenTable(fake.db, "post_media", () => true), log: target.log } as never)).rejects.toThrow(DatabaseReadError);
  });

  it("avec la migration : le statut dit oui, sonde mémorisée", async () => {
    const target = await photosApp(seeded().db);
    expect((await as(target, ANNA).get("/api/posts/status")).json()).toEqual({ carousel: true, peopleTags: true });
  });
});

describe("règle 1 : les photos 2 à 5 ne sortent que dans une publication que le lecteur peut voir", () => {
  it("permis : un abonné reçoit toutes les photos, la première comprise, dans l'ordre", async () => {
    const target = await photosApp(seeded({ media: [[ANNA_FOLLOWERS, 3]] }).db);
    const value = await seen(target, BRUNO, ANNA_FOLLOWERS);
    expect(value.media?.map((photo) => photo.url)).toEqual([
      stored(ANNA, `${ANNA_FOLLOWERS}.jpg`),
      stored(ANNA, `${ANNA_FOLLOWERS}-1.jpg`),
      stored(ANNA, `${ANNA_FOLLOWERS}-2.jpg`),
      stored(ANNA, `${ANNA_FOLLOWERS}-3.jpg`),
    ]);
    expect(value.media?.[0]?.thumbUrl).toBe(stored(ANNA, `${ANNA_FOLLOWERS}-mini.jpg`));
    expect(value.media?.[3]?.thumbUrl).toBe(stored(ANNA, `${ANNA_FOLLOWERS}-3-mini.jpg`));
    // La photo 1 reste où elle était : une ancienne app la montre.
    expect(value.mediaUrl).toBe(stored(ANNA, `${ANNA_FOLLOWERS}.jpg`));
  });

  it("refusé : un inconnu ne reçoit rien — 404, absente de son fil et du profil", async () => {
    const target = await photosApp(seeded({ media: [[ANNA_FOLLOWERS, 3]] }).db);
    const response = await as(target, CARL).get(`/api/posts/${ANNA_FOLLOWERS}`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(POST_NOT_FOUND);
    expect(response.body).not.toContain(`${ANNA_FOLLOWERS}-1.jpg`);
    const profilePosts = await as(target, CARL).get(`/api/users/${ANNA}/posts`);
    expect(profilePosts.body).not.toContain(`${ANNA_FOLLOWERS}-1.jpg`);
    expect((await as(target, CARL).get("/api/feed")).body).not.toContain(`${ANNA_FOLLOWERS}-1.jpg`);
  });

  it("une publication d'une seule photo n'a pas de `media` ; deux lectures par page pour tout le fil", async () => {
    const fake = seeded({ media: [[ANNA_PUBLIC, 2]], tags: [[ANNA_FOLLOWERS, DORA]] });
    const { db, counts } = counting(fake.db);
    const target = await photosApp(db);
    await as(target, BRUNO).get("/api/posts/status");
    counts.clear();
    const feed = (await as(target, BRUNO).get("/api/feed")).json() as { posts: Post[] };
    const byId = new Map(feed.posts.map((item) => [item.id, item]));
    expect(byId.get(ANNA_PUBLIC)?.media).toHaveLength(3);
    expect(byId.get(ANNA_FOLLOWERS)).not.toHaveProperty("media");
    expect(peopleIds(byId.get(ANNA_FOLLOWERS)!)).toEqual([DORA]);
    expect(counts.get("post_media")).toBe(1);
    expect(counts.get("post_people_tags")).toBe(1);
  });
});

describe("règle 2 : une photo s'ajoute par l'auteur, à une publication « Une photo » non masquée, dans les 10 minutes", () => {
  it("permis : l'auteur ajoute les photos 2 à 5, une par requête, chacune à sa place ; la réponse les donne toutes", async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    for (let index = 1; index <= POST_PHOTOS_MAX - 1; index += 1) {
      const response = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
      expect(response.statusCode).toBe(201);
      const body: AddPostMediaResponse = response.json();
      expect(body.media).toHaveLength(index + 1);
      expect(body.media[0]!.url).toBe(stored(ANNA, `${ANNA_PUBLIC}.jpg`));
    }
    expect(positionsOf(fake, ANNA_PUBLIC)).toEqual([1, 2, 3, 4]);
    // Rangées comme la photo 1 : dans le dossier de l'autrice, une version et une miniature.
    expect(fake.uploads).toHaveLength(8);
    for (const path of fake.uploads) expect(path.startsWith(`post-media/${ANNA}/`)).toBe(true);
    expect(fake.uploads.filter((path) => path.endsWith("-mini.jpg"))).toHaveLength(4);
    expect((await seen(target, DORA, ANNA_PUBLIC)).media).toHaveLength(POST_PHOTOS_MAX);
  });

  it("refusé : la 5e photo de plus (6e en tout) — 409, avant tout envoi", async () => {
    const fake = seeded({ media: [[ANNA_PUBLIC, POST_PHOTOS_MAX - 1]] });
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: POST_MEDIA_FULL_ERROR, message: "Cette publication a déjà ses 5 photos." });
    expect(fake.uploads).toEqual([]);
  });

  it("refusé : un autre membre, même abonné — 404, rien n'est envoyé", async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    for (const intruder of [BRUNO, CARL]) {
      const response = await as(target, intruder).addPhoto(ANNA_PUBLIC);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(POST_NOT_FOUND);
    }
    expect(fake.uploads).toEqual([]);
    expect(fake.table("post_media")).toEqual([]);
  });

  it("refusé : une publication masquée par la modération, une publication « achat », une publication inconnue — 404", async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    for (const postId of [ANNA_HIDDEN, ANNA_PURCHASE, UNKNOWN]) {
      const response = await as(target, ANNA).addPhoto(postId);
      expect(response.statusCode, postId).toBe(404);
      expect(response.json()).toEqual(POST_NOT_FOUND);
    }
    expect(fake.uploads).toEqual([]);
  });

  it("refusé : à la 11e minute — 409 « ne peut plus recevoir de photo » ; à la 9e, permis", async () => {
    const fake = seeded();
    fake.table("posts").push(post("a1000000-0000-4000-8000-000000000009", ANNA, "public", { minutesAgo: POST_MEDIA_WINDOW_MIN - 1 }));
    const target = await photosApp(fake.db);
    const late = await as(target, ANNA).addPhoto(ANNA_OLD);
    expect(late.statusCode).toBe(409);
    expect(late.json()).toEqual({ error: POST_MEDIA_CLOSED_ERROR, message: "Cette publication ne peut plus recevoir de photo." });
    expect(fake.uploads).toEqual([]);
    expect((await as(target, ANNA).addPhoto("a1000000-0000-4000-8000-000000000009")).statusCode).toBe(201);
  });

  it("refusé : un compte suspendu (403), un fichier qui n'est pas une image (400, aucun fichier rangé)", async () => {
    const fake = seeded({ suspended: [ANNA] });
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).addPhoto(ANNA_PUBLIC)).statusCode).toBe(403);
    const other = seeded();
    await target.close();
    const second = await photosApp(other.db);
    const unreadable = await as(second, ANNA).addPhoto(ANNA_PUBLIC, { data: NOT_AN_IMAGE });
    expect(unreadable.statusCode).toBe(400);
    expect(unreadable.json()).toEqual({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
    expect((await as(second, ANNA).addPhoto(ANNA_PUBLIC, { data: PHOTO, type: "text/plain" })).statusCode).toBe(400);
    expect(other.uploads).toEqual([]);
  });

  it("deux envois en même temps : la place prise est réessayée une fois à la suivante", async () => {
    let first = true;
    const fake = seeded(
      {},
      {
        failWrite: (table, action) => {
          if (table !== "post_media" || action !== "insert" || !first) return null;
          first = false;
          // L'autre envoi prend la place 1 juste avant.
          fake.table("post_media").push({ id: "a9000000-0000-4000-8000-000000000001", user_id: ANNA, post_id: ANNA_PUBLIC, position: 1, media_url: "autre", media_thumb_url: "autre-mini" });
          return { code: "23505", message: "duplicate key value violates unique constraint" };
        },
      }
    );
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
    expect(response.statusCode).toBe(201);
    expect(positionsOf(fake, ANNA_PUBLIC)).toEqual([1, 2]);
    expect((response.json() as AddPostMediaResponse).media).toHaveLength(3);
  });

  it("la place reste prise à la seconde tentative : 409, et les deux fichiers sont effacés", async () => {
    const fake = seeded({}, { failWrite: (table, action) => (table === "post_media" && action === "insert" ? { code: "23505", message: "duplicate key" } : null) });
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: POST_MEDIA_CONFLICT_ERROR, message: "Une autre photo de cette publication arrivait au même moment. Réessayez." });
    expect(fake.uploads).toHaveLength(2);
    expect([...fake.removed].sort()).toEqual([...fake.uploads].sort());
    expect([...fake.files.keys()].filter((key) => fake.uploads.includes(key))).toEqual([]);
  });

  it("l'enregistrement échoue : 500, et les deux fichiers juste rangés sont effacés (rien d'orphelin)", async () => {
    const fake = seeded({}, { failWrite: (table, action) => (table === "post_media" && action === "insert" ? { code: "XX000", message: "panne" } : null) });
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).addPhoto(ANNA_PUBLIC);
    expect(response.statusCode).toBe(500);
    expect(fake.uploads).toHaveLength(2);
    expect([...fake.removed].sort()).toEqual([...fake.uploads].sort());
    expect(fake.table("post_media")).toEqual([]);
  });

  it("chaque requête compte dans la limite « postMedia » (60 par heure), qui a son message", () => {
    expect(RATE_LIMITS.postMedia).toMatchObject({ max: 60, windowMs: 60 * 60_000, error: POST_MEDIA_LIMIT_ERROR });
    expect(localizeMessage(RATE_LIMITS.postMedia.message, 429, "en")).toBe("You've added a lot of photos in a short time. Please try again in a moment.");
  });

  it("la route déclare sa limite (jamais la limite « default » par-dessus)", async () => {
    await photosApp(seeded().db);
    expect(limitNames.get("POST /api/posts/:id/media")).toBe("postMedia");
  });
});

describe("supprimer une publication efface aussi les fichiers des photos 2 à 5", () => {
  it("photo 1 et photos 2 à 5 : les dix fichiers partent ; la base efface les lignes en cascade", async () => {
    const fake = seeded({ media: [[ANNA_PUBLIC, 4]] });
    fake.files.set(`post-media/${ANNA}/${ANNA_PUBLIC}.jpg`, Buffer.alloc(1));
    fake.files.set(`post-media/${ANNA}/${ANNA_PUBLIC}-mini.jpg`, Buffer.alloc(1));
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}`)).statusCode).toBe(204);
    expect(fake.removed.filter((path) => path.startsWith(`post-media/${ANNA}/${ANNA_PUBLIC}`))).toHaveLength(10);
    expect([...fake.files.keys()].filter((key) => key.includes(ANNA_PUBLIC))).toEqual([]);
    expect(fake.table("post_media")).toEqual([]);
  });

  it("lecture des photos impossible : rien n'est supprimé, à réessayer", async () => {
    const fake = seeded({ media: [[ANNA_PUBLIC, 2]] });
    let broken = false;
    const target = await photosApp(withBrokenTable(fake.db, "post_media", () => broken));
    await as(target, ANNA).get("/api/posts/status");
    broken = true;
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}`)).statusCode).toBe(500);
    expect(fake.table("posts").some((row) => row.id === ANNA_PUBLIC)).toBe(true);
    expect(fake.removed).toEqual([]);
  });
});

describe("règle 3 : un membre identifié en blocage avec le lecteur n'apparaît pas", () => {
  it("refusé : bloqué par le lecteur, ou qui a bloqué le lecteur ; permis : les autres", async () => {
    const target = await photosApp(seeded({ tags: [[ANNA_PUBLIC, BRUNO], [ANNA_PUBLIC, DORA], [ANNA_PUBLIC, EVE]], blocks: [[CARL, BRUNO], [EVE, CARL]] }).db);
    expect(peopleIds(await seen(target, CARL, ANNA_PUBLIC))).toEqual([DORA]);
    // Un autre lecteur voit les trois.
    expect(peopleIds(await seen(target, DORA, ANNA_PUBLIC)).sort()).toEqual([BRUNO, DORA, EVE].sort());
  });
});

describe("règle 4 : un compte privé identifié n'est montré qu'à lui-même, à l'auteur et à ses abonnés ; un compte suspendu, à personne", () => {
  it("refusé : un inconnu ne voit pas Paula (privée) ; permis : Paula, Anna (l'autrice) et Bruno (abonné de Paula)", async () => {
    const target = await photosApp(seeded({ tags: [[ANNA_PUBLIC, PAULA], [ANNA_PUBLIC, DORA]] }).db);
    expect(peopleIds(await seen(target, CARL, ANNA_PUBLIC))).toEqual([DORA]);
    expect(peopleIds(await seen(target, DORA, ANNA_PUBLIC))).toEqual([DORA]);
    for (const viewer of [PAULA, ANNA, BRUNO]) expect(peopleIds(await seen(target, viewer, ANNA_PUBLIC)), viewer).toEqual([PAULA, DORA]);
  });

  it("refusé : Fred, suspendu, n'apparaît pour personne, pas même pour l'autrice", async () => {
    const target = await photosApp(seeded({ tags: [[ANNA_PUBLIC, FRED]] }).db);
    for (const viewer of [ANNA, BRUNO, CARL]) expect(await seen(target, viewer, ANNA_PUBLIC), viewer).not.toHaveProperty("people");
  });

  it("chaque personne : nom, nom affiché, photo — rien d'autre", async () => {
    const target = await photosApp(seeded({ tags: [[ANNA_PUBLIC, DORA]] }).db);
    expect((await seen(target, CARL, ANNA_PUBLIC)).people).toEqual([{ id: DORA, username: "dora", displayName: "Dora", avatarUrl: null }]);
  });
});

describe("règle 5 : une identification ne donne jamais accès, et se perd avec l'accès", () => {
  it("à la publication : refusé, qui ne peut pas voir la publication (« Abonnés », « Moi seul », compte privé) ; permis, qui la voit", async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    const followersOnly = await as(target, ANNA).publish({ privacy: "followers", peopleTags: [CARL, BRUNO] });
    expect(followersOnly.statusCode).toBe(200);
    expect(peopleIds(followersOnly.json())).toEqual([BRUNO]);
    const onlyMe = await as(target, ANNA).publish({ privacy: "private", peopleTags: [BRUNO, DORA] });
    expect(onlyMe.json()).not.toHaveProperty("people");
    // Compte privé de Paula : Carl ne la suit pas ; Bruno, oui.
    const paula = await as(target, PAULA).publish({ privacy: "public", peopleTags: [CARL, BRUNO] });
    expect(peopleIds(paula.json())).toEqual([BRUNO]);
    // Anna → Bruno, Paula (identifiant en « 7 ») → Bruno.
    expect(noticePairs(fake)).toEqual(["7>b", "a>b"]);
    // Carl n'apprend jamais que ces publications existent.
    expect(tagNotices(fake).some((row) => row.user_id === CARL)).toBe(false);
  });

  it("visibilité réduite (publique → « Abonnés ») : l'inconnu perd son identification et sa notification ; l'abonné la garde", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, CARL], [ANNA_PUBLIC, BRUNO], [ANNA_FOLLOWERS, DORA]] });
    fake.table("notifications").push(
      { id: "e1000000-0000-4000-8000-000000000001", user_id: CARL, actor_id: ANNA, type: "tag", post_id: ANNA_PUBLIC, read_at: null, hidden_at: null, created_at: "2026-11-18T09:00:00+00:00" },
      { id: "e1000000-0000-4000-8000-000000000002", user_id: BRUNO, actor_id: ANNA, type: "tag", post_id: ANNA_PUBLIC, read_at: null, hidden_at: null, created_at: "2026-11-18T09:00:00+00:00" }
    );
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "followers" })).statusCode).toBe(200);
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_PUBLIC, BRUNO), tagKey(ANNA_FOLLOWERS, DORA)].sort());
    expect(noticePairs(fake)).toEqual(["a>b"]);
    // Élargir ne retire rien.
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "public" })).statusCode).toBe(200);
    expect(tagsOf(fake)).toHaveLength(2);
    // « Moi seul » : plus personne.
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "private" })).statusCode).toBe(200);
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_FOLLOWERS, DORA)]);
  });

  it("compte passé en privé : qui n'est pas un abonné accepté perd ses identifications sur toutes les publications ; repasser en public ne retire rien", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, CARL], [ANNA_PUBLIC, BRUNO], [ANNA_OLD, CARL], [BRUNO_PUBLIC, CARL]] });
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).put("/api/me/private-account", { isPrivate: false })).statusCode).toBe(204);
    expect(tagsOf(fake)).toHaveLength(4);
    expect((await as(target, ANNA).put("/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    // Les publications de Bruno ne sont pas touchées.
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_PUBLIC, BRUNO), tagKey(BRUNO_PUBLIC, CARL)].sort());
  });

  it("abonnement retiré par le membre : il perd l'identification d'une publication « Abonnés », garde celle d'une publication publique d'un compte public", async () => {
    const fake = seeded({ tags: [[ANNA_FOLLOWERS, BRUNO], [ANNA_PUBLIC, BRUNO], [ANNA_FOLLOWERS, DORA]] });
    const target = await photosApp(fake.db);
    expect((await as(target, BRUNO).del(`/api/follows/${ANNA}`)).statusCode).toBe(204);
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_PUBLIC, BRUNO), tagKey(ANNA_FOLLOWERS, DORA)].sort());
    // Compte privé : plus rien du tout.
    const privateFake = seeded({ tags: [[PAULA_PUBLIC, BRUNO]] });
    await target.close();
    const second = await photosApp(privateFake.db);
    expect((await as(second, BRUNO).del(`/api/follows/${PAULA}`)).statusCode).toBe(204);
    expect(tagsOf(privateFake)).toEqual([]);
  });

  it("abonné retiré par l'autrice : il perd l'identification d'une publication « Abonnés » ; un autre abonné garde la sienne", async () => {
    const fake = seeded({ tags: [[ANNA_FOLLOWERS, BRUNO], [ANNA_FOLLOWERS, DORA], [ANNA_PUBLIC, BRUNO]] });
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).del(`/api/followers/${BRUNO}`)).statusCode).toBe(204);
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_FOLLOWERS, DORA), tagKey(ANNA_PUBLIC, BRUNO)].sort());
  });

  it("blocage : toutes les identifications entre les deux comptes partent, dans les deux sens, et leurs notifications", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, BRUNO], [ANNA_FOLLOWERS, BRUNO], [BRUNO_PUBLIC, ANNA], [ANNA_PUBLIC, DORA]] });
    fake.table("notifications").push({ id: "e1000000-0000-4000-8000-000000000003", user_id: BRUNO, actor_id: ANNA, type: "tag", post_id: ANNA_PUBLIC, read_at: null, hidden_at: null, created_at: "2026-11-18T09:00:00+00:00" });
    const target = await photosApp(fake.db);
    expect((await as(target, BRUNO).post(`/api/blocks/${ANNA}`)).statusCode).toBe(204);
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_PUBLIC, DORA)]);
    expect(tagNotices(fake)).toEqual([]);
  });

  it("dropUnseeableTags relève une erreur quand une écriture échoue (l'appelant la journalise, son geste est déjà fait)", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, CARL]] }, { failWrite: (table, action) => (table === "post_people_tags" && action === "delete" ? { message: "panne" } : null) });
    fake.table("posts").find((row) => row.id === ANNA_PUBLIC)!.privacy = "followers";
    await expect(dropUnseeableTags({ supabaseAdmin: fake.db, log: Fastify().log } as never, { authorId: ANNA })).rejects.toThrow();
    // Et la route qui l'appelle répond quand même : la visibilité est changée.
    const target = await photosApp(fake.db);
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "followers" })).statusCode).toBe(200);
  });
});

describe("règle 6 : le réglage « Qui peut me mentionner » vaut pour les identifications", () => {
  it("« personne » : jamais ; « les comptes que je suis » : seulement par eux ; « tout le monde » : oui ; l'autrice ne sait pas qui a refusé", async () => {
    const fake = seeded({ mentionsFrom: { [BRUNO]: "following", [CARL]: "following", [EVE]: "everyone", [GINA]: "nobody" }, follows: [[BRUNO, ANNA], [CARL, BRUNO], [GINA, ANNA]] });
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).publish({ peopleTags: [GINA, CARL, BRUNO, EVE] });
    expect(response.statusCode).toBe(200);
    const created: Post = response.json();
    expect(peopleIds(created)).toEqual([BRUNO, EVE]);
    expect(noticePairs(fake)).toEqual(["a>b", "a>e"]);
    // Rien dans la réponse ne nomme Gina ni Carl.
    expect(response.body).not.toContain(GINA);
    expect(response.body).not.toContain(CARL);
    expect(response.body).not.toContain("gina");
  });

  it("la valeur de départ (« les comptes que je suis ») protège un compte qui ne suit pas l'autrice", async () => {
    const fake = seeded({ mentionsFrom: { [DORA]: "following", [CARL]: "following" }, follows: [[DORA, ANNA]] });
    const target = await photosApp(fake.db);
    expect(peopleIds((await as(target, ANNA).publish({ peopleTags: [CARL, DORA] })).json())).toEqual([DORA]);
  });

  it("refusé en silence : un compte inconnu, sans nom d'utilisateur, l'autrice elle-même, un compte suspendu, un compte en blocage", async () => {
    const fake = seeded({ blocks: [[EVE, ANNA]] });
    fake.table("profiles").push(profile("50000000-0000-4000-8000-000000000005", null));
    const target = await photosApp(fake.db);
    const response = await as(target, ANNA).publish({ peopleTags: [UNKNOWN, "50000000-0000-4000-8000-000000000005", ANNA, FRED, EVE] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("people");
    expect(tagsOf(fake)).toEqual([]);
    expect(tagNotices(fake)).toEqual([]);
  });
});

describe("règle 7 : seul le membre identifié ou l'autrice retire une identification", () => {
  it("refusé : un autre membre — 404, l'identification reste", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, BRUNO]] });
    const target = await photosApp(fake.db);
    for (const intruder of [CARL, DORA]) {
      const response = await as(target, intruder).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${BRUNO}`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(TAG_NOT_FOUND);
    }
    expect(tagsOf(fake)).toEqual([tagKey(ANNA_PUBLIC, BRUNO)]);
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${DORA}`)).statusCode).toBe(404);
  });

  it("permis : le membre retire la sienne (et sa notification) ; l'autrice retire celle d'un autre", async () => {
    const fake = seeded({ tags: [[ANNA_PUBLIC, BRUNO], [ANNA_PUBLIC, DORA]] });
    fake.table("notifications").push({ id: "e1000000-0000-4000-8000-000000000004", user_id: BRUNO, actor_id: ANNA, type: "tag", post_id: ANNA_PUBLIC, read_at: null, hidden_at: null, created_at: "2026-11-18T09:00:00+00:00" });
    const target = await photosApp(fake.db);
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${BRUNO}`)).statusCode).toBe(204);
    expect(tagNotices(fake)).toEqual([]);
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${DORA}`)).statusCode).toBe(204);
    expect(tagsOf(fake)).toEqual([]);
    // Une seconde fois : il n'y a plus rien à retirer.
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_PUBLIC}/people-tags/${BRUNO}`)).statusCode).toBe(404);
  });

  it("permis : le membre retire la sienne sans voir la publication (« Moi seul », masquée, compte privé)", async () => {
    const fake = seeded({ tags: [[ANNA_PRIVATE, BRUNO], [ANNA_HIDDEN, BRUNO], [PAULA_PUBLIC, CARL]] });
    const target = await photosApp(fake.db);
    expect((await as(target, BRUNO).get(`/api/posts/${ANNA_PRIVATE}`)).statusCode).toBe(404);
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_PRIVATE}/people-tags/${BRUNO}`)).statusCode).toBe(204);
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_HIDDEN}/people-tags/${BRUNO}`)).statusCode).toBe(204);
    expect((await as(target, CARL).del(`/api/posts/${PAULA_PUBLIC}/people-tags/${CARL}`)).statusCode).toBe(204);
    expect(tagsOf(fake)).toEqual([]);
  });

  it("identifiants mal formés : 400", async () => {
    const target = await photosApp(seeded().db);
    expect((await as(target, BRUNO).del(`/api/posts/pas-un-id/people-tags/${BRUNO}`)).statusCode).toBe(400);
    expect((await as(target, BRUNO).del(`/api/posts/${ANNA_PUBLIC}/people-tags/pas-un-id`)).statusCode).toBe(400);
  });
});

describe("règle 8 : une publication masquée cache toutes ses photos et ses identifications, partout", () => {
  it("refusé : ni le détail (même pour l'autrice), ni le fil, ni « mes publications », ni le profil", async () => {
    const target = await photosApp(seeded({ media: [[ANNA_HIDDEN, 3]], tags: [[ANNA_HIDDEN, BRUNO]] }).db);
    for (const viewer of [ANNA, BRUNO]) expect((await as(target, viewer).get(`/api/posts/${ANNA_HIDDEN}`)).statusCode).toBe(404);
    for (const url of ["/api/feed", "/api/posts/mine", `/api/users/${ANNA}/posts`]) {
      const body = (await as(target, url === "/api/posts/mine" ? ANNA : BRUNO).get(url)).body;
      expect(body, url).not.toContain(`${ANNA_HIDDEN}-1.jpg`);
      expect(body, url).not.toContain(ANNA_HIDDEN);
    }
  });

  it("permis : la publication visible voisine garde les siennes", async () => {
    const target = await photosApp(seeded({ media: [[ANNA_PUBLIC, 1]], tags: [[ANNA_PUBLIC, BRUNO]] }).db);
    const mine = (await as(target, ANNA).get("/api/posts/mine")).json() as Post[];
    const value = mine.find((item) => item.id === ANNA_PUBLIC)!;
    expect(value.media).toHaveLength(2);
    expect(peopleIds(value)).toEqual([BRUNO]);
  });
});

describe("règle 9 : 5 identifications par publication, 20 par heure et par auteur (horloge simulée)", () => {
  it(`refusé : ${PEOPLE_TAGS_MAX + 1} identifications, un doublon, un identifiant mal formé — 400, rien n'est publié`, async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    const before = fake.table("posts").length;
    const six = [BRUNO, CARL, DORA, EVE, GINA, HUGO];
    for (const peopleTags of [six, [BRUNO, BRUNO], ["pas-un-id"], "pas du JSON", { bruno: BRUNO }]) {
      const response = await as(target, ANNA).publish({ peopleTags });
      expect(response.statusCode, JSON.stringify(peopleTags)).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_body", message: "Identifications invalides." });
    }
    expect(fake.table("posts")).toHaveLength(before);
    expect(fake.uploads).toEqual([]);
    // Cinq : permis.
    expect(peopleIds((await as(target, ANNA).publish({ peopleTags: [BRUNO, CARL, DORA, EVE, HUGO] })).json())).toHaveLength(PEOPLE_TAGS_MAX);
  });

  it("refusé : une publication « achat » ne peut identifier personne — 400 avant toute lecture du Vault", async () => {
    const target = await photosApp(seeded().db);
    const response = await as(target, ANNA).publish({ type: "purchase", peopleTags: [BRUNO] });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_body", message: "Seule une publication « Une photo » peut identifier des personnes." });
  });

  it("au-delà de 20 identifications retenues dans l'heure : plus rien n'est créé (ni ligne, ni notification) ; une heure plus tard, de nouveau permis", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T10:00:00Z"));
    const fake = seeded({ follows: [] });
    const target = await photosApp(fake.db);
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const five = [BRUNO, CARL, DORA, EVE, ANNA];
    for (let round = 0; round < 4; round += 1) {
      const created = await as(target, HUGO).publish({ peopleTags: five });
      expect(peopleIds(created.json()), `publication ${round + 1}`).toHaveLength(5);
    }
    expect(fake.table("post_people_tags")).toHaveLength(20);
    const notices = tagNotices(fake).length;
    const over = await as(target, HUGO).publish({ peopleTags: five });
    expect(over.statusCode).toBe(200);
    expect(over.json()).not.toHaveProperty("people");
    expect(fake.table("post_people_tags")).toHaveLength(20);
    expect(tagNotices(fake)).toHaveLength(notices);
    // Le budget est par auteur : Anna identifie normalement.
    expect(peopleIds((await as(target, ANNA).publish({ peopleTags: [CARL] })).json())).toEqual([CARL]);
    vi.setSystemTime(new Date("2026-11-18T11:00:01Z"));
    expect(peopleIds((await as(target, HUGO).publish({ peopleTags: [BRUNO] })).json())).toEqual([BRUNO]);
  });

  it("une identification écartée par une règle ne consomme pas le budget (budget commun avec les mentions)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T13:00:00Z"));
    const fake = seeded({ follows: [] });
    const target = await photosApp(fake.db);
    process.env.NODE_ENV = "development";
    // Gina refuse tout, Fred est suspendu : 30 écartées, rien de consommé.
    for (let round = 0; round < 15; round += 1) await as(target, HUGO).publish({ peopleTags: [GINA, FRED] });
    expect(fake.table("post_people_tags")).toEqual([]);
    expect(peopleIds((await as(target, HUGO).publish({ peopleTags: [BRUNO, CARL, DORA, EVE, ANNA] })).json())).toHaveLength(5);
  });
});

describe("notification « identification »", () => {
  it("une seule par publication et par membre ; seulement pour une app récente (« v=2 »), qui mène à la publication", async () => {
    const fake = seeded();
    const target = await photosApp(fake.db);
    const created: Post = (await as(target, ANNA).publish({ peopleTags: [BRUNO] })).json();
    expect(tagNotices(fake)).toHaveLength(1);
    expect(tagNotices(fake)[0]).toMatchObject({ user_id: BRUNO, actor_id: ANNA, post_id: created.id });
    const recent = (await as(target, BRUNO).get("/api/notifications?v=2")).json() as AppNotification[];
    expect(recent.map((notice) => [notice.type, notice.postId])).toEqual([["tag", created.id]]);
    const old = (await as(target, BRUNO).get("/api/notifications")).json() as AppNotification[];
    expect(old).toEqual([]);
    expect((await as(target, BRUNO).get("/api/notifications/unread-count")).json()).toEqual({ count: 0 });
    expect((await as(target, BRUNO).get("/api/notifications/unread-count?v=2")).json()).toEqual({ count: 1 });
  });
});

describe("modération : une publication signalée montre toutes ses photos", () => {
  const row = (postId: string): QueueRow => ({
    target_type: "post",
    target_id: postId,
    report_count: 1,
    reasons: { inappropriate: 1 },
    notes: [],
    first_at: "2026-11-18T09:00:00+00:00",
    last_at: "2026-11-18T09:00:00+00:00",
  });

  it("avec la migration : la photo 1 puis les photos 2 à 5 (miniatures), même masquée ; une seule photo : pas de liste", async () => {
    const fake = seeded({ media: [[ANNA_PUBLIC, 3], [ANNA_HIDDEN, 1]] });
    const items = await buildModerationItems({ supabaseAdmin: fake.db } as never, [row(ANNA_PUBLIC), row(ANNA_HIDDEN), row(BRUNO_PUBLIC)], { profileModeration: false, postExtras: true });
    const preview = items[0]!.preview;
    expect(preview.kind).toBe("post");
    if (preview.kind !== "post") return;
    expect(preview.images).toEqual([
      stored(ANNA, `${ANNA_PUBLIC}-mini.jpg`),
      stored(ANNA, `${ANNA_PUBLIC}-1-mini.jpg`),
      stored(ANNA, `${ANNA_PUBLIC}-2-mini.jpg`),
      stored(ANNA, `${ANNA_PUBLIC}-3-mini.jpg`),
    ]);
    const hidden = items[1]!.preview;
    expect(hidden.kind === "post" && hidden.hidden && hidden.images?.length).toBe(2);
    expect(items[2]!.preview).not.toHaveProperty("images");
  });

  it("sans la migration : la première photo seulement, comme avant, sans rien lire de plus", async () => {
    const fake = seeded({}, WITHOUT_0047);
    const items = await buildModerationItems({ supabaseAdmin: fake.db } as never, [row(ANNA_PUBLIC)], { profileModeration: false, postExtras: false });
    expect(items[0]!.preview).not.toHaveProperty("images");
    expect(items[0]!.preview.kind === "post" && items[0]!.preview.imageUrl).toBe(stored(ANNA, `${ANNA_PUBLIC}-mini.jpg`));
  });
});

describe("export des données", () => {
  it("ses photos 2 à 5, les personnes qu'elle a identifiées, les publications où elle l'est (encore visibles ou non) ; jamais un compte en blocage", async () => {
    // Anna : deux photos de plus ; elle a identifié Bruno et Eve (qui l'a bloquée depuis : effacé normalement).
    // Elle est identifiée par Bruno (visible), Paula (compte privé qu'elle ne suit pas) et sur une publication masquée.
    const BRUNO_HIDDEN = "b1000000-0000-4000-8000-000000000002";
    const fake = seeded({ media: [[ANNA_PUBLIC, 2], [BRUNO_PUBLIC, 1]], tags: [[ANNA_PUBLIC, BRUNO], [ANNA_PUBLIC, EVE], [BRUNO_PUBLIC, ANNA], [PAULA_PUBLIC, ANNA]] });
    fake.table("posts").push(post(BRUNO_HIDDEN, BRUNO, "public", { hidden: true }));
    fake.table("post_people_tags").push({ post_id: BRUNO_HIDDEN, user_id: ANNA, author_id: BRUNO, created_at: "2026-11-18T09:30:00+00:00" });
    fake.table("blocks").push({ blocker_id: EVE, blocked_id: ANNA, created_at: "2026-11-18T10:00:00+00:00" });
    const target = await photosApp(fake.db);

    const body = (await as(target, ANNA).get("/api/me/export")).json();
    expect(body.postMedia.map((row: Row) => [row.post_id, row.position])).toEqual([
      [ANNA_PUBLIC, 1],
      [ANNA_PUBLIC, 2],
    ]);
    expect(Object.keys(body.postMedia[0]).sort()).toEqual(["created_at", "id", "media_thumb_url", "media_url", "position", "post_id"]);
    expect(body.peopleTagsMade).toEqual([{ post_id: ANNA_PUBLIC, user_id: BRUNO, created_at: "2026-11-18T09:00:00+00:00" }]);
    // Par date, puis par publication.
    expect(body.peopleTagsReceived.map((row: Row) => [row.post_id, row.author_id, row.post_available])).toEqual([
      [PAULA_PUBLIC, PAULA, false],
      [BRUNO_PUBLIC, BRUNO, true],
      [BRUNO_HIDDEN, BRUNO, false],
    ]);
    // Clés ajoutées à la fin : les anciennes gardent leur ordre.
    // (Après elles : la clé de la migration 0048, publicationsEnregistrees.test.ts.)
    const keys = Object.keys(body);
    expect(keys.slice(keys.indexOf("postMedia"), keys.indexOf("postMedia") + 3)).toEqual(["postMedia", "peopleTagsMade", "peopleTagsReceived"]);
    expect(JSON.stringify([body.postMedia, body.peopleTagsMade, body.peopleTagsReceived])).not.toContain(EVE);

    // Fichier lisible : le nom des comptes, « une publication indisponible », jamais le compte en blocage.
    const page = (await as(target, ANNA).get("/api/me/export?format=html")).body;
    expect(page).toContain("Personnes que vous avez identifiées (1)");
    expect(page).toContain("Publications où l&#39;on vous a identifié(e) (3)");
    expect(page).toContain("@bruno (Bruno)");
    expect(page).toContain("une publication indisponible");
    expect(page).toContain("Autres photos");
    expect(page).not.toContain("(Eve)");

    // L'autre côté : Bruno voit l'identification reçue d'Anna, et celles qu'il a faites.
    const bruno = (await as(target, BRUNO).get("/api/me/export")).json();
    expect(bruno.peopleTagsReceived.map((row: Row) => [row.post_id, row.author_id, row.post_available])).toEqual([[ANNA_PUBLIC, ANNA, true]]);
    expect(bruno.peopleTagsMade.map((row: Row) => [row.post_id, row.user_id])).toEqual([
      [BRUNO_PUBLIC, ANNA],
      [BRUNO_HIDDEN, ANNA],
    ]);
    expect(bruno.postMedia.map((row: Row) => row.post_id)).toEqual([BRUNO_PUBLIC]);
  });

  it("sans la migration 0047 : trois sections vides, et l'export réussit", async () => {
    const target = await photosApp(seeded({}, WITHOUT_0047).db);
    const response = await as(target, ANNA).get("/api/me/export");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect([body.postMedia, body.peopleTagsMade, body.peopleTagsReceived]).toEqual([[], [], []]);
  });
});

