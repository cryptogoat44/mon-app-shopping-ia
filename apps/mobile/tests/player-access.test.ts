import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mission « liens vidéo » : le lecteur officiel revient, avec « Spotter ce
// moment ». Ce fichier vérifie les invariants de la prise d'image (règle
// absolue n° 2) : un seul module natif local, qui ne fait que mettre en pause
// la vue web et en prendre l'instantané (WKWebView.takeSnapshot) — jamais
// ReplayKit, jamais createPDF, jamais un fichier de la plateforme téléchargé.
// Puis la disponibilité du lecteur d'après les options du build, et l'accord
// préalable. Doubles du stockage et des options seulement.
// (Remplace l'ancien test « le module natif n'existe plus » du lot
// « nettoyage avant le premier build » : la mission a remis le lecteur.)
const { storage, flags, os } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  flags: { tiktokPlayer: true, instagramPlayer: true },
  os: { OS: "ios" },
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return os.OS;
    },
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => void storage.set(key, value)),
    removeItem: vi.fn(async (key: string) => void storage.delete(key)),
  },
}));
// Options du build, lues au moment de l'appel.
vi.mock("../src/lib/features", () => ({
  features: {
    get tiktokPlayer() {
      return flags.tiktokPlayer;
    },
    get instagramPlayer() {
      return flags.instagramPlayer;
    },
  },
}));

import { grantPlayerConsent, isPlayerAvailable, readPlayerConsent, withdrawPlayerConsent } from "../src/lib/player-access";

const MOBILE = fileURLToPath(new URL("..", import.meta.url));
const MODULE = join(MOBILE, "modules", "spotto-player-snapshot");
const SWIFT = join(MODULE, "ios", "SpottoPlayerSnapshotModule.swift");
const read = (path: string) => readFileSync(path, "utf8");
/** Code Swift sans ses commentaires (ils citent ce qui est interdit). */
const swiftCode = (path: string) => read(path).replace(/\/\/.*$/gm, "");

/** Tous les fichiers de l'app (hors dépendances et dossiers générés). */
function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", "dist", ".expo", "ios", "android"].includes(name) && dir === MOBILE) return [];
    if (name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

beforeEach(() => {
  storage.clear();
  Object.assign(flags, { tiktokPlayer: true, instagramPlayer: true });
  os.OS = "ios";
});

describe("module natif de l'instantané : takeSnapshot, et rien d'autre", () => {
  it("un module local Expo, iOS seulement, une seule classe", () => {
    expect(JSON.parse(read(join(MODULE, "expo-module.config.json")))).toEqual({ platforms: ["apple"], apple: { modules: ["SpottoPlayerSnapshotModule"] } });
    expect(existsSync(SWIFT)).toBe(true);
    expect(read(join(MODULE, "ios", "SpottoPlayerSnapshot.podspec"))).toMatch(/s\.frameworks\s*=\s*'WebKit', 'UIKit'\n/);
  });

  it("une seule fonction, `snapshot` : pause des médias de la vue web, puis WKWebView.takeSnapshot ; JPEG 1 600 px, qualité 0,8", () => {
    const code = swiftCode(SWIFT);
    expect([...code.matchAll(/(?:Async)?Function\("([^"]+)"\)/g)].map((match) => match[1])).toEqual(["snapshot"]);
    expect(code).toContain("webView.pauseAllMediaPlayback");
    expect(code).toContain("webView.takeSnapshot(with: configuration)");
    expect(code).toContain("maxSide: CGFloat = 1600");
    expect(code).toContain("quality: CGFloat = 0.8");
    expect(code).toContain("jpegData(compressionQuality: quality)");
    expect(code).toContain("config.cacheDirectory");
  });

  it("jamais d'enregistrement de l'écran, de PDF, de réseau ni de lecture d'un fichier de la plateforme", () => {
    const code = swiftCode(SWIFT);
    for (const forbidden of ["ReplayKit", "RPScreenRecorder", "startCapture", "createPDF", "PDFKit", "URLSession", "URLRequest", "Data(contentsOf", "AVAsset", "AVPlayer", "evaluateJavaScript", "callAsyncJavaScript"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // L'avertissement du fondateur reste en tête du fichier.
    expect(read(SWIFT)).toContain("SI L'INSTANTANÉ SORT NOIR SUR UN VRAI IPHONE : S'ARRÊTER LÀ");
    expect(read(join(MOBILE, "src", "lib", "player-snapshot.ts"))).toContain("SI L'INSTANTANÉ SORT NOIR SUR UN VRAI IPHONE : S'ARRÊTER LÀ");
  });

  it("aucun autre code natif dans l'app : ce module, et la recherche d'image d'iOS (plugin)", () => {
    const native = files(MOBILE, /\.(swift|m|mm|h|podspec)$/).map((path) => relative(MOBILE, path).split("\\").join("/"));
    expect(native.sort()).toEqual(
      ["modules/spotto-player-snapshot/ios/SpottoPlayerSnapshot.podspec", "modules/spotto-player-snapshot/ios/SpottoPlayerSnapshotModule.swift", "plugins/recherche-image/SpottoRechercheImage.swift"].sort()
    );
    expect(readdirSync(join(MOBILE, "modules"))).toEqual(["spotto-player-snapshot"]);
  });

  it("aucun fichier de l'app n'appelle une autre capture ni ne télécharge un média", () => {
    const forbidden = /ReplayKit|RPScreenRecorder|captureScreen|createPDF|captureWebView|downloadFileAsync|downloadAsync|createDownloadResumable|XMLHttpRequest/;
    const code = [...files(join(MOBILE, "src"), /\.(ts|tsx)$/), ...files(join(MOBILE, "plugins"), /\.(js|swift)$/), join(MOBILE, "app.json"), join(MOBILE, "package.json")];
    expect(code.filter((path) => forbidden.test(read(path)))).toEqual([]);
    // Le module natif n'est appelé que par son pont.
    expect(code.filter((path) => read(path).includes("SpottoPlayerSnapshot")).map((path) => relative(MOBILE, path))).toEqual([join("src", "lib", "player-snapshot.ts")]);
  });

  it("les fichiers du lecteur ne font aucun appel réseau (ni fetch, ni oEmbed) : tout passe par le serveur de l'app", () => {
    for (const name of ["src/lib/player-link.ts", "src/lib/player-host-page.ts", "src/lib/player-state.ts", "src/lib/player-decision.ts", "src/lib/player-snapshot.ts", "src/components/embedded-player.tsx", "src/app/(app)/spot/lecteur.tsx"]) {
      const code = read(join(MOBILE, name));
      expect(code, name).not.toMatch(/\bfetch\(|oembed|graph\.facebook\.com/i);
    }
  });
});

describe("lecteur possible d'après les options du build (app iPhone seulement)", () => {
  it("les deux options allumées (par défaut) : TikTok et Instagram", () => {
    expect(isPlayerAvailable()).toBe(true);
    expect(isPlayerAvailable("tiktok")).toBe(true);
    expect(isPlayerAvailable("instagram")).toBe(true);
  });

  it("une option coupée ne coupe pas l'autre ; les deux coupées : aucun lecteur", () => {
    flags.tiktokPlayer = false;
    expect(isPlayerAvailable("tiktok")).toBe(false);
    expect(isPlayerAvailable("instagram")).toBe(true);
    flags.instagramPlayer = false;
    expect(isPlayerAvailable()).toBe(false);
  });

  it("jamais sur le site ni sur Android", () => {
    for (const platform of ["web", "android"]) {
      os.OS = platform;
      expect(isPlayerAvailable()).toBe(false);
      expect(isPlayerAvailable("tiktok")).toBe(false);
    }
  });
});

describe("accord préalable au lecteur officiel (CNIL)", () => {
  it("donné par plateforme, retiré dans Réglages", async () => {
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
    await grantPlayerConsent("tiktok");
    expect(await readPlayerConsent()).toEqual({ tiktok: true, instagram: false });
    await withdrawPlayerConsent();
    expect(await readPlayerConsent()).toEqual({ tiktok: false, instagram: false });
  });
});
