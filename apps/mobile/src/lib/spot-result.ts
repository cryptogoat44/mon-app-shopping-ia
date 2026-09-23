import type { ProductMatch, ProductSearch } from "@monapp/shared-types";
import type { Piece, SpotResult } from "@/api/types";

export function matchToPiece(match: ProductMatch): Piece {
  return {
    id: match.id,
    name: match.productName,
    reference: match.brand,
    material: null,
    imageUrl: match.imageUrl,
    priceFrom: match.priceMin,
    currency: match.currency,
    merchantName: match.merchantName,
    merchantUrl: match.merchantUrl,
    affiliateUrl: match.affiliateUrl,
    real: true,
  };
}

/** Traduit une recherche renvoyée par le serveur en résultat affichable. */
export function toSpotResult(search: ProductSearch): SpotResult {
  if (search.matches.length === 0) {
    const needsPhoto = search.method === "manual_screenshot" && search.status === "pending";
    return {
      searchId: search.id,
      status: "failed",
      pieces: [],
      similarPieces: [],
      failReason: needsPhoto ? "needs_photo" : "no_match",
    };
  }
  return { searchId: search.id, status: "success", pieces: search.matches.map(matchToPiece), similarPieces: [] };
}

export type InitialResultState =
  | { kind: "ready"; result: SpotResult }
  | { kind: "loading"; searchId: string }
  | { kind: "missing" };

/** Où l'écran Résultat trouve-t-il son résultat ? (audit Lot Q, ETA-04)
 * - en mémoire, s'il vient juste d'être calculé par l'écran Analyse et
 *   correspond bien à la recherche demandée ;
 * - sinon, relu sur le serveur à partir de l'identifiant de la recherche
 *   (page rechargée sur le web, lien rouvert...) ;
 * - sans identifiant ni mémoire, le résultat n'existe plus : on le dit
 *   plutôt que d'afficher un faux « pièce non identifiée ». */
export function chooseInitialResult(memory: SpotResult | null, searchId: string | undefined): InitialResultState {
  if (memory && (!searchId || memory.searchId === searchId)) return { kind: "ready", result: memory };
  if (searchId) return { kind: "loading", searchId };
  return { kind: "missing" };
}
