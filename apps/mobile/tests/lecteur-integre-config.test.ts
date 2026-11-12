import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { readFeatures } from "../src/lib/features";

// Mission « liens vidéo » : le module natif de l'instantané
// (modules/spotto-player-snapshot) n'est relié à l'app que si au moins un
// lecteur est dans le build. expo-modules-autolinking ne lit ses exclusions
// que dans package.json ou dans les arguments que lui passe le Podfile : le
// plugin réécrit donc `use_expo_modules!` dans le Podfile généré.
const require = createRequire(import.meta.url);
const plugin = require("../plugins/lecteur-integre.js") as {
  MODULE: string;
  lecteursDuBuild: (env: Record<string, string | undefined>) => { tiktokPlayer: boolean; instagramPlayer: boolean };
  moduleRelie: (env: Record<string, string | undefined>) => boolean;
  exclureDuPodfile: (contenu: string) => string;
};

/** Début du Podfile généré par `expo prebuild` (SDK 57), tel qu'il sort du modèle d'Expo. */
const PODFILE = `require File.join(File.dirname(\`node --print "require.resolve('expo/package.json')"\`), "scripts/autolinking")

platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'

prepare_react_native_project!

target 'Spotto' do
  use_expo_modules!

  if ENV['EXPO_USE_COMMUNITY_AUTOLINKING'] == '1'
    config_command = ['node', '-e', "process.argv=['', '', 'config'];require('@react-native-community/cli').run()"];
  end
end
`;

describe("plugin du lecteur intégré : module de l'instantané relié seulement avec un lecteur", () => {
  it("même règle de lecture que src/lib/features.ts", () => {
    for (const tiktok of [undefined, "", "true", "false", "FALSE"]) {
      for (const instagram of [undefined, "false", "1"]) {
        const env = { EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER: tiktok, EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER: instagram };
        expect(plugin.lecteursDuBuild(env)).toEqual(readFeatures({ tiktok, instagram }));
      }
    }
  });

  it("relié par défaut, et dès qu'un des deux lecteurs est dans le build", () => {
    expect(plugin.moduleRelie({})).toBe(true);
    expect(plugin.moduleRelie({ EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER: "false" })).toBe(true);
    expect(plugin.moduleRelie({ EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER: "false" })).toBe(true);
    expect(plugin.moduleRelie({ EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER: "false", EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER: "false" })).toBe(false);
  });

  it("les deux coupés : le Podfile exclut le module de l'autolinking (nom = nom du dossier)", () => {
    expect(plugin.MODULE).toBe("spotto-player-snapshot");
    const out = plugin.exclureDuPodfile(PODFILE);
    expect(out).toContain("  use_expo_modules!(exclude: ['spotto-player-snapshot'])\n");
    expect(out.match(/use_expo_modules!/g)).toHaveLength(1);
    // Déjà réécrit : inchangé (prebuild relancé).
    expect(plugin.exclureDuPodfile(out)).toBe(out);
    expect(plugin.exclureDuPodfile(PODFILE.replace("use_expo_modules!", "use_expo_modules!()"))).toContain("use_expo_modules!(exclude: ['spotto-player-snapshot'])");
  });

  it("ligne introuvable ou déjà réglée autrement : le build s'arrête plutôt que de relier le module sans le vouloir", () => {
    expect(() => plugin.exclureDuPodfile("target 'Spotto' do\nend\n")).toThrow(/use_expo_modules!/);
    expect(() => plugin.exclureDuPodfile(PODFILE.replace("use_expo_modules!", "use_expo_modules!(searchPaths: ['x'])"))).toThrow(/use_expo_modules!/);
  });
});
