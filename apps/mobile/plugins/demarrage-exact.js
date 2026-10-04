// Écran de démarrage pixel pour pixel (lot 3bis). expo-splash-screen
// recalcule son image même quand elle a déjà la bonne taille, ce qui adoucit
// légèrement les contours. Ce module remplace ensuite ses images par nos
// rendus exacts (×1, ×2, ×3), calculés depuis le tracé vectoriel par
// `pnpm --filter backend images-marque`.
// Il doit figurer AVANT "expo-splash-screen" dans app.json : les modules de
// ce type s'exécutent dans l'ordre inverse de leur déclaration.
const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withDangerousMod } = require("expo/config-plugins");

const SOURCES = path.join(__dirname, "../assets/marque/demarrage");
const IMAGESET = "Images.xcassets/SplashScreenLogo.imageset";
const FICHIERS = ["image.png", "image@2x.png", "image@3x.png", "dark_image.png", "dark_image@2x.png", "dark_image@3x.png"];

module.exports = function withDemarrageExact(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const racine = IOSConfig.Paths.getSourceRoot(config.modRequest.projectRoot);
      for (const fichier of FICHIERS) {
        fs.copyFileSync(path.join(SOURCES, fichier), path.join(racine, IMAGESET, fichier));
      }
      return config;
    },
  ]);
};
