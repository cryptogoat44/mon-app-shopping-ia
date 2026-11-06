// Page hôte du widget Cloudflare Turnstile (point 17, apps/mobile/ANTI-ROBOTS.md).
// Renvoie le jeton, l'expiration ou l'erreur :
// - sur iPhone, à l'app (window.ReactNativeWebView, cadre principal seulement) ;
// - sur le site, à la page parente de MÊME origine (postMessage vers location.origin).
// La forme des messages est celle que lit apps/mobile/src/lib/robot-check.ts.
(function () {
  "use strict";
  var SOURCE = "spotto-verification-robot";
  var params = new URLSearchParams(window.location.search);
  var siteKey = params.get("sitekey") || "";
  var lang = params.get("lang") || "auto";
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(siteKey)) siteKey = "";
  if (!/^[a-z]{2}$/.test(lang)) lang = "auto";

  function send(type, token) {
    var message = { source: SOURCE, type: type };
    if (typeof token === "string") message.token = token;
    var text = JSON.stringify(message);
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function") {
      window.ReactNativeWebView.postMessage(text);
    } else if (window.parent && window.parent !== window) {
      window.parent.postMessage(text, window.location.origin);
    }
  }

  window.spottoTurnstileLoaded = function () {
    if (!siteKey || !window.turnstile) {
      send("error");
      return;
    }
    window.turnstile.render("#widget", {
      sitekey: siteKey,
      language: lang,
      // L'app redemande un widget à l'expiration (jeton à usage unique, environ 300 s).
      "refresh-expired": "manual",
      callback: function (token) { send("token", token); },
      "expired-callback": function () { send("expired"); },
      "timeout-callback": function () { send("expired"); },
      "error-callback": function () { send("error"); },
      "unsupported-callback": function () { send("error"); }
    });
  };

  if (!siteKey) {
    send("error");
    return;
  }
  var script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=spottoTurnstileLoaded";
  script.async = true;
  script.onerror = function () { send("error"); };
  document.head.appendChild(script);
})();
