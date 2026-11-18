import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMBER_LIST_LIMIT_ERROR, MEMBER_LIST_PAGE_SIZE, PRIVATE_ACCOUNT_ERROR, type FeedPage, type MemberPage, type UserProfile } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import followsRoutes from "../src/routes/follows.js";
import usersRoutes from "../src/routes/users.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Listes des abonnés et des abonnements, et retrait d'un abonné (lot « vie
// sociale », sans migration), SANS base ni réseau : les vraies routes sur une
// fausse base en mémoire. Chaque règle de visibilité a son cas « refusé » ET
// son cas « permis ». La pagination sur de vraies lignes et la perte d'accès
// d'un abonné retiré : listesAbonnesBase.test.ts (Mac).

// Bruno a un compte public : c'est SA liste qu'on lit le plus souvent.
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
const PAULA_POST = "71000000-0000-4000-8000-000000000001";

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

interface Seed {
  /** [abonné, compte suivi], du plus ancien au plus récent. */
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
  for (const [index, [follower, followee]] of (seed.follows ?? []).entries()) {
    fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString() });
  }
  for (const [blocker, blocked] of seed.blocks ?? []) fake.table("blocks").push({ blocker_id: blocker, blocked_id: blocked, created_at: "2026-10-01T00:00:00+00:00" });
  for (const [requester, target] of seed.requests ?? []) fake.table("follow_requests").push({ requester_id: requester, target_id: target, created_at: "2026-11-10T00:00:00+00:00" });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  return fake;
}

let app: FastifyInstance | null = null;
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

/** L'app de test : les vraies routes, une fausse base, un compte par en-tête. */
async function listsApp(db: unknown): Promise<FastifyInstance> {
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
  await app.register(followsRoutes);
  await app.register(usersRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    del: (url: string) => target.inject({ method: "DELETE", url, headers }),
  };
}

type Fake = ReturnType<typeof fakeSupabase>;
const followsOf = (fake: Fake) => fake.table("follows").map((row) => `${String(row.follower_id)}>${String(row.followee_id)}`);
const idsOf = (page: MemberPage) => page.members.map((member) => member.id);
async function listIds(target: FastifyInstance, viewer: string, owner: string, kind: "followers" | "following"): Promise<string[]> {
  const response = await as(target, viewer).get(`/api/users/${owner}/${kind}`);
  expect(response.statusCode).toBe(200);
  return idsOf(response.json());
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

describe("règles de visibilité des listes (une par test, avec son cas permis)", () => {
  it("règle 1 : un membre lit ses deux listes en entier, comptes privés compris — sauf les comptes en blocage avec lui", async () => {
    // Abonnés de Bruno : Anna, Paula (privée, que Bruno ne suit pas), Carl (qui a bloqué Bruno), Dora (que Bruno a bloquée).
    // Abonnements de Bruno : Eve, Paula, Fred (qui a bloqué Bruno).
    const fake = seeded({
      follows: [[ANNA, BRUNO], [PAULA, BRUNO], [CARL, BRUNO], [DORA, BRUNO], [BRUNO, EVE], [BRUNO, PAULA], [BRUNO, FRED]],
      blocks: [[CARL, BRUNO], [BRUNO, DORA], [FRED, BRUNO]],
    });
    const target = await listsApp(fake.db);

    // Les plus récents d'abord ; ni Carl ni Dora.
    expect(await listIds(target, BRUNO, BRUNO, "followers")).toEqual([PAULA, ANNA]);
    expect(await listIds(target, BRUNO, BRUNO, "following")).toEqual([PAULA, EVE]);

    const page: MemberPage = (await as(target, BRUNO).get(`/api/users/${BRUNO}/followers`)).json();
    // L'état du bouton est celui du LECTEUR envers chaque ligne.
    expect(page.members[0]).toEqual({ id: PAULA, username: "paula", displayName: "Paula", avatarUrl: null, isFollowing: true, isPrivate: true, followState: "following", isMe: false });
    expect(page.members[1]).toMatchObject({ id: ANNA, isFollowing: false, followState: "none", isPrivate: false, isMe: false });
    expect(page.nextCursor).toBeNull();
  });

  it("règle 2 (refusé) : jamais à travers un blocage (404, comme un profil inconnu), jamais un compte privé sans en être un abonné accepté (403)", async () => {
    const fake = seeded({
      follows: [[BRUNO, PAULA], [CARL, PAULA], [PAULA, DORA]],
      blocks: [[PAULA, CARL], [EVE, BRUNO]],
      requests: [[DORA, PAULA]],
    });
    const target = await listsApp(fake.db);
    const notFound = { error: "user_not_found", message: "Profil introuvable." };
    const isPrivate = { error: PRIVATE_ACCOUNT_ERROR, message: "Ce compte est privé." };

    for (const kind of ["followers", "following"] as const) {
      // Anna, inconnue de Paula : 403, et pas une ligne.
      const stranger = await as(target, ANNA).get(`/api/users/${PAULA}/${kind}`);
      expect(stranger.statusCode, kind).toBe(403);
      expect(stranger.json(), kind).toEqual(isPrivate);
      // Dora a une demande EN ATTENTE auprès de Paula (et Paula la suit) : toujours 403.
      expect((await as(target, DORA).get(`/api/users/${PAULA}/${kind}`)).json(), kind).toEqual(isPrivate);
      // Carl suivait Paula, qui l'a bloqué (ligne « follows » restée) : 404, pas 403.
      const blocked = await as(target, CARL).get(`/api/users/${PAULA}/${kind}`);
      expect(blocked.statusCode, kind).toBe(404);
      expect(blocked.json(), kind).toEqual(notFound);
      // Blocage dans l'autre sens, avec un compte public.
      expect((await as(target, BRUNO).get(`/api/users/${EVE}/${kind}`)).statusCode, kind).toBe(404);
      expect((await as(target, EVE).get(`/api/users/${BRUNO}/${kind}`)).statusCode, kind).toBe(404);
      // Profil inconnu, ou pas encore complété : la même réponse qu'un blocage.
      expect((await as(target, ANNA).get(`/api/users/${UNKNOWN}/${kind}`)).json(), kind).toEqual(notFound);
      expect((await as(target, ANNA).get(`/api/users/${NO_NAME}/${kind}`)).json(), kind).toEqual(notFound);
      // Sans session, identifiant ou curseur invalide.
      expect((await target.inject({ method: "GET", url: `/api/users/${BRUNO}/${kind}` })).statusCode, kind).toBe(401);
      expect((await as(target, ANNA).get(`/api/users/pas-un-identifiant/${kind}`)).statusCode, kind).toBe(400);
      expect((await as(target, ANNA).get(`/api/users/${BRUNO}/${kind}?cursor=pas-une-date`)).statusCode, kind).toBe(400);
    }
  });

  it("règle 2 (permis) : l'abonné accepté d'un compte privé, le compte lui-même, et tout membre pour un compte public", async () => {
    const fake = seeded({ follows: [[BRUNO, PAULA], [PAULA, DORA], [ANNA, BRUNO]] });
    const target = await listsApp(fake.db);

    expect(await listIds(target, BRUNO, PAULA, "followers")).toEqual([BRUNO]);
    expect(await listIds(target, BRUNO, PAULA, "following")).toEqual([DORA]);
    expect(await listIds(target, PAULA, PAULA, "followers")).toEqual([BRUNO]);
    // Compte public : un inconnu lit la liste.
    expect(await listIds(target, CARL, BRUNO, "followers")).toEqual([ANNA]);
    const own: MemberPage = (await as(target, BRUNO).get(`/api/users/${PAULA}/followers`)).json();
    expect(own.members[0]).toMatchObject({ id: BRUNO, isMe: true, followState: "none" });
  });

  it("règle 3 : une ligne est laissée de côté quand le compte est en blocage avec le LECTEUR, suspendu, ou sans nom d'utilisateur", async () => {
    // Anna lit les abonnés de Bruno. Carl suit Bruno et a bloqué Anna ; Dora suit Bruno et Anna l'a bloquée.
    const fake = seeded({
      follows: [[CARL, BRUNO], [DORA, BRUNO], [EVE, BRUNO], [NO_NAME, BRUNO], [FRED, BRUNO], [BRUNO, CARL], [BRUNO, EVE], [BRUNO, FRED]],
      blocks: [[CARL, ANNA], [ANNA, DORA]],
      suspended: [EVE],
    });
    const target = await listsApp(fake.db);

    expect(await listIds(target, ANNA, BRUNO, "followers")).toEqual([FRED]);
    expect(await listIds(target, ANNA, BRUNO, "following")).toEqual([FRED]);
    // Cas permis : Fred, sans blocage avec personne, voit Carl et Dora — jamais Eve (suspendue) ni le profil incomplet.
    expect(await listIds(target, FRED, BRUNO, "followers")).toEqual([FRED, DORA, CARL]);
    // Le propriétaire de la liste ne voit pas non plus un compte suspendu ou incomplet.
    expect(await listIds(target, BRUNO, BRUNO, "followers")).toEqual([FRED, DORA, CARL]);
  });

  it("règle 4 : un compte privé n'apparaît dans la liste d'un autre que pour lui-même, ses abonnés acceptés et le propriétaire de la liste", async () => {
    // Paula (privée) suit Bruno, et Bruno la suit. Carl est un abonné accepté de Paula. Dora a une demande en attente.
    const fake = seeded({ follows: [[PAULA, BRUNO], [ANNA, BRUNO], [CARL, PAULA], [BRUNO, PAULA], [BRUNO, FRED]], requests: [[DORA, PAULA]] });
    const target = await listsApp(fake.db);

    // Anna, inconnue de Paula : elle ne peut apprendre ni que Paula suit Bruno, ni que Bruno suit Paula.
    expect(await listIds(target, ANNA, BRUNO, "followers")).toEqual([ANNA]);
    expect(await listIds(target, ANNA, BRUNO, "following")).toEqual([FRED]);
    // Une demande en attente ne suffit pas.
    expect(await listIds(target, DORA, BRUNO, "followers")).toEqual([ANNA]);
    expect(await listIds(target, DORA, BRUNO, "following")).toEqual([FRED]);
    // Bruno, propriétaire de la liste : il voit Paula.
    expect(await listIds(target, BRUNO, BRUNO, "followers")).toEqual([ANNA, PAULA]);
    // Carl, abonné accepté de Paula : il la voit.
    expect(await listIds(target, CARL, BRUNO, "followers")).toEqual([ANNA, PAULA]);
    expect(await listIds(target, CARL, BRUNO, "following")).toEqual([FRED, PAULA]);
    // Paula se voit elle-même.
    expect(await listIds(target, PAULA, BRUNO, "followers")).toEqual([ANNA, PAULA]);
  });

  it("règle 5 : le compteur du profil reste le compte réel ; la liste peut être plus courte, et la réponse ne dit jamais de combien", async () => {
    const fake = seeded({ follows: [[PAULA, BRUNO], [ANNA, BRUNO], [EVE, BRUNO]], suspended: [EVE] });
    const target = await listsApp(fake.db);

    const seen: UserProfile = (await as(target, CARL).get(`/api/users/${BRUNO}`)).json();
    expect(seen.followersCount).toBe(3);
    const response = await as(target, CARL).get(`/api/users/${BRUNO}/followers`);
    const page: MemberPage = response.json();
    expect(idsOf(page)).toEqual([ANNA]);
    // Ni total, ni nombre de lignes écartées : deux clés, rien d'autre.
    expect(Object.keys(page).sort()).toEqual(["members", "nextCursor"]);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("jamais de date d'abonnement dans une ligne, ni rien d'autre que l'identité et l'état du bouton", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO], [CARL, BRUNO]] });
    const target = await listsApp(fake.db);
    const response = await as(target, DORA).get(`/api/users/${BRUNO}/followers`);
    const page: MemberPage = response.json();
    for (const member of page.members) {
      expect(Object.keys(member).sort()).toEqual(["avatarUrl", "displayName", "followState", "id", "isFollowing", "isMe", "isPrivate", "username"]);
    }
    expect(response.body).not.toContain("2026-10-01");
    expect(response.body).not.toMatch(/created_?at/i);
  });
});

describe("pages et curseur", () => {
  const at = (index: number) => new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();

  /** 35 abonnés de Bruno, du plus ancien (0) au plus récent (34). */
  function manyFollowers(isPrivate: (index: number) => boolean, suspended: (index: number) => boolean = () => false) {
    const fake = seeded();
    const members = Array.from({ length: 35 }, (_, index) => ({ id: randomUUID(), index }));
    for (const member of members) {
      fake.table("profiles").push(profile(member.id, `membre${member.index}`, isPrivate(member.index)));
      fake.table("follows").push({ follower_id: member.id, followee_id: BRUNO, created_at: at(member.index) });
      if (suspended(member.index)) fake.table("suspensions").push({ user_id: member.id, moderation_action_id: UNKNOWN });
    }
    return { fake, members };
  }

  it("30 lignes lues par page ; le curseur est la date de la dernière ligne LUE, même si elle n'est pas montrée", async () => {
    expect(MEMBER_LIST_PAGE_SIZE).toBe(30);
    // La 30ᵉ ligne lue (index 5) est un compte suspendu, comme la 1ʳᵉ (index 34).
    const { fake, members } = manyFollowers(() => false, (index) => index === 5 || index === 34);
    const target = await listsApp(fake.db);

    const first: MemberPage = (await as(target, ANNA).get(`/api/users/${BRUNO}/followers`)).json();
    expect(first.members).toHaveLength(28);
    expect(first.members[0]!.id).toBe(members[33]!.id);
    expect(first.members.at(-1)!.id).toBe(members[6]!.id);
    expect(first.nextCursor).toBe(at(5));

    const second: MemberPage = (await as(target, ANNA).get(`/api/users/${BRUNO}/followers?cursor=${encodeURIComponent(first.nextCursor!)}`)).json();
    expect(idsOf(second)).toEqual([4, 3, 2, 1, 0].map((index) => members[index]!.id));
    expect(second.nextCursor).toBeNull();
    // Aucune ligne en double, aucune oubliée.
    expect(new Set([...idsOf(first), ...idsOf(second)]).size).toBe(33);
  });

  it("une page VIDE garde son curseur tant qu'il reste des lignes à lire : l'app continue", async () => {
    // Les 30 abonnés les plus récents sont des comptes privés, qu'Anna ne suit pas.
    const { fake, members } = manyFollowers((index) => index >= 5);
    const target = await listsApp(fake.db);

    const first: MemberPage = (await as(target, ANNA).get(`/api/users/${BRUNO}/followers`)).json();
    expect(first).toEqual({ members: [], nextCursor: at(5) });
    const second: MemberPage = (await as(target, ANNA).get(`/api/users/${BRUNO}/followers?cursor=${encodeURIComponent(first.nextCursor!)}`)).json();
    expect(idsOf(second)).toEqual([4, 3, 2, 1, 0].map((index) => members[index]!.id));
    expect(second.nextCursor).toBeNull();
    // Bruno, à qui est la liste, les voit tous dès la première page.
    const own: MemberPage = (await as(target, BRUNO).get(`/api/users/${BRUNO}/followers`)).json();
    expect(own.members).toHaveLength(30);
    expect(own.nextCursor).toBe(at(5));
  });

  it("liste vide : aucune ligne, aucune suite", async () => {
    const target = await listsApp(seeded().db);
    expect((await as(target, ANNA).get(`/api/users/${BRUNO}/followers`)).json()).toEqual({ members: [], nextCursor: null });
    expect((await as(target, ANNA).get(`/api/users/${ANNA}/following`)).json()).toEqual({ members: [], nextCursor: null });
  });

  it("un nombre fixe de lectures par page, quel que soit le nombre de lignes", async () => {
    const { fake } = manyFollowers((index) => index % 2 === 0);
    const target = await listsApp(fake.db);
    let reads = 0;
    const counted = new Proxy(fake.db as object, {
      get(db, property, receiver) {
        if (property === "from") reads += 1;
        return Reflect.get(db, property, receiver) as unknown;
      },
    });
    target.supabaseAdmin = counted as FastifyInstance["supabaseAdmin"];
    // Une première requête : la sonde de la migration 0045 (mémorisée ensuite).
    await as(target, ANNA).get(`/api/users/${BRUNO}/followers`);
    reads = 0;
    await as(target, ANNA).get(`/api/users/${BRUNO}/followers`);
    const forThirty = reads;
    reads = 0;
    fake.table("follows").splice(2);
    await as(target, ANNA).get(`/api/users/${BRUNO}/followers`);
    expect(forThirty).toBe(reads);
    expect(forThirty).toBe(13);
  });

  it("lecture des blocages impossible : une erreur (500), jamais une liste montrée par défaut", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO]] });
    const target = await listsApp(fake.db);
    const real = fake.db as { from: (name: string) => unknown };
    target.supabaseAdmin = {
      ...real,
      from: (name: string) => (name === "blocks" ? { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: null, error: { message: "panne" } }) }) }) } : real.from(name)),
    } as unknown as FastifyInstance["supabaseAdmin"];
    const response = await as(target, CARL).get(`/api/users/${BRUNO}/followers`);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(ANNA);
  });
});

describe("limite de débit des listes", () => {
  it("les deux routes déclarent la limite « memberList » : 600 par heure et par membre, avec sa phrase", async () => {
    await listsApp(seeded().db);
    expect(limitNames.get("GET /api/users/:userId/followers")).toBe("memberList");
    expect(limitNames.get("GET /api/users/:userId/following")).toBe("memberList");
    expect(RATE_LIMITS.memberList).toEqual({ max: 600, windowMs: 60 * 60 * 1000, error: MEMBER_LIST_LIMIT_ERROR, message: "Trop de listes ouvertes. Réessayez dans un moment." });
    expect(localizeMessage(RATE_LIMITS.memberList.message, 429, "en")).toBe("Too many lists opened. Please try again in a moment.");
    expect(localizeMessage("Ce compte est privé.", 403, "en")).toBe("This account is private.");
  });

  it("au-delà, 429 « member_list_limit » pour ce membre seulement ; les deux listes partagent le même compteur", async () => {
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const reader = randomUUID();
    const fake = seeded({ follows: [[ANNA, BRUNO]] });
    fake.table("profiles").push(profile(reader, "lise"));
    const target = await listsApp(fake.db);
    for (let i = 0; i < 300; i += 1) {
      expect((await as(target, reader).get(`/api/users/${BRUNO}/followers`)).statusCode).toBe(200);
      expect((await as(target, reader).get(`/api/users/${BRUNO}/following`)).statusCode).toBe(200);
    }
    const refused = await as(target, reader).get(`/api/users/${BRUNO}/followers`);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "member_list_limit", message: "Trop de listes ouvertes. Réessayez dans un moment." });
    expect(refused.body).not.toContain(ANNA);
    expect((await as(target, randomUUID()).get(`/api/users/${BRUNO}/followers`)).statusCode).toBe(200);
  });
});

describe("retirer un abonné", () => {
  it("règle 6 (refusé) : on ne retire que SES abonnés — jamais l'abonné d'un autre, jamais son propre abonnement à cette personne", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO], [BRUNO, ANNA], [ANNA, PAULA]] });
    const target = await listsApp(fake.db);

    // Carl essaie de retirer Anna des abonnés de Bruno : il n'existe aucun moyen de nommer Bruno.
    expect((await as(target, CARL).del(`/api/followers/${ANNA}`)).statusCode).toBe(204);
    expect((await as(target, CARL).del(`/api/followers/${BRUNO}`)).statusCode).toBe(204);
    // Anna « retire » Paula, qu'elle SUIT (Paula ne la suit pas) : son abonnement à Paula reste.
    expect((await as(target, ANNA).del(`/api/followers/${PAULA}`)).statusCode).toBe(204);
    expect(followsOf(fake).sort()).toEqual([`${ANNA}>${BRUNO}`, `${ANNA}>${PAULA}`, `${BRUNO}>${ANNA}`].sort());

    expect((await target.inject({ method: "DELETE", url: `/api/followers/${ANNA}` })).statusCode).toBe(401);
    expect((await as(target, BRUNO).del("/api/followers/pas-un-identifiant")).statusCode).toBe(400);
    expect(followsOf(fake)).toHaveLength(3);
  });

  it("règle 6 (permis) : le compte suivi retire son abonné ; rien d'autre ne bouge, et recommencer répond pareil", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO], [BRUNO, ANNA], [CARL, BRUNO]] });
    const target = await listsApp(fake.db);

    const removed = await as(target, BRUNO).del(`/api/followers/${ANNA}`);
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe("");
    // Bruno suit toujours Anna ; Carl suit toujours Bruno.
    expect(followsOf(fake).sort()).toEqual([`${BRUNO}>${ANNA}`, `${CARL}>${BRUNO}`].sort());
    expect(await listIds(target, BRUNO, BRUNO, "followers")).toEqual([CARL]);
    // Idempotent : une deuxième fois, une personne jamais abonnée, soi-même, un inconnu.
    for (const id of [ANNA, DORA, BRUNO, UNKNOWN]) expect((await as(target, BRUNO).del(`/api/followers/${id}`)).statusCode).toBe(204);
    expect(followsOf(fake)).toHaveLength(2);
  });

  it("la personne retirée n'est jamais prévenue : aucune notification n'est écrite", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO]] });
    const target = await listsApp(fake.db);
    await as(target, BRUNO).del(`/api/followers/${ANNA}`);
    expect(fake.table("notifications")).toEqual([]);
  });

  it("permis à un compte suspendu (il réduit son audience) ; une panne de la base répond 500 et ne prétend rien", async () => {
    const fake = seeded({ follows: [[ANNA, BRUNO]], suspended: [BRUNO] });
    const target = await listsApp(fake.db);
    expect((await as(target, BRUNO).del(`/api/followers/${ANNA}`)).statusCode).toBe(204);
    expect(followsOf(fake)).toEqual([]);

    const broken = seeded({ follows: [[ANNA, BRUNO]] }, { failWrite: (table, action) => (table === "follows" && action === "delete" ? { message: "panne simulée" } : null) });
    const second = await listsApp(broken.db);
    expect((await as(second, BRUNO).del(`/api/followers/${ANNA}`)).statusCode).toBe(500);
    expect(followsOf(broken)).toHaveLength(1);
  });

  it("règle 7 : l'abonné retiré d'un compte privé perd l'accès dès la requête suivante (publications et listes)", async () => {
    const fake = seeded({ follows: [[ANNA, PAULA], [CARL, PAULA]] });
    fake.table("posts").push({
      id: PAULA_POST,
      user_id: PAULA,
      type: "lifestyle",
      vault_item_id: null,
      wishlist_item_id: null,
      caption: "Réservé aux abonnés",
      media_url: null,
      media_thumb_url: null,
      media_removed_at: null,
      privacy: "followers",
      hidden_at: null,
      created_at: "2026-11-01T10:00:00+00:00",
    });
    const target = await listsApp(fake.db);
    const postsSeenBy = async (viewer: string) => ((await as(target, viewer).get(`/api/users/${PAULA}/posts`)).json() as FeedPage).posts.map((post) => post.id);

    expect(await postsSeenBy(ANNA)).toEqual([PAULA_POST]);
    expect((await as(target, ANNA).get(`/api/users/${PAULA}/followers`)).statusCode).toBe(200);

    expect((await as(target, PAULA).del(`/api/followers/${ANNA}`)).statusCode).toBe(204);
    expect(await postsSeenBy(ANNA)).toEqual([]);
    expect((await as(target, ANNA).get(`/api/users/${PAULA}/followers`)).statusCode).toBe(403);
    expect((await as(target, ANNA).get(`/api/users/${PAULA}`)).json()).toMatchObject({ isPrivate: true, followState: "none", postsCount: 0 });
    // Carl, toujours abonné, garde son accès.
    expect(await postsSeenBy(CARL)).toEqual([PAULA_POST]);
  });
});

describe("sans la migration 0045 : tous les comptes sont publics, les listes marchent", () => {
  it("les deux listes répondent, Paula comprise ; retirer un abonné marche aussi", async () => {
    const fake = seeded({ follows: [[PAULA, BRUNO], [ANNA, BRUNO], [BRUNO, PAULA]] }, { missing: ["follow_requests"], missingColumns: { profiles: ["is_private"] } });
    const target = await listsApp(fake.db);

    const page: MemberPage = (await as(target, CARL).get(`/api/users/${BRUNO}/followers`)).json();
    expect(idsOf(page)).toEqual([ANNA, PAULA]);
    expect(page.members.every((member) => member.isPrivate === false && member.followState === "none")).toBe(true);
    expect(await listIds(target, CARL, PAULA, "followers")).toEqual([BRUNO]);
    expect((await as(target, BRUNO).del(`/api/followers/${ANNA}`)).statusCode).toBe(204);
    expect(followsOf(fake).sort()).toEqual([`${BRUNO}>${PAULA}`, `${PAULA}>${BRUNO}`].sort());
  });
});
