import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « nettoyage avant le premier build » : ce que l'interrupteur des liens
// (LINK_PREVIEW_ENABLED, lib/linkPreview.ts) coupe dans les routes « préparer »
// et « lancer », sans base (fausse base en mémoire, tests/fakeSupabase.ts) et
// sans aucun réseau. Le VRAI service oEmbed et le VRAI téléchargement des
// vignettes sont gardés : seul safeFetch, leur unique porte de sortie, est
// simulé — « aucun appel à TikTok ni à Meta » se vérifie donc ici pour de bon.
// Google Lens, le plafond, le disjoncteur et le cache sont simulés.
// L'interrupteur lu depuis les variables : interrupteurLiens.test.ts ; le
// service oEmbed seul : oembedPreview.test.ts. Liens et images fictifs.
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return {
    env: { ...original.env, LINK_PREVIEW_ENABLED: false, META_OEMBED_ACCESS_TOKEN: "jeton-factice-des-tests", VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false },
  };
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

import { env } from "../src/env.js";
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
const TIKTOK = "https://www.tiktok.com/@exemple/video/7554393000504266014";
const INSTAGRAM = "https://www.instagram.com/reel/ExempleFictif/";
const COVER = "https://p16-common-sign.tiktokcdn-eu.com/couverture-fictive.jpeg";

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

afterEach(async () => {
  await app?.close();
  app = null;
  // Coupé : la valeur par défaut, et celle de tout le fichier.
  Object.assign(env, { LINK_PREVIEW_ENABLED: false });
});

beforeEach(() => {
  fake = fakeSupabase();
  safeFetchMock.mockReset();
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

/** Une recherche enregistrée AVANT la coupure, avec son lien et sa couverture. */
function searchWithCover(): string {
  const id = randomUUID();
  fake.table("product_searches").push({ ...searchDefaults(), id, user_id: USER, source_url: TIKTOK, source_platform: "tiktok", method: "oembed", thumbnail_url: COVER, status: "pending" });
  return id;
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

describe("interrupteur des liens coupé (valeur par défaut) : « préparer » ignore le lien", () => {
  it("lien TikTok : aucun appel sortant, ni le lien ni une couverture enregistrés, la recherche attend une capture", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: TIKTOK });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", thumbnailUrl: null, previewIssue: "no_official_access" });
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ user_id: USER, source_url: null, source_platform: "photo", method: "manual_screenshot", thumbnail_url: null, status: "pending" });
    // Rien du lien nulle part dans la ligne enregistrée.
    expect(JSON.stringify(rows()[0])).not.toContain("tiktok");
  });

  it("lien Instagram, même avec un jeton Meta saisi : aucun appel à Meta, rien d'enregistré du lien", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: INSTAGRAM });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sourceUrl: null, sourcePlatform: "photo", thumbnailUrl: null, previewIssue: "no_official_access" });
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(rows()[0]).toMatchObject({ source_url: null, source_platform: "photo", thumbnail_url: null });
    expect(JSON.stringify(rows()[0])).not.toContain("instagram");
  });

  it("sans lien (la capture de la personne) : rien ne change — même recherche « photo », sans raison d'échec", async () => {
    const target = await buildApp();
    const res = await prepare(target, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "pending", sourceUrl: null, sourcePlatform: "photo", method: "manual_screenshot", thumbnailUrl: null, previewIssue: null });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("un lien mal formé reste refusé comme avant (400), sans rien enregistrer", async () => {
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: "pas-un-lien" });
    expect(res.statusCode).toBe(400);
    expect(rows()).toHaveLength(0);
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe("interrupteur des liens coupé : « lancer » ne se sert jamais d'une couverture TikTok ou Meta", () => {
  it("couverture enregistrée avant la coupure, sans capture : refus « importez une capture », aucun téléchargement, aucune recherche payée", async () => {
    const target = await buildApp();
    const id = searchWithCover();
    const res = await launch(target, id);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "preview_unavailable" });
    expect(safeFetchMock).not.toHaveBeenCalled();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(lensMock).not.toHaveBeenCalled();
    // La recherche reste en attente : la personne peut importer sa capture.
    expect(rowOf(id)).toMatchObject({ status: "pending", refused_before_call: 1 });
  });

  it("la même recherche avec la capture de la personne : lancée comme avant, sur SA capture, sans aucun appel à TikTok ni à Meta", async () => {
    const target = await buildApp();
    const id = searchWithCover();
    const res = await launch(target, id, PHOTO);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "completed" });
    expect(lensMock).toHaveBeenCalledOnce();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("recherche « photo » sans capture : le refus d'avant (400, « image_required »), inchangé", async () => {
    const target = await buildApp();
    const prepared = (await prepare(target, {})).json() as { id: string };
    const res = await launch(target, prepared.id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "image_required" });
    expect(rowOf(prepared.id)).toMatchObject({ status: "pending", refused_before_call: 0 });
  });
});

describe("interrupteur des liens allumé : le comportement d'avant, inchangé", () => {
  beforeEach(() => {
    Object.assign(env, { LINK_PREVIEW_ENABLED: true });
  });

  it("« préparer » un lien TikTok appelle l'oEmbed de TikTok et enregistre le lien et la couverture", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ type: "video", thumbnail_url: COVER }), { status: 200, headers: { "content-type": "application/json" } }));
    const target = await buildApp();
    const res = await prepare(target, { sourceUrl: TIKTOK });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sourceUrl: TIKTOK, sourcePlatform: "tiktok", method: "oembed", thumbnailUrl: COVER, previewIssue: null });
    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(String(safeFetchMock.mock.calls[0]![0])).toContain("https://www.tiktok.com/oembed?url=");
    expect(rows()[0]).toMatchObject({ source_url: TIKTOK, source_platform: "tiktok", method: "oembed", thumbnail_url: COVER });
  });

  // Revue de sécurité du 12 novembre 2026 (point « entrees-09 »).
  it("« préparer » un lien : 20 par heure et par membre (chacun fait partir une demande vers TikTok ou Meta) ; sans lien, jamais compté", async () => {
    const target = await buildApp();
    safeFetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      for (let attempt = 0; attempt < 20; attempt++) expect((await prepare(target, { sourceUrl: TIKTOK })).statusCode).toBe(200);
      const outgoing = safeFetchMock.mock.calls.length;
      const refused = await prepare(target, { sourceUrl: TIKTOK });
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({ error: "link_prepare_limit", message: "Vous avez préparé beaucoup de liens en peu de temps. Réessayez dans une heure." });
      // Refusé avant tout appel sortant et sans rien enregistrer.
      expect(safeFetchMock.mock.calls.length).toBe(outgoing);
      expect(rows()).toHaveLength(20);
      // La capture de la personne (sans lien) n'est pas concernée.
      expect((await prepare(target, {})).statusCode).toBe(200);
    } finally {
      process.env.NODE_ENV = before;
    }
  });

  it("« lancer » sans capture télécharge la couverture enregistrée et lance la recherche", async () => {
    safeFetchMock.mockResolvedValueOnce(new Response(PHOTO, { status: 200, headers: { "content-type": "image/jpeg" } }));
    const target = await buildApp();
    const id = searchWithCover();
    const res = await launch(target, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "completed" });
    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(String(safeFetchMock.mock.calls[0]![0])).toBe(COVER);
    expect(lensMock).toHaveBeenCalledOnce();
  });
});
