// Codes d'échec d'un essai, gardés dans tryon_events.error_code (migration
// 0042) : des codes courts d'une liste fermée, jamais un texte venu du
// fournisseur ni rien de personnel. Ils servent au rapport du fondateur
// (taux d'échec par code) et à l'export des données du membre.
import { TRYON_PROVIDER_ERROR_KINDS } from "./provider.js";

/** Échecs constatés par le serveur lui-même. */
export const TRYON_SERVER_FAILURE_CODES = [
  // Essai bloqué plus de 3 minutes (serveur arrêté en route), libéré par la base.
  "expired",
  // Solde de crédits FASHN sous le minimum réglé, ou illisible.
  "low_credits",
  "balance_unreadable",
  // Photo du membre illisible ou d'un format refusé.
  "photo_invalid",
  // Trop d'images à traiter en même temps sur le serveur.
  "server_busy",
  // Image de la pièce introuvable, même téléchargée par le serveur.
  "garment_unavailable",
  // Image rendue par le fournisseur illisible.
  "result_unreadable",
  // Erreur imprévue (détail à Sentry, sans contenu).
  "internal",
] as const;

export const TRYON_FAILURE_CODES = [...TRYON_PROVIDER_ERROR_KINDS, ...TRYON_SERVER_FAILURE_CODES] as const;
export type TryonFailureCode = (typeof TRYON_FAILURE_CODES)[number];
