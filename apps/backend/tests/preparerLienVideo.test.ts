import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// Liens vidéo (12 novembre 2026) : la voie « couverture » est retirée. Ce que
// font « préparer » et « lancer » d'un lien TikTok ou Instagram, sans base
// (fausse base en mémoire, tests/fakeSupabase.ts) et sans aucun réseau :
// - « préparer » ne garde du lien que l'adresse publique de la vidéo et sa
//   plateforme, lues dans l'adresse elle-même ; aucune demande ne part ;
// - « lancer » n'analyse que l'image importée par la personne ;
// - aucune réponse ne porte l'adresse d'une image d'une plateforme.
// « Aucune demande ne part » se vérifie pour de bon : safeFetch (la porte de
// sortie des appels du serveur) ET fetch lui-même sont surveillés. Google
// Lens, le plafond, le disjoncteur et le cache sont simulés. Liens et images
// fictifs.
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});
vi.mock("../src/lib/searchBreaker.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchBreaker.js")>();
  return { ...original, breakerPause: vi.fn(async () => null), observeBreakerAfter: vi.fn(async () => undefined) };
});
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, readCache: vi.fn(async () => null), writeCache: vi.fn(async () => undefined), purgeExpiredCache: vi.fn(async () => undefined) };
});

import { safeFetch } from "../src/lib/safeFetch.js";
import searchesRoutes from "../src/routes/searches.js";
import { searchProductsByImageUrl } from "../src/services/visualSearch.js";
import { releaseReservation, reserveSearch } from "../src/lib/searchCapacity.js";
import { fakeSupabase, type Row } from "./fakeSupabase.js";

const safeFetchMock = vi.mocked(safeFetch);
const lensMock = vi.mocked(searchProductsByImageUrl);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);

const USER = "00000000-0000-4000-8000-00000000a001";
// Tels qu'une app les partage : majuscules, paramètres de suivi.
const TIKTOK_SHARED = "https://www.tiktok.com/@Exemple.Fictif/video/7554393000504266014?_r=1&is_from_webapp=1&utm_source=copy";
const TIKTOK_CANONICAL = "https://www.tiktok.com/@exemple.fictif/video/7554393000504266014";
const INSTAGRAM_SHARED = "https://www.instagram.com/reel/ExempleFictif/?igsh=MWZzZXhlbXBsZQ==";
const INSTAGRAM_CANONICAL = "https://www.instagram.com/reel/ExempleFictif/";
/** Adresse d'image rangée par l'ancienne voie « couverture » (fictive). */
const OLD_COVER = "https://images-anciennes.example/couverture-fictive.jpeg";

/** Les valeurs par défaut de la table product_searches (celles de la base). */
const searchDefaults = (): Row => ({
  id: randomUUID(),
  screenshot_url: null,
  error_message: null,
  query: null,
  created_at: new Date().toISOString(),
  refused_before_call: 0,
  failure_kind: null,
  provider: null,
  run_started_at: null,
});

const DEFAULTS: Record<string, () => Row> = {
  product_searches: searchDefaults,
  product_matches: () => ({ id: randomUUID(), origin: "lens", brand: null, lens_rank: null, created_at: new Date().toISOString() }),
  affiliate_links: () => ({ id: randomUUID() }),
};

let app: FastifyInstance | null = null;
let fake: ReturnType<typeof fakeSupabase>;
let fetchSpy: MockInstance<typeof fetch>;

afterEach(async () => {
  await app?.close();
  app = null;
  fetchSpy.mockRestore();
});

beforeEach(() => {
  fake = fakeSupabase();
  // Toute demande qui partirait quand même échouerait ici, et serait comptée.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Aucune demande ne doit partir pendant ces tests."));
  safeFetchMock.mockReset();
  safeFetchMock.mockRejectedValue(new Error("Aucune demande ne doit partir pendant ces tests."));
  lensMock.mockReset();
  lensMock.mockResolvedValue({
    matches: [{ rank: 1, productName: "Veste fictive", imageUrl: "https://images.example/1.jpg", imageHdUrl: null, merchantName: "Marchand Exemple", merchantUrl: "https://marchand.example/veste", priceValue: 59, currency: "€" }],
    measure: {
      removedIncomplete: 0,
      removedSocial: 0,
      removedProfessional: 0,
      removedDuplicates: 0,
      received: 1,
      kept: 1,
      keptWithPrice: 1,
      keptOtherCurrency: 0,
      distinctSites: 1,
      sections: ["visual_matches"],
      googleState: null,
    },
    addedRanks: [],
    statusCode: 200,
  });
  reserveMock.mockReset();
  reserveMock.mockResolvedValue({ allowed: true, reservationId: 101 });
  releaseMock.mockReset();
  releaseMock.mockResolvedValue(true);
});

/** L'app réduite aux routes des recherches : connexion et limites simulées. */
async function buildApp(): Promise<FastifyInstance> {
  // La fausse base, plus ce que ces deux routes demandent en plus : les valeurs
  // par défaut de la base à l'insertion, et le lien signé de l'image analysée.
  const db = {
    ...fake.db,
    from(name: string) {
      const chain = fake.db.from(name);
      const defaults = DEFAULTS[name];
      if (!defaults) return chain;
      const insert = chain.insert;
      chain.insert = (value) => insert(Array.isArray(value) ? value.map((row) => ({ ...defaults(), ...row })) : { ...defaults(), ...value });
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        ...fake.db.storage.from(bucket),
        createSignedUrl: async () => ({ data: { signedUrl: "https://stockage.example/analyse-signee.jpg" }, error: null }),
      }),
    },
  };
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate("supabaseAdmin", db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: USER, email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.decorate("rateLimit", () => async () => {});
  app.decorate("rateLimitCheck", () => async () => {});
  app.decorate("countRateLimitHit", () => {});
  await app.register(searchesRoutes);
  await app.ready();
  return app;
}

function prepare(target: FastifyInstance, payload: Record<string, unknown>) {
  return target.inject({ method: "POST", url: "/api/searches/prepare", payload });
}

const PHOTO = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#806040" } }).jpeg().toBuffer();

/** Formulaire multipart du lancement, avec ou sans la capture de la personne. */
function launch(target: FastifyInstance, id: string, file?: Buffer) {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="query"\r\n\r\n\r\n`)];
  if (file) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="capture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return target.inject({
    method: "POST",
    url: `/api/searches/${id}/run`,
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "accept-language": "fr-FR" },
  });
}

const rows = () => fake.table("product_searches");
const rowOf = (id: string) => rows().find((row) => row.id === id)!;

/** Aucune demande n'est partie du serveur : ni par safeFetch, ni par fetch. */
function expectNoOutboundRequest(): void {
  expect(safeFetchMock).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

/** La réponse ne porte ni l'adresse d'une image de plateforme, ni la raison d'une image manquante. */
function expectNoCoverInAnswer(body: unknown): void {
  expect(body).not.toHaveProperty("thumbnailUrl");
  expect(body).not.toHaveProperty("previewIssue");
}

describe("« préparer » avec un lien de vidéo : son adresse publique et sa plateforme, sans aucune demande sortante", () => {
  it("lien TikTok : rangé sous son adresse publique (sans paramètre de suivi), plateforme « tiktok », aucune image", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: TIKTOK_SHARED });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: TIKTOK_CANONICAL, sourcePlatform: "tiktok", method: "manual_screenshot", matches: [] });
    expectNoCoverInAnswer(res.json());
    expectNoOutboundRequest();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ user_id: USER, source_url: TIKTOK_CANONICAL, source_platform: "tiktok", method: "manual_screenshot", thumbnail_url: null, status: "pending" });
    // Aucun paramètre de suivi nulle part dans la ligne enregistrée.
    expect(JSON.stringify(rows()[0])).not.toMatch(/utm_|_r=|is_from_webapp/);
  });

  it("lien Instagram : rangé sous son adresse publique, plateforme « instagram », aucune image", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: INSTAGRAM_SHARED });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: INSTAGRAM_CANONICAL, sourcePlatform: "instagram", method: "manual_screenshot" });
    expectNoCoverInAnswer(res.json());
    expectNoOutboundRequest();
    expect(rows()[0]).toMatchObject({ source_url: INSTAGRAM_CANONICAL, source_platform: "instagram", method: "manual_screenshot", thumbnail_url: null });
    expect(JSON.stringify(rows()[0])).not.toContain("igsh");
  });

  it.each([
    ["autre site", "https://www.boutique.example/fr/veste-en-daim"],
    ["Pinterest", "https://www.pinterest.fr/pin/123456789/"],
    ["profil TikTok (pas une vidéo)", "https://www.tiktok.com/@exemple.fictif"],
    ["profil Instagram (pas une publication)", "https://www.instagram.com/exemple.fictif/"],
    ["lien court TikTok (l'identifiant de la vidéo n'est pas dans l'adresse)", "https://vm.tiktok.com/ZMabc123/"],
    ["faux TikTok (autre nom de domaine)", "https://www.tiktok.com.exemple.example/@x/video/7554393000504266014"],
  ])("lien inconnu (%s) : ignoré — la recherche est celle d'une photo, rien du lien n'est enregistré", async (_label, sourceUrl) => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot" });
    expectNoCoverInAnswer(res.json());
    expectNoOutboundRequest();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ source_url: null, source_platform: "photo", method: "manual_screenshot", thumbnail_url: null, status: "pending" });
    expect(JSON.stringify(rows()[0])).not.toContain(new URL(sourceUrl).hostname);
  });

  it("sans lien (la photo ou la capture de la personne) : rien ne change — même recherche « photo », mêmes champs que pour un lien inconnu", async () => {
    const target = await buildApp();
    const res = await prepare(target, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot" });
    expectNoCoverInAnswer(res.json());
    expectNoOutboundRequest();
    expect(rows()[0]).toMatchObject({ source_url: null, source_platform: "photo", method: "manual_screenshot", thumbnail_url: null });

    const ignored = await prepare(target, { sourceUrl: "https://www.boutique.example/fr/veste-en-daim" });
    expect(Object.keys(ignored.json()).sort()).toEqual(Object.keys(res.json()).sort());
    const { id: _id, created_at: _createdAt, ...withoutLink } = rows()[0]!;
    const { id: _otherId, created_at: _otherCreatedAt, ...withIgnoredLink } = rows()[1]!;
    expect(withIgnoredLink).toEqual(withoutLink);
  });

  it("un lien mal formé reste refusé comme avant (400), sans rien enregistrer", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: "pas-un-lien" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_body" });
    expect(rows()).toHaveLength(0);
    expectNoOutboundRequest();
  });
});

describe("« lancer » : seule l'image importée par la personne est analysée", () => {
  it("recherche préparée avec un lien, sans image importée : refusée comme une photo (400, « image_required »), aucune demande, aucune recherche payée", async () => {
    const target = await buildApp();
    const prepared = (await prepare(target, { sourceUrl: TIKTOK_SHARED })).json() as { id: string };
    const res = await launch(target, prepared.id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "image_required", message: "Importez une capture de la pièce." });
    expectNoOutboundRequest();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(lensMock).not.toHaveBeenCalled();
    // La recherche reste en attente : la personne peut importer sa capture.
    expect(rowOf(prepared.id)).toMatchObject({ status: "pending", refused_before_call: 0 });
  });

  it("recherche « photo » sans image importée : le refus d'avant (400, « image_required »), inchangé", async () => {
    const target = await buildApp();
    const prepared = (await prepare(target, {})).json() as { id: string };
    const res = await launch(target, prepared.id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "image_required", message: "Importez une capture de la pièce." });
    expectNoOutboundRequest();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(lensMock).not.toHaveBeenCalled();
    expect(rowOf(prepared.id)).toMatchObject({ status: "pending", refused_before_call: 0 });
  });

  it("recherche préparée avec un lien, avec la capture de la personne : lancée sur SA capture ; le lien reste, aucune image de plateforme dans la réponse", async () => {
    const target = await buildApp();
    const prepared = (await prepare(target, { sourceUrl: INSTAGRAM_SHARED })).json() as { id: string };
    const res = await launch(target, prepared.id, PHOTO);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "completed", sourceUrl: INSTAGRAM_CANONICAL, sourcePlatform: "instagram", method: "manual_screenshot" });
    expectNoCoverInAnswer(res.json());
    expect(lensMock).toHaveBeenCalledOnce();
    // L'image analysée est celle déposée dans NOTRE stockage, jamais une adresse de plateforme.
    expect(lensMock.mock.calls[0]![1]).toBe("https://stockage.example/analyse-signee.jpg");
    expectNoOutboundRequest();
    expect(rowOf(prepared.id)).toMatchObject({ status: "completed", thumbnail_url: null });
  });

  describe("recherche d'avant le retrait, restée avec l'adresse d'une couverture dans la base", () => {
    /** Telle que l'ancienne voie « couverture » l'avait rangée. */
    function oldSearchWithCover(): string {
      const id = randomUUID();
      fake.table("product_searches").push({ ...searchDefaults(), id, user_id: USER, source_url: TIKTOK_CANONICAL, source_platform: "tiktok", method: "oembed", thumbnail_url: OLD_COVER, status: "pending" });
      return id;
    }

    it("sans image importée : refusée (« image_required »), la couverture n'est jamais téléchargée", async () => {
      const target = await buildApp();
      const id = oldSearchWithCover();
      const res = await launch(target, id);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "image_required" });
      expectNoOutboundRequest();
      expect(reserveMock).not.toHaveBeenCalled();
      expect(lensMock).not.toHaveBeenCalled();
      expect(rowOf(id)).toMatchObject({ status: "pending", refused_before_call: 0 });
    });

    it("avec la capture de la personne : lancée sur sa capture, et l'adresse de la couverture n'est renvoyée nulle part", async () => {
      const target = await buildApp();
      const id = oldSearchWithCover();
      const res = await launch(target, id, PHOTO);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "completed", sourceUrl: TIKTOK_CANONICAL });
      expectNoCoverInAnswer(res.json());
      expect(res.body).not.toContain("images-anciennes.example");
      expect(lensMock).toHaveBeenCalledOnce();
      expect(lensMock.mock.calls[0]![1]).toBe("https://stockage.example/analyse-signee.jpg");
      expectNoOutboundRequest();
    });
  });
});
