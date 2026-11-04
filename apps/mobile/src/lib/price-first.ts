// Prix d'abord (décision du fondateur du 2026-11-03) : sur l'écran Résultat,
// les propositions AVEC prix d'abord ; celles de la recherche visuelle SANS
// prix vont en dernier, dans une section repliée « Sans prix ». L'affichage
// seulement : le serveur garde les résultats Lens, leur ordre et leurs rangs,
// jamais remplacés (voie C). Les indices restent ceux de la liste complète de
// l'écran (allPieces) : la grande carte et ses actions ne changent pas.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { Piece, SpotResult } from "../api/types";
import { allPieces, otherPiecesBySection, type IndexedPiece } from "./result-sections";

type ResultLists = Pick<SpotResult, "pieces" | "complement">;

/** Une proposition a-t-elle un prix ? Même règle que les cartes (sinon « Prix à vérifier chez le marchand »). */
export function hasPrice(piece: Pick<Piece, "priceFrom">): boolean {
  return piece.priceFrom !== null;
}

/** Aucune proposition n'a de prix, nulle part (recherche visuelle et
 * complément) : rien n'est replié, l'écran reste comme avant. */
export function noPriceAnywhere(result: ResultLists): boolean {
  return !allPieces(result).some(hasPrice);
}

/** La grande carte proposée d'office (« Meilleure proposition ») : la mieux
 * classée des propositions de la recherche visuelle avec prix ; sinon la
 * première du complément affiché (« boutiques », puis « vos mots »), si elle
 * a un prix ; sinon la première proposition, comme avant. */
export function bestProposalIndex(result: ResultLists): number {
  const lensWithPrice = result.pieces.findIndex(hasPrice);
  if (lensWithPrice !== -1) return lensWithPrice;
  const firstComplement = allPieces(result)[result.pieces.length];
  return firstComplement && hasPrice(firstComplement) ? result.pieces.length : 0;
}

export interface PriceFirstSections {
  /** « Autres propositions » : la recherche visuelle avec prix, dans son
   * ordre (toute la recherche visuelle quand rien n'a de prix). */
  others: IndexedPiece[];
  /** Sections du complément, inchangées, après « Autres propositions ». */
  shopping: IndexedPiece[];
  words: IndexedPiece[];
  /** Section repliée « Sans prix », en dernier : la recherche visuelle sans
   * prix, dans son ordre. Vide quand rien n'a de prix nulle part. */
  withoutPrice: IndexedPiece[];
}

/** Les sections de l'écran, sans la proposition montrée en grand (celle-ci
 * quitte sa section, comme avant ; elle y revient quand une autre la remplace). */
export function priceFirstSections(result: ResultLists, selectedIndex: number): PriceFirstSections {
  const { lens, shopping, words } = otherPiecesBySection(result, selectedIndex);
  if (noPriceAnywhere(result)) return { others: lens, shopping, words, withoutPrice: [] };
  return {
    others: lens.filter(({ piece }) => hasPrice(piece)),
    shopping,
    words,
    withoutPrice: lens.filter(({ piece }) => !hasPrice(piece)),
  };
}

/** Place d'une proposition, envoyée avec le clic vers la boutique
 * (statistiques d'usage, « merchant_link_opened ») : des nombres et un
 * oui/non, jamais la pièce ni le lien. Noms des propriétés envoyées. */
export interface ClickPlacement {
  /** Rang d'origine : sa place dans l'ordre du serveur, inchangé (1 = la
   * première de la recherche visuelle ; le complément vient ensuite). */
  rank: number;
  /** Place affichée dans l'ordre « prix d'abord » (1 = la grande carte
   * proposée d'office). Elle ne change pas quand la personne met une autre
   * proposition en grand : c'est l'endroit où elle l'a trouvée. */
  displayed_position: number;
  /** Rangée dans la section repliée « Sans prix ». */
  in_no_price_section: boolean;
}

/** La place de chaque proposition de l'écran, par indice dans allPieces. */
export function clickPlacements(result: ResultLists): Map<number, ClickPlacement> {
  if (allPieces(result).length === 0) return new Map();
  const best = bestProposalIndex(result);
  const { others, shopping, words, withoutPrice } = priceFirstSections(result, best);
  const order = [best, ...[...others, ...shopping, ...words, ...withoutPrice].map(({ index }) => index)];
  const folded = new Set(withoutPrice.map(({ index }) => index));
  return new Map(order.map((index, position) => [index, { rank: index + 1, displayed_position: position + 1, in_no_price_section: folded.has(index) }]));
}
