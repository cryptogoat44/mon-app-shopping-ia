import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_NOTIFICATION_TYPES, NOTIFICATION_TYPES, PRIVACY_LEVELS, type AppNotification, type MemberPage, type PrivacyLevel } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import followsRoutes from "../src/routes/follows.js";
import usersRoutes from "../src/routes/users.js";
import postsRoutes from "../src/routes/posts.js";
import commentsRoutes from "../src/routes/comments.js";
import notificationsRoutes from "../src/routes/notifications.js";
import blocksRoutes from "../src/routes/blocks.js";
import meRoutes from "../src/routes/me.js";
import productMatchesRoutes from "../src/routes/productMatches.js";
import accountRoutes from "../src/routes/account.js";
import { canSeeAuthorContent, postVisibleTo, privateAccountsReady, readAudience, resetPrivateAccountsProbe, type Audience } from "../src/lib/audience.js";
import { speaksV2 } from "../src/lib/clientLevel.js";
import { canSeeFriendCollections } from "../src/lib/collections.js";
import { followStateOf, memberShown, toMemberRows } from "../src/lib/memberRows.js";
import { notify } from "../src/lib/notify.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { canViewPost, findViewablePost, visiblePrivacies } from "../src/lib/visibility.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Compte privé et demandes d'abonnement (lot « vie sociale », migration
// 0045), SANS base ni réseau : les vraies routes sur une fausse base en
// mémoire (tests/fakeSupabase.ts). Chaque règle de confidentialité a son cas
// « refusé » ET son cas « permis ». Le même parcours sur la vraie base de
// développement : comptePriveBase.test.ts (Mac, une fois 0045 appliquée).

// Alice a un compte PRIVÉ. Bob est son abonné accepté. Chloé est une
// inconnue. Dan a un compte public. Eve sert aux blocages et suspensions.
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const CHLOE = "c0000000-0000-4000-8000-000000000003";
const DAN = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const ALICE_PUBLIC = "a1000000-0000-4000-8000-000000000001";
const ALICE_FOLLOWERS = "a2000000-0000-4000-8000-000000000002";
const ALICE_PRIVATE = "a3000000-0000-4000-8000-000000000003";
const DAN_PUBLIC = "d1000000-0000-4000-8000-000000000001";
const DAN_FOLLOWERS = "d2000000-0000-4000-8000-000000000002";

function profile(id: string, username: string | null, isPrivate = false): Row {
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
    is_private: isPrivate,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

function post(id: string, userId: string, privacy: PrivacyLevel, createdAt: string): Row {
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
    hidden_at: null,
    created_at: createdAt,
  };
}

interface Seed {
  follows?: [string, string][];
  blocks?: [string, string][];
  requests?: [string, string][];
  suspended?: string[];
  alicePrivate?: boolean;
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const withColumn = !(options.missingColumns?.profiles ?? []).includes("is_private");
  const rows = [profile(ALICE, "alice", seed.alicePrivate ?? true), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(DAN, "dan"), profile(EVE, "eve")];
  for (const row of rows) if (!withColumn) delete row.is_private;
  fake.table("profiles").push(...rows);
  fake.table("posts").push(
    post(ALICE_PUBLIC, ALICE, "public", "2026-11-01T10:00:00+00:00"),
    post(ALICE_FOLLOWERS, ALICE, "followers", "2026-11-02T10:00:00+00:00"),
    post(ALICE_PRIVATE, ALICE, "private", "2026-11-03T10:00:00+00:00"),
    post(DAN_PUBLIC, DAN, "public", "2026-11-04T10:00:00+00:00"),
    post(DAN_FOLLOWERS, DAN, "followers", "2026-11-05T10:00:00+00:00")
  );
  for (const [follower, followee] of seed.follows ?? [[BOB, ALICE]]) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [requester, target] of seed.requests ?? []) fake.table("follow_requests").push({ requester_id: requester, target_id: target, created_at: "2026-11-10T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  return fake;
}

let app: FastifyInstance | null = null;

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête. */
async function socialApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(followsRoutes);
  await app.register(usersRoutes);
  await app.register(postsRoutes);
  await app.register(commentsRoutes);
  await app.register(notificationsRoutes);
  await app.register(blocksRoutes);
  await app.register(meRoutes);
  await app.register(productMatchesRoutes);
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
const requestsOf = (fake: Fake) => fake.table("follow_requests").map((row) => `${String(row.requester_id)}>${String(row.target_id)}`);
const followsOf = (fake: Fake) => fake.table("follows").map((row) => `${String(row.follower_id)}>${String(row.followee_id)}`);
const noticesOf = (fake: Fake, type: string) => fake.table("notifications").filter((row) => row.type === type);
const fastifyOf = (target: FastifyInstance) => target;

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetPrivateAccountsProbe();
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("la règle, sans base : qui voit le contenu de qui", () => {
  const base: Audience = { self: false, blocked: false, suspended: false, isPrivate: false, follows: false, requested: false };

  it("canSeeAuthorContent : soi-même toujours ; jamais en cas de blocage ; un compte privé, seulement ses abonnés acceptés", () => {
    const table: [Partial<Audience>, boolean][] = [
      [{}, true],
      [{ follows: true }, true],
      [{ isPrivate: true }, false],
      [{ isPrivate: true, requested: true }, false],
      [{ isPrivate: true, follows: true }, true],
      [{ blocked: true }, false],
      [{ blocked: true, follows: true }, false],
      [{ blocked: true, isPrivate: true, follows: true }, false],
      [{ self: true }, true],
      [{ self: true, isPrivate: true }, true],
      // Suspendu : la règle des publications ne change pas (la photo et la bio, elles, sont cachées ailleurs).
      [{ suspended: true }, true],
    ];
    for (const [link, expected] of table) expect(canSeeAuthorContent({ ...base, ...link }), JSON.stringify(link)).toBe(expected);
  });

  it("postVisibleTo : table complète, visibilité de la publication × lien avec l'auteur", () => {
    const links: [string, Partial<Audience>, Record<PrivacyLevel, boolean>][] = [
      ["soi-même", { self: true, isPrivate: true }, { public: true, followers: true, private: true }],
      ["inconnu, compte public", {}, { public: true, followers: false, private: false }],
      ["abonné, compte public", { follows: true }, { public: true, followers: true, private: false }],
      ["inconnu, compte privé", { isPrivate: true }, { public: false, followers: false, private: false }],
      ["demande en attente, compte privé", { isPrivate: true, requested: true }, { public: false, followers: false, private: false }],
      ["abonné accepté, compte privé", { isPrivate: true, follows: true }, { public: true, followers: true, private: false }],
      ["blocage, compte public", { blocked: true }, { public: false, followers: false, private: false }],
      ["blocage, abonné resté par erreur", { blocked: true, follows: true }, { public: false, followers: false, private: false }],
    ];
    for (const [name, link, expected] of links) {
      for (const privacy of PRIVACY_LEVELS) expect(postVisibleTo({ ...base, ...link }, privacy), `${name} / ${privacy}`).toBe(expected[privacy]);
    }
  });

  it("visiblePrivacies : rien du tout pour qui n'est pas abonné à un compte privé ; inchangé pour un compte public", () => {
    expect(visiblePrivacies(true, false, true)).toEqual(["public", "followers", "private"]);
    expect(visiblePrivacies(false, true, true)).toEqual(["public", "followers"]);
    expect(visiblePrivacies(false, false, true)).toEqual([]);
    // Signature d'avant (deux arguments) : compte public.
    expect(visiblePrivacies(false, false)).toEqual(["public"]);
    expect(visiblePrivacies(false, true)).toEqual(["public", "followers"]);
  });

  it("memberShown et followStateOf : la règle des listes de membres", () => {
    const shown = (link: Partial<Audience>, hasUsername = true, owner = false) => memberShown({ ...base, ...link }, hasUsername, owner);
    expect(shown({})).toBe(true);
    expect(shown({}, false)).toBe(false);
    expect(shown({ suspended: true })).toBe(false);
    expect(shown({ blocked: true })).toBe(false);
    expect(shown({ isPrivate: true })).toBe(false);
    expect(shown({ isPrivate: true, requested: true })).toBe(false);
    expect(shown({ isPrivate: true, follows: true })).toBe(true);
    expect(shown({ isPrivate: true, self: true })).toBe(true);
    expect(shown({ isPrivate: true }, true, true)).toBe(true);
    // Le propriétaire de la liste ne voit pas pour autant un compte en blocage ou suspendu.
    expect(shown({ isPrivate: true, blocked: true }, true, true)).toBe(false);
    expect(shown({ isPrivate: true, suspended: true }, true, true)).toBe(false);
    expect(followStateOf({ follows: true, requested: false })).toBe("following");
    expect(followStateOf({ follows: false, requested: true })).toBe("requested");
    expect(followStateOf({ follows: false, requested: false })).toBe("none");
  });

  it("speaksV2 : seulement le paramètre d'adresse « v=2 »", () => {
    expect(speaksV2({ query: { v: "2" } })).toBe(true);
    for (const query of [{}, { v: "1" }, { v: "3" }, { v: 2 }, { v: ["2", "2"] }, { V: "2" }, null, undefined, "v=2"]) expect(speaksV2({ query }), JSON.stringify(query)).toBe(false);
  });

  it("les anciens types de notification sont exactement les six d'avant, et font tous partie des types connus", () => {
    expect([...LEGACY_NOTIFICATION_TYPES]).toEqual(["follow", "like", "comment", "moderation", "report_handled", "piece_received"]);
    for (const type of LEGACY_NOTIFICATION_TYPES) expect(NOTIFICATION_TYPES).toContain(type);
    expect(NOTIFICATION_TYPES).toContain("follow_request");
    expect(NOTIFICATION_TYPES).toContain("follow_accepted");
  });
});

// ---------------------------------------------------------------------------

describe("readAudience : un nombre fixe de lectures, jamais « visible » par défaut", () => {
  it("rend le lien avec chaque auteur : soi, blocage dans les deux sens, suspension, compte privé, abonnement, demande", async () => {
    const fake = seeded({ follows: [[CHLOE, BOB]], blocks: [[DAN, CHLOE]], requests: [[CHLOE, ALICE]], suspended: [EVE] });
    const target = await socialApp(fake.db);
    const links = await readAudience(target, CHLOE, [ALICE, BOB, CHLOE, DAN, EVE, ALICE]);
    expect([...links.keys()]).toEqual([ALICE, BOB, CHLOE, DAN, EVE]);
    expect(links.get(ALICE)).toEqual({ self: false, blocked: false, suspended: false, isPrivate: true, follows: false, requested: true });
    expect(links.get(BOB)).toEqual({ self: false, blocked: false, suspended: false, isPrivate: false, follows: true, requested: false });
    expect(links.get(CHLOE)).toEqual({ self: true, blocked: false, suspended: false, isPrivate: false, follows: false, requested: false });
    expect(links.get(DAN)?.blocked).toBe(true);
    expect(links.get(EVE)?.suspended).toBe(true);
    expect((await readAudience(target, CHLOE, [])).size).toBe(0);
  });

  it("une demande restée auprès d'un compte redevenu public ne compte pas", async () => {
    const fake = seeded({ alicePrivate: false, requests: [[CHLOE, ALICE]] });
    const target = await socialApp(fake.db);
    expect((await readAudience(target, CHLOE, [ALICE])).get(ALICE)).toMatchObject({ isPrivate: false, requested: false });
  });

  it("six lectures pour une page entière, quel que soit le nombre d'auteurs", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    await privateAccountsReady(target);
    let reads = 0;
    const counting = { ...fake.db, from: (name: string) => ((reads += 1), fake.db.from(name)) };
    const counted = { ...target, supabaseAdmin: counting, log: target.log } as unknown as FastifyInstance;
    await readAudience(counted, CHLOE, [ALICE, BOB, DAN, EVE]);
    expect(reads).toBe(6);
    reads = 0;
    // Détail d'une publication : ni suspensions ni demandes, quatre lectures.
    await readAudience(counted, CHLOE, [ALICE], { suspended: false, requested: false });
    expect(reads).toBe(4);
  });

  it("lecture des blocages impossible : une erreur (500), jamais la publication montrée", async () => {
    const fake = seeded({ alicePrivate: false }, { missing: ["blocks"] });
    const target = await socialApp(fake.db);
    await expect(canViewPost(target, CHLOE, { user_id: ALICE, privacy: "public" })).rejects.toThrow();
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(500);
    // Sa propre publication ne dépend d'aucune de ces lectures.
    expect(await canViewPost(target, ALICE, { user_id: ALICE, privacy: "private" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("règles de visibilité d'un compte privé (une par test, avec son cas permis)", () => {
  it("règle 1 : un inconnu ne reçoit du profil que nom, photo, bio et compteurs ; l'abonné accepté et le propriétaire voient le reste", async () => {
    const fake = seeded({ follows: [[BOB, ALICE], [ALICE, DAN]] });
    fake.table("profiles").find((row) => row.id === ALICE)!.bio = "Paris";
    const target = await socialApp(fake.db);

    const stranger = (await as(target, CHLOE).get(`/api/users/${ALICE}`)).json();
    expect(stranger).toEqual({
      id: ALICE,
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
      bio: "Paris",
      followersCount: 1,
      followingCount: 1,
      postsCount: 0,
      isFollowing: false,
      isMe: false,
      isPrivate: true,
      followState: "none",
    });
    // Jamais le lien de bio (fiche 10), ni aucun autre champ.
    expect(stranger).not.toHaveProperty("linkUrl");

    const follower = (await as(target, BOB).get(`/api/users/${ALICE}`)).json();
    expect(follower).toMatchObject({ postsCount: 2, isFollowing: true, followState: "following", isPrivate: true });
    const owner = (await as(target, ALICE).get(`/api/users/${ALICE}`)).json();
    expect(owner).toMatchObject({ postsCount: 3, isMe: true, isPrivate: true });
    // Compte public : un inconnu voit le nombre de ses publications publiques, comme avant.
    expect((await as(target, CHLOE).get(`/api/users/${DAN}`)).json()).toMatchObject({ postsCount: 1, isPrivate: false, followState: "none" });
  });

  it("règle 2 : la grille d'un compte privé est vide pour un inconnu, quelle que soit la visibilité de chaque publication", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    expect((await as(target, CHLOE).get(`/api/users/${ALICE}/posts`)).json()).toEqual({ posts: [], nextCursor: null });

    const forFollower = (await as(target, BOB).get(`/api/users/${ALICE}/posts`)).json();
    expect(forFollower.posts.map((p: { id: string }) => p.id)).toEqual([ALICE_FOLLOWERS, ALICE_PUBLIC]);
    const forOwner = (await as(target, ALICE).get(`/api/users/${ALICE}/posts`)).json();
    expect(forOwner.posts.map((p: { id: string }) => p.id)).toEqual([ALICE_PRIVATE, ALICE_FOLLOWERS, ALICE_PUBLIC]);
    // Compte public : inchangé.
    const publicAccount = (await as(target, CHLOE).get(`/api/users/${DAN}/posts`)).json();
    expect(publicAccount.posts.map((p: { id: string }) => p.id)).toEqual([DAN_PUBLIC]);
  });

  it("règle 3 : détail, commentaires (lire et écrire) et « j'aime » répondent 404 à un inconnu, même pour une publication « Public »", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const chloe = as(target, CHLOE);
    const refusals = [
      await chloe.get(`/api/posts/${ALICE_PUBLIC}`),
      await chloe.get(`/api/posts/${ALICE_PUBLIC}/comments`),
      await chloe.post(`/api/posts/${ALICE_PUBLIC}/comments`, { body: "Bonjour" }),
      await chloe.post(`/api/posts/${ALICE_PUBLIC}/react`),
      await chloe.get(`/api/posts/${ALICE_FOLLOWERS}`),
    ];
    for (const res of refusals) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("post_not_found");
    }
    expect(fake.table("comments")).toHaveLength(0);
    expect(fake.table("post_reactions")).toHaveLength(0);
    expect(fake.table("notifications")).toHaveLength(0);
    expect(await findViewablePost(target, CHLOE, ALICE_PUBLIC)).toBeNull();

    // L'abonné accepté : tout est permis.
    const bob = as(target, BOB);
    expect((await bob.get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(200);
    expect((await bob.get(`/api/posts/${ALICE_FOLLOWERS}`)).statusCode).toBe(200);
    expect((await bob.post(`/api/posts/${ALICE_PUBLIC}/comments`, { body: "Très joli" })).statusCode).toBe(200);
    expect((await bob.get(`/api/posts/${ALICE_PUBLIC}/comments`)).json().comments).toHaveLength(1);
    expect((await bob.post(`/api/posts/${ALICE_PUBLIC}/react`)).json()).toEqual({ reactionCount: 1, viewerHasReacted: true });
    // Jamais la publication « Vous uniquement », abonné ou non.
    expect((await bob.get(`/api/posts/${ALICE_PRIVATE}`)).statusCode).toBe(404);
    // Compte public : un inconnu voit toujours la publication publique.
    expect((await chloe.get(`/api/posts/${DAN_PUBLIC}`)).statusCode).toBe(200);
    expect((await chloe.get(`/api/posts/${DAN_FOLLOWERS}`)).statusCode).toBe(404);
  });

  it("règle 4 : une pièce taguée dans la publication d'un compte privé ne s'ouvre pas pour un inconnu", async () => {
    const MATCH = "f0000000-0000-4000-8000-000000000006";
    const fake = seeded();
    fake.table("product_matches").push({ id: MATCH, search_id: UNKNOWN });
    fake.table("post_tagged_pieces").push({ id: randomUUID(), post_id: ALICE_PUBLIC, product_match_id: MATCH, vault_item_id: null, position: 0 });
    fake.table("affiliate_links").push({ id: randomUUID(), product_match_id: MATCH, affiliate_url: "https://boutique.example/sac" });
    const target = await socialApp(fake.db);

    const refused = await as(target, CHLOE).post(`/api/product-matches/${MATCH}/click`, { context: "post" });
    expect(refused.statusCode).toBe(404);
    expect(refused.json().error).toBe("match_not_found");
    expect(fake.table("affiliate_clicks")).toHaveLength(0);

    const allowed = await as(target, BOB).post(`/api/product-matches/${MATCH}/click`, { context: "post" });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ url: "https://boutique.example/sac" });
    // Le même tag dans la publication publique d'un compte public : permis à l'inconnu.
    fake.table("post_tagged_pieces").push({ id: randomUUID(), post_id: DAN_PUBLIC, product_match_id: MATCH, vault_item_id: null, position: 0 });
    expect((await as(target, CHLOE).post(`/api/product-matches/${MATCH}/click`, { context: "post" })).statusCode).toBe(200);
  });

  it("règle 5 : le fil ne contient que les comptes suivis ; un abonné retiré perd les publications dès la requête suivante", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const feedOf = async (user: string) => (await as(target, user).get("/api/feed")).json().posts.map((p: { id: string }) => p.id);
    expect(await feedOf(BOB)).toEqual([ALICE_FOLLOWERS, ALICE_PUBLIC]);
    expect(await feedOf(CHLOE)).toEqual([]);
    // Une demande en attente ne met rien dans le fil.
    expect((await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "requested" });
    expect(await feedOf(CHLOE)).toEqual([]);
    // Abonné retiré (la ligne d'abonnement disparaît) : plus rien.
    fake.tables.set("follows", []);
    expect(await feedOf(BOB)).toEqual([]);
  });

  it("règle 6 : la recherche rend un compte privé avec son nom seulement, et « isPrivate »", async () => {
    const fake = seeded({ follows: [[BOB, ALICE]], requests: [[DAN, ALICE]] });
    const target = await socialApp(fake.db);
    expect((await as(target, CHLOE).get("/api/users/search?q=alic")).json()).toEqual([
      { id: ALICE, username: "alice", displayName: "Alice", avatarUrl: null, isFollowing: false, isPrivate: true, followState: "none" },
    ]);
    expect((await as(target, BOB).get("/api/users/search?q=alice")).json()[0]).toMatchObject({ isFollowing: true, followState: "following" });
    expect((await as(target, DAN).get("/api/users/search?q=alice")).json()[0]).toMatchObject({ isFollowing: false, followState: "requested" });
    expect((await as(target, CHLOE).get("/api/users/search?q=dan")).json()[0]).toMatchObject({ isPrivate: false, followState: "none" });
  });

  it("règle 7 : une demande en attente ne donne pas accès aux collections « Mes amis » ; l'abonnement mutuel, oui", async () => {
    // Alice suit Chloé ; Chloé a seulement DEMANDÉ à suivre Alice.
    const fake = seeded({ follows: [[ALICE, CHLOE]], requests: [[CHLOE, ALICE]] });
    const target = await socialApp(fake.db);
    expect(await canSeeFriendCollections(target, CHLOE, ALICE)).toBe(false);
    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(204);
    expect(await canSeeFriendCollections(target, CHLOE, ALICE)).toBe(true);
  });

  it("règle 8 : une demande ne donne aucun accès avant d'être acceptée ; acceptée, tout s'ouvre", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const chloe = as(target, CHLOE);
    const asked = await chloe.post(`/api/follows/${ALICE}?v=2`);
    expect(asked.statusCode).toBe(200);
    expect(asked.json()).toEqual({ state: "requested" });
    expect(requestsOf(fake)).toEqual([`${CHLOE}>${ALICE}`]);
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);

    expect((await chloe.get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(404);
    expect((await chloe.get(`/api/users/${ALICE}/posts`)).json().posts).toEqual([]);
    expect((await chloe.get(`/api/users/${ALICE}`)).json()).toMatchObject({ postsCount: 0, isFollowing: false, followState: "requested" });
    expect((await chloe.post(`/api/posts/${ALICE_PUBLIC}/react`)).statusCode).toBe(404);

    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(204);
    expect(requestsOf(fake)).toEqual([]);
    expect(followsOf(fake)).toContain(`${CHLOE}>${ALICE}`);
    expect((await chloe.get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(200);
    expect((await chloe.get(`/api/users/${ALICE}`)).json()).toMatchObject({ postsCount: 2, isFollowing: true, followState: "following" });
  });

  it("règle 8 bis : une demande refusée n'envoie rien à la personne et ne laisse aucune ligne", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    expect(noticesOf(fake, "follow_request")).toHaveLength(1);

    expect((await as(target, ALICE).del(`/api/follow-requests/${CHLOE}`)).statusCode).toBe(204);
    expect(fake.table("follow_requests")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);
    // La personne refusée : aucune notification, et son bouton redevient « Suivre ».
    expect((await as(target, CHLOE).get("/api/notifications?v=2")).json()).toEqual([]);
    expect((await as(target, CHLOE).get(`/api/users/${ALICE}`)).json()).toMatchObject({ followState: "none", postsCount: 0 });
    // Refuser une demande qui n'existe pas : même réponse, rien n'est dit.
    expect((await as(target, ALICE).del(`/api/follow-requests/${DAN}`)).statusCode).toBe(204);
  });

  it("règle 9 : passer en privé garde les abonnés et ne change la visibilité d'aucune publication", async () => {
    const fake = seeded({ alicePrivate: false, follows: [[BOB, ALICE], [DAN, ALICE]] });
    const target = await socialApp(fake.db);
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(200);
    const before = JSON.stringify([fake.table("posts"), fake.table("follows"), fake.table("follow_requests"), fake.table("notifications")]);

    expect((await as(target, ALICE).put("/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.is_private).toBe(true);
    expect(JSON.stringify([fake.table("posts"), fake.table("follows"), fake.table("follow_requests"), fake.table("notifications")])).toBe(before);
    // Effet immédiat : l'inconnue ne voit plus la publication « Public », les abonnés oui.
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(404);
    expect((await as(target, DAN).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(200);
    expect((await as(target, ALICE).get("/api/me")).json()).toMatchObject({ isPrivate: true, followersCount: 2 });
    // Les comptes des autres ne sont pas touchés.
    expect(fake.table("profiles").filter((row) => row.is_private).map((row) => row.id)).toEqual([ALICE]);
  });

  it("règle 10 : un compte bloqué ou bloquant ne peut pas demander, et n'apparaît pas dans les demandes", async () => {
    const fake = seeded({ blocks: [[ALICE, CHLOE], [DAN, ALICE]] });
    const target = await socialApp(fake.db);
    for (const blocked of [CHLOE, DAN]) {
      const res = await as(target, blocked).post(`/api/follows/${ALICE}?v=2`);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("blocked");
    }
    expect(fake.table("follow_requests")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);

    // Une demande restée malgré un blocage (ne devrait pas exister) n'est jamais listée ni acceptée.
    fake.table("follow_requests").push({ requester_id: CHLOE, target_id: ALICE, created_at: "2026-11-11T00:00:00+00:00" }, { requester_id: EVE, target_id: ALICE, created_at: "2026-11-12T00:00:00+00:00" });
    const page: MemberPage = (await as(target, ALICE).get("/api/follow-requests")).json();
    expect(page.members.map((member) => member.id)).toEqual([EVE]);
    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(404);
    expect(followsOf(fake)).not.toContain(`${CHLOE}>${ALICE}`);
    expect((await as(target, ALICE).get("/api/me")).json().followRequestsCount).toBe(1);
  });

  it("règle 10 bis : bloquer efface les demandes en attente dans les deux sens, et leurs notifications", async () => {
    const fake = seeded({ follows: [] });
    fake.table("profiles").find((row) => row.id === CHLOE)!.is_private = true;
    const target = await socialApp(fake.db);
    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    await as(target, ALICE).post(`/api/follows/${CHLOE}?v=2`);
    await as(target, DAN).post(`/api/follows/${ALICE}?v=2`);
    expect(requestsOf(fake).sort()).toEqual([`${ALICE}>${CHLOE}`, `${CHLOE}>${ALICE}`, `${DAN}>${ALICE}`].sort());

    expect((await as(target, ALICE).post(`/api/blocks/${CHLOE}`)).statusCode).toBe(204);
    // La demande de Dan, elle, reste.
    expect(requestsOf(fake)).toEqual([`${DAN}>${ALICE}`]);
    expect(noticesOf(fake, "follow_request").map((row) => row.actor_id)).toEqual([DAN]);
  });

  it("règle 11 : aucune notification sur la publication d'un compte privé pour un membre qui ne peut pas la voir", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const log = fastifyOf(target).log;
    // Chloé (inconnue) ne voit pas la publication d'Alice : rien n'est écrit pour elle.
    expect(await notify(target, log, { recipientId: CHLOE, actorId: BOB, type: "comment", postId: ALICE_PUBLIC })).toBe(false);
    expect(await notify(target, log, { recipientId: CHLOE, actorId: BOB, type: "like", postId: ALICE_FOLLOWERS, oncePerPost: true })).toBe(false);
    expect(fake.table("notifications")).toEqual([]);
    // Dan devient abonné accepté : la même notification est créée.
    fake.table("follows").push({ follower_id: DAN, followee_id: ALICE, created_at: "2026-11-01T00:00:00+00:00" });
    expect(await notify(target, log, { recipientId: DAN, actorId: BOB, type: "comment", postId: ALICE_PUBLIC })).toBe(true);
    // L'auteur, lui, voit toujours sa publication.
    expect(await notify(target, log, { recipientId: ALICE, actorId: BOB, type: "comment", postId: ALICE_PRIVATE })).toBe(true);
    expect(fake.table("notifications").map((row) => row.user_id)).toEqual([DAN, ALICE]);
    // Publication masquée par la modération : plus personne, pas même l'auteur.
    fake.table("posts").find((row) => row.id === ALICE_PUBLIC)!.hidden_at = "2026-11-12T00:00:00+00:00";
    expect(await notify(target, log, { recipientId: ALICE, actorId: BOB, type: "like", postId: ALICE_PUBLIC })).toBe(false);
  });

  it("règle 12 : annuler puis redemander ne laisse jamais deux notifications ; la troisième demande au même compte en 24 h est refusée", async () => {
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    expect(RATE_LIMITS.followRequestPair).toMatchObject({ max: 2, windowMs: 24 * 60 * 60 * 1000 });
    // Des comptes neufs : les compteurs des limites vivent le temps du fichier.
    const requester = randomUUID();
    const owner = randomUUID();
    const other = randomUUID();
    const fake = seeded({ follows: [] });
    fake.table("profiles").push(profile(requester, "rose"), profile(owner, "olga", true), profile(other, "paul", true));
    const target = await socialApp(fake.db);
    const rose = as(target, requester);

    expect((await rose.post(`/api/follows/${owner}?v=2`)).json()).toEqual({ state: "requested" });
    // Redemander pendant que la demande attend : rien de plus, et rien n'est compté.
    for (let i = 0; i < 3; i += 1) expect((await rose.post(`/api/follows/${owner}?v=2`)).json()).toEqual({ state: "requested" });
    expect(noticesOf(fake, "follow_request")).toHaveLength(1);

    expect((await rose.del(`/api/follows/${owner}`)).statusCode).toBe(204);
    expect(fake.table("follow_requests")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);

    expect((await rose.post(`/api/follows/${owner}?v=2`)).json()).toEqual({ state: "requested" });
    expect(noticesOf(fake, "follow_request")).toHaveLength(1);
    expect(fake.table("follow_requests")).toHaveLength(1);

    await rose.del(`/api/follows/${owner}`);
    const third = await rose.post(`/api/follows/${owner}?v=2`);
    expect(third.statusCode).toBe(429);
    expect(third.json()).toEqual({ error: "follow_request_limit", message: "Vous avez déjà demandé à suivre ce compte récemment. Réessayez plus tard." });
    expect(Number(third.headers["retry-after"])).toBeGreaterThan(0);
    expect(fake.table("follow_requests")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
    // La limite est par paire de comptes : une demande à un autre compte passe.
    expect((await rose.post(`/api/follows/${other}?v=2`)).json()).toEqual({ state: "requested" });
  });

  it("règle 13 : un compte privé est absent des listes des autres pour un inconnu ; présent pour ses abonnés, le propriétaire de la liste et lui-même", async () => {
    const NO_NAME = "70000000-0000-4000-8000-000000000007";
    const fake = seeded({ follows: [[BOB, ALICE]], blocks: [[CHLOE, DAN]], suspended: [EVE] });
    fake.table("profiles").push(profile(NO_NAME, null));
    const target = await socialApp(fake.db);
    // La liste (par exemple les abonnés de Dan) : Alice (privée), Bob, Dan, Eve (suspendue), un profil incomplet.
    const list = [ALICE, BOB, DAN, EVE, NO_NAME, ALICE];
    const idsFor = async (viewer: string, contextOwnerId: string | null) => (await toMemberRows(target, viewer, list, { contextOwnerId })).map((row) => row.id);

    // Chloé, inconnue d'Alice, en blocage avec Dan : ni Alice, ni Dan, ni Eve, ni le profil incomplet.
    expect(await idsFor(CHLOE, DAN)).toEqual([BOB]);
    // Bob, abonné accepté d'Alice : il la voit.
    expect(await idsFor(BOB, DAN)).toEqual([ALICE, BOB, DAN]);
    // Dan, propriétaire de la liste : il voit Alice sans la suivre.
    expect(await idsFor(DAN, DAN)).toEqual([ALICE, BOB, DAN]);
    // Dan dans la liste de quelqu'un d'autre : il ne la voit pas.
    expect(await idsFor(DAN, BOB)).toEqual([BOB, DAN]);
    expect(await idsFor(DAN, null)).toEqual([BOB, DAN]);
    // Alice se voit elle-même.
    expect(await idsFor(ALICE, DAN)).toEqual([ALICE, BOB, DAN]);

    const rows = await toMemberRows(target, BOB, list, { contextOwnerId: DAN });
    expect(rows[0]).toEqual({ id: ALICE, username: "alice", displayName: "Alice", avatarUrl: null, isFollowing: true, isPrivate: true, followState: "following", isMe: false });
    expect(rows[1]).toMatchObject({ id: BOB, isMe: true, followState: "none", isPrivate: false });
    // Jamais de date ni de compteur de lignes écartées.
    expect(Object.keys(rows[0]!).sort()).toEqual(["avatarUrl", "displayName", "followState", "id", "isFollowing", "isMe", "isPrivate", "username"]);
    expect(await toMemberRows(target, BOB, [], { contextOwnerId: null })).toEqual([]);
  });

  it("les commentaires d'un compte privé sous la publication d'un autre restent visibles par ceux qui voient cette publication", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    expect((await as(target, ALICE).post(`/api/posts/${DAN_PUBLIC}/comments`, { body: "Bravo" })).statusCode).toBe(200);
    const seen = (await as(target, CHLOE).get(`/api/posts/${DAN_PUBLIC}/comments`)).json().comments;
    expect(seen.map((comment: { author: { username: string } }) => comment.author.username)).toEqual(["alice"]);
  });
});

// ---------------------------------------------------------------------------

describe("demandes d'abonnement", () => {
  it("compte public : abonnement immédiat, comme avant ; compte privé : une demande et une notification « follow_request »", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const toPublic = await as(target, CHLOE).post(`/api/follows/${DAN}?v=2`);
    expect(toPublic.statusCode).toBe(200);
    expect(toPublic.json()).toEqual({ state: "following" });
    expect(followsOf(fake)).toContain(`${CHLOE}>${DAN}`);
    expect(noticesOf(fake, "follow").map((row) => [row.user_id, row.actor_id])).toEqual([[DAN, CHLOE]]);
    // Suivre de nouveau : aucun doublon, aucune seconde notification.
    expect((await as(target, CHLOE).post(`/api/follows/${DAN}?v=2`)).json()).toEqual({ state: "following" });
    expect(noticesOf(fake, "follow")).toHaveLength(1);

    expect((await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "requested" });
    expect(noticesOf(fake, "follow_request").map((row) => [row.user_id, row.actor_id, row.post_id])).toEqual([[ALICE, CHLOE, null]]);
    // Déjà abonné accepté d'un compte privé : « following », aucune demande.
    expect((await as(target, BOB).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "following" });
    expect(requestsOf(fake)).toEqual([`${CHLOE}>${ALICE}`]);
  });

  it("gardes inchangées : soi-même, profil inconnu, compte suspendu", async () => {
    const fake = seeded({ suspended: [EVE] });
    const target = await socialApp(fake.db);
    expect((await as(target, CHLOE).post(`/api/follows/${CHLOE}?v=2`)).statusCode).toBe(400);
    expect((await as(target, CHLOE).post(`/api/follows/${UNKNOWN}?v=2`)).statusCode).toBe(404);
    expect((await as(target, EVE).post(`/api/follows/${ALICE}?v=2`)).statusCode).toBe(403);
    expect(fake.table("follow_requests")).toEqual([]);
  });

  it("app d'avant (sans « v=2 ») : compte privé → 403 avec une phrase claire, rien n'est écrit ; compte public → 204 comme avant", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const refused = await as(target, CHLOE).post(`/api/follows/${ALICE}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: "private_account_update_required", message: "Ce compte est privé. Mettez à jour l'app pour demander à le suivre." });
    expect(fake.table("follow_requests")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);

    const publicTarget = await as(target, CHLOE).post(`/api/follows/${DAN}`);
    expect(publicTarget.statusCode).toBe(204);
    expect(publicTarget.body).toBe("");
    // L'abonné déjà accepté, avec une ancienne app : 204, comme avant.
    expect((await as(target, BOB).post(`/api/follows/${ALICE}`)).statusCode).toBe(204);
  });

  it("« Ne plus suivre » annule aussi la demande en attente et sa notification", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    await as(target, DAN).post(`/api/follows/${ALICE}?v=2`);
    expect((await as(target, CHLOE).del(`/api/follows/${ALICE}`)).statusCode).toBe(204);
    expect(requestsOf(fake)).toEqual([`${DAN}>${ALICE}`]);
    expect(noticesOf(fake, "follow_request").map((row) => row.actor_id)).toEqual([DAN]);
    // Un vrai désabonnement marche toujours.
    expect((await as(target, BOB).del(`/api/follows/${ALICE}`)).statusCode).toBe(204);
    expect(followsOf(fake)).toEqual([]);
    expect((await as(target, BOB).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(404);
  });

  it("demandes reçues : les plus récentes d'abord, par pages de 30, pour le seul propriétaire", async () => {
    const fake = seeded({ follows: [], suspended: [EVE] });
    const many = Array.from({ length: 32 }, (_, index) => ({ id: randomUUID(), at: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString() }));
    for (const [index, entry] of many.entries()) {
      fake.table("profiles").push(profile(entry.id, `membre${index}`, index % 2 === 0));
      fake.table("follow_requests").push({ requester_id: entry.id, target_id: ALICE, created_at: entry.at });
    }
    // Une demande d'un compte suspendu : jamais listée.
    fake.table("follow_requests").push({ requester_id: EVE, target_id: ALICE, created_at: "2026-11-02T00:00:00.000Z" });
    const target = await socialApp(fake.db);

    const first: MemberPage = (await as(target, ALICE).get("/api/follow-requests")).json();
    // 30 lignes lues, dont celle du compte suspendu : 29 montrées, et une suite.
    expect(first.members).toHaveLength(29);
    expect(first.members[0]).toMatchObject({ id: many[31]!.id, followState: "none", isMe: false });
    // Le propriétaire de la liste voit aussi les demandeurs dont le compte est privé.
    expect(first.members.some((member) => member.isPrivate)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second: MemberPage = (await as(target, ALICE).get(`/api/follow-requests?cursor=${encodeURIComponent(first.nextCursor!)}`)).json();
    expect(second.members.map((member) => member.id)).toEqual([many[2]!.id, many[1]!.id, many[0]!.id]);
    expect(second.nextCursor).toBeNull();
    // Jamais de date dans une ligne.
    expect(JSON.stringify(first.members)).not.toContain("2026-11-01");

    // Un autre membre ne lit que SES demandes reçues.
    expect((await as(target, BOB).get("/api/follow-requests")).json()).toEqual({ members: [], nextCursor: null });
    expect((await as(target, ALICE).get("/api/follow-requests?cursor=pas-une-date")).statusCode).toBe(400);
    expect((await target.inject({ method: "GET", url: "/api/follow-requests" })).statusCode).toBe(401);
  });

  it("accepter : 404 sans demande ; la personne devient abonnée et reçoit « follow_accepted » (jamais avec une ancienne app)", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const none = await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`);
    expect(none.statusCode).toBe(404);
    expect(none.json().error).toBe("request_not_found");
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);

    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    // Personne d'autre que la destinataire ne peut accepter cette demande.
    expect((await as(target, DAN).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(404);
    expect((await as(target, CHLOE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(404);
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);

    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(204);
    expect(noticesOf(fake, "follow_request")).toEqual([]);
    expect(noticesOf(fake, "follow_accepted").map((row) => [row.user_id, row.actor_id])).toEqual([[CHLOE, ALICE]]);
    // Accepter deux fois : la demande n'existe plus.
    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(404);
    expect(noticesOf(fake, "follow_accepted")).toHaveLength(1);

    const recent: AppNotification[] = (await as(target, CHLOE).get("/api/notifications?v=2")).json();
    expect(recent.map((n) => [n.type, n.actor?.username])).toEqual([["follow_accepted", "alice"]]);
    expect((await as(target, CHLOE).get("/api/notifications")).json()).toEqual([]);
  });

  it("un compte suspendu peut régler son compte et refuser une demande, mais pas en accepter", async () => {
    const fake = seeded({ alicePrivate: false, suspended: [ALICE], requests: [[CHLOE, ALICE]] });
    const target = await socialApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(403);
    expect(followsOf(fake)).not.toContain(`${CHLOE}>${ALICE}`);
    expect((await as(target, ALICE).del(`/api/follow-requests/${CHLOE}`)).statusCode).toBe(204);
    expect(fake.table("follow_requests")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("réglage « Compte privé »", () => {
  it("repasser en public efface les demandes en attente et leurs notifications : personne ne devient abonné sans accord", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    await as(target, DAN).post(`/api/follows/${ALICE}?v=2`);
    // Une demande reçue par un AUTRE compte privé ne doit pas bouger.
    fake.table("profiles").find((row) => row.id === EVE)!.is_private = true;
    await as(target, CHLOE).post(`/api/follows/${EVE}?v=2`);
    expect(fake.table("follow_requests")).toHaveLength(3);

    expect((await as(target, ALICE).put("/api/me/private-account", { isPrivate: false })).statusCode).toBe(204);
    expect(requestsOf(fake)).toEqual([`${CHLOE}>${EVE}`]);
    expect(noticesOf(fake, "follow_request").map((row) => row.user_id)).toEqual([EVE]);
    // Aucun abonnement créé : les abonnés sont ceux d'avant.
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.is_private).toBe(false);
    // Les personnes concernées revoient « Suivre », et peuvent s'abonner librement.
    expect((await as(target, CHLOE).get(`/api/users/${ALICE}`)).json()).toMatchObject({ followState: "none", isPrivate: false, postsCount: 1 });
    expect((await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "following" });
    expect((await as(target, ALICE).get("/api/me")).json()).toMatchObject({ isPrivate: false, followRequestsCount: 0 });
  });

  it("si les demandes ne peuvent pas être effacées, le compte reste privé (500, rien n'est changé)", async () => {
    const fake = seeded({ requests: [[CHLOE, ALICE]] }, { failWrite: (table, action) => (table === "follow_requests" && action === "delete" ? { message: "panne" } : null) });
    const target = await socialApp(fake.db);
    expect((await as(target, ALICE).put("/api/me/private-account", { isPrivate: false })).statusCode).toBe(500);
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.is_private).toBe(true);
    expect(followsOf(fake)).toEqual([`${BOB}>${ALICE}`]);
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(404);
  });

  it("corps invalide : 400, rien n'est changé ; sans session : 401", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    for (const payload of [{}, { isPrivate: "oui" }, { isPrivate: null }, { private: true }]) {
      expect((await as(target, ALICE).put("/api/me/private-account", payload)).statusCode).toBe(400);
    }
    expect(fake.table("profiles").find((row) => row.id === ALICE)!.is_private).toBe(true);
    expect((await target.inject({ method: "PUT", url: "/api/me/private-account", payload: { isPrivate: false } })).statusCode).toBe(401);
  });

  it("GET /api/me : « isPrivate » et le nombre de demandes telles que la liste les montre", async () => {
    const fake = seeded({ requests: [[CHLOE, ALICE], [DAN, ALICE], [EVE, ALICE]], suspended: [EVE] });
    const target = await socialApp(fake.db);
    expect((await as(target, ALICE).get("/api/me")).json()).toMatchObject({ isPrivate: true, followRequestsCount: 2 });
    expect((await as(target, BOB).get("/api/me")).json()).toMatchObject({ isPrivate: false, followRequestsCount: 0 });
  });
});

// ---------------------------------------------------------------------------

describe("sans la migration 0045 : tout le monde est public, rien de nouveau n'est proposé", () => {
  const WITHOUT_0045: FakeDbOptions = { missing: ["follow_requests"], missingColumns: { profiles: ["is_private"] } };

  it("la sonde répond faux, n'est refaite qu'au bout de 5 minutes, et reste vraie une fois la migration vue", async () => {
    let now = 1_000_000;
    const absent = seeded({}, WITHOUT_0045);
    const warnings: unknown[] = [];
    const without = { supabaseAdmin: absent.db, log: { warn: (fields: unknown) => warnings.push(fields) } } as unknown as FastifyInstance;
    expect(await privateAccountsReady(without, () => now)).toBe(false);
    expect(warnings).toEqual([{ code: "42703" }]);
    // Migration appliquée entre-temps : encore « absente » pendant 5 minutes, sans nouvelle lecture.
    const present = { supabaseAdmin: seeded().db, log: without.log } as unknown as FastifyInstance;
    now += 4 * 60_000;
    expect(await privateAccountsReady(present, () => now)).toBe(false);
    now += 2 * 60_000;
    expect(await privateAccountsReady(present, () => now)).toBe(true);
    // Vue une fois : plus jamais relue.
    expect(await privateAccountsReady(without, () => now)).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("base illisible (ni « présente » ni « absente ») : une erreur, rien de mémorisé — jamais « tous les comptes sont publics » sur une panne", async () => {
    const warnings: unknown[] = [];
    const log = { warn: (fields: unknown) => warnings.push(fields) };
    const failing = (code: string | undefined) => ({ from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code, message: "panne" } }) }) }) });
    const thrown = {
      from: () => {
        throw new Error("réseau coupé");
      },
    };
    for (const db of [failing("57014"), failing(undefined), failing("PGRST301"), thrown]) {
      await expect(privateAccountsReady({ supabaseAdmin: db, log } as unknown as FastifyInstance)).rejects.toThrow("Schéma du compte privé illisible");
    }
    expect(warnings).toEqual([{ code: "57014" }, { code: null }, { code: "PGRST301" }, { code: null }]);
    // Rien n'a été mémorisé : la base revenue, la sonde répond tout de suite.
    expect(await privateAccountsReady({ supabaseAdmin: seeded().db, log } as unknown as FastifyInstance)).toBe(true);

    // Pendant la panne, une publication n'est jamais montrée « par défaut » : 500.
    resetPrivateAccountsProbe();
    const fake = seeded();
    const broken = { ...fake.db, from: (name: string) => (name === "follow_requests" ? failing("57014").from() : fake.db.from(name)) };
    const target = await socialApp(broken);
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(500);
    expect((await as(target, CHLOE).get(`/api/users/${ALICE}/posts`)).statusCode).toBe(500);
    // Le profil de la personne reste lisible, sans le réglage.
    const me = await as(target, ALICE).get("/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json()).not.toHaveProperty("isPrivate");
  });

  it("la colonne seule, ou la table seule, ne suffit pas", async () => {
    const log = { warn: () => {} };
    resetPrivateAccountsProbe();
    expect(await privateAccountsReady({ supabaseAdmin: seeded({}, { missing: ["follow_requests"] }).db, log } as unknown as FastifyInstance)).toBe(false);
    resetPrivateAccountsProbe();
    expect(await privateAccountsReady({ supabaseAdmin: seeded({}, { missingColumns: { profiles: ["is_private"] } }).db, log } as unknown as FastifyInstance)).toBe(false);
  });

  it("le serveur se comporte comme avant : profils, publications, abonnement ; le réglage et les demandes sont « indisponibles »", async () => {
    const fake = seeded({}, WITHOUT_0045);
    const target = await socialApp(fake.db);
    // Tous les comptes sont publics.
    expect((await as(target, CHLOE).get(`/api/users/${ALICE}`)).json()).toMatchObject({ postsCount: 1, isPrivate: false, followState: "none" });
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_PUBLIC}`)).statusCode).toBe(200);
    expect((await as(target, CHLOE).get(`/api/posts/${ALICE_FOLLOWERS}`)).statusCode).toBe(404);
    expect((await as(target, CHLOE).get("/api/users/search?q=alice")).json()[0]).toMatchObject({ isPrivate: false, followState: "none" });

    // Le profil ne dit rien du compte privé : l'app cache le réglage.
    const me = (await as(target, ALICE).get("/api/me")).json();
    expect(me).not.toHaveProperty("isPrivate");
    expect(me).not.toHaveProperty("followRequestsCount");

    // S'abonner : immédiat, avec ou sans « v=2 ».
    expect((await as(target, CHLOE).post(`/api/follows/${ALICE}`)).statusCode).toBe(204);
    expect((await as(target, DAN).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "following" });
    expect((await as(target, DAN).del(`/api/follows/${ALICE}`)).statusCode).toBe(204);
    expect((await as(target, ALICE).post(`/api/blocks/${EVE}`)).statusCode).toBe(204);

    const unavailable = [
      await as(target, ALICE).put("/api/me/private-account", { isPrivate: true }),
      await as(target, ALICE).get("/api/follow-requests"),
      await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`),
      await as(target, ALICE).del(`/api/follow-requests/${CHLOE}`),
    ];
    for (const res of unavailable) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "private_accounts_unavailable", message: "Le compte privé n'est pas encore disponible." });
    }
  });
});

// ---------------------------------------------------------------------------

describe("notifications : ancien et nouveau vocabulaire", () => {
  function withNotices() {
    const fake = seeded();
    const notice = (type: string, minute: number): Row => ({
      id: randomUUID(),
      user_id: ALICE,
      actor_id: BOB,
      type,
      post_id: null,
      moderation_action_id: null,
      read_at: null,
      hidden_at: null,
      created_at: new Date(Date.UTC(2026, 10, 10, 10, minute)).toISOString(),
    });
    fake.table("notifications").push(notice("follow", 1), notice("follow_request", 2), notice("like", 3), notice("follow_accepted", 4), notice("type_d_un_serveur_plus_recent", 5));
    return fake;
  }
  const typesOf = (body: AppNotification[]) => body.map((n) => n.type);

  it("sans « v=2 » : seulement les six anciens types, liste et compteur ; avec : les nouveaux aussi", async () => {
    const target = await socialApp(withNotices().db);
    const alice = as(target, ALICE);
    expect(typesOf((await alice.get("/api/notifications")).json())).toEqual(["like", "follow"]);
    expect((await alice.get("/api/notifications/unread-count")).json()).toEqual({ count: 2 });
    expect(typesOf((await alice.get("/api/notifications?v=2")).json())).toEqual(["follow_accepted", "like", "follow_request", "follow"]);
    expect((await alice.get("/api/notifications/unread-count?v=2")).json()).toEqual({ count: 4 });
    // « v=1 », ou toute autre valeur : l'ancien vocabulaire.
    expect(typesOf((await alice.get("/api/notifications?v=1")).json())).toEqual(["like", "follow"]);
  });

  it("une ligne d'un type inconnu est laissée de côté : jamais une erreur 500 sur l'écran Activité", async () => {
    const target = await socialApp(withNotices().db);
    const res = await as(target, ALICE).get("/api/notifications?v=2");
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toContain("type_d_un_serveur_plus_recent");
    expect((await as(target, ALICE).get("/api/notifications")).statusCode).toBe(200);
  });

  it("« tout marquer comme lu » d'une ancienne app laisse non lues les notifications qu'elle n'affiche pas", async () => {
    const fake = withNotices();
    const target = await socialApp(fake.db);
    expect((await as(target, ALICE).post("/api/notifications/read-all")).statusCode).toBe(204);
    const unread = fake.table("notifications").filter((row) => row.read_at === null).map((row) => row.type);
    expect(unread).toEqual(["follow_request", "follow_accepted", "type_d_un_serveur_plus_recent"]);
    expect((await as(target, ALICE).get("/api/notifications/unread-count?v=2")).json()).toEqual({ count: 2 });
    expect((await as(target, ALICE).post("/api/notifications/read-all?v=2")).statusCode).toBe(204);
    expect((await as(target, ALICE).get("/api/notifications/unread-count?v=2")).json()).toEqual({ count: 0 });
  });
});

// ---------------------------------------------------------------------------

describe("notify : un seul endroit pour les règles des notifications", () => {
  it("jamais à soi-même, jamais entre deux comptes en blocage (dans un sens ou dans l'autre)", async () => {
    const fake = seeded({ alicePrivate: false, blocks: [[CHLOE, DAN]] });
    const target = await socialApp(fake.db);
    expect(await notify(target, target.log, { recipientId: BOB, actorId: BOB, type: "follow" })).toBe(false);
    expect(await notify(target, target.log, { recipientId: CHLOE, actorId: DAN, type: "follow" })).toBe(false);
    expect(await notify(target, target.log, { recipientId: DAN, actorId: CHLOE, type: "follow" })).toBe(false);
    expect(fake.table("notifications")).toEqual([]);
    expect(await notify(target, target.log, { recipientId: BOB, actorId: CHLOE, type: "follow" })).toBe(true);
    expect(fake.table("notifications").map((row) => [row.user_id, row.actor_id, row.type])).toEqual([[BOB, CHLOE, "follow"]]);
  });

  it("« oncePerPost » : une seule notification de ce type, de cet auteur, pour cette publication", async () => {
    const fake = seeded({ alicePrivate: false });
    const target = await socialApp(fake.db);
    const like = { recipientId: ALICE, actorId: BOB, type: "like", postId: ALICE_PUBLIC, oncePerPost: true } as const;
    expect(await notify(target, target.log, like)).toBe(true);
    expect(await notify(target, target.log, like)).toBe(false);
    // Un autre auteur, une autre publication, un autre type : chacun la sienne.
    expect(await notify(target, target.log, { ...like, actorId: CHLOE })).toBe(true);
    expect(await notify(target, target.log, { ...like, postId: ALICE_FOLLOWERS })).toBe(true);
    expect(await notify(target, target.log, { recipientId: ALICE, actorId: BOB, type: "comment", postId: ALICE_PUBLIC, commentId: UNKNOWN })).toBe(true);
    expect(fake.table("notifications")).toHaveLength(4);
    expect(fake.table("notifications").at(-1)).toMatchObject({ type: "comment", post_id: ALICE_PUBLIC, comment_id: UNKNOWN });
  });

  it("aimer / ne plus aimer en boucle laisse au plus une notification ; un commentaire en crée une avec la publication", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    const bob = as(target, BOB);
    await bob.post(`/api/posts/${ALICE_PUBLIC}/react`);
    expect(noticesOf(fake, "like")).toHaveLength(1);
    await bob.post(`/api/posts/${ALICE_PUBLIC}/react`);
    expect(noticesOf(fake, "like")).toHaveLength(0);
    await bob.post(`/api/posts/${ALICE_PUBLIC}/react`);
    expect(noticesOf(fake, "like").map((row) => [row.user_id, row.actor_id, row.post_id])).toEqual([[ALICE, BOB, ALICE_PUBLIC]]);
    // Sa propre publication : jamais de notification.
    await as(target, ALICE).post(`/api/posts/${ALICE_PUBLIC}/react`);
    await as(target, ALICE).post(`/api/posts/${ALICE_PUBLIC}/comments`, { body: "Merci" });
    expect(fake.table("notifications")).toHaveLength(1);
    const comment = (await bob.post(`/api/posts/${ALICE_PUBLIC}/comments`, { body: "Bravo" })).json();
    expect(noticesOf(fake, "comment").map((row) => [row.user_id, row.actor_id, row.post_id, row.comment_id])).toEqual([[ALICE, BOB, ALICE_PUBLIC, comment.id]]);
  });

  it("une écriture refusée (par exemple un type que la base ne connaît pas encore) est journalisée et ne fait jamais échouer l'action", async () => {
    const fake = seeded({}, { failWrite: (table, action) => (table === "notifications" && action === "insert" ? { code: "23514", message: "check" } : null) });
    const target = await socialApp(fake.db);
    const warnings: unknown[] = [];
    const log = { ...target.log, warn: (fields: unknown) => warnings.push(fields) } as unknown as FastifyInstance["log"];
    expect(await notify(target, log, { recipientId: ALICE, actorId: BOB, type: "follow_request" })).toBe(false);
    // Journal sans identifiant de compte ni de publication.
    expect(warnings).toEqual([{ type: "follow_request", code: "23514" }]);
    // Les actions passent quand même.
    expect((await as(target, BOB).post(`/api/posts/${ALICE_PUBLIC}/react`)).statusCode).toBe(200);
    expect((await as(target, BOB).post(`/api/posts/${ALICE_PUBLIC}/comments`, { body: "Bravo" })).statusCode).toBe(200);
    expect((await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`)).json()).toEqual({ state: "requested" });
    expect((await as(target, ALICE).post(`/api/follow-requests/${CHLOE}/accept`)).statusCode).toBe(204);
    expect(fake.table("notifications")).toEqual([]);
  });

  it("règles illisibles (lecture des blocages impossible) : rien n'est écrit, aucune erreur ne remonte", async () => {
    const fake = seeded({}, { missing: ["blocks"] });
    const target = await socialApp(fake.db);
    expect(await notify(target, target.log, { recipientId: ALICE, actorId: BOB, type: "follow" })).toBe(false);
    expect(fake.table("notifications")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("export des données", () => {
  it("le réglage du compte, les demandes envoyées et les demandes reçues ; jamais celles des autres, jamais un compte en blocage", async () => {
    // Alice (privée) a reçu les demandes de Chloé et de Dan, et en a envoyé une à Eve (privée).
    const fake = seeded({ requests: [[CHLOE, ALICE], [DAN, ALICE], [ALICE, EVE], [BOB, EVE]] });
    fake.table("profiles").find((row) => row.id === EVE)!.is_private = true;
    // Un blocage efface les demandes ; s'il en restait une, elle ne serait pas exportée.
    fake.table("blocks").push({ blocker_id: DAN, blocked_id: ALICE, created_at: "2026-11-11T00:00:00+00:00" });
    const target = await socialApp(fake.db);

    const body = (await as(target, ALICE).get("/api/me/export")).json();
    expect(body.profile.is_private).toBe(true);
    expect(body.followRequestsSent).toEqual([{ target_id: EVE, created_at: "2026-11-10T00:00:00+00:00" }]);
    expect(body.followRequestsReceived).toEqual([{ requester_id: CHLOE, created_at: "2026-11-10T00:00:00+00:00" }]);
    // Clés ajoutées à la fin : les anciennes gardent leur ordre.
    // (Après elles : les trois clés de la migration 0046, commentaires.test.ts.)
    const keys = Object.keys(body);
    expect(keys.slice(keys.indexOf("followRequestsSent"), keys.indexOf("followRequestsSent") + 2)).toEqual(["followRequestsSent", "followRequestsReceived"]);
    expect(keys.indexOf("followRequestsSent")).toBe(keys.indexOf("videoConfirmations") + 1);
    expect(JSON.stringify([body.followRequestsSent, body.followRequestsReceived])).not.toContain(BOB);
    expect(JSON.stringify([body.followRequestsSent, body.followRequestsReceived])).not.toContain(DAN);

    // Fichier lisible : le nom des comptes, jamais celui du compte en blocage.
    const page = (await as(target, ALICE).get("/api/me/export?format=html")).body;
    expect(page).toContain("Demandes d&#39;abonnement");
    expect(page).toContain("Demandes envoyées (1)");
    expect(page).toContain("@eve");
    expect(page).toContain("@chloe");
    expect(page).not.toContain("@dan");

    // L'autre côté : Chloé voit sa demande envoyée, rien de reçu.
    const chloe = (await as(target, CHLOE).get("/api/me/export")).json();
    expect(chloe.followRequestsSent).toEqual([{ target_id: ALICE, created_at: "2026-11-10T00:00:00+00:00" }]);
    expect(chloe.followRequestsReceived).toEqual([]);
    expect(chloe.profile.is_private).toBe(false);
  });

  it("une demande refusée ou annulée ne figure dans aucun export : il n'en reste rien", async () => {
    const fake = seeded();
    const target = await socialApp(fake.db);
    await as(target, CHLOE).post(`/api/follows/${ALICE}?v=2`);
    await as(target, ALICE).del(`/api/follow-requests/${CHLOE}`);
    for (const user of [ALICE, CHLOE]) {
      const body = (await as(target, user).get("/api/me/export")).json();
      expect([body.followRequestsSent, body.followRequestsReceived, body.notifications]).toEqual([[], [], []]);
    }
  });

  it("sans la migration 0045 : sections vides, l'export réussit", async () => {
    const fake = seeded({}, { missing: ["follow_requests"], missingColumns: { profiles: ["is_private"] } });
    const target = await socialApp(fake.db);
    const res = await as(target, ALICE).get("/api/me/export");
    expect(res.statusCode).toBe(200);
    expect([res.json().followRequestsSent, res.json().followRequestsReceived]).toEqual([[], []]);
    expect(res.json().profile).not.toHaveProperty("is_private");
  });
});
