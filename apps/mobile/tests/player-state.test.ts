import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_SOURCE } from "../src/lib/player-host-page";
import type { FrameSample } from "../src/lib/frame-sample";
import { decodePngSample } from "../src/lib/png-pixels";
import {
  BLUR_LIMITS,
  PLAYER_MIN_HEIGHT,
  embedHeight,
  estimatedActionsHeight,
  formatPlayerTime,
  frameSharpness,
  isBlankFrame,
  isBlurryFrame,
  progressFraction,
  seekSeconds,
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

describe("taille du lecteur (retours du build 3 : 9:16, la place qui reste après la zone d'actions mesurée, jamais sous 240)", () => {
  it("iPhone de la capture 04 (420 × 810 utiles), zone de 168 pt : 579 pt de haut, les deux actions visibles", () => {
    const layout = playerLayout(420, 810, 168);
    expect(layout.height).toBe(579);
    expect(layout.width).toBe(Math.floor((579 * 9) / 16));
  });

  it("iPhone SE (375 × 647 utiles), zone de 220 pt : 364 pt", () => {
    expect(playerLayout(375, 647, 220).height).toBe(364);
  });

  it("refusé : passer sous le plancher de 240 (zone énorme, grand texte) — l'écran défile alors", () => {
    expect(PLAYER_MIN_HEIGHT).toBe(240);
    expect(playerLayout(375, 647, 900).height).toBe(240);
  });

  it("écran étroit : la largeur décide", () => {
    const layout = playerLayout(300, 1000, 100);
    expect(layout.width).toBeLessThanOrEqual(300 - 32);
    expect(layout.height).toBe(Math.floor(((300 - 32) * 16) / 9));
  });

  it("toujours 9:16 (arrondis vers le bas)", () => {
    for (const [w, h, a] of [
      [420, 810, 168],
      [375, 647, 220],
      [430, 873, 300],
      [320, 548, 260],
    ] as const) {
      const layout = playerLayout(w, h, a);
      expect(layout.width).toBe(Math.floor((layout.height * 9) / 16));
    }
  });

  it("avant la première mesure : une estimation de la zone d'actions", () => {
    expect(estimatedActionsHeight({ analysis: false, firstPlay: false, controls: false })).toBe(44 + 52 + 16);
    expect(estimatedActionsHeight({ analysis: false, firstPlay: false, controls: true })).toBe(44 + 44 + 52 + 3 * 8);
    expect(estimatedActionsHeight({ analysis: true, firstPlay: false, controls: true })).toBe(220);
    expect(estimatedActionsHeight({ analysis: true, firstPlay: true, controls: true })).toBe(220 + 44 + 8);
  });

  it("code d'intégration : sa hauteur, dans la place disponible ; plus haut : défilement", () => {
    expect(embedHeight(null, 600)).toEqual({ height: 600, scroll: false });
    expect(embedHeight(450.2, 600)).toEqual({ height: 451, scroll: false });
    expect(embedHeight(120, 600)).toEqual({ height: 200, scroll: false });
    expect(embedHeight(900, 600)).toEqual({ height: 600, scroll: true });
  });
});

describe("le lecteur a répondu (retours du build 2) : plus de remplacement au bout de 12 s", () => {
  it("permis : prêt, état, temps, code Instagram chargé, lecture automatique refusée (il attend un toucher)", () => {
    expect(isPlayerAnswer({ kind: "ready" })).toBe(true);
    expect(isPlayerAnswer({ kind: "state", state: "paused" })).toBe(true);
    expect(isPlayerAnswer({ kind: "time", currentTime: 1, duration: 9 })).toBe(true);
    expect(isPlayerAnswer({ kind: "muted", muted: true })).toBe(true);
    expect(isPlayerAnswer({ kind: "embedReady" })).toBe(true);
    expect(isPlayerAnswer({ kind: "error", code: 3002, errorType: null })).toBe(true);
  });

  it("refusé : une autre erreur, un message non prévu, ou la taille Instagram (envoyée avant le code d'Instagram)", () => {
    expect(isPlayerAnswer({ kind: "size", height: 600 })).toBe(false);
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

describe("barre de lecture (retours du build 3)", () => {
  it("progressFraction : null tant que la durée est inconnue ou nulle ; bornée entre 0 et 1", () => {
    expect(progressFraction(3, null)).toBeNull();
    expect(progressFraction(3, 0)).toBeNull();
    expect(progressFraction(3, -2)).toBeNull();
    expect(progressFraction(2, 8)).toBe(0.25);
    expect(progressFraction(12, 8)).toBe(1);
    expect(progressFraction(-1, 8)).toBe(0);
    expect(progressFraction(null, 8)).toBe(0);
  });

  it("seekSeconds : bornée à [0, durée − 0,1]", () => {
    expect(seekSeconds(0.5, 8)).toBe(4);
    expect(seekSeconds(-0.3, 8)).toBe(0);
    expect(seekSeconds(1, 8)).toBeCloseTo(7.9, 5);
    expect(seekSeconds(2, 8)).toBeCloseTo(7.9, 5);
    expect(seekSeconds(0.5, 0)).toBe(0);
  });

  it("formatPlayerTime : « 0:00 », « 0:05 », « 1:02 », jamais négatif", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
    expect(formatPlayerTime(5.9)).toBe("0:05");
    expect(formatPlayerTime(62)).toBe("1:02");
    expect(formatPlayerTime(-3)).toBe("0:00");
    expect(formatPlayerTime(Number.NaN)).toBe("0:00");
  });
});

describe("image floue (retours du build 3 : contrôle de netteté de l'instantané)", () => {
  const W = 96;
  const H = 171;
  const sample = (pixel: (x: number, y: number) => number): FrameSample => {
    const gray = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) gray[y * W + x] = Math.max(0, Math.min(255, Math.round(pixel(x, y))));
    return { gray, width: W, height: H, colors: [] };
  };
  const checker = (x: number, y: number, low = 40, high = 210) => (((x >> 2) + (y >> 2)) % 2 ? high : low);

  it("refusé : un dégradé lisse (image floue)", () => {
    const smooth = sample((x, y) => 60 + x + y * 0.5);
    expect(frameSharpness(smooth)).toBeLessThan(BLUR_LIMITS.minSharpness);
    expect(isBlurryFrame(smooth)).toBe(true);
  });

  it("permis : un damier net", () => {
    expect(isBlurryFrame(sample((x, y) => checker(x, y)))).toBe(false);
  });

  it("refusé : fond flou et colonne de droite nette (les boutons de TikTok sont hors de la zone examinée)", () => {
    const frame = sample((x, y) => (x >= W * 0.82 ? checker(x, y) : 100 + y * 0.3));
    expect(isBlurryFrame(frame)).toBe(true);
  });

  it("refusé : seul le bouton central est net (il est retiré de la zone)", () => {
    const frame = sample((x, y) => {
      const fx = (x + 0.5) / W;
      const fy = (y + 0.5) / H;
      return fx >= 0.4 && fx < 0.6 && fy >= 0.42 && fy < 0.58 ? checker(x, y) : 120;
    });
    expect(isBlurryFrame(frame)).toBe(true);
  });

  // Copies de 96 px (gris) des captures du fondateur, rognées sur la vidéo :
  // 06 (l'image prise floue) et 05 (la vidéo nette, en pause).
  const real = (name: string) => decodePngSample(new Uint8Array(readFileSync(fileURLToPath(new URL(`./images-nettete/${name}.png`, import.meta.url)))));
  const darken = (frame: FrameSample, factor: number): FrameSample => ({ ...frame, gray: frame.gray.map((value) => Math.round(value * factor)) });

  it("refusé : la vraie image floue (capture 06), même assombrie", () => {
    const blurred = real("06-floue");
    expect(isBlankFrame(blurred)).toBe(false);
    expect(isBlurryFrame(blurred)).toBe(true);
    expect(isBlurryFrame(darken(blurred, 0.25))).toBe(true);
  });

  it("permis : la vraie image nette (capture 05), et la même assombrie à 25 % et 15 % (plan sombre mais net)", () => {
    const sharp = real("05-nette");
    expect(isBlurryFrame(sharp)).toBe(false);
    for (const factor of [0.25, 0.15]) {
      const dark = darken(sharp, factor);
      expect(isBlankFrame(dark)).toBe(false);
      expect(isBlurryFrame(dark)).toBe(false);
    }
  });

  it("la netteté ne dépend pas de la luminosité (rapport à la variance des gris)", () => {
    const sharp = real("05-nette");
    expect(frameSharpness(darken(sharp, 0.25)) / frameSharpness(sharp)).toBeGreaterThan(0.8);
    expect(frameSharpness(real("06-floue"))).toBeLessThan(BLUR_LIMITS.minSharpness / 2);
  });

  it("refusé : une zone unie (rien à juger)", () => {
    expect(frameSharpness(sample(() => 120))).toBe(0);
    expect(isBlurryFrame(sample(() => 120))).toBe(true);
  });
});
