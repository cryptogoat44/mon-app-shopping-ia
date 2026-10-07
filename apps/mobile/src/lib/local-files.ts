// Spotto n'efface que ses propres copies, rangées dans son dossier de cache
// (vidéo copiée par le sélecteur, images extraites) — jamais un fichier de la
// photothèque, comme la dernière vidéo proposée sur l'accueil (lot 4 ter).
// Logique pure, testée.
export function isOwnCacheFile(uri: string, cacheUri: string): boolean {
  const base = cacheUri.endsWith("/") ? cacheUri : `${cacheUri}/`;
  return uri.startsWith(base) && !uri.slice(base.length).split("/").includes("..");
}
