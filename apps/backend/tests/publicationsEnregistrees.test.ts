import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAVE_POST_LIMIT_ERROR,
  SAVED_POSTS_FULL_ERROR,
  SAVED_POSTS_MAX,
  SAVED_POSTS_PAGE_SIZE,
  SAVED_POSTS_UNAVAILABLE_ERROR,
  type CollectionsStatus,
  type Post,
  type PrivacyLevel,
  type SavedPostsPage,
  type SharedCollectionPage,
  type SharedCollectionsList,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import savedPostsRoutes from "../src/routes/savedPosts.js";
import collectionsRoutes from "../src/routes/collections.js";
import usersRoutes from "../src/routes/users.js";
import followsRoutes from "../src/routes/follows.js";
import blocksRoutes from "../src/routes/blocks.js";
import meRoutes from "../src/routes/me.js";
import notificationsRoutes from "../src/routes/notifications.js";
import accountRoutes from "../src/routes/account.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { resetCollectionsProbe } from "../src/lib/collections.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { resetPostExtrasProbe } from "../src/lib/postExtras.js";
import { resetSavedPostsProbe, savedPostsReady } from "../src/lib/savedPosts.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { DatabaseReadError } from "../src/lib/validation.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";
import { sectionHtml, visibleText } from "./exportFixture.js";

// Publications enregistrées (lot « vie sociale », migration 0048), SANS base
// ni réseau : les vraies routes sur une fausse base en mémoire
// (tests/fakeSupabase.ts). Chaque règle de la fiche a son cas « refusé » ET
// son cas « permis » ; les cinq façons de perdre l'accès à une publication
// enregistrée ont chacune leur test, avec le retour quand la cause est levée.
// Le même parcours sur la vraie base de développement :
// publicationsEnregistreesBase.test.ts (Mac, 0048 appliquée).

// Anna publie (compte public). Bruno enregistre : il suit Anna et Paula, et il
// est l'ami de Dora (chacun suit l'autre). Carl est un inconnu. Paula a un
// compte PRIVÉ. Eve sert aux blocages.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const PAULA = "70000000-0000-4000-8000-000000000007";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const ANNA_PUBLIC = "a1000000-0000-4000-8000-000000000001";
const ANNA_FOLLOWERS = "a1000000-0000-4000-8000-000000000002";
const ANNA_PRIVATE = "a1000000-0000-4000-8000-000000000003";
const ANNA_HIDDEN = "a1000000-0000-4000-8000-000000000004";
const ANNA_OTHER = "a1000000-0000-4000-8000-000000000005";
const PAULA_PUBLIC = "71000000-0000-4000-8000-000000000001";
const BRUNO_OWN = "b1000000-0000-4000-8000-000000000001";
const EVE_PUBLIC = "e1000000-0000-4000-8000-000000000001";

// Collections : « Été » de Bruno (montrée à ses amis, avec une envie), « Hiver » de Bruno, « Perso » de Dora.
const BRUNO_SUMMER = "c5000000-0000-4000-8000-000000000001";
const BRUNO_WINTER = "c5000000-0000-4000-8000-000000000002";
const DORA_OWN = "c5000000-0000-4000-8000-000000000003";
const BRUNO_WISH = "e5000000-0000-4000-8000-000000000001";
const BRUNO_ITEM = "e6000000-0000-4000-8000-000000000001";

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };
const COLLECTION_NOT_FOUND = { error: "collection_not_found", message: "Collection introuvable." };
const UNAVAILABLE = { error: SAVED_POSTS_UNAVAILABLE_ERROR, message: "Les publications enregistrées ne sont pas encore disponibles." };

const stored = (user: string, name: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/${name}`;

function profile(id: string, username: string, isPrivate = false): Row {
  return {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: null,
    bio: null,
    locale: "fr",
    default_privacy: "followers",
    piece_sends_from: "following",
    messages_from: "everyone",
    is_private: isPrivate,
    mentions_from: "following",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

function post(id: string, userId: string, privacy: PrivacyLevel, extra: { hidden?: boolean; createdAt?: string } = {}): Row {
  return {
    id,
    user_id: userId,
    type: "lifestyle",
    vault_item_id: null,
    wishlist_item_id: null,
    caption: `Légende de ${id.slice(0, 2)}`,
    media_url: stored(userId, `${id}.jpg`),
    media_thumb_url: stored(userId, `${id}-mini.jpg`),
    media_removed_at: null,
    privacy,
    hidden_at: extra.hidden ? "2026-11-12T00:00:00+00:00" : null,
    created_at: extra.createdAt ?? "2026-11-10T00:00:00+00:00",
  };
}

interface Seed {
  /** [abonné, compte suivi] ; par défaut Bruno suit Anna et Paula, Bruno et Dora se suivent. */
  follows?: [string, string][];
  blocks?: [string, string][];
  /** [membre, publication, collection] déjà enregistrées. */
  saved?: [string, string, string | null][];
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profile(ANNA, "anna"), profile(BRUNO, "bruno"), profile(CARL, "carl"), profile(DORA, "dora"), profile(EVE, "eve"), profile(PAULA, "paula", true));
  fake
    .table("posts")
    .push(
      post(ANNA_PUBLIC, ANNA, "public"),
      post(ANNA_FOLLOWERS, ANNA, "followers"),
      post(ANNA_PRIVATE, ANNA, "private"),
      post(ANNA_HIDDEN, ANNA, "public", { hidden: true }),
      post(ANNA_OTHER, ANNA, "public"),
      post(PAULA_PUBLIC, PAULA, "public"),
      post(BRUNO_OWN, BRUNO, "public"),
      post(EVE_PUBLIC, EVE, "public")
    );
  for (const [follower, followee] of seed.follows ?? [
    [BRUNO, ANNA],
    [BRUNO, PAULA],
    [BRUNO, DORA],
    [DORA, BRUNO],
  ])
    fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  const collection = (id: string, userId: string, name: string, visibility: "private" | "friends") => ({
    id,
    user_id: userId,
    name,
    visibility,
    visibility_changed_at: null,
    created_at: "2026-11-01T00:00:00+00:00",
    updated_at: "2026-11-01T00:00:00+00:00",
  });
  fake.table("collections").push(collection(BRUNO_SUMMER, BRUNO, "Été", "friends"), collection(BRUNO_WINTER, BRUNO, "Hiver", "private"), collection(DORA_OWN, DORA, "Perso", "private"));
  // Une envie de Bruno dans « Été », avec la copie de son image (montrée aux amis).
  fake.table("wishlist_items").push({
    id: BRUNO_WISH,
    user_id: BRUNO,
    title: "Sac cabas",
    image_url: "https://boutique.example/sac.jpg",
    reference: null,
    price_min: "120.00",
    currency: "EUR",
    merchant_name: "Boutique",
    merchant_url: "https://boutique.example/sac",
    product_match_id: null,
    created_at: "2026-11-01T00:00:00+00:00",
  });
  fake.table("collection_items").push({ id: BRUNO_ITEM, collection_id: BRUNO_SUMMER, wishlist_item_id: BRUNO_WISH, user_id: BRUNO, created_at: "2026-11-02T00:00:00+00:00" });
  fake.table("collection_image_copies").push({ wishlist_item_id: BRUNO_WISH, user_id: BRUNO, image_url: stored(BRUNO, "copie.jpg"), image_thumb_url: stored(BRUNO, "copie-mini.jpg"), created_at: "2026-11-02T00:00:00+00:00" });
  let minute = 0;
  for (const [userId, postId, collectionId] of seed.saved ?? []) {
    minute += 1;
    fake.table("saved_posts").push({ user_id: userId, post_id: postId, collection_id: collectionId, created_at: `2026-11-15T10:${String(minute).padStart(2, "0")}:00.123456+00:00` });
  }
  return fake;
}

/** Base sans la migration 0048. */
const WITHOUT_0048: FakeDbOptions = { missing: ["saved_posts"] };

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

async function savedApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  limitNames = new Map();
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  app.addHook("onRoute", (route) => {
    limitNames.set(`${String(route.method)} ${route.url}`, route.config?.rateLimitName);
  });
  await app.register(postsRoutes);
  await app.register(savedPostsRoutes);
  await app.register(collectionsRoutes);
  await app.register(usersRoutes);
  await app.register(followsRoutes);
  await app.register(blocksRoutes);
  await app.register(meRoutes);
  await app.register(notificationsRoutes);
  await app.register(accountRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    put: (url: string, payload: object) => target.inject({ method: "PUT", url, headers, payload }),
    patch: (url: string, payload: object) => target.inject({ method: "PATCH", url, headers, payload }),
    save: (postId: string, collectionId?: string | null) => target.inject({ method: "PUT", url: `/api/posts/${postId}/save`, headers, payload: collectionId === undefined ? {} : { collectionId } }),
    unsave: (postId: string) => target.inject({ method: "DELETE", url: `/api/posts/${postId}/save`, headers }),
  };
}

async function savedPage(target: FastifyInstance, user: string, query = ""): Promise<SavedPostsPage> {
  const response = await as(target, user).get(`/api/saved-posts${query}`);
  expect(response.statusCode, `${user} lit ses enregistrées ${query}`).toBe(200);
  return response.json();
}
const ids = (page: SavedPostsPage) => page.posts.map((value) => value.id);
async function savedIds(target: FastifyInstance, user: string, query = ""): Promise<string[]> {
  return ids(await savedPage(target, user, query));
}
async function seen(target: FastifyInstance, viewer: string, postId: string): Promise<Post> {
  const response = await as(target, viewer).get(`/api/posts/${postId}`);
  expect(response.statusCode, `${viewer} voit ${postId}`).toBe(200);
  return response.json();
}
const rows = (fake: Fake) =>
  fake
    .table("saved_posts")
    .map((row) => `${String(row.user_id).slice(0, 1)}>${String(row.post_id).slice(0, 2)}${String(row.post_id).slice(-1)}:${row.collection_id === null ? "-" : String(row.collection_id).slice(-1)}`)
    .sort();
const key = (user: string, postId: string, collectionId: string | null = null) => `${user.slice(0, 1)}>${postId.slice(0, 2)}${postId.slice(-1)}:${collectionId === null ? "-" : collectionId.slice(-1)}`;

beforeEach(() => {
  resetPrivateAccountsProbe();
  resetCollectionsProbe();
  resetCommentThreadsProbe();
  resetPostExtrasProbe();
  resetSavedPostsProbe();
});

afterEach(async () => {
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("sans la migration 0048 : rien ne change", () => {
  it("l'app l'apprend par GET /api/collections/status, et les publications n'ont pas de signet", async () => {
    const target = await savedApp(seeded({}, WITHOUT_0048).db);
    const status: CollectionsStatus = (await as(target, BRUNO).get("/api/collections/status")).json();
    expect(status).toEqual({ enabled: true, reportable: true, savedPosts: false });
    const value = await seen(target, BRUNO, ANNA_PUBLIC);
    expect(value).not.toHaveProperty("viewerHasSaved");
    expect(value).not.toHaveProperty("viewerSavedCollectionId");
    const feed = (await as(target, BRUNO).get("/api/feed")).json();
    expect(feed.posts.length).toBeGreaterThan(0);
    for (const item of feed.posts) expect(item).not.toHaveProperty("viewerHasSaved");
  });

  it("les trois routes répondent « indisponible », rien n'est écrit", async () => {
    const fake = seeded({}, WITHOUT_0048);
    const target = await savedApp(fake.db);
    for (const response of [await as(target, BRUNO).save(ANNA_PUBLIC), await as(target, BRUNO).unsave(ANNA_PUBLIC), await as(target, BRUNO).get("/api/saved-posts")]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(UNAVAILABLE);
    }
    expect(fake.table("saved_posts")).toHaveLength(0);
  });

  it("sans 0033 non plus (collections absentes) : indisponible, même si la table était là", async () => {
    const fake = seeded({}, { missing: ["collections", "collection_items", "collection_image_copies"] });
    const target = await savedApp(fake.db);
    expect((await as(target, BRUNO).get("/api/collections/status")).json()).toEqual({ enabled: false, reportable: false, savedPosts: false });
    expect((await as(target, BRUNO).save(ANNA_PUBLIC)).json()).toEqual(UNAVAILABLE);
    expect(await seen(target, BRUNO, ANNA_PUBLIC)).not.toHaveProperty("viewerHasSaved");
    expect(await savedPostsReady(target)).toBe(false);
  });

  it("sonde illisible (délai dépassé) : rien n'est mémorisé, la page part sans signet, les routes répondent « erreur », jamais « disponible » par défaut", async () => {
    let broken = true;
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null]] });
    const target = await savedApp(withBrokenTable(fake.db, "saved_posts", () => broken));
    await expect(savedPostsReady(target)).rejects.toBeInstanceOf(DatabaseReadError);
    expect((await as(target, BRUNO).get("/api/collections/status")).json()).toMatchObject({ enabled: true, savedPosts: false });
    expect(await seen(target, BRUNO, ANNA_PUBLIC)).not.toHaveProperty("viewerHasSaved");
    expect((await as(target, BRUNO).save(ANNA_OTHER)).statusCode).toBe(500);
    expect(rows(fake)).toEqual([key(BRUNO, ANNA_PUBLIC)]);
    // La base répond de nouveau : tout revient, sans attendre 5 minutes.
    broken = false;
    expect(await savedPostsReady(target)).toBe(true);
    expect((await seen(target, BRUNO, ANNA_PUBLIC)).viewerHasSaved).toBe(true);
  });
});

describe("règle 1 : on n'enregistre qu'une publication qu'on voit maintenant", () => {
  it("permis : une publication publique, une « Abonnés » d'un compte suivi, une d'un compte privé suivi, la sienne", async () => {
    const fake = seeded();
    const target = await savedApp(fake.db);
    for (const postId of [ANNA_PUBLIC, ANNA_FOLLOWERS, PAULA_PUBLIC, BRUNO_OWN]) {
      const response = await as(target, BRUNO).save(postId);
      expect(response.statusCode, postId).toBe(200);
      expect(response.json()).toEqual({ saved: true, collectionId: null });
    }
    expect(rows(fake)).toEqual([key(BRUNO, ANNA_PUBLIC), key(BRUNO, ANNA_FOLLOWERS), key(BRUNO, PAULA_PUBLIC), key(BRUNO, BRUNO_OWN)].sort());
    const value = await seen(target, BRUNO, ANNA_FOLLOWERS);
    expect(value.viewerHasSaved).toBe(true);
    expect(value.viewerSavedCollectionId).toBeNull();
  });

  it("refusé (404, la même réponse qu'une publication inconnue, rien n'est écrit) : « Abonnés » sans suivre, privée, masquée, compte privé non suivi, blocage dans les deux sens, inconnue", async () => {
    const fake = seeded({ blocks: [[EVE, BRUNO], [BRUNO, ANNA]] });
    const target = await savedApp(fake.db);
    const refused: [string, string][] = [
      [CARL, ANNA_FOLLOWERS],
      [BRUNO, ANNA_PRIVATE],
      [CARL, ANNA_HIDDEN],
      [CARL, PAULA_PUBLIC],
      [BRUNO, EVE_PUBLIC],
      [BRUNO, ANNA_PUBLIC],
      [CARL, UNKNOWN],
    ];
    for (const [user, postId] of refused) {
      const response = await as(target, user).save(postId);
      expect(response.statusCode, `${user} ${postId}`).toBe(404);
      expect(response.json()).toEqual(POST_NOT_FOUND);
    }
    // Même l'auteur ne peut pas enregistrer sa publication masquée par la modération.
    expect((await as(target, ANNA).save(ANNA_HIDDEN)).json()).toEqual(POST_NOT_FOUND);
    expect(fake.table("saved_posts")).toHaveLength(0);
  });

  it("permis à un compte suspendu (enregistrer ne montre rien à personne)", async () => {
    const fake = seeded();
    fake.table("suspensions").push({ user_id: BRUNO, moderation_action_id: UNKNOWN });
    const target = await savedApp(fake.db);
    expect((await as(target, BRUNO).save(ANNA_PUBLIC)).statusCode).toBe(200);
  });

  it("entrées invalides : 400, rien n'est écrit", async () => {
    const fake = seeded();
    const target = await savedApp(fake.db);
    const bruno = as(target, BRUNO);
    expect((await bruno.save("pas-un-identifiant")).statusCode).toBe(400);
    expect((await bruno.put(`/api/posts/${ANNA_PUBLIC}/save`, { collectionId: "pas-un-identifiant" })).statusCode).toBe(400);
    expect((await bruno.put(`/api/posts/${ANNA_PUBLIC}/save`, { collectionId: BRUNO_SUMMER, caption: "copie" })).statusCode).toBe(400);
    expect((await bruno.get("/api/saved-posts?cursor=hier")).statusCode).toBe(400);
    expect((await bruno.get("/api/saved-posts?collectionId=abc")).statusCode).toBe(400);
    expect(fake.table("saved_posts")).toHaveLength(0);
  });
});

describe("règle 2 : la liste ne rend une publication que si le membre peut ENCORE la voir", () => {
  it("permis : ses publications enregistrées, les plus récemment enregistrées d'abord, avec le signet plein", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, PAULA_PUBLIC, null], [BRUNO, BRUNO_OWN, null], [CARL, ANNA_OTHER, null]] }).db);
    const page = await savedPage(target, BRUNO);
    expect(ids(page)).toEqual([BRUNO_OWN, PAULA_PUBLIC, ANNA_PUBLIC]);
    expect(page.posts.every((value) => value.viewerHasSaved === true)).toBe(true);
    expect(page.nextCursor).toBeNull();
    // Chacun ne lit que les siennes.
    expect(await savedIds(target, CARL)).toEqual([ANNA_OTHER]);
    expect(await savedIds(target, DORA)).toEqual([]);
  });

  it("refusé : l'autrice bloque le membre ; revient quand elle le débloque", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, BRUNO_OWN, null]] }).db);
    expect((await as(target, ANNA).post(`/api/blocks/${BRUNO}`)).statusCode).toBe(204);
    expect(await savedIds(target, BRUNO)).toEqual([BRUNO_OWN]);
    expect((await as(target, ANNA).del(`/api/blocks/${BRUNO}`)).statusCode).toBe(204);
    expect(await savedIds(target, BRUNO)).toEqual([BRUNO_OWN, ANNA_PUBLIC]);
  });

  it("refusé : le membre bloque l'autrice (l'autre sens) ; revient quand il la débloque", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_PUBLIC, null]] }).db);
    await as(target, BRUNO).post(`/api/blocks/${ANNA}`);
    expect(await savedIds(target, BRUNO)).toEqual([]);
    await as(target, BRUNO).del(`/api/blocks/${ANNA}`);
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_PUBLIC]);
  });

  it("refusé : l'autrice passe en compte privé et le membre n'est pas abonné ; revient quand elle repasse en public", async () => {
    const target = await savedApp(seeded({ saved: [[CARL, ANNA_PUBLIC, null], [BRUNO, ANNA_PUBLIC, null]] }).db);
    expect((await as(target, ANNA).put("/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect(await savedIds(target, CARL)).toEqual([]);
    // Bruno, abonné accepté, la voit toujours.
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_PUBLIC]);
    await as(target, ANNA).put("/api/me/private-account", { isPrivate: false });
    expect(await savedIds(target, CARL)).toEqual([ANNA_PUBLIC]);
  });

  it("refusé : la publication passe en « Abonnés » pour un inconnu, et un abonné cesse de suivre ; chacune revient", async () => {
    const target = await savedApp(seeded({ saved: [[CARL, ANNA_PUBLIC, null], [BRUNO, ANNA_FOLLOWERS, null]] }).db);
    expect((await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "followers" })).statusCode).toBe(200);
    expect(await savedIds(target, CARL)).toEqual([]);
    await as(target, ANNA).patch(`/api/posts/${ANNA_PUBLIC}`, { privacy: "public" });
    expect(await savedIds(target, CARL)).toEqual([ANNA_PUBLIC]);

    expect((await as(target, BRUNO).del(`/api/follows/${ANNA}`)).statusCode).toBe(204);
    expect(await savedIds(target, BRUNO)).toEqual([]);
    expect((await as(target, BRUNO).post(`/api/follows/${ANNA}?v=2`)).statusCode).toBe(200);
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_FOLLOWERS]);
  });

  it("refusé : la publication passe en « privée », même pour un abonné ; revient", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_FOLLOWERS, null]] }).db);
    await as(target, ANNA).patch(`/api/posts/${ANNA_FOLLOWERS}`, { privacy: "private" });
    expect(await savedIds(target, BRUNO)).toEqual([]);
    await as(target, ANNA).patch(`/api/posts/${ANNA_FOLLOWERS}`, { privacy: "followers" });
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_FOLLOWERS]);
  });

  it("refusé : la publication est masquée par la modération (même la sienne) ; revient quand le masquage est levé", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, BRUNO_OWN, null]] });
    const target = await savedApp(fake.db);
    const annaPost = fake.table("posts").find((row) => row.id === ANNA_PUBLIC)!;
    const ownPost = fake.table("posts").find((row) => row.id === BRUNO_OWN)!;
    annaPost.hidden_at = "2026-11-16T00:00:00+00:00";
    ownPost.hidden_at = "2026-11-16T00:00:00+00:00";
    expect(await savedIds(target, BRUNO)).toEqual([]);
    annaPost.hidden_at = null;
    ownPost.hidden_at = null;
    expect(await savedIds(target, BRUNO)).toEqual([BRUNO_OWN, ANNA_PUBLIC]);
  });

  it("refusé : le membre a signalé la publication ; revient si son signalement disparaît", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, ANNA_OTHER, null]] });
    const target = await savedApp(fake.db);
    fake.table("reports").push({ id: UNKNOWN, reporter_id: BRUNO, target_type: "post", target_id: ANNA_PUBLIC, reason: "spam", created_at: "2026-11-16T00:00:00+00:00" });
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_OTHER]);
    // Le signalement d'un autre membre ne change rien pour lui.
    expect(await savedIds(target, BRUNO)).not.toContain(ANNA_PUBLIC);
    fake.tables.set("reports", []);
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_OTHER, ANNA_PUBLIC]);
  });

  it("le signalement d'un AUTRE membre ne retire rien de sa liste", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null]] });
    const target = await savedApp(fake.db);
    fake.table("reports").push({ id: UNKNOWN, reporter_id: CARL, target_type: "post", target_id: ANNA_PUBLIC, reason: "spam", created_at: "2026-11-16T00:00:00+00:00" });
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_PUBLIC]);
  });

  it("une publication supprimée part de toutes les listes (la base efface les lignes avec elle)", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [CARL, ANNA_PUBLIC, null], [CARL, ANNA_OTHER, null]] });
    const target = await savedApp(fake.db);
    expect((await as(target, ANNA).del(`/api/posts/${ANNA_PUBLIC}`)).statusCode).toBe(204);
    expect(rows(fake)).toEqual([key(CARL, ANNA_OTHER)]);
    expect(await savedIds(target, BRUNO)).toEqual([]);
  });
});

describe("règle 3 : la réponse ne dit jamais combien de publications ont été laissées de côté", () => {
  it("une page entièrement filtrée arrive vide, avec la suite ; rien ne nomme les publications retirées", async () => {
    const fake = seeded();
    // 18 publications d'Eve (que Bruno bloque) enregistrées plus récemment que 3 d'Anna.
    const evePosts = Array.from({ length: SAVED_POSTS_PAGE_SIZE }, (_, index) => `e2000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    for (const id of evePosts) fake.table("posts").push(post(id, EVE, "public"));
    const saved: [string, string, string | null][] = [
      [BRUNO, ANNA_PUBLIC, null],
      [BRUNO, ANNA_OTHER, null],
      [BRUNO, ANNA_FOLLOWERS, null],
      ...evePosts.map((id): [string, string, null] => [BRUNO, id, null]),
    ];
    for (const [index, [user, postId]] of saved.entries()) {
      fake.table("saved_posts").push({ user_id: user, post_id: postId, collection_id: null, created_at: `2026-11-15T10:${String(index).padStart(2, "0")}:00.123456+00:00` });
    }
    fake.table("blocks").push({ blocker_id: BRUNO, blocked_id: EVE, created_at: "2026-10-01T00:00:00+00:00" });
    const target = await savedApp(fake.db);
    const first = (await as(target, BRUNO).get("/api/saved-posts")).json();
    expect(Object.keys(first).sort()).toEqual(["nextCursor", "posts"]);
    expect(first.posts).toEqual([]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(first)).not.toContain(EVE);
    for (const id of evePosts) expect(JSON.stringify(first)).not.toContain(id);
    const second: SavedPostsPage = (await as(target, BRUNO).get(`/api/saved-posts?cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(ids(second)).toEqual([ANNA_FOLLOWERS, ANNA_OTHER, ANNA_PUBLIC]);
    expect(second.nextCursor).toBeNull();
  });

  it("la suite ne saute ni ne répète aucune publication (curseur à la microseconde)", async () => {
    const fake = seeded();
    const many = Array.from({ length: SAVED_POSTS_PAGE_SIZE + 5 }, (_, index) => `a3000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    for (const [index, id] of many.entries()) {
      fake.table("posts").push(post(id, ANNA, "public"));
      // Toutes dans la même milliseconde : seules les microsecondes les départagent.
      fake.table("saved_posts").push({ user_id: BRUNO, post_id: id, collection_id: null, created_at: `2026-11-15T10:00:00.123${String(index).padStart(3, "0")}+00:00` });
    }
    const target = await savedApp(fake.db);
    const first = await savedPage(target, BRUNO);
    expect(first.posts).toHaveLength(SAVED_POSTS_PAGE_SIZE);
    const second = await savedPage(target, BRUNO, `?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.nextCursor).toBeNull();
    expect([...ids(first), ...ids(second)]).toEqual([...many].reverse());
  });

  it("coût d'une page : un nombre fixe de lectures, jamais une par publication", async () => {
    const fake = seeded();
    const many = Array.from({ length: SAVED_POSTS_PAGE_SIZE }, (_, index) => `a3000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    for (const [index, id] of many.entries()) {
      fake.table("posts").push(post(id, index % 2 === 0 ? ANNA : PAULA, "public"));
      fake.table("saved_posts").push({ user_id: BRUNO, post_id: id, collection_id: null, created_at: `2026-11-15T10:${String(index).padStart(2, "0")}:00+00:00` });
    }
    const { db, counts } = counting(fake.db);
    const target = await savedApp(db);
    await savedPage(target, BRUNO);
    counts.clear();
    expect((await savedPage(target, BRUNO)).posts).toHaveLength(SAVED_POSTS_PAGE_SIZE);
    // Les lignes, puis les publications : une fois ; le signet de hydratePosts : une fois de plus.
    expect(counts.get("saved_posts")).toBe(2);
    expect(counts.get("posts")).toBe(1);
    expect(counts.get("reports")).toBe(1);
    expect(counts.get("follows")).toBeLessThanOrEqual(2);
  });
});

describe("règle 4 : rien de la publication n'est recopié, et les enregistrées restent à leur propriétaire", () => {
  it("une ligne ne garde que le membre, la publication, la collection et la date", async () => {
    const fake = seeded();
    const target = await savedApp(fake.db);
    await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_WINTER);
    expect(Object.keys(fake.table("saved_posts")[0]!).sort()).toEqual(["collection_id", "created_at", "post_id", "user_id"]);
    // La légende changée par l'autrice se lit telle qu'elle est maintenant.
    fake.table("posts").find((row) => row.id === ANNA_PUBLIC)!.caption = "Nouvelle légende";
    expect((await savedPage(target, BRUNO)).posts[0]!.caption).toBe("Nouvelle légende");
  });

  it("refusé : un ami lit la collection « Mes amis » où le membre a rangé une publication, et ne reçoit aucune publication ; le nombre d'envies ne la compte pas", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_PUBLIC, BRUNO_SUMMER], [BRUNO, PAULA_PUBLIC, BRUNO_SUMMER]] }).db);
    const shared = await as(target, DORA).get(`/api/collections/${BRUNO_SUMMER}/shared`);
    expect(shared.statusCode).toBe(200);
    const page: SharedCollectionPage = shared.json();
    expect(page.items.map((item) => item.id)).toEqual([BRUNO_ITEM]);
    expect(page.collection.itemCount).toBe(1);
    const list: SharedCollectionsList = (await as(target, DORA).get(`/api/users/${BRUNO}/collections`)).json();
    expect(list.collections).toEqual([expect.objectContaining({ id: BRUNO_SUMMER, itemCount: 1, coverUrl: stored(BRUNO, "copie-mini.jpg") })]);
    for (const body of [JSON.stringify(page), JSON.stringify(list)]) {
      for (const hidden of [ANNA_PUBLIC, PAULA_PUBLIC, ANNA, PAULA, "Légende"]) expect(body).not.toContain(hidden);
    }
    // Son propre aperçu de ses collections ne les compte pas non plus.
    const own = (await as(target, BRUNO).get("/api/collections")).json();
    expect(own.collections.find((c: { id: string }) => c.id === BRUNO_SUMMER).itemCount).toBe(1);
  });

  it("refusé : un ami ne lit pas les publications enregistrées d'une collection qui n'est pas la sienne (404, comme une collection inconnue)", async () => {
    const target = await savedApp(seeded({ saved: [[BRUNO, ANNA_PUBLIC, BRUNO_SUMMER]] }).db);
    for (const collectionId of [BRUNO_SUMMER, UNKNOWN]) {
      const response = await as(target, DORA).get(`/api/saved-posts?collectionId=${collectionId}`);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(COLLECTION_NOT_FOUND);
    }
    // Permis : le propriétaire, filtré sur sa collection.
    expect(await savedIds(target, BRUNO, `?collectionId=${BRUNO_SUMMER}`)).toEqual([ANNA_PUBLIC]);
  });
});

describe("règle 5 : rien ne dit à un auteur qui a enregistré sa publication, ni combien", () => {
  it("ni notification, ni compteur ; pour l'autrice, son propre signet reste vide", async () => {
    const fake = seeded();
    const target = await savedApp(fake.db);
    await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_SUMMER);
    await as(target, CARL).save(ANNA_PUBLIC);
    expect(fake.table("notifications")).toHaveLength(0);
    const own = await seen(target, ANNA, ANNA_PUBLIC);
    expect(own.viewerHasSaved).toBe(false);
    expect(own.viewerSavedCollectionId).toBeNull();
    const keys = Object.keys(own);
    expect(keys.filter((name) => /save/i.test(name)).sort()).toEqual(["viewerHasSaved", "viewerSavedCollectionId"]);
    // Ses vues de sa publication (détail, fil, profil, notifications) ne citent jamais les membres qui l'ont enregistrée.
    const views = [
      JSON.stringify(own),
      (await as(target, ANNA).get("/api/feed")).body,
      (await as(target, ANNA).get(`/api/users/${ANNA}/posts`)).body,
      (await as(target, ANNA).get("/api/posts/mine")).body,
      (await as(target, ANNA).get("/api/notifications")).body,
    ];
    for (const body of views) {
      expect(body).not.toContain(CARL);
      expect(body).not.toContain(BRUNO_SUMMER);
    }
    // Un autre lecteur voit SON état, jamais celui des autres.
    expect((await seen(target, DORA, ANNA_PUBLIC)).viewerHasSaved).toBe(false);
    expect((await seen(target, CARL, ANNA_PUBLIC)).viewerHasSaved).toBe(true);
  });
});

describe("règle 6 : seulement une de ses collections", () => {
  it("refusé : la collection d'un autre membre, ou inconnue (404, rien n'est écrit ni déplacé)", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_OTHER, BRUNO_WINTER]] });
    const target = await savedApp(fake.db);
    for (const collectionId of [DORA_OWN, UNKNOWN]) {
      expect((await as(target, BRUNO).save(ANNA_PUBLIC, collectionId)).json()).toEqual(COLLECTION_NOT_FOUND);
      // Ranger ailleurs une publication déjà enregistrée : refusé de même.
      expect((await as(target, BRUNO).save(ANNA_OTHER, collectionId)).json()).toEqual(COLLECTION_NOT_FOUND);
    }
    expect(rows(fake)).toEqual([key(BRUNO, ANNA_OTHER, BRUNO_WINTER)]);
  });

  it("permis : ranger dans une de ses collections, puis ailleurs, puis nulle part ; la place dans la liste ne change pas", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, ANNA_OTHER, null]] });
    const target = await savedApp(fake.db);
    const createdAt = () => fake.table("saved_posts").find((row) => row.post_id === ANNA_PUBLIC)!.created_at;
    const before = createdAt();
    expect((await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_SUMMER)).json()).toEqual({ saved: true, collectionId: BRUNO_SUMMER });
    expect((await seen(target, BRUNO, ANNA_PUBLIC)).viewerSavedCollectionId).toBe(BRUNO_SUMMER);
    expect(await savedIds(target, BRUNO, `?collectionId=${BRUNO_SUMMER}`)).toEqual([ANNA_PUBLIC]);
    expect((await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_WINTER)).json()).toEqual({ saved: true, collectionId: BRUNO_WINTER });
    expect(await savedIds(target, BRUNO, `?collectionId=${BRUNO_SUMMER}`)).toEqual([]);
    expect(await savedIds(target, BRUNO, `?collectionId=${BRUNO_WINTER}`)).toEqual([ANNA_PUBLIC]);
    expect((await as(target, BRUNO).save(ANNA_PUBLIC, null)).json()).toEqual({ saved: true, collectionId: null });
    expect(createdAt()).toBe(before);
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_OTHER, ANNA_PUBLIC]);
    expect(fake.table("saved_posts")).toHaveLength(2);
  });

  it("supprimer une collection garde ses publications enregistrées, sans collection", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, BRUNO_WINTER]] });
    const target = await savedApp(fake.db);
    expect((await as(target, BRUNO).del(`/api/collections/${BRUNO_WINTER}`)).statusCode).toBe(204);
    expect(rows(fake)).toEqual([key(BRUNO, ANNA_PUBLIC)]);
    expect(await savedIds(target, BRUNO)).toEqual([ANNA_PUBLIC]);
    expect((await as(target, BRUNO).get(`/api/saved-posts?collectionId=${BRUNO_WINTER}`)).json()).toEqual(COLLECTION_NOT_FOUND);
  });

  it("la base refuse la collection au même moment (23503) : 404, la bonne réponse selon ce qui a disparu", async () => {
    let failure: "collection" | "post" | null = "collection";
    const fake = seeded({}, { failWrite: (table, action) => (table === "saved_posts" && action === "insert" && failure ? { code: "23503", message: "violates foreign key constraint" } : null) });
    const target = await savedApp(fake.db);
    // La collection vient d'être supprimée entre la vérification et l'écriture.
    const collections = fake.table("collections");
    const realFrom = fake.db.from;
    let reads = 0;
    fake.db.from = (name: string) => {
      if (name === "collections") {
        reads += 1;
        // Deuxième lecture (après l'échec) : la collection n'est plus là.
        if (reads === 2) fake.tables.set("collections", collections.filter((row) => row.id !== BRUNO_WINTER));
      }
      return realFrom(name);
    };
    expect((await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_WINTER)).json()).toEqual(COLLECTION_NOT_FOUND);
    failure = "post";
    expect((await as(target, BRUNO).save(ANNA_PUBLIC, BRUNO_SUMMER)).json()).toEqual(POST_NOT_FOUND);
    failure = null;
    fake.db.from = realFrom;
  });
});

describe("plafond, retrait, limite", () => {
  it(`${SAVED_POSTS_MAX} publications au plus : la suivante est refusée (409), ranger ailleurs reste permis`, async () => {
    const fake = seeded();
    for (let index = 0; index < SAVED_POSTS_MAX; index += 1) {
      fake.table("saved_posts").push({ user_id: CARL, post_id: `f${String(index).padStart(7, "0")}-0000-4000-8000-000000000000`, collection_id: null, created_at: "2026-11-01T00:00:00+00:00" });
    }
    fake.table("saved_posts")[0]!.post_id = ANNA_OTHER;
    const target = await savedApp(fake.db);
    const response = await as(target, CARL).save(ANNA_PUBLIC);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: SAVED_POSTS_FULL_ERROR, message: "Vous avez atteint la limite de publications enregistrées." });
    expect(localizeMessage(response.json().message, 409, "en")).toBe("You've reached the limit of saved posts.");
    expect(fake.table("saved_posts")).toHaveLength(SAVED_POSTS_MAX);
    // Déjà enregistrée : la ranger ou la réenregistrer ne compte pas.
    expect((await as(target, CARL).save(ANNA_OTHER)).statusCode).toBe(200);
    // Une de moins : la suivante passe.
    await as(target, CARL).unsave(ANNA_OTHER);
    expect((await as(target, CARL).save(ANNA_PUBLIC)).statusCode).toBe(200);
  });

  it("retirer : 204 sans vérifier la visibilité (même bloqué, même masquée), et 204 encore si elle n'y est plus", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [BRUNO, ANNA_OTHER, null]] });
    const target = await savedApp(fake.db);
    await as(target, ANNA).post(`/api/blocks/${BRUNO}`);
    fake.table("posts").find((row) => row.id === ANNA_OTHER)!.hidden_at = "2026-11-16T00:00:00+00:00";
    expect((await as(target, BRUNO).unsave(ANNA_PUBLIC)).statusCode).toBe(204);
    expect((await as(target, BRUNO).unsave(ANNA_OTHER)).statusCode).toBe(204);
    expect(fake.table("saved_posts")).toHaveLength(0);
    expect((await as(target, BRUNO).unsave(ANNA_PUBLIC)).statusCode).toBe(204);
    expect((await as(target, BRUNO).unsave(UNKNOWN)).statusCode).toBe(204);
  });

  it("retirer ne touche que sa propre ligne", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, null], [CARL, ANNA_PUBLIC, null]] });
    const target = await savedApp(fake.db);
    await as(target, CARL).unsave(ANNA_PUBLIC);
    expect(rows(fake)).toEqual([key(BRUNO, ANNA_PUBLIC)]);
  });

  it("limite « savePost » : 300 par heure pour enregistrer ou ranger ; retirer n'a que le filet commun", async () => {
    await savedApp(seeded().db);
    expect(limitNames.get("PUT /api/posts/:id/save")).toBe("savePost");
    expect(limitNames.get("DELETE /api/posts/:id/save")).toBeUndefined();
    expect(RATE_LIMITS.savePost).toMatchObject({ max: 300, windowMs: 60 * 60_000, error: SAVE_POST_LIMIT_ERROR });
    expect(localizeMessage(RATE_LIMITS.savePost.message, 429, "en")).toBe("You've saved a lot of posts in a short time. Please try again in a moment.");
    expect(localizeMessage(UNAVAILABLE.message, 404, "en")).toBe("Saved posts aren't available yet.");
  });

  it("la liste n'est jamais gardée en cache", async () => {
    const target = await savedApp(seeded().db);
    expect((await as(target, BRUNO).get("/api/saved-posts")).headers["cache-control"]).toBe("no-store");
  });
});

describe("export des données", () => {
  it("la date, la collection, l'auteur seulement si la publication est encore visible ; jamais un compte en blocage ; la clé ajoutée à la fin", async () => {
    // Bruno a enregistré : une publication d'Anna (rangée dans « Été »), la
    // sienne, une d'Eve (qui l'a bloqué depuis), une de Paula masquée depuis
    // par la modération, et une d'Anna passée en « privée ».
    const PAULA_HIDDEN = "71000000-0000-4000-8000-000000000002";
    const fake = seeded({
      blocks: [[EVE, BRUNO]],
      saved: [
        [BRUNO, ANNA_PUBLIC, BRUNO_SUMMER],
        [BRUNO, BRUNO_OWN, null],
        [BRUNO, EVE_PUBLIC, BRUNO_WINTER],
        [BRUNO, PAULA_HIDDEN, null],
        [BRUNO, ANNA_PRIVATE, null],
        [CARL, ANNA_OTHER, null],
      ],
    });
    fake.table("posts").push(post(PAULA_HIDDEN, PAULA, "public", { hidden: true }));
    const target = await savedApp(fake.db);

    const body = (await as(target, BRUNO).get("/api/me/export")).json();
    expect(Object.keys(body).at(-1)).toBe("savedPosts");
    expect(body.savedPosts.map((row: Row) => [row.post_id, row.collection_name, row.author_id, row.post_available])).toEqual([
      [ANNA_PUBLIC, "Été", ANNA, true],
      [BRUNO_OWN, null, BRUNO, true],
      [EVE_PUBLIC, "Hiver", null, false],
      [PAULA_HIDDEN, null, null, false],
      [ANNA_PRIVATE, null, null, false],
    ]);
    expect(Object.keys(body.savedPosts[0]).sort()).toEqual(["author_id", "collection_id", "collection_name", "created_at", "post_available", "post_id"]);
    // Rien de la publication elle-même, jamais le compte qui l'a bloqué, rien des enregistrées de Carl.
    const section = JSON.stringify(body.savedPosts);
    for (const absent of [EVE, PAULA, "Légende", ANNA_OTHER, "media"]) expect(section).not.toContain(absent);

    // Fichier lisible : l'auteur visible, « une publication indisponible », jamais Eve.
    const page = (await as(target, BRUNO).get("/api/me/export?format=html")).body;
    expect(visibleText(page).replace(/\s+/g, " ")).toContain("Publications enregistrées (5)");
    const savedSection = visibleText(sectionHtml(page, "savedPosts")).replace(/\s+/g, " ");
    expect(savedSection).toContain("une publication de @anna (Anna)");
    expect(savedSection).toContain("votre publication");
    expect(savedSection.match(/une publication indisponible/g)?.length).toBe(4);
    expect(savedSection).toContain("Rangée dans Été");
    expect(savedSection).toContain("Rangée dans Hiver");
    expect(savedSection.toLowerCase()).not.toContain("eve");
    expect(savedSection.toLowerCase()).not.toContain("paula");
  });

  it("sans la migration 0048 : section vide, l'export réussit", async () => {
    const target = await savedApp(seeded({}, WITHOUT_0048).db);
    const response = await as(target, BRUNO).get("/api/me/export");
    expect(response.statusCode).toBe(200);
    expect(response.json().savedPosts).toEqual([]);
  });

  it("supprimer son compte : rien à effacer à part (aucun fichier ; la base efface les lignes avec le compte)", async () => {
    const fake = seeded({ saved: [[BRUNO, ANNA_PUBLIC, BRUNO_SUMMER]] });
    const { db, counts } = counting(fake.db);
    const target = await savedApp(db);
    const response = await target.inject({ method: "DELETE", url: "/api/me", headers: { "x-test-user": BRUNO }, payload: { confirmation: "SUPPRIMER" } });
    expect(response.statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([BRUNO]);
    expect(counts.get("saved_posts") ?? 0).toBe(0);
  });
});
