import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_SOURCE } from "../src/lib/player-host-page";
import type { FrameSample } from "../src/lib/frame-sample";
import {
  TIKTOK_MIN_SIZE,
  embedHeight,
  isBlankFrame,
  isPlaybackSignal,
  isPlayerAnswer,
  momentSeconds,
  parseHostMessage,
  parsePlayerConsent,
  playerCommand,
  playerLayout,
  seekCommand,
  tiktokErrorAction,
} from "../src/lib/player-state";

// Mission « liens vidéo » : messages de la page hôte (catalogue fermé),
// commandes du lecteur TikTok, accord préalable, taille du lecteur.
const tiktok = (type: string, value?: unknown) => JSON.stringify({ source: HOST_MESSAGE_SOURCE, kind: "tiktok", type, value: value ?? null, origin: "https://www.tiktok.com" });
const embed = (type: string, value?: unknown) => JSON.stringify({ source: HOST_MESSAGE_SOURCE, kind: "embed", type, value: value ?? null });

describe("messages de la page hôte (catalogue fermé)", () => {
  it("événements du lecteur TikTok : prêt, états -1 à 3, moment, son", () => {
    expect(parseHostMessage(tiktok("onPlayerReady"))).toEqual({ kind: "ready" });
    expect([-1, 0, 1, 2, 3].map((value) => parseHostMessage(tiktok("onStateChange", value)))).toEqual([
      { kind: "state", state: "init" },
      { kind: "state", state: "ended" },
      { kind: "state", state: "playing" },
      { kind: "state", state: "paused" },
      { kind: "state", state: "buffering" },
    ]);
    expect(parseHostMessage(tiktok("onStateChange", 7))).toBeNull();
    expect(parseHostMessage(tiktok("onCurrentTime", { currentTime: 4.9, duration: 15 }))).toEqual({ kind: "time", currentTime: 4.9, duration: 15 });
    expect(parseHostMessage(tiktok("onMute", true))).toEqual({ kind: "muted", muted: true });
  });

  it("moment : nombres finis seulement, jamais négatif", () => {
    for (const value of [{ currentTime: "4", duration: 15 }, { currentTime: 4 }, { currentTime: -1, duration: 15 }, null, 4]) {
      expect(parseHostMessage(tiktok("onCurrentTime", value))).toBeNull();
    }
  });

  it("erreurs du lecteur TikTok (1001 vidéo invalide, 2001 serveur, 3001 lecture, 3002 lecture automatique), avec leur type", () => {
    expect(parseHostMessage(tiktok("onPlayerError", { errorCode: 1001, errorType: "INVALID_VIDEO" }))).toEqual({ kind: "error", code: 1001, errorType: "INVALID_VIDEO" });
    expect(parseHostMessage(tiktok("onPlayerError", { errorCode: 3002 }))).toEqual({ kind: "error", code: 3002, errorType: null });
    expect(parseHostMessage(tiktok("onPlayerError", { errorType: "x" }))).toBeNull();
    expect(parseHostMessage(tiktok("onPlayerError", "1001"))).toBeNull();
  });

  it("code d'intégration Instagram : chargé, hauteur bornée", () => {
    expect(parseHostMessage(embed("embedReady"))).toEqual({ kind: "embedReady" });
    expect(parseHostMessage(embed("size", 640))).toEqual({ kind: "size", height: 640 });
    expect(parseHostMessage(embed("size", 90_000))).toEqual({ kind: "size", height: 5_000 });
    expect(parseHostMessage(embed("size", -3))).toBeNull();
  });

  it("messages étrangers ou abîmés : ignorés ; événement imprévu : journalisé", () => {
    expect(parseHostMessage("pas du JSON")).toBeNull();
    expect(parseHostMessage(JSON.stringify({ kind: "tiktok", type: "onPlayerReady" }))).toBeNull();
    expect(parseHostMessage(JSON.stringify({ source: "autre", kind: "tiktok", type: "onPlayerReady" }))).toBeNull();
    expect(parseHostMessage(tiktok("onVolumeChange", 1))).toEqual({ kind: "other", type: "onVolumeChange", origin: "https://www.tiktok.com" });
  });

  it("lecture constatée : état « lecture » ou moment reçu, jamais un simple « prêt »", () => {
    expect(isPlaybackSignal({ kind: "state", state: "playing" })).toBe(true);
    expect(isPlaybackSignal({ kind: "time", currentTime: 1, duration: 2 })).toBe(true);
    expect(isPlaybackSignal({ kind: "ready" })).toBe(false);
    expect(isPlaybackSignal({ kind: "state", state: "paused" })).toBe(false);
  });

  it("moment envoyé avec un spot : secondes entières, arrondies vers le bas", () => {
    expect(momentSeconds(12.97)).toBe(12);
    expect(momentSeconds(0.4)).toBe(0);
    expect(momentSeconds(null)).toBeNull();
    expect(momentSeconds(Number.NaN)).toBeNull();
    expect(momentSeconds(-2)).toBeNull();
  });
});

describe("commandes et erreurs du lecteur TikTok", () => {
  it("commandes : aucune valeur, sauf seekTo (secondes, jamais négatives)", () => {
    expect(playerCommand("pause")).toBe('{"type":"pause"}');
    expect(playerCommand("unMute")).toBe('{"type":"unMute"}');
    expect(seekCommand(-4)).toBe('{"type":"seekTo","value":0}');
    expect(seekCommand(7.5)).toBe('{"type":"seekTo","value":7.5}');
  });

  it("3002 (lecture automatique refusée) : la personne touche la vidéo ; toute autre erreur : écran de secours", () => {
    expect(tiktokErrorAction(3002)).toBe("tap_to_play");
    for (const code of [1001, 2001, 3001, 0, 9999]) expect(tiktokErrorAction(code)).toBe("fallback");
  });
});

describe("accord préalable", () => {
  it("par plateforme ; illisible : aucun accord", () => {
    expect(parsePlayerConsent(null)).toEqual({ tiktok: false, instagram: false });
    expect(parsePlayerConsent('{"tiktok":true,"instagram":"oui"}')).toEqual({ tiktok: true, instagram: false });
    expect(parsePlayerConsent("{")).toEqual({ tiktok: false, instagram: false });
  });
});

describe("taille du lecteur (9:16, « Spotter ce moment » visible, jamais sous 325 × 578 quand la largeur le permet)", () => {
  it("iPhone SE (375 × 647) : au moins la taille minimale de TikTok, l'écran défile", () => {
    const layout = playerLayout(375, 647);
    expect(layout.height).toBe(TIKTOK_MIN_SIZE.height);
    expect(layout.width).toBe(Math.floor((578 * 9) / 16));
  });

  it("iPhone 15 Pro Max (430 × 873) : le plus grand possible sous la place des boutons", () => {
    const layout = playerLayout(430, 873);
    expect(layout.height).toBe(873 - 183);
    expect(layout.width / layout.height).toBeCloseTo(9 / 16, 2);
  });

  it("écran étroit : la largeur décide", () => {
    const layout = playerLayout(300, 1000);
    expect(layout.width).toBeLessThanOrEqual(300 - 32);
  });

  it("code d'intégration : sa hauteur, dans la place disponible ; plus haut : défilement", () => {
    expect(embedHeight(null, 600)).toEqual({ height: 600, scroll: false });
    expect(embedHeight(450.2, 600)).toEqual({ height: 451, scroll: false });
    expect(embedHeight(120, 600)).toEqual({ height: 200, scroll: false });
    expect(embedHeight(900, 600)).toEqual({ height: 600, scroll: true });
  });
});

describe("le lecteur a répondu (retours du build 2) : plus de remplacement au bout de 12 s", () => {
  it("permis : prêt, état, temps, code Instagram chargé, taille, lecture automatique refusée (il attend un toucher)", () => {
    expect(isPlayerAnswer({ kind: "ready" })).toBe(true);
    expect(isPlayerAnswer({ kind: "state", state: "paused" })).toBe(true);
    expect(isPlayerAnswer({ kind: "time", currentTime: 1, duration: 9 })).toBe(true);
    expect(isPlayerAnswer({ kind: "muted", muted: true })).toBe(true);
    expect(isPlayerAnswer({ kind: "embedReady" })).toBe(true);
    expect(isPlayerAnswer({ kind: "size", height: 600 })).toBe(true);
    expect(isPlayerAnswer({ kind: "error", code: 3002, errorType: null })).toBe(true);
  });

  it("refusé : une autre erreur, ou un message non prévu", () => {
    expect(isPlayerAnswer({ kind: "error", code: 1001, errorType: null })).toBe(false);
    expect(isPlayerAnswer({ kind: "error", code: 2001, errorType: null })).toBe(false);
    expect(isPlayerAnswer({ kind: "other", type: "onVolumeChange", origin: "" })).toBe(false);
  });
});

describe("image noire ou blanche refusée (retours du build 2, contrôle repris du commit 93ba4d1)", () => {
  const W = 96;
  const H = 171;
  const frame = (pixel: (x: number, y: number) => number): FrameSample => {
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) gray[y * W + x] = pixel(x, y);
    return { gray, width: W, height: H, colors: [] };
  };

  it("refusé : vidéo noire sous les boutons blancs du lecteur TikTok (en-tête, colonne, bouton lecture)", () => {
    expect(isBlankFrame(frame((x, y) => (y < 20 || x > 80 || (Math.abs(x - 48) < 8 && Math.abs(y - 85) < 8) ? 255 : 0)))).toBe(true);
  });

  it("refusé : noir bruité (≤ 24/255), rectangle blanc, image minuscule", () => {
    expect(isBlankFrame(frame((x, y) => (x + y) % 20))).toBe(true);
    expect(isBlankFrame(frame(() => 250))).toBe(true);
    expect(isBlankFrame({ gray: new Uint8Array(4), width: 2, height: 2, colors: [] })).toBe(true);
  });

  it("permis : vraie image, même sombre ; mur uni bien éclairé ; fond de studio noir avec une personne", () => {
    expect(isBlankFrame(frame((x, y) => (((x >> 2) + (y >> 2)) % 2 ? 200 : 60)))).toBe(false);
    expect(isBlankFrame(frame((x, y) => ((x * 13 + y * 7) % 50) + 10))).toBe(false);
    expect(isBlankFrame(frame(() => 182))).toBe(false);
    expect(isBlankFrame(frame((x, y) => (x > 50 && x < 74 && y > 30 && y < 150 ? 140 : 12)))).toBe(false);
  });
});
