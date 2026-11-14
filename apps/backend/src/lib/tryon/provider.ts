// Fournisseur d'essayage virtuel, interchangeable (lot « essayage
// virtuel ») : un fichier par fournisseur dans providers/, choisi par
// TRYON_PROVIDER (providers/index.ts). Le serveur lui confie la photo du
// membre (déjà ré-encodée en JPEG, sans métadonnées) et l'image de la pièce
// (son adresse publique, ou ses octets si le fournisseur n'a pas pu la
// charger) ; il reçoit l'image produite, en mémoire. Rien n'est jamais
// enregistré, ni chez nous, ni par le fournisseur au-delà de ce qu'il
// annonce (FASHN : copie de traitement effacée à la fin, résultat en base64
// disponible 60 minutes au plus).
import type { Locale } from "../locale.js";
import type { TryonProviderName } from "./config.js";

/** Image de la pièce : son adresse publique (https), ou ses octets en JPEG. */
export type TryonGarmentImage = { kind: "url"; url: string } | { kind: "data"; jpeg: Buffer };

export interface TryonRunInput {
  /** Photo du membre : JPEG ré-encodé, sans métadonnées, 1 296 px au plus. */
  personImage: Buffer;
  garmentImage: TryonGarmentImage;
  /** Langue de l'app sur l'appareil (texte éventuel du fournisseur). */
  locale: Locale;
  /** Temps qui reste à l'essai, en millisecondes : le délai commun fixé par
   * la route dès la réservation (routes/tryon.ts), jamais un délai neuf. Le
   * fournisseur ne dépasse jamais le sien (FASHN : 90 s) ; sans cette
   * valeur, il prend le sien. Plus rien : rien n'est soumis (« timeout »). */
  timeLeftMs?: number;
}

export interface TryonRunOutput {
  /** Image produite (JPEG ou PNG), en mémoire seulement. */
  image: Buffer;
  /** Crédits consommés chez le fournisseur (le faux en annonce 1 : le budget
   * se teste en développement comme en vrai). */
  creditsUsed: number;
}

export interface TryOnProvider {
  readonly name: TryonProviderName;
  /** Un essai ; TryonProviderError en cas d'échec. */
  run(input: TryonRunInput): Promise<TryonRunOutput>;
  /** Crédits restants chez le fournisseur ; TryonProviderError si illisibles. */
  getCreditBalance(): Promise<number>;
}

/** Les échecs d'un fournisseur, sans aucun contenu :
 * - pose_not_detected : silhouette introuvable sur la photo (PoseError) ;
 * - moderation_blocked : pièce ou photo refusée par la modération ;
 * - image_load : une image n'a pas pu être chargée (adresse de la pièce) ;
 * - invalid_input : images refusées par le fournisseur ;
 * - bad_request, unauthorized, not_found : requête refusée (réglage ou
 *   clé à revoir, jamais la faute du membre) ;
 * - rate_limited : trop de demandes ou d'essais simultanés chez lui ;
 * - out_of_credits : plus de crédits ;
 * - unavailable : panne ou surcharge du fournisseur, réseau ;
 * - timeout : pas de résultat dans le temps laissé à l'essai (90 s au plus) ;
 * - invalid_response : réponse inattendue. */
export const TRYON_PROVIDER_ERROR_KINDS = [
  "pose_not_detected",
  "moderation_blocked",
  "image_load",
  "invalid_input",
  "bad_request",
  "unauthorized",
  "not_found",
  "rate_limited",
  "out_of_credits",
  "unavailable",
  "timeout",
  "invalid_response",
] as const;
export type TryonProviderErrorKind = (typeof TRYON_PROVIDER_ERROR_KINDS)[number];

/** Échec d'un fournisseur. Son message est fixe (« tryon_<sorte> ») : il peut
 * partir à Sentry ou au journal sans jamais rien dire du membre, de ses
 * images ni de la réponse du fournisseur. */
export class TryonProviderError extends Error {
  readonly kind: TryonProviderErrorKind;
  /** Code HTTP de la réponse du fournisseur, s'il y en a eu une. */
  readonly status: number | undefined;
  /** Crédits que le fournisseur a pu facturer malgré l'échec : 0 quand rien
   * n'a pu l'être (essai refusé avant d'être accepté, ou échec que le
   * fournisseur annonce lui-même) ; sinon ceux qu'il annonce, ou 1 par essai
   * présumé (essai accepté, puis délai dépassé, résultat illisible…). Ils
   * comptent dans la dépense du mois, jamais dans le quota du membre. */
  readonly creditsBilled: number;

  constructor(kind: TryonProviderErrorKind, status?: number, creditsBilled = 0) {
    super(`tryon_${kind}`);
    this.name = "TryonProviderError";
    this.kind = kind;
    this.status = status;
    this.creditsBilled = creditsBilled;
  }
}
