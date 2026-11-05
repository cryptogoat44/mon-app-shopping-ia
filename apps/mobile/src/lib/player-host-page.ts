// Page hôte du lecteur intégré (lot « lecteur intégré ») : chargée dans la vue
// web par source={{ html, baseUrl }} (react-native-webview 13.16.1). Elle ne
// contient AUCUN texte visible : tout texte d'interface reste dans l'app
// (tests/no-hardcoded-text.test.ts). Elle ne touche jamais au contenu du
// lecteur officiel : elle relaie ses messages, et rien d'autre.
// Imports relatifs : fichier testé par vitest.

/** Marque des messages de la page hôte vers l'app (lib/player-state.ts). */
export const HOST_MESSAGE_SOURCE = "spotto-player";

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HEAD = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">';

// Relais TikTok (protocole « x-tiktok-player » : note R1 §2 ; Video.js
// player-api.js l.4, adapter.js l.303-347) : message de NOTRE cadre, marqué →
// relayé à l'app ; commande de l'app (MessageEvent sans source,
// RNCWebViewImpl.m l.1111-1119) → transmise au lecteur, cible « * » comme
// l'exemple officiel. Une commande sans valeur n'en porte aucune.
const TIKTOK_RELAY = `(function () {
  var frame = document.getElementById("player");
  var COMMANDS = ["play", "pause", "seekTo", "mute", "unMute"];
  function toApp(message) {
    message.source = "${HOST_MESSAGE_SOURCE}";
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  window.addEventListener("message", function (event) {
    if (frame && event.source === frame.contentWindow) {
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
    frame.contentWindow.postMessage(out, "*");
  });
})();`;

// Relais des codes d'intégration officiels (Instagram, et repli TikTok) :
// embed.js remplace le blockquote par un cadre ; quand ce cadre a fini de
// charger, la page le dit à l'app (« embedReady ») ; elle donne aussi la
// hauteur du contenu (« size ») pour que l'app dimensionne la vue web
// (contre-expertise n° 13). Aucune commande : ni Instagram ni ce code n'en
// offrent (note R2 §3.5).
const EMBED_RELAY = `(function () {
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
})();`;

/** TikTok : le lecteur officiel en plein cadre (les réglages sont dans l'adresse, lib/player-link.ts). */
export function tiktokHostPage(playerUrl: string, title: string): string {
  return `${HEAD}<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#player{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style></head><body><iframe id="player" src="${escapeHtmlAttribute(playerUrl)}" allow="autoplay; encrypted-media" title="${escapeHtmlAttribute(title)}"></iframe><script>${TIKTOK_RELAY}</script></body></html>`;
}

function embedHostPage(embedHtml: string, title: string, script: string, onload: string): string {
  const loaded = onload ? ` onload="${escapeHtmlAttribute(onload)}"` : "";
  return `${HEAD}<style>html,body{margin:0;background:#fff}#post{display:flex;justify-content:center}</style></head><body><div id="post" role="region" aria-label="${escapeHtmlAttribute(title)}">${embedHtml}</div><script>${EMBED_RELAY}</script><script async src="${script}"${loaded}></script></body></html>`;
}

/** Instagram : le code officiel renvoyé par l'oEmbed (sans script, omitscript=true), puis embed.js et instgrm.Embeds.process() (note R2 §1). */
export function instagramHostPage(embedHtml: string, title: string): string {
  return embedHostPage(embedHtml, title, "https://www.instagram.com/embed.js", "window.instgrm && window.instgrm.Embeds.process()");
}

/** TikTok, repli documenté (contre-expertise n° 9) : le blockquote renvoyé par l'oEmbed TikTok, puis embed.js de TikTok. */
export function tiktokEmbedHostPage(embedHtml: string, title: string): string {
  return embedHostPage(embedHtml, title, "https://www.tiktok.com/embed.js", "");
}
