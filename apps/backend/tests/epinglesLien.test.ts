import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BIO_LINK_MAX_LENGTH,
  LINK_INVALID_ERROR,
  LINK_TOO_LONG_ERROR,
  PINNED_POSTS_MAX,
  PINS_UNAVAILABLE_ERROR,
  PIN_LIMIT_ERROR,
  PIN_NOT_ALLOWED_ERROR,
  PROFILE_LINK_LIMIT_ERROR,
  PROFILE_LINK_UNAVAILABLE_ERROR,
  REPORT_REASONS,
  checkBioLink,
  type ModerationItem,
  type ModerationPage,
  type Post,
  type PostType,
  type PrivacyLevel,
  type Profile,
  type UserPostsPage,
  type UserProfile,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import postsRoutes from "../src/routes/posts.js";
import usersRoutes from "../src/routes/users.js";
import meRoutes from "../src/routes/me.js";
import followsRoutes from "../src/routes/follows.js";
import blocksRoutes from "../src/routes/blocks.js";
import moderationRoutes from "../src/routes/moderation.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { resetCollectionsProbe } from "../src/lib/collections.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { resetPostExtrasProbe } from "../src/lib/postExtras.js";
import { resetSavedPostsProbe } from "../src/lib/savedPosts.js";
import { resetProfileModerationProbe, withoutSuspendedFaces } from "../src/lib/profileModeration.js";
import { profileExtrasReady, resetProfileExtrasProbe } from "../src/lib/profileExtras.js";
import { LINK_INVALID, LINK_TOO_LONG, bioLinkProblem, bioLinkTexts } from "../src/lib/bioLink.js";
import { localizeMessage } from "../src/lib/messages.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Épingles et lien en bio (lot « vie sociale », migration 0049), SANS base ni
// réseau : les vraies routes sur une fausse base en mémoire
// (tests/fakeSupabase.ts). Chaque règle de la fiche a son cas « refusé » ET
// son cas « permis ». Le même parcours sur la vraie base de développement :
// epinglesLienBase.test.ts (Mac, 0049 appliquée).

// Anna a un compte public et un lien. Bruno la suit, et suit Paula (compte
// PRIVÉ, avec un lien). Carl est un inconnu. Dora a demandé à suivre Paula
// (en attente). Sam est suspendu (bio et lien). Eve a bloqué Anna.
const ANNA = "a0000000-0000-4000-8000-000000000001";
const BRUNO = "b0000000-0000-4000-8000-000000000002";
const CARL = "c0000000-0000-4000-8000-000000000003";
const DORA = "d0000000-0000-4000-8000-000000000004";
const EVE = "e0000000-0000-4000-8000-000000000005";
const SAM = "50000000-0000-4000-8000-000000000006";
const PAULA = "70000000-0000-4000-8000-000000000007";
const ADMIN = "ad000000-0000-4000-8000-000000000008";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const ANNA_LINK = "https://anna-boutique.fr/collection";
const PAULA_LINK = "https://paula.example.org/";
const SAM_LINK = "https://sam.example.net/";

// Publications d'Anna : quatre photos épinglables, un achat, une envie.
const A_PUB = "a1000000-0000-4000-8000-000000000001";
const A_FOL = "a1000000-0000-4000-8000-000000000002";
const A_PRIV = "a1000000-0000-4000-8000-000000000003";
const A_HID = "a1000000-0000-4000-8000-000000000004";
const A_NEW = "a1000000-0000-4000-8000-000000000005";
const A_OTHER = "a1000000-0000-4000-8000-000000000006";
const A_BUY = "a1000000-0000-4000-8000-000000000007";
const A_WISH = "a1000000-0000-4000-8000-000000000008";
const P_PUB = "71000000-0000-4000-8000-000000000001";

const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." };
const PINS_UNAVAILABLE = { error: PINS_UNAVAILABLE_ERROR, message: "Les publications épinglées ne sont pas encore disponibles." };
const LINK_UNAVAILABLE = { error: PROFILE_LINK_UNAVAILABLE_ERROR, message: "Le lien du profil n'est pas encore disponible." };
const PIN_NOT_ALLOWED = { error: PIN_NOT_ALLOWED_ERROR, message: "Seules vos photos peuvent être épinglées." };
const PIN_LIMIT = { error: PIN_LIMIT_ERROR, message: "Vous pouvez épingler 3 publications au plus. Retirez-en une d'abord." };

/** Base sans la migration 0049 : ni posts.pinned_at, ni profiles.link_url. */
const WITHOUT_0049: FakeDbOptions = { missingColumns: { posts: ["pinned_at"], profiles: ["link_url"] } };

const stored = (user: string, name: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/${name}`;

function profile(id: string, username: string, extra: Row = {}): Row {
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
    is_private: false,
    mentions_from: "following",
    link_url: null,
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
    ...extra,
  };
}

function post(id: string, userId: string, privacy: PrivacyLevel, extra: { type?: PostType; hidden?: boolean; pinnedAt?: string | null; createdAt?: string } = {}): Row {
  return {
    id,
    user_id: userId,
    type: extra.type ?? "lifestyle",
    vault_item_id: null,
    wishlist_item_id: null,
    caption: `Légende ${id.slice(-1)}`,
    media_url: stored(userId, `${id}.jpg`),
    media_thumb_url: stored(userId, `${id}-mini.jpg`),
    media_removed_at: null,
    privacy,
    hidden_at: extra.hidden ? "2026-11-12T00:00:00+00:00" : null,
    pinned_at: extra.pinnedAt ?? null,
    created_at: extra.createdAt ?? "2026-11-10T00:00:00+00:00",
  };
}

interface Seed {
  /** Publication → date de l'épingle. */
  pinned?: Record<string, string>;
  /** [membre, publication] signalées. */
  reported?: [string, string][];
}

type Fake = ReturnType<typeof fakeSupabase>;
type Db = Fake["db"];

let tick = 0;
function stamp(): string {
  tick += 1;
  return new Date(Date.now() + tick * 1000).toISOString();
}

/** La file de modération et la fonction de 0037 (retirer une bio ou une
 * photo de profil), imitées au plus près du SQL (comme moderationProfil.test.ts). */
function moderationRpc(getFake: () => Fake) {
  const t = (name: string) => getFake().table(name);
  const refuse = (outcome: string) => ({ data: [{ outcome, action_id: null }], error: null });
  return async (fn: string, args: Record<string, unknown>) => {
    if (fn === "moderation_queue") {
      const handled = args.p_handled === true;
      const groups = new Map<string, Row[]>();
      for (const report of t("reports")) {
        if ((report.handled_at !== null) !== handled) continue;
        const key = `${report.target_type}:${report.target_id}`;
        groups.set(key, [...(groups.get(key) ?? []), report]);
      }
      const rows = [...groups.values()].map((reports) => {
        const dates = reports.map((r) => String(r.created_at)).sort();
        return { target_type: reports[0]!.target_type, target_id: reports[0]!.target_id, report_count: reports.length, reasons: { inappropriate: reports.length }, notes: [], first_at: dates[0], last_at: dates.at(-1) };
      });
      return { data: rows, error: null };
    }
    if (fn === "moderation_remove_profile_part") {
      const { p_admin_id: admin, p_user_id: user, p_part: part, p_reason: reason } = args;
      if (admin === null || !t("admins").some((row) => row.user_id === admin)) return refuse("not_admin");
      if (!["bio", "avatar"].includes(String(part)) || !(REPORT_REASONS as readonly string[]).includes(String(reason))) return refuse("invalid");
      const row = t("profiles").find((p) => p.id === user);
      if (!row) return refuse("target_not_found");
      const bio = typeof row.bio === "string" ? row.bio.trim() : "";
      if ((part === "bio" && bio === "") || (part === "avatar" && (row.avatar_url ?? null) === null)) return refuse("nothing_to_remove");
      const actionId = randomUUID();
      t("moderation_actions").push({ id: actionId, admin_id: admin, action: part === "bio" ? "remove_bio" : "remove_avatar", target_type: "user", target_id: user, target_user_id: user, reason, note: null, undoes_action_id: null, automatic: false, created_at: stamp() });
      if (part === "bio") row.bio = null;
      else row.avatar_url = null;
      for (const report of t("reports")) if (report.target_type === "user" && report.target_id === user && report.handled_at === null) Object.assign(report, { handled_at: stamp(), moderation_action_id: actionId });
      return { data: [{ outcome: "ok", action_id: actionId }], error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "absente" } };
  };
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  let fake: Fake | null = null;
  fake = fakeSupabase({ rpc: moderationRpc(() => fake!), ...options });
  const without = options.missingColumns?.profiles?.includes("link_url") === true;
  const people = [
    profile(ANNA, "anna", { bio: "Mode et voyages", link_url: ANNA_LINK }),
    profile(BRUNO, "bruno"),
    profile(CARL, "carl"),
    profile(DORA, "dora"),
    profile(EVE, "eve"),
    profile(SAM, "sam", { bio: "Bio de Sam", link_url: SAM_LINK }),
    profile(PAULA, "paula", { is_private: true, link_url: PAULA_LINK }),
    profile(ADMIN, "admin"),
  ];
  for (const row of people) if (without) delete row.link_url;
  fake.table("profiles").push(...people);
  const pins = seed.pinned ?? {};
  const posts = [
    post(A_PUB, ANNA, "public", { createdAt: "2026-11-01T00:00:00+00:00" }),
    post(A_FOL, ANNA, "followers", { createdAt: "2026-11-02T00:00:00+00:00" }),
    post(A_PRIV, ANNA, "private", { createdAt: "2026-11-03T00:00:00+00:00" }),
    post(A_HID, ANNA, "public", { hidden: true, createdAt: "2026-11-04T00:00:00+00:00" }),
    post(A_NEW, ANNA, "public", { createdAt: "2026-11-05T00:00:00+00:00" }),
    post(A_OTHER, ANNA, "public", { createdAt: "2026-11-06T00:00:00+00:00" }),
    post(A_BUY, ANNA, "public", { type: "purchase", createdAt: "2026-11-07T00:00:00+00:00" }),
    post(A_WISH, ANNA, "public", { type: "wish", createdAt: "2026-11-08T00:00:00+00:00" }),
    post(P_PUB, PAULA, "public", { createdAt: "2026-11-09T00:00:00+00:00" }),
  ];
  for (const row of posts) {
    if (without) delete row.pinned_at;
    else if (pins[String(row.id)]) row.pinned_at = pins[String(row.id)];
  }
  fake.table("posts").push(...posts);
  for (const [follower, followee] of [
    [BRUNO, ANNA],
    [BRUNO, PAULA],
  ])
    fake.table("follows").push({ follower_id: follower, followee_id: followee, created_at: "2026-10-01T00:00:00+00:00" });
  fake.table("follow_requests").push({ requester_id: DORA, target_id: PAULA, created_at: "2026-10-02T00:00:00+00:00" });
  fake.table("blocks").push({ blocker_id: EVE, blocked_id: ANNA, created_at: "2026-10-01T00:00:00+00:00" });
  fake.table("suspensions").push({ user_id: SAM, moderation_action_id: randomUUID() });
  fake.table("admins").push({ user_id: ADMIN });
  for (const [reporter, target] of seed.reported ?? []) {
    fake.table("reports").push({ id: randomUUID(), reporter_id: reporter, target_type: "post", target_id: target, reason: "spam", note: null, handled_at: null, moderation_action_id: null, created_at: stamp() });
  }
  return fake;
}

/** Fait échouer (délai dépassé) les requêtes que `matches` désigne, tant que `broken()` le dit. */
function failing(db: Db, matches: (table: string, method: string, args: unknown[]) => boolean, broken: () => boolean = () => true): Db {
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
          if (property === "then") {
            return (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => (failed ? Promise.resolve(failure).then(resolve, reject) : value.call(target, resolve, reject));
          }
          if (property === "single" || property === "maybeSingle") return () => (failed ? Promise.resolve(failure) : value.call(target));
          return (...args: unknown[]) => {
            if (broken() && matches(table, String(property), args)) failed = true;
            const result = value.apply(target, args);
            return result === target ? proxy : result;
          };
        },
      });
      return proxy as unknown as ReturnType<Db["from"]>;
    },
  };
}

let app: FastifyInstance | null = null;
let lines: string[] = [];
/** Ce que chaque route déclare (méthode + adresse → nom de sa limite). */
let limitNames = new Map<string, string | undefined>();

async function pinsApp(db: unknown): Promise<FastifyInstance> {
  lines = [];
  app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) } } });
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
  await app.register(meRoutes);
  await app.register(followsRoutes);
  await app.register(blocksRoutes);
  await app.register(moderationRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    pin: (postId: string, payload: unknown) => target.inject({ method: "PUT", url: `/api/posts/${postId}/pin`, headers, payload: payload as object }),
    patchMe: (payload: object) => target.inject({ method: "PATCH", url: "/api/me", headers, payload }),
  };
}

/** Ce que l'app d'Anna envoie en enregistrant son profil (le lien en plus, s'il est donné). */
const annaForm = (extra: Record<string, unknown> = {}) => ({ username: "anna", displayName: "Anna", bio: "Mode et voyages", ...extra });
const row = (fake: Fake, table: string, id: string) => fake.table(table).find((value) => value.id === id)!;
const ids = (posts: readonly Post[] | undefined) => (posts ?? []).map((value) => value.id);

async function userPosts(target: FastifyInstance, viewer: string, owner: string, query = ""): Promise<UserPostsPage> {
  const response = await as(target, viewer).get(`/api/users/${owner}/posts${query}`);
  expect(response.statusCode, `${viewer} lit les publications de ${owner}`).toBe(200);
  return response.json();
}
async function userProfile(target: FastifyInstance, viewer: string, owner: string): Promise<UserProfile> {
  const response = await as(target, viewer).get(`/api/users/${owner}`);
  expect(response.statusCode, `${viewer} lit le profil de ${owner}`).toBe(200);
  return response.json();
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
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

// ---------------------------------------------------------------------------

describe("sans la migration 0049 : rien ne change", () => {
  it("épingler répond « indisponible » ; un PATCH qui porte un lien est refusé en entier (rien du profil n'est enregistré)", async () => {
    const fake = seeded({}, WITHOUT_0049);
    const target = await pinsApp(fake.db);
    for (const pinned of [true, false]) {
      const response = await as(target, ANNA).pin(A_PUB, { pinned });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(PINS_UNAVAILABLE);
    }
    const refused = await as(target, ANNA).patchMe(annaForm({ bio: "Nouvelle bio", linkUrl: "https://exemple.com" }));
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toEqual(LINK_UNAVAILABLE);
    expect(row(fake, "profiles", ANNA)).toMatchObject({ bio: "Mode et voyages" });
    expect(row(fake, "profiles", ANNA)).not.toHaveProperty("link_url");
    // Même un lien vide (« retirer ») : l'app ne croit jamais un lien enregistré.
    expect((await as(target, ANNA).patchMe(annaForm({ linkUrl: null }))).statusCode).toBe(404);
  });

  it("aucun champ nouveau : ni `linkUrl`, ni `pinnedAt`, ni `pinned` ; un PATCH sans lien marche comme avant", async () => {
    const target = await pinsApp(seeded({}, WITHOUT_0049).db);
    expect(await me(target, ANNA)).not.toHaveProperty("linkUrl");
    expect(await userProfile(target, BRUNO, ANNA)).not.toHaveProperty("linkUrl");
    const page = await userPosts(target, BRUNO, ANNA);
    expect(page).not.toHaveProperty("pinned");
    expect(page.posts.length).toBeGreaterThan(0);
    const mine: Post[] = (await as(target, ANNA).get("/api/posts/mine")).json();
    expect(mine.length).toBeGreaterThan(0);
    for (const value of [...mine, ...page.posts]) expect(value).not.toHaveProperty("pinnedAt");
    const saved = await as(target, ANNA).patchMe(annaForm({ bio: "Nouvelle bio" }));
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).not.toHaveProperty("linkUrl");
    expect(await profileExtrasReady(target)).toBe(false);
  });

  it("la sonde : absente, un seul essai puis rien pendant 5 minutes ; présente, mémorisée", async () => {
    let probes = 0;
    const counted = seeded({}, WITHOUT_0049);
    const db = counted.db;
    const watched: Db = { ...db, from: (name: string) => {
      const chain = db.from(name);
      const select = chain.select.bind(chain);
      return Object.assign(chain, { select: (columns?: string, options?: { count?: "exact"; head?: boolean }) => {
        if (columns === "id, pinned_at") probes += 1;
        return select(columns, options);
      } });
    } };
    const target = await pinsApp(watched);
    let now = 1_000_000;
    expect(await profileExtrasReady(target, () => now)).toBe(false);
    expect(await profileExtrasReady(target, () => now + 4 * 60_000)).toBe(false);
    expect(probes).toBe(1);
    now += 5 * 60_000 + 1;
    expect(await profileExtrasReady(target, () => now)).toBe(false);
    expect(probes).toBe(2);
    resetProfileExtrasProbe();
    await target.close();
    const ready = await pinsApp(seeded().db);
    expect(await profileExtrasReady(ready)).toBe(true);
    expect(await profileExtrasReady(ready)).toBe(true);
  });

  it("sonde illisible (délai dépassé) : le profil se lit sans lien, épingler et enregistrer un lien répondent « erreur », jamais « disponible » par défaut", async () => {
    let broken = true;
    const fake = seeded();
    const probeColumns = (_table: string, method: string, args: unknown[]) => method === "select" && (args[0] === "id, pinned_at" || args[0] === "id, link_url");
    const target = await pinsApp(failing(fake.db, probeColumns, () => broken));
    expect(await me(target, ANNA)).not.toHaveProperty("linkUrl");
    expect(await userPosts(target, BRUNO, ANNA)).not.toHaveProperty("pinned");
    expect((await as(target, ANNA).pin(A_PUB, { pinned: true })).statusCode).toBe(500);
    expect((await as(target, ANNA).patchMe(annaForm({ bio: "Autre", linkUrl: "https://exemple.com" }))).statusCode).toBe(500);
    expect(row(fake, "profiles", ANNA)).toMatchObject({ bio: "Mode et voyages", link_url: ANNA_LINK });
    expect(row(fake, "posts", A_PUB).pinned_at).toBeNull();
    broken = false;
    expect((await me(target, ANNA)).linkUrl).toBe(ANNA_LINK);
    expect((await as(target, ANNA).pin(A_PUB, { pinned: true })).statusCode).toBe(200);
  });
});

describe("le lien : la règle (bioLinkProblem, la même que l'app)", () => {
  const accepted: [string | null, string | null][] = [
    ["https://exemple.com", "https://exemple.com/"],
    ["  HTTPS://Exemple.COM/Boutique?ref=1#haut  ", "https://exemple.com/Boutique?ref=1#haut"],
    ["https://exemple.com:443/a", "https://exemple.com/a"],
    ["https://boutique.exemple.co.uk/été", "https://boutique.exemple.co.uk/%C3%A9t%C3%A9"],
    [null, null],
    ["", null],
    ["   ", null],
    [`https://exemple.com/${"a".repeat(BIO_LINK_MAX_LENGTH - 20)}`, `https://exemple.com/${"a".repeat(BIO_LINK_MAX_LENGTH - 20)}`],
  ];
  const invalid = [
    "http://exemple.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "mailto:anna@exemple.com",
    "https://127.0.0.1/",
    "https://0x7f.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://nom:secret@exemple.com/",
    "https://@exemple.com/",
    "https://exemple.com@pirate.com/",
    "https://exemple.com:8443/",
    "https://exem ple.com",
    "https://exemple.com/a b",
    "https://exemple.com/a\u00a0b",
    "ht\ttps://exemple.com",
    "https:\t//exemple.com",
    "https://exemple.com/a\nb",
    "https://exemple.com/a\u2028b",
    "https://exämple.com",
    "https://xn--exmple-cua.com",
    "https://boutique.xn--exmple-cua.com",
    "https://ＥＸＥＭＰＬＥ.com",
    "https://localhost/",
    "https://admin.localhost/",
    "https://imprimante.local/",
    "https://exemple",
    "https://exemple.c0m",
    "//exemple.com",
    "https:exemple.com",
    "exemple.com",
  ];

  it("acceptés, et rangés tels que le parseur standard les lit", () => {
    for (const [input, url] of accepted) {
      expect(bioLinkProblem(input), String(input)).toEqual({ ok: true, url });
      if (input !== null) expect(checkBioLink(input), input).toEqual({ ok: true, url });
      // Toujours ce que la contrainte de la base accepte.
      if (url !== null) {
        expect(url.length).toBeLessThanOrEqual(200);
        expect(url).toMatch(/^https:\/\/[^\s]+$/);
      }
    }
  });

  it("refusés : pas https, adresse IP, nom de site internationalisé (sous ses deux formes), identifiants, port, espace, caractère de contrôle", () => {
    for (const input of invalid) {
      expect(bioLinkProblem(input), JSON.stringify(input)).toEqual({ ok: false, refusal: LINK_INVALID });
      expect(checkBioLink(input), JSON.stringify(input)).toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("201 caractères : trop long, avant comme après la mise en forme", () => {
    expect(bioLinkProblem(`https://exemple.com/${"a".repeat(BIO_LINK_MAX_LENGTH - 19)}`)).toEqual({ ok: false, refusal: LINK_TOO_LONG });
    // 30 « é » font 180 caractères une fois encodés : la limite vaut pour l'adresse rangée.
    expect(bioLinkProblem(`https://exemple.com/${"é".repeat(31)}`)).toEqual({ ok: false, refusal: LINK_TOO_LONG });
    expect(LINK_TOO_LONG).toEqual({ error: LINK_TOO_LONG_ERROR, message: "Le lien est trop long (200 caractères maximum)." });
    expect(LINK_INVALID).toEqual({ error: LINK_INVALID_ERROR, message: "Le lien doit commencer par https:// et mener à un site web." });
  });

  it("le filtre des mots interdits lit le lien tel qu'écrit, tel que rangé, et décodé", () => {
    expect(bioLinkTexts("https://exemple.com/conn%61rd", "https://exemple.com/conn%61rd")).toContain("https://exemple.com/connard");
    expect(bioLinkTexts(null, null)).toEqual([]);
    // Un « % » isolé ne fait pas échouer la lecture.
    expect(bioLinkTexts("https://exemple.com/100%", "https://exemple.com/100%")).toEqual(["https://exemple.com/100%", "https://exemple.com/100%"]);
  });
});

describe("le lien : enregistrer, retirer, garder", () => {
  it("enregistré mis en forme, rendu par PATCH et GET /api/me", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    const response = await as(target, BRUNO).patchMe({ username: "bruno", displayName: "Bruno", linkUrl: "  HTTPS://Bruno.Example.com/Lookbook  " });
    expect(response.statusCode).toBe(200);
    expect((response.json() as Profile).linkUrl).toBe("https://bruno.example.com/Lookbook");
    expect(row(fake, "profiles", BRUNO).link_url).toBe("https://bruno.example.com/Lookbook");
    expect((await me(target, BRUNO)).linkUrl).toBe("https://bruno.example.com/Lookbook");
    expect((await me(target, CARL)).linkUrl).toBeNull();
  });

  it("`linkUrl` absent : le lien ne bouge pas (une ancienne app qui enregistre le profil ne l'efface jamais)", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    const response = await as(target, ANNA).patchMe(annaForm({ bio: "Nouvelle bio" }));
    expect(response.statusCode).toBe(200);
    expect(row(fake, "profiles", ANNA)).toMatchObject({ bio: "Nouvelle bio", link_url: ANNA_LINK });
    expect((response.json() as Profile).linkUrl).toBe(ANNA_LINK);
  });

  it("null ou \"\" le retire", async () => {
    for (const linkUrl of [null, "", "   "]) {
      resetProfileExtrasProbe();
      const fake = seeded();
      const target = await pinsApp(fake.db);
      const response = await as(target, ANNA).patchMe(annaForm({ linkUrl }));
      expect(response.statusCode, JSON.stringify(linkUrl)).toBe(200);
      expect(row(fake, "profiles", ANNA).link_url).toBeNull();
      expect((response.json() as Profile).linkUrl).toBeNull();
      await target.close();
      app = null;
    }
  });

  it("un lien refusé : la phrase du serveur (traduite), et rien du profil n'est enregistré", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    for (const linkUrl of ["http://exemple.com", "javascript:alert(1)", "https://192.168.1.1/", "https://xn--exmple-cua.com", "https://exämple.com"]) {
      const response = await as(target, ANNA).patchMe(annaForm({ bio: "Changée", linkUrl }));
      expect(response.statusCode, linkUrl).toBe(400);
      expect(response.json()).toEqual(LINK_INVALID);
    }
    const tooLong = await as(target, ANNA).patchMe(annaForm({ linkUrl: `https://exemple.com/${"a".repeat(200)}` }));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual(LINK_TOO_LONG);
    // Un texte démesuré, ou d'un autre type : refusé avant toute lecture.
    expect((await as(target, ANNA).patchMe(annaForm({ linkUrl: `https://exemple.com/${"a".repeat(3000)}` }))).json()).toEqual(LINK_TOO_LONG);
    expect((await as(target, ANNA).patchMe(annaForm({ linkUrl: 42 }))).json()).toEqual(LINK_INVALID);
    expect(row(fake, "profiles", ANNA)).toMatchObject({ bio: "Mode et voyages", link_url: ANNA_LINK });
    expect(localizeMessage(LINK_INVALID.message, 400, "en")).toBe("The link must start with https:// and lead to a website.");
    expect(localizeMessage(LINK_TOO_LONG.message, 400, "en")).toBe("The link is too long (200 characters maximum).");
  });

  it("un mot interdit dans le lien, même encodé : refusé comme dans la bio", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    for (const linkUrl of ["https://exemple.com/connard", "https://exemple.com/conn%61rd", "https://salope.exemple.com/"]) {
      const response = await as(target, ANNA).patchMe(annaForm({ linkUrl }));
      expect(response.statusCode, linkUrl).toBe(400);
      expect(response.json().error).toBe("content_not_allowed");
    }
    expect(row(fake, "profiles", ANNA).link_url).toBe(ANNA_LINK);
  });

  it("un compte suspendu ne change pas son profil public, lien compris (comme tout le PATCH)", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    const response = await as(target, SAM).patchMe({ username: "sam", displayName: "Sam", linkUrl: "https://autre.example.com" });
    expect(response.statusCode).toBe(403);
    expect(row(fake, "profiles", SAM).link_url).toBe(SAM_LINK);
  });

  it("limite « profileLink » : 10 changements par 24 heures ; renvoyer le même lien ne compte pas ; retirer reste permis ; rien n'est écrit au-delà", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    // Les limites sont coupées sous vitest (NODE_ENV « test ») : rallumées ici.
    process.env.NODE_ENV = "development";
    const user = DORA;
    const form = (linkUrl: string | null) => ({ username: "dora", displayName: "Dora", linkUrl });
    for (let n = 1; n <= RATE_LIMITS.profileLink.max; n += 1) {
      expect((await as(target, user).patchMe(form(`https://dora${n}.example.com/`))).statusCode, `changement ${n}`).toBe(200);
    }
    // Le même lien, de nouveau (l'app enregistre le profil sans y toucher) : pas un changement.
    expect((await as(target, user).patchMe(form("https://dora10.example.com/"))).statusCode).toBe(200);
    const eleventh = await as(target, user).patchMe(form("https://dora11.example.com/"));
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json()).toEqual({ error: PROFILE_LINK_LIMIT_ERROR, message: "Vous avez changé de lien trop souvent. Réessayez demain." });
    expect(row(fake, "profiles", user).link_url).toBe("https://dora10.example.com/");
    expect((await as(target, user).patchMe(form(null))).statusCode).toBe(200);
    expect(row(fake, "profiles", user).link_url).toBeNull();
    expect(RATE_LIMITS.profileLink).toMatchObject({ max: 10, windowMs: 24 * 60 * 60_000, error: PROFILE_LINK_LIMIT_ERROR });
    expect(localizeMessage(RATE_LIMITS.profileLink.message, 429, "en")).toBe("You've changed your link too often. Please try again tomorrow.");
  });
});

describe("le lien : qui le voit", () => {
  it("compte public : son abonné et un inconnu le voient ; le membre le voit sur son propre profil", async () => {
    const target = await pinsApp(seeded().db);
    expect((await userProfile(target, BRUNO, ANNA)).linkUrl).toBe(ANNA_LINK);
    expect((await userProfile(target, CARL, ANNA)).linkUrl).toBe(ANNA_LINK);
    expect((await userProfile(target, ANNA, ANNA)).linkUrl).toBe(ANNA_LINK);
    expect((await me(target, ANNA)).linkUrl).toBe(ANNA_LINK);
    // Sans lien : null.
    expect((await userProfile(target, ANNA, BRUNO)).linkUrl).toBeNull();
  });

  it("règle 4 : compte suspendu, ni bio ni lien pour les autres ; le membre lui-même les voit toujours", async () => {
    const target = await pinsApp(seeded().db);
    const seenByOther = await userProfile(target, CARL, SAM);
    expect(seenByOther).toMatchObject({ bio: null, linkUrl: null });
    expect(JSON.stringify(seenByOther)).not.toContain("sam.example.net");
    expect(await userProfile(target, SAM, SAM)).toMatchObject({ bio: "Bio de Sam", linkUrl: SAM_LINK });
    expect((await me(target, SAM)).linkUrl).toBe(SAM_LINK);
  });

  it("règle 5 : compte privé, rien pour un inconnu ni pour une demande en attente ; son abonné accepté le voit", async () => {
    const target = await pinsApp(seeded().db);
    for (const viewer of [CARL, DORA]) {
      const shell = await userProfile(target, viewer, PAULA);
      expect(shell, viewer).not.toHaveProperty("linkUrl");
      expect(JSON.stringify(shell)).not.toContain("paula.example.org");
    }
    expect((await userProfile(target, BRUNO, PAULA)).linkUrl).toBe(PAULA_LINK);
    expect((await me(target, PAULA)).linkUrl).toBe(PAULA_LINK);
  });

  it("un blocage, dans un sens ou dans l'autre : le profil reste introuvable", async () => {
    const target = await pinsApp(seeded().db);
    for (const [viewer, owner] of [
      [EVE, ANNA],
      [ANNA, EVE],
    ]) {
      const response = await as(target, viewer!).get(`/api/users/${owner}`);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain("anna-boutique");
    }
  });

  it("aucune autre réponse ne porte le lien : recherche, listes de membres, fil, publication", async () => {
    const target = await pinsApp(seeded().db);
    const responses = [
      await as(target, BRUNO).get("/api/users/search?q=ann"),
      await as(target, BRUNO).get(`/api/users/${BRUNO}/following`),
      await as(target, BRUNO).get("/api/feed"),
      await as(target, BRUNO).get(`/api/posts/${A_PUB}`),
      await as(target, BRUNO).get(`/api/users/${ANNA}/posts`),
    ];
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(/anna-boutique|link_?url/i);
    }
    expect(responses[0]!.body).toContain("anna");
  });
});

describe("épingler", () => {
  it("l'auteur épingle une de ses photos : la date est rendue et rangée ; épingler de nouveau ne change rien", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    const response = await as(target, ANNA).pin(A_PUB, { pinned: true });
    expect(response.statusCode).toBe(200);
    const { pinnedAt } = response.json() as { pinnedAt: string };
    expect(Number.isNaN(Date.parse(pinnedAt))).toBe(false);
    expect(row(fake, "posts", A_PUB).pinned_at).toBe(pinnedAt);
    const again = await as(target, ANNA).pin(A_PUB, { pinned: true });
    expect(again.json()).toEqual({ pinnedAt });
    const unpinned = await as(target, ANNA).pin(A_PUB, { pinned: false });
    expect(unpinned.json()).toEqual({ pinnedAt: null });
    expect(row(fake, "posts", A_PUB).pinned_at).toBeNull();
  });

  it("règle 3 : seul l'auteur épingle ou retire l'épingle ; un autre membre reçoit 404, comme pour une publication inconnue", async () => {
    const fake = seeded({ pinned: { [A_FOL]: "2026-11-15T10:00:00.000Z" } });
    const target = await pinsApp(fake.db);
    for (const viewer of [BRUNO, CARL, PAULA, ADMIN]) {
      for (const [postId, pinned] of [
        [A_PUB, true],
        [A_FOL, false],
      ] as const) {
        const response = await as(target, viewer).pin(postId, { pinned });
        expect(response.statusCode, `${viewer} ${postId}`).toBe(404);
        expect(response.json()).toEqual(POST_NOT_FOUND);
      }
    }
    expect((await as(target, ANNA).pin(UNKNOWN, { pinned: true })).json()).toEqual(POST_NOT_FOUND);
    expect(row(fake, "posts", A_PUB).pinned_at).toBeNull();
    expect(row(fake, "posts", A_FOL).pinned_at).toBe("2026-11-15T10:00:00.000Z");
  });

  it("seules les photos s'épinglent : un achat ou une envie, 400 avec la phrase du serveur", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    for (const postId of [A_BUY, A_WISH]) {
      const response = await as(target, ANNA).pin(postId, { pinned: true });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(PIN_NOT_ALLOWED);
      expect(row(fake, "posts", postId).pinned_at).toBeNull();
    }
    expect(localizeMessage(PIN_NOT_ALLOWED.message, 400, "en")).toBe("Only your photos can be pinned.");
  });

  it("une publication masquée par la modération est introuvable, même pour son auteur", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    expect((await as(target, ANNA).pin(A_HID, { pinned: true })).json()).toEqual(POST_NOT_FOUND);
    expect(row(fake, "posts", A_HID).pinned_at).toBeNull();
  });

  it("3 au plus : la quatrième, 409 ; une épinglée masquée ne compte pas ; en retirer une libère une place", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    for (const postId of [A_PUB, A_FOL, A_PRIV]) expect((await as(target, ANNA).pin(postId, { pinned: true })).statusCode).toBe(200);
    const fourth = await as(target, ANNA).pin(A_NEW, { pinned: true });
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json()).toEqual(PIN_LIMIT);
    expect(row(fake, "posts", A_NEW).pinned_at).toBeNull();
    expect(PINNED_POSTS_MAX).toBe(3);
    expect(localizeMessage(PIN_LIMIT.message, 409, "en")).toBe("You can pin up to 3 posts. Unpin one first.");
    // Une des trois masquée par la modération : elle ne prend plus de place.
    row(fake, "posts", A_PRIV).hidden_at = "2026-11-16T00:00:00+00:00";
    expect((await as(target, ANNA).pin(A_NEW, { pinned: true })).statusCode).toBe(200);
    expect((await as(target, ANNA).pin(A_OTHER, { pinned: true })).statusCode).toBe(409);
    expect((await as(target, ANNA).pin(A_PUB, { pinned: false })).statusCode).toBe(200);
    expect((await as(target, ANNA).pin(A_OTHER, { pinned: true })).statusCode).toBe(200);
  });

  it("un compte suspendu ne peut pas épingler, mais peut toujours retirer une épingle", async () => {
    const fake = seeded();
    fake.table("posts").push(post("51000000-0000-4000-8000-000000000001", SAM, "public", { pinnedAt: "2026-11-15T09:00:00.000Z" }), post("51000000-0000-4000-8000-000000000002", SAM, "public"));
    const target = await pinsApp(fake.db);
    const refused = await as(target, SAM).pin("51000000-0000-4000-8000-000000000002", { pinned: true });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe("account_suspended");
    expect(row(fake, "posts", "51000000-0000-4000-8000-000000000002").pinned_at).toBeNull();
    const unpinned = await as(target, SAM).pin("51000000-0000-4000-8000-000000000001", { pinned: false });
    expect(unpinned.statusCode).toBe(200);
    expect(row(fake, "posts", "51000000-0000-4000-8000-000000000001").pinned_at).toBeNull();
  });

  it("une demande mal formée est refusée avant toute lecture", async () => {
    const fake = seeded();
    const target = await pinsApp(fake.db);
    for (const payload of [{}, { pinned: "oui" }, { pinned: 1 }, { pinned: true, pinnedAt: "2020-01-01" }, null]) {
      const response = await as(target, ANNA).pin(A_PUB, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await as(target, ANNA).pin("pas-un-identifiant", { pinned: true })).statusCode).toBe(400);
    expect(row(fake, "posts", A_PUB).pinned_at).toBeNull();
    expect(localizeMessage("Épinglage invalide.", 400, "en")).toBe("Invalid pin request.");
  });

  it("GET /api/posts/mine : chaque photo dit si elle est épinglée (l'app les met en tête)", async () => {
    const target = await pinsApp(seeded({ pinned: { [A_FOL]: "2026-11-15T10:00:00.000Z" } }).db);
    const mine: Post[] = (await as(target, ANNA).get("/api/posts/mine")).json();
    expect(mine.find((value) => value.id === A_FOL)?.pinnedAt).toBe("2026-11-15T10:00:00.000Z");
    expect(mine.find((value) => value.id === A_PUB)?.pinnedAt).toBeNull();
    for (const value of mine) expect(value).toHaveProperty("pinnedAt");
  });
});

describe("les épingles sur un profil (règles 1 et 2)", () => {
  const PINS = {
    [A_PUB]: "2026-11-15T10:00:00.000Z",
    [A_FOL]: "2026-11-15T11:00:00.000Z",
    [A_PRIV]: "2026-11-15T12:00:00.000Z",
    [A_HID]: "2026-11-15T13:00:00.000Z",
    [P_PUB]: "2026-11-15T14:00:00.000Z",
  };

  it("règle 1 : une épinglée suit sa propre visibilité ; « Privé » absente pour un visiteur ; masquée absente pour tous, l'auteur compris", async () => {
    const target = await pinsApp(seeded({ pinned: PINS }).db);
    expect(ids((await userPosts(target, CARL, ANNA)).pinned)).toEqual([A_PUB]);
    expect(ids((await userPosts(target, BRUNO, ANNA)).pinned)).toEqual([A_FOL, A_PUB]);
    expect(ids((await userPosts(target, ANNA, ANNA)).pinned)).toEqual([A_PRIV, A_FOL, A_PUB]);
    for (const viewer of [CARL, BRUNO, ANNA]) {
      const page = await userPosts(target, viewer, ANNA);
      expect(ids(page.pinned)).not.toContain(A_HID);
      expect(ids(page.posts)).not.toContain(A_HID);
      // Les épinglées restent aussi à leur place dans la liste (une ancienne app les y montre).
      for (const id of ids(page.pinned)) expect(ids(page.posts)).toContain(id);
    }
  });

  it("la date d'une épingle n'est rendue qu'à l'auteur ; les autres reçoivent seulement la liste", async () => {
    const target = await pinsApp(seeded({ pinned: PINS }).db);
    const other = await userPosts(target, BRUNO, ANNA);
    for (const value of [...other.posts, ...(other.pinned ?? [])]) expect(value).not.toHaveProperty("pinnedAt");
    const own = await userPosts(target, ANNA, ANNA);
    expect(own.pinned?.[0]?.pinnedAt).toBe(PINS[A_PRIV]);
    expect((await as(target, BRUNO).get(`/api/posts/${A_PUB}`)).json()).not.toHaveProperty("pinnedAt");
  });

  it("une épinglée que le visiteur a signalée ne lui est plus montrée", async () => {
    const target = await pinsApp(seeded({ pinned: PINS, reported: [[CARL, A_PUB]] }).db);
    const page = await userPosts(target, CARL, ANNA);
    expect(page.pinned).toEqual([]);
    expect(ids(page.posts)).not.toContain(A_PUB);
    expect(ids((await userPosts(target, BRUNO, ANNA)).pinned)).toContain(A_PUB);
  });

  it("règle 2 : compte privé, aucune épingle pour un inconnu ni pour une demande en attente ; l'abonné accepté les voit ; blocage : 404", async () => {
    const target = await pinsApp(seeded({ pinned: PINS }).db);
    for (const viewer of [CARL, DORA]) {
      const page = await userPosts(target, viewer, PAULA);
      expect(page).toEqual({ posts: [], nextCursor: null });
    }
    expect(ids((await userPosts(target, BRUNO, PAULA)).pinned)).toEqual([P_PUB]);
    const blocked = await as(target, EVE).get(`/api/users/${ANNA}/posts`);
    expect(blocked.statusCode).toBe(404);
    expect(blocked.body).not.toContain(A_PUB);
  });

  it("seulement sur la première page", async () => {
    const target = await pinsApp(seeded({ pinned: PINS }).db);
    const next = await userPosts(target, BRUNO, ANNA, `?cursor=${encodeURIComponent("2026-11-09T00:00:00+00:00")}`);
    expect(next).not.toHaveProperty("pinned");
  });

  it("4 épinglées dans la base (deux épingles au même instant) : la lecture garde les 3 plus récentes ; jamais un achat", async () => {
    const fake = seeded({ pinned: { [A_PUB]: "2026-11-15T10:00:00.000Z", [A_NEW]: "2026-11-15T11:00:00.000Z", [A_OTHER]: "2026-11-15T12:00:00.000Z", [A_FOL]: "2026-11-15T13:00:00.000Z" } });
    row(fake, "posts", A_BUY).pinned_at = "2026-11-15T23:00:00.000Z";
    const target = await pinsApp(fake.db);
    expect(ids((await userPosts(target, BRUNO, ANNA)).pinned)).toEqual([A_FOL, A_OTHER, A_NEW]);
  });

  it("épingles illisibles : la page part sans `pinned`, jamais une liste non filtrée, jamais une erreur", async () => {
    const fake = seeded({ pinned: PINS });
    const target = await pinsApp(failing(fake.db, (table, method, args) => table === "posts" && method === "order" && args[0] === "pinned_at"));
    const page = await userPosts(target, BRUNO, ANNA);
    expect(page).not.toHaveProperty("pinned");
    expect(page.posts.length).toBeGreaterThan(0);
  });
});

describe("modération", () => {
  async function queueItem(target: FastifyInstance, userId: string): Promise<ModerationItem | undefined> {
    const response = await as(target, ADMIN).get("/api/admin/moderation?status=open");
    expect(response.statusCode).toBe(200);
    return (response.json() as ModerationPage).items.find((item) => item.targetType === "user" && item.targetId === userId);
  }
  const reportUser = (fake: Fake, userId: string) =>
    fake.table("reports").push({ id: randomUUID(), reporter_id: CARL, target_type: "user", target_id: userId, reason: "inappropriate", note: null, handled_at: null, moderation_action_id: null, created_at: stamp() });

  it("un profil signalé montre son lien en texte, à côté de la bio ; sans lien ou sans 0049, rien", async () => {
    const fake = seeded();
    reportUser(fake, ANNA);
    reportUser(fake, BRUNO);
    const target = await pinsApp(fake.db);
    expect((await queueItem(target, ANNA))?.preview).toMatchObject({ kind: "user", bio: "Mode et voyages", linkUrl: ANNA_LINK });
    expect((await queueItem(target, BRUNO))?.preview).not.toHaveProperty("linkUrl");
    await target.close();
    resetProfileExtrasProbe();
    const without = seeded({}, WITHOUT_0049);
    reportUser(without, ANNA);
    const old = await pinsApp(without.db);
    expect((await queueItem(old, ANNA))?.preview).not.toHaveProperty("linkUrl");
  });

  it("règle 7 : retirer la bio retire aussi le lien ; le journal ne contient pas l'adresse", async () => {
    const fake = seeded();
    reportUser(fake, ANNA);
    const target = await pinsApp(fake.db);
    const response = await as(target, ADMIN).post("/api/admin/moderation/remove-profile-part", { userId: ANNA, part: "bio", reason: "inappropriate" });
    expect(response.statusCode).toBe(200);
    expect(row(fake, "profiles", ANNA)).toMatchObject({ bio: null, link_url: null });
    expect(lines.join("\n")).not.toContain("anna-boutique");
    expect((await userProfile(target, BRUNO, ANNA)).linkUrl).toBeNull();
  });

  it("retirer la photo ne touche pas au lien ; une bio déjà vide (« rien à retirer ») non plus", async () => {
    const fake = seeded();
    row(fake, "profiles", ANNA).avatar_url = `${STORAGE_ORIGIN}/storage/v1/object/public/avatars/${ANNA}/avatar-1.jpg`;
    fake.files.set(`avatars/${ANNA}/avatar-1.jpg`, Buffer.from("photo"));
    const target = await pinsApp(fake.db);
    expect((await as(target, ADMIN).post("/api/admin/moderation/remove-profile-part", { userId: ANNA, part: "avatar", reason: "inappropriate" })).statusCode).toBe(200);
    expect(row(fake, "profiles", ANNA).link_url).toBe(ANNA_LINK);
    const nothing = await as(target, ADMIN).post("/api/admin/moderation/remove-profile-part", { userId: PAULA, part: "bio", reason: "inappropriate" });
    expect(nothing.statusCode).toBe(409);
    expect(row(fake, "profiles", PAULA).link_url).toBe(PAULA_LINK);
  });

  it("le lien ne s'efface pas après la décision : l'administrateur l'apprend (500), la décision reste enregistrée", async () => {
    const fake = seeded({}, { failWrite: (table, action, values) => (table === "profiles" && action === "update" && typeof values === "object" && values !== null && "link_url" in values ? { code: "57014", message: "délai dépassé" } : null) });
    const target = await pinsApp(fake.db);
    const response = await as(target, ADMIN).post("/api/admin/moderation/remove-profile-part", { userId: ANNA, part: "bio", reason: "inappropriate" });
    expect(response.statusCode).toBe(500);
    expect(fake.table("moderation_actions").map((action) => action.action)).toEqual(["remove_bio"]);
    expect(lines.join("\n")).not.toContain("anna-boutique");
  });
});

describe("withoutSuspendedFaces apprend le lien", () => {
  it("le lien d'un compte suspendu est retiré, sauf pour lui-même ; celui d'un compte actif reste ; aucune lecture sans rien à cacher", async () => {
    let reads = 0;
    const fake = seeded();
    const db: Db = { ...fake.db, from: (name: string) => {
      if (name === "suspensions") reads += 1;
      return fake.db.from(name);
    } };
    const target = await pinsApp(db);
    const faces = [
      { id: SAM, avatar_url: null, link_url: SAM_LINK },
      { id: ANNA, avatar_url: null, link_url: ANNA_LINK },
    ];
    reads = 0;
    expect(await withoutSuspendedFaces(target, faces, CARL)).toEqual([
      { id: SAM, avatar_url: null, link_url: null },
      { id: ANNA, avatar_url: null, link_url: ANNA_LINK },
    ]);
    expect(reads).toBe(1);
    expect(await withoutSuspendedFaces(target, faces, SAM)).toEqual([faces[0], { id: ANNA, avatar_url: null, link_url: ANNA_LINK }]);
    reads = 0;
    expect(await withoutSuspendedFaces(target, [{ id: SAM, avatar_url: null, link_url: null }], CARL)).toEqual([{ id: SAM, avatar_url: null, link_url: null }]);
    expect(reads).toBe(0);
    // Sans colonne lue : la forme ne change pas.
    expect(await withoutSuspendedFaces(target, [{ id: SAM, avatar_url: "x" }], CARL)).toEqual([{ id: SAM, avatar_url: null }]);
  });
});

describe("la route d'épingle et ses limites", () => {
  it("PUT /api/posts/:id/pin garde le filet commun (aucune limite nommée) ; la limite du lien porte sur le seul PATCH /api/me", async () => {
    await pinsApp(seeded().db);
    expect(limitNames.has("PUT /api/posts/:id/pin")).toBe(true);
    expect(limitNames.get("PUT /api/posts/:id/pin")).toBeUndefined();
    expect(limitNames.get("PATCH /api/me")).toBeUndefined();
  });
});
