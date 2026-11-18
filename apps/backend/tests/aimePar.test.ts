import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMBER_LIST_PAGE_SIZE, POST_REACT_LIMIT_ERROR, type FeedPage, type MemberPage, type Post, type PrivacyLevel, type ReactToPostResponse } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import usersRoutes from "../src/routes/users.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Liste « Aimé par » (lot « vie sociale », sans migration), SANS base ni
// réseau : les vraies routes sur une fausse base en mémoire. Chaque règle de
// visibilité a son cas « refusé » ET son cas « permis ». La pagination sur de
// vraies lignes : aimeParBase.test.ts (Mac).

// Bruno a un compte public : c'est SA publication qu'on lit le plus souvent.
// Paula a un compte PRIVÉ. Anna est une inconnue. Carl, Dora, Eve, Fred
// servent aux blocages, aux suspensions et aux abonnements.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const FRED = "f0000000-0000-4000-8000-000000000006";
const PAULA = "70000000-0000-4000-8000-000000000007";
const NO_NAME = "80000000-0000-4000-8000-000000000008";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const BRUNO_PUBLIC = "b1000000-0000-4000-8000-000000000001";
const BRUNO_FOLLOWERS = "b1000000-0000-4000-8000-000000000002";
const BRUNO_PRIVATE = "b1000000-0000-4000-8000-000000000003";
const BRUNO_HIDDEN = "b1000000-0000-4000-8000-000000000004";
const PAULA_PUBLIC = "71000000-0000-4000-8000-000000000001";

const NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };

function profile(id: string, username: string | null, isPrivate = false): Row {
  return {
    id,
    username,
    display_name: username ? username[0]!.toUpperCase() + username.slice(1) : "Sans nom",
    avatar_url: null,
    bio: null,
    is_private: isPrivate,
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

/** Date du n-ième « j'aime » (le plus grand est le plus récent). */
const at = (index: number) => new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString();

interface Seed {
  /** [qui aime, publication], du plus ancien au plus récent. */
  likes?: [string, string][];
  /** [qui commente, publication]. */
  comments?: [string, string][];
  follows?: [string, string][];
  blocks?: [string, string][];
  requests?: [string, string][];
  suspended?: string[];
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  const withColumn = !(options.missingColumns?.profiles ?? []).includes("is_private");
  const rows = [profile(ANNA, "anna"), profile(BRUNO, "bruno"), profile(CARL, "carl"), profile(DORA, "dora"), profile(EVE, "eve"), profile(FRED, "fred"), profile(PAULA, "paula", true), profile(NO_NAME, null)];
  for (const row of rows) if (!withColumn) delete row.is_private;
  fake.table("profiles").push(...rows);
  fake.table("posts").push(post(BRUNO_PUBLIC, BRUNO, "public"), post(BRUNO_FOLLOWERS, BRUNO, "followers"), post(BRUNO_PRIVATE, BRUNO, "private"), post(BRUNO_HIDDEN, BRUNO, "public", true), post(PAULA_PUBLIC, PAULA, "public"));
  for (const [index, [user, postId]] of (seed.likes ?? []).entries()) fake.table("post_reactions").push({ post_id: postId, user_id: user, created_at: at(index) });
  for (const [index, [user, postId]] of (seed.comments ?? []).entries()) fake.table("comments").push({ post_id: postId, user_id: user, body: `Commentaire ${index}`, created_at: at(index) });
  for (const [follower, followee] of seed.follows ?? []) fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [requester, target] of seed.requests ?? []) fake.table("follow_requests").push({ requester_id: requester, target_id: target, created_at: "2026-11-10T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  return fake;
}

let app: FastifyInstance | null = null;
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête. */
async function likesApp(db: unknown): Promise<FastifyInstance> {
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
  await app.register(usersRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string) => target.inject({ method: "POST", url, headers }),
  };
}

type Fake = ReturnType<typeof fakeSupabase>;
const idsOf = (page: MemberPage) => page.members.map((member) => member.id);
const likesUrl = (postId: string, cursor?: string | null) => `/api/posts/${postId}/likes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
async function likers(target: FastifyInstance, viewer: string, postId: string): Promise<string[]> {
  const response = await as(target, viewer).get(likesUrl(postId));
  expect(response.statusCode).toBe(200);
  return idsOf(response.json());
}
/** La publication telle que ce lecteur la reçoit (détail). */
async function postSeenBy(target: FastifyInstance, viewer: string, postId: string): Promise<Post> {
  const response = await as(target, viewer).get(`/api/posts/${postId}`);
  expect(response.statusCode).toBe(200);
  return response.json();
}
const likesOf = (fake: Fake, postId: string) => fake.table("post_reactions").filter((row) => row.post_id === postId).map((row) => String(row.user_id));
/** Une base dont la lecture des blocages tombe en panne. */
function withBrokenBlocks(fake: Fake): FastifyInstance["supabaseAdmin"] {
  const real = fake.db as { from: (name: string) => unknown };
  const broken = Promise.resolve({ data: null, error: { message: "panne" } });
  return {
    ...real,
    from: (name: string) => (name === "blocks" ? { select: () => ({ eq: () => Object.assign(broken, { in: () => broken }) }) } : real.from(name)),
  } as unknown as FastifyInstance["supabaseAdmin"];
}

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

describe("règles de visibilité de la liste « Aimé par » (une par test, avec son cas permis)", () => {
  it("règle 1 (refusé) : pas de liste pour qui ne peut pas voir la publication — 404, la même réponse que pour une publication inconnue", async () => {
    const likes: [string, string][] = [[DORA, BRUNO_PUBLIC], [DORA, BRUNO_FOLLOWERS], [BRUNO, BRUNO_PRIVATE], [DORA, BRUNO_HIDDEN], [FRED, PAULA_PUBLIC]];
    const fake = seeded({ likes, follows: [[DORA, BRUNO], [FRED, PAULA]], blocks: [[BRUNO, CARL], [EVE, BRUNO]], requests: [[DORA, PAULA]] });
    const target = await likesApp(fake.db);

    const refused: [string, string, string][] = [
      ["publication inconnue", ANNA, UNKNOWN],
      ["masquée par la modération, même pour un abonné", DORA, BRUNO_HIDDEN],
      ["masquée par la modération, même pour son auteur", BRUNO, BRUNO_HIDDEN],
      ["bloqué par l'auteur", CARL, BRUNO_PUBLIC],
      ["a bloqué l'auteur", EVE, BRUNO_PUBLIC],
      ["réservée aux abonnés, lue par une inconnue", ANNA, BRUNO_FOLLOWERS],
      ["privée, lue par un abonné", DORA, BRUNO_PRIVATE],
      ["compte privé, lue par une inconnue", ANNA, PAULA_PUBLIC],
      ["compte privé, demande encore en attente", DORA, PAULA_PUBLIC],
    ];
    for (const [label, viewer, postId] of refused) {
      const response = await as(target, viewer).get(likesUrl(postId));
      expect(response.statusCode, label).toBe(404);
      expect(response.json(), label).toEqual(NOT_FOUND);
      // Pas un nom, pas un identifiant de ceux qui ont aimé.
      expect(response.body, label).not.toContain(DORA);
      expect(response.body, label).not.toContain(FRED);
    }
    // Sans session, identifiant ou curseur invalide.
    expect((await target.inject({ method: "GET", url: likesUrl(BRUNO_PUBLIC) })).statusCode).toBe(401);
    expect((await as(target, ANNA).get("/api/posts/pas-un-identifiant/likes")).statusCode).toBe(400);
    expect((await as(target, ANNA).get(`${likesUrl(BRUNO_PUBLIC)}?cursor=pas-une-date`)).statusCode).toBe(400);
  });

  it("règle 1 (permis) : tout membre pour une publication publique, l'abonné pour « abonnés », l'auteur pour la sienne, l'abonné accepté d'un compte privé", async () => {
    const fake = seeded({
      likes: [[DORA, BRUNO_PUBLIC], [DORA, BRUNO_FOLLOWERS], [BRUNO, BRUNO_PRIVATE], [FRED, PAULA_PUBLIC]],
      follows: [[DORA, BRUNO], [FRED, PAULA]],
    });
    const target = await likesApp(fake.db);

    expect(await likers(target, ANNA, BRUNO_PUBLIC)).toEqual([DORA]);
    expect(await likers(target, DORA, BRUNO_FOLLOWERS)).toEqual([DORA]);
    expect(await likers(target, BRUNO, BRUNO_PRIVATE)).toEqual([BRUNO]);
    expect(await likers(target, FRED, PAULA_PUBLIC)).toEqual([FRED]);
    expect(await likers(target, PAULA, PAULA_PUBLIC)).toEqual([FRED]);

    const response = await as(target, DORA).get(likesUrl(BRUNO_PUBLIC));
    expect(response.headers["cache-control"]).toBe("no-store");
    // L'état du bouton est celui du LECTEUR envers chaque ligne.
    expect((response.json() as MemberPage).members[0]).toEqual({ id: DORA, username: "dora", displayName: "Dora", avatarUrl: null, isFollowing: false, isPrivate: false, followState: "none", isMe: true });
    expect((response.json() as MemberPage).nextCursor).toBeNull();
  });

  it("règle 2 : un compte en blocage avec le lecteur, dans un sens ou dans l'autre, n'est ni dans la liste ni dans le nombre de « j'aime »", async () => {
    // Carl a bloqué Anna ; Anna a bloqué Dora. Eve n'est en blocage avec personne.
    const fake = seeded({ likes: [[CARL, BRUNO_PUBLIC], [DORA, BRUNO_PUBLIC], [EVE, BRUNO_PUBLIC]], blocks: [[CARL, ANNA], [ANNA, DORA]] });
    const target = await likesApp(fake.db);

    // Refusé : Anna ne voit ni Carl ni Dora, et le nombre suit.
    expect(await likers(target, ANNA, BRUNO_PUBLIC)).toEqual([EVE]);
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).reactionCount).toBe(1);
    // Dans l'autre sens : Carl et Dora ne voient pas Anna si elle aime à son tour.
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(200);
    expect(await likers(target, CARL, BRUNO_PUBLIC)).toEqual([EVE, DORA, CARL]);
    expect(await likers(target, DORA, BRUNO_PUBLIC)).toEqual([EVE, DORA, CARL]);
    expect((await postSeenBy(target, CARL, BRUNO_PUBLIC)).reactionCount).toBe(3);
    // Permis : Fred, sans blocage, les voit tous les quatre.
    expect(await likers(target, FRED, BRUNO_PUBLIC)).toEqual([ANNA, EVE, DORA, CARL]);
    expect((await postSeenBy(target, FRED, BRUNO_PUBLIC)).reactionCount).toBe(4);
  });

  it("règle 3 : un compte suspendu, ou sans nom d'utilisateur, n'est pas dans la liste", async () => {
    const fake = seeded({ likes: [[EVE, BRUNO_PUBLIC], [NO_NAME, BRUNO_PUBLIC], [FRED, BRUNO_PUBLIC]], suspended: [EVE] });
    const target = await likesApp(fake.db);

    expect(await likers(target, ANNA, BRUNO_PUBLIC)).toEqual([FRED]);
    // Même pour l'auteur de la publication.
    expect(await likers(target, BRUNO, BRUNO_PUBLIC)).toEqual([FRED]);
    // Permis : la suspension levée, Eve revient.
    fake.table("suspensions").length = 0;
    expect(await likers(target, ANNA, BRUNO_PUBLIC)).toEqual([FRED, EVE]);
  });

  it("règle 4 (refusé) : un compte privé qui a aimé n'est pas montré à un inconnu — ni à qui attend encore sa réponse", async () => {
    // Bruno : auteur public. Paula : privée, elle a aimé. Anna : inconnue de Paula. Dora : demande en attente.
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC], [PAULA, BRUNO_PUBLIC]], requests: [[DORA, PAULA]], follows: [[PAULA, DORA]] });
    const target = await likesApp(fake.db);

    const stranger = await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    expect(idsOf(stranger.json())).toEqual([FRED]);
    expect(stranger.body).not.toContain(PAULA);
    expect(stranger.body).not.toContain("paula");
    // Une demande en attente n'ouvre rien, même si Paula suit Dora.
    const pending = await as(target, DORA).get(likesUrl(BRUNO_PUBLIC));
    expect(idsOf(pending.json())).toEqual([FRED]);
    expect(pending.body).not.toContain(PAULA);
  });

  it("règle 4 (permis) : le compte privé est montré à lui-même, à l'auteur de la publication et à ses abonnés acceptés", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC], [PAULA, BRUNO_PUBLIC]], follows: [[CARL, PAULA]] });
    const target = await likesApp(fake.db);

    expect(await likers(target, PAULA, BRUNO_PUBLIC)).toEqual([PAULA, FRED]);
    // Bruno, l'auteur, ne suit pas Paula : il la voit quand même (il a reçu la notification).
    expect(await likers(target, BRUNO, BRUNO_PUBLIC)).toEqual([PAULA, FRED]);
    const follower: MemberPage = (await as(target, CARL).get(likesUrl(BRUNO_PUBLIC))).json();
    expect(idsOf(follower)).toEqual([PAULA, FRED]);
    expect(follower.members[0]).toMatchObject({ id: PAULA, isPrivate: true, isFollowing: true, followState: "following", isMe: false });
  });

  it("règle 5 : la réponse ne dit jamais combien de lignes ont été laissées de côté ; le nombre de « j'aime » peut dépasser la liste", async () => {
    const fake = seeded({ likes: [[PAULA, BRUNO_PUBLIC], [EVE, BRUNO_PUBLIC], [NO_NAME, BRUNO_PUBLIC], [FRED, BRUNO_PUBLIC]], suspended: [EVE] });
    const target = await likesApp(fake.db);

    const response = await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    const page: MemberPage = response.json();
    expect(idsOf(page)).toEqual([FRED]);
    // Ni total, ni nombre de lignes écartées : deux clés, rien d'autre.
    expect(Object.keys(page).sort()).toEqual(["members", "nextCursor"]);
    expect(page.nextCursor).toBeNull();
    // Le nombre ne nomme personne : il compte les quatre.
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).reactionCount).toBe(4);
  });

  it("règle 6 : rien d'autre sur une personne que l'identité et l'état du bouton — jamais la date de son « j'aime »", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC], [CARL, BRUNO_PUBLIC]] });
    const target = await likesApp(fake.db);
    const response = await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    const page: MemberPage = response.json();
    expect(page.members).toHaveLength(2);
    for (const member of page.members) {
      expect(Object.keys(member).sort()).toEqual(["avatarUrl", "displayName", "followState", "id", "isFollowing", "isMe", "isPrivate", "username"]);
    }
    // Dernière page : pas de curseur, donc aucune date dans la réponse.
    expect(response.body).not.toContain("2026-11-02");
    expect(response.body).not.toMatch(/created_?at/i);
    expect(response.body).not.toContain(BRUNO_PUBLIC);
  });

  it("une lecture, pas une écriture : un compte suspendu lit la liste ; il ne peut toujours pas aimer", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC]], suspended: [ANNA] });
    const target = await likesApp(fake.db);
    expect(await likers(target, ANNA, BRUNO_PUBLIC)).toEqual([FRED]);
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(403);
    expect(likesOf(fake, BRUNO_PUBLIC)).toEqual([FRED]);
  });
});

describe("pages et curseur", () => {
  /** 35 « j'aime » sur la publication de Bruno, du plus ancien (0) au plus récent (34). */
  function manyLikes(isPrivate: (index: number) => boolean, suspended: (index: number) => boolean = () => false) {
    const fake = seeded();
    const members = Array.from({ length: 35 }, (_, index) => ({ id: randomUUID(), index }));
    for (const member of members) {
      fake.table("profiles").push(profile(member.id, `membre${member.index}`, isPrivate(member.index)));
      fake.table("post_reactions").push({ post_id: BRUNO_PUBLIC, user_id: member.id, created_at: at(member.index) });
      if (suspended(member.index)) fake.table("suspensions").push({ user_id: member.id, moderation_action_id: UNKNOWN });
    }
    return { fake, members };
  }

  it("30 lignes lues par page, les plus récentes d'abord ; le curseur est la date de la dernière ligne LUE, même si elle n'est pas montrée", async () => {
    expect(MEMBER_LIST_PAGE_SIZE).toBe(30);
    // La 30ᵉ ligne lue (index 5) est un compte suspendu, comme la 1ʳᵉ (index 34).
    const { fake, members } = manyLikes(() => false, (index) => index === 5 || index === 34);
    const target = await likesApp(fake.db);

    const first: MemberPage = (await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC))).json();
    expect(first.members).toHaveLength(28);
    expect(first.members[0]!.id).toBe(members[33]!.id);
    expect(first.members.at(-1)!.id).toBe(members[6]!.id);
    expect(first.nextCursor).toBe(at(5));

    const second: MemberPage = (await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC, first.nextCursor))).json();
    expect(idsOf(second)).toEqual([4, 3, 2, 1, 0].map((index) => members[index]!.id));
    expect(second.nextCursor).toBeNull();
    // Aucune ligne en double, aucune oubliée.
    expect(new Set([...idsOf(first), ...idsOf(second)]).size).toBe(33);
  });

  it("une page VIDE garde son curseur tant qu'il reste des lignes à lire ; l'auteur, lui, voit tout le monde", async () => {
    // Les 30 « j'aime » les plus récents viennent de comptes privés, qu'Anna ne suit pas.
    const { fake, members } = manyLikes((index) => index >= 5);
    const target = await likesApp(fake.db);

    const first: MemberPage = (await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC))).json();
    expect(first).toEqual({ members: [], nextCursor: at(5) });
    const second: MemberPage = (await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC, first.nextCursor))).json();
    expect(idsOf(second)).toEqual([4, 3, 2, 1, 0].map((index) => members[index]!.id));
    expect(second.nextCursor).toBeNull();
    const own: MemberPage = (await as(target, BRUNO).get(likesUrl(BRUNO_PUBLIC))).json();
    expect(own.members).toHaveLength(30);
    expect(own.nextCursor).toBe(at(5));
  });

  it("personne n'a aimé : aucune ligne, aucune suite ; les « j'aime » d'une autre publication ne s'y mêlent pas", async () => {
    const target = await likesApp(seeded({ likes: [[FRED, BRUNO_FOLLOWERS]] }).db);
    expect((await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC))).json()).toEqual({ members: [], nextCursor: null });
  });

  it("aimer puis ne plus aimer : la ligne apparaît, puis disparaît", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC]] });
    const target = await likesApp(fake.db);
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).json()).toEqual({ reactionCount: 2, viewerHasReacted: true });
    expect(await likers(target, CARL, BRUNO_PUBLIC)).toEqual([ANNA, FRED]);
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).json()).toEqual({ reactionCount: 1, viewerHasReacted: false });
    expect(await likers(target, CARL, BRUNO_PUBLIC)).toEqual([FRED]);
  });

  it("un nombre fixe de lectures par page, quel que soit le nombre de lignes", async () => {
    const { fake } = manyLikes((index) => index % 2 === 0);
    const target = await likesApp(fake.db);
    let reads = 0;
    const counted = new Proxy(fake.db as object, {
      get(db, property, receiver) {
        if (property === "from") reads += 1;
        return Reflect.get(db, property, receiver) as unknown;
      },
    });
    target.supabaseAdmin = counted as FastifyInstance["supabaseAdmin"];
    // Une première requête : la sonde de la migration 0045 (mémorisée ensuite).
    await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    reads = 0;
    await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    const forThirty = reads;
    reads = 0;
    fake.table("post_reactions").splice(2);
    await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC));
    expect(forThirty).toBe(reads);
    expect(forThirty).toBe(13);
  });

  it("lecture des blocages impossible : une erreur (500), jamais une liste montrée par défaut", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC]] });
    const target = await likesApp(fake.db);
    target.supabaseAdmin = withBrokenBlocks(fake);
    const response = await as(target, CARL).get(likesUrl(BRUNO_PUBLIC));
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(FRED);
  });
});

describe("nombres affichés sous une publication : sans les comptes en blocage avec le lecteur", () => {
  // Carl a bloqué Anna ; Anna a bloqué Dora. Chacun a aimé et commenté.
  const seed: Seed = {
    likes: [[CARL, BRUNO_PUBLIC], [DORA, BRUNO_PUBLIC], [EVE, BRUNO_PUBLIC], [CARL, BRUNO_FOLLOWERS]],
    comments: [[CARL, BRUNO_PUBLIC], [DORA, BRUNO_PUBLIC], [DORA, BRUNO_PUBLIC], [EVE, BRUNO_PUBLIC]],
    blocks: [[CARL, ANNA], [ANNA, DORA]],
    follows: [[ANNA, BRUNO]],
  };

  it("détail, profil et fil : « j'aime » et commentaires des comptes bloqués ne sont plus comptés (refusé), les autres le restent (permis)", async () => {
    const target = await likesApp(seeded(seed).db);

    const detail = await postSeenBy(target, ANNA, BRUNO_PUBLIC);
    expect([detail.reactionCount, detail.commentCount]).toEqual([1, 1]);
    const onProfile: FeedPage = (await as(target, ANNA).get(`/api/users/${BRUNO}/posts`)).json();
    expect(onProfile.posts.map((item) => [item.id, item.reactionCount, item.commentCount])).toEqual(
      expect.arrayContaining([[BRUNO_PUBLIC, 1, 1], [BRUNO_FOLLOWERS, 0, 0]])
    );
    const feed: FeedPage = (await as(target, ANNA).get("/api/feed")).json();
    expect(feed.posts.find((item) => item.id === BRUNO_PUBLIC)).toMatchObject({ reactionCount: 1, commentCount: 1 });

    // Fred, sans blocage : tout est compté.
    const all = await postSeenBy(target, FRED, BRUNO_PUBLIC);
    expect([all.reactionCount, all.commentCount]).toEqual([3, 4]);
    // Carl ne voit pas Anna, mais voit Dora et Eve.
    const carl = await postSeenBy(target, CARL, BRUNO_PUBLIC);
    expect([carl.reactionCount, carl.commentCount, carl.viewerHasReacted]).toEqual([3, 4, true]);
  });

  it("un commentaire masqué par la modération n'est toujours pas compté", async () => {
    const fake = seeded(seed);
    fake.table("comments").find((row) => row.user_id === EVE)!.hidden_at = "2026-11-12T00:00:00+00:00";
    const target = await likesApp(fake.db);
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).commentCount).toBe(0);
    expect((await postSeenBy(target, FRED, BRUNO_PUBLIC)).commentCount).toBe(3);
  });

  it("la réponse d'un « j'aime » compte de la même façon que le fil", async () => {
    const fake = seeded(seed);
    const target = await likesApp(fake.db);

    // Anna aime : elle-même et Eve (ni Carl ni Dora).
    const liked: ReactToPostResponse = (await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).json();
    expect(liked).toEqual({ reactionCount: 2, viewerHasReacted: true });
    expect((await postSeenBy(target, ANNA, BRUNO_PUBLIC)).reactionCount).toBe(2);
    // Elle n'aime plus : reste Eve.
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).json()).toEqual({ reactionCount: 1, viewerHasReacted: false });
    // Fred, sans blocage : les trois, plus lui.
    expect((await as(target, FRED).post(`/api/posts/${BRUNO_PUBLIC}/react`)).json()).toEqual({ reactionCount: 4, viewerHasReacted: true });
    expect(likesOf(fake, BRUNO_PUBLIC).sort()).toEqual([CARL, DORA, EVE, FRED].sort());
  });

  it("lecture des blocages impossible : 500, et le « j'aime » n'est PAS enregistré derrière l'erreur", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC]] });
    const target = await likesApp(fake.db);
    target.supabaseAdmin = withBrokenBlocks(fake);
    expect((await as(target, FRED).get(`/api/posts/${BRUNO_PUBLIC}`)).statusCode).toBe(500);
    // Ni ajouté (Dora), ni retiré (Fred).
    expect((await as(target, DORA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(500);
    expect((await as(target, FRED).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(500);
    expect(likesOf(fake, BRUNO_PUBLIC)).toEqual([FRED]);
    expect(fake.table("notifications")).toHaveLength(0);
  });
});

describe("limites de débit", () => {
  it("« Aimé par » partage la limite des listes (« memberList ») ; aimer déclare « postReact » : 300 par heure, avec sa phrase", async () => {
    await likesApp(seeded().db);
    expect(limitNames.get("GET /api/posts/:id/likes")).toBe("memberList");
    expect(limitNames.get("POST /api/posts/:id/react")).toBe("postReact");
    expect(RATE_LIMITS.postReact).toEqual({ max: 300, windowMs: 60 * 60 * 1000, error: POST_REACT_LIMIT_ERROR, message: "Trop de j'aime en peu de temps. Réessayez dans un moment." });
    expect(POST_REACT_LIMIT_ERROR).toBe("post_react_limit");
    expect(localizeMessage(RATE_LIMITS.postReact.message, 429, "en")).toBe("Too many likes in a short time. Please try again in a moment.");
  });

  it("au-delà de 300 « j'aime » en une heure : 429 « post_react_limit » pour ce membre seulement, et rien n'est écrit", async () => {
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const member = randomUUID();
    const fake = seeded();
    fake.table("profiles").push(profile(member, "lise"));
    const target = await likesApp(fake.db);
    for (let i = 0; i < 300; i += 1) expect((await as(target, member).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(200);
    // 300 appels : aimé, plus aimé… la publication n'est plus aimée.
    expect(likesOf(fake, BRUNO_PUBLIC)).toEqual([]);
    const refused = await as(target, member).post(`/api/posts/${BRUNO_PUBLIC}/react`);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "post_react_limit", message: "Trop de j'aime en peu de temps. Réessayez dans un moment." });
    expect(likesOf(fake, BRUNO_PUBLIC)).toEqual([]);
    // Une seule notification pour l'auteur, malgré la boucle ; un autre membre aime normalement.
    expect(fake.table("notifications").length).toBeLessThanOrEqual(1);
    expect((await as(target, ANNA).post(`/api/posts/${BRUNO_PUBLIC}/react`)).statusCode).toBe(200);
  });

  it("au-delà de 600 listes en une heure : 429 « member_list_limit », sans un nom", async () => {
    process.env.NODE_ENV = "development";
    const reader = randomUUID();
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC]] });
    fake.table("profiles").push(profile(reader, "lise"));
    const target = await likesApp(fake.db);
    for (let i = 0; i < 300; i += 1) {
      expect((await as(target, reader).get(likesUrl(BRUNO_PUBLIC))).statusCode).toBe(200);
      // Le même compteur que les listes d'abonnés.
      expect((await as(target, reader).get(`/api/users/${BRUNO}/followers`)).statusCode).toBe(200);
    }
    const refused = await as(target, reader).get(likesUrl(BRUNO_PUBLIC));
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "member_list_limit", message: "Trop de listes ouvertes. Réessayez dans un moment." });
    expect(refused.body).not.toContain(FRED);
  });
});

describe("sans la migration 0045 : tous les comptes sont publics, la liste marche", () => {
  it("la liste répond, Paula comprise ; sa publication se lit comme celle d'un compte public", async () => {
    const fake = seeded({ likes: [[FRED, BRUNO_PUBLIC], [PAULA, BRUNO_PUBLIC], [FRED, PAULA_PUBLIC]] }, { missing: ["follow_requests"], missingColumns: { profiles: ["is_private"] } });
    const target = await likesApp(fake.db);
    const page: MemberPage = (await as(target, ANNA).get(likesUrl(BRUNO_PUBLIC))).json();
    expect(idsOf(page)).toEqual([PAULA, FRED]);
    expect(page.members[0]).toMatchObject({ id: PAULA, isPrivate: false, followState: "none" });
    expect(await likers(target, ANNA, PAULA_PUBLIC)).toEqual([FRED]);
  });
});
