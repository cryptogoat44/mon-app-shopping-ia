// Interface unique du fournisseur de recherche (0027, décision du fondateur du
// 25 octobre 2026) : les filtres, la règle des prix, la mesure, la route et les
// plafonds ne dépendent plus du fournisseur. Un seul adaptateur pour l'instant :
// SerpApi (services/serpapi.ts).
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
  searchByImage(imageUrl: string, locale: SearchLocale): Promise<ImageSearchResponse>;
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
