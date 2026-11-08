// Page hôte du lecteur intégré (lot « lecteur intégré ») : chargée dans la vue
// web par source={{ html, baseUrl }} (react-native-webview 13.16.1). Elle ne
// contient AUCUN texte visible : tout texte d'interface reste dans l'app
// (tests/no-hardcoded-text.test.ts). Elle ne touche jamais au contenu du
// lecteur officiel : elle relaie ses messages, et rien d'autre.
// Elle tourne à l'adresse du site de Spotto et a accès au pont vers l'app :
// aucun texte venu de TikTok ou d'Instagram n'y est jamais écrit. Les codes
// d'intégration sont reconstruits ici, à partir de l'identifiant ou de
// l'adresse déjà vérifiés par lib/player-link.ts.
// Imports relatifs : fichier testé par vitest.
import { TIKTOK_ORIGIN } from "./player-link";

/** Marque des messages de la page hôte vers l'app (lib/player-state.ts). */
export const HOST_MESSAGE_SOURCE = "spotto-player";

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Relais TikTok (protocole « x-tiktok-player » : note R1 §2 ; Video.js
// player-api.js l.4, adapter.js l.303-347) : message de NOTRE cadre, venu de
// l'origine du lecteur officiel (si le cadre a été dirigé ailleurs, on
// l'ignore), marqué → relayé à l'app ; commande de l'app (MessageEvent sans
// source, RNCWebViewImpl.m l.1111-1119) → transmise au lecteur, à sa seule
// origine. Une commande sans valeur n'en porte aucune.
export const TIKTOK_RELAY = `(function () {
  var frame = document.getElementById("player");
  var ORIGIN = "${TIKTOK_ORIGIN}";
  var COMMANDS = ["play", "pause", "seekTo", "mute", "unMute"];
  function toApp(message) {
    message.source = "${HOST_MESSAGE_SOURCE}";
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.addEventListener("message", function (event) {
    if (frame && event.source === frame.contentWindow) {
      if (event.origin !== ORIGIN) return;
      var data = event.data;
      if (!data || data["x-tiktok-player"] !== true || typeof data.type !== "string") return;
      toApp({ kind: "tiktok", type: data.type, value: data.value === undefined ? null : data.value, origin: String(event.origin) });
      return;
    }
    if (event.source !== null || typeof event.data !== "string") return;
    var command;
    try { command = JSON.parse(event.data); } catch (error) { return; }
    if (!command || COMMANDS.indexOf(command.type) < 0 || !frame || !frame.contentWindow) return;
    var out = { "x-tiktok-player": true, type: command.type };
    if (command.type === "seekTo" && typeof command.value === "number") out.value = command.value;
    frame.contentWindow.postMessage(out, ORIGIN);
  });
})();`;

// Relais des codes d'intégration officiels (Instagram, et repli TikTok) :
// embed.js remplace le blockquote par un cadre ; quand ce cadre a fini de
// charger, la page le dit à l'app (« embedReady ») ; elle donne aussi la
// hauteur du contenu (« size ») pour que l'app dimensionne la vue web
// (contre-expertise n° 13). Aucune commande : ni Instagram ni ce code n'en
// offrent (note R2 §3.5). Ce script ajoute lui-même le embed.js officiel
// (adresse fixe, choisie par data-sdk) : la règle de sécurité de la page
// n'admet que les scripts écrits ici et ceux qu'ils ajoutent. Pour
// Instagram, instgrm.Embeds.process() une fois embed.js chargé (note R2 §1).
export const EMBED_RELAY = `(function () {
  var post = document.getElementById("post");
  var SDK = { instagram: "https://www.instagram.com/embed.js", tiktok: "https://www.tiktok.com/embed.js" };
  var lastHeight = 0;
  function toApp(message) {
    message.source = "${HOST_MESSAGE_SOURCE}";
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function size() {
    var height = Math.ceil(post.getBoundingClientRect().height);
    if (height > 0 && height !== lastHeight) {
      lastHeight = height;
      toApp({ kind: "embed", type: "size", value: height });
    }
  }
  function watch(frame) {
    if (frame.getAttribute("data-spotto") === "1") return;
    frame.setAttribute("data-spotto", "1");
    frame.addEventListener("load", function () { toApp({ kind: "embed", type: "embedReady", value: null }); size(); });
  }
  function scan() {
    var frames = post.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i += 1) watch(frames[i]);
    size();
  }
  new MutationObserver(scan).observe(post, { childList: true, subtree: true, attributes: true });
  if (window.ResizeObserver) new ResizeObserver(size).observe(post);
  scan();
  var sdk = post.getAttribute("data-sdk");
  if (sdk && Object.prototype.hasOwnProperty.call(SDK, sdk)) {
    var script = document.createElement("script");
    script.async = true;
    script.src = SDK[sdk];
    if (sdk === "instagram") script.onload = function () { if (window.instgrm) window.instgrm.Embeds.process(); };
    document.body.appendChild(script);
  }
})();`;

// Empreintes SHA-256 des deux scripts ci-dessus, les seuls écrits dans la
// page. À recalculer à chaque modification d'un script :
// tests/player-host-page.test.ts compare et donne la bonne valeur.
export const TIKTOK_RELAY_SHA256 = "lSyRWY0mEaOyRvs3p4mTbjTubE4aVijcssn11WVfetQ=";
export const EMBED_RELAY_SHA256 = "kMO6979RwOTE6PW1vjuESdTPYDuI1BITd63NpIajRKQ=";

// Règle de sécurité de la page (Content-Security-Policy), en plus du reste :
// seuls les deux scripts ci-dessus s'exécutent, et ce qu'ils ajoutent
// (embed.js et ce qu'il charge : « strict-dynamic ») ; aucun attribut
// onerror/onload, aucun lien javascript:, aucun plugin, aucun <base>, aucun
// formulaire ; cadres de TikTok et d'Instagram seulement. Les deux adresses
// après « strict-dynamic » ne servent qu'aux vues web qui l'ignoreraient.
export const HOST_PAGE_CSP = [
  `script-src 'sha256-${TIKTOK_RELAY_SHA256}' 'sha256-${EMBED_RELAY_SHA256}' 'strict-dynamic' https://www.tiktok.com https://www.instagram.com`,
  "script-src-attr 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src https://tiktok.com https://*.tiktok.com https://instagram.com https://*.instagram.com",
].join("; ");

// Règle écrite telle quelle dans l'attribut : texte fixe, sans guillemet ni chevron (vérifié par le test).
const HEAD = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${HOST_PAGE_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`;

// Formes admises, revérifiées ici même si player-link.ts les a déjà lues :
// une valeur inattendue donne une page vide, jamais du code.
const TIKTOK_PLAYER_URL = /^https:\/\/www\.tiktok\.com\/player\/v1\/\d{1,25}(?:\?|$)/;
const TIKTOK_ID = /^\d{8,25}$/;
const INSTAGRAM_CANONICAL = /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/$/;

/** Code d'intégration TikTok (forme officielle de l'oEmbed), écrit à partir de l'identifiant seul (chiffres). */
export function tiktokEmbedMarkup(id: string): string {
  if (!TIKTOK_ID.test(id)) return "";
  return `<blockquote class="tiktok-embed" cite="${TIKTOK_ORIGIN}/@_/video/${id}" data-video-id="${id}" style="max-width:605px;min-width:325px"><section></section></blockquote>`;
}

/** Code d'intégration Instagram (forme officielle de l'oEmbed, sans légende), écrit à partir de l'adresse canonique. */
export function instagramEmbedMarkup(canonical: string): string {
  if (!INSTAGRAM_CANONICAL.test(canonical)) return "";
  return `<blockquote class="instagram-media" data-instgrm-permalink="${escapeHtmlAttribute(canonical)}" data-instgrm-version="14" style="background:#fff;border:0;margin:1px;max-width:540px;min-width:326px;padding:0;width:calc(100% - 2px)"></blockquote>`;
}

/** TikTok : le lecteur officiel en plein cadre (les réglages sont dans l'adresse, lib/player-link.ts). */
export function tiktokHostPage(playerUrl: string, title: string): string {
  const src = TIKTOK_PLAYER_URL.test(playerUrl) ? playerUrl : "about:blank";
  return `${HEAD}<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#player{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head><body><iframe id="player" src="${escapeHtmlAttribute(src)}" allow="autoplay; encrypted-media" title="${escapeHtmlAttribute(title)}"></iframe><script>${TIKTOK_RELAY}</script></body></html>`;
}

function embedHostPage(markup: string, title: string, sdk: "instagram" | "tiktok"): string {
  // Code refusé (forme inattendue) : page vide, embed.js n'est pas chargé.
  const loaded = markup ? sdk : "";
  return `${HEAD}<style>html,body{margin:0;background:#fff}#post{display:flex;justify-content:center}</style></head><body><div id="post" role="region" aria-label="${escapeHtmlAttribute(title)}" data-sdk="${loaded}">${markup}</div><script>${EMBED_RELAY}</script></body></html>`;
}

/** Instagram : le code officiel, reconstruit depuis l'adresse canonique, puis embed.js et instgrm.Embeds.process() (note R2 §1). */
export function instagramHostPage(canonical: string, title: string): string {
  return embedHostPage(instagramEmbedMarkup(canonical), title, "instagram");
}

/** TikTok, repli documenté (contre-expertise n° 9) : le blockquote officiel, reconstruit depuis l'identifiant, puis embed.js de TikTok. */
export function tiktokEmbedHostPage(id: string, title: string): string {
  return embedHostPage(tiktokEmbedMarkup(id), title, "tiktok");
}
