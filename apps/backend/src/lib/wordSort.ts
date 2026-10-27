// Tri par les mots d'une photo (petit lot 2, décision du fondateur du 27
// octobre 2026). Les mots tapés sous la photo ne partent jamais vers Google
// Lens et ne sont pas enregistrés avec la recherche : ils servent seulement à
// remonter en tête les propositions dont le nom contient un des mots.
// - Accents et majuscules ignorés ; un mot compte aussi au début d'un mot plus
//   long (« noir » trouve « noire », « veste » trouve « vestes »).
// - Rien n'est retiré, caché ni marqué : les autres propositions gardent leur
//   ordre, juste après. Si aucune ne correspond, l'ordre ne change pas.
// - Les petits mots courants (« la », « en », « the »…) ne comptent pas.

/** Petits mots qui ne désignent pas une pièce (français et anglais). */
const SMALL_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "en", "et", "au", "aux", "avec", "pour", "sur", "dans", "par", "ma", "mon", "mes", "ce", "cette", "ces", "qui", "que",
  "the", "an", "of", "with", "and", "for", "in", "on", "my", "this", "that",
]);

/** Minuscules, sans accents, découpé en mots (lettres et chiffres). */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Les mots qui comptent pour le tri : 2 lettres au moins, hors petits mots courants. */
export function significantWords(text: string): string[] {
  return [...new Set(wordsOf(text).filter((word) => word.length >= 2 && !SMALL_WORDS.has(word)))];
}

/** Le nom contient-il un des mots (au début d'un de ses mots) ? */
export function nameMatches(name: string, words: readonly string[]): boolean {
  const nameWords = wordsOf(name);
  return words.some((word) => nameWords.some((nameWord) => nameWord.startsWith(word)));
}

/** Remonte en tête, dans leur ordre, les propositions dont le nom contient un
 * des mots ; les autres suivent, dans leur ordre. `sorted` : au moins une
 * proposition correspond (l'app l'indique alors au-dessus des résultats). */
export function sortByWords<T extends { productName: string }>(matches: readonly T[], text: string | null | undefined): { matches: T[]; sorted: boolean } {
  const words = significantWords(text ?? "");
  if (words.length === 0) return { matches: [...matches], sorted: false };
  const first = matches.filter((match) => nameMatches(match.productName, words));
  if (first.length === 0) return { matches: [...matches], sorted: false };
  return { matches: [...first, ...matches.filter((match) => !nameMatches(match.productName, words))], sorted: true };
}
