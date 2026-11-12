import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission « liens vidéo », règle 1b : le code d'intégration officiel
// d'Instagram, seul appel du serveur vers Meta. Tout est simulé : aucun appel
// réel. Vérifié ici : un seul hôte interrogé, la miniature jamais lue, le
// cache de 24 h, la limite horaire, le silence après « trop de demandes ».
vi.mock("../src/lib/safeFetch.js", () => ({ safeFetch: vi.fn() }));

import type { VideoLink } from "@monapp/shared-types";
import { safeFetch } from "../src/lib/safeFetch.js";
import {
  INSTAGRAM_EMBED_CACHE_SIZE,
  INSTAGRAM_EMBED_COOLDOWN_MS,
  INSTAGRAM_EMBED_HOURLY_BUDGET,
  handleInEmbed,
  instagramEmbed,
  instagramEmbedCalls,
  resetInstagramEmbed,
} from "../src/lib/instagramEmbed.js";

const safeFetchMock = vi.mocked(safeFetch);
const HOUR = 60 * 60 * 1000;

const reel = (code = "C8abcDEF123", handle: string | null = null): VideoLink => ({
  platform: "instagram",
  videoKey: code,
  canonicalUrl: `https://www.instagram.com/reel/${code}/`,
  creatorHandle: handle,
});
const HTML = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/C8abcDEF123/"><a href="https://www.instagram.com/reel/C8abcDEF123/">Une publication partagée par Mode Paris (@Mode.Paris)</a></blockquote>';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  resetInstagramEmbed();
  safeFetchMock.mockReset();
});

describe("instagramEmbed : le code d'intégration officiel, et lui seul", () => {
  it("un seul appel, vers graph.facebook.com seulement, sans jeton, avec l'adresse publique de la vidéo", async () => {
    safeFetchMock.mockResolvedValueOnce(json({ html: HTML, thumbnail_url: "https://scontent.cdninstagram.example/miniature.jpg", author_name: "Mode Paris" }));
    const embed = await instagramEmbed(reel());
    expect(embed).toEqual({ ok: true, html: HTML, creatorHandle: "mode.paris" });
    expect(safeFetchMock).toHaveBeenCalledOnce();
    const [url, options] = safeFetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v25.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FC8abcDEF123%2F&omitscript=true");
    expect(url).not.toContain("access_token");
    expect(options.allowedHosts).toEqual(["graph.facebook.com"]);
  });

  it("l'adresse de la miniature jointe par Meta n'est ni rendue ni gardée", async () => {
    safeFetchMock.mockResolvedValueOnce(json({ html: HTML, thumbnail_url: "https://scontent.cdninstagram.example/miniature.jpg" }));
    const first = await instagramEmbed(reel());
    const second = await instagramEmbed(reel());
    expect(JSON.stringify([first, second])).not.toContain("miniature");
    expect(Object.keys(first)).toEqual(["ok", "html", "creatorHandle"]);
  });

  it("le pseudo : celui de l'adresse s'il y figure, sinon celui écrit dans le code, sinon aucun", async () => {
    safeFetchMock.mockResolvedValue(json({ html: HTML }));
    expect((await instagramEmbed(reel("AAAAAAAAAAA", "boutique_x")) as { creatorHandle: string | null }).creatorHandle).toBe("boutique_x");
    expect(handleInEmbed("<blockquote class=\"instagram-media\">Publication (@Mode.Paris)</blockquote>")).toBe("mode.paris");
    expect(handleInEmbed("<blockquote class=\"instagram-media\">Sans pseudo</blockquote>")).toBeNull();
  });

  it("une publication TikTok n'est jamais demandée à Meta", async () => {
    expect(await instagramEmbed({ platform: "tiktok", videoKey: "7412345678901234567", canonicalUrl: "https://www.tiktok.com/@/video/7412345678901234567", creatorHandle: null })).toEqual({ ok: false, issue: "unavailable" });
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe("cache de 24 h par vidéo", () => {
  it("la même vidéo n'est demandée qu'une fois en 24 h, puis redemandée", async () => {
    safeFetchMock.mockImplementation(async () => json({ html: HTML }));
    let now = 10 * HOUR;
    const clock = () => now;
    await instagramEmbed(reel(), clock);
    await instagramEmbed(reel(), clock);
    now += 23 * HOUR;
    await instagramEmbed(reel(), clock);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    now += HOUR + 1;
    await instagramEmbed(reel(), clock);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("deux demandes de la même vidéo en même temps : un seul appel", async () => {
    safeFetchMock.mockImplementation(async () => json({ html: HTML }));
    const answers = await Promise.all([1, 2, 3].map(() => instagramEmbed(reel())));
    expect(answers.every((answer) => answer.ok)).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("privée, supprimée ou non intégrable : « unavailable », gardé 1 h ; code d'intégration absent ou inattendu : pareil", async () => {
    let now = 0;
    const clock = () => now;
    safeFetchMock.mockImplementation(async () => json({ error: { message: "Unsupported get request", code: 100 } }, 400));
    expect(await instagramEmbed(reel(), clock)).toEqual({ ok: false, issue: "unavailable" });
    await instagramEmbed(reel(), clock);
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    now += HOUR + 1;
    await instagramEmbed(reel(), clock);
    expect(safeFetchMock).toHaveBeenCalledTimes(2);

    for (const body of [{}, { html: "" }, { html: "<script>alert(1)</script>" }, { html: 42 }, { html: `<blockquote class="instagram-media">${"x".repeat(40_000)}</blockquote>` }]) {
      resetInstagramEmbed();
      safeFetchMock.mockImplementation(async () => json(body));
      expect(await instagramEmbed(reel()), JSON.stringify(body).slice(0, 40)).toEqual({ ok: false, issue: "unavailable" });
    }
  });

  it("Meta muet ou en panne : « unreachable », jamais gardé (le prochain essai redemande)", async () => {
    safeFetchMock.mockRejectedValueOnce(new Error("délai dépassé"));
    expect(await instagramEmbed(reel())).toEqual({ ok: false, issue: "unreachable" });
    safeFetchMock.mockResolvedValueOnce(json({}, 503));
    expect(await instagramEmbed(reel())).toEqual({ ok: false, issue: "unreachable" });
    safeFetchMock.mockResolvedValueOnce(json({ html: HTML }));
    expect((await instagramEmbed(reel())).ok).toBe(true);
    expect(safeFetchMock).toHaveBeenCalledTimes(3);
  });

  it(`le cache ne dépasse jamais ${INSTAGRAM_EMBED_CACHE_SIZE} vidéos`, async () => {
    safeFetchMock.mockImplementation(async () => json({ html: HTML }));
    let now = 0;
    // Étalé dans le temps pour rester sous la limite horaire.
    for (let index = 0; index < INSTAGRAM_EMBED_CACHE_SIZE + 5; index++) {
      now += 5_000;
      await instagramEmbed(reel(`CODE${String(index).padStart(7, "0")}`), () => now);
    }
    const before = safeFetchMock.mock.calls.length;
    now += 5_000;
    await instagramEmbed(reel("CODE0000000"), () => now);
    await instagramEmbed(reel(`CODE${String(INSTAGRAM_EMBED_CACHE_SIZE + 4).padStart(7, "0")}`), () => now);
    expect(safeFetchMock.mock.calls.length - before).toBe(1);
  });
});

describe("limite de Meta : 1 000 demandes par heure sans jeton", () => {
  it(`le serveur s'arrête de lui-même à ${INSTAGRAM_EMBED_HOURLY_BUDGET} demandes dans l'heure : « limit », sans appel ; l'heure passée, il reprend`, async () => {
    safeFetchMock.mockImplementation(async () => json({ html: HTML }));
    let now = 0;
    const clock = () => now;
    for (let index = 0; index < INSTAGRAM_EMBED_HOURLY_BUDGET; index++) {
      expect((await instagramEmbed(reel(`VIDEO${String(index).padStart(6, "0")}`), clock)).ok).toBe(true);
    }
    expect(instagramEmbedCalls(now)).toBe(INSTAGRAM_EMBED_HOURLY_BUDGET);
    expect(await instagramEmbed(reel("UNEDEPLUS00"), clock)).toEqual({ ok: false, issue: "limit" });
    expect(safeFetchMock).toHaveBeenCalledTimes(INSTAGRAM_EMBED_HOURLY_BUDGET);
    // Une vidéo déjà en mémoire reste servie pendant la limite.
    expect((await instagramEmbed(reel("VIDEO000000"), clock)).ok).toBe(true);
    now += HOUR + 1;
    expect((await instagramEmbed(reel("UNEDEPLUS00"), clock)).ok).toBe(true);
  });

  it("Meta répond « trop de demandes » (statut 429, ou code d'erreur 4, 17, 32, 613) : « limit », puis 10 minutes de silence", async () => {
    for (const refusal of [json({}, 429), json({ error: { code: 4 } }, 400), json({ error: { code: 17 } }, 400), json({ error: { code: 32 } }, 403), json({ error: { code: 613 } }, 400)]) {
      resetInstagramEmbed();
      safeFetchMock.mockReset();
      safeFetchMock.mockResolvedValueOnce(refusal);
      let now = 0;
      const clock = () => now;
      expect(await instagramEmbed(reel(), clock)).toEqual({ ok: false, issue: "limit" });
      // Pendant le silence : aucune demande, pour aucune vidéo.
      expect(await instagramEmbed(reel("AUTREVIDEO1"), clock)).toEqual({ ok: false, issue: "limit" });
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      now += INSTAGRAM_EMBED_COOLDOWN_MS + 1;
      safeFetchMock.mockResolvedValueOnce(json({ html: HTML }));
      expect((await instagramEmbed(reel(), clock)).ok).toBe(true);
    }
  });
});
