import { describe, expect, it } from "vitest";
import {
  checkForbidsPlayer,
  embedHeight,
  isPlaybackSignal,
  noAnswerReason,
  parseHostMessage,
  parsePlayerConsent,
  playerCommand,
  playerLayout,
  seekCommand,
  tiktokErrorAction,
} from "../src/lib/player-state";

// Lot « lecteur intégré » : messages du lecteur, accord préalable, taille du
// lecteur. Les blocs « image noire » et « méthodes de capture » sont partis
// avec le module natif de capture (lot « nettoyage avant le premier build »).
const host = (payload: object) => JSON.stringify({ source: "spotto-player", ...payload });

describe("messages de la page hôte (catalogue fermé)", () => {
  it("événements du lecteur TikTok (note R1 §2) et des codes d'intégration", () => {
    expect(parseHostMessage(host({ kind: "tiktok", type: "onPlayerReady", value: null }))).toEqual({ kind: "ready" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: 2 }))).toEqual({ kind: "state", state: "paused" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: -1 }))).toEqual({ kind: "state", state: "init" });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onCurrentTime", value: { currentTime: 3.2, duration: 15 } }))).toEqual({ kind: "time", currentTime: 3.2, duration: 15 });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onPlayerError", value: { errorCode: 1001, errorType: "INVALID_VIDEO" } }))).toEqual({ kind: "error", code: 1001 });
    expect(parseHostMessage(host({ kind: "tiktok", type: "onMute", value: true }))).toEqual({ kind: "muted", muted: true });
    expect(parseHostMessage(host({ kind: "embed", type: "embedReady", value: null }))).toEqual({ kind: "embedReady" });
    expect(parseHostMessage(host({ kind: "embed", type: "size", value: 742 }))).toEqual({ kind: "size", height: 742 });
  });

  it("messages étrangers ou abîmés : ignorés ; événement imprévu : journalisé", () => {
    expect(parseHostMessage("pas du JSON")).toBeNull();
    expect(parseHostMessage(JSON.stringify({ kind: "tiktok", type: "onPlayerReady" }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onStateChange", value: 9 }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onCurrentTime", value: { currentTime: "3" } }))).toBeNull();
    expect(parseHostMessage(host({ kind: "embed", type: "size", value: -4 }))).toBeNull();
    expect(parseHostMessage(host({ kind: "tiktok", type: "onImageChange", value: 1, origin: "https://www.tiktok.com" }))).toEqual({
      kind: "other",
      type: "onImageChange",
      origin: "https://www.tiktok.com",
    });
  });

  it("« prêt » seulement sur une lecture constatée ; oEmbed qui refuse : indisponible (contre-expertise n° 14)", () => {
    expect(isPlaybackSignal({ kind: "ready" })).toBe(false);
    expect(isPlaybackSignal({ kind: "state", state: "init" })).toBe(false);
    expect(isPlaybackSignal({ kind: "error", code: 1001 })).toBe(false);
    expect(isPlaybackSignal({ kind: "state", state: "playing" })).toBe(true);
    expect(isPlaybackSignal({ kind: "time", currentTime: 0.2, duration: 9 })).toBe(true);
    expect(checkForbidsPlayer("not_public")).toBe("not_public");
    expect(checkForbidsPlayer("not_a_video")).toBe("not_a_video");
    expect(checkForbidsPlayer("ok")).toBeNull();
    expect(checkForbidsPlayer("no_answer")).toBeNull();
  });

  it("commandes : aucune valeur, sauf seekTo (secondes, jamais négatives)", () => {
    expect(playerCommand("pause")).toBe('{"type":"pause"}');
    expect(seekCommand(12.5)).toBe('{"type":"seekTo","value":12.5}');
    expect(seekCommand(-2)).toBe('{"type":"seekTo","value":0}');
  });

  it("erreurs du lecteur TikTok (note R1 §4) ; repli par le code d'intégration (contre-expertise n° 9)", () => {
    expect(tiktokErrorAction(3002, false)).toBe("tap_to_play");
    expect(tiktokErrorAction(1001, false)).toBe("not_public");
    expect(tiktokErrorAction(2001, false)).toBe("reload");
    expect(tiktokErrorAction(3001, true, false)).toBe("fallback");
    expect(tiktokErrorAction(2001, true)).toBe("no_answer");
    expect(tiktokErrorAction(3001, true)).toBe("player_error");
    expect(noAnswerReason("not_public")).toBe("not_public");
    expect(noAnswerReason("ok")).toBe("player_error");
    expect(noAnswerReason("skipped")).toBe("no_answer");
  });
});

describe("accord préalable (contre-expertise n° 5)", () => {
  it("par plateforme ; illisible : aucun accord", () => {
    expect(parsePlayerConsent(null)).toEqual({ tiktok: false, instagram: false });
    expect(parsePlayerConsent('{"tiktok":true,"instagram":"oui"}')).toEqual({ tiktok: true, instagram: false });
    expect(parsePlayerConsent("{")).toEqual({ tiktok: false, instagram: false });
  });
});

describe("taille du lecteur (9:16, jamais sous 325 × 578 quand l'écran le permet)", () => {
  it("iPhone SE : disposition compacte", () => {
    expect(playerLayout(375, 647)).toEqual({ mode: "compact", width: 325, height: 579 });
  });

  it("iPhone 15 : disposition compacte, lecteur plus grand", () => {
    expect(playerLayout(393, 759)).toEqual({ mode: "compact", width: 344, height: 613 });
  });

  it("iPhone 15 Pro Max : disposition normale (barre, consigne, bouton et mention à l'écran)", () => {
    expect(playerLayout(430, 839)).toEqual({ mode: "regular", width: 353, height: 628 });
  });

  it("code d'intégration : sa hauteur, dans la place disponible ; plus haut : défilement", () => {
    expect(embedHeight(null, 600)).toEqual({ height: 600, scroll: false });
    expect(embedHeight(480.2, 600)).toEqual({ height: 481, scroll: false });
    expect(embedHeight(900, 600)).toEqual({ height: 600, scroll: true });
  });
});
