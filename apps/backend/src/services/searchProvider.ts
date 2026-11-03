// Interface unique du fournisseur de recherche (0027, décision du fondateur du
// 25 octobre 2026) : les filtres, la règle des prix, la mesure, la route et les
// plafonds ne dépendent plus du fournisseur. Un seul adaptateur pour l'instant :
// SerpApi (services/serpapi.ts). Depuis la voie C (lot c, 2026-11-02) : un
// signal d'arrêt facultatif pour la recherche par image, et la recherche par
// texte (Google Shopping), derrière la même idée.
import type { LensSection } from "./lensMeasure.js";
import type { SearchLocale } from "./lensSettings.js";

/** Une correspondance visuelle, telle que l'adaptateur la rend (chaque champ
 * peut manquer : les filtres écartent les propositions incomplètes). */
export interface ProviderVisualMatch {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  image?: string;
  price?: { value?: string; extracted_value?: number; currency?: string };
}

/** Réponse d'une recherche par image. */
export interface ImageSearchResponse {
  matches: ProviderVisualMatch[];
  /** Propositions renvoyées, lisibles ou non. */
  received: number;
  sections: LensSection[];
  googleState: "empty" | "other" | null;
  /** Code de réponse du fournisseur (rangé avec la recherche). */
  statusCode: number;
}

export interface SearchProvider {
  /** Nom rangé avec chaque recherche (colonne provider) et dans les journaux. */
  readonly name: string;
  /** `signal` : arrêt de l'appel (plafond fixe de 12 s de la voie C) ; sans
   * lui, le délai d'avant (15 s). Jamais l'« Annuler » de la personne : un
   * arrêt serait compté comme un délai dépassé par le fournisseur. */
  searchByImage(imageUrl: string, locale: SearchLocale, signal?: AbortSignal): Promise<ImageSearchResponse>;
}

/** Une proposition de Google Shopping, telle que l'adaptateur la rend (champs
 * de SerpApi ; chacun peut manquer : les filtres écartent les propositions
 * incomplètes). Le prix est un TEXTE (« 49,99 € »), avec sa valeur lue à part,
 * sans devise : services/textSearch.ts la déduit du texte. */
export interface ProviderShoppingItem {
  position?: number;
  title?: string;
  /** Lien direct vers le marchand, quand Google le donne. */
  link?: string;
  /** Page produit de Google (google.*), sinon. */
  product_link?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  thumbnail?: string;
}

/** Réponse d'une recherche par texte. */
export interface TextSearchResponse {
  items: ProviderShoppingItem[];
  /** Propositions renvoyées, lisibles ou non. */
  received: number;
  /** Code de réponse du fournisseur. */
  statusCode: number;
}

/** Recherche par texte (Google Shopping) : la requête de l'IA (voie C) ou vos
 * mots (voie B). Jamais de mots dans les journaux ni dans les erreurs. */
export interface TextSearchProvider {
  readonly name: string;
  searchByText(query: string, locale: SearchLocale, signal: AbortSignal): Promise<TextSearchResponse>;
}

/** Cause d'une panne du fournisseur (conception du 20 octobre : ne compter que
 * ce que le fournisseur facture, et, dans le doute, compter) :
 * - refused : refus annoncé par le fournisseur, non facturé : la place est rendue ;
 * - timeout : délai dépassé (incertain : comptée) ;
 * - error : réseau coupé, statut absent ou autre erreur (incertain : comptée) ;
 * - unreadable : réponse illisible (comptée). */
export type ProviderFailureKind = "refused" | "timeout" | "error" | "unreadable";

/** La seule erreur que lève un adaptateur. `statusCode` : code de réponse du
 * fournisseur, null sans réponse (délai dépassé, réseau coupé). */
export class ProviderFailure extends Error {
  constructor(
    readonly kind: ProviderFailureKind,
    readonly statusCode: number | null,
    message: string
  ) {
    super(message);
    this.name = "ProviderFailure";
  }
}
