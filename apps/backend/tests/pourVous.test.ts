import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_SETTING_UNAVAILABLE_ERROR,
  FOR_YOU_CACHE_MS,
  FOR_YOU_CANDIDATES,
  FOR_YOU_DAYS,
  FOR_YOU_MAX,
  FOR_YOU_PAGE_SIZE,
  FOR_YOU_PER_AUTHOR,
  SUGGESTIONS_MAX,
  type ForYouPage,
  type PrivacyLevel,
  type Profile,
  type SuggestionsResponse,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import forYouRoutes from "../src/routes/forYou.js";
import postsRoutes from "../src/routes/posts.js";
import usersRoutes from "../src/routes/users.js";
import meRoutes from "../src/routes/me.js";
import { resetPrivateAccountsProbe, type Audience } from "../src/lib/audience.js";
import { resetCollectionsProbe } from "../src/lib/collections.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { resetPostExtrasProbe } from "../src/lib/postExtras.js";
import { resetSavedPostsProbe } from "../src/lib/savedPosts.js";
import { resetProfileModerationProbe } from "../src/lib/profileModeration.js";
import { resetProfileExtrasProbe } from "../src/lib/profileExtras.js";
import {
  SUGGESTION_SECOND_ROWS_MAX,
  compareRanked,
  discoveryReady,
  forYouScore,
  forYouSet,
  pageAt,
  personalize,
  resetDiscoveryProbe,
  resetForYouCache,
  type RankedPost,
} from "../src/lib/forYou.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Fil « Pour vous » et suggestions de comptes (lot « découverte », migration
// 0050), SANS base ni réseau : les vraies routes sur une fausse base en
// mémoire (tests/fakeSupabase.ts). Chaque règle de visibilité de la fiche a
// son cas « refusé » ET son cas « permis ». Le même parcours sur la vraie
// base de développement : pourVousBase.test.ts (Mac, 0050 appliquée).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Vera regarde « Pour vous ». Elle suit Fred, a bloqué Bob, et Carl l'a
// bloquée. Anna, Dora, Gina, Hugo : comptes publics ordinaires (Dora a éteint
// « Proposer mon compte »). Paula : compte privé (Vera lui a demandé à
// s'abonner). Sam : suspendu. Nina : pas de nom d'utilisateur. Theo : inscrit
// il y a une heure. Ugo et Zoe : deux comptes tout neufs, sans abonnement.
const VERA = "0e000000-0000-4000-8000-000000000001";
const ANNA = "a0000000-0000-4000-8000-000000000002";
const BOB = "b0000000-0000-4000-8000-000000000003";
const CARL = "c0000000-0000-4000-8000-000000000004";
const DORA = "d0000000-0000-4000-8000-000000000005";
const FRED = "f0000000-0000-4000-8000-000000000006";
const GINA = "60000000-0000-4000-8000-000000000007";
const HUGO = "40000000-0000-4000-8000-000000000008";
const PAULA = "70000000-0000-4000-8000-000000000009";
const SAM = "50000000-0000-4000-8000-00000000000a";
const NINA = "90000000-0000-4000-8000-00000000000b";
const THEO = "30000000-0000-4000-8000-00000000000c";
const UGO = "10000000-0000-4000-8000-00000000000d";
const ZOE = "20000000-0000-4000-8000-00000000000e";
const REPORTER = "80000000-0000-4000-8000-00000000000f";

// Publications (toutes des photos, sauf mention).
const A1 = "a1000000-0000-4000-8000-000000000001"; // Anna, publique, 1 h
const A2 = "a1000000-0000-4000-8000-000000000002"; // Anna, publique, 2 h
const A3 = "a1000000-0000-4000-8000-000000000003"; // Anna, publique, 3 h (troisième d'Anna)
const A_FOL = "a1000000-0000-4000-8000-000000000004"; // Anna, « abonnés », 100 j'aime
const A_PRIV = "a1000000-0000-4000-8000-000000000005"; // Anna, privée
const A_HID = "a1000000-0000-4000-8000-000000000006"; // Anna, publique, masquée
const A_OLD = "a1000000-0000-4000-8000-000000000007"; // Anna, publique, il y a 15 jours
const B1 = "b1000000-0000-4000-8000-000000000001";
const C1 = "c1000000-0000-4000-8000-000000000001";
const D1 = "d1000000-0000-4000-8000-000000000001";
const F1 = "f1000000-0000-4000-8000-000000000001";
const G1 = "61000000-0000-4000-8000-000000000001"; // signalée par Vera (signalement traité)
const G2 = "61000000-0000-4000-8000-000000000002"; // signalement en attente (par un autre membre)
const H1 = "41000000-0000-4000-8000-000000000001"; // 3 j'aime, dont un de Bob (bloqué par Vera)
const H2 = "41000000-0000-4000-8000-000000000002"; // image retirée par la modération
const H3 = "41000000-0000-4000-8000-000000000003"; // sans image
const P1 = "71000000-0000-4000-8000-000000000001"; // Paula (compte privé), « publique »
const S1 = "51000000-0000-4000-8000-000000000001";
const N1 = "91000000-0000-4000-8000-000000000001";
const T1 = "31000000-0000-4000-8000-000000000001";
const V1 = "0e100000-0000-4000-8000-000000000001"; // Vera elle-même

let NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const stored = (user: string, name: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/${name}`;

function profile(id: string, username: string | null, extra: Row = {}): Row {
  return {
    id,
    username,
    display_name: username ? username[0]!.toUpperCase() + username.slice(1) : "Sans nom",
    avatar_url: null,
    bio: null,
    locale: "fr",
    default_privacy: "public",
    piece_sends_from: "following",
    messages_from: "everyone",
    is_private: false,
    mentions_from: "following",
    link_url: null,
    discoverable: true,
    created_at: ago(30 * DAY),
    updated_at: ago(30 * DAY),
    ...extra,
  };
}

function post(id: string, userId: string, privacy: PrivacyLevel, age: number, extra: Row = {}): Row {
  return {
    id,
    user_id: userId,
    type: "lifestyle",
    vault_item_id: null,
    wishlist_item_id: null,
    caption: `Légende ${id.slice(0, 2)}`,
    media_url: stored(userId, `${id}.jpg`),
    media_thumb_url: stored(userId, `${id}-mini.jpg`),
    media_removed_at: null,
    privacy,
    hidden_at: null,
    pinned_at: null,
    created_at: ago(age),
    ...extra,
  };
}

type Fake = ReturnType<typeof fakeSupabase>;
type Db = Fake["db"];

/** Ce que les tests changent dans la base type. */
interface Seed {
  /** Base sans 0050 : ni profiles.discoverable. */
  without0050?: boolean;
  /** Base sans 0045 : ni profiles.is_private, ni follow_requests. */
  without0045?: boolean;
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  NOW = Date.now();
  const missingProfileColumns = [...(seed.without0050 ? ["discoverable"] : []), ...(seed.without0045 ? ["is_private"] : [])];
  const fake = fakeSupabase({
    ...options,
    ...(missingProfileColumns.length > 0 ? { missingColumns: { ...(options.missingColumns ?? {}), profiles: missingProfileColumns } } : {}),
    ...(seed.without0045 ? { missing: [...(options.missing ?? []), "follow_requests"] } : {}),
  });
  const people = [
    profile(VERA, "vera"),
    profile(ANNA, "anna"),
    profile(BOB, "bob"),
    profile(CARL, "carl"),
    profile(DORA, "dora", { discoverable: false }),
    profile(FRED, "fred"),
    profile(GINA, "gina"),
    profile(HUGO, "hugo"),
    profile(PAULA, "paula", { is_private: true }),
    profile(SAM, "sam"),
    profile(NINA, null),
    profile(THEO, "theo", { created_at: ago(HOUR) }),
    profile(UGO, "ugo", { created_at: ago(2 * HOUR) }),
    profile(ZOE, "zoe", { created_at: ago(2 * HOUR) }),
    profile(REPORTER, "reporter"),
  ];
  for (const row of people) for (const column of missingProfileColumns) delete row[column];
  fake.table("profiles").push(...people);
  fake.table("posts").push(
    post(A1, ANNA, "public", 1 * HOUR),
    post(A2, ANNA, "public", 2 * HOUR),
    post(A3, ANNA, "public", 3 * HOUR),
    post(A_FOL, ANNA, "followers", 1 * HOUR),
    post(A_PRIV, ANNA, "private", 1 * HOUR),
    post(A_HID, ANNA, "public", 1 * HOUR, { hidden_at: ago(HOUR / 2) }),
    post(A_OLD, ANNA, "public", (FOR_YOU_DAYS + 1) * DAY),
    post(B1, BOB, "public", 4 * HOUR),
    post(C1, CARL, "public", 4 * HOUR),
    post(D1, DORA, "public", 4 * HOUR),
    post(F1, FRED, "public", 4 * HOUR),
    post(G1, GINA, "public", 5 * HOUR),
    post(G2, GINA, "public", 5 * HOUR),
    post(H1, HUGO, "public", 6 * HOUR),
    post(H2, HUGO, "public", 6 * HOUR, { media_url: null, media_thumb_url: null, media_removed_at: ago(HOUR) }),
    post(H3, HUGO, "public", 6 * HOUR, { type: "purchase", media_url: null, media_thumb_url: null }),
    post(P1, PAULA, "public", 2 * HOUR),
    post(S1, SAM, "public", 2 * HOUR),
    post(N1, NINA, "public", 2 * HOUR),
    post(T1, THEO, "public", 30 * 60_000),
    post(V1, VERA, "public", 2 * HOUR)
  );
  // « Abonnés » très aimée : jamais dans « Pour vous ».
  for (let i = 0; i < 100; i++) fake.table("post_reactions").push({ post_id: A_FOL, user_id: randomUUID(), created_at: ago(HOUR) });
  // H1 : trois j'aime, dont un de Bob (bloqué par Vera).
  for (const user of [BOB, GINA, ANNA]) fake.table("post_reactions").push({ post_id: H1, user_id: user, created_at: ago(HOUR) });
  fake.table("follows").push({ follower_id: VERA, followee_id: FRED, created_at: ago(10 * DAY) });
  if (!seed.without0045) fake.table("follow_requests").push({ requester_id: VERA, target_id: PAULA, created_at: ago(DAY) });
  fake.table("blocks").push({ blocker_id: VERA, blocked_id: BOB, created_at: ago(DAY) }, { blocker_id: CARL, blocked_id: VERA, created_at: ago(DAY) });
  fake.table("suspensions").push({ user_id: SAM, moderation_action_id: randomUUID() });
  fake.table("reports").push(
    { id: randomUUID(), reporter_id: VERA, target_type: "post", target_id: G1, reason: "spam", note: null, handled_at: ago(HOUR), moderation_action_id: null, created_at: ago(2 * HOUR) },
    { id: randomUUID(), reporter_id: REPORTER, target_type: "post", target_id: G2, reason: "spam", note: null, handled_at: null, moderation_action_id: null, created_at: ago(2 * HOUR) }
  );
  return fake;
}

/** Fait échouer (délai dépassé) les requêtes que `matches` désigne. */
function failing(db: Db, matches: (table: string, method: string, args: unknown[]) => boolean): Db {
  const failure = { data: null, error: { code: "57014", message: "délai dépassé" }, count: null };
  return {
    ...db,
    from: (table: string) => {
      const chain = db.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      let failed = false;
      const proxy: Record<string, unknown> = new Proxy(chain, {
        get(target, property) {
          const value = target[property as string];
          if (typeof value !== "function") return value;
          if (property === "then") return (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => (failed ? Promise.resolve(failure).then(resolve, reject) : value.call(target, resolve, reject));
          if (property === "range") return (...args: unknown[]) => (failed ? Promise.resolve(failure) : value.apply(target, args));
          if (property === "single" || property === "maybeSingle") return () => (failed ? Promise.resolve(failure) : value.call(target));
          return (...args: unknown[]) => {
            if (matches(table, String(property), args)) failed = true;
            const result = value.apply(target, args);
            return result === target ? proxy : result;
          };
        },
      });
      return proxy as unknown as ReturnType<Db["from"]>;
    },
  };
}

/** Comme Supabase : au plus `maxRows` lignes par requête, SANS erreur ; et
 * l'enregistrement de chaque liste `.in()` envoyée, par table et par colonne. */
function likeSupabase(db: Db, maxRows = 1000) {
  const inLists: { table: string; column: string; ids: unknown[] }[] = [];
  const selects: { table: string; columns: string }[] = [];
  const wrapped: Db = {
    ...db,
    from: (table: string) => {
      const chain = db.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
      const clamp = (answer: { data: unknown }) => (Array.isArray(answer.data) ? { ...answer, data: answer.data.slice(0, maxRows) } : answer);
      const proxy: Record<string, unknown> = new Proxy(chain, {
        get(target, property) {
          const value = target[property as string];
          if (typeof value !== "function") return value;
          if (property === "then") return (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => value.call(target, (answer: { data: unknown }) => resolve(clamp(answer)), reject);
          if (property === "range") return (...args: unknown[]) => (value.apply(target, args) as Promise<{ data: unknown }>).then(clamp);
          return (...args: unknown[]) => {
            if (property === "in") inLists.push({ table, column: String(args[0]), ids: args[1] as unknown[] });
            if (property === "select") selects.push({ table, columns: String(args[0] ?? "*") });
            const result = value.apply(target, args);
            return result === target ? proxy : result;
          };
        },
      });
      return proxy as unknown as ReturnType<Db["from"]>;
    },
  };
  return { db: wrapped, inLists, selects };
}

let app: FastifyInstance | null = null;
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

async function forYouApp(db: unknown): Promise<FastifyInstance> {
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
  await app.register(forYouRoutes);
  await app.register(postsRoutes);
  await app.register(usersRoutes);
  await app.register(meRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    put: (url: string, payload: unknown) => target.inject({ method: "PUT", url, headers, payload: payload as object }),
  };
}

async function forYou(target: FastifyInstance, viewer: string, offset?: number): Promise<ForYouPage> {
  const response = await as(target, viewer).get(`/api/feed/for-you${offset === undefined ? "" : `?offset=${offset}`}`);
  expect(response.statusCode, `${viewer} lit « Pour vous » (${response.body})`).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return response.json();
}
const ids = (page: ForYouPage) => page.posts.map((value) => value.id);
async function suggestions(target: FastifyInstance, viewer: string): Promise<string[]> {
  const response = await as(target, viewer).get("/api/users/suggestions");
  expect(response.statusCode, `${viewer} lit les suggestions (${response.body})`).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return (response.json() as SuggestionsResponse).members.map((member) => member.id);
}
async function me(target: FastifyInstance, user: string): Promise<Profile> {
  const response = await as(target, user).get("/api/me");
  expect(response.statusCode).toBe(200);
  return response.json();
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetPrivateAccountsProbe();
  resetCollectionsProbe();
  resetCommentThreadsProbe();
  resetPostExtrasProbe();
  resetSavedPostsProbe();
  resetProfileModerationProbe();
  resetProfileExtrasProbe();
  resetDiscoveryProbe();
  resetForYouCache();
});

async function closeApp(): Promise<void> {
  await app?.close();
  app = null;
}

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await closeApp();
});

// ---------------------------------------------------------------------------

describe("le score : la date et le nombre de j'aime et de commentaires, rien d'autre", () => {
  it("plus récente passe devant à engagement égal ; plus aimée ou commentée passe devant à âge égal ; un commentaire vaut deux j'aime", () => {
    expect(forYouScore(0, 0, 1)).toBeGreaterThan(forYouScore(0, 0, 2));
    expect(forYouScore(5, 0, 10)).toBeGreaterThan(forYouScore(4, 0, 10));
    expect(forYouScore(0, 1, 10)).toBeGreaterThan(forYouScore(1, 0, 10));
    expect(forYouScore(0, 1, 10)).toBeCloseTo(forYouScore(2, 0, 10), 12);
    // La formule de la fiche : (1 + j'aime + 2 × commentaires) / (âge + 2)^1,2.
    expect(forYouScore(3, 2, 6)).toBeCloseTo(8 / Math.pow(8, 1.2), 12);
    // Une date à venir (horloges décalées) compte comme « maintenant », jamais plus.
    expect(forYouScore(0, 0, -5)).toBe(forYouScore(0, 0, 0));
    // Une publication très aimée finit par céder la place aux plus récentes.
    expect(forYouScore(50, 0, 13 * 24)).toBeLessThan(forYouScore(0, 0, 1));
  });

  it("à score égal : la plus récente, puis l'identifiant (un ordre total, le même à chaque construction)", () => {
    const at = (id: string, createdAt: string, score = 1): RankedPost => ({ id, authorId: id, createdAt, score });
    const list = [at("a", "2026-11-01"), at("c", "2026-11-02"), at("b", "2026-11-02"), at("d", "2026-11-01", 2)];
    expect([...list].sort(compareRanked).map((post) => post.id)).toEqual(["d", "c", "b", "a"]);
    expect([...list].reverse().sort(compareRanked).map((post) => post.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("la liste d'un membre : des exclusions seulement", () => {
  const audience = (extra: Partial<Audience> = {}): Audience => ({ self: false, blocked: false, suspended: false, isPrivate: false, follows: false, requested: false, ...extra });
  const ranked = (count: number, authors: number): RankedPost[] =>
    Array.from({ length: count }, (_, i) => ({ id: `p${i}`, authorId: `u${i % authors}`, createdAt: "2026-11-19", score: count - i }));

  it(`${FOR_YOU_PER_AUTHOR} publications par auteur au plus, ${FOR_YOU_MAX} en tout, dans l'ordre du classement`, () => {
    const set = ranked(300, 100);
    const audiences = new Map(set.map((post) => [post.authorId, audience()]));
    const list = personalize(set, audiences, new Set());
    expect(list).toHaveLength(FOR_YOU_MAX);
    expect(list.slice(0, 3)).toEqual(["p0", "p1", "p2"]);
    const perAuthor = new Map<string, number>();
    for (const id of list) {
      const author = set.find((post) => post.id === id)!.authorId;
      perAuthor.set(author, (perAuthor.get(author) ?? 0) + 1);
    }
    expect(Math.max(...perAuthor.values())).toBeLessThanOrEqual(FOR_YOU_PER_AUTHOR);
    // Un seul auteur : ses deux meilleures, pas une de plus.
    expect(personalize(ranked(5, 1), new Map([["u0", audience()]]), new Set())).toEqual(["p0", "p1"]);
  });

  it("soi-même, suivi, demandé, bloqué, suspendu, privé, inconnu ou signalé : jamais ; le reste, toujours", () => {
    const set = ranked(8, 8);
    const audiences = new Map<string, Audience>([
      ["u0", audience({ self: true })],
      ["u1", audience({ follows: true })],
      ["u2", audience({ requested: true })],
      ["u3", audience({ blocked: true })],
      ["u4", audience({ suspended: true })],
      ["u5", audience({ isPrivate: true })],
      ["u6", audience()],
      // u7 : lien illisible (absent de la carte) → jamais « visible » par défaut.
    ]);
    expect(personalize(set, audiences, new Set())).toEqual(["p6"]);
    expect(personalize(set, audiences, new Set(["p6"]))).toEqual([]);
  });

  it("une page : 15 publications, la suite à 15, 30, 45 ; rien après la fin", () => {
    const list = Array.from({ length: 40 }, (_, i) => i);
    expect(pageAt(list, 0)).toEqual({ items: list.slice(0, 15), nextOffset: 15 });
    expect(pageAt(list, 30)).toEqual({ items: list.slice(30, 40), nextOffset: null });
    expect(pageAt(list, 45)).toEqual({ items: [], nextOffset: null });
    expect(pageAt(list.slice(0, 15), 0)).toEqual({ items: list.slice(0, 15), nextOffset: null });
  });
});

describe("GET /api/feed/for-you : les règles de visibilité", () => {
  it("règles 1 à 6, 11 et 12 : seules les photos publiques, récentes, d'auteurs proposables, jamais signalées", async () => {
    const target = await forYouApp(seeded().db);
    const page = await forYou(target, VERA);
    const shown = ids(page);
    // Permis : Anna (ses deux meilleures) et Hugo.
    expect(shown).toEqual(expect.arrayContaining([A1, A2, H1]));
    for (const [id, why] of [
      [A3, "troisième publication d'Anna (2 par auteur)"],
      [A_FOL, "règle 1 : « abonnés », même avec 100 j'aime"],
      [A_PRIV, "règle 1 : privée"],
      [A_HID, "règle 1 : masquée"],
      [A_OLD, `plus de ${FOR_YOU_DAYS} jours`],
      [P1, "règle 2 : compte privé, même « publique »"],
      [B1, "règle 3 : Vera a bloqué Bob"],
      [C1, "règle 3 : Carl a bloqué Vera"],
      [S1, "règle 4 : compte suspendu"],
      [N1, "règle 4 : sans nom d'utilisateur"],
      [V1, "règle 5 : sa propre publication"],
      [F1, "règle 5 : compte suivi"],
      [G1, "règle 6 : signalée par Vera (même traitée)"],
      [D1, "règle 11 : réglage éteint"],
      [G2, "règle 12 : signalement en attente"],
      [H2, "règle 12 : image retirée"],
      [H3, "sans image"],
      [T1, "règle 12 : compte de moins de 24 heures"],
    ] as const) {
      expect(shown, why).not.toContain(id);
    }
    // H1 (trois j'aime, 6 h) passe devant A1 (1 h) puis A2 (2 h).
    expect(shown).toEqual([H1, A1, A2]);
    expect(page.nextOffset).toBeNull();
    // Règle 6, cas permis : un autre membre voit G1 (le signalement de Vera ne compte que pour elle).
    expect(ids(await forYou(target, UGO))).toContain(G1);
  });

  it("règle 5 : un compte à qui le membre a demandé à s'abonner n'apparaît pas ; redevenu public (demande effacée), il revient", async () => {
    const fake = seeded();
    // Paula redevient publique sans avoir répondu : la demande de Vera ne compte plus (lib/audience.ts) et Paula est proposée.
    const target = await forYouApp(fake.db);
    expect(ids(await forYou(target, VERA))).not.toContain(P1);
    fake.table("profiles").find((row) => row.id === PAULA)!.is_private = false;
    fake.table("follow_requests").length = 0;
    resetForYouCache();
    expect(ids(await forYou(target, VERA))).toContain(P1);
  });

  it("règle 2 : aucun compte privé avec 0045 et 0050 (sans 0050, le fil est caché : 404) ; sans 0045, tout le monde est public et le fil marche", async () => {
    const withBoth = await forYouApp(seeded().db);
    expect(ids(await forYou(withBoth, UGO))).not.toContain(P1);
    await closeApp();
    resetDiscoveryProbe();
    resetForYouCache();
    resetPrivateAccountsProbe();
    const target = await forYouApp(seeded({ without0045: true }).db);
    expect(ids(await forYou(target, UGO))).toContain(P1);
  });

  it("règle 3 : un blocage dans un sens ou dans l'autre retire tout l'auteur ; sans blocage, il revient", async () => {
    const target = await forYouApp(seeded().db);
    const vera = ids(await forYou(target, VERA));
    expect(vera).not.toContain(B1);
    expect(vera).not.toContain(C1);
    const ugo = ids(await forYou(target, UGO));
    expect(ugo).toEqual(expect.arrayContaining([B1, C1]));
  });

  it("règle 8 : deux comptes neufs, sans abonnement, ont exactement la même liste, dans le même ordre", async () => {
    const target = await forYouApp(seeded().db);
    const ugo = await forYou(target, UGO);
    const zoe = await forYou(target, ZOE);
    expect(ids(ugo).length).toBeGreaterThan(5);
    expect(ids(zoe)).toEqual(ids(ugo));
  });

  it("règle 10 : les nombres affichés sont ceux du membre (sans le j'aime d'un compte bloqué), pas ceux du classement", async () => {
    const target = await forYouApp(seeded().db);
    const forVera = (await forYou(target, VERA)).posts.find((value) => value.id === H1)!;
    const forUgo = (await forYou(target, UGO)).posts.find((value) => value.id === H1)!;
    expect(forUgo.reactionCount).toBe(3);
    expect(forVera.reactionCount).toBe(2);
    expect(forVera.viewerHasReacted).toBe(false);
  });

  it("règle 11 : le réglage éteint retire Dora de « Pour vous », pas du fil « Abonnements » de ses abonnés ni de son profil", async () => {
    const fake = seeded();
    fake.table("follows").push({ follower_id: ZOE, followee_id: DORA, created_at: ago(HOUR) });
    const target = await forYouApp(fake.db);
    expect(ids(await forYou(target, UGO))).not.toContain(D1);
    const feed = await as(target, ZOE).get("/api/feed");
    expect(feed.json().posts.map((value: { id: string }) => value.id)).toContain(D1);
    const profilePosts = await as(target, UGO).get(`/api/users/${DORA}/posts`);
    expect(profilePosts.json().posts.map((value: { id: string }) => value.id)).toContain(D1);
    // Cas permis : rallumé, Dora revient (une fois le classement refait).
    await as(target, DORA).put("/api/me/discoverable", { discoverable: true });
    resetForYouCache();
    expect(ids(await forYou(target, UGO))).toContain(D1);
  });

  it("deux pages sans doublon ; la suite s'arrête à la fin de la liste ; une page plus loin est vide", async () => {
    const fake = seeded();
    const authors = Array.from({ length: 12 }, (_, i) => `e${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`);
    for (const [i, author] of authors.entries()) {
      fake.table("profiles").push(profile(author, `extra${i}`));
      fake.table("posts").push(post(`e${String(i).padStart(7, "0")}-0000-4000-8000-000000000001`, author, "public", (7 + i) * HOUR), post(`e${String(i).padStart(7, "0")}-0000-4000-8000-000000000002`, author, "public", (8 + i) * HOUR));
    }
    const target = await forYouApp(fake.db);
    const first = await forYou(target, UGO);
    expect(first.posts).toHaveLength(FOR_YOU_PAGE_SIZE);
    expect(first.nextOffset).toBe(15);
    const second = await forYou(target, UGO, 15);
    expect(second.posts.length).toBeGreaterThan(0);
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(first.posts.length + second.posts.length);
    // Pour Ugo : 8 publications du jeu de départ (A1, A2, B1, C1, F1, G1, H1, V1), plus 24.
    expect(second.nextOffset).toBe(30);
    const third = await forYou(target, UGO, 30);
    expect(third.nextOffset).toBeNull();
    const all = [...ids(first), ...ids(second), ...ids(third)];
    expect(all).toHaveLength(32);
    expect(new Set(all).size).toBe(32);
    expect((await forYou(target, UGO, 45)).posts).toEqual([]);
    expect((await forYou(target, UGO, 45)).nextOffset).toBeNull();
  });
});

describe("règles 7 et 13 : le classement gardé en mémoire n'est jamais le dernier contrôle", () => {
  // [cause, changement, toutes les publications de l'auteur partent-elles ?]
  const causes: [string, (fake: Fake) => void, boolean][] = [
    ["masquée", (fake) => void (fake.table("posts").find((row) => row.id === A1)!.hidden_at = new Date().toISOString()), false],
    ["visibilité changée", (fake) => void (fake.table("posts").find((row) => row.id === A1)!.privacy = "followers"), false],
    ["image retirée", (fake) => void Object.assign(fake.table("posts").find((row) => row.id === A1)!, { media_url: null, media_removed_at: new Date().toISOString() }), false],
    [
      "signalée depuis",
      (fake) => void fake.table("reports").push({ id: randomUUID(), reporter_id: REPORTER, target_type: "post", target_id: A1, reason: "spam", note: null, handled_at: null, moderation_action_id: null, created_at: new Date().toISOString() }),
      false,
    ],
    ["auteur passé en privé", (fake) => void (fake.table("profiles").find((row) => row.id === ANNA)!.is_private = true), true],
    ["auteur suspendu", (fake) => void fake.table("suspensions").push({ user_id: ANNA, moderation_action_id: randomUUID() }), true],
    ["réglage éteint", (fake) => void (fake.table("profiles").find((row) => row.id === ANNA)!.discoverable = false), true],
    ["blocage", (fake) => void fake.table("blocks").push({ blocker_id: ANNA, blocked_id: UGO, created_at: new Date().toISOString() }), true],
    ["abonnement depuis", (fake) => void fake.table("follows").push({ follower_id: UGO, followee_id: ANNA, created_at: new Date().toISOString() }), true],
    ["publication supprimée (règle 13)", (fake) => void fake.tables.set("posts", fake.table("posts").filter((row) => row.id !== A1)), false],
    [
      "compte supprimé (règle 13)",
      (fake) => {
        fake.tables.set("posts", fake.table("posts").filter((row) => row.user_id !== ANNA));
        fake.tables.set("profiles", fake.table("profiles").filter((row) => row.id !== ANNA));
      },
      true,
    ],
  ];

  for (const [cause, change, wholeAuthor] of causes) {
    it(`${cause} : plus servie, alors que le classement n'a pas été refait`, async () => {
      const fake = seeded();
      const target = await forYouApp(fake.db);
      const before = await forYou(target, UGO);
      expect(ids(before)).toContain(A1);
      const builtAt = (await forYouSet(target)).builtAt;
      change(fake);
      // Une publication toute neuve et proposable : absente tant que le classement n'est pas refait.
      fake.table("posts").push(post("e9000000-0000-4000-8000-000000000001", GINA, "public", 60_000));
      const after = await forYou(target, UGO);
      expect(ids(after)).not.toContain(A1);
      expect(ids(after)).not.toContain("e9000000-0000-4000-8000-000000000001");
      expect((await forYouSet(target)).builtAt).toBe(builtAt);
      // Le reste de la page est toujours là, dans le même ordre (la page est
      // simplement plus courte : A3, troisième d'Anna, ne prend pas la place).
      expect(ids(after)).toEqual(ids(before).filter((id) => id !== A1 && !(wholeAuthor && id === A2)));
      expect(ids(after)).not.toContain(A3);
    });
  }

  it("expiré au bout de 5 minutes (horloge simulée) : refait une fois, avec les nouveautés ; une seule construction à la fois", async () => {
    const fake = seeded();
    const { db, selects } = likeSupabase(fake.db);
    const target = await forYouApp(db);
    const builds = () => selects.filter((call) => call.table === "posts" && call.columns === "id, user_id, created_at").length;
    const t0 = Date.now();
    const [first, again] = await Promise.all([forYouSet(target, () => t0), forYouSet(target, () => t0)]);
    expect(again).toBe(first);
    expect(builds()).toBe(1);
    fake.table("posts").push(post("e9000000-0000-4000-8000-000000000002", GINA, "public", 60_000));
    const almost = await forYouSet(target, () => t0 + FOR_YOU_CACHE_MS - 1);
    expect(almost).toBe(first);
    expect(builds()).toBe(1);
    const rebuilt = await forYouSet(target, () => t0 + FOR_YOU_CACHE_MS);
    expect(builds()).toBe(2);
    expect(rebuilt.posts.map((value) => value.id)).toContain("e9000000-0000-4000-8000-000000000002");
    expect(first.posts.map((value) => value.id)).not.toContain("e9000000-0000-4000-8000-000000000002");
  });

  it("le classement ne garde rien de personnel : identifiant, auteur, date, score", async () => {
    const target = await forYouApp(seeded().db);
    const set = await forYouSet(target);
    expect(set.posts.length).toBeGreaterThan(0);
    for (const value of set.posts) expect(Object.keys(value).sort()).toEqual(["authorId", "createdAt", "id", "score"]);
  });
});

describe("des nombres justes, quelle que soit la taille", () => {
  it("plus de 1 000 j'aime sur une publication : tous comptés (readAll), jamais une liste .in() de plus de 100", async () => {
    const fake = seeded();
    for (let i = 0; i < 1600; i++) fake.table("post_reactions").push({ post_id: A2, user_id: randomUUID(), created_at: ago(HOUR) });
    for (let i = 0; i < 1100; i++) fake.table("post_reactions").push({ post_id: A1, user_id: randomUUID(), created_at: ago(HOUR) });
    // 150 publications de plus, pour que les listes d'identifiants dépassent 100.
    for (let i = 0; i < 150; i++) {
      const author = `e${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`;
      fake.table("profiles").push(profile(author, `extra${i}`));
      fake.table("posts").push(post(`e${String(i).padStart(7, "0")}-0000-4000-8000-000000000001`, author, "public", (10 + i) * HOUR));
    }
    const { db, inLists } = likeSupabase(fake.db, 1000);
    const target = await forYouApp(db);
    const set = await forYouSet(target);
    const a1 = set.posts.find((value) => value.id === A1)!;
    const a2 = set.posts.find((value) => value.id === A2)!;
    const age = (createdAt: string) => (set.builtAt - Date.parse(createdAt)) / HOUR;
    expect(a2.score).toBeCloseTo(forYouScore(1600, 0, age(a2.createdAt)), 9);
    expect(a1.score).toBeCloseTo(forYouScore(1100, 0, age(a1.createdAt)), 9);
    // A2, plus vieille d'une heure mais bien plus aimée, passe devant A1.
    expect(set.posts.indexOf(a2)).toBeLessThan(set.posts.indexOf(a1));
    expect(set.posts.length).toBeLessThanOrEqual(FOR_YOU_CANDIDATES);
    expect(inLists.length).toBeGreaterThan(0);
    for (const call of inLists) expect(call.ids.length, `${call.table}.${call.column}`).toBeLessThanOrEqual(100);
    expect(inLists.some((call) => call.table === "post_reactions" && call.ids.length === 100)).toBe(true);
  });

  it("une lecture impossible (j'aime, signalements, suspensions, blocages) : une erreur, jamais une liste faite comme si de rien n'était", async () => {
    for (const [table, why] of [
      ["post_reactions", "j'aime"],
      ["reports", "signalements"],
      ["suspensions", "suspensions"],
      ["blocks", "blocages"],
    ] as const) {
      resetForYouCache();
      const target = await forYouApp(failing(seeded().db, (name) => name === table));
      const response = await as(target, VERA).get("/api/feed/for-you");
      expect(response.statusCode, why).toBe(500);
      await closeApp();
    }
  });
});

describe("le paramètre `offset`", () => {
  it("0, 15, 30, 45 ou rien : accepté ; tout le reste : 400 « invalid_query »", async () => {
    const target = await forYouApp(seeded().db);
    for (const query of ["", "?offset=0", "?offset=15", "?offset=30", "?offset=45"]) {
      expect((await as(target, UGO).get(`/api/feed/for-you${query}`)).statusCode, query).toBe(200);
    }
    for (const query of ["?offset=", "?offset=1", "?offset=14", "?offset=60", "?offset=-15", "?offset=015", "?offset=15.0", "?offset=abc", "?offset=0&offset=15", "?offset=1e1"]) {
      const response = await as(target, UGO).get(`/api/feed/for-you${query}`);
      expect(response.statusCode, query).toBe(400);
      expect(response.json(), query).toEqual({ error: "invalid_query", message: "Paramètre de liste invalide." });
    }
  });

  it("sans compte : 401 ; la route déclare la limite « forYou » (120 par heure), les suggestions « memberList »", async () => {
    const target = await forYouApp(seeded().db);
    expect((await target.inject({ method: "GET", url: "/api/feed/for-you" })).statusCode).toBe(401);
    expect((await target.inject({ method: "GET", url: "/api/users/suggestions" })).statusCode).toBe(401);
    expect(limitNames.get("GET /api/feed/for-you")).toBe("forYou");
    expect(limitNames.get("GET /api/users/suggestions")).toBe("memberList");
    expect(RATE_LIMITS.forYou).toMatchObject({ max: 120, windowMs: 3_600_000, error: "for_you_limit" });
    expect(localizeMessage(RATE_LIMITS.forYou.message, 429, "en")).toBe("Too many “For you” pages in a short time. Please try again in a moment.");
  });
});

describe("le réglage « Proposer mon compte aux autres membres »", () => {
  it("dans le profil (vrai au départ) ; PUT 204, permis à un compte suspendu ; un corps invalide : 400", async () => {
    const fake = seeded();
    const target = await forYouApp(fake.db);
    expect((await me(target, VERA)).discoverable).toBe(true);
    expect((await me(target, DORA)).discoverable).toBe(false);
    const off = await as(target, VERA).put("/api/me/discoverable", { discoverable: false });
    expect(off.statusCode).toBe(204);
    expect(fake.table("profiles").find((row) => row.id === VERA)!.discoverable).toBe(false);
    expect((await me(target, VERA)).discoverable).toBe(false);
    // Un réglage de confidentialité : Sam, suspendu, peut l'éteindre.
    expect((await as(target, SAM).put("/api/me/discoverable", { discoverable: false })).statusCode).toBe(204);
    for (const body of [{}, { discoverable: "non" }, { discoverable: null }]) {
      expect((await as(target, VERA).put("/api/me/discoverable", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("sans 0050 : « Pour vous » et les suggestions répondent 404 sans rien lire des publications (personne n'est proposé sans pouvoir refuser), le profil n'a pas le réglage et sa route répond 404", async () => {
    const fake = seeded({ without0050: true });
    const { db, selects } = likeSupabase(fake.db);
    const target = await forYouApp(db);
    expect(await discoveryReady(target)).toBe(false);
    const unavailable = { error: DISCOVERY_SETTING_UNAVAILABLE_ERROR, message: "Le réglage « Proposer mon compte aux autres membres » n'est pas encore disponible." };
    for (const url of ["/api/feed/for-you", "/api/users/suggestions"]) {
      const hidden = await as(target, UGO).get(url);
      expect(hidden.statusCode, url).toBe(404);
      expect(hidden.headers["cache-control"], url).toBe("no-store");
      expect(hidden.json(), url).toEqual(unavailable);
    }
    expect(selects.filter((call) => call.table === "posts" || call.table === "follows")).toEqual([]);
    // Par précaution, le classement lui-même ne propose personne sans 0050 (réglage lu « éteint »).
    expect((await forYouSet(target)).posts).toEqual([]);
    expect("discoverable" in (await me(target, VERA))).toBe(false);
    const response = await as(target, VERA).put("/api/me/discoverable", { discoverable: false });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: DISCOVERY_SETTING_UNAVAILABLE_ERROR, message: "Le réglage « Proposer mon compte aux autres membres » n'est pas encore disponible." });
    expect(localizeMessage(response.json().message, 404, "en")).toBe("The setting “Suggest my account to other members” isn't available yet.");
  });

  it("base illisible pour la sonde : jamais « tout le monde est proposé » (500) ; le profil reste lisible, sans le réglage", async () => {
    const fake = seeded();
    const broken = failing(fake.db, (table, method, args) => table === "profiles" && method === "select" && String(args[0]).includes("discoverable"));
    const target = await forYouApp(broken);
    expect((await as(target, UGO).get("/api/feed/for-you")).statusCode).toBe(500);
    expect((await as(target, UGO).get("/api/users/suggestions")).statusCode).toBe(500);
    expect("discoverable" in (await me(target, VERA))).toBe(false);
  });
});

describe("GET /api/users/suggestions", () => {
  /** Vera suit Fred et Gina ; Fred et Gina suivent Kim ; Fred suit Lou ; un inconnu suit Max. */
  const KIM = "a2000000-0000-4000-8000-000000000001";
  const LOU = "a2000000-0000-4000-8000-000000000002";
  const MAX = "a2000000-0000-4000-8000-000000000003";
  function social(seed: Seed = {}) {
    const fake = seeded(seed);
    fake.table("profiles").push(profile(KIM, "kim"), profile(LOU, "lou"), profile(MAX, "max"));
    fake.table("follows").push(
      { follower_id: VERA, followee_id: GINA, created_at: ago(9 * DAY) },
      { follower_id: FRED, followee_id: KIM, created_at: ago(DAY) },
      { follower_id: GINA, followee_id: KIM, created_at: ago(DAY) },
      { follower_id: FRED, followee_id: LOU, created_at: ago(DAY) },
      { follower_id: ZOE, followee_id: MAX, created_at: ago(DAY) },
      // Fred suit aussi des comptes qu'il ne faut jamais suggérer à Vera.
      ...[BOB, CARL, SAM, NINA, PAULA, DORA, VERA].map((followee) => ({ follower_id: FRED, followee_id: followee, created_at: ago(DAY) }))
    );
    return fake;
  }

  it("d'abord les comptes suivis par ses abonnements (le plus suivi d'abord), puis les plus actifs du classement ; 10 au plus", async () => {
    const target = await forYouApp(social().db);
    const list = await suggestions(target, VERA);
    expect(list.slice(0, 2)).toEqual([KIM, LOU]);
    expect(list).toEqual(expect.arrayContaining([ANNA, HUGO]));
    expect(list.length).toBeLessThanOrEqual(SUGGESTIONS_MAX);
    // Max n'est suivi que par un inconnu de Vera : pas par ce chemin, et il n'a rien publié.
    expect(list).not.toContain(MAX);
  });

  it("jamais : soi-même, suivi, demandé, bloqué (dans un sens ou dans l'autre), suspendu, sans nom, privé, réglage éteint (règles 3, 4, 5, 11)", async () => {
    const target = await forYouApp(social().db);
    const list = await suggestions(target, VERA);
    for (const [id, why] of [
      [VERA, "soi-même"],
      [FRED, "suivi"],
      [GINA, "suivie"],
      [PAULA, "demandée, et privée"],
      [BOB, "bloqué par Vera"],
      [CARL, "a bloqué Vera"],
      [SAM, "suspendu"],
      [NINA, "sans nom d'utilisateur"],
      [DORA, "réglage éteint"],
    ] as const) {
      expect(list, why).not.toContain(id);
    }
    // Cas permis : Ugo, qui ne suit personne et n'a bloqué personne, se voit suggérer Bob et Carl.
    expect(await suggestions(target, UGO)).toEqual(expect.arrayContaining([BOB, CARL]));
  });

  it("règle 9 : seules les listes d'abonnements des comptes que Vera suit sont lues, 2 000 lignes au plus", async () => {
    const fake = social();
    // 700 abonnements pour Vera : seuls les 500 plus récents comptent.
    for (let i = 0; i < 700; i++) {
      const id = `f${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`;
      fake.table("follows").push({ follower_id: VERA, followee_id: id, created_at: ago((1000 + i) * 60_000) });
    }
    const { db, inLists } = likeSupabase(fake.db);
    const limits: number[] = [];
    const counting: Db = {
      ...db,
      from: (table: string) => {
        const chain = db.from(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
        if (table !== "follows") return chain as unknown as ReturnType<Db["from"]>;
        const proxy: Record<string, unknown> = new Proxy(chain, {
          get(target, property) {
            const value = target[property as string];
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              if (property === "limit") limits.push(Number(args[0]));
              const result = value.apply(target, args);
              return result === target ? proxy : result;
            };
          },
        });
        return proxy as unknown as ReturnType<Db["from"]>;
      },
    };
    const target = await forYouApp(counting);
    await suggestions(target, VERA);
    const veraFollows = new Set(fake.table("follows").filter((row) => row.follower_id === VERA).map((row) => row.followee_id));
    const secondDegree = inLists.filter((call) => call.table === "follows" && call.column === "follower_id");
    expect(secondDegree.length).toBe(5);
    for (const call of secondDegree) for (const id of call.ids) expect(veraFollows.has(id), String(id)).toBe(true);
    expect(new Set(secondDegree.flatMap((call) => call.ids)).size).toBe(500);
    // Lignes demandées : 500 abonnements, puis 5 paquets de 400 (2 000 en tout).
    expect(limits[0]).toBe(500);
    expect(limits.slice(1).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(SUGGESTION_SECOND_ROWS_MAX);
  });

  it("sans 0045 : la route marche, sans demande d'abonnement", async () => {
    const target = await forYouApp(social({ without0045: true }).db);
    const list = await suggestions(target, VERA);
    // Sans 0045, Paula est un compte public comme les autres.
    expect(list.slice(0, 3)).toEqual([KIM, PAULA, LOU]);
    expect(list).not.toContain(FRED);
  });
});
