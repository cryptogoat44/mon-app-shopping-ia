// Options du build (mission « liens vidéo ») : les deux lecteurs officiels,
// TikTok et Instagram, présents ou non dans l'app construite. Allumés par
// défaut ; coupés seulement par la valeur exacte « false » des variables
// EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER et EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER
// (fichier .env, ou réglages du build EAS).
//
// Écrit pour Metro : `process.env.EXPO_PUBLIC_…` est lu tel quel (jamais par
// une variable ni une déstructuration), si bien que babel-preset-expo y
// écrit la valeur au moment du build. `"false" !== "false"` devient alors une
// constante `false`, que le minifieur propage : les branches du lecteur
// gardées par `features.…` ne servent plus à rien dans le paquet du build.
//
// Le serveur a ses propres interrupteurs (`players` de /api/video-links/lookup) :
// ils ne peuvent que COUPER un lecteur présent dans le build, jamais en
// allumer un absent (lib/player-decision.ts).
// Les deux coupés : le module natif de l'instantané n'est même pas relié à
// l'app (plugins/lecteur-integre.js, même règle de lecture).
// Imports relatifs : fichier testé par vitest.

export interface BuildFeatures {
  tiktokPlayer: boolean;
  instagramPlayer: boolean;
}

/** Règle de lecture d'une option : allumée sauf valeur exacte « false ». */
export function featureOn(value: string | undefined): boolean {
  return value !== "false";
}

/** Les deux options, d'après des valeurs données (tests, plugin de configuration). */
export function readFeatures(env: { tiktok: string | undefined; instagram: string | undefined }): BuildFeatures {
  return { tiktokPlayer: featureOn(env.tiktok), instagramPlayer: featureOn(env.instagram) };
}

/** Options de CE build. */
export const features: BuildFeatures = {
  tiktokPlayer: process.env.EXPO_PUBLIC_FEATURE_TIKTOK_PLAYER !== "false",
  instagramPlayer: process.env.EXPO_PUBLIC_FEATURE_INSTAGRAM_PLAYER !== "false",
};

/** Au moins un lecteur dans le build : le module natif de l'instantané y est relié. */
export const anyPlayerInBuild: boolean = features.tiktokPlayer || features.instagramPlayer;
