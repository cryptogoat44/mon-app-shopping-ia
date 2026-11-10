import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « nettoyage avant le premier build » : le module natif qui prenait
// l'image du lecteur intégré est HORS de l'app. Ce fichier vérifie qu'il n'en
// reste rien (ni dossier, ni pont, ni appel), que le lecteur n'est proposé
// nulle part — même interrupteurs allumés —, et que l'accord préalable (sans
// rapport avec la capture) marche toujours. Doubles du stockage seulement.
const { storage, flags } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  flags: { LINK_PLAYER_ENABLED: false, PLAYER_TIKTOK_ENABLED: true, PLAYER_INSTAGRAM_ENABLED: false },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.1" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
// Les interrupteurs, lus au moment de l'appel : le second bloc les allume tous.
vi.mock("../src/lib/spot-flags", () => ({
  LINK_COVER_ENABLED: false,
  PLAYER_CONSENT_GATE: true,
  get LINK_PLAYER_ENABLED() {
    return flags.LINK_PLAYER_ENABLED;
  },
  get PLAYER_TIKTOK_ENABLED() {
    return flags.PLAYER_TIKTOK_ENABLED;
  },
  get PLAYER_INSTAGRAM_ENABLED() {
    return flags.PLAYER_INSTAGRAM_ENABLED;
  },
}));

import { linkStep } from "../src/lib/link-step";
import { PLAYER_CAPTURE_IN_BUILD, grantPlayerConsent, isPlayerAvailable, playerPlatforms, readPlayerConsent, withdrawPlayerConsent } from "../src/lib/player-access";

const MOBILE = fileURLToPath(new URL("..", import.meta.url));

/** Tous les fichiers de code de l'app (hors dépendances et dossiers générés). */
function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", "dist", ".expo", "ios", "android"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return codeFiles(path);
    return /\.(ts|tsx|js|jsx|json|swift|m|mm|h|podspec)$/.test(name) ? [path] : [];
  });
}

beforeEach(() => {
  storage.clear();
  Object.assign(flags, { LINK_PLAYER_ENABLED: false, PLAYER_TIKTOK_ENABLED: true, PLAYER_INSTAGRAM_ENABLED: false });
});

describe("module natif de capture du lecteur : hors de l'app", () => {
  it("le dossier du module et son pont n'existent plus", () => {
    expect(existsSync(join(MOBILE, "modules", "spotto-frame-capture"))).toBe(false);
    // Plus aucun module natif local : Expo n'en relie donc aucun au build.
    expect(existsSync(join(MOBILE, "modules"))).toBe(false);
    expect(existsSync(join(MOBILE, "src", "lib", "player-capture.ts"))).toBe(false);
    expect(existsSync(join(MOBILE, "src", "lib", "player-capture.web.ts"))).toBe(false);
  });

  it("aucun fichier de code de l'app ne charge le module ni n'appelle une capture de la vue web ou de l'écran", () => {
    const interdits = /SpottoFrameCapture|FrameCaptureModule|captureWebView|captureScreen|cancelScreenCapture|screenCaptureAvailable|takeSnapshot|RPScreenRecorder|ReplayKit|pauseAllMediaPlayback|requestMediaPlaybackState/;
    const fautifs = [...codeFiles(join(MOBILE, "src")), join(MOBILE, "app.json"), join(MOBILE, "package.json")].filter((file) => interdits.test(readFileSync(file, "utf8")));
    expect(fautifs).toEqual([]);
    expect(codeFiles(MOBILE).filter((file) => /\.(swift|m|mm|h|podspec)$/.test(file))).toEqual([]);
  });

  it("la constante le dit : le module de capture n'est pas dans le build", () => {
    expect(PLAYER_CAPTURE_IN_BUILD).toBe(false);
  });
});

describe("lecteur intégré : proposé nulle part", () => {
  it("interrupteurs d'aujourd'hui (LINK_PLAYER_ENABLED = false) : le parcours lien reste l'aide « capture d'écran d'abord »", () => {
    expect(isPlayerAvailable()).toBe(false);
    expect(isPlayerAvailable("tiktok")).toBe(false);
    expect(playerPlatforms()).toEqual([]);
    expect(linkStep("https://vm.tiktok.com/ZMabc123/", undefined, playerPlatforms())).toEqual({ kind: "help" });
    expect(linkStep("https://www.instagram.com/reel/Cxyz/", undefined, playerPlatforms())).toEqual({ kind: "help" });
  });

  it("même sur iPhone avec TOUS les interrupteurs allumés : sans le module de capture, aucune plateforme, toujours l'aide", () => {
    Object.assign(flags, { LINK_PLAYER_ENABLED: true, PLAYER_TIKTOK_ENABLED: true, PLAYER_INSTAGRAM_ENABLED: true });
    expect(playerPlatforms()).toEqual([]);
    expect(isPlayerAvailable()).toBe(false);
    expect(isPlayerAvailable("tiktok")).toBe(false);
    expect(isPlayerAvailable("instagram")).toBe(false);
    expect(linkStep("https://vm.tiktok.com/ZMabc123/", undefined, playerPlatforms())).toEqual({ kind: "help" });
  });
});

describe("accord préalable au lecteur officiel (sans rapport avec la capture)", () => {
  it("donné par plateforme, retiré dans Réglages", async () => {
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
    await grantPlayerConsent("tiktok");
    expect(await readPlayerConsent()).toEqual({ tiktok: true, instagram: false });
    await withdrawPlayerConsent();
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
  });
});
