import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « lecteur intégré » : capture sur l'app iPhone, avec des doubles du
// module natif, de l'image (PNG de contrôle), du stockage et des fichiers.
const { native, storage, discardLocalFile, samples } = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const samples: ("black" | "picture")[] = [];
  return {
    native: {
      captureWebView: vi.fn(),
      captureScreen: vi.fn(),
      cancelScreenCapture: vi.fn(async () => undefined),
      screenCaptureAvailable: vi.fn(async () => true),
      pauseMedia: vi.fn(async () => "paused"),
      mediaState: vi.fn(async () => "playing"),
    },
    storage,
    samples,
    discardLocalFile: vi.fn(),
  };
});

vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "26.1" } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
vi.mock("../src/lib/video-frames", () => ({ discardLocalFile }));
// PNG de contrôle : on rend un échantillon déjà décodé (noir ou image).
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { PNG: "png" },
  ImageManipulator: {
    manipulate: () => ({
      resize: vi.fn(),
      renderAsync: async () => ({ saveAsync: async () => ({ uri: "file:///cache/sample.png", base64: samples.shift() ?? "black" }) }),
    }),
  },
}));
vi.mock("../src/lib/png-pixels", () => ({
  base64ToBytes: (value: string) => value,
  decodePngSample: (value: string) => {
    const gray = new Uint8Array(96 * 171).map((_, i) => (value === "picture" ? (i % 7) * 30 : 0));
    return { gray, width: 96, height: 171, colors: [] };
  },
}));

import { linkStep } from "../src/lib/link-step";
import { captureMoment, grantPlayerConsent, isPlayerAvailable, playerPlatforms, readPlayerConsent, reportBlackImage, withdrawPlayerConsent } from "../src/lib/player-capture";

const frame = (name: string) => ({ uri: `file:///cache/${name}.jpg`, width: 1029, height: 1830 });

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  samples.length = 0;
});

describe("lecteur coupé (LINK_PLAYER_ENABLED = false)", () => {
  it("module présent sur iPhone, mais lecteur jamais proposé : le parcours lien reste celui d'aujourd'hui", () => {
    expect(isPlayerAvailable()).toBe(false);
    expect(isPlayerAvailable("tiktok")).toBe(false);
    expect(playerPlatforms()).toEqual([]);
    expect(linkStep("https://vm.tiktok.com/ZMabc123/", undefined, playerPlatforms())).toEqual({ kind: "help" });
    expect(linkStep("https://www.instagram.com/reel/Cxyz/", undefined, playerPlatforms())).toEqual({ kind: "help" });
  });
});

describe("capture du lecteur (app iPhone, build de développement)", () => {
  it("pdf noir deux fois, photo directe bonne : image gardée, pdf effacé et relégué", async () => {
    native.captureWebView.mockImplementation(async (_tag: number, method: string) => frame(method));
    samples.push("black", "black", "picture");
    const result = await captureMoment({ viewTag: 7, confirmScreen: async () => true });
    expect(result.method).toBe("snapshot");
    expect(result.frame?.uri).toBe("file:///cache/snapshot.jpg");
    expect(discardLocalFile).toHaveBeenCalledWith("file:///cache/pdf.jpg");
    expect(JSON.parse(storage.get("spotto.lecteur-capture") ?? "{}")).toMatchObject({ os: "26.1", winner: "snapshot", failed: ["pdf"] });
  });

  it("refus de l'enregistrement de l'écran : aucune image ; méthodes reléguées toujours essayées après", async () => {
    storage.set("spotto.lecteur-capture", JSON.stringify({ os: "26.1", savedAt: Date.now(), winner: "screen", failed: ["pdf", "snapshot"], reports: {} }));
    native.captureScreen.mockRejectedValue(Object.assign(new Error("declined"), { code: "ERR_SCREEN_RECORDING_DECLINED" }));
    const result = await captureMoment({ viewTag: 7, confirmScreen: async () => true });
    expect(result.frame).toBeNull();
    expect(result.attempts).toEqual([{ method: "screen", outcome: "declined" }]);
  });

  it("écran quitté : rien n'est tenté", async () => {
    const result = await captureMoment({ viewTag: 7, confirmScreen: async () => true, stillWanted: () => false });
    expect(result.attempts).toEqual([]);
    expect(native.captureWebView).not.toHaveBeenCalled();
  });

  it("« L'image prise était noire » : deux signalements avant de reléguer la méthode", async () => {
    await reportBlackImage("pdf");
    expect(JSON.parse(storage.get("spotto.lecteur-capture") ?? "{}")).toMatchObject({ failed: [], reports: { pdf: 1 } });
    await reportBlackImage("pdf");
    expect(JSON.parse(storage.get("spotto.lecteur-capture") ?? "{}")).toMatchObject({ failed: ["pdf"], reports: { pdf: 2 } });
  });

  it("accord préalable : donné par plateforme, retiré dans Réglages", async () => {
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
    await grantPlayerConsent("tiktok");
    expect(await readPlayerConsent()).toEqual({ tiktok: true, instagram: false });
    await withdrawPlayerConsent();
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
  });
});
