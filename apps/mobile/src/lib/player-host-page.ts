// Pages hôtes du lecteur intégré (mission « liens vidéo ») : écrites par
// l'app, chargées dans la vue web par source={{ html, baseUrl }}
// (react-native-webview 13.16.1). Elles ne contiennent AUCUN texte visible :
// tout texte d'interface reste dans l'app (tests/no-hardcoded-text.test.ts).
// Elles ne touchent jamais au lecteur officiel : rien n'est posé dessus,
// masqué ni modifié ; elles relaient ses messages, et rien d'autre.
// - TikTok : le cadre https://www.tiktok.com/player/v1/{id}, construit à
//   partir du seul identifiant de la vidéo (aucun appel à TikTok par l'app).
// - Instagram : le code d'intégration officiel rendu par le serveur
//   (GET /api/video-links/instagram-embed), vérifié ici, puis le seul script
//   officiel https://www.instagram.com/embed.js.
// Elles tournent à l'adresse du site de l'app et ont accès au pont vers
// l'app : une règle de sécurité (Content-Security-Policy) par page n'admet
// que le script de relais écrit ici (et, pour Instagram, embed.js).
// Imports relatifs : fichier testé par vitest.
import { TIKTOK_ORIGIN, tiktokPlayerUrl } from "./player-link";

/** Marque des messages de la page hôte vers l'app (lib/player-state.ts). */
export const HOST_MESSAGE_SOURCE = "spotto-player";

/** Seul script tiers admis, dans la page Instagram seulement. */
export const INSTAGRAM_EMBED_SCRIPT = "https://www.instagram.com/embed.js";

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Relais TikTok (protocole « x-tiktok-player ») : message de NOTRE cadre,
// venu de l'origine du lecteur officiel (si le cadre a été dirigé ailleurs,
// on l'ignore), marqué → relayé à l'app ; commande de l'app (MessageEvent
// sans source) → transmise au lecteur, à sa seule origine, sous la forme
// { type, value, "x-tiktok-player": true }. Une commande sans valeur n'en
// porte aucune.
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

// Relais Instagram : embed.js remplace le blockquote par un cadre ; quand ce
// cadre a fini de charger, la page le dit à l'app (« embedReady ») ; elle
// donne aussi la hauteur du contenu (« size ») pour que l'app dimensionne la
// vue web. Aucune commande : Instagram n'en offre pas. Ce script ajoute
// lui-même le embed.js officiel (adresse fixe), puis appelle
// instgrm.Embeds.process().
export const INSTAGRAM_RELAY = `(function () {
  var post = document.getElementById("post");
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
  var script = document.createElement("script");
  script.async = true;
  script.src = "${INSTAGRAM_EMBED_SCRIPT}";
  script.onload = function () { if (window.instgrm) window.instgrm.Embeds.process(); };
  document.body.appendChild(script);
})();`;

// Empreintes SHA-256 des deux scripts ci-dessus. À recalculer à chaque
// modification d'un script : tests/player-host-page.test.ts compare et donne
// la bonne valeur.
export const TIKTOK_RELAY_SHA256 = "lSyRWY0mEaOyRvs3p4mTbjTubE4aVijcssn11WVfetQ=";
export const INSTAGRAM_RELAY_SHA256 = "DFlg4CL6MK6FlSQI9yt8LiOEhmTqS7Dh33hD+7u8W9s=";

// Règles communes : aucun attribut onerror/onload, aucun lien javascript:,
// aucun plugin, aucun <base>, aucun formulaire.
const COMMON_CSP = ["script-src-attr 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"];

/** TikTok : seul le relais s'exécute ; un seul cadre admis, le lecteur officiel. */
export const TIKTOK_PAGE_CSP = [`script-src 'sha256-${TIKTOK_RELAY_SHA256}'`, ...COMMON_CSP, `frame-src ${TIKTOK_ORIGIN}`].join("; ");

/** Instagram : le relais et embed.js (cette adresse exacte, sans « strict-dynamic » :
 * aucun autre script ne peut s'ajouter) ; cadres d'Instagram seulement. */
export const INSTAGRAM_PAGE_CSP = [
  `script-src 'sha256-${INSTAGRAM_RELAY_SHA256}' ${INSTAGRAM_EMBED_SCRIPT}`,
  ...COMMON_CSP,
  "frame-src https://www.instagram.com https://instagram.com",
].join("; ");

// Règle écrite telle quelle dans l'attribut : texte fixe, sans guillemet ni chevron (vérifié par le test).
const head = (csp: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`;

/** TikTok : le lecteur officiel en plein cadre, construit depuis l'identifiant seul. null : identifiant refusé. */
export function tiktokHostPage(videoId: string, title: string): string | null {
  const src = tiktokPlayerUrl(videoId);
  if (!src) return null;
  return `${head(TIKTOK_PAGE_CSP)}<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#player{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head><body><iframe id="player" src="${escapeHtmlAttribute(src)}" allow="autoplay; encrypted-media" title="${escapeHtmlAttribute(title)}"></iframe><script>${TIKTOK_RELAY}</script></body></html>`;
}

// ---- Code d'intégration Instagram : vérifié avant d'être écrit ----

const EMBED_MAX_LENGTH = 30_000;
/** Balises refusées partout dans le code d'intégration (même dans un SVG). */
const FORBIDDEN_TAG =
  /<\s*\/?\s*(?:script|iframe|frame|frameset|object|embed|applet|link|meta|base|form|input|button|textarea|select|option|style|template|noscript|foreignobject|use|animate|animatemotion|animatetransform|set|handler|portal|math|image)\b/i;
/** Attribut d'événement (onload, onerror…) ou cadre en ligne. */
const EVENT_ATTRIBUTE = /[\s"'/;]on[a-z]+\s*=|\ssrcdoc\s*=/i;
/** Valeur d'attribut qui est une adresse exécutant ou contenant du code. */
const DANGEROUS_URL = /^(?:javascript|vbscript|data|blob|file):/i;
const ATTRIBUTE_VALUE = /=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
const OPENING = /^<blockquote\s[^>]*\bclass\s*=\s*"[^"]*\binstagram-media\b[^"]*"[^>]*>/i;
const PERMALINK = /\bdata-instgrm-permalink\s*=\s*"https:\/\/www\.instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,64}\/?[^"]*"/i;

/** Valeurs d'attributs décodées (entités numériques et nommées utiles,
 * blancs retirés) : « &#106;avascript: » ou « java&Tab;script: » sont lus
 * comme le navigateur les lirait. */
function decodedForCheck(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 32))
    .replace(/&#(\d+);?/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal) || 32))
    .replace(/&colon;/gi, ":")
    .replace(/&(?:tab|newline);/gi, "")
    .replace(/[\u0000- ]+/g, "");
}

function hasDangerousUrl(markup: string): boolean {
  for (const match of markup.matchAll(ATTRIBUTE_VALUE)) {
    if (DANGEROUS_URL.test(decodedForCheck(match[1] ?? match[2] ?? match[3] ?? ""))) return true;
  }
  return false;
}

/** Le code d'intégration rendu par le serveur, tel qu'il sera écrit dans la
 * page ; null s'il n'a pas la forme officielle attendue : un seul blockquote
 * « instagram-media » qui porte l'adresse d'une publication Instagram, sans
 * aucun script (le seul admis, embed.js, est ajouté par la page elle-même),
 * sans cadre, attribut d'événement, adresse javascript:/data: ni balise
 * active. Refusé : l'app montre l'écran de secours. */
export function sanitizeInstagramEmbed(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const markup = html.trim();
  if (markup.length === 0 || markup.length > EMBED_MAX_LENGTH) return null;
  const opening = OPENING.exec(markup);
  if (!opening || !PERMALINK.test(opening[0]) || !/<\/blockquote>$/i.test(markup)) return null;
  if (FORBIDDEN_TAG.test(markup) || EVENT_ATTRIBUTE.test(markup)) return null;
  if (hasDangerousUrl(markup)) return null;
  return markup;
}

/** Instagram : le code officiel vérifié, puis embed.js et instgrm.Embeds.process().
 * null : code refusé (écran de secours). */
export function instagramHostPage(embedHtml: unknown, title: string): string | null {
  const markup = sanitizeInstagramEmbed(embedHtml);
  if (!markup) return null;
  return `${head(INSTAGRAM_PAGE_CSP)}<style>html,body{margin:0;background:#fff}#post{display:flex;justify-content:center}</style></head><body><div id="post" role="region" aria-label="${escapeHtmlAttribute(title)}">${markup}</div><script>${INSTAGRAM_RELAY}</script></body></html>`;
}
