import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

// Aucun appel réel : ni SerpApi (crédits), ni TikTok. La recherche visuelle
// et la voie officielle sont simulées ; le recadrage (sharp) et le stockage
// (spotto-dev) sont réels.
// Le reste du module reste le vrai.
vi.mock("../src/services/visualSearch.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/visualSearch.js")>();
  return { ...original, searchProductsByImageUrl: vi.fn() };
});
vi.mock("../src/services/oembed.js", () => ({
  detectPlatform: () => "tiktok",
  fetchOfficialPreview: vi.fn(async () => ({ ok: true, thumbnailUrl: "https://p16-common-sign.tiktokcdn-eu.com/vignette.jpeg" })),
}));
// Plafond global des recherches (lot 4 quater) et place rendue (0027) :
// simulés ici ; les fonctions réelles de la base sont testées dans
// searchCapacity.test.ts et placeRendue.test.ts.
vi.mock("../src/lib/searchCapacity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCapacity.js")>();
  return { ...original, reserveSearch: vi.fn(), releaseReservation: vi.fn(), searchCapacityBeforeComplementAi: vi.fn() };
});
vi.mock("../src/lib/imageProcessing.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/imageProcessing.js")>();
  return { ...original, downloadThumbnail: vi.fn() };
});
// Voie C (lot c) : interrupteurs forcés à « coupé » pour tout le fichier (un
// .env du Mac qui les allumerait ne change rien aux cas d'avant) ; le bloc
// « voie C allumée » les allume lui-même, puis les recoupe. Google Shopping et
// l'IA sont simulés (jamais un appel payant ; la garde des tests refuse de
// toute façon serpapi.com et anthropic.com). Le cache est le vrai (table
// search_cache de spotto-dev-2, après 0028) : ses écritures sont suivies pour
// être effacées après chaque cas.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false, ANTHROPIC_PHOTO_ENABLED: false } };
});
vi.mock("../src/services/serpapi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/serpapi.js")>();
  return { ...original, callShopping: vi.fn(), serpApiTextProvider: { name: "serpapi", searchByText: vi.fn() } };
});
vi.mock("../src/services/shoppingQueryAi.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/services/shoppingQueryAi.js")>();
  return { ...original, askShoppingQuery: vi.fn() };
});
vi.mock("../src/lib/searchCache.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/searchCache.js")>();
  return { ...original, writeCache: vi.fn(original.writeCache) };
});

import { searchProductsByImageUrl, type VisualMatch, type VisualSearchResult } from "../src/services/visualSearch.js";
import { ProviderFailure, type TextSearchResponse } from "../src/services/searchProvider.js";
import { downloadThumbnail } from "../src/lib/imageProcessing.js";
import { releaseReservation, reserveSearch, searchCapacityBeforeComplementAi } from "../src/lib/searchCapacity.js";
import { env } from "../src/env.js";
import { serpApiTextProvider } from "../src/services/serpapi.js";
import { askShoppingQuery, type ShoppingQueryResult } from "../src/services/shoppingQueryAi.js";
import { writeCache } from "../src/lib/searchCache.js";
import { assertNoUserImage } from "../src/lib/aiSwitches.js";
import { VOIE_C_BUDGET } from "../src/lib/deadline.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const searchMock = vi.mocked(searchProductsByImageUrl);
const downloadMock = vi.mocked(downloadThumbnail);
const reserveMock = vi.mocked(reserveSearch);
const releaseMock = vi.mocked(releaseReservation);
/** Numéro de place simulé (0027). */
const RESERVATION = 4242;

// Image de test 400 × 600 (proportions d'une vignette verticale).
const IMAGE = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#6b4a3a" } }).jpeg().toBuffer();

/** Ce que rend la recherche visuelle simulée : les propositions, et une
 * mesure plausible (`received` : propositions renvoyées par Google). */
function found(matches: VisualMatch[], received = matches.length): VisualSearchResult {
  return {
    matches,
    measure: {
      received,
      removedIncomplete: 0,
      removedSocial: received - matches.length,
      removedProfessional: 0,
      removedDuplicates: 0,
      kept: matches.length,
      keptWithPrice: matches.filter((m) => m.priceValue !== null).length,
      keptOtherCurrency: 0,
      distinctSites: matches.length,
      sections: received > 0 ? ["visual_matches"] : [],
      googleState: received > 0 ? null : "empty",
    },
    addedRanks: [],
    statusCode: 200,
  };
}

/** Colonnes de la mesure rangées avec une recherche (migration 0025). */
async function measureOf(app: FastifyInstance, searchId: string) {
  const { data } = await app.supabaseAdmin
    .from("product_searches")
    .select("outcome, failure_kind, received_count, removed_social, kept_count, kept_with_price, lens_sections, google_state, crop_area_pct, call_seconds, refused_before_call")
    .eq("id", searchId)
    .single();
  return data;
}

const MATCH = {
  rank: 1,
  productName: "Veste en daim marron",
  imageUrl: "https://encrypted-tbn.example/vignette.jpg",
  imageHdUrl: "https://marchand.example/veste-hd.jpg",
  merchantName: "Marchand",
  merchantUrl: "https://marchand.example/veste",
  priceValue: 190,
  currency: "€",
};

describe("Spotter en deux temps : préparer puis lancer", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "sfa");
    other = await createTestUser(app, "sfb");
  });

  afterAll(async () => {
    await app.supabaseAdmin.storage.from("screenshots").list(user.id).then(async ({ data }) => {
      if (data?.length) await app.supabaseAdmin.storage.from("screenshots").remove(data.map((f) => `${user.id}/${f.name}`));
    });
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  beforeEach(() => {
    searchMock.mockReset();
    searchMock.mockResolvedValue(found([MATCH]));
    downloadMock.mockReset();
    downloadMock.mockResolvedValue(IMAGE);
    reserveMock.mockReset();
    reserveMock.mockResolvedValue({ allowed: true, reservationId: RESERVATION });
    releaseMock.mockReset();
    releaseMock.mockResolvedValue(true);
  });

  async function prepare(sourceUrl?: string) {
    const res = await app.inject({
      method: "POST",
      url: "/api/searches/prepare",
      headers: authHeaders(user.token),
      payload: sourceUrl ? { sourceUrl } : {},
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function run(searchId: string, fields: Record<string, string>, file?: Buffer, token = user.token, language?: string) {
    const mp = buildMultipart(fields, file ? { fieldname: "file", filename: "capture.jpg", contentType: "image/jpeg", data: file } : undefined);
    return app.inject({
      method: "POST",
      url: `/api/searches/${searchId}/run`,
      headers: { ...authHeaders(token), ...mp.headers, ...(language ? { "accept-language": language } : {}) },
      payload: mp.payload,
    });
  }

  it("préparer un lien renvoie l'image à analyser, sans aucun appel SerpApi", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    expect(search.status).toBe("pending");
    expect(search.method).toBe("oembed");
    expect(search.thumbnailUrl).toContain("tiktokcdn-eu.com");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("préparer un lien dont l'image manque renvoie la raison précise (vidéo introuvable)", async () => {
    const { fetchOfficialPreview } = await import("../src/services/oembed.js");
    vi.mocked(fetchOfficialPreview).mockResolvedValueOnce({ ok: false, issue: "unavailable" });
    const search = await prepare("https://www.tiktok.com/@x/video/404");
    expect(search.status).toBe("pending");
    expect(search.thumbnailUrl).toBeNull();
    expect(search.previewIssue).toBe("unavailable");
  });

  it("préparer sans lien crée une recherche « photo » en attente d'image", async () => {
    const search = await prepare();
    expect(search.sourcePlatform).toBe("photo");
    expect(search.status).toBe("pending");
  });

  it("lancer recadre la vignette, enregistre l'image HD — un seul appel SerpApi ; le texte d'une ancienne app n'est ni transmis ni enregistré", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    // L'image n'existe que pendant l'appel SerpApi : on la lit à ce moment-là.
    let analysed: Buffer | null = null;
    searchMock.mockImplementationOnce(async () => {
      const { data } = await app.supabaseAdmin.storage.from("screenshots").download(`${user.id}/${search.id}.jpg`);
      analysed = Buffer.from(await data!.arrayBuffer());
      return found([MATCH]);
    });
    const res = await run(search.id, {
      crop: JSON.stringify({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }),
      query: "  veste en daim marron  ",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    // Petit lot (décision du fondateur du 2026-10-25) : les mots ne partent plus avec l'image.
    expect(body.query).toBeNull();
    expect(body.matches[0].imageHdUrl).toBe(MATCH.imageHdUrl);
    expect(body.matches[0].imageUrl).toBe(MATCH.imageUrl);

    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock.mock.calls[0]![2]).toEqual({ locale: { hl: "fr", country: "fr" } });

    // L'image réellement envoyée à l'analyse est bien la zone choisie :
    // 50 % × 25 % d'une image 400 × 600 = 200 × 150.
    const meta = await sharp(analysed!).metadata();
    expect([meta.width, meta.height]).toEqual([200, 150]);
  });

  it("RGPD : l'image analysée est supprimée dès la réponse de SerpApi, succès comme échec", async () => {
    const ok = await prepare("https://www.tiktok.com/@x/video/1");
    await run(ok.id, {});
    searchMock.mockRejectedValueOnce(new Error("SerpApi en panne"));
    const ko = await prepare("https://www.tiktok.com/@x/video/1");
    expect((await run(ko.id, {})).json().status).toBe("failed");

    const { data } = await app.supabaseAdmin.storage.from("screenshots").list(user.id);
    const names = (data ?? []).map((f) => f.name);
    expect(names).not.toContain(`${ok.id}.jpg`);
    expect(names).not.toContain(`${ko.id}.jpg`);
    const { data: row } = await app.supabaseAdmin.from("product_searches").select("screenshot_url").eq("id", ok.id).single();
    expect(row!.screenshot_url).toBeNull();
  });

  it("limite horaire : seuls les appels SerpApi réellement envoyés comptent", async () => {
    const counted = await createTestUser(app, "sfl");
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development"; // la limite est coupée sous Vitest par défaut
    try {
      const prepareFor = async () =>
        (await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(counted.token), payload: { sourceUrl: "https://www.tiktok.com/@x/video/1" } })).json();

      // 12 lancements refusés avant tout appel (zone invalide) : aucun ne compte.
      for (let i = 0; i < 12; i++) {
        const search = await prepareFor();
        const res = await run(search.id, { crop: JSON.stringify({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }) }, undefined, counted.token);
        expect(res.statusCode).toBe(400);
      }
      // 10 vrais lancements passent…
      for (let i = 0; i < 10; i++) {
        const search = await prepareFor();
        expect((await run(search.id, {}, undefined, counted.token)).statusCode).toBe(200);
      }
      // … le 11ᵉ est refusé AVANT l'appel SerpApi.
      const search = await prepareFor();
      const blocked = await run(search.id, {}, undefined, counted.token);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().message).toContain("Réessayez");
      expect(searchMock).toHaveBeenCalledTimes(10);
    } finally {
      process.env.NODE_ENV = previousEnv;
      await deleteTestUser(app, counted.id);
    }
  }, 60_000);

  describe("plafond global des recherches et part de la personne (lot 4 quater)", () => {
    async function statusOf(searchId: string) {
      const { data, error } = await app.supabaseAdmin.from("product_searches").select("status").eq("id", searchId).single();
      expect(error).toBeNull();
      return data?.status;
    }
    async function imageKept(searchId: string) {
      const { data } = await app.supabaseAdmin.storage.from("screenshots").list(user.id);
      return (data ?? []).some((file) => file.name === `${searchId}.jpg`);
    }

    it("plafond du jour atteint : aucun appel SerpApi, message honnête ; rien ne reste et la recherche se relance plus tard", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      reserveMock.mockResolvedValueOnce({ allowed: false, limit: "day", resumesOn: null });
      const refused = await run(search.id, { query: "veste" });
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({
        error: "search_capacity_day",
        message: "Le service de recherche est très sollicité aujourd'hui. Réessayez demain.",
      });
      expect(refused.headers["retry-after"]).toBeUndefined();
      expect(searchMock).not.toHaveBeenCalled();
      // La personne et la recherche en cours sont transmises au plafond (part de la personne).
      expect(reserveMock.mock.calls[0]!.slice(2)).toEqual([user.id, search.id]);
      expect(await imageKept(search.id)).toBe(false);
      expect(await statusOf(search.id)).toBe("pending");

      expect((await run(search.id, {})).statusCode).toBe(200);
      expect(searchMock).toHaveBeenCalledOnce();
      expect(reserveMock).toHaveBeenCalledTimes(2);
    });

    it("plafond du mois atteint : le jour du prochain renouvellement est transmis (l'app en fait « Réessayez à partir du … »), message dans la langue de l'utilisateur", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      reserveMock.mockResolvedValueOnce({ allowed: false, limit: "month", resumesOn: "2026-11-03" });
      const french = await run(search.id, {});
      expect(french.json()).toEqual({
        error: "search_capacity_month",
        message: "Le service de recherche a atteint sa limite mensuelle.",
        resumesOn: "2026-11-03",
      });
      reserveMock.mockResolvedValueOnce({ allowed: false, limit: "month", resumesOn: "2026-11-03" });
      const english = await run(search.id, {}, undefined, user.token, "en-GB");
      expect(english.statusCode).toBe(429);
      expect(english.json()).toMatchObject({ message: "The search service has reached its monthly limit.", resumesOn: "2026-11-03" });
      expect(searchMock).not.toHaveBeenCalled();
    });

    it("part de la personne atteinte : aucun appel SerpApi, son propre message ; la recherche reste lançable", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      reserveMock.mockResolvedValueOnce({ allowed: false, limit: "user", resumesOn: null });
      const refused = await run(search.id, {});
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({
        error: "search_capacity_user",
        message: "Vous avez atteint votre limite de recherches pour aujourd'hui. Réessayez demain.",
      });
      expect(searchMock).not.toHaveBeenCalled();
      expect(await statusOf(search.id)).toBe("pending");
    });

    it("plafond illisible (base injoignable) : aucun appel SerpApi, une panne annoncée comme telle", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      reserveMock.mockRejectedValueOnce(new Error("base injoignable"));
      const res = await run(search.id, {});
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("internal_error");
      expect(searchMock).not.toHaveBeenCalled();
      expect(await statusOf(search.id)).toBe("pending");
    });

    it("consulté seulement au moment d'appeler SerpApi : un lancement refusé avant (zone invalide, recherche d'un autre) ne réserve rien", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      expect((await run(search.id, { crop: JSON.stringify({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }) })).statusCode).toBe(400);
      expect((await run(search.id, {}, undefined, other.token)).statusCode).toBe(404);
      expect(reserveMock).not.toHaveBeenCalled();
    });

    it("s'ajoute aux limites par personne : un lancement refusé par le plafond ne compte pas dans la limite horaire", async () => {
      const counted = await createTestUser(app, "sfp");
      const previousEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development"; // la limite par personne est coupée sous Vitest par défaut
      try {
        const prepared = await app.inject({
          method: "POST",
          url: "/api/searches/prepare",
          headers: authHeaders(counted.token),
          payload: { sourceUrl: "https://www.tiktok.com/@x/video/1" },
        });
        const searchId: string = prepared.json().id;
        reserveMock.mockResolvedValue({ allowed: false, limit: "day", resumesOn: null });
        for (let i = 0; i < 10; i++) expect((await run(searchId, {}, undefined, counted.token)).statusCode).toBe(429);
        reserveMock.mockResolvedValue({ allowed: true, reservationId: RESERVATION });
        expect((await run(searchId, {}, undefined, counted.token)).statusCode).toBe(200);
        expect(searchMock).toHaveBeenCalledOnce();
      } finally {
        process.env.NODE_ENV = previousEnv;
        await deleteTestUser(app, counted.id);
      }
    }, 60_000);
  });

  it("un texte, vide ou rempli, n'est jamais transmis à la recherche visuelle", async () => {
    const vide = await prepare("https://www.tiktok.com/@x/video/1");
    await run(vide.id, { query: "   " });
    const rempli = await prepare("https://www.tiktok.com/@x/video/2");
    await run(rempli.id, { query: "veste" });
    expect(searchMock.mock.calls.map((call) => call[2])).toEqual([{ locale: { hl: "fr", country: "fr" } }, { locale: { hl: "fr", country: "fr" } }]);
  });

  // Petit lot 2 (décision du fondateur du 2026-10-27) : les mots tapés sous la photo trient les propositions.
  it("les mots remontent en tête les propositions dont le nom les contient ; ni transmis à la recherche visuelle, ni enregistrés", async () => {
    const search = await prepare();
    searchMock.mockResolvedValueOnce(
      found([
        { ...MATCH, rank: 1, productName: "Chelsea boots", merchantUrl: "https://marchand.example/a" },
        { ...MATCH, rank: 2, productName: "Sac en cuir noir", merchantUrl: "https://marchand.example/b" },
        { ...MATCH, rank: 3, productName: "Veste en cuir noire", merchantUrl: "https://marchand.example/c" },
      ])
    );
    const res = await run(search.id, { query: "la veste en cuir noir" }, IMAGE);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sortedByWords).toBe(true);
    expect(body.matches.map((m: { rank: number; productName: string }) => [m.rank, m.productName])).toEqual([
      [1, "Sac en cuir noir"],
      [2, "Veste en cuir noire"],
      [3, "Chelsea boots"],
    ]);
    expect(searchMock.mock.calls[0]![2]).toEqual({ locale: { hl: "fr", country: "fr" } });
    const { data } = await app.supabaseAdmin.from("product_searches").select("query").eq("id", search.id).single();
    expect(data).toEqual({ query: null });
    // Relue plus tard : même ordre, mais rien ne dit plus le tri (les mots ne sont pas gardés).
    const relue = (await app.inject({ method: "GET", url: `/api/searches/${search.id}`, headers: authHeaders(user.token) })).json();
    expect(relue.matches.map((m: { productName: string }) => m.productName)).toEqual(["Sac en cuir noir", "Veste en cuir noire", "Chelsea boots"]);
    expect(relue.sortedByWords).toBeUndefined();
  });

  it("aucun nom ne contient les mots ni leurs traductions, ou aucun mot : l'ordre de la recherche visuelle ne change pas, et rien ne l'indique", async () => {
    const sansMots: Record<string, string> = {};
    for (const fields of [{ query: "veste en cuir noir" }, sansMots]) {
      const search = await prepare();
      searchMock.mockResolvedValueOnce(
        found([
          { ...MATCH, rank: 1, productName: "Chelsea boots", merchantUrl: "https://marchand.example/a" },
          { ...MATCH, rank: 2, productName: "Silk scarf", merchantUrl: "https://marchand.example/b" },
        ])
      );
      const body = (await run(search.id, fields, IMAGE)).json();
      expect(body.sortedByWords).toBe(false);
      expect(body.matches.map((m: { productName: string }) => m.productName)).toEqual(["Chelsea boots", "Silk scarf"]);
    }
  });

  it("chaque recherche écrit sa ligne « Mesure recherche » : l'issue et des nombres, jamais d'identifiant, de titre ni d'adresse", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const journal = vi.spyOn(app.log, "info");
    searchMock.mockResolvedValueOnce({ ...found([MATCH], 60), addedRanks: [34, 41] });
    try {
      expect((await run(search.id, {})).statusCode).toBe(200);
      const lignes = journal.mock.calls.filter((call) => call[1] === "Mesure recherche");
      expect(lignes).toHaveLength(1);
      expect(lignes[0]![0]).toEqual({
        provider: "serpapi",
        statusCode: 200,
        outcome: "found",
        failureKind: null,
        received: 60,
        kept: 1,
        keptWithPrice: 1,
        keptOtherCurrency: 0,
        added: 2,
        addedRanks: [34, 41],
        callSeconds: expect.any(Number),
      });
      const texte = JSON.stringify(lignes[0]);
      for (const interdit of [search.id, user.id, MATCH.productName, MATCH.merchantUrl, "http"]) expect(texte).not.toContain(interdit);
    } finally {
      journal.mockRestore();
    }
  });

  it("une recherche ne peut être lancée qu'une fois : pas de second crédit", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    expect((await run(search.id, {})).statusCode).toBe(200);
    const again = await run(search.id, {});
    expect(again.statusCode).toBe(409);
    expect(searchMock).toHaveBeenCalledOnce();
  });

  it("une capture importée remplace la vignette", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const res = await run(search.id, {}, IMAGE);
    expect(res.statusCode).toBe(200);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("une recherche « photo » sans image est refusée, sans appel SerpApi", async () => {
    const search = await prepare();
    const res = await run(search.id, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("image_required");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("refuse une zone qui dépasse l'image, un texte trop long, un fichier qui n'est pas une image", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    expect((await run(search.id, { crop: JSON.stringify({ x: 0.6, y: 0, width: 0.6, height: 0.5 }) })).statusCode).toBe(400);
    expect((await run(search.id, { query: "x".repeat(61) })).statusCode).toBe(400);
    expect((await run(search.id, {}, Buffer.from("pas une image"))).statusCode).toBe(400);
    expect(searchMock).not.toHaveBeenCalled();
    // Rien n'a été consommé : la recherche peut toujours être lancée.
    expect((await run(search.id, {})).statusCode).toBe(200);
  });

  it("ne lance jamais la recherche d'un autre utilisateur", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const res = await run(search.id, {}, undefined, other.token);
    expect(res.statusCode).toBe(404);
  });

  it("distingue « rien trouvé » d'une panne", async () => {
    const empty = await prepare("https://www.tiktok.com/@x/video/1");
    searchMock.mockResolvedValueOnce(found([]));
    const emptyBody = (await run(empty.id, {})).json();
    expect(emptyBody.status).toBe("failed");
    expect(emptyBody.errorMessage).toBe("Aucun produit identifié sur cette image.");

    const broken = await prepare("https://www.tiktok.com/@x/video/1");
    searchMock.mockRejectedValueOnce(new Error("SerpApi indisponible"));
    const brokenBody = (await run(broken.id, {})).json();
    expect(brokenBody.status).toBe("failed");
    expect(brokenBody.errorMessage).toBe("La recherche visuelle a échoué.");
  });

  describe("mesure de chaque recherche (fiabilité des résultats, migration 0025)", () => {
    it("une recherche aboutie range ses nombres, son issue et la part de l'image, sans aucun contenu", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      searchMock.mockResolvedValueOnce(found([MATCH], 3));
      await run(search.id, { crop: JSON.stringify({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }), query: "veste" });

      expect(await measureOf(app, search.id)).toMatchObject({
        outcome: "found",
        failure_kind: null,
        received_count: 3,
        removed_social: 2,
        kept_count: 1,
        kept_with_price: 1,
        lens_sections: ["visual_matches"],
        google_state: null,
        crop_area_pct: 10,
        refused_before_call: 0,
      });
    });

    it("distingue Google vide (cadre inutilisable), rien d'achetable et une panne typée", async () => {
      const empty = await prepare("https://www.tiktok.com/@x/video/1");
      searchMock.mockResolvedValueOnce(found([], 0));
      await run(empty.id, {});
      expect(await measureOf(app, empty.id)).toMatchObject({ outcome: "empty_lens", google_state: "empty", crop_area_pct: 100 });

      const unbuyable = await prepare("https://www.tiktok.com/@x/video/1");
      searchMock.mockResolvedValueOnce(found([], 4));
      await run(unbuyable.id, {});
      expect(await measureOf(app, unbuyable.id)).toMatchObject({ outcome: "nothing_buyable", received_count: 4, kept_count: 0 });

      const slow = await prepare("https://www.tiktok.com/@x/video/1");
      searchMock.mockRejectedValueOnce(new ProviderFailure("timeout", null, "SerpApi injoignable : délai dépassé"));
      await run(slow.id, {});
      expect(await measureOf(app, slow.id)).toMatchObject({ outcome: "failure", failure_kind: "timeout", received_count: null, kept_count: null });
    });

    // 0027 : fournisseur, code de réponse et heure du lancement rangés avec chaque recherche.
    it("range le fournisseur, son code de réponse et l'heure du lancement ; rien de tout cela pour une recherche jamais partie", async () => {
      const search = await prepare("https://www.tiktok.com/@x/video/1");
      const before = Date.now();
      await run(search.id, {});
      const { data } = await app.supabaseAdmin.from("product_searches").select("provider, provider_status_code, run_started_at").eq("id", search.id).single();
      expect(data).toMatchObject({ provider: "serpapi", provider_status_code: 200 });
      expect(Date.parse(String(data?.run_started_at))).toBeGreaterThanOrEqual(before - 5_000);

      const capped = await prepare("https://www.tiktok.com/@x/video/1");
      reserveMock.mockResolvedValueOnce({ allowed: false, limit: "day", resumesOn: null });
      expect((await run(capped.id, {})).statusCode).toBe(429);
      const { data: never } = await app.supabaseAdmin.from("product_searches").select("status, provider, provider_status_code, run_started_at").eq("id", capped.id).single();
      expect(never).toEqual({ status: "pending", provider: null, provider_status_code: null, run_started_at: null });
    });

    it("refus du fournisseur : la place est rendue ; la recherche est notée « refus » et « non comptée » seulement si le retour a réussi", async () => {
      const refused = await prepare("https://www.tiktok.com/@x/video/1");
      searchMock.mockRejectedValueOnce(new ProviderFailure("refused", 429, "SerpApi a répondu 429"));
      const body = (await run(refused.id, {})).json();
      expect(releaseMock).toHaveBeenCalledOnce();
      expect(releaseMock.mock.calls[0]![2]).toBe(RESERVATION);
      expect(body).toMatchObject({ status: "failed", errorMessage: "La recherche visuelle a échoué.", notCounted: true });
      expect(await measureOf(app, refused.id)).toMatchObject({ outcome: "failure", failure_kind: "provider_refused" });

      // Retour en échec : la place reste comptée, la recherche aussi (prudence).
      const kept = await prepare("https://www.tiktok.com/@x/video/1");
      releaseMock.mockResolvedValueOnce(false);
      searchMock.mockRejectedValueOnce(new ProviderFailure("refused", 503, "SerpApi a répondu 503"));
      expect((await run(kept.id, {})).json()).toMatchObject({ status: "failed", notCounted: false });
      expect(await measureOf(app, kept.id)).toMatchObject({ outcome: "failure", failure_kind: "provider_error" });

      // Panne incertaine (délai dépassé, réseau, réponse illisible) : aucune place rendue.
      releaseMock.mockClear();
      for (const kind of ["timeout", "error", "unreadable"] as const) {
        const uncertain = await prepare("https://www.tiktok.com/@x/video/1");
        searchMock.mockRejectedValueOnce(new ProviderFailure(kind, null, "panne simulée"));
        expect((await run(uncertain.id, {})).json()).toMatchObject({ status: "failed", notCounted: false });
      }
      expect(releaseMock).not.toHaveBeenCalled();
    });

    it("un lancement refusé avant l'appel (image illisible) est compté, sans aucun appel à SerpApi", async () => {
      const search = await prepare();
      const res = await run(search.id, {}, Buffer.from("pas une image"));
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("invalid_image");
      expect(searchMock).not.toHaveBeenCalled();
      expect(await measureOf(app, search.id)).toMatchObject({ outcome: null, refused_before_call: 1 });
    });
  });

  // 0027 (coupure, conception acceptée le 21 octobre) : une recherche restée
  // « en cours » plus de 2 minutes est marquée interrompue quand on la relit.
  describe("recherche interrompue, marquée à la relecture", () => {
    /** Une recherche « en cours » lancée (ou créée, avant 0027) `minutes` minutes plus tôt. */
    async function stuck(minutes: number, options: { launched: boolean } = { launched: true }): Promise<string> {
      const at = new Date(Date.now() - minutes * 60_000).toISOString();
      const { data, error } = await app.supabaseAdmin
        .from("product_searches")
        .insert({
          user_id: user.id,
          source_platform: "photo",
          method: "manual_screenshot",
          status: "processing",
          created_at: at,
          run_started_at: options.launched ? at : null,
          provider: options.launched ? "serpapi" : null,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      return String(data?.id);
    }

    function read(searchId: string) {
      return app.inject({ method: "GET", url: `/api/searches/${searchId}`, headers: authHeaders(user.token) });
    }

    it("plus de 2 minutes : interrompue (une panne, place gardée), avec sa ligne « Mesure recherche » ; moins : toujours en cours", async () => {
      const old = await stuck(3);
      const journal = vi.spyOn(app.log, "info");
      try {
        const body = (await read(old)).json();
        expect(body).toMatchObject({ status: "failed", errorMessage: "La recherche visuelle a échoué.", notCounted: false });
        const lignes = journal.mock.calls.filter((call) => call[1] === "Mesure recherche");
        expect(lignes.map((call) => call[0])).toEqual([expect.objectContaining({ provider: "serpapi", statusCode: null, outcome: "failure", failureKind: "interrupted", callSeconds: null })]);
      } finally {
        journal.mockRestore();
      }
      expect(await measureOf(app, old)).toMatchObject({ outcome: "failure", failure_kind: "interrupted", call_seconds: null });

      const recent = await stuck(1);
      expect((await read(recent)).json().status).toBe("processing");
      expect(await measureOf(app, recent)).toMatchObject({ outcome: null, failure_kind: null });
    });

    it("recherche d'avant 0027 (sans heure de lancement) : jugée sur sa date de création ; relue deux fois, marquée une seule fois", async () => {
      const old = await stuck(5, { launched: false });
      expect((await read(old)).json().status).toBe("failed");
      expect((await read(old)).json().status).toBe("failed");
      expect(await measureOf(app, old)).toMatchObject({ failure_kind: "interrupted" });
    });

    it("une recherche terminée n'est jamais marquée, même ancienne ; celle d'un autre reste introuvable", async () => {
      const done = await stuck(10);
      await app.supabaseAdmin.from("product_searches").update({ status: "completed", outcome: "found" }).eq("id", done);
      expect((await read(done)).json().status).toBe("completed");
      expect(await measureOf(app, done)).toMatchObject({ outcome: "found", failure_kind: null });

      const theirs = await stuck(10);
      const res = await app.inject({ method: "GET", url: `/api/searches/${theirs}`, headers: authHeaders(other.token) });
      expect(res.statusCode).toBe(404);
      expect(await measureOf(app, theirs)).toMatchObject({ outcome: null });
    });
  });

  // Lot 4 ter (constaté sur le parcours iPhone : spotto-dev injoignable un instant) : propositions
  // trouvées mais non enregistrées → l'app affichait « Aucune pièce trouvée ». C'est une panne.
  it("propositions non enregistrées : une panne, jamais « aucune pièce trouvée »", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const realFrom = app.supabaseAdmin.from.bind(app.supabaseAdmin);
    const spy = vi.spyOn(app.supabaseAdmin, "from").mockImplementation((table: string) => {
      const builder = realFrom(table);
      if (table === "product_matches") {
        builder.insert = (() => Promise.resolve({ data: null, error: { message: "panne simulée", details: "", hint: "", code: "08006" } })) as unknown as typeof builder.insert;
      }
      return builder;
    });
    try {
      const body = (await run(search.id, {})).json();
      expect(body.status).toBe("failed");
      expect(body.errorMessage).toBe("La recherche visuelle a échoué.");
      expect(body.matches).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(await measureOf(app, search.id)).toMatchObject({ outcome: "failure", failure_kind: "save_failed" });
  });

  // 2026-10-15 : une devise de plus de 3 caractères faisait refuser tout l'enregistrement
  // (colonne char(3)) : la recherche entière tombait en panne. Refus réel de la base ici.
  it("une proposition que la base refuse est écartée seule : les autres sont gardées, rangs sans trou", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    searchMock.mockResolvedValueOnce(
      found([
        MATCH,
        { ...MATCH, rank: 2, productName: "Devise inattendue", merchantUrl: "https://marchand.example/rouble", currency: "руб." },
        { ...MATCH, rank: 3, productName: "Troisième", merchantUrl: "https://marchand.example/troisieme" },
      ])
    );

    const body = (await run(search.id, {})).json();
    expect(body.status).toBe("completed");
    expect(body.matches.map((m: { rank: number; productName: string }) => [m.rank, m.productName])).toEqual([
      [1, MATCH.productName],
      [2, "Troisième"],
    ]);
  });

  it("si la vignette n'est plus disponible, invite à importer une capture", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    downloadMock.mockRejectedValueOnce(new Error("403"));
    const res = await run(search.id, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("preview_unavailable");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("recherche dans la langue de l'utilisateur : fr/fr en français, anglais avec le pays de l'appareil (lot 3)", async () => {
    const french = await prepare("https://www.tiktok.com/@x/video/1");
    await run(french.id, {}, undefined, user.token, "fr");
    expect(searchMock.mock.calls.at(-1)?.[2]?.locale).toEqual({ hl: "fr", country: "fr" });
    const english = await prepare("https://www.tiktok.com/@x/video/1");
    await run(english.id, {}, undefined, user.token, "en-GB");
    expect(searchMock.mock.calls.at(-1)?.[2]?.locale).toEqual({ hl: "en", country: "gb" });
    const noRegion = await prepare("https://www.tiktok.com/@x/video/1");
    await run(noRegion.id, {}, undefined, user.token, "en");
    expect(searchMock.mock.calls.at(-1)?.[2]?.locale).toEqual({ hl: "en", country: "us" });
    const noHeader = await prepare("https://www.tiktok.com/@x/video/1");
    await run(noHeader.id, {});
    expect(searchMock.mock.calls.at(-1)?.[2]?.locale).toEqual({ hl: "fr", country: "fr" });
  });

  it("les messages d'erreur suivent la langue de l'utilisateur (lot 3)", async () => {
    const search = await prepare();
    const fr = await run(search.id, {}, undefined, user.token, "fr");
    expect(fr.json().message).toBe("Importez une capture de la pièce.");
    const en = await run(search.id, {}, undefined, user.token, "en-US");
    expect(en.statusCode).toBe(400);
    expect(en.json()).toEqual({ error: fr.json().error, message: "Please import a screenshot of the piece." });
  });

  it("les anciennes routes du Spotter n'existent plus (retirées au bloc 3 du Lot Q)", async () => {
    const legacy = await app.inject({ method: "POST", url: "/api/searches", headers: authHeaders(user.token), payload: { sourceUrl: "https://www.tiktok.com/@x/video/2" } });
    expect(legacy.statusCode).toBe(404);
    const screenshot = await app.inject({ method: "POST", url: "/api/searches/00000000-0000-0000-0000-000000000000/screenshot", headers: authHeaders(user.token) });
    expect(screenshot.statusCode).toBe(404);
    expect(searchMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Voie C (lot c, 2026-11-02). À lancer sur le Mac, contre spotto-dev-2,
  // APRÈS la migration 0028 : sans elle, la voie C reste coupée et ces cas
  // échouent (c'est voulu).
  // ---------------------------------------------------------------------

  it("voie C coupée : ni complément dans la réponse, ni colonne de la voie C écrite, ni cache écrit", async () => {
    const writeMock = vi.mocked(writeCache);
    writeMock.mockClear();
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const body = (await run(search.id, {})).json();
    expect(body.status).toBe("completed");
    expect(body.complement).toBeUndefined();
    expect(body.matches[0].origin).toBeUndefined();
    expect(searchMock.mock.calls[0]![2]).toEqual({ locale: { hl: "fr", country: "fr" } });
    expect(writeMock).not.toHaveBeenCalled();
    const { data } = await app.supabaseAdmin
      .from("product_searches")
      .select("complement_status, shopping_calls, lens_from_cache, served_from_cache, text_suggested, text_requested_at, text_status, total_seconds")
      .eq("id", search.id)
      .single();
    expect(data).toEqual({
      complement_status: null,
      shopping_calls: 0,
      lens_from_cache: false,
      served_from_cache: false,
      text_suggested: false,
      text_requested_at: null,
      text_status: null,
      total_seconds: null,
    });
  });

  it("chaque préparation supprime les entrées expirées du cache, même voie C coupée (la durée de 24 h tient)", async () => {
    const key = randomBytes(32).toString("hex");
    const day = 24 * 60 * 60 * 1000;
    const { error } = await app.supabaseAdmin.from("search_cache").insert({
      key,
      step: "lens",
      payload: { essai: true },
      created_at: new Date(Date.now() - 2 * day).toISOString(),
      expires_at: new Date(Date.now() - day).toISOString(),
    });
    expect(error).toBeNull();
    await prepare();
    const { data } = await app.supabaseAdmin.from("search_cache").select("key").eq("key", key);
    expect(data).toEqual([]);
  });

  describe("voie C allumée : Lens d'abord, puis le complément", () => {
    const textMock = vi.mocked(serpApiTextProvider.searchByText);
    const askMock = vi.mocked(askShoppingQuery);
    const capacityMock = vi.mocked(searchCapacityBeforeComplementAi);
    const writeMock = vi.mocked(writeCache);
    const switches = { VOIE_C_ENABLED: env.VOIE_C_ENABLED, VOIE_C_AI_ENABLED: env.VOIE_C_AI_ENABLED, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
    const CROP = { crop: JSON.stringify({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 }) };

    beforeAll(() => {
      // Clé factice : l'IA est simulée, et la garde des tests refuse anthropic.com.
      Object.assign(env, { VOIE_C_ENABLED: true, VOIE_C_AI_ENABLED: true, ANTHROPIC_API_KEY: "cle-factice-des-tests" });
    });
    afterAll(() => {
      Object.assign(env, switches);
    });
    beforeEach(() => {
      textMock.mockReset();
      askMock.mockReset();
      capacityMock.mockReset();
      capacityMock.mockResolvedValue({ allowed: true });
      writeMock.mockClear();
    });
    // Le cache est commun à tout le service : ce que chaque cas y écrit est
    // effacé (écritures jamais attendues par la route : attendues ici).
    afterEach(async () => {
      await settleCacheWrites();
      const keys = writeMock.mock.calls.map((call) => call[1]);
      if (keys.length > 0) await app.supabaseAdmin.from("search_cache").delete().in("key", keys);
    });

    async function settleCacheWrites(): Promise<void> {
      await Promise.allSettled(writeMock.mock.results.map((result) => result.value));
    }

    /** Image propre à chaque cas (octets tirés au hasard) : le cache ne sert
     * jamais la réponse d'un autre cas, ni d'un passage précédent. */
    function uniqueImage(): Promise<Buffer> {
      return sharp(randomBytes(400 * 600 * 3), { raw: { width: 400, height: 600, channels: 3 } }).jpeg().toBuffer();
    }

    /** Mot propre à chaque cas (modèle fictif) : la requête et ses clés de cache aussi. */
    function token(): string {
      return `n${randomBytes(4).toString("hex")}`;
    }

    /** Résultats Lens fictifs, marque « Exemplor » et modèle `model` dans les titres. */
    function lensMatches(model: string): VisualMatch[] {
      return [
        { ...MATCH, rank: 1, productName: `Veste Exemplor ${model} marron`, merchantUrl: "https://marchand.example/a" },
        { ...MATCH, rank: 2, productName: `Exemplor ${model} veste en daim`, merchantUrl: "https://autre-marchand.example/b" },
      ];
    }

    function aiQuery(model: string): ShoppingQueryResult {
      return { kind: "query", value: { query: `Exemplor veste ${model}`, brand: "Exemplor", model }, usage: { inputTokens: 900, outputTokens: 24 } };
    }

    /** Réponse de Google Shopping fictive : deux boutiques, dont une page déjà proposée par Lens (retirée). */
    function shopping(model: string): TextSearchResponse {
      const item = (position: number, title: string, link: string) => ({
        position,
        title,
        link,
        product_link: `https://www.google.fr/shopping/product/${position}`,
        source: "Boutique Exemple",
        price: "149,00 €",
        extracted_price: 149,
        thumbnail: `https://images.boutique.example/${position}.jpg`,
      });
      return {
        items: [
          item(1, `Exemplor veste ${model} camel`, "https://boutique.example/veste-1"),
          item(2, "Veste en daim", "https://marchand.example/a"),
          item(3, `Veste ${model} Exemplor marron`, "https://boutique.example/veste-3"),
        ],
        received: 3,
        statusCode: 200,
      };
    }

    async function columnsOf(searchId: string) {
      const { data } = await app.supabaseAdmin
        .from("product_searches")
        .select("status, complement_status, shopping_calls, lens_from_cache, served_from_cache, text_suggested, total_seconds, run_started_at, call_seconds, provider_status_code, query")
        .eq("id", searchId)
        .single();
      return data;
    }

    it("Lens, puis la requête de l'IA et Google Shopping : Lens d'abord et inchangé ; les boutiques après, origine « shopping », avec leurs liens ; la requête dans la réponse seulement", async () => {
      const model = token();
      const lens = lensMatches(model);
      searchMock.mockResolvedValueOnce(found(lens));
      askMock.mockResolvedValueOnce(aiQuery(model));
      textMock.mockResolvedValueOnce(shopping(model));
      const journal = vi.spyOn(app.log, "info");
      const search = await prepare();
      try {
        const res = await run(search.id, {}, await uniqueImage());
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.status).toBe("completed");
        expect(body.complement).toEqual({ status: "shown", query: `Exemplor veste ${model}`, suggestText: false, textStatus: null });
        // Lens en tête, dans son ordre, sans origine ; puis les boutiques (la page déjà proposée par Lens est retirée).
        expect(body.matches.map((m: { rank: number; productName: string; origin?: string }) => [m.rank, m.productName, m.origin ?? "lens"])).toEqual([
          [1, lens[0]!.productName, "lens"],
          [2, lens[1]!.productName, "lens"],
          [3, `Exemplor veste ${model} camel`, "shopping"],
          [4, `Veste ${model} Exemplor marron`, "shopping"],
        ]);
        const boutique = body.matches[2];
        expect(boutique).toMatchObject({ merchantUrl: "https://boutique.example/veste-1", affiliateUrl: "https://boutique.example/veste-1", priceMin: 149, currency: "EUR" });

        // Lens avec son plafond fixe (un signal de délai), jamais l'« Annuler » de la personne.
        expect(searchMock).toHaveBeenCalledOnce();
        expect(searchMock.mock.calls[0]![2]).toEqual({ locale: { hl: "fr", country: "fr" }, signal: expect.any(AbortSignal) });
        // Deux places : Lens (étape par défaut), puis Google Shopping (étape « shopping »).
        expect(reserveMock.mock.calls.map((call) => call.slice(2))).toEqual([
          [user.id, search.id],
          [user.id, search.id, "shopping"],
        ]);
        // L'IA : seulement les titres et les sites Lens, avec la garde « aucune image ».
        expect(askMock).toHaveBeenCalledOnce();
        expect(askMock.mock.calls[0]![0]).toEqual([
          { title: lens[0]!.productName, site: "marchand.example" },
          { title: lens[1]!.productName, site: "autre-marchand.example" },
        ]);
        expect(askMock.mock.calls[0]![2]).toMatchObject({ apiKey: "cle-factice-des-tests", assertNoImage: assertNoUserImage });
        expect(textMock).toHaveBeenCalledOnce();
        expect(textMock.mock.calls[0]!.slice(0, 2)).toEqual([`Exemplor veste ${model}`, { hl: "fr", country: "fr" }]);

        const columns = await columnsOf(search.id);
        expect(columns).toMatchObject({ status: "completed", complement_status: "shown", shopping_calls: 1, lens_from_cache: false, served_from_cache: false, text_suggested: false, query: null });
        expect(columns?.total_seconds).toEqual(expect.any(Number));
        expect(columns?.run_started_at).not.toBeNull();

        // Journal : « Mesure recherche » (fromCache) puis « Mesure complément », des nombres et des listes fermées seulement.
        expect(journal.mock.calls.filter((call) => call[1] === "Mesure recherche").map((call) => call[0])).toEqual([expect.objectContaining({ outcome: "found", fromCache: false })]);
        const lignes = journal.mock.calls.filter((call) => call[1] === "Mesure complément");
        expect(lignes).toHaveLength(1);
        expect(lignes[0]![0]).toMatchObject({ source: "ai", status: "shown", lensFromCache: false, queryFromCache: false, shoppingFromCache: false, calls: 1, kept: 2, tier0: 2, inputTokens: 900, outputTokens: 24 });
        const texte = JSON.stringify(lignes[0]);
        for (const interdit of [model, "Exemplor", search.id, user.id, "http", "boutique.example"]) expect(texte).not.toContain(interdit);
      } finally {
        journal.mockRestore();
      }

      // Relue : l'origine de chaque proposition et le complément, sans la requête.
      const relue = (await app.inject({ method: "GET", url: `/api/searches/${search.id}`, headers: authHeaders(user.token) })).json();
      expect(relue.complement).toEqual({ status: "shown", suggestText: false, textStatus: null });
      expect(relue.matches.map((m: { origin?: string }) => m.origin ?? "lens")).toEqual(["lens", "lens", "shopping", "shopping"]);
    });

    it("la même image relancée (mêmes octets, même cadre) : tout vient du cache — aucun appel, aucune place, hors de la part de 8 ; heure de lancement vidée", async () => {
      const model = token();
      const image = await uniqueImage();
      searchMock.mockResolvedValueOnce(found(lensMatches(model)));
      askMock.mockResolvedValueOnce(aiQuery(model));
      textMock.mockResolvedValueOnce(shopping(model));
      const first = await prepare();
      const firstBody = (await run(first.id, CROP, image)).json();
      expect(firstBody.complement.status).toBe("shown");
      await settleCacheWrites();

      // Chaque lecture du cache est bornée à 800 ms (VOIE_C_BUDGET.cacheReadMs),
      // et une lecture isolée de spotto-dev-2 peut prendre plusieurs secondes
      // (vitest.config.ts) : elle vaudrait « absent », et ce cas échouerait au
      // hasard. Pour ce second lancement seulement, les trois lectures attendent
      // la base ; tous les autres délais restent les vrais.
      const timeoutOf = AbortSignal.timeout.bind(AbortSignal);
      const readCap = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => (ms === VOIE_C_BUDGET.cacheReadMs ? new AbortController().signal : timeoutOf(ms)));
      let res: Awaited<ReturnType<typeof run>>;
      let again: { id: string };
      try {
        again = await prepare();
        res = await run(again.id, CROP, image);
      } finally {
        readCap.mockRestore();
      }
      expect(res.statusCode).toBe(200);
      // D'abord les appels : un appel de plus ici, c'est le cache manqué.
      expect(searchMock).toHaveBeenCalledOnce();
      expect(askMock).toHaveBeenCalledOnce();
      expect(textMock).toHaveBeenCalledOnce();
      expect(reserveMock).toHaveBeenCalledTimes(2);
      const body = res.json();
      expect(body.matches.map((m: { productName: string; origin?: string }) => [m.productName, m.origin ?? "lens"])).toEqual(
        firstBody.matches.map((m: { productName: string; origin?: string }) => [m.productName, m.origin ?? "lens"])
      );
      expect(body.complement).toMatchObject({ status: "shown", suggestText: false });
      expect(await columnsOf(again.id)).toMatchObject({
        status: "completed",
        complement_status: "shown",
        shopping_calls: 0,
        lens_from_cache: true,
        served_from_cache: true,
        run_started_at: null,
        call_seconds: 0,
        provider_status_code: null,
      });
    });

    it("Lens sans résultat : ni IA ni boutiques ; « Que cherchez-vous ? » est proposé, et l'invitation survit à la relecture", async () => {
      searchMock.mockResolvedValueOnce(found([], 0));
      const search = await prepare();
      const body = (await run(search.id, {}, await uniqueImage())).json();
      expect(body).toMatchObject({ status: "failed", errorMessage: "Aucun produit identifié sur cette image.", complement: { status: "no_query", suggestText: true, textStatus: null } });
      expect(body.complement.query).toBeUndefined();
      expect(askMock).not.toHaveBeenCalled();
      expect(textMock).not.toHaveBeenCalled();
      expect(reserveMock).toHaveBeenCalledOnce();
      const relue = (await app.inject({ method: "GET", url: `/api/searches/${search.id}`, headers: authHeaders(user.token) })).json();
      expect(relue.complement).toEqual({ status: "no_query", suggestText: true, textStatus: null });
      expect(await columnsOf(search.id)).toMatchObject({ complement_status: "no_query", text_suggested: true, shopping_calls: 0 });

      // Voie C coupée depuis : l'issue reste, l'invitation n'est plus annoncée
      // (la route « Que cherchez-vous ? » répondrait 404).
      env.VOIE_C_ENABLED = false;
      try {
        const coupee = (await app.inject({ method: "GET", url: `/api/searches/${search.id}`, headers: authHeaders(user.token) })).json();
        expect(coupee.complement).toEqual({ status: "no_query", suggestText: false, textStatus: null });
      } finally {
        env.VOIE_C_ENABLED = true;
      }
    });

    it("étape IA coupée (VOIE_C_AI_ENABLED) : Lens seul, issue « skipped », aucune invitation, aucune recherche dans les boutiques", async () => {
      env.VOIE_C_AI_ENABLED = false;
      try {
        searchMock.mockResolvedValueOnce(found(lensMatches(token())));
        const search = await prepare();
        const body = (await run(search.id, {}, await uniqueImage())).json();
        expect(body.complement).toEqual({ status: "skipped", suggestText: false, textStatus: null });
        expect(body.matches.every((m: { origin?: string }) => m.origin === undefined)).toBe(true);
        expect(askMock).not.toHaveBeenCalled();
        expect(textMock).not.toHaveBeenCalled();
        expect(capacityMock).not.toHaveBeenCalled();
        expect(await columnsOf(search.id)).toMatchObject({ complement_status: "skipped", shopping_calls: 0 });
      } finally {
        env.VOIE_C_AI_ENABLED = true;
      }
    });

    it("plafond atteint avant l'IA : l'IA est sautée, Lens montré seul, jamais de 429", async () => {
      capacityMock.mockResolvedValueOnce({ allowed: false, limit: "day", resumesOn: null });
      searchMock.mockResolvedValueOnce(found(lensMatches(token())));
      const search = await prepare();
      const res = await run(search.id, {}, await uniqueImage());
      expect(res.statusCode).toBe(200);
      expect(res.json().complement.status).toBe("no_capacity");
      expect(askMock).not.toHaveBeenCalled();
      expect(reserveMock).toHaveBeenCalledOnce();
    });

    it("Google Shopping en panne : les résultats Lens seuls (« shopping_failed ») ; un délai dépassé reste compté, un refus non facturé rend sa place, une fois", async () => {
      const slowModel = token();
      searchMock.mockResolvedValueOnce(found(lensMatches(slowModel)));
      askMock.mockResolvedValueOnce(aiQuery(slowModel));
      textMock.mockRejectedValueOnce(new ProviderFailure("timeout", null, "délai dépassé"));
      const slow = await prepare();
      const slowBody = (await run(slow.id, {}, await uniqueImage())).json();
      expect(slowBody.status).toBe("completed");
      expect(slowBody.complement).toEqual({ status: "shopping_failed", suggestText: false, textStatus: null });
      expect(slowBody.matches.every((m: { origin?: string }) => m.origin === undefined)).toBe(true);
      expect(releaseMock).not.toHaveBeenCalled();
      expect(await columnsOf(slow.id)).toMatchObject({ complement_status: "shopping_failed", shopping_calls: 1 });

      const refusedModel = token();
      searchMock.mockResolvedValueOnce(found(lensMatches(refusedModel)));
      askMock.mockResolvedValueOnce(aiQuery(refusedModel));
      textMock.mockRejectedValueOnce(new ProviderFailure("refused", 429, "refus"));
      const refused = await prepare();
      expect((await run(refused.id, {}, await uniqueImage())).json().complement.status).toBe("shopping_failed");
      expect(releaseMock).toHaveBeenCalledOnce();
      expect(releaseMock.mock.calls[0]!.slice(2)).toEqual([RESERVATION, "shopping"]);
      // Place rendue : l'appel refusé ne compte pas dans le budget de la photo.
      expect(await columnsOf(refused.id)).toMatchObject({ complement_status: "shopping_failed", shopping_calls: 0, served_from_cache: false });
    });

    it("panne de Lens : aucun complément, rien n'est mis en cache", async () => {
      searchMock.mockRejectedValueOnce(new ProviderFailure("timeout", null, "délai dépassé"));
      const search = await prepare();
      const body = (await run(search.id, {}, await uniqueImage())).json();
      expect(body).toMatchObject({ status: "failed", errorMessage: "La recherche visuelle a échoué.", complement: { status: null, suggestText: false } });
      expect(askMock).not.toHaveBeenCalled();
      expect(writeMock).not.toHaveBeenCalled();
    });
  });
});
