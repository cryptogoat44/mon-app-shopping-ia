import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Configuration Expo telle qu'Expo la calcule (lot « nom et identifiants
// configurables ») : le contenu d'app.json, remis à app.config.js, qui remplace
// chaque repère « {ligne} » par la ligne du fichier unique de la marque
// (packages/shared-types/marque.json, MARQUE.md).
const require = createRequire(import.meta.url);

/** Contenu brut d'un fichier de l'app (chemin depuis apps/mobile). */
export function lireFichier(chemin: string): string {
  return readFileSync(new URL(`../${chemin}`, import.meta.url), "utf8");
}

/** La configuration complétée ; `marque` : d'autres valeurs que celles du fichier unique (essai d'un autre nom). */
export function configExpo(marque?: Record<string, string>) {
  const { expo } = JSON.parse(lireFichier("app.json"));
  const config = require("../app.config.js");
  if (!marque) return config({ config: expo });
  for (const [langue, chemin] of Object.entries(expo.locales)) expo.locales[langue] = JSON.parse(lireFichier(String(chemin)));
  return config.completer(expo, marque);
}
