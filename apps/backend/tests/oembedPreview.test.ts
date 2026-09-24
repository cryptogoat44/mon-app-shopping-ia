import { beforeEach, describe, expect, it, vi } from "vitest";

// Aucun appel réel à TikTok : safeFetch est simulé. Les réponses reprennent
// ce que TikTok renvoie vraiment (constaté le 2026-09-24).
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "../src/lib/safeFetch.js";
import { fetchOfficialPreview, fetchOfficialThumbnail } from "../src/services/oembed.js";

const safeFetchMock = vi.mocked(safeFetch);
const VIDEO = "https://www.tiktok.com/@x/video/7554393000504266014";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("image officielle d'un lien : la raison précise quand elle manque", () => {
  beforeEach(() => safeFetchMock.mockReset());

  it("vidéo valide → son image de couverture", async () => {
    safeFetchMock.mockResolvedValueOnce(json({ type: "video", thumbnail_url: "https://p16.tiktokcdn-eu.com/v.jpeg" }));
    expect(await fetchOfficialPreview(VIDEO, "tiktok")).toEqual({ ok: true, thumbnailUrl: "https://p16.tiktokcdn-eu.com/v.jpeg" });
  });

  it("vidéo privée, supprimée ou lien faux (400) → « unavailable »", async () => {
    safeFetchMock.mockResolvedValueOnce(json({ message: "Something went wrong", code: 400 }, 400));
    expect(await fetchOfficialPreview(VIDEO, "tiktok")).toEqual({ ok: false, issue: "unavailable" });
  });

  it("lien de profil (200, type « rich ») → « not_a_video »", async () => {
    safeFetchMock.mockResolvedValueOnce(json({ type: "rich", title: "Profil" }));
    expect(await fetchOfficialPreview("https://www.tiktok.com/@x", "tiktok")).toEqual({ ok: false, issue: "not_a_video" });
  });

  it("TikTok en panne (500), saturé (429) ou muet (délai dépassé) → « service_down »", async () => {
    safeFetchMock.mockResolvedValueOnce(json({}, 503));
    expect(await fetchOfficialPreview(VIDEO, "tiktok")).toEqual({ ok: false, issue: "service_down" });
    safeFetchMock.mockResolvedValueOnce(json({}, 429));
    expect(await fetchOfficialPreview(VIDEO, "tiktok")).toEqual({ ok: false, issue: "service_down" });
    safeFetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    expect(await fetchOfficialPreview(VIDEO, "tiktok")).toEqual({ ok: false, issue: "service_down" });
  });

  it("Pinterest et Instagram sans jeton → « no_official_access » ; autre site → « unsupported_site » (aucun appel)", async () => {
    expect(await fetchOfficialPreview("https://pin.it/abc", "other")).toEqual({ ok: false, issue: "no_official_access" });
    expect(await fetchOfficialPreview("https://www.instagram.com/p/abc/", "instagram")).toEqual({ ok: false, issue: "no_official_access" });
    expect(await fetchOfficialPreview("https://www.zara.com/fr/veste", "other")).toEqual({ ok: false, issue: "unsupported_site" });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });

  it("l'ancienne forme (routes historiques) renvoie toujours l'image ou null", async () => {
    safeFetchMock.mockResolvedValueOnce(json({}, 400));
    expect(await fetchOfficialThumbnail(VIDEO, "tiktok")).toBeNull();
  });
});
