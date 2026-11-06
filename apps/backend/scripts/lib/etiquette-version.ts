// Étiquettes de version (lot « filets de sécurité », point 24 de la feuille
// de route V1) : une étiquette Git par mise en ligne, « v2026.11.06-1 »
// (date de Paris, puis le numéro de la mise en ligne du jour). Logique pure,
// testée (tests/etiquetteVersion.test.ts) ; les commandes Git sont dans
// scripts/etiqueter-version.ts.

/** Date du jour à Paris, au format « 2026.11.06 ». */
export function jourDeParis(maintenant: Date): string {
  // « fr-CA » écrit les dates en AAAA-MM-JJ.
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(maintenant).replaceAll("-", ".");
}

/** Prochaine étiquette du jour, d'après celles qui existent déjà. */
export function prochaineEtiquette(jour: string, existantes: readonly string[]): string {
  const prefixe = `v${jour}-`;
  const numeros = existantes
    .filter((etiquette) => etiquette.startsWith(prefixe))
    .map((etiquette) => etiquette.slice(prefixe.length))
    .filter((numero) => /^[1-9]\d*$/.test(numero))
    .map(Number);
  return `${prefixe}${numeros.length === 0 ? 1 : Math.max(...numeros) + 1}`;
}

/** Un commit écrit comme dans /health ou sur GitHub : 7 à 40 caractères hexadécimaux. */
export function commitValide(texte: string | undefined): string | null {
  return texte !== undefined && /^[0-9a-f]{7,40}$/i.test(texte) ? texte.toLowerCase() : null;
}
