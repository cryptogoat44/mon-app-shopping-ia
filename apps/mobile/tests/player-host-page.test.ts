import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HOST_MESSAGE_SOURCE,
  INSTAGRAM_EMBED_SCRIPT,
  INSTAGRAM_PAGE_CSP,
  INSTAGRAM_RELAY,
  INSTAGRAM_RELAY_SHA256,
  TIKTOK_PAGE_CSP,
  TIKTOK_RELAY,
  TIKTOK_RELAY_SHA256,
  escapeHtmlAttribute,
  instagramHostPage,
  sanitizeInstagramEmbed,
  tiktokHostPage,
} from "../src/lib/player-host-page";

// Mission « liens vidéo » : les pages hôtes sont écrites par l'app, n'affichent
// rien d'elles-mêmes, ne touchent jamais au lecteur officiel et ne font que
// relayer ses messages. TikTok : le lecteur construit depuis l'identifiant
// seul. Instagram : le code d'intégration du serveur, vérifié, puis embed.js
// (le seul script tiers admis).
const ID = "6718335390845095173";
const PERMALINK = "https://www.instagram.com/reel/CWqAgUZgCku/?utm_source=ig_embed&amp;utm_campaign=loading";
/** Forme du code renvoyé par l'oEmbed de Meta (omitscript=true), abrégée. */
const OFFICIAL = `<blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="${PERMALINK}" data-instgrm-version="14" style=" background:#FFF; border:0; margin: 1px; max-width:540px;"><div style="padding:16px;"> <a href="${PERMALINK}" style=" background:#FFFFFF; text-decoration:none;" target="_blank"> <div style=" display: flex;"><svg width="50px" height="50px" viewBox="0 0 60 60" version="1.1" xmlns="https://www.w3.org/2000/svg" xmlns:xlink="https://www.w3.org/1999/xlink"><g stroke="none" fill="none"><path d="M556.869,30.41 C554.814,30.41"></path></g></svg></div></a><p style=" margin:8px 0 0 0;"><a href="${PERMALINK}" style=" color:#c9c8cd;" target="_blank">Une publication partagée par Big data: la mode (@mode.fr)</a></p></div></blockquote>`;

const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
const inlineScripts = (page: string) => [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
const tiktokPage = () => tiktokHostPage(ID, "Vidéo TikTok")!;
const instagramPage = () => instagramHostPage(OFFICIAL, "Vidéo Instagram")!;
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("page hôte TikTok : le lecteur officiel, depuis l'identifiant seul", () => {
  it("cadre https://www.tiktok.com/player/v1/{id}, lecture automatique, aucun texte visible", () => {
    const page = tiktokPage();
    expect(page).toContain(`<iframe id="player" src="https://www.tiktok.com/player/v1/${ID}?autoplay=1"`);
    expect(page).toContain('title="Vidéo TikTok"');
    expect(page).toContain('allow="autoplay; encrypted-media"');
    expect(visibleText(page)).toBe("");
  });

  it("identifiant qui n'est pas fait de chiffres : aucune page (écran de secours)", () => {
    for (const id of [`${ID}"><img src=x onerror=alert(1)>`, "abc12345678", "12345 ", "", "12345", `${ID}${ID}`, "../player/v1/1", "1".repeat(26)]) {
      expect(tiktokHostPage(id, "t")).toBeNull();
    }
  });

  it("titre de l'app échappé", () => {
    expect(escapeHtmlAttribute(`a"<b>&'`)).toBe("a&quot;&lt;b&gt;&amp;&#39;");
    expect(tiktokHostPage(ID, 'a"><img onerror=x>')).toContain('title="a&quot;&gt;&lt;img onerror=x&gt;"');
  });

  it("aucun autre script que le relais, aucun attribut d'événement", () => {
    const page = tiktokPage();
    expect(inlineScripts(page)).toEqual([TIKTOK_RELAY]);
    expect(page.match(/<script/g)).toHaveLength(1);
    expect(page.replace(/<script>[\s\S]*?<\/script>/g, "")).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe("relais TikTok : messages au format x-tiktok-player, origine vérifiée", () => {
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
  const fromPlayer = (type: string, value?: unknown) => ({ "x-tiktok-player": true, type, ...(value === undefined ? {} : { value }) });

  it("événements du lecteur (onPlayerReady, onStateChange, onCurrentTime, onPlayerError) relayés à l'app, marqués", () => {
    const relay = runRelay();
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: fromPlayer("onPlayerReady") });
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: fromPlayer("onStateChange", 1) });
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: fromPlayer("onCurrentTime", { currentTime: 3.7, duration: 12 }) });
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: fromPlayer("onPlayerError", { errorCode: 1001, errorType: "invalid" }) });
    expect(relay.toApp.map((message) => JSON.parse(message))).toEqual([
      { kind: "tiktok", type: "onPlayerReady", value: null, origin: "https://www.tiktok.com", source: HOST_MESSAGE_SOURCE },
      { kind: "tiktok", type: "onStateChange", value: 1, origin: "https://www.tiktok.com", source: HOST_MESSAGE_SOURCE },
      { kind: "tiktok", type: "onCurrentTime", value: { currentTime: 3.7, duration: 12 }, origin: "https://www.tiktok.com", source: HOST_MESSAGE_SOURCE },
      { kind: "tiktok", type: "onPlayerError", value: { errorCode: 1001, errorType: "invalid" }, origin: "https://www.tiktok.com", source: HOST_MESSAGE_SOURCE },
    ]);
  });

  it("message d'une autre origine, d'un autre cadre, ou sans la marque x-tiktok-player : ignoré", () => {
    const relay = runRelay();
    for (const origin of ["https://evil.example", "https://tiktok.com", "https://www.tiktok.com.evil.example", "null", ""]) {
      relay.dispatch({ source: relay.contentWindow, origin, data: fromPlayer("onPlayerReady") });
    }
    relay.dispatch({ source: { postMessage: () => {} }, origin: "https://www.tiktok.com", data: fromPlayer("onPlayerReady") });
    relay.dispatch({ source: relay.contentWindow, origin: "https://www.tiktok.com", data: { type: "onPlayerReady" } });
    expect(relay.toApp).toEqual([]);
    expect(relay.toPlayer).toEqual([]);
  });

  it("commandes de l'app (play, pause, seekTo, mute, unMute) : { type, value, x-tiktok-player } à la seule origine du lecteur", () => {
    const relay = runRelay();
    for (const type of ["play", "pause", "mute", "unMute"]) relay.dispatch({ source: null, origin: "", data: JSON.stringify({ type }) });
    relay.dispatch({ source: null, origin: "", data: JSON.stringify({ type: "seekTo", value: 3 }) });
    relay.dispatch({ source: null, origin: "", data: JSON.stringify({ type: "eval" }) });
    relay.dispatch({ source: null, origin: "", data: "pas du JSON" });
    expect(relay.toPlayer).toEqual([
      [{ "x-tiktok-player": true, type: "play" }, "https://www.tiktok.com"],
      [{ "x-tiktok-player": true, type: "pause" }, "https://www.tiktok.com"],
      [{ "x-tiktok-player": true, type: "mute" }, "https://www.tiktok.com"],
      [{ "x-tiktok-player": true, type: "unMute" }, "https://www.tiktok.com"],
      [{ "x-tiktok-player": true, type: "seekTo", value: 3 }, "https://www.tiktok.com"],
    ]);
    expect(TIKTOK_RELAY).not.toContain('"*"');
  });
});

describe("page hôte Instagram : le code officiel du serveur, vérifié, puis embed.js seulement", () => {
  it("le code est écrit tel quel dans la page, puis le relais ajoute https://www.instagram.com/embed.js", () => {
    const page = instagramPage();
    expect(page).toContain(OFFICIAL);
    expect(INSTAGRAM_EMBED_SCRIPT).toBe("https://www.instagram.com/embed.js");
    expect(INSTAGRAM_RELAY).toContain('script.src = "https://www.instagram.com/embed.js"');
    expect(INSTAGRAM_RELAY).toContain("window.instgrm.Embeds.process()");
    expect(inlineScripts(page)).toEqual([INSTAGRAM_RELAY]);
    expect(page.match(/<script/g)).toHaveLength(1);
    // Aucune autre adresse de script dans le relais.
    expect([...INSTAGRAM_RELAY.matchAll(/https:\/\/[^"\s]+/g)].map((match) => match[0])).toEqual(["https://www.instagram.com/embed.js"]);
  });

  it("code d'intégration refusé (null : écran de secours) sans le blockquote « instagram-media » ni l'adresse d'une publication Instagram", () => {
    for (const html of [
      "",
      null,
      42,
      "<div>rien</div>",
      '<blockquote class="tiktok-embed" data-instgrm-permalink="https://www.instagram.com/reel/CWqAgUZgCku/"></blockquote>',
      '<blockquote class="instagram-media"></blockquote>',
      '<blockquote class="instagram-media" data-instgrm-permalink="https://evil.example/reel/CWqAgUZgCku/"></blockquote>',
      '<blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com.evil.example/reel/CWqAgUZgCku/"></blockquote>',
      `<p>avant</p>${OFFICIAL}`,
      `${OFFICIAL}<p>après</p>`,
      `${OFFICIAL.slice(0, -"</blockquote>".length)}`,
      "x".repeat(40_000),
    ]) {
      expect(sanitizeInstagramEmbed(html), String(html).slice(0, 60)).toBeNull();
      expect(instagramHostPage(html, "t")).toBeNull();
    }
  });

  it("code d'intégration refusé s'il contient un autre <script>, un cadre, un attribut d'événement ou une adresse javascript:/data:", () => {
    const inject = (piece: string) => OFFICIAL.replace("<p ", `${piece}<p `);
    for (const piece of [
      '<script src="https://www.instagram.com/embed.js"></script>',
      "<script>window.ReactNativeWebView.postMessage(1)</script>",
      "<SCRIPT>alert(1)</SCRIPT>",
      '<iframe src="https://www.instagram.com/"></iframe>',
      '<iframe srcdoc="<script>parent.ReactNativeWebView.postMessage(1)</script>"></iframe>',
      '<img src=x onerror="alert(1)">',
      "<svg onload=alert(1)></svg>",
      '<a href="javascript:alert(1)">#mode</a>',
      '<a href="  JaVaScRiPt:alert(1)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="java&Tab;script:alert(1)">x</a>',
      '<a href="data:text/html,<b>x</b>">x</a>',
      '<object data="x"></object>',
      '<embed src="x">',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<base href="https://evil.example/">',
      '<form action="https://evil.example"><input></form>',
      "<style>body{background:url(https://evil.example)}</style>",
      '<svg><use href="#x"></use></svg>',
      '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
      "<svg><foreignObject><div>x</div></foreignObject></svg>",
    ]) {
      expect(sanitizeInstagramEmbed(inject(piece)), piece).toBeNull();
    }
  });

  it("le code officiel passe, légende comprise (« Big data: la mode » n'est pas une adresse data:)", () => {
    expect(sanitizeInstagramEmbed(`  ${OFFICIAL}\n`)).toBe(OFFICIAL);
    expect(visibleText(instagramPage())).toContain("Une publication partagée");
    expect(instagramHostPage(OFFICIAL, 'a"><img onerror=x>')).toContain('aria-label="a&quot;&gt;&lt;img onerror=x&gt;"');
  });

  it("relais Instagram : syntaxe valide, marque de la page hôte, hauteur et chargement du cadre envoyés", () => {
    expect(() => new Function(INSTAGRAM_RELAY)).not.toThrow();
    expect(INSTAGRAM_RELAY).toContain(HOST_MESSAGE_SOURCE);
    expect(INSTAGRAM_RELAY).toContain('type: "size"');
    expect(INSTAGRAM_RELAY).toContain('type: "embedReady"');
  });
});

describe("règle de sécurité de chaque page (Content-Security-Policy)", () => {
  it("les empreintes correspondent exactement aux scripts de relais (sinon : valeur à recopier)", () => {
    expect(sha256(TIKTOK_RELAY)).toBe(TIKTOK_RELAY_SHA256);
    expect(sha256(INSTAGRAM_RELAY)).toBe(INSTAGRAM_RELAY_SHA256);
  });

  it("chaque page porte sa règle avant tout script, et elle autorise son seul script", () => {
    for (const [page, csp] of [
      [tiktokPage(), TIKTOK_PAGE_CSP],
      [instagramPage(), INSTAGRAM_PAGE_CSP],
    ] as const) {
      expect(csp).not.toMatch(/["<>&]/);
      expect(page.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1]).toBe(csp);
      expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script"));
      for (const script of inlineScripts(page)) expect(directive(csp, "script-src")).toContain(`'sha256-${sha256(script)}'`);
    }
  });

  it("TikTok : seul le relais ; cadre du lecteur officiel seulement", () => {
    expect(directive(TIKTOK_PAGE_CSP, "script-src")).toBe(`script-src 'sha256-${TIKTOK_RELAY_SHA256}'`);
    expect(directive(TIKTOK_PAGE_CSP, "frame-src")).toBe("frame-src https://www.tiktok.com");
  });

  it("Instagram : le relais et embed.js (cette adresse exacte, sans strict-dynamic) ; cadres d'Instagram seulement", () => {
    expect(directive(INSTAGRAM_PAGE_CSP, "script-src")).toBe(`script-src 'sha256-${INSTAGRAM_RELAY_SHA256}' https://www.instagram.com/embed.js`);
    expect(INSTAGRAM_PAGE_CSP).not.toContain("strict-dynamic");
    expect(directive(INSTAGRAM_PAGE_CSP, "frame-src")).toBe("frame-src https://www.instagram.com https://instagram.com");
  });

  it("jamais de script en ligne permis, ni eval, ni plugin, ni <base>, ni formulaire", () => {
    for (const csp of [TIKTOK_PAGE_CSP, INSTAGRAM_PAGE_CSP]) {
      expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
      expect(directive(csp, "script-src-attr")).toBe("script-src-attr 'none'");
      expect(directive(csp, "object-src")).toBe("object-src 'none'");
      expect(directive(csp, "base-uri")).toBe("base-uri 'none'");
      expect(directive(csp, "form-action")).toBe("form-action 'none'");
    }
  });
});
