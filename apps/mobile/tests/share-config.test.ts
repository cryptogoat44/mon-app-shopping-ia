import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { APP_GROUP, APP_SCHEME, SHARE_KEY, isShareOpeningUrl } from "../src/lib/shared-item";
import { sanitizeProps } from "../src/lib/analytics-events";

// Lot « partager vers Spotto » : réglages de l'extension de partage d'iOS
// (app.json) et retouches de plugins/extension-partage.js, appliquées aux
// fichiers que produit réellement expo-share-intent.
const require = createRequire(import.meta.url);
const { nommer, declarerGroupe } = require("../plugins/extension-partage.js");
const fichiersExtension = require("expo-share-intent/plugin/build/ios/writeIosShareExtensionFiles");

const expo = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const entree = expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-share-intent");
const options = entree?.[1];

describe("extension de partage (app.json)", () => {
  it("activée pour 1 lien web, 1 image, 1 vidéo et le texte (le lien en est tiré) ; ni fichier quelconque, ni page web", () => {
    // Texte : un message WhatsApp ou une app qui partage « Regarde… https://… » ;
    // un texte sans lien reçoit le message « contenu non pris en charge ».
    expect(options.iosActivationRules).toEqual({
      NSExtensionActivationSupportsWebURLWithMaxCount: 1,
      NSExtensionActivationSupportsImageWithMaxCount: 1,
      NSExtensionActivationSupportsMovieWithMaxCount: 1,
      NSExtensionActivationSupportsText: true,
    });
  });

  it("groupe d'apps et identifiant cohérents avec l'app ; Android non concerné", () => {
    expect(expo.ios.bundleIdentifier).toBe("com.spottoapp.ios");
    expect(options.iosAppGroupIdentifier).toBe(`group.${expo.ios.bundleIdentifier}`);
    expect(options.iosAppGroupIdentifier).toBe(APP_GROUP);
    expect(options.iosShareExtensionBundleIdentifier).toBe(`${expo.ios.bundleIdentifier}.share-extension`);
    expect(options.disableAndroid).toBe(true);
    expect(expo.scheme).toBe(APP_SCHEME);
  });

  it("retouches locales déclarées, et motif « groupe d'apps » dans le manifeste de l'app", () => {
    expect(expo.plugins).toContain("./plugins/extension-partage.js");
    const reglages = expo.ios.privacyManifests.NSPrivacyAccessedAPITypes.find(
      (type: { NSPrivacyAccessedAPIType: string }) => type.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults"
    );
    expect(reglages.NSPrivacyAccessedAPITypeReasons).toEqual(["CA92.1", "1C8F.1"]);
  });
});

describe("fichiers de l'extension, tels que le module les écrit puis retouchés", () => {
  it("nom affiché « Spotto », règles d'activation et groupe d'apps reportés", () => {
    const brut = fichiersExtension.getShareExtensionInfoContent(expo.name, expo.ios.bundleIdentifier, options);
    expect(brut).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Spotto - Share Extension<\/string>/);
    const infoPlist = nommer(brut, expo.name);
    expect(infoPlist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Spotto<\/string>/);
    expect(infoPlist).toContain("<key>NSExtensionActivationSupportsMovieWithMaxCount</key>");
    expect(infoPlist).toMatch(/<key>NSExtensionActivationSupportsText<\/key>\s*<true\/>/);
    expect(infoPlist).toContain(`<string>${APP_GROUP}</string>`);
    expect(nommer(infoPlist, "A & <B>")).toContain("<string>A &amp; &lt;B&gt;</string>");
  });

  it("manifeste de confidentialité : motif « groupe d'apps » ajouté une fois", () => {
    const manifeste = declarerGroupe(fichiersExtension.getPrivacyInfoContent());
    expect(manifeste).toMatch(/<string>CA92\.1<\/string>\s*<string>1C8F\.1<\/string>/);
    expect(declarerGroupe(manifeste)).toBe(manifeste);
  });

  it("l'extension écrit sous la clé que l'app lit, et rouvre l'app par une adresse reconnue", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const swift: string = fichiersExtension.getShareExtensionViewControllerContent(expo.scheme, APP_GROUP, true);
    expect(swift).toContain(`let sharedKey: String = "${SHARE_KEY}"`);
    expect(swift).toContain(`let shareProtocol: String = "${APP_SCHEME}"`);
    expect(swift).toContain(`let hostAppGroupIdentifier: String = "${APP_GROUP}"`);
    // Forme de l'adresse d'ouverture dans redirectToHostApp : « <schéma>://dataUrl=<clé>?nonce=…#<type> ».
    expect(swift).toContain("\\(shareProtocol)://dataUrl=\\(sharedKey)?nonce=\\(nonce)#\\(type)");
    expect(isShareOpeningUrl(`${APP_SCHEME}://dataUrl=${SHARE_KEY}?nonce=1#weburl`)).toBe(true);
    vi.restoreAllMocks();
  });

  it("format du module changé : retouche refusée (le prebuild s'arrête)", () => {
    expect(nommer("<plist><dict/></plist>", "Spotto")).toBeNull();
    expect(declarerGroupe("<plist><dict/></plist>")).toBeNull();
  });
});

describe("statistiques : la vidéo partagée est une source admise", () => {
  it("« share » accepté, sans rien d'autre", () => {
    expect(sanitizeProps("video_imported", { duration_s: 12, source: "share" })).toEqual({ duration_s: 12, source: "share" });
    expect(sanitizeProps("video_rejected", { reason: "too_long", source: "share", uri: "file:///x.mov" })).toEqual({ reason: "too_long", source: "share" });
  });
});
