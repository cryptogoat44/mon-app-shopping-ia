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

const PIECE_TITLE_MAX = 120;

/** Titre envoyé au serveur pour « Garder » (Envies) et « Je l'ai achetée »
 * (Vault) : 120 caractères au plus, sa limite (une envie envoyée garde ce
 * titre) ; ceux de Google Shopping vont jusqu'à 150. Jamais coupé au milieu
 * d'un emoji (une moitié seule n'est pas un texte valide). */
export function pieceTitle(name: string): string {
  const cut = name.slice(0, PIECE_TITLE_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
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

/** L'invitation n'est plus proposée (refus du serveur) : même résultat, sans
 * « Que cherchez-vous ? » — à l'écran comme au retour sur l'écran. */
export function withoutTextPrompt(result: SpotResult): SpotResult {
  return result.complement ? { ...result, complement: { ...result.complement, suggestText: false } } : result;
}

/** Échec de la recherche par les mots, tel que l'invitation le montre :
 * - already_used : déjà lancée pour cette recherche (409) — relue d'abord
 *   (recoverTextSearch) ; sans l'issue des mots, l'invitation laisse place à
 *   une phrase ;
 * - hidden : fonction coupée ou recherche introuvable (404), recherche non
 *   admissible ou budget de la photo épuisé (409) — l'invitation disparaît ;
 * - limit : plafond des recherches ou trop de recherches d'un coup (429),
 *   avec les textes de l'écran Résultat — l'invitation reste ;
 * - invalid_words : rien ne reste des mots une fois retirés les opérateurs
 *   et la ponctuation (400, avant toute recherche) — l'invitation reste ;
 * - technical : réseau ou serveur — relue d'abord, puis l'invitation reste,
 *   pour réessayer. */
export type TextSearchFailure =
  | { kind: "already_used" }
  | { kind: "hidden" }
  | { kind: "limit"; reason: CapacityFailReason | "rate_limited"; resumesOn: string | null }
  | { kind: "invalid_words" }
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
  // Seul refus des mots eux-mêmes sur cette route (un identifiant invalide dit « invalid_params »).
  if (error.status === 400 && error.body.error === "invalid_body") return { kind: "invalid_words" };
  return { kind: "technical" };
}

/** La recherche relue porte-t-elle déjà l'issue de la recherche par les mots
 * (propositions « words », ou issue enregistrée) ? */
export function textSearchSettled(search: ProductSearch): boolean {
  return search.complement?.textStatus != null || search.matches.some((match) => match.origin === "words");
}

/** Ce que l'invitation fait d'un échec de la recherche par les mots :
 * - done : le serveur l'avait faite quand même — la recherche relue remplace
 *   le résultat sur place ;
 * - closed : l'invitation n'est plus proposée (« déjà lancée » quand
 *   `alreadyUsed`) ;
 * - idle : l'invitation reste, avec l'échec à montrer. */
export type TextSearchRecovery =
  | { kind: "done"; search: ProductSearch }
  | { kind: "closed"; alreadyUsed: boolean }
  | { kind: "idle"; failure: TextSearchFailure };

/** Le serveur pose le verrou « une seule fois » avant d'appeler Google
 * Shopping et va au bout même si l'app n'attend plus : après un 409 « déjà
 * lancée », une réponse perdue, une panne du serveur ou « Annuler », les
 * propositions des mots peuvent être déjà enregistrées. La recherche est
 * relue (`read`, aucun appel payant) avant de dire « déjà lancée » ou de
 * proposer un nouvel essai ; relecture impossible : rien de plus n'est dit. */
export async function recoverTextSearch(failure: TextSearchFailure, read: () => Promise<ProductSearch>): Promise<TextSearchRecovery> {
  if (failure.kind === "hidden") return { kind: "closed", alreadyUsed: false };
  if (failure.kind === "already_used" || failure.kind === "technical") {
    const search = await settledTextSearch(read);
    if (search) return { kind: "done", search };
    if (failure.kind === "already_used") return { kind: "closed", alreadyUsed: true };
  }
  return { kind: "idle", failure };
}

/** La recherche relue, si l'issue des mots y est déjà ; null sinon, ou si la relecture échoue. */
export async function settledTextSearch(read: () => Promise<ProductSearch>): Promise<ProductSearch | null> {
  try {
    const search = await read();
    return textSearchSettled(search) ? search : null;
  } catch {
    return null;
  }
}

export type InitialResultState =
  | { kind: "ready"; result: SpotResult }
  | { kind: "loading"; searchId: string }
  | { kind: "missing" };

/** Où l'écran Résultat trouve-t-il son résultat ? (audit Lot Q, ETA-04)
 * - en mémoire, s'il vient juste d'être calculé par l'écran Analyse et
 *   correspond bien à la recherche demandée ;
 * - sinon, relu sur le serveur à partir de l'identifiant de la recherche
 *   (page rechargée sur le web, lien rouvert, recherche rouverte depuis
 *   « Récemment spottées », qui oublie d'abord la copie en mémoire...) ;
 * - sans identifiant ni mémoire, le résultat n'existe plus : on le dit
 *   plutôt que d'afficher un faux « pièce non identifiée ». */
export function chooseInitialResult(memory: SpotResult | null, searchId: string | undefined): InitialResultState {
  if (memory && (!searchId || memory.searchId === searchId)) return { kind: "ready", result: memory };
  if (searchId) return { kind: "loading", searchId };
  return { kind: "missing" };
}
