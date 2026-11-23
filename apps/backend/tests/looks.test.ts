import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateLookResponse, PublicLook } from "@monapp/shared-types";
import { LOOK_ACTIVE_MAX } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import looksRoutes from "../src/routes/looks.js";
import accountRoutes from "../src/routes/account.js";
import { env } from "../src/env.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { buildLookContent, lookTokenFromLink, newLookToken, publicLookOf, resetLookPagesProbe } from "../src/lib/lookPages.js";
import { parseMatchRows, parseSearchRow, toProductSearch } from "../src/lib/searchRows.js";
import { resetVerdictColumnProbe } from "../src/lib/verdictColumn.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { assertEditableVariable } from "../scripts/lib/render-guard.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// La page look (lot « page look », migration 0057, décisions du fondateur du
// 23 novembre 2026), SANS base ni réseau : les routes sur une fausse base en
// mémoire (tests/fakeSupabase.ts). Le même parcours sur la vraie base de
// développement : pageLookBase.test.ts (sur le Mac, une fois 0057 appliquée).
// Chaque règle : un cas refusé, un cas permis.

// Interrupteur LOOK_PAGES_ENABLED, réglé par chaque test.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, LOOK_PAGES_ENABLED: true } };
});

// Images des boutiques : jamais téléchargées pour de vrai.
const downloads = vi.hoisted(() => ({ images: new Map<string, Buffer>(), calls: [] as string[] }));
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return {
    ...original,
    downloadPublicImage: async (url: string) => {
      downloads.calls.push(url);
      const image = downloads.images.get(url);
      if (!image) throw new original.PublicImageError("Image refusée", 403);
      return image;
    },
  };
});

// Aucun appel payant : chaque fonction des services payants est espionnée.
const paid = vi.hoisted(() => {
  const calls: string[] = [];
  function spied(name: string, module: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(module).map(([key, value]) => {
        if (typeof value !== "function" || /^class\s/.test(Function.prototype.toString.call(value))) return [key, value];
        const original = value as (...args: unknown[]) => unknown;
        return [
          key,
          function (this: unknown, ...args: unknown[]) {
            calls.push(`${name}.${key}`);
            return original.apply(this, args);
          },
        ];
      })
    );
  }
  return { calls, spied };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => paid.spied("serpapi", await importOriginal()));
vi.mock("../src/services/visualSearch.js", async (importOriginal) => paid.spied("visualSearch", await importOriginal()));
vi.mock("../src/services/textSearch.js", async (importOriginal) => paid.spied("textSearch", await importOriginal()));
vi.mock("../src/services/shoppingQueryAi.js", async (importOriginal) => paid.spied("shoppingQueryAi", await importOriginal()));
vi.mock("../src/services/videoMoments.js", async (importOriginal) => paid.spied("videoMoments", await importOriginal()));

const ALICE = "a0000000-0000-4000-8000-000000000001";
const BOB = "b0000000-0000-4000-8000-000000000002";
const ADMIN = "c0000000-0000-4000-8000-000000000003";
const SEARCH = "d0000000-0000-4000-8000-000000000004";
const BOB_SEARCH = "d0000000-0000-4000-8000-000000000005";
const SHARED = "e0000000-0000-4000-8000-000000000001";
const BOB_MATCH = "e0000000-0000-4000-8000-0000000000b1";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

// Ce qui ne doit JAMAIS sortir : la capture du membre, le lien de la vidéo,
// ses mots, son nom d'utilisateur, un signalement.
const SCREENSHOT = `${STORAGE_ORIGIN}/storage/v1/object/public/screenshots/${ALICE}/capture-du-membre.jpg`;
const VIDEO_LINK = "https://www.tiktok.com/@alice.secrete/video/7311111111111111111";
const TYPED_WORDS = "robe pour le mariage de ma soeur Léa";
const USERNAME = "alice_secrete";
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:robe";
const HD = "https://www.zara.com/images/robe-hd.jpg";
const AFFILIATE = "https://partenaire.example/zalando?aff=spotto";

const NOW = Date.now();
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function profile(id: string, username: string): Row {
  return { id, username, display_name: username, avatar_url: null };
}

function searchRow(id: string, userId: string, extra: Row = {}): Row {
  return {
    id,
    user_id: userId,
    source_url: VIDEO_LINK,
    source_platform: "tiktok",
    method: "oembed",
    screenshot_url: SCREENSHOT,
    status: "completed",
    error_message: null,
    query: TYPED_WORDS,
    created_at: hoursAgo(2),
    refused_before_call: 0,
    failure_kind: null,
    provider: "serpapi",
    run_started_at: hoursAgo(2),
    complement_status: "shown",
    shopping_calls: 1,
    lens_from_cache: false,
    served_from_cache: false,
    text_suggested: false,
    text_requested_at: null,
    text_status: null,
    total_seconds: 6,
    complement_deferred: "done",
    complement_deferred_at: hoursAgo(2),
    ...extra,
  };
}

let rank = 0;
function match(id: string, searchId: string, url: string, origin: "lens" | "shopping" | "words", price: number | null, extra: Row = {}): Row {
  rank += 1;
  return {
    id,
    search_id: searchId,
    rank,
    product_name: `Robe portefeuille ${rank}`,
    brand: "Exemplor",
    image_url: `https://images.example.test/${rank}.jpg`,
    image_hd_url: null,
    price_min: price,
    price_max: price === null ? null : price + 40,
    currency: price === null ? null : "EUR",
    merchant_name: null,
    merchant_url: url,
    origin,
    brand_shop: null,
    in_stock: null,
    title_tier: origin === "shopping" ? 0 : null,
    created_at: hoursAgo(2),
    ...extra,
  };
}

/** La recherche d'Alice : la pièce partagée (recherche visuelle), « Cette
 * pièce dans d'autres boutiques » (boutique officielle, boutique connue avec
 * lien affilié, inconnues, un prix inhabituellement bas, une boutique de
 * copies retirée), une autre proposition visuelle et un résultat « vos mots ». */
function aliceMatches(): Row[] {
  rank = 0;
  return [
    match(SHARED, SEARCH, "https://www.zara.com/fr/robe-portefeuille-p1.html", "lens", 49.95, { merchant_name: "Zara", image_url: THUMB, image_hd_url: HD, in_stock: true }),
    match("e0000000-0000-4000-8000-000000000002", SEARCH, "https://autre-boutique.example/robe", "lens", 39, { merchant_name: "Autre visuelle" }),
    match("e0000000-0000-4000-8000-000000000010", SEARCH, "https://boutique-inconnue.example/robe", "shopping", 61, { merchant_name: "Inconnue A", in_stock: false }),
    match("e0000000-0000-4000-8000-000000000011", SEARCH, "https://www.zalando.fr/robe-portefeuille.html", "shopping", 59, { merchant_name: "Zalando", in_stock: true }),
    match("e0000000-0000-4000-8000-000000000012", SEARCH, "https://www.zara.com/fr/robe-p2.html", "shopping", 49.95, { merchant_name: "Zara", brand_shop: true }),
    match("e0000000-0000-4000-8000-000000000013", SEARCH, "https://petits-prix.example/robe", "shopping", 9, { merchant_name: "Petits prix" }),
    match("e0000000-0000-4000-8000-000000000014", SEARCH, "https://replica-robes.example/robe", "shopping", 55, { merchant_name: "Copies" }),
    match("e0000000-0000-4000-8000-000000000015", SEARCH, "https://www.asos.com/fr/robe", "shopping", 64, { merchant_name: null }),
    match("e0000000-0000-4000-8000-000000000016", SEARCH, "javascript:alert(1)", "shopping", 60, { merchant_name: "Lien piégé" }),
    match("e0000000-0000-4000-8000-000000000020", SEARCH, "https://mots.example/robe", "words", 70, { merchant_name: "Vos mots" }),
  ];
}

interface Seed {
  suspended?: string[];
  search?: Row;
}

function seeded(seed: Seed = {}, options: FakeDbOptions = {}) {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profile(ALICE, USERNAME), profile(BOB, "bob"), profile(ADMIN, "admin"));
  fake.table("admins").push({ user_id: ADMIN, created_at: hoursAgo(100) });
  for (const id of seed.suspended ?? []) fake.table("suspensions").push({ user_id: id, moderation_action_id: UNKNOWN });
  fake.table("product_searches").push(searchRow(SEARCH, ALICE, seed.search ?? {}), searchRow(BOB_SEARCH, BOB));
  fake.table("product_matches").push(...aliceMatches(), match(BOB_MATCH, BOB_SEARCH, "https://www.zalando.fr/bob", "lens", 20, { merchant_name: "Zalando" }));
  fake.table("affiliate_links").push({ product_match_id: "e0000000-0000-4000-8000-000000000011", affiliate_url: AFFILIATE });
  // Un signalement d'Alice sur la pièce partagée : jamais copié.
  fake.table("match_feedback").push({ id: UNKNOWN, user_id: ALICE, product_match_id: SHARED, reason: "wrong_price", created_at: hoursAgo(1) });
  return fake;
}

let app: FastifyInstance | null = null;

async function looksApp(db: unknown, logLines?: string[]): Promise<FastifyInstance> {
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
  await app.register(looksRoutes);
  await app.register(accountRoutes);
  await app.ready();
  return app;
}

function as(target: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => target.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => target.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    del: (url: string, payload?: object) => target.inject({ method: "DELETE", url, headers, ...(payload ? { payload } : {}) }),
  };
}

/** Un visiteur sans compte : aucun en-tête d'identité. */
const visit = (target: FastifyInstance, token: string) => target.inject({ method: "GET", url: `/api/looks/public/${token}` });
const tokenOf = (url: string) => lookTokenFromLink(url)!;

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#806040" } }).jpeg().toBuffer();
}

async function withImages() {
  downloads.images.set(HD, await jpeg(900, 1200));
  downloads.images.set(THUMB, await jpeg(180, 240));
}

async function share(target: FastifyInstance, user = ALICE, matchId = SHARED) {
  const res = await as(target, user).post("/api/looks", { matchId });
  return { res, body: res.json() as CreateLookResponse };
}

/** Une page posée directement dans la fausse base (contenu au choix). */
function storedLook(fake: ReturnType<typeof fakeSupabase>, fields: Row = {}): string {
  const token = newLookToken();
  fake.table("shared_looks").push({
    id: crypto.randomUUID(),
    user_id: ALICE,
    search_id: SEARCH,
    match_id: SHARED,
    token,
    content: {
      v: 1,
      searchedOn: "2026-11-20",
      piece: { name: "Robe portefeuille", brand: "Exemplor" },
      verdict: null,
      offers: [{ shop: "Zara", url: "https://www.zara.com/robe", affiliate: false, price: 49.95, currency: "EUR", mark: null, inStock: null, section: "shared" }],
    },
    image_path: null,
    created_at: hoursAgo(1),
    expires_at: new Date(NOW + 29 * 24 * 3_600_000).toISOString(),
    ...fields,
  });
  return token;
}

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetLookPagesProbe();
  resetVerdictColumnProbe();
  env.LOOK_PAGES_ENABLED = true;
  downloads.images.clear();
  downloads.calls.length = 0;
  paid.calls.length = 0;
});

afterEach(async () => {
  process.env.NODE_ENV = originalNodeEnv;
  await app?.close();
  app = null;
});

describe("disponibilité : migration 0057 et interrupteur LOOK_PAGES_ENABLED", () => {
  it("refusé : sans 0057, rien n'est disponible (bouton « Partager » d'aujourd'hui) et rien n'est écrit ; une page publique répond comme inconnue", async () => {
    const fake = seeded({}, { missing: ["shared_looks"] });
    const target = await looksApp(fake.db);
    expect((await as(target, ALICE).get("/api/looks/status")).json()).toEqual({ enabled: false, manage: false });
    const created = await share(target);
    expect(created.res.statusCode).toBe(503);
    expect(created.body).toMatchObject({ error: "look_pages_unavailable" });
    expect((await as(target, ALICE).get("/api/looks")).statusCode).toBe(404);
    expect((await visit(target, newLookToken())).statusCode).toBe(404);
    expect(fake.uploads).toEqual([]);
  });

  it("refusé : interrupteur coupé, aucune création (503) ; permis : la liste et l'arrêt restent possibles", async () => {
    env.LOOK_PAGES_ENABLED = false;
    const fake = seeded();
    const token = storedLook(fake);
    const target = await looksApp(fake.db);
    expect((await as(target, ALICE).get("/api/looks/status")).json()).toEqual({ enabled: false, manage: true });
    expect((await share(target)).res.statusCode).toBe(503);
    expect((await as(target, ALICE).get("/api/looks")).json().looks).toHaveLength(1);
    // Les pages déjà créées restent lisibles jusqu'à leur expiration.
    expect((await visit(target, token)).statusCode).toBe(200);
  });

  it("permis : 0057 et l'interrupteur, la création est disponible", async () => {
    const target = await looksApp(seeded().db);
    expect((await as(target, ALICE).get("/api/looks/status")).json()).toEqual({ enabled: true, manage: true });
  });

  it("l'interrupteur est hors de portée des outils (render-guard) : le fondateur seul le règle", () => {
    for (const service of ["spotto-api", "site"] as const) {
      for (const value of ["true", "false"]) expect(() => assertEditableVariable(service, "LOOK_PAGES_ENABLED", value), `${service} ${value}`).toThrow(/refusée/);
    }
  });
});

describe("créer une page", () => {
  it("permis : sa propre pièce → 201, un lien /look?l=<jeton de 22 signes>, 30 jours", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { res, body } = await share(target);
    expect(res.statusCode).toBe(201);
    expect(body.created).toBe(true);
    expect(body.url).toMatch(/^https:\/\/[^/]+\/look\?l=[A-Za-z0-9_-]{22}$/);
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(fake.table("shared_looks")).toHaveLength(1);
  });

  it("refusé : la pièce d'un autre membre répond exactement comme une pièce inexistante (404), rien n'est écrit", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const other = await share(target, ALICE, BOB_MATCH);
    const missing = await share(target, ALICE, UNKNOWN);
    expect(other.res.statusCode).toBe(404);
    expect(missing.res.statusCode).toBe(404);
    expect(other.res.body).toBe(missing.res.body);
    expect(fake.table("shared_looks")).toEqual([]);
    expect(fake.uploads).toEqual([]);
  });

  it("refusé : un compte suspendu ne crée rien (403) ; permis : le même compte, une fois la suspension levée", async () => {
    const fake = seeded({ suspended: [ALICE] });
    const target = await looksApp(fake.db);
    expect((await share(target)).res.statusCode).toBe(403);
    fake.table("suspensions").length = 0;
    expect((await share(target)).res.statusCode).toBe(201);
  });

  it("refusé (409) : recherche non terminée, boutiques encore attendues, ou plus de 30 jours ; permis : 29 jours", async () => {
    for (const [search, reason] of [
      [{ status: "processing" }, "not_completed"],
      [{ complement_deferred: "pending", complement_deferred_at: new Date().toISOString() }, "shops_pending"],
      [{ created_at: hoursAgo(24 * 31) }, "too_old"],
    ] as const) {
      const target = await looksApp(seeded({ search }).db);
      const { res } = await share(target);
      expect(res.statusCode, reason).toBe(409);
      expect(res.json(), reason).toMatchObject({ error: "look_not_ready", reason });
      await app!.close();
      app = null;
    }
    const target = await looksApp(seeded({ search: { created_at: hoursAgo(24 * 29) } }).db);
    expect((await share(target)).res.statusCode).toBe(201);
  });

  it("refusé : une offre retirée depuis (boutique de copies) ne se partage pas (404) ; permis : une boutique gardée", async () => {
    const target = await looksApp(seeded().db);
    expect((await share(target, ALICE, "e0000000-0000-4000-8000-000000000014")).res.statusCode).toBe(404);
    expect((await share(target, ALICE, "e0000000-0000-4000-8000-000000000011")).res.statusCode).toBe(201);
  });

  it("même pièce deux fois : le même lien (200), sans nouvelle page ni nouvelle copie d'image", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const first = await share(target);
    const second = await share(target);
    expect(first.res.statusCode).toBe(201);
    expect(second.res.statusCode).toBe(200);
    expect(second.body).toEqual({ ...first.body, created: false });
    expect(fake.table("shared_looks")).toHaveLength(1);
    expect(fake.uploads).toHaveLength(1);
  });

  it(`refusé : la ${LOOK_ACTIVE_MAX + 1}e page active (409 look_limit) ; permis : une page expirée ne compte plus, elle est effacée avec sa copie`, async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const tokens = Array.from({ length: LOOK_ACTIVE_MAX }, (_, index) => storedLook(fake, { match_id: `f0000000-0000-4000-8000-${String(index).padStart(12, "0")}` }));
    const limited = await share(target);
    expect(limited.res.statusCode).toBe(409);
    expect(limited.body).toMatchObject({ error: "look_limit" });
    // L'une expire : effacée à la création suivante, avec la copie de son image.
    const expiredPath = "looks/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.jpg";
    const expired = fake.table("shared_looks").find((row) => row.token === tokens[0])!;
    Object.assign(expired, { expires_at: new Date(Date.now() - 1000).toISOString(), image_path: expiredPath });
    fake.files.set(`post-media/${expiredPath}`, Buffer.alloc(1));
    expect((await share(target)).res.statusCode).toBe(201);
    expect(fake.table("shared_looks").some((row) => row.token === tokens[0])).toBe(false);
    expect(fake.removed).toContain(`post-media/${expiredPath}`);
  });
});

describe("l'image : une copie de 480 px faite par le serveur, jamais l'image de la boutique", () => {
  it("permis : copie réussie → post-media/looks/<uuid>.jpg (rien du membre dans l'adresse), 480 px au plus", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]).toMatch(/^post-media\/looks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
    expect(fake.uploads[0]).not.toContain(ALICE);
    const meta = await sharp(fake.files.get(fake.uploads[0]!)!).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(480);
    const page = (await visit(target, tokenOf(body.url))).json() as PublicLook;
    expect(page.piece.image).toBe(`${STORAGE_ORIGIN}/storage/v1/object/public/${fake.uploads[0]}`);
  });

  it("refusé : copie impossible → page créée sans image, jamais l'adresse de l'image de la boutique", async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const { res, body } = await share(target);
    expect(res.statusCode).toBe(201);
    expect(fake.uploads).toEqual([]);
    const page = await visit(target, tokenOf(body.url));
    expect(page.json().piece.image).toBeNull();
    expect(page.body).not.toContain(THUMB);
    expect(page.body).not.toContain(HD);
    expect(page.body).not.toContain("images.example.test");
  });
});

describe("rien de personnel : la page est construite depuis une liste fixe", () => {
  const SECRETS = [SCREENSHOT, "capture-du-membre", VIDEO_LINK, "tiktok.com", TYPED_WORDS, USERNAME, ALICE, SEARCH, SHARED, UNKNOWN, "wrong_price", "feedbackReason"];
  const PUBLIC_KEYS = ["expiresOn", "offers", "piece", "searchedOn", "v", "verdict"];
  const OFFER_KEYS = ["affiliate", "currency", "inStock", "mark", "price", "section", "shop", "url"];

  it("refusé : une page enregistrée piégée (capture, lien de la vidéo, mots tapés, identifiants, nom d'utilisateur) ne laisse rien sortir de tout cela", async () => {
    const fake = seeded();
    const trap = { screenshot_url: SCREENSHOT, screenshotUrl: SCREENSHOT, sourceUrl: VIDEO_LINK, source_url: VIDEO_LINK, query: TYPED_WORDS, userId: ALICE, user_id: ALICE, searchId: SEARCH, matchId: SHARED, id: UNKNOWN, username: USERNAME, feedbackReason: "wrong_price" };
    const token = storedLook(fake, {
      content: {
        v: 1,
        searchedOn: "2026-11-20",
        ...trap,
        piece: { name: "Robe portefeuille", brand: null, ...trap, image: SCREENSHOT },
        verdict: { level: "close", ...trap },
        offers: [
          { shop: "Zara", url: "https://www.zara.com/robe", affiliate: false, price: 49.95, priceMax: 89.95, currency: "EUR", mark: "known_shop", inStock: true, section: "shared", ...trap },
          { shop: "Zalando", url: "https://www.zalando.fr/robe", affiliate: true, price: 59, currency: "EUR", mark: null, inStock: null, section: "shopping", ...trap },
        ],
      },
      // Une image rangée ailleurs (le dossier d'un membre) : jamais servie.
      image_path: `${BOB}/look-0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.jpg`,
    });
    const target = await looksApp(fake.db);
    const res = await visit(target, token);
    expect(res.statusCode).toBe(200);
    for (const secret of [...SECRETS, BOB, "priceMax", "89.95"]) expect(res.body, secret).not.toContain(secret);
    const page = res.json() as PublicLook;
    expect(Object.keys(page).sort()).toEqual(PUBLIC_KEYS);
    expect(Object.keys(page.piece).sort()).toEqual(["brand", "image", "name"]);
    expect(page.piece.image).toBeNull();
    expect(Object.keys(page.verdict!)).toEqual(["level"]);
    for (const offer of page.offers) expect(Object.keys(offer).sort()).toEqual(OFFER_KEYS);
  });

  it("permis : la page créée depuis un vrai résultat ne copie que ce qu'une boutique montre déjà ; la réponse publique non plus", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const stored = JSON.stringify(fake.table("shared_looks")[0]!.content);
    for (const secret of SECRETS) expect(stored, secret).not.toContain(secret);
    const res = await visit(target, tokenOf(body.url));
    for (const secret of SECRETS) expect(res.body, secret).not.toContain(secret);
    expect(res.body).not.toMatch(/priceMax|price_max|user_id|username|display_name|avatar/);
    expect(Object.keys(res.json()).sort()).toEqual(PUBLIC_KEYS);
  });

  it("refusé : une page illisible (version inconnue, lien javascript:, section inconnue) répond comme une page inconnue", async () => {
    const fake = seeded();
    const base = { v: 1, searchedOn: "2026-11-20", piece: { name: "Robe", brand: null }, verdict: null };
    const offer = { shop: "Zara", url: "https://www.zara.com/robe", affiliate: false, price: 10, currency: "EUR", mark: null, inStock: null, section: "shared" };
    const tokens = [
      storedLook(fake, { match_id: UNKNOWN, content: { ...base, v: 2, offers: [offer] } }),
      storedLook(fake, { match_id: BOB_MATCH, content: { ...base, offers: [{ ...offer, url: "javascript:alert(1)" }] } }),
      storedLook(fake, { match_id: SEARCH, content: { ...base, offers: [{ ...offer, section: "words" }] } }),
    ];
    const target = await looksApp(fake.db);
    const unknown = await visit(target, newLookToken());
    for (const token of tokens) {
      const res = await visit(target, token);
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(unknown.body);
    }
  });
});

describe("une seule réponse pour une page arrêtée, expirée, inconnue, d'un compte suspendu ou supprimé", () => {
  it("refusé : chacun de ces cas donne exactement le même 404 ; permis : une page active", async () => {
    const fake = seeded();
    const active = storedLook(fake);
    const expired = storedLook(fake, { match_id: BOB_MATCH, expires_at: new Date(Date.now() - 1000).toISOString() });
    const target = await looksApp(fake.db);
    const ok = await visit(target, active);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(ok.headers["cache-control"]).toBe("no-store");

    const unknown = await visit(target, newLookToken());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "look_not_found", message: "Cette page n'est plus disponible." });
    const answers = [await visit(target, expired), await visit(target, "mal-forme"), await visit(target, `${active}x`), await visit(target, active.slice(1))];

    // Arrêtée par son auteur.
    const stoppedFake = seeded();
    await withImages();
    await app!.close();
    const stoppedApp = await looksApp(stoppedFake.db);
    const created = await share(stoppedApp);
    const stoppedToken = tokenOf(created.body.url);
    expect((await visit(stoppedApp, stoppedToken)).statusCode).toBe(200);
    expect((await as(stoppedApp, ALICE).del(`/api/looks/${created.body.id}`)).statusCode).toBe(204);
    answers.push(await visit(stoppedApp, stoppedToken));
    // Compte suspendu, puis compte supprimé (profil parti).
    stoppedFake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    const suspendedToken = storedLook(stoppedFake, { match_id: UNKNOWN });
    answers.push(await visit(stoppedApp, suspendedToken));
    stoppedFake.table("suspensions").length = 0;
    expect((await visit(stoppedApp, suspendedToken)).statusCode).toBe(200);
    stoppedFake.tables.set("profiles", stoppedFake.table("profiles").filter((row) => row.id !== ALICE));
    answers.push(await visit(stoppedApp, suspendedToken));

    for (const answer of answers) {
      expect(answer.statusCode).toBe(404);
      expect(answer.body).toBe(unknown.body);
    }
  });

  it("expirée dès la seconde d'expiration : refusée à l'instant passé, permise une minute avant", async () => {
    const fake = seeded();
    const soon = storedLook(fake, { expires_at: new Date(Date.now() + 60_000).toISOString() });
    const past = storedLook(fake, { match_id: BOB_MATCH, expires_at: new Date(Date.now() - 1).toISOString() });
    const target = await looksApp(fake.db);
    expect((await visit(target, soon)).statusCode).toBe(200);
    expect((await visit(target, past)).statusCode).toBe(404);
  });
});

describe("arrêter et lister : seulement ses propres pages", () => {
  it("refusé : un autre membre ne peut ni arrêter (404, la page reste lisible) ni voir la page d'Alice dans sa liste", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const bobDelete = await as(target, BOB).del(`/api/looks/${body.id}`);
    const unknownDelete = await as(target, BOB).del(`/api/looks/${UNKNOWN}`);
    expect(bobDelete.statusCode).toBe(404);
    expect(bobDelete.body).toBe(unknownDelete.body);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(200);
    expect(fake.removed).toEqual([]);
    expect((await as(target, BOB).get("/api/looks")).json()).toEqual({ looks: [] });
  });

  it("permis : le propriétaire liste puis arrête sa page (204) : ligne supprimée, copie effacée, lien mort pour tous", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const list = (await as(target, ALICE).get("/api/looks")).json();
    expect(list.looks).toEqual([{ id: body.id, url: body.url, title: "Robe portefeuille 1", createdAt: expect.any(String), expiresAt: body.expiresAt }]);
    expect((await as(target, ALICE).del(`/api/looks/${body.id}`)).statusCode).toBe(204);
    expect(fake.table("shared_looks")).toEqual([]);
    expect(fake.removed).toEqual(fake.uploads);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
    expect((await as(target, ALICE).get("/api/looks")).json()).toEqual({ looks: [] });
  });

  it("modération : un non-administrateur reçoit 404 ; un administrateur arrête la page, et le journal ne note jamais le jeton", async () => {
    const lines: string[] = [];
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db, lines);
    const { body } = await share(target);
    const token = tokenOf(body.url);
    expect((await as(target, BOB).post("/api/admin/looks/stop", { link: body.url })).statusCode).toBe(404);
    expect((await visit(target, token)).statusCode).toBe(200);
    expect((await as(target, ADMIN).post("/api/admin/looks/stop", { link: `  ${body.url}  ` })).statusCode).toBe(204);
    expect((await visit(target, token)).statusCode).toBe(404);
    expect(fake.removed).toEqual(fake.uploads);
    expect(lines.join("\n")).not.toContain(token);
    expect(lines.join("\n")).toContain("Page look arrêtée par la modération");
    expect((await as(target, ADMIN).post("/api/admin/looks/stop", { link: "https://exemple.com/autre" })).statusCode).toBe(400);
  });
});

describe("la copie publique ne survit pas à sa page", () => {
  it("permis : les pages expirées d'un autre membre (qui ne revient pas) partent avec leur copie quand un membre liste ou ouvre le statut ; refusé : sa page active reste", async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const bobPath = "looks/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b.jpg";
    const bobExpired = storedLook(fake, { user_id: BOB, search_id: BOB_SEARCH, match_id: BOB_MATCH, image_path: bobPath, expires_at: new Date(Date.now() - 1000).toISOString() });
    const bobActive = storedLook(fake, { user_id: BOB, search_id: BOB_SEARCH, match_id: SHARED });
    fake.files.set(`post-media/${bobPath}`, Buffer.alloc(1));
    expect((await as(target, ALICE).get("/api/looks")).statusCode).toBe(200);
    expect(fake.table("shared_looks").map((row) => row.token)).toEqual([bobActive]);
    expect(fake.removed).toContain(`post-media/${bobPath}`);
    expect(fake.table("shared_looks").some((row) => row.token === bobExpired)).toBe(false);
    // Le statut aussi (sans faire attendre sa réponse).
    const later = storedLook(fake, { user_id: BOB, search_id: BOB_SEARCH, match_id: BOB_MATCH, expires_at: new Date(Date.now() - 1000).toISOString() });
    expect((await as(target, ALICE).get("/api/looks/status")).statusCode).toBe(200);
    await vi.waitFor(() => expect(fake.table("shared_looks").some((row) => row.token === later)).toBe(false));
    expect(fake.table("shared_looks").map((row) => row.token)).toEqual([bobActive]);
  });

  it("stockage qui refuse : permis, la page s'arrête quand même tout de suite ; refusé, la copie n'est pas oubliée : elle est effacée au passage suivant", async () => {
    let storageDown = true;
    const fake = seeded({}, { failStorageRemove: () => storageDown });
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const token = tokenOf(body.url);
    const copy = fake.uploads[0]!;
    expect((await as(target, ALICE).del(`/api/looks/${body.id}`)).statusCode).toBe(204);
    expect((await visit(target, token)).statusCode).toBe(404);
    expect((await as(target, ALICE).get("/api/looks")).json()).toEqual({ looks: [] });
    // La ligne reste, expirée, tant que la copie n'est pas effacée.
    expect(fake.table("shared_looks")).toHaveLength(1);
    expect(fake.files.has(copy)).toBe(true);
    storageDown = false;
    expect((await as(target, BOB).get("/api/looks")).statusCode).toBe(200);
    expect(fake.files.has(copy)).toBe(false);
    expect(fake.table("shared_looks")).toEqual([]);
  });

  it("même milliseconde : une page arrêtée pendant que le stockage refusait est reprise par le passage suivant, même s'il tombe au même instant (horloge figée)", async () => {
    let storageDown = true;
    const fake = seeded({}, { failStorageRemove: () => storageDown });
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const copy = fake.uploads[0]!;
    // Seule la date est figée (les minuteries restent réelles) : l'arrêt et le passage suivant ont lieu au même instant.
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    try {
      expect((await as(target, ALICE).del(`/api/looks/${body.id}`)).statusCode).toBe(204);
      // Refusé : la page arrêtée n'est plus servie, et sa copie n'est pas oubliée.
      expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
      expect(fake.table("shared_looks")).toHaveLength(1);
      expect(fake.files.has(copy)).toBe(true);
      storageDown = false;
      // Permis : le passage d'un autre membre, au même instant, efface la copie et la ligne.
      expect((await as(target, BOB).get("/api/looks")).statusCode).toBe(200);
      expect(fake.files.has(copy)).toBe(false);
      expect(fake.table("shared_looks")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refusé : page arrêtée pendant que le stockage refuse, la même pièce repartagée → 503 « réessayez plus tard » (jamais 500), aucune nouvelle copie, l'ancienne copie gardée avec sa ligne", async () => {
    const fake = seeded({}, { failStorageRemove: () => true });
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const copy = fake.uploads[0]!;
    expect((await as(target, ALICE).del(`/api/looks/${body.id}`)).statusCode).toBe(204);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const again = await share(target);
      expect(again.res.statusCode).toBe(503);
      expect(again.body).toMatchObject({ error: "look_retry_later" });
    }
    expect(fake.uploads).toEqual([copy]);
    expect(fake.table("shared_looks")).toHaveLength(1);
    expect(fake.files.has(copy)).toBe(true);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
  });

  it("permis : page arrêtée pendant que le stockage refusait, puis le stockage accepte au moment du repartage → l'ancienne copie et sa ligne partent, nouvelle page (201)", async () => {
    let refusals = 1;
    const fake = seeded({}, { failStorageRemove: () => refusals-- > 0 });
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const copy = fake.uploads[0]!;
    expect((await as(target, ALICE).del(`/api/looks/${body.id}`)).statusCode).toBe(204);
    expect(fake.table("shared_looks")).toHaveLength(1);
    // Arrêtée une seconde plus tôt (pas dans la même milliseconde que le repartage : la purge la voit expirée).
    fake.table("shared_looks")[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    // La purge du repartage est encore refusée, l'essai suivant (la place de la pièce) passe.
    refusals = 1;
    const again = await share(target);
    expect(again.res.statusCode).toBe(201);
    expect(again.body.created).toBe(true);
    expect(again.body.url).not.toBe(body.url);
    expect(fake.files.has(copy)).toBe(false);
    expect(fake.table("shared_looks")).toHaveLength(1);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
    expect((await visit(target, tokenOf(again.body.url))).statusCode).toBe(200);
  });

  it("modération, stockage qui refuse : la page s'arrête quand même", async () => {
    const fake = seeded({}, { failStorageRemove: () => true });
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    expect((await as(target, ADMIN).post("/api/admin/looks/stop", { link: body.url })).statusCode).toBe(204);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
  });
});

describe("aucun appel payant, et la lecture n'écrit rien", () => {
  it("créer, lister, lire, arrêter : zéro appel à SerpApi, Google, l'IA ; aucune requête réseau hors de l'image copiée", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const fake = seeded();
      await withImages();
      const target = await looksApp(fake.db);
      const { body } = await share(target);
      await as(target, ALICE).get("/api/looks");
      await visit(target, tokenOf(body.url));
      await as(target, ALICE).del(`/api/looks/${body.id}`);
      expect(paid.calls).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Seules les images de la pièce ont été demandées (faux téléchargement, garde-fous de publicImage).
      expect(downloads.calls.sort()).toEqual([HD, THUMB].sort());
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("le code de la page n'importe aucun service payant", () => {
    for (const file of ["src/routes/looks.ts", "src/lib/lookPages.ts"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'][^"']*services\//);
    }
  });

  it("refusé : une lecture publique n'écrit rien — ni ligne, ni fichier, pas même la purge d'une page expirée ; permis : la purge à la liste du membre", async () => {
    const fake = seeded();
    const active = storedLook(fake);
    const expired = storedLook(fake, { match_id: BOB_MATCH, expires_at: new Date(Date.now() - 1000).toISOString() });
    const target = await looksApp(fake.db);
    const writes: string[] = [];
    const from = fake.db.from;
    fake.db.from = ((table: string) => {
      const chain = from(table);
      for (const action of ["insert", "upsert", "update", "delete"] as const) {
        const original = chain[action] as (...args: unknown[]) => unknown;
        (chain as Record<string, unknown>)[action] = (...args: unknown[]) => {
          writes.push(`${table}.${action}`);
          return original(...args);
        };
      }
      return chain;
    }) as typeof fake.db.from;
    const snapshot = () => JSON.stringify([...fake.tables].filter(([, rows]) => rows.length > 0));
    const before = snapshot();
    await visit(target, active);
    await visit(target, expired);
    await visit(target, newLookToken());
    expect(writes).toEqual([]);
    expect(snapshot()).toBe(before);
    expect(fake.uploads).toEqual([]);
    expect(fake.removed).toEqual([]);
    await as(target, ALICE).get("/api/looks");
    expect(writes).toEqual(["shared_looks.delete"]);
  });
});

describe("limite de débit commune et pas d'énumération", () => {
  it("refusé : au-delà de la limite commune, tout visiteur reçoit 429, quel que soit le jeton ; permis : jusqu'à la limite", async () => {
    process.env.NODE_ENV = "development";
    const rule = RATE_LIMITS.lookPublicGlobal;
    expect(rule.scope).toBe("global");
    const fake = seeded();
    const token = storedLook(fake);
    const target = await looksApp(fake.db);
    for (let index = 0; index < rule.max; index += 1) {
      const res = await visit(target, index % 2 === 0 ? token : newLookToken());
      expect(res.statusCode).not.toBe(429);
    }
    const blocked = await visit(target, token);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Même un membre connecté, ou un jeton mal formé : la limite est commune.
    expect((await target.inject({ method: "GET", url: `/api/looks/public/${token}`, headers: { "x-test-user": BOB } })).statusCode).toBe(429);
    expect((await visit(target, "x")).statusCode).toBe(429);
  });

  it("refusé : un jeton mal formé est rejeté sans lire la base ; permis : un jeton bien formé fait une lecture exacte, jamais une liste", async () => {
    const fake = seeded();
    storedLook(fake);
    const target = await looksApp(fake.db);
    await visit(target, newLookToken()); // la sonde du schéma, une fois
    const reads: string[] = [];
    const from = fake.db.from;
    fake.db.from = ((table: string) => {
      reads.push(table);
      return from(table);
    }) as typeof fake.db.from;
    for (const bad of ["abc", "A".repeat(21), "A".repeat(23), "%2A%2A%2A%2A%2A%2A%2A%2A%2A%2A%2A", "AAAAAAAAAAAAAAAAAAAAA%25"]) {
      expect((await visit(target, bad)).statusCode).toBe(404);
    }
    expect(reads).toEqual([]);
    await visit(target, newLookToken());
    expect(reads).toEqual(["shared_looks"]);
    const source = readFileSync(join(__dirname, "../src/routes/looks.ts"), "utf8");
    const publicRoute = source.slice(source.indexOf('"/api/looks/public/:token"'), source.indexOf("const EXISTING_ROWS"));
    expect(publicRoute).toContain('.eq("token", token).maybeSingle()');
    expect(publicRoute).not.toMatch(/\.(like|ilike|gt|gte|lt|order|range)\(/);
  });

  it("le jeton : 22 signes aléatoires (128 bits), jamais deux fois le même", () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => newLookToken()));
    expect(tokens.size).toBe(2000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("la page montre exactement ce que le membre voyait", () => {
  async function created(options: FakeDbOptions = {}) {
    const fake = seeded({}, options);
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const page = (await visit(target, tokenOf(body.url))).json() as PublicLook;
    return { fake, page };
  }

  /** L'écran du membre : la recherche relue comme GET /api/searches/:id. */
  function screenOf(fake: ReturnType<typeof fakeSupabase>, verdict: boolean) {
    const row = parseSearchRow(fake.table("product_searches").find((search) => search.id === SEARCH))!;
    const rows = parseMatchRows(fake.table("product_matches").filter((m) => m.search_id === SEARCH))!;
    return toProductSearch(row, rows, new Map([["e0000000-0000-4000-8000-000000000011", AFFILIATE]]), new Map(), false, { verdict });
  }

  it("permis : même ordre, mêmes mentions, même stock que « Cette pièce dans d'autres boutiques », la pièce partagée d'abord", async () => {
    const { fake, page } = await created();
    const screen = screenOf(fake, true);
    const shopping = screen.matches.filter((m) => m.origin === "shopping" && m.merchantUrl.startsWith("http"));
    expect(page.offers[0]).toMatchObject({ shop: "Zara", section: "shared", price: 49.95, currency: "EUR", inStock: true });
    expect(page.offers.slice(1).map((offer) => [offer.url, offer.mark, offer.inStock])).toEqual(shopping.map((m) => [m.affiliateUrl, m.offerMark ?? null, m.inStock ?? null]));
    // La boutique officielle de la marque en tête, le prix inhabituellement bas à la fin.
    expect(page.offers[1]).toMatchObject({ shop: "Zara", mark: "official_shop" });
    expect(page.offers.at(-1)).toMatchObject({ shop: "Petits prix", mark: "unusual_price" });
    expect(page.offers.find((offer) => offer.shop === "Zalando")).toMatchObject({ mark: "known_shop", inStock: true });
    // Nom de site quand la boutique n'a pas de nom.
    expect(page.offers.map((offer) => offer.shop)).toContain("asos.com");
  });

  it("refusé : ni l'offre retirée (boutique de copies), ni un lien non web, ni « Autres propositions », ni « vos mots »", async () => {
    const { page } = await created();
    const shops = page.offers.map((offer) => offer.shop);
    for (const absent of ["Copies", "Lien piégé", "Autre visuelle", "Vos mots"]) expect(shops).not.toContain(absent);
    expect(JSON.stringify(page)).not.toMatch(/replica|javascript:|mots\.example|autre-boutique/);
    expect(page.offers.length).toBeLessThanOrEqual(10);
  });

  it("au plus 9 boutiques après la pièce partagée", () => {
    const row = parseSearchRow(searchRow(SEARCH, ALICE))!;
    const many = Array.from({ length: 15 }, (_, index) => match(`e0000000-0000-4000-8000-1000000000${String(index).padStart(2, "0")}`, SEARCH, `https://shop-${index}.example/robe`, "shopping", 50 + index));
    const search = toProductSearch(row, parseMatchRows([...aliceMatches().slice(0, 1), ...many])!, new Map(), new Map());
    const content = buildLookContent(search, SHARED)!;
    expect(content.offers).toHaveLength(10);
    expect(content.offers.slice(1).map((offer) => offer.url)).toEqual(search.matches.filter((m) => m.origin === "shopping").slice(0, 9).map((m) => m.affiliateUrl));
  });

  it("pièce identifiée (première visuelle) : permis, ses boutiques et le verdict ; autre proposition visuelle : refusé, ni boutiques ni verdict", async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const identified = (await visit(target, tokenOf((await share(target)).body.url))).json() as PublicLook;
    expect(identified.offers.length).toBeGreaterThan(1);
    expect(identified.verdict).not.toBeNull();
    const lookalike = await share(target, ALICE, "e0000000-0000-4000-8000-000000000002");
    expect(lookalike.res.statusCode).toBe(201);
    const page = (await visit(target, tokenOf(lookalike.body.url))).json() as PublicLook;
    expect(page.offers).toEqual([expect.objectContaining({ shop: "Autre visuelle", section: "shared" })]);
    expect(page.verdict).toBeNull();
  });

  it("pièce de « Cette pièce dans d'autres boutiques » : permis, les autres boutiques et le verdict", async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const { res, body } = await share(target, ALICE, "e0000000-0000-4000-8000-000000000011");
    expect(res.statusCode).toBe(201);
    const page = (await visit(target, tokenOf(body.url))).json() as PublicLook;
    expect(page.offers[0]).toMatchObject({ shop: "Zalando", section: "shared" });
    expect(page.offers.slice(1).map((offer) => offer.shop)).not.toContain("Zalando");
    expect(page.offers.length).toBeGreaterThan(1);
    expect(page.verdict).not.toBeNull();
  });

  it("refusé : une pièce de « Résultats pour vos mots » ne se partage pas (409 words_piece), rien n'est écrit", async () => {
    const fake = seeded();
    const target = await looksApp(fake.db);
    const { res, body } = await share(target, ALICE, "e0000000-0000-4000-8000-000000000020");
    expect(res.statusCode).toBe(409);
    expect(body).toMatchObject({ error: "look_not_ready", reason: "words_piece" });
    expect(fake.table("shared_looks")).toEqual([]);
    expect(fake.uploads).toEqual([]);
  });

  it("liens de plus de 2 048 caractères : refusé, l'offre est écartée (la pièce partagée : pas de page) ; permis, le reste de la page se lit", async () => {
    const long = `https://longue.example/robe?${"x".repeat(2100)}`;
    const fake = seeded();
    fake.table("product_matches").push(match("e0000000-0000-4000-8000-000000000030", SEARCH, long, "shopping", 58, { merchant_name: "Lien long" }));
    const target = await looksApp(fake.db);
    const { res, body } = await share(target);
    expect(res.statusCode).toBe(201);
    const visited = await visit(target, tokenOf(body.url));
    expect(visited.statusCode).toBe(200);
    expect((visited.json() as PublicLook).offers.map((offer) => offer.shop)).not.toContain("Lien long");
    // La pièce partagée elle-même : pas de page plutôt qu'une page que personne ne pourrait ouvrir.
    const row = parseSearchRow(searchRow(SEARCH, ALICE))!;
    const search = toProductSearch(row, parseMatchRows([match(SHARED, SEARCH, long, "lens", 40, { merchant_name: "Lien long" })])!, new Map(), new Map());
    expect(buildLookContent(search, SHARED)).toBeNull();
  });

  it("page trop lourde pour la base (16 Ko) : refusé, les dernières boutiques sont retirées ; permis, la page reste lisible", () => {
    const row = parseSearchRow(searchRow(SEARCH, ALICE))!;
    const heavy = Array.from({ length: 9 }, (_, index) =>
      match(`e0000000-0000-4000-8000-2000000000${String(index).padStart(2, "0")}`, SEARCH, `https://shop-${index}.example/robe?${"y".repeat(2000)}`, "shopping", 50 + index)
    );
    const search = toProductSearch(row, parseMatchRows([...aliceMatches().slice(0, 1), ...heavy])!, new Map(), new Map());
    const content = buildLookContent(search, SHARED)!;
    expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(15_000);
    expect(content.offers.length).toBeGreaterThan(1);
    expect(content.offers.length).toBeLessThan(10);
    expect(content.offers[0]!.section).toBe("shared");
    expect(publicLookOf({ user_id: ALICE, content, image_path: null, expires_at: new Date(NOW + 86_400_000).toISOString() }, (path) => path)).not.toBeNull();
  });

  it("permis : la phrase du verdict est celle de l'écran ; refusé : pas de verdict quand l'écran n'en a pas (base sans 0055)", async () => {
    const withVerdict = await created();
    const screen = screenOf(withVerdict.fake, true);
    expect(screen.verdict).toBeDefined();
    expect(withVerdict.page.verdict).toEqual(screen.verdict);
    await app!.close();
    app = null;
    resetLookPagesProbe();
    resetVerdictColumnProbe();
    const without = await created({ missingColumns: { product_matches: ["title_tier"] } });
    expect(without.page.verdict).toBeNull();
  });

  it("prix datés, chacun dans sa devise, jamais un prix barré ni un « prix de référence »", async () => {
    const { page } = await created();
    expect(page.searchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(page.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const offer of page.offers) {
      if (offer.price === null) expect(offer.currency).toBeNull();
      else expect(offer.currency).toBe("EUR");
    }
    expect(JSON.stringify(page)).not.toMatch(/priceMax|price_max|compareAt|reference|T\d{2}:\d{2}/);
  });

  it("« Lien affilié » : permis sur l'offre au lien affilié, refusé sur les autres", async () => {
    const { page } = await created();
    const zalando = page.offers.find((offer) => offer.shop === "Zalando")!;
    expect(zalando).toMatchObject({ affiliate: true, url: AFFILIATE });
    expect(page.offers.filter((offer) => offer.affiliate)).toHaveLength(1);
  });

  it("publicLookOf : une liste fixe de champs, même devant une version future ou des champs en trop", () => {
    const look = publicLookOf(
      {
        user_id: ALICE,
        image_path: "looks/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.jpg",
        expires_at: "2026-12-23T10:00:00.000Z",
        content: { v: 1, searchedOn: "2026-11-23", piece: { name: "Robe", brand: null, query: TYPED_WORDS }, verdict: null, offers: [{ shop: "Zara", url: "https://zara.com", affiliate: false, price: null, currency: "EUR", mark: null, inStock: null, section: "shared", sourceUrl: VIDEO_LINK }] },
      },
      (path) => `https://stockage.test/${path}`
    )!;
    expect(look.expiresOn).toBe("2026-12-23");
    expect(look.offers[0]!.currency).toBeNull();
    expect(JSON.stringify(look)).not.toMatch(/tiktok|soeur/);
    expect(look.piece.image).toBe("https://stockage.test/looks/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f.jpg");
  });
});

describe("export des données et suppression du compte", () => {
  it("permis : l'export contient ses pages (contenu, lien, copie de l'image, dates) ; refusé : jamais la page d'un autre membre", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    storedLook(fake, { user_id: BOB, search_id: BOB_SEARCH, match_id: BOB_MATCH, content: { v: 1, searchedOn: "2026-11-20", piece: { name: "Page de Bob", brand: null }, verdict: null, offers: [] } });
    const exported = (await as(target, ALICE).get("/api/me/export")).json();
    expect(exported.sharedLooks).toEqual([
      {
        id: body.id,
        url: body.url,
        content: fake.table("shared_looks")[0]!.content,
        image_url: `${STORAGE_ORIGIN}/storage/v1/object/public/${fake.uploads[0]}`,
        created_at: expect.any(String),
        expires_at: body.expiresAt,
      },
    ]);
    expect(JSON.stringify(exported.sharedLooks)).not.toContain("Page de Bob");
    const readable = (await as(target, ALICE).get("/api/me/export?format=html")).body;
    expect(readable).toContain("Vos pages look partagées");
    expect(readable).toContain("Robe portefeuille 1");
  });

  it("refusé sans 0057 : section vide, l'export marche quand même", async () => {
    const target = await looksApp(seeded({}, { missing: ["shared_looks"] }).db);
    const res = await as(target, ALICE).get("/api/me/export");
    expect(res.statusCode).toBe(200);
    expect(res.json().sharedLooks).toEqual([]);
  });

  it("permis : suppression du compte → ses pages et la copie de leur image (post-media/looks/<uuid>.jpg) sont effacées ; refusé : la page d'un autre membre reste", async () => {
    const fake = seeded();
    await withImages();
    const target = await looksApp(fake.db);
    const { body } = await share(target);
    const bobPath = "looks/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b.jpg";
    const bobToken = storedLook(fake, { user_id: BOB, search_id: BOB_SEARCH, match_id: BOB_MATCH, image_path: bobPath });
    fake.files.set(`post-media/${bobPath}`, Buffer.alloc(1));
    const copy = fake.uploads[0]!;
    expect(copy).toMatch(/^post-media\/looks\//);
    expect((await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" })).statusCode).toBe(204);
    expect(fake.files.has(copy)).toBe(false);
    expect(fake.removed).toContain(copy);
    expect(fake.table("shared_looks").map((row) => row.user_id)).toEqual([BOB]);
    expect(fake.files.has(`post-media/${bobPath}`)).toBe(true);
    expect((await visit(target, tokenOf(body.url))).statusCode).toBe(404);
    expect((await visit(target, bobToken)).statusCode).toBe(200);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });

  it("arrêt d'urgence de 0057 (lecture refusée au serveur déjà lancé) : le compte est supprimé quand même, refusé : aucune réponse 500", async () => {
    const options: FakeDbOptions = {};
    const fake = seeded({}, options);
    await withImages();
    const target = await looksApp(fake.db);
    // Permis avant l'arrêt : la page est créée (la sonde a vu la table).
    const { res } = await share(target);
    expect(res.statusCode).toBe(201);
    // L'arrêt : la table ne se lit plus (revoke select … from service_role).
    options.missing = ["shared_looks"];
    const deleted = await as(target, ALICE).del("/api/me", { confirmation: "SUPPRIMER" });
    expect(deleted.statusCode).toBe(204);
    expect(fake.deletedUsers).toEqual([ALICE]);
  });
});
