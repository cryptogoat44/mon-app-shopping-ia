// Sections de l'écran Résultat (voie C, lot c). Les propositions de la
// recherche visuelle restent en premier, telles qu'aujourd'hui ; le
// complément vient dessous, en deux sections à part : « Cette pièce dans
// d'autres boutiques » (origine « shopping »), puis « Résultats pour vos
// mots » (origine « words »). Une seule liste d'indices pour toutes : la
// proposition montrée en grand et ses actions ne changent pas.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { MerchantLinkContext } from "@monapp/shared-types";
import type { Piece, SpotResult } from "../api/types";

/** Propositions d'une section du complément montrées d'emblée, avant son propre « Voir plus ». */
export const COMPLEMENT_SHOWN_FIRST = 6;

/** Une proposition et sa place dans la liste complète de l'écran (allPieces). */
export interface IndexedPiece {
  piece: Piece;
  index: number;
}

/** Toutes les propositions de l'écran, dans l'ordre : recherche visuelle,
 * puis « shopping », puis « words ». L'indice de la proposition montrée en
 * grand désigne cette liste ; la recherche par les mots ajoute à la fin, donc
 * ne décale jamais une proposition déjà affichée. */
export function allPieces(result: Pick<SpotResult, "pieces" | "complement">): Piece[] {
  return [...result.pieces, ...(result.complement?.shopping ?? []), ...(result.complement?.words ?? [])];
}

/** Les autres propositions de chaque section, sans celle montrée en grand. */
export function otherPiecesBySection(
  result: Pick<SpotResult, "pieces" | "complement">,
  selectedIndex: number
): { lens: IndexedPiece[]; shopping: IndexedPiece[]; words: IndexedPiece[] } {
  const shopping = result.complement?.shopping ?? [];
  const words = result.complement?.words ?? [];
  const indexed = (list: readonly Piece[], offset: number) =>
    list.map((piece, position) => ({ piece, index: offset + position })).filter(({ index }) => index !== selectedIndex);
  return {
    lens: indexed(result.pieces, 0),
    shopping: indexed(shopping, result.pieces.length),
    words: indexed(words, result.pieces.length + shopping.length),
  };
}

/** Les premières propositions d'une section, et combien restent derrière « Voir plus ». */
export function firstShown<T>(others: readonly T[], showAll: boolean, first: number): { visible: T[]; hiddenCount: number } {
  const visible = showAll ? [...others] : others.slice(0, first);
  return { visible, hiddenCount: others.length - visible.length };
}

/** Contexte du clic marchand : « similar » pour une proposition du
 * complément (déjà admis par le serveur, aucune migration), « result » pour
 * la recherche visuelle, comme aujourd'hui. */
export function merchantContextFor(piece: Pick<Piece, "origin">): MerchantLinkContext {
  return piece.origin === "shopping" || piece.origin === "words" ? "similar" : "result";
}

/** Proposition du complément sans lien direct vers le marchand : le lien
 * ouvre la page produit de Google, et le bouton dit « Voir l'offre » plutôt
 * que « Voir chez … ». Jamais pour la recherche visuelle, qui ne change pas. */
export function opensOfferPage(piece: Pick<Piece, "origin" | "merchantUrl">): boolean {
  if (piece.origin !== "shopping" && piece.origin !== "words") return false;
  if (!piece.merchantUrl) return false;
  try {
    return /(^|\.)google(\.[a-z]{2,3}){1,2}$/i.test(new URL(piece.merchantUrl).hostname);
  } catch {
    return false;
  }
}
