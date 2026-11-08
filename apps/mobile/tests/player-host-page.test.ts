import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMBED_RELAY,
  EMBED_RELAY_SHA256,
  HOST_MESSAGE_SOURCE,
  HOST_PAGE_CSP,
  TIKTOK_RELAY,
  TIKTOK_RELAY_SHA256,
  escapeHtmlAttribute,
  instagramEmbedMarkup,
  instagramHostPage,
  tiktokEmbedHostPage,
  tiktokEmbedMarkup,
  tiktokHostPage,
} from "../src/lib/player-host-page";
import { checkTikTok, instagramOEmbedUrl, openPlayerLink, tiktokPlayerUrl, type FetchLike } from "../src/lib/player-link";

// Lot « lecteur intégré » : la page hôte n'affiche rien d'elle-même et ne fait
// que relayer les messages du lecteur officiel.
const ID = "6718335390845095173";
const CANONICAL = "https://www.instagram.com/reel/Cxyz/";

const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
const inlineScripts = (page: string) => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
const withoutScripts = (page: string) => page.replace(/<script>[\s\S]*?<\/script>/g, "");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
const allPages = () => [tiktokHostPage(tiktokPlayerUrl(ID), "Vidéo TikTok"), instagramHostPage(CANONICAL, "Vidéo Instagram"), tiktokEmbedHostPage(ID, "Vidéo TikTok")];

describe("page hôte du lecteur", () => {
  it("TikTok : lecteur officiel en plein cadre, aucun texte visible", () => {
    const page = tiktokHostPage("https://www.tiktok.com/player/v1/1?autoplay=1&loop=1", "Vidéo TikTok");
    expect(page).toContain('src="https://www.tiktok.com/player/v1/1?autoplay=1&amp;loop=1"');
    expect(page).toContain('title="Vidéo TikTok"');
    expect(page).toContain('allow="autoplay; encrypted-media"');
    expect(visibleText(page)).toBe("");
  });

  it("TikTok : seule l'adresse du lecteur officiel est chargée dans le cadre", () => {
    for (const url of ["javascript:alert(1)", "https://evil.example/player/v1/1", "https://www.tiktok.com.evil.example/player/v1/1", 'https://www.tiktok.com/player/v1/1"><img src=x onerror=alert(1)>']) {
      const page = tiktokHostPage(url, "t");
      expect(page).toContain('src="about:blank"');
      expect(page).not.toContain("evil");
      expect(page).not.toContain("onerror");
    }
  });

  it("Instagram : le code officiel reconstruit depuis l'adresse canonique, puis embed.js", () => {
    const page = instagramHostPage(CANONICAL, "Vidéo Instagram");
    expect(page).toContain(`<blockquote class="instagram-media" data-instgrm-permalink="${CANONICAL}" data-instgrm-version="14"`);
    expect(page).toContain('data-sdk="instagram"');
    expect(EMBED_RELAY).toContain('instagram: "https://www.instagram.com/embed.js"');
    expect(EMBED_RELAY).toContain("window.instgrm.Embeds.process()");
    expect(visibleText(page)).toBe("");
  });

  it("TikTok, repli (contre-expertise n° 9) : le blockquote reconstruit depuis l'identifiant, puis embed.js de TikTok", () => {
    const page = tiktokEmbedHostPage(ID, "Vidéo TikTok");
    expect(page).toContain(`<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@_/video/${ID}" data-video-id="${ID}"`);
    expect(page).toContain('data-sdk="tiktok"');
    expect(EMBED_RELAY).toContain('tiktok: "https://www.tiktok.com/embed.js"');
    expect(visibleText(page)).toBe("");
  });

  it("attributs échappés", () => {
    expect(escapeHtmlAttribute(`a"<b>&'`)).toBe("a&quot;&lt;b&gt;&amp;&#39;");
  });

  it("scripts de relais : syntaxe valide, marque de la page hôte ; taille du code d'intégration envoyée (n° 13)", () => {
    for (const page of allPages()) {
      const scripts = inlineScripts(page);
      expect(scripts).toHaveLength(1);
      expect(() => new Function(scripts[0] ?? "")).not.toThrow();
      expect(scripts[0]).toContain(HOST_MESSAGE_SOURCE);
    }
    expect(instagramHostPage(CANONICAL, "t")).toContain('type: "size"');
  });
});

describe("page hôte : aucun code venu de TikTok ou d'Instagram", () => {
  // Légende, nom d'auteur et mots-clés sont écrits par n'importe qui et
  // reviennent dans le html des oEmbed : rien de ce html ne doit apparaître.
  const HOSTILE = [
    '<img src=x onerror="window.ReactNativeWebView.postMessage(1)">',
    "<svg onload=alert(1)>",
    '<iframe srcdoc="<script>parent.ReactNativeWebView.postMessage(1)</script>"></iframe>',
    'légende piégée" onmouseover="alert(1)',
    "<a href=\"javascript:alert(1)\">#mode</a>",
  ].join("");
  const MARKERS = ["onerror", "onload=", "onmouseover", "<img", "<svg", "srcdoc", "<iframe srcdoc", "javascript:", "légende piégée", "#mode", "evil"];

  function network(routes: Record<string, unknown>): FetchLike {
    return async (url) => ({ ok: true, status: 200, url, json: async () => routes[url] ?? {} });
  }

  it("Instagram : le html de l'oEmbed ne sert qu'à vérifier ; la page n'en contient rien", async () => {
    const html = `<blockquote class="instagram-media" data-instgrm-permalink="${CANONICAL}">${HOSTILE}</blockquote>`;
    const opening = await openPlayerLink(`${CANONICAL}?igsh=abc`, { platform: "instagram", width: 343, fetchImpl: network({ [instagramOEmbedUrl(CANONICAL, 343)]: { html } }) });
    expect(opening.kind).toBe("embed");
    if (opening.kind !== "embed" || opening.embed.platform !== "instagram") throw new Error("embed attendu");
    expect(JSON.stringify(opening)).not.toContain("onerror");
    const page = instagramHostPage(opening.embed.canonical, "Vidéo Instagram");
    for (const marker of MARKERS) expect(withoutScripts(page)).not.toContain(marker);
    expect(page).toContain(`data-instgrm-permalink="${CANONICAL}"`);
  });

  it("TikTok (repli) : la vérification ne garde qu'un oui/non ; la page n'en contient rien", async () => {
    const oembed = "https://www.tiktok.com/oembed?url=x";
    const html = `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@a/video/${ID}" data-video-id="${ID}"><section>${HOSTILE}</section></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;
    const check = await checkTikTok(oembed, network({ [oembed]: { type: "video", html, author_name: HOSTILE, title: HOSTILE } }));
    expect(check).toEqual({ status: "ok", embeddable: true });
    const page = tiktokEmbedHostPage(ID, "Vidéo TikTok");
    for (const marker of MARKERS) expect(withoutScripts(page)).not.toContain(marker);
  });

  it("identifiant TikTok : chiffres seulement, sinon page vide et embed.js non chargé", () => {
    expect(tiktokEmbedMarkup(ID)).toContain(`data-video-id="${ID}"`);
    for (const id of [`${ID}"><img src=x onerror=alert(1)>`, "abc12345678", "12345678 ", "", "1234567", `${ID}${ID}`]) {
      expect(tiktokEmbedMarkup(id)).toBe("");
      const page = tiktokEmbedHostPage(id, "t");
      expect(page).not.toContain("<blockquote");
      expect(page).not.toContain("onerror");
      expect(page).toContain('data-sdk=""');
    }
  });

  it("adresse Instagram : seulement l'adresse canonique, écrite échappée dans l'attribut", () => {
    expect(instagramEmbedMarkup("https://www.instagram.com/p/BQ0eAlwhDrw/")).toContain('data-instgrm-permalink="https://www.instagram.com/p/BQ0eAlwhDrw/"');
    for (const url of [
      'https://www.instagram.com/reel/X"onmouseover="alert(1)/',
      "https://www.instagram.com/reel/X/'><svg onload=alert(1)>",
      "javascript:alert(1)//www.instagram.com/reel/X/",
      "https://evil.example/reel/X/",
      "https://www.instagram.com.evil.example/reel/X/",
    ]) {
      expect(instagramEmbedMarkup(url)).toBe("");
      const page = instagramHostPage(url, "t");
      expect(page).not.toContain("<blockquote");
      for (const marker of ["onmouseover", "<svg", "javascript:", "evil"]) expect(page).not.toContain(marker);
      expect(page).toContain('data-sdk=""');
    }
    // Titre de l'app échappé aussi (attribut aria-label).
    expect(instagramHostPage(CANONICAL, 'a"><img onerror=x>')).toContain('aria-label="a&quot;&gt;&lt;img onerror=x&gt;"');
  });

  it("aucun attribut d'événement (onerror, onload…) hors des scripts de relais", () => {
    for (const page of allPages()) expect(withoutScripts(page)).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe("règle de sécurité de la page hôte (Content-Security-Policy)", () => {
  const directive = (name: string) => HOST_PAGE_CSP.split("; ").find((d) => d.startsWith(`${name} `));

  it("les empreintes correspondent exactement aux deux scripts de relais", () => {
    expect(sha256(TIKTOK_RELAY)).toBe(TIKTOK_RELAY_SHA256);
    expect(sha256(EMBED_RELAY)).toBe(EMBED_RELAY_SHA256);
  });

  it("chaque page la porte avant tout script, et elle autorise chacun de ses scripts", () => {
    expect(HOST_PAGE_CSP).not.toMatch(/["<>&]/);
    for (const page of allPages()) {
      const meta = page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
      expect(meta?.[1]).toBe(HOST_PAGE_CSP);
      expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script"));
      for (const script of inlineScripts(page)) expect(directive("script-src")).toContain(`'sha256-${sha256(script)}'`);
    }
  });

  it("ni script écrit dans un attribut, ni eval, ni plugin, ni <base>, ni formulaire ; cadres TikTok et Instagram seulement", () => {
    expect(HOST_PAGE_CSP).not.toContain("unsafe-inline");
    expect(HOST_PAGE_CSP).not.toContain("unsafe-eval");
    expect(HOST_PAGE_CSP).not.toContain("unsafe-hashes");
    expect(directive("script-src")).toBe(`script-src 'sha256-${TIKTOK_RELAY_SHA256}' 'sha256-${EMBED_RELAY_SHA256}' 'strict-dynamic' https://www.tiktok.com https://www.instagram.com`);
    expect(directive("script-src-attr")).toBe("script-src-attr 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'none'");
    expect(directive("form-action")).toBe("form-action 'none'");
    expect(directive("frame-src")).toBe("frame-src https://tiktok.com https://*.tiktok.com https://instagram.com https://*.instagram.com");
  });
});

describe("relais TikTok : origine des messages vérifiée", () => {
  // Le script de relais exécuté avec une fausse page : un cadre, le pont vers l'app.
  function runRelay() {
    const toApp: string[] = [];
    const toPlayer: unknown[][] = [];
    const contentWindow = { postMessage: (...args: unknown[]) => toPlayer.push(args) };
    let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | null = null;
    const fakeWindow = {
      ReactNativeWebView: { postMessage: (message: string) => toApp.push(message) },
      addEventListener: (_type: string, fn: typeof listener) => {
        listener = fn;
      },
    };
    const fakeDocument = { getElementById: () => ({ contentWindow }) };
    new Function("window", "document", TIKTOK_RELAY)(fakeWindow, fakeDocument);
    return { toApp, toPlayer, contentWindow, dispatch: (event: { source: unknown; origin: string; data: unknown }) => listener?.(event) };
  }
  const ready = { "x-tiktok-player": true, type: "onPlayerReady" };

  it("message du cadre venu de https://www.tiktok.com : relayé ; d'une autre origine : ignoré", () => {
    const relay = runRelay();
    for (const origin of ["https://evil.example", "https://tiktok.com", "https://www.tiktok.com.evil.example", "null", ""]) {
      relay.dispatch({ source: relay.contentWindow, origin, data: ready });
    }
    expect(relay.toApp).toEqual([]);
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: ready });
    expect(relay.toApp.map((message) => JSON.parse(message))).toEqual([{ kind: "tiktok", type: "onPlayerReady", value: null, origin: "https://www.tiktok.com", source: HOST_MESSAGE_SOURCE }]);
  });

  it("message d'un autre cadre, même à la bonne origine : ignoré", () => {
    const relay = runRelay();
    relay.dispatch({ source: { postMessage: () => {} }, origin: "https://www.tiktok.com", data: ready });
    expect(relay.toApp).toEqual([]);
    expect(relay.toPlayer).toEqual([]);
  });

  it("commande de l'app : transmise au lecteur, adressée à sa seule origine", () => {
    const relay = runRelay();
    relay.dispatch({ source: null, origin: "", data: JSON.stringify({ type: "seekTo", value: 3 }) });
    relay.dispatch({ source: null, origin: "", data: JSON.stringify({ type: "eval" }) });
    expect(relay.toPlayer).toEqual([[{ "x-tiktok-player": true, type: "seekTo", value: 3 }, "https://www.tiktok.com"]]);
    expect(TIKTOK_RELAY).not.toContain('"*"');
  });
});
