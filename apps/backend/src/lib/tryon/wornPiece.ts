// Garde-fou de l'essayage (lot du 22 novembre 2026) : FASHN reçoit toute
// pièce avec la catégorie « auto » (providers/fashn.ts). Une chaussure, un
// sac, un bijou ou un objet de maison y gaspillerait un crédit payant pour
// une image ratée : la route les refuse avant toute réservation (quota,
// budget) et tout appel au fournisseur.
// Seul le nom de la pièce est connu ici (product_matches n'a pas de
// catégorie). Mots en français et en anglais, tenus à UN seul endroit,
// packages/shared-types/pieces-portees.json (le site lit le même), dans
// l'esprit de lib/fashionWords.ts : minuscules, sans accents, un mot compte
// tel quel ou au pluriel. Dans le doute, la pièce passe, comme avant : nom
// vide, aucun mot reconnu, ou un mot de vêtement à côté (« robe ceinture »).
import words from "@monapp/shared-types/pieces-portees.json" with { type: "json" };

/** Les mots d'un nom : minuscules, sans accents ; apostrophes et tirets séparent. */
function wordsOf(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z0-9]+/g) ?? []
  );
}

/** Le mot du nom est-il ce mot, tel quel ou au pluriel ? */
function sameWord(nameWord: string, word: string): boolean {
  return nameWord === word || nameWord === `${word}s` || nameWord === `${word}es` || nameWord === `${word}x`;
}

/** Une de ces expressions commence-t-elle au mot `start` du nom ? */
function startsAt(name: readonly string[], start: number, expressions: readonly (readonly string[])[]): boolean {
  return expressions.some((expression) => expression.every((word, offset) => start + offset < name.length && sameWord(name[start + offset]!, word)));
}

/** Le nom contient-il une de ces expressions (un ou plusieurs mots, à la suite) ? */
function mentions(name: readonly string[], expressions: readonly (readonly string[])[]): boolean {
  return name.some((_, start) => startsAt(name, start, expressions));
}

const GARMENTS = words.vetements.map(wordsOf);
const NOT_WORN = words.nonPortees.map(wordsOf);
// Mots de vêtement seulement avant tout mot de pièce non portée, et pas
// suivis d'un tel mot (« Zara Body col bijou », « Petit haut col bijou ») :
// sinon, ce sont des adjectifs (« Baskets hautes », « Cross body bag »).
const HEAD_GARMENTS = (words.vetementsEnTete ?? []).map(wordsOf);
// Expressions toujours refusées, même avec un mot de vêtement (« Body chain »).
const ALWAYS_NOT_WORN = (words.nonPorteesToujours ?? []).map(wordsOf);

/** Le nom dit-il un vêtement : un mot de vêtement n'importe où, ou un mot
 * « en tête » (« haut », « body ») placé avant tout mot de pièce non portée
 * et pas suivi d'un tel mot (sinon il qualifie la pièce : « Sac haut de
 * gamme », « Cross body bag ») ? */
function namesGarment(name: readonly string[]): boolean {
  if (mentions(name, GARMENTS)) return true;
  for (let index = 0; index < name.length; index++) {
    if (startsAt(name, index, NOT_WORN)) return false;
    if (HEAD_GARMENTS.some((expression) => expression.length === 1 && sameWord(name[index]!, expression[0]!)) && !startsAt(name, index + 1, NOT_WORN)) return true;
  }
  return false;
}

/** Faux seulement quand le nom dit sûrement une pièce qui ne se porte pas
 * sur le corps (chaussure, sac, bijou, montre, lunettes, chapeau, ceinture,
 * accessoire, objet de maison) ; dans le doute, vrai. */
export function isWornPiece(title: string | null | undefined): boolean {
  const name = wordsOf(title ?? "");
  if (mentions(name, ALWAYS_NOT_WORN)) return false;
  return !mentions(name, NOT_WORN) || namesGarment(name);
}
