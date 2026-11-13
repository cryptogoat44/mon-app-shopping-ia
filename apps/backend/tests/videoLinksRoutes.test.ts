import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mission « liens vidéo », étapes 2, 3 et 5 côté serveur : routes
// /api/video-links. Sans base ni réseau : fausse base en mémoire, fonctions
// des migrations 0038 et 0039 imitées, TikTok et Meta simulés. (Le tri réel
// des pièces, les garde-fous de 0039 et les droits de la base sont vérifiés
// avec la base d'essai : tests/memoireVideos.test.ts.) Revue de sécurité :
// comptes suspendus refusés, limite par membre des demandes vers Meta,
// « search_too_old », retrait d'une pièce par la modération, export RGPD.
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { ...original, env: { ...original.env, TIKTOK_PLAYER_ENABLED: true, INSTAGRAM_PLAYER_ENABLED: true } };
});

import type { VideoLookupResponse } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { safeFetch } from "../src/lib/safeFetch.js";
import { resetInstagramEmbed } from "../src/lib/instagramEmbed.js";
import { resetShortLinkCache } from "../src/lib/videoLinks.js";
import { productKeyOf, resetVideoMemoryProbe } from "../src/lib/videoMemory.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import videoLinksRoutes from "../src/routes/videoLinks.js";
import moderationPlugin from "../src/plugins/moderation.js";
import accountRoutes from "../src/routes/account.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

const safeFetchMock = vi.mocked(safeFetch);
const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const SEARCH = "50000000-0000-4000-8000-000000000001";
const ID = "7412345678901234567";
const TIKTOK = `https://www.tiktok.com/@scout2015/video/${ID}`;
const TIKTOK_LINK = { platform: "tiktok", videoKey: ID, canonicalUrl: TIKTOK, creatorHandle: "scout2015" };
const REEL = "https://www.instagram.com/reel/C8abcDEF123/";
const KEY = (letter: string) => letter.repeat(64);

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/** Ce que les fonctions de 0038 et 0039 répondent dans un test. */
interface Memory {
  /** false : base sans la migration 0038. */
  present: boolean;
  /** Réponse de video_memory_version : 1 = 0038 seule, 2 = avec 0039. */
  version: number;
  /** Réponse de video_memory_remove. */
  remove: string;
  products: Row[];
  productsError: boolean;
  spot: string;
  confirm: string;
}

let app: FastifyInstance | null = null;
let calls: RpcCall[] = [];
let memory: Memory;
let fake: ReturnType<typeof fakeSupabase>;
let suspended = false;
let admin = false;

function productRow(letter: string, extra: Row = {}): Row {
  return {
    product_key: KEY(letter),
    product_match_id: `60000000-0000-4000-8000-00000000000${letter}`,
    product_name: `Pièce ${letter}`,
    brand: null,
    image_url: `https://images.example/${letter}.jpg`,
    image_hd_url: null,
    price_min: "129.00",
    currency: "EUR",
    merchant_name: "Boutique",
    merchant_url: `https://boutique.example/${letter}`,
    confirmations: 0,
    appearances: 1,
    last_seen_at: "2026-11-12T10:00:00+00:00",
    confirmed_by_viewer: false,
    ...extra,
  };
}

async function buildApp(): Promise<FastifyInstance> {
  fake = fakeSupabase({
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (!memory.present) return { data: null, error: { code: "PGRST202", message: "absente" } };
      if (fn === "video_memory_version") return { data: memory.version, error: null };
      if (fn === "video_memory_remove") return { data: [{ outcome: memory.remove, items: memory.remove === "ok" ? 2 : 0, confirmations: memory.remove === "ok" ? 1 : 0 }], error: null };
      if (fn === "video_products") return memory.productsError ? { data: null, error: { message: "panne" } } : { data: memory.products, error: null };
      if (fn === "video_spot_record") return { data: [{ outcome: memory.spot, items: 2 }], error: null };
      if (fn === "video_confirm") return { data: [{ outcome: memory.confirm }], error: null };
      return { data: null, error: { code: "PGRST202", message: "absente" } };
    },
  });
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: null };
  });
  app.decorate("requireActiveAccount", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (suspended) return reply.code(403).send({ error: "account_suspended", message: "Compte suspendu." });
  });
  app.decorate("requireAdmin", async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!admin) return reply.code(403).send({ error: "forbidden", message: "Accès réservé aux administrateurs." });
  });
  await app.register(rateLimitPlugin);
  await app.register(videoLinksRoutes);
  await app.ready();
  return app;
}

const as = (target: FastifyInstance, user: string | null = ALICE) => {
  const headers: Record<string, string> = user ? { "x-test-user": user } : {};
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
  };
};
const lookup = (target: FastifyInstance, url: string, user: string | null = ALICE) => as(target, user).get(`/api/video-links/lookup?url=${encodeURIComponent(url)}`);
const called = (fn: string) => calls.filter((call) => call.fn === fn);

beforeEach(() => {
  calls = [];
  suspended = false;
  admin = false;
  memory = { present: true, version: 2, remove: "ok", products: [], productsError: false, spot: "ok", confirm: "ok" };
  resetVideoMemoryProbe();
  resetShortLinkCache();
  resetInstagramEmbed();
  safeFetchMock.mockReset();
  Object.assign(env, { TIKTOK_PLAYER_ENABLED: true, INSTAGRAM_PLAYER_ENABLED: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("aucun appel sortant attendu");
    })
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await app?.close();
  app = null;
});

describe("toutes les routes demandent un compte connecté", () => {
  it("sans session : 401, rien n'est lu", async () => {
    const target = await buildApp();
    const anonymous = as(target, null);
    for (const res of [
      await anonymous.get("/api/video-links/status"),
      await lookup(target, TIKTOK, null),
      await anonymous.get(`/api/video-links/instagram-embed?url=${encodeURIComponent(REEL)}`),
      await anonymous.post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "tiktok_player" }),
      await anonymous.post("/api/video-links/confirm", { url: TIKTOK, productKey: KEY("a") }),
      await anonymous.post("/api/admin/moderation/video-memory/remove", { url: TIKTOK, productKey: KEY("a") }),
    ]) {
      expect(res.statusCode).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it("chaque route a sa propre limite de débit", () => {
    expect(RATE_LIMITS.videoLookup).toMatchObject({ max: 120 });
    // Revue de sécurité : 10 liens courts par membre (et non 30), 10 demandes vers Meta par membre.
    expect(RATE_LIMITS.videoShortLink).toMatchObject({ max: 10 });
    expect(RATE_LIMITS.videoShortLinkGlobal).toMatchObject({ scope: "global" });
    expect(RATE_LIMITS.videoEmbed).toMatchObject({ max: 60 });
    expect(RATE_LIMITS.videoEmbedFetch).toMatchObject({ max: 10, windowMs: 60 * 60 * 1000 });
    expect("scope" in RATE_LIMITS.videoEmbedFetch).toBe(false);
    expect(RATE_LIMITS.videoSpot).toMatchObject({ max: 60 });
    expect(RATE_LIMITS.videoConfirm).toMatchObject({ max: 120 });
  });
});

describe("interrupteurs du serveur : ils ne peuvent que couper", () => {
  it("allumés par défaut ; chacun se coupe à part ; la mémoire dit si les migrations 0038 et 0039 sont là", async () => {
    const target = await buildApp();
    expect((await as(target).get("/api/video-links/status")).json()).toEqual({ players: { tiktok: true, instagram: true }, memory: true });
    Object.assign(env, { TIKTOK_PLAYER_ENABLED: false });
    expect((await as(target).get("/api/video-links/status")).json().players).toEqual({ tiktok: false, instagram: true });
    Object.assign(env, { TIKTOK_PLAYER_ENABLED: true, INSTAGRAM_PLAYER_ENABLED: false });
    expect((await lookup(target, TIKTOK)).json().players).toEqual({ tiktok: true, instagram: false });
  });

  it("base sans la migration 0038 : mémoire « indisponible », le lien est reconnu quand même, rien n'est noté", async () => {
    memory.present = false;
    const target = await buildApp();
    expect((await as(target).get("/api/video-links/status")).json().memory).toBe(false);
    const res = await lookup(target, TIKTOK);
    expect(res.json()).toEqual({ link: TIKTOK_LINK, linkIssue: null, players: { tiktok: true, instagram: true }, memoryAvailable: false, products: [] });
    expect(called("video_products")).toEqual([]);
    const spot = await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "tiktok_player" });
    expect(spot.statusCode).toBe(404);
    expect(spot.json()).toEqual({ error: "video_memory_unavailable", message: "Les pièces déjà repérées ne sont pas encore disponibles." });
    expect((await as(target).post("/api/video-links/confirm", { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(404);
    expect(called("video_spot_record")).toEqual([]);
  });

  it("revue de sécurité : base avec 0038 mais sans 0039 (garde-fous) : mémoire « indisponible », rien n'est lu ni noté", async () => {
    memory.version = 1;
    const target = await buildApp();
    expect((await as(target).get("/api/video-links/status")).json().memory).toBe(false);
    expect((await lookup(target, TIKTOK)).json()).toMatchObject({ link: TIKTOK_LINK, memoryAvailable: false, products: [] });
    expect((await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "tiktok_player" })).statusCode).toBe(404);
    expect((await as(target).post("/api/video-links/confirm", { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(404);
    admin = true;
    expect((await as(target).post("/api/admin/moderation/video-memory/remove", { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(404);
    expect(calls.map((call) => call.fn).filter((fn) => fn !== "video_memory_version")).toEqual([]);
  });
});

describe("GET /api/video-links/lookup : reconnaître le lien, montrer les pièces déjà repérées", () => {
  it("lien complet avec paramètres de suivi : reconnu sans aucun appel sortant ; vidéo inconnue : aucune pièce", async () => {
    const target = await buildApp();
    const res = await lookup(target, `Regarde ! ${TIKTOK}?_r=1&_t=8abc`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ link: TIKTOK_LINK, linkIssue: null, players: { tiktok: true, instagram: true }, memoryAvailable: true, products: [] });
    // Une pièce n'est montrée qu'une fois trouvée par 2 membres distincts (VIDEO_MEMORY_MIN_MEMBERS).
    expect(called("video_products")[0]!.args).toEqual({ p_platform: "tiktok", p_video_key: ID, p_viewer_id: ALICE, p_limit: 12, p_min_members: 2 });
    expect(fetch).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("vidéo connue : les pièces dans l'ordre donné par la base, lien affilié avec sa mention, jamais un identifiant de membre", async () => {
    memory.products = [
      productRow("a", { confirmations: 3, appearances: 2, confirmed_by_viewer: true, image_hd_url: "https://images.example/a-hd.jpg", brand: "Maison" }),
      productRow("b", { price_min: null, currency: null }),
      productRow("c", { merchant_url: "javascript:alert(1)" }),
    ];
    const target = await buildApp();
    fake.table("affiliate_links").push({ product_match_id: "60000000-0000-4000-8000-00000000000b", affiliate_url: "https://partenaire.example/b?aff=1" });
    const body = (await lookup(target, TIKTOK)).json() as VideoLookupResponse;
    expect(body.products).toEqual([
      { productKey: KEY("a"), productName: "Pièce a", brand: "Maison", imageUrl: "https://images.example/a-hd.jpg", priceMin: 129, currency: "EUR", merchantName: "Boutique", merchantUrl: "https://boutique.example/a", isAffiliate: false, confirmations: 3, appearances: 2, confirmedByMe: true },
      { productKey: KEY("b"), productName: "Pièce b", brand: null, imageUrl: "https://images.example/b.jpg", priceMin: null, currency: null, merchantName: "Boutique", merchantUrl: "https://partenaire.example/b?aff=1", isAffiliate: true, confirmations: 0, appearances: 1, confirmedByMe: false },
    ]);
    // L'ordre vient de la base (confirmations, apparitions, récence) : le lien affilié, 2ᵉ, n'est jamais remonté.
    expect(body.products.map((product) => product.isAffiliate)).toEqual([false, true]);
    const text = JSON.stringify(body);
    for (const secret of [ALICE, BOB, "user_id", "search_id", "product_match_id", "60000000"]) expect(text).not.toContain(secret);
  });

  it("mémoire illisible : le lien reste reconnu (200), sans pièces, pour ne jamais empêcher de spotter", async () => {
    memory.productsError = true;
    const res = await lookup(await buildApp(), TIKTOK);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ link: TIKTOK_LINK, memoryAvailable: false, products: [] });
  });

  it("texte sans lien TikTok ni Instagram : `link` null, aucune lecture ; paramètre absent ou démesuré : 400", async () => {
    const target = await buildApp();
    expect((await lookup(target, "https://www.youtube.com/watch?v=abcdefghijk")).json()).toMatchObject({ link: null, linkIssue: null, products: [] });
    expect(called("video_products")).toEqual([]);
    expect((await as(target).get("/api/video-links/lookup")).statusCode).toBe(400);
    const tooLong = await lookup(target, "a".repeat(5000));
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: "invalid_link", message: "Lien invalide." });
  });

  it("lien court TikTok : une seule demande de redirection, puis la mémoire du serveur ; TikTok muet : « unreachable »", async () => {
    const fetchMock = vi.fn(async () => ({ status: 301, headers: new Headers({ location: `${TIKTOK}?_r=1` }), body: null }));
    vi.stubGlobal("fetch", fetchMock);
    const target = await buildApp();
    const first = await lookup(target, "https://vm.tiktok.com/ZMabcdEFG/");
    expect(first.json()).toMatchObject({ link: TIKTOK_LINK, linkIssue: null });
    await lookup(target, "Vu ici https://vm.tiktok.com/ZMabcdEFG/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual(["https://vm.tiktok.com/ZMabcdEFG/", expect.objectContaining({ method: "GET", redirect: "manual" })]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("délai dépassé");
      })
    );
    expect((await lookup(target, "https://vm.tiktok.com/ZMmuet123/")).json()).toMatchObject({ link: null, linkIssue: "unreachable", products: [] });
  });
});

describe("POST /api/video-links/spots : noter un spot après une recherche réussie", () => {
  function seedSearch(owner = ALICE, status = "completed", matches = 3): void {
    fake.table("product_searches").push({ id: SEARCH, user_id: owner, status });
    for (let rank = 1; rank <= matches; rank++) {
      fake.table("product_matches").push({ id: `61000000-0000-4000-8000-0000000000${String(rank).padStart(2, "0")}`, search_id: SEARCH, rank, merchant_url: `https://boutique.example/piece-${rank}?utm_source=x` });
    }
  }

  it("spot noté : la recherche du membre, ses 10 premières pièces au plus avec leur clé « même page », la source et le moment", async () => {
    const target = await buildApp();
    seedSearch(ALICE, "completed", 12);
    fake.table("product_matches").push({ id: "61000000-0000-4000-8000-000000000099", search_id: SEARCH, rank: 0, merchant_url: "javascript:alert(1)" });
    const res = await as(target).post("/api/video-links/spots", { url: `${TIKTOK}?_r=1`, searchId: SEARCH, source: "tiktok_player", momentSeconds: 14 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recorded: true });
    const [call] = called("video_spot_record");
    expect(call!.args).toMatchObject({ p_user_id: ALICE, p_platform: "tiktok", p_video_key: ID, p_canonical_url: TIKTOK, p_creator_handle: "scout2015", p_search_id: SEARCH, p_source: "tiktok_player", p_moment_seconds: 14 });
    const items = call!.args.p_items as { m: string; k: string }[];
    expect(items).toHaveLength(10);
    // Dans l'ordre de la recherche, sans la pièce au lien inutilisable ; la clé ignore les paramètres de suivi.
    expect(items[0]).toEqual({ m: "61000000-0000-4000-8000-000000000001", k: productKeyOf("https://boutique.example/piece-1") });
    expect(items.every((item) => /^[0-9a-f]{64}$/.test(item.k))).toBe(true);
  });

  it("revue de sécurité : recherche de plus de 30 minutes (« search_too_old », vérifié par la base) : 409, message clair", async () => {
    memory.spot = "search_too_old";
    const target = await buildApp();
    seedSearch();
    const res = await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "search_too_old", message: "Cette recherche est trop ancienne pour être associée à une vidéo." });
  });

  it("déjà noté pour cette recherche (ou ce membre a déjà un spot sur cette vidéo) : même réponse, sans doublon", async () => {
    memory.spot = "already_recorded";
    const target = await buildApp();
    seedSearch();
    expect((await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" })).json()).toEqual({ recorded: true });
  });

  it("la recherche d'un autre membre, une recherche non terminée ou sans pièce : refusées, rien n'est noté", async () => {
    const target = await buildApp();
    seedSearch(BOB);
    const other = await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" });
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual({ error: "search_not_found", message: "Recherche introuvable." });

    fake.table("product_searches")[0]!.user_id = ALICE;
    fake.table("product_searches")[0]!.status = "processing";
    expect((await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" })).statusCode).toBe(409);

    fake.table("product_searches")[0]!.status = "completed";
    fake.table("product_matches").length = 0;
    const empty = await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toEqual({ error: "no_products", message: "Cette recherche n'a donné aucune pièce." });
    expect(called("video_spot_record")).toEqual([]);
  });

  it("corps invalide (source inconnue, champ en trop, moment négatif, identifiant mal formé) : 400 ; lien qui n'est pas une vidéo : 422", async () => {
    const target = await buildApp();
    seedSearch();
    const base = { url: TIKTOK, searchId: SEARCH, source: "tiktok_player" };
    for (const payload of [{ ...base, source: "telechargement" }, { ...base, userId: BOB }, { ...base, momentSeconds: -1 }, { ...base, momentSeconds: 1.5 }, { ...base, searchId: "abc" }, { url: TIKTOK }, {}]) {
      const res = await as(target).post("/api/video-links/spots", payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Requête invalide." });
    }
    const notVideo = await as(target).post("/api/video-links/spots", { ...base, url: "https://www.tiktok.com/@scout2015" });
    expect(notVideo.statusCode).toBe(422);
    expect(notVideo.json()).toEqual({ error: "not_a_video_link", message: "Ce lien n'est pas celui d'une vidéo TikTok ou Instagram." });
    expect(called("video_spot_record")).toEqual([]);
  });

  it("compte suspendu : ni spot, ni confirmation, ni lecture, ni code Instagram (revue de sécurité : aucun appel vers TikTok ou Meta)", async () => {
    suspended = true;
    const target = await buildApp();
    seedSearch();
    expect((await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" })).statusCode).toBe(403);
    expect((await as(target).post("/api/video-links/confirm", { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(403);
    expect((await lookup(target, "https://vm.tiktok.com/ZMabcdEFG/")).statusCode).toBe(403);
    expect((await as(target).get(`/api/video-links/instagram-embed?url=${encodeURIComponent(REEL)}`)).statusCode).toBe(403);
    expect(calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(safeFetchMock).not.toHaveBeenCalled();
    // L'état des interrupteurs reste lisible.
    expect((await as(target).get("/api/video-links/status")).statusCode).toBe(200);
  });

  it("la base ne répond pas : 500 avec le message générique, jamais un détail technique", async () => {
    memory.spot = "inattendu";
    const target = await buildApp();
    seedSearch();
    const res = await as(target).post("/api/video-links/spots", { url: TIKTOK, searchId: SEARCH, source: "share" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("internal_error");
  });
});

describe("POST /api/video-links/confirm : « C'est bien cette pièce »", () => {
  it("confirmée (ou déjà confirmée) : la même réponse ; la base reçoit le membre, la vidéo et la clé de la pièce", async () => {
    const target = await buildApp();
    expect((await as(target).post("/api/video-links/confirm", { url: REEL, productKey: KEY("a") })).json()).toEqual({ confirmed: true });
    expect(called("video_confirm")[0]!.args).toEqual({ p_user_id: ALICE, p_platform: "instagram", p_video_key: "C8abcDEF123", p_product_key: KEY("a") });
    memory.confirm = "already_confirmed";
    expect((await as(target).post("/api/video-links/confirm", { url: REEL, productKey: KEY("a") })).json()).toEqual({ confirmed: true });
  });

  it("vidéo ou pièce inconnue : 404 ; clé mal formée ou champ en trop : 400", async () => {
    const target = await buildApp();
    for (const outcome of ["unknown_video", "unknown_product"]) {
      memory.confirm = outcome;
      const res = await as(target).post("/api/video-links/confirm", { url: TIKTOK, productKey: KEY("a") });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "video_product_not_found", message: "Cette pièce n'a pas été repérée dans cette vidéo." });
    }
    for (const payload of [{ url: TIKTOK, productKey: "abc" }, { url: TIKTOK, productKey: KEY("a"), userId: BOB }, { productKey: KEY("a") }]) {
      expect((await as(target).post("/api/video-links/confirm", payload)).statusCode).toBe(400);
    }
  });
});

describe("GET /api/video-links/instagram-embed : le code d'intégration officiel", () => {
  const HTML = '<blockquote class="instagram-media">Publication (@mode.paris)</blockquote>';
  const embedOf = (target: FastifyInstance, url: string) => as(target).get(`/api/video-links/instagram-embed?url=${encodeURIComponent(url)}`);
  const meta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("publication Instagram : le code de Meta et le pseudo qui y figure ; la miniature jointe n'est jamais rendue", async () => {
    safeFetchMock.mockResolvedValueOnce(meta({ html: HTML, thumbnail_url: "https://scontent.example/miniature.jpg" }));
    const res = await embedOf(await buildApp(), `${REEL}?igsh=abc`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ html: HTML, creatorHandle: "mode.paris" });
    expect(String(safeFetchMock.mock.calls[0]![0])).toContain("instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FC8abcDEF123%2F");
  });

  it("interrupteur Instagram coupé : 404 « player_off », aucun appel à Meta", async () => {
    Object.assign(env, { INSTAGRAM_PLAYER_ENABLED: false });
    const res = await embedOf(await buildApp(), REEL);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "player_off", message: "Le lecteur Instagram est désactivé." });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("lien TikTok ou lien inconnu : 422, aucun appel à Meta", async () => {
    const target = await buildApp();
    expect((await embedOf(target, TIKTOK)).statusCode).toBe(422);
    expect((await embedOf(target, "https://exemple.fr/")).statusCode).toBe(422);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("publication privée ou supprimée : 404 ; limite de Meta atteinte ou Meta muet : 503 (l'app montre l'écran de secours)", async () => {
    const target = await buildApp();
    safeFetchMock.mockResolvedValueOnce(meta({ error: { code: 100 } }, 400));
    const gone = await embedOf(target, REEL);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: "embed_unavailable", message: "Cette publication ne peut pas être affichée ici." });

    safeFetchMock.mockResolvedValueOnce(meta({}, 429));
    const limited = await embedOf(target, "https://www.instagram.com/reel/AUTREcode12/");
    expect(limited.statusCode).toBe(503);
    expect(limited.json()).toEqual({ error: "embed_busy", message: "Le lecteur Instagram est momentanément indisponible." });
  });
});

describe("revue de sécurité : limite par membre des demandes vers Meta (videoEmbedFetch)", () => {
  const HTML = '<blockquote class="instagram-media">Publication (@mode.paris)</blockquote>';
  const meta = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("seules les demandes qui partent vers Meta comptent : 10 codes inventés, puis 429 sans appel ; une vidéo déjà en mémoire reste servie", async () => {
    // Limites actives pour ce test (coupées par défaut sous Vitest) ; un membre à part.
    vi.stubEnv("NODE_ENV", "production");
    const MALLORY = "d0000000-0000-4000-8000-000000000004";
    const target = await buildApp();
    safeFetchMock.mockResolvedValueOnce(meta({ html: HTML }));
    expect((await as(target, BOB).get(`/api/video-links/instagram-embed?url=${encodeURIComponent(REEL)}`)).statusCode).toBe(200);
    safeFetchMock.mockImplementation(async () => meta({ error: { code: 100 } }, 400));
    for (let index = 0; index < 10; index++) {
      const res = await as(target, MALLORY).get(`/api/video-links/instagram-embed?url=${encodeURIComponent(`https://www.instagram.com/reel/FAUX${String(index).padStart(7, "0")}/`)}`);
      expect(res.statusCode).toBe(404);
    }
    expect(safeFetchMock).toHaveBeenCalledTimes(11);
    const refused = await as(target, MALLORY).get(`/api/video-links/instagram-embed?url=${encodeURIComponent("https://www.instagram.com/reel/FAUX0000010/")}`);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "rate_limited", message: "Trop de tentatives en peu de temps. Réessayez dans quelques instants." });
    expect(safeFetchMock).toHaveBeenCalledTimes(11);
    // Réponses gardées en mémoire : servies sans appel, même limite atteinte.
    expect((await as(target, MALLORY).get(`/api/video-links/instagram-embed?url=${encodeURIComponent(REEL)}`)).json()).toEqual({ html: HTML, creatorHandle: "mode.paris" });
    expect((await as(target, MALLORY).get(`/api/video-links/instagram-embed?url=${encodeURIComponent("https://www.instagram.com/reel/FAUX0000003/")}`)).statusCode).toBe(404);
    expect(safeFetchMock).toHaveBeenCalledTimes(11);
  });
});

describe("POST /api/admin/moderation/video-memory/remove : la modération retire une pièce d'une vidéo", () => {
  const remove = (target: FastifyInstance, payload: object, user: string = ALICE) => as(target, user).post("/api/admin/moderation/video-memory/remove", payload);

  it("administrateur : la base reçoit la vidéo et la clé de la pièce ; réponse avec ce qui a été retiré", async () => {
    admin = true;
    const target = await buildApp();
    const res = await remove(target, { url: `${TIKTOK}?_r=1`, productKey: KEY("a") });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: true, items: 2, confirmations: 1 });
    expect(called("video_memory_remove").map((call) => call.args)).toEqual([{ p_platform: "tiktok", p_video_key: ID, p_product_key: KEY("a") }]);
  });

  it("membre ordinaire : 403, rien n'est retiré", async () => {
    const target = await buildApp();
    expect((await remove(target, { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(403);
    expect(called("video_memory_remove")).toEqual([]);
  });

  it("vidéo ou pièce inconnue : 404 ; corps invalide : 400 ; lien qui n'est pas une vidéo : 422 ; réponse inattendue : 500", async () => {
    admin = true;
    const target = await buildApp();
    for (const outcome of ["unknown_video", "unknown_product"]) {
      memory.remove = outcome;
      const res = await remove(target, { url: TIKTOK, productKey: KEY("a") });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "video_product_not_found", message: "Cette pièce n'a pas été repérée dans cette vidéo." });
    }
    for (const payload of [{ url: TIKTOK, productKey: "abc" }, { url: TIKTOK }, { url: TIKTOK, productKey: KEY("a"), userId: BOB }]) {
      expect((await remove(target, payload)).statusCode).toBe(400);
    }
    expect((await remove(target, { url: "https://www.tiktok.com/@scout2015", productKey: KEY("a") })).statusCode).toBe(422);
    memory.remove = "inattendu";
    expect((await remove(target, { url: TIKTOK, productKey: KEY("a") })).statusCode).toBe(500);
  });
});

describe("revue de sécurité : l'export RGPD contient les spots et les confirmations du membre", () => {
  const SOURCE = "70000000-0000-4000-8000-000000000001";
  const OTHER_SEARCH = "50000000-0000-4000-8000-000000000009";

  async function exportApp(): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
    app.decorateRequest("user", null);
    app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
      const id = request.headers["x-test-user"];
      if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
      request.user = { id, email: null };
    });
    await app.register(rateLimitPlugin);
    await app.register(moderationPlugin);
    await app.register(accountRoutes);
    await app.ready();
    return app;
  }

  function seed(): void {
    fake = fakeSupabase({
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "video_memory_version") return { data: memory.version, error: null };
        return { data: null, error: { code: "PGRST202", message: "absente" } };
      },
    });
    fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr" }, { id: BOB, username: "bob", locale: "fr" });
    fake.table("video_sources").push({ id: SOURCE, platform: "tiktok", video_key: ID, canonical_url: TIKTOK, creator_handle: null, spot_count: 2 });
    fake.table("video_spots").push(
      { id: "71000000-0000-4000-8000-000000000001", video_source_id: SOURCE, user_id: ALICE, search_id: SEARCH, source: "tiktok_player", moment_seconds: 72, created_at: "2026-11-12T10:05:00+00:00" },
      { id: "71000000-0000-4000-8000-000000000002", video_source_id: SOURCE, user_id: BOB, search_id: OTHER_SEARCH, source: "share", moment_seconds: null, created_at: "2026-11-12T10:10:00+00:00" }
    );
    // La pièce confirmée par Alice vient du spot de Bob : son nom est lu, jamais le nom de Bob.
    fake.table("product_matches").push({ id: "61000000-0000-4000-8000-000000000001", search_id: OTHER_SEARCH, rank: 1, product_name: "Veste de Bob", merchant_url: "https://boutique.example/veste", created_at: "2026-11-12T10:09:00+00:00" });
    fake.table("video_spot_items").push({ video_spot_id: "71000000-0000-4000-8000-000000000002", product_match_id: "61000000-0000-4000-8000-000000000001", video_source_id: SOURCE, product_key: KEY("a") });
    fake.table("video_item_confirmations").push(
      { user_id: ALICE, video_source_id: SOURCE, product_key: KEY("a"), created_at: "2026-11-12T10:20:00+00:00" },
      { user_id: ALICE, video_source_id: SOURCE, product_key: KEY("e"), created_at: "2026-11-12T10:21:00+00:00" },
      { user_id: BOB, video_source_id: SOURCE, product_key: KEY("a"), created_at: "2026-11-12T10:22:00+00:00" }
    );
  }

  it("ses spots (vidéo, source, moment, date, recherche) et ses confirmations (vidéo, pièce, date), jamais ceux d'un autre membre", async () => {
    seed();
    const body = (await as(await exportApp(), ALICE).get("/api/me/export")).json();
    expect(body.videoSpots).toEqual([{ canonical_url: TIKTOK, source: "tiktok_player", moment_seconds: 72, created_at: "2026-11-12T10:05:00+00:00", search_id: SEARCH }]);
    expect(body.videoConfirmations).toEqual([
      { canonical_url: TIKTOK, product: "Veste de Bob", created_at: "2026-11-12T10:20:00+00:00" },
      // Pièce dont aucun résultat n'est plus rattaché : sa clé « même page ».
      { canonical_url: TIKTOK, product: KEY("e"), created_at: "2026-11-12T10:21:00+00:00" },
    ]);
    expect(JSON.stringify([body.videoSpots, body.videoConfirmations])).not.toContain(BOB);
    // Lisible aussi dans le fichier HTML.
    const page = (await as(app!, ALICE).get("/api/me/export?format=html")).body;
    expect(page).toContain("Vos vidéos spottées");
    expect(page).toContain("Image du lecteur TikTok");
    expect(page).toContain("à 1 min 12 s");
    expect(page).toContain("Veste de Bob");
  });

  it("lu dès 0038, même quand la mémoire est coupée faute de 0039 ; sans 0038 : sections vides", async () => {
    seed();
    memory.version = 1;
    expect((await as(await exportApp(), ALICE).get("/api/me/export")).json().videoSpots).toHaveLength(1);
    await app!.close();
    resetVideoMemoryProbe();
    memory.version = 0;
    const body = (await as(await exportApp(), ALICE).get("/api/me/export")).json();
    expect([body.videoSpots, body.videoConfirmations]).toEqual([[], []]);
  });
});
