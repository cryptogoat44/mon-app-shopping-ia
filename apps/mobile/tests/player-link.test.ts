import { describe, expect, it } from "vitest";
import {
  checkTikTok,
  clearPlayerLink,
  embedAllowed,
  enabledPlayerPlatforms,
  getHeldPlayerLink,
  holdPlayerLink,
  instagramOEmbedUrl,
  isAllowedNavigation,
  offersInstagramEmbed,
  offersTikTokEmbed,
  oembedVerdict,
  openPlayerLink,
  playerAllowed,
  playerAppUrl,
  playerBaseUrl,
  readPlayerLink,
  sameDocument,
  shortLinkHop,
  TIKTOK_ORIGIN,
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
      page: `https://www.tiktok.com/@${account}/${media}/${ID}`,
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
    expect(readPlayerLink(url)).toEqual({ kind: "tiktok", id: ID, media: "video", page: `https://www.tiktok.com/@_/video/${ID}`, oembedUrl: null });
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
    // Origine attendue des messages du lecteur (relais de la page hôte).
    expect(new URL(tiktokPlayerUrl(ID)).origin).toBe(TIKTOK_ORIGIN);
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

  it("html d'oEmbed Instagram : lu seulement pour savoir si le code officiel est proposé", () => {
    const html = '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/reel/X/"></blockquote>';
    expect(offersInstagramEmbed({ html })).toBe(true);
    expect(offersInstagramEmbed({ html: "<div>autre</div>" })).toBe(false);
    expect(offersInstagramEmbed({ html: 42 })).toBe(false);
    expect(offersInstagramEmbed(null)).toBe(false);
  });

  it("html d'oEmbed TikTok (repli, contre-expertise n° 9) : lu seulement pour savoir si le code officiel est proposé", () => {
    const quote = `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@a/video/${ID}" data-video-id="${ID}"><section></section></blockquote>`;
    expect(offersTikTokEmbed({ html: `${quote} <script async src="https://www.tiktok.com/embed.js"></script>` })).toBe(true);
    expect(offersTikTokEmbed({ html: "<div>autre</div>" })).toBe(false);
    expect(offersTikTokEmbed({})).toBe(false);
  });
});

describe("ouverture du lecteur", () => {
  it("TikTok direct : aucun appel réseau avant le lecteur", async () => {
    const network = fakeFetch({});
    const opening = await openPlayerLink(`https://www.tiktok.com/@a/video/${ID}?_r=1`, { platform: "tiktok", width: 343, fetchImpl: network });
    expect(opening).toMatchObject({ kind: "embed", embed: { platform: "tiktok", variant: "player", id: ID, playerUrl: tiktokPlayerUrl(ID) } });
    expect(network.calls).toEqual([]);
  });

  it("lien court TikTok : suivi jusqu'à l'adresse finale", async () => {
    const network = fakeFetch({ "https://vm.tiktok.com/ZMabc123/": { url: `https://www.tiktok.com/@a/video/${ID}?_t=1` } });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { platform: "tiktok", width: 343, fetchImpl: network })).toMatchObject({ kind: "embed", embed: { platform: "tiktok", id: ID } });
  });

  it("lien court sans vidéo au bout : « short_link » ; hors ligne : « network »", async () => {
    const login = fakeFetch({ "https://vm.tiktok.com/ZMabc123/": { url: "https://www.tiktok.com/login" } });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { platform: "tiktok", width: 343, fetchImpl: login })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { platform: "tiktok", width: 343, fetchImpl: fakeFetch({}) })).toEqual({ kind: "unavailable", reason: "network" });
  });

  it("second suivi dans la vue web (contre-expertise n° 4b) : vidéo trouvée, redirection suivie, le reste arrêté", () => {
    expect(shortLinkHop(`https://www.tiktok.com/@a/video/${ID}?_t=1`, "tiktok")).toBe("resolved");
    expect(shortLinkHop("https://www.instagram.com/reel/Cxyz/", "instagram")).toBe("resolved");
    expect(shortLinkHop("https://vm.tiktok.com/ZMabc123/", "tiktok")).toBe("follow");
    expect(shortLinkHop("https://www.tiktok.com/login", "tiktok")).toBe("follow");
    expect(shortLinkHop("snssdk1233://aweme/detail/1", "tiktok")).toBe("stop");
    expect(shortLinkHop("https://example.com/x", "tiktok")).toBe("stop");
    expect(shortLinkHop("http://vm.tiktok.com/ZMabc123/", "tiktok")).toBe("stop");
  });

  it("second suivi : un lien qui mène à l'autre plateforme est arrêté (accord donné pour une seule)", () => {
    expect(shortLinkHop("https://www.instagram.com/reel/Cxyz/", "tiktok")).toBe("stop");
    expect(shortLinkHop("https://www.instagram.com/accounts/login/", "tiktok")).toBe("stop");
    expect(shortLinkHop(`https://www.tiktok.com/@a/video/${ID}`, "instagram")).toBe("stop");
    expect(shortLinkHop("https://vm.tiktok.com/ZMabc123/", "instagram")).toBe("stop");
    expect(shortLinkHop("https://tiktok.com.evil.example/ZMabc123/", "tiktok")).toBe("stop");
  });

  it("lien court qui mène à l'autre plateforme : refusé avant tout appel oEmbed", async () => {
    const toInstagram = fakeFetch({ "https://vm.tiktok.com/ZMabc123/": { url: "https://www.instagram.com/reel/Cxyz/" } });
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { platform: "tiktok", width: 343, fetchImpl: toInstagram })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(toInstagram.calls).toEqual(["https://vm.tiktok.com/ZMabc123/"]);
    const toTikTok = fakeFetch({ "https://www.instagram.com/share/reel/BAGxyz/": { url: `https://www.tiktok.com/@a/video/${ID}` } });
    expect(await openPlayerLink("https://www.instagram.com/share/reel/BAGxyz/", { platform: "instagram", width: 343, fetchImpl: toTikTok })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(toTikTok.calls).toEqual(["https://www.instagram.com/share/reel/BAGxyz/"]);
  });

  it("lien d'une autre plateforme que celle attendue : refusé sans aucun appel réseau", async () => {
    const network = fakeFetch({});
    expect(await openPlayerLink("https://vm.tiktok.com/ZMabc123/", { platform: "instagram", width: 343, fetchImpl: network })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(await openPlayerLink("https://www.instagram.com/reel/Cxyz/", { platform: "tiktok", width: 343, fetchImpl: network })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(await openPlayerLink(`https://www.tiktok.com/@a/video/${ID}`, { platform: "instagram", width: 343, fetchImpl: network })).toEqual({ kind: "unavailable", reason: "short_link" });
    expect(network.calls).toEqual([]);
  });

  it("lien d'un bon site sans vidéo : « not_a_video »", async () => {
    expect(await openPlayerLink("https://www.tiktok.com/@user/live", { platform: "tiktok", width: 343, fetchImpl: fakeFetch({}) })).toEqual({ kind: "unavailable", reason: "not_a_video" });
  });

  it("Instagram : 200 → code officiel ; 400 → non publique ; 429 → ne répond pas", async () => {
    const url = instagramOEmbedUrl("https://www.instagram.com/reel/Cxyz/", 343);
    const html = '<blockquote class="instagram-media"></blockquote>';
    const ok = await openPlayerLink("https://www.instagram.com/reel/Cxyz/?igsh=abc", { platform: "instagram", width: 343, fetchImpl: fakeFetch({ [url]: { body: { html } } }) });
    expect(ok).toEqual({ kind: "embed", embed: { platform: "instagram", variant: "oembed", code: "Cxyz", media: "reel", canonical: "https://www.instagram.com/reel/Cxyz/" } });
    expect(await openPlayerLink("https://www.instagram.com/reel/Cxyz/", { platform: "instagram", width: 343, fetchImpl: fakeFetch({ [url]: { status: 400 } }) })).toEqual({ kind: "unavailable", reason: "not_public" });
    expect(await openPlayerLink("https://www.instagram.com/reel/Cxyz/", { platform: "instagram", width: 343, fetchImpl: fakeFetch({ [url]: { status: 429 } }) })).toEqual({ kind: "unavailable", reason: "no_answer" });
  });

  it("vérification TikTok : réponses lues comme le serveur (oembed.ts l.32-41), code d'intégration gardé", async () => {
    const url = "https://www.tiktok.com/oembed?url=x";
    const quote = '<blockquote class="tiktok-embed"></blockquote>';
    expect(await checkTikTok(url, fakeFetch({ [url]: { body: { type: "video", html: quote } } }))).toEqual({ status: "ok", embeddable: true });
    expect(await checkTikTok(url, fakeFetch({ [url]: { body: { type: "video" } } }))).toEqual({ status: "ok", embeddable: false });
    expect(await checkTikTok(url, fakeFetch({ [url]: { body: { type: "rich" } } }))).toEqual({ status: "not_a_video", embeddable: false });
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

  it("cadres intégrés : seulement les sites des lecteurs, en https, comparés au nom d'hôte exact", () => {
    for (const url of [
      `https://www.tiktok.com/embed/v2/${ID}?lang=fr`,
      "https://tiktok.com/x",
      "https://verification.tiktok.com/x",
      "https://www.instagram.com/reel/Cxyz/embed/?cr=1&v=14",
      "https://scontent-cdg4-1.cdninstagram.com/v/x.mp4",
      "https://p16-sign.tiktokcdn-us.com/x",
      "https://sf16.tiktokcdn.com/x",
      "https://staticxx.facebook.com/x",
      "https://static.xx.fbcdn.net/x",
    ]) {
      expect(isAllowedNavigation({ url, isTopFrame: false }, [base])).toBe(true);
    }
    for (const url of [
      "about:srcdoc",
      "https://evil.example/",
      "https://tiktok.com.evil.example/x",
      "https://www.tiktok.com.evil.example/x",
      "https://eviltiktok.com/x",
      "https://instagram.com-evil.example/x",
      "https://notinstagram.com/x",
      "https://evil.example/www.tiktok.com/",
      "https://evil.example/?u=https://www.tiktok.com",
      "https://www.tiktok.com@evil.example/x",
      "https://evil.example\\@www.tiktok.com/x",
      "https://user:pass@www.tiktok.com/x",
      "https://www.tiktok.com:8443/x",
      "http://www.tiktok.com/x",
      "javascript:alert(1)//www.tiktok.com",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://www.tiktok.com/1234",
      base,
    ]) {
      expect(isAllowedNavigation({ url, isTopFrame: false }, [base])).toBe(false);
    }
    expect(isAllowedNavigation({ url: "about:srcdoc", isTopFrame: true }, [base])).toBe(false);
  });

  it("origine de la page hôte : le site de Spotto", () => {
    expect(playerBaseUrl("https://mon-app-shopping-ia-web.onrender.com")).toBe(base);
    expect(sameDocument(`${base}#x`, base)).toBe(true);
    expect(sameDocument("https://www.instagram.com/reel/X/embed/", base)).toBe(false);
  });
});

describe("« Ouvrir dans TikTok / Instagram » : adresse reconstruite, jamais le texte collé", () => {
  it.each([
    [`https://www.tiktok.com/@scout2015/video/${ID}?_t=8abc&_r=1`, "tiktok", `https://www.tiktok.com/@scout2015/video/${ID}`],
    [`https://www.tiktok.com/player/v1/${ID}?autoplay=1`, "tiktok", `https://www.tiktok.com/@_/video/${ID}`],
    [`https://www.tiktok.com/@a%22onload/video/${ID}`, "tiktok", `https://www.tiktok.com/@_/video/${ID}`],
    ["https://vm.tiktok.com/ZMabc123/", "tiktok", "https://vm.tiktok.com/ZMabc123/"],
    ["https://user:pass@vm.tiktok.com:8080/ZMabc123/?x=1", "tiktok", "https://vm.tiktok.com/ZMabc123/"],
    ["https://www.instagram.com/marvelskies.fc/reel/CWqAgUZgCku/?igsh=abc", "instagram", "https://www.instagram.com/reel/CWqAgUZgCku/"],
    ["https://www.instagram.com/share/reel/BAGxyz/", "instagram", "https://www.instagram.com/share/reel/BAGxyz/"],
  ] as const)("« %s » → %s", (raw, platform, expected) => {
    expect(playerAppUrl(raw, platform)).toBe(expected);
  });

  it.each([
    "https://vm.tiktok.com\\@evil.com/x",
    "https://vm.tiktok.com\\\\evil.com/x",
    "https:\\\\vm.tiktok.com\\ZMabc123",
    "https://vm.tiktok.com/%2e%2e/@evil.com",
  ])("barre oblique inversée ou « @ » dans « %s » : rouvert chez tiktok.com, sans le texte collé", (raw) => {
    const url = playerAppUrl(raw, "tiktok");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("vm.tiktok.com");
    expect(parsed.username).toBe("");
    expect(url).not.toContain("\\");
    expect(url!.startsWith("https://vm.tiktok.com/")).toBe(true);
  });

  it.each([
    "https://evil.com\\@vm.tiktok.com/x",
    "https://vm.tiktok.com%2F@evil.com/x",
    "https://vm.tiktok.com%5C@evil.com/x",
    "https://vm.tiktok.com%40evil.com/x",
    "https://vm.tiktok.com\t@evil.com/x",
    "https://vm.tiktok.com\uFF0F@evil.com/x",
    "https://vm.tiktok.com@evil.com/x",
    "https://tiktok.com.evil.example/ZMabc123/",
    "https://eviltiktok.com/ZMabc123/",
    "javascript:alert(1)//vm.tiktok.com/x",
    "snssdk1233://aweme/detail/1",
    "https://www.tiktok.com/@user/live",
  ])("« %s » : rien à ouvrir", (raw) => {
    expect(playerAppUrl(raw, "tiktok")).toBeNull();
  });

  it("lien d'une autre plateforme que celle tenue : rien à ouvrir", () => {
    expect(playerAppUrl("https://www.instagram.com/reel/Cxyz/", "tiktok")).toBeNull();
    expect(playerAppUrl("https://vm.tiktok.com/ZMabc123/", "instagram")).toBeNull();
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

  it("vidéo trouvée chargée seulement si elle est de la plateforme du lien collé, toujours ouverte", () => {
    const tiktok = { platform: "tiktok", variant: "oembed", id: ID } as const;
    const instagram = { platform: "instagram", variant: "oembed", code: "Cxyz", media: "reel", canonical: "https://www.instagram.com/reel/Cxyz/" } as const;
    expect(embedAllowed(tiktok, "tiktok", ["tiktok", "instagram"])).toBe(true);
    expect(embedAllowed(instagram, "tiktok", ["tiktok", "instagram"])).toBe(false);
    expect(embedAllowed(tiktok, "instagram", ["tiktok", "instagram"])).toBe(false);
    expect(embedAllowed(instagram, "instagram", ["tiktok"])).toBe(false);
    expect(embedAllowed(tiktok, "tiktok", [])).toBe(false);
  });

  it("une constante par plateforme (contre-expertise n° 6)", () => {
    expect(enabledPlayerPlatforms(true, { tiktok: true, instagram: false })).toEqual(["tiktok"]);
    expect(enabledPlayerPlatforms(true, { tiktok: true, instagram: true })).toEqual(["tiktok", "instagram"]);
    expect(enabledPlayerPlatforms(false, { tiktok: true, instagram: true })).toEqual([]);
  });
});
