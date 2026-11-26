import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_SOURCE } from "../src/lib/player-host-page";
import type { FrameSample } from "../src/lib/frame-sample";
import { decodePngSample } from "../src/lib/png-pixels";
import {
  BLUR_LIMITS,
  blurCheckApplies,
  CONTROLS_MIN_WIDTH,
  controlsRowWidth,
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

describe("largeur de notre barre de lecture (petit iPhone, grand texte)", () => {
  it("refusé : la seule largeur de la vidéo quand elle est étroite (iPhone SE : vidéo de 209 pt, trait de ≈ 30 pt)", () => {
    expect(CONTROLS_MIN_WIDTH).toBe(300);
    expect(controlsRowWidth(209)).toBe(300);
    expect(controlsRowWidth(135)).toBe(300);
    expect(controlsRowWidth(Number.NaN)).toBe(300);
  });

  it("permis : la largeur de la vidéo quand elle laisse assez de trait (iPhone du fondateur : 300 pt et plus)", () => {
    expect(controlsRowWidth(300)).toBe(300);
    expect(controlsRowWidth(342.6)).toBe(342);
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
  /** Fond flou mesurable : larges ondulations (bords étalés sur ≈ 25 px). */
  const blurryBackground = (x: number, y: number) => 120 + 70 * Math.sin(x / 8) * Math.cos(y / 11);

  it("refusé : des bords étalés partout (image floue)", () => {
    const smooth = sample(blurryBackground);
    expect(frameSharpness(smooth)).toBeLessThan(BLUR_LIMITS.minSharpness);
    expect(isBlurryFrame(smooth)).toBe(true);
  });

  it("permis : un damier net", () => {
    expect(isBlurryFrame(sample((x, y) => checker(x, y)))).toBe(false);
  });

  it("refusé : fond flou et colonne de droite nette (les boutons de TikTok sont hors de la zone examinée)", () => {
    const frame = sample((x, y) => (x >= W * 0.82 ? checker(x, y) : blurryBackground(x, y)));
    expect(isBlurryFrame(frame)).toBe(true);
  });

  it("refusé : seul le bouton central est net (il est retiré de la zone)", () => {
    const frame = sample((x, y) => {
      const fx = (x + 0.5) / W;
      const fy = (y + 0.5) / H;
      return fx >= 0.4 && fx < 0.6 && fy >= 0.42 && fy < 0.58 ? checker(x, y) : blurryBackground(x, y);
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

  it("la netteté ne dépend pas de la luminosité (bords jugés par rapport à leur gradient)", () => {
    const sharp = real("05-nette");
    expect(frameSharpness(darken(sharp, 0.25))! / frameSharpness(sharp)!).toBeGreaterThan(0.8);
    expect(frameSharpness(real("06-floue"))).toBeLessThan(BLUR_LIMITS.minSharpness);
  });

  // Gros plan d'un vêtement uni (le cas principal) : prise en 1080 × 1920,
  // réduite à 96 px par moyenne de surface comme le fait l'app. Le bord tombe
  // au milieu d'un pixel de la copie, comme après une vraie réduction.
  const BIG_W = 1080;
  const BIG_H = 1920;
  const downscale = (pixel: (x: number, y: number) => number): FrameSample => {
    const gray = new Uint8Array(W * H);
    const sx = BIG_W / W;
    const sy = BIG_H / H;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        let sum = 0;
        let count = 0;
        for (let by = Math.floor(y * sy); by < Math.floor((y + 1) * sy); by += 2) {
          for (let bx = Math.floor(x * sx); bx < Math.floor((x + 1) * sx); bx += 2) {
            sum += pixel(bx, by);
            count += 1;
          }
        }
        gray[y * W + x] = Math.round(sum / count);
      }
    }
    return { gray, width: W, height: H, colors: [] };
  };
  /** Manteau sombre sur la moitié gauche, mur clair à droite ; `blur` : demi-
   * largeur (px de l'image d'origine) d'un bord adouci en rampe linéaire. */
  const coatHalf = (blur: number) =>
    downscale((x) => {
      const edge = BIG_W * 0.47;
      if (blur === 0) return x < edge ? 25 : 225;
      const t = Math.max(0, Math.min(1, (x - edge + blur) / (2 * blur)));
      return 25 + t * 200;
    });
  /** Gros plan : manteau sombre en buste, visage clair au-dessus. */
  const coatCloseUp = (blur: number) =>
    downscale((x, y) => {
      const ramp = (d: number) => (blur === 0 ? (d < 0 ? 0 : 1) : Math.max(0, Math.min(1, (d + blur) / (2 * blur))));
      const inCoat = Math.min(ramp(x - BIG_W * 0.153), ramp(BIG_W * 0.853 - x), ramp(y - BIG_H * 0.453));
      return 225 - inCoat * 205;
    });

  it("permis : gros plan net d'un vêtement uni (manteau sombre sur la moitié de l'image, en buste), même assombri", () => {
    for (const frame of [coatHalf(0), coatCloseUp(0)]) {
      expect(isBlankFrame(frame)).toBe(false);
      expect(isBlurryFrame(frame)).toBe(false);
      expect(isBlurryFrame(darken(frame, 0.25))).toBe(false);
    }
  });

  it("refusé : le même gros plan flou (bord étalé sur 40 px de l'image d'origine)", () => {
    expect(isBlurryFrame(coatHalf(40))).toBe(true);
    expect(isBlurryFrame(coatCloseUp(40))).toBe(true);
  });

  // La zone est jugée par tuiles (3 × 3, tuile la plus nette) et sans les
  // bandes noires du haut et du bas.
  /** Une ligne de sous-titre incrustée (nette même quand la caméra bouge), à
   * 30 % de la hauteur : traits blancs de 1 px sur fond sombre. */
  const withCaption = (frame: FrameSample): FrameSample => {
    const gray = Uint8Array.from(frame.gray);
    const top = Math.floor(0.3 * frame.height);
    for (let y = top; y < top + 3; y += 1) {
      for (let x = Math.floor(0.1 * frame.width); x < Math.floor(0.75 * frame.width); x += 1) {
        gray[y * frame.width + x] = x % 3 === 0 || (y === top + 1 && x % 5 < 2) ? 255 : 20;
      }
    }
    return { ...frame, gray };
  };
  /** Vidéo en paysage (bande 16:9) entre deux bandes noires, dans la boîte 9:16. */
  const letterboxed = (frame: FrameSample, band: number): FrameSample => {
    const bandHeight = Math.round((frame.width * 9) / 16);
    const top = Math.floor((frame.height - bandHeight) / 2);
    const gray = frame.gray.map((value, i) => {
      const y = Math.floor(i / frame.width);
      return y >= top && y < top + bandHeight ? value : band;
    });
    return { ...frame, gray };
  };

  it("limite assumée : la vraie image floue (capture 06) avec une ligne de sous-titre nette passe (acceptation à tort, comme au build 3)", () => {
    const frame = withCaption(real("06-floue"));
    expect(isBlankFrame(frame)).toBe(false);
    expect(isBlurryFrame(frame)).toBe(false);
  });

  it("permis : la vraie image nette (capture 05) avec la même ligne de sous-titre", () => {
    expect(isBlurryFrame(withCaption(real("05-nette")))).toBe(false);
  });

  it("refusé : la vraie image floue (capture 06) entre deux bandes noires (vidéo en paysage), noir pur ou presque noir", () => {
    for (const band of [0, 12]) {
      const frame = letterboxed(real("06-floue"), band);
      expect(isBlankFrame(frame)).toBe(false);
      expect(isBlurryFrame(frame)).toBe(true);
    }
  });

  it("permis : la vraie image nette (capture 05) entre deux bandes noires", () => {
    for (const band of [0, 12]) expect(isBlurryFrame(letterboxed(real("05-nette"), band))).toBe(false);
  });

  it("le code juge la tuile la plus nette, sans les bandes noires du haut et du bas", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/lib/player-state.ts", import.meta.url)), "utf8");
    expect(source).toContain("const SHARPNESS_TILES = 3;");
    expect(source).toContain("return tileScores[tileScores.length - 1]!;");
    expect(source).not.toContain("Math.floor((tileScores.length - 1) / 2)");
    expect(source).toContain("while (top < bottom && rowBlack(top)) top += 1;");
  });

  // Sujet net étroit (silhouette en pied, 18 % de la largeur) sur un fond
  // flou (mode portrait) : il n'occupe qu'une colonne de tuiles sur trois.
  const narrowSubject = (blur: number) =>
    downscale((x, y) => {
      const ramp = (d: number) => (blur === 0 ? (d < 0 ? 0 : 1) : Math.max(0, Math.min(1, (d + blur) / (2 * blur))));
      const inCoat = Math.min(ramp(x - BIG_W * 0.343), ramp(BIG_W * 0.517 - x), ramp(y - BIG_H * 0.2), ramp(BIG_H * 0.8 - y));
      const background = 130 + 50 * Math.sin(x / 70) * Math.cos(y / 90);
      return background * (1 - inCoat) + 22 * inCoat;
    });

  it("permis : un sujet net étroit sur un fond flou (une seule colonne de tuiles nette), même assombri", () => {
    for (const frame of [narrowSubject(0), darken(narrowSubject(0), 0.25)]) {
      expect(isBlankFrame(frame)).toBe(false);
      expect(isBlurryFrame(frame)).toBe(false);
    }
  });

  it("refusé : le même sujet flou lui aussi (bord étalé sur 40 px de l'image d'origine)", () => {
    expect(isBlurryFrame(narrowSubject(40))).toBe(true);
  });

  it("permis : une zone unie ou un tissu uni à plis doux (aucun vrai bord à 96 px : rien à juger, le doute profite au membre)", () => {
    expect(frameSharpness(sample(() => 120))).toBeNull();
    expect(isBlurryFrame(sample(() => 120))).toBe(false);
    const plainCoat = sample((x, y) => 70 + 8 * Math.sin(x / 6 + y / 9));
    expect(isBlankFrame(plainCoat)).toBe(false);
    expect(frameSharpness(plainCoat)).toBeNull();
    expect(isBlurryFrame(plainCoat)).toBe(false);
  });

  // Plan de nuit : fond sombre (8 à 20) et une seule mince bande de fenêtres
  // éclairées, nettes, à 55 % de la hauteur.
  const litStrip = (rows: number) =>
    sample((x, y) => {
      const top = Math.floor(0.55 * H);
      if (y >= top && y < top + rows) return (x >> 1) % 2 ? 200 : 15;
      return 8 + ((x * 7 + y * 3) % 13);
    });

  it("permis : un plan de nuit dont seule une mince bande est éclairée (4 ou 6 lignes) : rien à juger, pas refusé", () => {
    for (const rows of [4, 6]) {
      const frame = litStrip(rows);
      expect(isBlankFrame(frame)).toBe(false);
      expect(frameSharpness(frame)).toBeNull();
      expect(isBlurryFrame(frame)).toBe(false);
    }
  });

  it("refusé : la même bande éclairée mais floue et plus haute reste jugée (le null ne vaut que sans lignes à juger)", () => {
    const frame = sample((x, y) => {
      const top = Math.floor(0.4 * H);
      if (y >= top && y < top + 40) return 110 + 60 * Math.sin(x / 8) * Math.cos(y / 11);
      return 8 + ((x * 7 + y * 3) % 13);
    });
    expect(frameSharpness(frame)).not.toBeNull();
    expect(isBlurryFrame(frame)).toBe(true);
  });

  it("le code rend null (rien à juger) et non 0 quand il ne reste pas assez de lignes", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/lib/player-state.ts", import.meta.url)), "utf8");
    expect(source).toContain("if (right - left < 3 || bottom - top < 3) return null;");
    expect(source).toContain("if (width < 3 || height < 3) return null;");
    expect(source).not.toContain("bottom - top < 3) return 0;");
  });

  // Limite connue : un satin uni à plis doux (amplitude 15 à 30), net, mesure
  // comme flou ; le refus pour flou ne vaut donc que pour TikTok.
  const satin = (amplitude: number) => sample((x, y) => 110 + amplitude * Math.sin((2 * Math.PI * (x + 0.4 * y)) / 22));

  it("limite connue : un satin net à plis doux est jugé flou par la mesure (amplitude 15 à 30) ; ce refus ne retire pas le lecteur (playerStaysOffered)", () => {
    for (const amplitude of [15, 30]) {
      expect(isBlankFrame(satin(amplitude))).toBe(false);
      expect(isBlurryFrame(satin(amplitude))).toBe(true);
    }
  });

  it("refus pour flou : appliqué à TikTok (fond flou vu, capture 06), pas à Instagram (seule voie, le doute profite au membre)", () => {
    expect(blurCheckApplies("tiktok")).toBe(true);
    expect(blurCheckApplies("instagram")).toBe(false);
  });

  it("refusé : rien à juger ne vaut que sans aucun bord — l'image floue 06 a des bords mesurables, elle reste refusée", () => {
    const score = frameSharpness(real("06-floue"));
    expect(score).not.toBeNull();
    expect(isBlurryFrame(real("06-floue"))).toBe(true);
  });
});
