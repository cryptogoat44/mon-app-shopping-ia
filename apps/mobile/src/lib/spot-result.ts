import { SEARCH_FAILURE_MESSAGES, TEXT_SEARCH_ERRORS, type ProductMatch, type ProductSearch } from "@monapp/shared-types";
import type { Piece, SpotComplement, SpotResult } from "@/api/types";
import { ApiError } from "./api-error";
import { capacityFailure, type CapacityFailReason } from "./spot-capacity";

export function matchToPiece(match: ProductMatch): Piece {
  return {
    id: match.id,
    name: match.productName,
    reference: match.brand,
    material: null,
    imageUrl: match.imageUrl,
    imageHdUrl: match.imageHdUrl ?? null,
    priceFrom: match.priceMin,
    currency: match.currency,
    merchantName: match.merchantName,
    merchantUrl: match.merchantUrl,
    affiliateUrl: match.affiliateUrl,
    real: true,
    feedbackReason: match.feedbackReason ?? null,
    // Voie C (lot c) : absente = « lens » ; un ancien serveur ne l'envoie jamais.
    ...(match.origin ? { origin: match.origin } : {}),
  };
}

/** Des propositions, mais aucune avec un prix : le message honnête s'affiche
 * au-dessus d'elles (petit lot ; décision du fondateur du 2026-10-21). */
export function noPriceShown(pieces: readonly Pick<Piece, "priceFrom">[]): boolean {
  return pieces.length > 0 && pieces.every((piece) => piece.priceFrom === null);
}

/** Complément de la voie C (lot c) : les propositions « shopping » et
 * « words », sous celles de la recherche visuelle. Absent quand la voie C n'a
 * pas tourné sur cette recherche (interrupteur coupé, recherche plus ancienne).
 * L'invitation « Que cherchez-vous ? » et l'issue de la recherche par les mots
 * viennent du serveur, qui les garde (rechargement, historique) ; la requête
 * n'existe que dans la réponse du lancement. */
function complementOf(search: ProductSearch, pieces: readonly Piece[]): SpotComplement | undefined {
  const shopping = pieces.filter((piece) => piece.origin === "shopping");
  const words = pieces.filter((piece) => piece.origin === "words");
  const complement = search.complement;
  if (!complement && shopping.length === 0 && words.length === 0) return undefined;
  return {
    shopping,
    words,
    status: complement?.status ?? null,
    query: complement?.query?.trim() || null,
    suggestText: complement?.suggestText === true,
    textStatus: complement?.textStatus ?? null,
  };
}

/** Traduit une recherche renvoyée par le serveur en résultat affichable.
 * Voie C : `pieces` ne garde que la recherche visuelle (origine absente ou
 * « lens »), dans son ordre ; le reste va dans `complement`. Une seule
 * proposition, de n'importe quelle origine, suffit pour un succès. */
export function toSpotResult(search: ProductSearch): SpotResult {
  const all = search.matches.map(matchToPiece);
  const complement = complementOf(search, all);
  const withComplement = complement ? { complement } : {};
  if (all.length === 0) {
    const failReason =
      search.status === "pending"
        ? "needs_photo"
        : search.errorMessage === SEARCH_FAILURE_MESSAGES.technical
          ? "technical"
          : "no_match";
    return { searchId: search.id, query: search.query, sourceUrl: search.sourceUrl, status: "failed", pieces: [], similarPieces: [], failReason, ...withComplement };
  }
  return {
    searchId: search.id,
    query: search.query,
    sourceUrl: search.sourceUrl,
    status: "success",
    pieces: all.filter((piece) => piece.origin === undefined || piece.origin === "lens"),
    similarPieces: [],
    sortedByWords: search.sortedByWords === true,
    ...withComplement,
  };
}

/** Après la recherche par les mots (voie B), le résultat est remplacé sur
 * place par la recherche renvoyée. Les propositions de la recherche visuelle
 * n'ont pas changé : le tri par les mots du lancement et la requête de la
 * section « shopping » (réponse du lancement seulement) restent affichés. */
export function withTextSearch(previous: SpotResult, search: ProductSearch): SpotResult {
  const next = toSpotResult(search);
  if (next.status === "success" && previous.sortedByWords) next.sortedByWords = true;
  if (next.complement) next.complement = { ...next.complement, query: previous.complement?.query ?? null };
  return next;
}

/** Échec de la recherche par les mots, tel que l'invitation le montre :
 * - already_used : déjà lancée pour cette recherche (409) — l'invitation
 *   laisse place à une phrase ;
 * - hidden : fonction coupée ou recherche introuvable (404), recherche non
 *   admissible ou budget de la photo épuisé (409) — l'invitation disparaît ;
 * - limit : plafond des recherches ou trop de recherches d'un coup (429),
 *   avec les textes de l'écran Résultat — l'invitation reste ;
 * - technical : réseau ou serveur — l'invitation reste, pour réessayer. */
export type TextSearchFailure =
  | { kind: "already_used" }
  | { kind: "hidden" }
  | { kind: "limit"; reason: CapacityFailReason | "rate_limited"; resumesOn: string | null }
  | { kind: "technical" };

export function textSearchFailure(error: unknown): TextSearchFailure {
  if (!(error instanceof ApiError)) return { kind: "technical" };
  if (error.body.error === TEXT_SEARCH_ERRORS.alreadyUsed) return { kind: "already_used" };
  if (error.status === 409 || error.status === 404) return { kind: "hidden" };
  if (error.status === 429) {
    // Comme au lancement : le plafond des recherches passe avant « trop de recherches d'un coup ».
    const capacity = capacityFailure(error.body);
    return capacity ? { kind: "limit", reason: capacity.reason, resumesOn: capacity.resumesOn } : { kind: "limit", reason: "rate_limited", resumesOn: null };
  }
  return { kind: "technical" };
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
