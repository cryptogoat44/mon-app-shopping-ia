import { describe, expect, it } from "vitest";
import { containsLink } from "../src/lib/link-detection";
import { isOwnCacheFile } from "../src/lib/local-files";
import { recordingDevice } from "../src/lib/screen-recording";
import { sanitizeProps } from "../src/lib/analytics-events";

// Lot 4 ter : petites règles du parcours unique.
describe("lien collé dans la description", () => {
  it.each([
    ["https://vm.tiktok.com/ZMabc123/", true],
    ["Regarde ! https://www.instagram.com/reel/abc/", true],
    ["pin.it/4xYz", true],
    ["https://www.zara.com/fr/veste", true],
    ["veste en daim marron", false],
    ["t-shirt Nike noir", false],
    ["  ", false],
  ])("« %s » : lien %s", (text, expected) => {
    expect(containsLink(text)).toBe(expected);
  });
});

describe("où lancer l'enregistrement de l'écran", () => {
  it("app iPhone ; site sur iPhone, iPad, Android ; ordinateur", () => {
    expect(recordingDevice("ios", null, 0)).toBe("ios");
    expect(recordingDevice("web", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe("ios");
    expect(recordingDevice("web", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(recordingDevice("web", "Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5)).toBe("android");
    expect(recordingDevice("web", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("computer");
    expect(recordingDevice("web", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe("computer");
  });
});

describe("Spotto n'efface que ses propres copies (jamais la galerie)", () => {
  const cache = "file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/";
  it("copie du sélecteur, image extraite : dans le cache, effaçables", () => {
    expect(isOwnCacheFile(`${cache}ImagePicker/1.MOV`, cache)).toBe(true);
    expect(isOwnCacheFile(`${cache}ImageManipulator/2.jpg`, cache.slice(0, -1))).toBe(true);
  });
  it("vidéo de la photothèque, chemin détourné : jamais touchés", () => {
    expect(isOwnCacheFile("file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.MOV", cache)).toBe(false);
    expect(isOwnCacheFile(`${cache}../Documents/x.mov`, cache)).toBe(false);
    expect(isOwnCacheFile("ph://ED7AC36B-A150-4C38-BB8C-B6D696F4F2ED/L0/001", cache)).toBe(false);
  });
});

describe("statistiques : la dernière vidéo de la galerie est une source admise", () => {
  it("« latest » accepté, toute autre valeur retirée", () => {
    expect(sanitizeProps("video_imported", { duration_s: 12, source: "latest" })).toEqual({ duration_s: 12, source: "latest" });
    expect(sanitizeProps("video_imported", { duration_s: 12, source: "galerie" })).toEqual({ duration_s: 12 });
  });
});
