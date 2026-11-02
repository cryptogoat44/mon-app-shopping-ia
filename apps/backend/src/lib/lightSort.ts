// Tri léger de la voie C (lot c, 2026-11-02) : sans IA ni réseau, des
// fonctions pures. Il range les propositions de la section « Cette pièce dans
// d'autres boutiques » par la marque et le modèle que l'IA a lus dans les
// titres Lens (et que le serveur a vérifiés : chacun figure dans ces titres).
// - Rien n'est retiré, caché ni marqué : seulement un ordre, par paliers ;
//   dans chaque palier, l'ordre de Google est gardé.
// - Les résultats Lens n'y passent jamais (leur ordre reste celui de
//   visualSearch.ts) ; la section « vos mots » garde le tri par les mots
//   (wordSort.ts).
// - Même découpage que le tri par les mots (wordsOf) : minuscules, sans
//   accents, coupé sur tout ce qui n'est ni lettre ni chiffre.
// - Marque et modèle gardent leurs lettres seules et tous leurs chiffres
//   (« a », « p », « c » pour une marque écrite comme A.P.C. ; « 1 », « 07 »,
//   « 501 ») ; les petits mots courants (SMALL_WORDS) sont ignorés côté
//   titres, donc jamais exigés : « Les Ateliers Exemple » se contente de
//   « ateliers » et « exemple ».
// - Un ensemble de mots VIDE n'est jamais « présent » : une marque faite
//   seulement de signes, ou un modèle absent, ne met pas tout au palier 0.

import { SMALL_WORDS, wordsOf } from "./wordSort.js";

/** Marque et modèle validés par le serveur (chaîne vide : non donné). */
export interface LightSortReference {
  brand: string;
  model: string;
}

/** Palier d'une proposition : 0 = marque et modèle complets dans le titre,
 * 1 = un seul des deux, 2 = aucun. */
export type TitleTier = 0 | 1 | 2;

/** Pluriel toléré (s, x ou es) pour les mots en lettres de 4 lettres au
 * moins : « basket » trouve « baskets », « manteau » trouve « manteaux ». */
const PLURAL_MIN_LETTERS = 4;
const LETTERS_ONLY = /^\p{L}+$/u;

function isPluralOf(base: string, word: string): boolean {
  return base.length >= PLURAL_MIN_LETTERS && (word === `${base}s` || word === `${base}x` || word === `${base}es`);
}

/** Deux mots (déjà passés par wordsOf) sont-ils le même mot ? Égaux, ou
 * l'un pluriel de l'autre s'ils ne sont faits que de lettres. */
export function sameToken(a: string, b: string): boolean {
  if (a === b) return true;
  if (!LETTERS_ONLY.test(a) || !LETTERS_ONLY.test(b)) return false;
  return isPluralOf(a, b) || isPluralOf(b, a);
}

/** Mots d'une marque ou d'un modèle : tous gardés (lettres seules et
 * chiffres compris), sauf les petits mots courants, qui ne comptent pas côté
 * titres. Sans doublon. */
export function referenceTokens(text: string): string[] {
  return [...new Set(wordsOf(text).filter((word) => !SMALL_WORDS.has(word)))];
}

/** Mots d'un titre, petits mots courants ignorés. */
export function titleTokens(title: string): string[] {
  return wordsOf(title).filter((word) => !SMALL_WORDS.has(word));
}

/** Tous les mots de la référence figurent-ils parmi ceux du titre ? Un
 * ensemble vide n'est jamais présent (jamais « vrai par défaut »). */
export function allTokensPresent(reference: readonly string[], tokens: readonly string[]): boolean {
  return reference.length > 0 && reference.every((word) => tokens.some((token) => sameToken(word, token)));
}

/** Palier d'un titre pour la marque et le modèle donnés. Modèle vide : palier
 * 0 si la marque est complète, sinon 2 ; marque vide (variante permissive
 * de la règle 12) ou faite seulement de petits mots (« On », acceptée avec un
 * modèle par services/shoppingQueryAi.ts) : de même avec le modèle ; les deux
 * vides : 2. */
export function titleTier(title: string, reference: LightSortReference): TitleTier {
  const tokens = titleTokens(title);
  const brand = referenceTokens(reference.brand);
  const model = referenceTokens(reference.model);
  const brandComplete = allTokensPresent(brand, tokens);
  const modelComplete = allTokensPresent(model, tokens);
  if (model.length === 0) return brandComplete ? 0 : 2;
  if (brand.length === 0) return modelComplete ? 0 : 2;
  if (brandComplete && modelComplete) return 0;
  return brandComplete || modelComplete ? 1 : 2;
}

/** Partition stable : palier 0, puis 1, puis 2, dans l'ordre de Google à
 * l'intérieur de chacun. Rien n'est retiré. `tierCounts` (nombres seulement)
 * va dans la ligne « Mesure complément ». */
export function lightSort<T extends { productName: string }>(
  items: readonly T[],
  reference: LightSortReference
): { items: T[]; tierCounts: [number, number, number] } {
  const tiers: [T[], T[], T[]] = [[], [], []];
  for (const item of items) tiers[titleTier(item.productName, reference)].push(item);
  return { items: [...tiers[0], ...tiers[1], ...tiers[2]], tierCounts: [tiers[0].length, tiers[1].length, tiers[2].length] };
}
