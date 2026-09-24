import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";

// Aucun appel réel : ni SerpApi (crédits), ni TikTok. La recherche visuelle
// et la voie officielle sont simulées ; le recadrage (sharp) et le stockage
// (spotto-dev) sont réels.
vi.mock("../src/services/visualSearch.js", () => ({ searchProductsByImageUrl: vi.fn() }));
vi.mock("../src/services/oembed.js", () => ({
  detectPlatform: () => "tiktok",
  fetchOfficialThumbnail: vi.fn(async () => ({ thumbnailUrl: "https://p16-common-sign.tiktokcdn-eu.com/vignette.jpeg" })),
}));
vi.mock("../src/lib/imageProcessing.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/imageProcessing.js")>();
  return { ...original, downloadThumbnail: vi.fn() };
});

import { searchProductsByImageUrl } from "../src/services/visualSearch.js";
import { downloadThumbnail } from "../src/lib/imageProcessing.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const searchMock = vi.mocked(searchProductsByImageUrl);
const downloadMock = vi.mocked(downloadThumbnail);

// Image de test 400 × 600 (proportions d'une vignette verticale).
const IMAGE = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#6b4a3a" } }).jpeg().toBuffer();

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
    searchMock.mockResolvedValue([MATCH]);
    downloadMock.mockReset();
    downloadMock.mockResolvedValue(IMAGE);
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

  function run(searchId: string, fields: Record<string, string>, file?: Buffer, token = user.token) {
    const mp = buildMultipart(fields, file ? { fieldname: "file", filename: "capture.jpg", contentType: "image/jpeg", data: file } : undefined);
    return app.inject({
      method: "POST",
      url: `/api/searches/${searchId}/run`,
      headers: { ...authHeaders(token), ...mp.headers },
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

  it("préparer sans lien crée une recherche « photo » en attente d'image", async () => {
    const search = await prepare();
    expect(search.sourcePlatform).toBe("photo");
    expect(search.status).toBe("pending");
  });

  it("lancer recadre la vignette, transmet le texte, enregistre l'image HD — un seul appel SerpApi", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    const res = await run(search.id, {
      crop: JSON.stringify({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }),
      query: "  veste en daim marron  ",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.query).toBe("veste en daim marron");
    expect(body.matches[0].imageHdUrl).toBe(MATCH.imageHdUrl);
    expect(body.matches[0].imageUrl).toBe(MATCH.imageUrl);

    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock.mock.calls[0]![2]).toEqual({ query: "veste en daim marron" });

    // L'image réellement envoyée à l'analyse est bien la zone choisie :
    // 50 % × 25 % d'une image 400 × 600 = 200 × 150.
    const { data } = await app.supabaseAdmin.storage.from("screenshots").download(`${user.id}/${search.id}.jpg`);
    const meta = await sharp(Buffer.from(await data!.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([200, 150]);
  });

  it("un texte vide n'est jamais transmis", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    await run(search.id, { query: "   " });
    expect(searchMock.mock.calls[0]![2]).toEqual({ query: null });
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
    searchMock.mockResolvedValueOnce([]);
    const emptyBody = (await run(empty.id, {})).json();
    expect(emptyBody.status).toBe("failed");
    expect(emptyBody.errorMessage).toBe("Aucun produit identifié sur cette image.");

    const broken = await prepare("https://www.tiktok.com/@x/video/1");
    searchMock.mockRejectedValueOnce(new Error("SerpApi indisponible"));
    const brokenBody = (await run(broken.id, {})).json();
    expect(brokenBody.status).toBe("failed");
    expect(brokenBody.errorMessage).toBe("La recherche visuelle a échoué.");
  });

  it("si la vignette n'est plus disponible, invite à importer une capture", async () => {
    const search = await prepare("https://www.tiktok.com/@x/video/1");
    downloadMock.mockRejectedValueOnce(new Error("403"));
    const res = await run(search.id, {});
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("preview_unavailable");
    expect(searchMock).not.toHaveBeenCalled();
  });
});
