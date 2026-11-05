import { describe, expect, it } from "vitest";
import {
  checkTikTok,
  clearPlayerLink,
  embedHtmlOf,
  enabledPlayerPlatforms,
  getHeldPlayerLink,
  holdPlayerLink,
  instagramOEmbedUrl,
  isAllowedNavigation,
  oembedVerdict,
  openPlayerLink,
  playerAllowed,
  playerBaseUrl,
  readPlayerLink,
  sameDocument,
  shortLinkHop,
  tiktokEmbedHtmlOf,
  tiktokPlayerUrl,
  type FetchLike,
  type FetchResponseLike,
} from "../src/lib/player-link";

// Lot « lecteur intégré » : d'un lien collé ou partagé au lecteur officiel.
// Formes de liens : note R1 §3 (TikTok) et note R2 §2 (Instagram).
const ID = "6718335390845095173";

type Route = (Partial<FetchResponseLike> & { body?: unknown }) | Error;

/** Réseau simulé : une réponse par adresse ; adresse inconnue = hors ligne. */
function fakeFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = async (url: string): Promise<FetchResponseLike> => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new TypeError("Network request failed");
    if (route instanceof Error) throw route;
    const status = route.status ?? 200;
    return { ok: status < 300, status, url: route.url ?? url, json: async () => route.body ?? {} };
  };
  return Object.assign(impl, { calls });
}

describe("liens TikTok (note R1 §3)", () => {
  it.each([
    [`https://www.tiktok.com/@scout2015/video/${ID}`, "video", "scout2015"],
    [`https://www.tiktok.com/@scout2015/video/${ID}?is_from_webapp=1&sender_device=pc&_t=8abc&_r=1`, "video", "scout2015"],
    [`https://m.tiktok.com/@a.b_c/video/${ID}/`, "video", "a.b_c"],
    [`https://us.tiktok.com/@user/video/${ID}`, "video", "user"],
    [`https://www.tiktok.com/@mode.fr/photo/${ID}?lang=fr`, "photo", "mode.fr"],
  ])("« %s » : identifiant, sans les paramètres de partage", (url, media, account) => {
    expect(readPlayerLink(url)).toEqual({
      kind: "tiktok",
      id: ID,
      media,
      oembedUrl: `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${account}/video/${ID}`)}`,
    });
  });

  it.each([
    `https://m.tiktok.com/v/${ID}.html`,
    `https://www.tiktok.com/share/video/${ID}`,
    `https://www.tiktok.com/i18n/share/video/${ID}`,
    `https://www.tiktok.com/player/v1/${ID}?autoplay=1`,
    `https://www.tiktok.com/embed/v2/${ID}`,
  ])("« %s » : identifiant, sans vérification oEmbed (forme non déclarée)", (url) => {
    expect(readPlayerLink(url)).toEqual({ kind: "tiktok", id: ID, media: "video", oembedUrl: null });
  });

  it.each(["https://vm.tiktok.com/ZMabc123/", "https://vt.tiktok.com/ZSxyz789/", "https://www.tiktok.com/t/ZTRabc123/"])("« %s » : lien court, à suivre", (url) => {
    expect(readPlayerLink(url)).toEqual({ kind: "short", platform: "tiktok", url });
  });

  it.each([
    "https://www.tiktok.com/@mayela",
    "https://www.tiktok.com/tag/ootd",
    "https://vm.tiktok.com/",
    "https://www.tiktok.com/@user/live",
    `https://nottiktok.com/@a/video/${ID}`,
    `https://tiktok.com.evil.example/@a/video/${ID}`,
    `javascript:alert(1)//tiktok.com/@a/video/${ID}`,
  ])("« %s » : pas une vidéo lisible", (url) => {
    expect(readPlayerLink(url)).toEqual({ kind: "none" });
  });

  it("lecteur officiel : lecture automatique, en boucle, sans plein écran", () => {
    expect(tiktokPlayerUrl(ID)).toBe(
      `https://www.tiktok.com/player/v1/${ID}?autoplay=1&loop=1&rel=0&fullscreen_button=0&native_context_menu=0&description=0&music_info=0`
    );
  });
});

describe("liens Instagram (note R2 §2)", () => {
  it.each([
    ["https://www.instagram.com/reel/Chunk8-jurw/", "reel", "Chunk8-jurw"],
    ["https://www.instagram.com/reels/Cop84x6u7CP/", "reel", "Cop84x6u7CP"],
    ["https://www.instagram.com/p/BQ0eAlwhDrw/?igsh=abc", "p", "BQ0eAlwhDrw"],
    ["https://instagram.com/p/-Cmh1cukG2/", "p", "-Cmh1cukG2"],
    ["https://www.instagram.com/tv/BkfuX9UB-eK/", "p", "BkfuX9UB-eK"],
    ["https://www.instagram.com/marvelskies.fc/reel/CWqAgUZgCku/", "reel", "CWqAgUZgCku"],
    ["https://instagr.am/p/aye83DjauH/", "p", "aye83DjauH"],
    ["http://instagram.com/p/9o6LshA7zy/embed/", "p", "9o6LshA7zy"],
    ["https://m.instagram.com/reel/Chunk8-jurw/?utm_source=ig_web_copy_link", "reel", "Chunk8-jurw"],
  ])("« %s » : code et adresse canonique", (url, media, code) => {
    expect(readPlayerLink(url)).toEqual({ kind: "instagram", code, media, canonical: `https://www.instagram.com/${media}/${code}/` });
  });

  it("lien de partage /share/… : à suivre", () => {
    expect(readPlayerLink("https://www.instagram.com/share/reel/BAGxyz/")).toEqual({ kind: "short", platform: "instagram", url: "https://www.instagram.com/share/reel/BAGxyz/" });
  });

  it.each([
    "https://www.instagram.com/stories/someone/3570766765028588805/",
    "https://www.instagram.com/reels/audio/123456789/",
    "https://www.instagram.com/natgeo/",
    "https://www.instagram.com/explore/tags/lolcats/",
    "https://notinstagram.com/p/abc/",
  ])("« %s » : pas une vidéo intégrable", (url) => {
    expect(readPlayerLink(url)).toEqual({ kind: "none" });
  });

  it("oEmbed sans jeton (v26.0)", () => {
    expect(instagramOEmbedUrl("https://www.instagram.com/reel/X/", 344.6)).toBe(
      "https://graph.facebook.com/v26.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FX%2F&maxwidth=345&hidecaption=true&omitscript=true"
    );
  });

  it("html d'oEmbed Instagram : seulement le code officiel, sans script", () => {
    const html = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/X/"></blockquote>';
    expect(embedHtmlOf({ html })).toBe(html);
    expect(embedHtmlOf({ html: `${html}<script src="//www.instagram.com/embed.js"></script>` })).toBeNull();
    expect(embedHtmlOf({ html: "<div>autre</div>" })).toBeNull();
    expect(embedHtmlOf(null)).toBeNull();
  });

  it("html d'oEmbed TikTok (repli, contre-expertise n° 9) : blockquote gardé, embed.js officiel retiré, tout autre script refusé", () => {
    const quote = `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@a/video/${ID}" data-video-id="${ID}"><section></section></blockquote>`;
    expect(tiktokEmbedHtmlOf({ html: `${quote} <script async src="https://www.tiktok.com/embed.js"></script>` })).toBe(quote);
    expect(tiktokEmbedHtmlOf({ html: `${quote}<script>alert(1)</script>` })).toBeNull();
    expect(tiktokEmbedHtmlOf({ html: "<div>autre</div>" })).toBeNull();
  });
});

describe("ouverture du lecteur", () => {
  it("TikTok direct : aucun appel réseau avant le lecteur", async () => {
    const network = fakeFetch({});
    const opening = await openPlayerLink(`https://www.tiktok.com/@a/video/${ID}?_r=1`, { width: 343, fetchImpl: network });
    expect(opening).toMatchObject({ kind: "embed", embed: { platform: "tiktok", variant: "player", id: ID, playerUrl: tiktokPlayerUrl(ID) } });
    expect(network.calls).toEqual([]);
  });

  it("lien court TikTok : suivi jusqu'à l'adresse finale", async () => {
    const network = fakeFetch({ "https://vm.tiktok.com/ZMabc123/": { url: `https://www.tiktok.com/@a/video/${ID}?_t=1` } });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { width: 343, fetchImpl: network })).toMatchObject({ kind: "embed", embed: { platform: "tiktok", id: ID } });
  });

  it("lien court sans vidéo au bout : « short_link » ; hors ligne : « network »", async () => {
    const login = fakeFetch({ "https://vm.tiktok.com/ZMabc123/": { url: "https://www.tiktok.com/login" } });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { width: 343, fetchImpl: login })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { width: 343, fetchImpl: fakeFetch({}) })).toEqual({ kind: "unavailable", reason: "network" });
  });

  it("second suivi dans la vue web (contre-expertise n° 4b) : vidéo trouvée, redirection suivie, le reste arrêté", () => {
    expect(shortLinkHop(`https://www.tiktok.com/@a/video/${ID}?_t=1`)).toBe("resolved");
    expect(shortLinkHop("https://www.instagram.com/reel/Cxyz/")).toBe("resolved");
    expect(shortLinkHop("https://vm.tiktok.com/ZMabc123/")).toBe("follow");
    expect(shortLinkHop("https://www.tiktok.com/login")).toBe("follow");
    expect(shortLinkHop("snssdk1233://aweme/detail/1")).toBe("stop");
    expect(shortLinkHop("https://example.com/x")).toBe("stop");
    expect(shortLinkHop("http://vm.tiktok.com/ZMabc123/")).toBe("stop");
  });

  it("lien d'un bon site sans vidéo : « not_a_video »", async () => {
    expect(await openPlayerLink("https://www.tiktok.com/@user/live", { width: 343, fetchImpl: fakeFetch({}) })).toEqual({ kind: "unavailable", reason: "not_a_video" });
  });

  it("Instagram : 200 → code officiel ; 400 → non publique ; 429 → ne répond pas", async () => {
    const url = instagramOEmbedUrl("https://www.instagram.com/reel/Cxyz/", 343);
    const html = '<blockquote class="instagram-media"></blockquote>';
    const ok = await openPlayerLink("https://www.instagram.com/reel/Cxyz/?igsh=abc", { width: 343, fetchImpl: fakeFetch({ [url]: { body: { html } } }) });
    expect(ok).toMatchObject({ kind: "embed", embed: { platform: "instagram", variant: "oembed", html, code: "Cxyz" } });
    expect(await openPlayerLink("https://www.instagram.com/reel/Cxyz/", { width: 343, fetchImpl: fakeFetch({ [url]: { status: 400 } }) })).toEqual({ kind: "unavailable", reason: "not_public" });
    expect(await openPlayerLink("https://www.instagram.com/reel/Cxyz/", { width: 343, fetchImpl: fakeFetch({ [url]: { status: 429 } }) })).toEqual({ kind: "unavailable", reason: "no_answer" });
  });

  it("vérification TikTok : réponses lues comme le serveur (oembed.ts l.32-41), code d'intégration gardé", async () => {
    const url = "https://www.tiktok.com/oembed?url=x";
    const quote = '<blockquote class="tiktok-embed"></blockquote>';
    expect(await checkTikTok(url, fakeFetch({ [url]: { body: { type: "video", html: quote } } }))).toEqual({ status: "ok", html: quote });
    expect(await checkTikTok(url, fakeFetch({ [url]: { body: { type: "rich" } } }))).toEqual({ status: "not_a_video", html: null });
    expect((await checkTikTok(url, fakeFetch({ [url]: { status: 400 } }))).status).toBe("not_public");
    expect((await checkTikTok(url, fakeFetch({ [url]: { status: 503 } }))).status).toBe("no_answer");
    expect((await checkTikTok(url, fakeFetch({}))).status).toBe("network");
    expect((await checkTikTok(null, fakeFetch({}))).status).toBe("skipped");
    expect(oembedVerdict(204)).toBe("ok");
  });
});

describe("vue web : navigations admises", () => {
  const base = "https://mon-app-shopping-ia-web.onrender.com/";

  it("page hôte et cadres https seulement ; jamais une autre page ni un schéma d'app", () => {
    expect(isAllowedNavigation({ url: base, isTopFrame: true }, [base])).toBe(true);
    expect(isAllowedNavigation({ url: "https://mon-app-shopping-ia-web.onrender.com", isTopFrame: true }, [base])).toBe(true);
    expect(isAllowedNavigation({ url: `https://www.tiktok.com/player/v1/${ID}?autoplay=1`, isTopFrame: false }, [base])).toBe(true);
    expect(isAllowedNavigation({ url: "about:blank", isTopFrame: false }, [base])).toBe(true);
    expect(isAllowedNavigation({ url: "https://www.tiktok.com/@a", isTopFrame: true }, [base])).toBe(false);
    expect(isAllowedNavigation({ url: "instagram://media?id=1", isTopFrame: true }, [base])).toBe(false);
    expect(isAllowedNavigation({ url: "instagram://media?id=1", isTopFrame: false }, [base])).toBe(false);
  });

  it("origine de la page hôte : le site de Spotto", () => {
    expect(playerBaseUrl("https://mon-app-shopping-ia-web.onrender.com")).toBe(base);
    expect(sameDocument(`${base}#x`, base)).toBe(true);
    expect(sameDocument("https://www.instagram.com/reel/X/embed/", base)).toBe(false);
  });
});

describe("lien en attente et disponibilité du lecteur", () => {
  it("gardé en mémoire le temps du parcours, puis oublié", () => {
    holdPlayerLink({ url: "https://vm.tiktok.com/ZMabc123/", platform: "tiktok", source: "share" });
    expect(getHeldPlayerLink()).toEqual({ url: "https://vm.tiktok.com/ZMabc123/", platform: "tiktok", source: "share" });
    clearPlayerLink();
    expect(getHeldPlayerLink()).toBeNull();
  });

  it("départ d'un ancien écran Lecteur : le lien d'un nouveau partage n'est pas effacé (contre-expertise n° 2c)", () => {
    const old = { url: "https://vm.tiktok.com/A/", platform: "tiktok" as const, source: "share" as const };
    const fresh = { url: "https://vm.tiktok.com/B/", platform: "tiktok" as const, source: "share" as const };
    holdPlayerLink(old);
    holdPlayerLink(fresh);
    clearPlayerLink(old);
    expect(getHeldPlayerLink()).toBe(fresh);
    clearPlayerLink(fresh);
    expect(getHeldPlayerLink()).toBeNull();
  });

  it("app iPhone seulement, interrupteur allumé, module de capture présent", () => {
    expect(playerAllowed("ios", true, true)).toBe(true);
    expect(playerAllowed("web", true, true)).toBe(false);
    expect(playerAllowed("android", true, true)).toBe(false);
    expect(playerAllowed("ios", false, true)).toBe(false);
    expect(playerAllowed("ios", true, false)).toBe(false);
  });

  it("une constante par plateforme (contre-expertise n° 6)", () => {
    expect(enabledPlayerPlatforms(true, { tiktok: true, instagram: false })).toEqual(["tiktok"]);
    expect(enabledPlayerPlatforms(true, { tiktok: true, instagram: true })).toEqual(["tiktok", "instagram"]);
    expect(enabledPlayerPlatforms(false, { tiktok: true, instagram: true })).toEqual([]);
  });
});
