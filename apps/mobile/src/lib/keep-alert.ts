// Parcours 3 : « Garder » allume l'alerte de baisse de prix de la pièce
// (décision A1 du fondateur, 21 novembre 2026). Jamais l'interrupteur
// « Alertes prix et stock » des Réglages, qui ne commande que l'envoi des
// alertes : ni `enableAlerts`, ni PUT /api/alerts/settings, ni appareil
// enregistré pour les notifications. La baisse se voit dans l'app (« Baisse
// de prix », lib/wish-alerts.ts, priceDropNow), interrupteur coupé compris.
//
// La décision est pure (tests/achat-et-alerte.test.ts) ; l'appel passe par
// la route qui existe déjà (PUT /api/wishlist/:id/alerts), sans seuil : le
// serveur le fixe (le dernier prix vu dans le pays et la devise de la
// personne, sinon le premier prix vu ensuite). Un refus de l'alerte (422,
// 404, 429, réseau) ne défait jamais « Garder » : rien n'est levé ici.
// Imports relatifs : fichier testé par vitest.
import { SEARCH_COUNTRIES, isCountryCurrency, type UpdateWishAlertRequest, type WishAlertState, type WishAlertsStatus } from "@monapp/shared-types";
import type { Piece } from "../api/types";
import { track } from "./analytics";
import { fetchWishAlertsStatus, updateWishAlert } from "./api";
import { wishAlertsStatus } from "./wish-alerts";

/** D'où vient l'alerte allumée : « Garder » (save), ou la question « Vous
 * l'avez achetée ? » (question : « Garder » ou « Activer l'alerte »). */
export type KeepAlertOrigin = "save" | "question";

/** L'alerte d'une pièce gardée pendant la visite de l'écran : allumée
 * (« Couper l'alerte » proposé), coupée par la personne (« Alerte coupée. »),
 * ou jamais allumée (pièce qui ne le permet pas, refus du serveur). */
export type KeptAlert = "on" | "off" | "none";

/** Une pièce gardée pendant la visite de l'écran Résultat : son Envie (null
 * pour une pièce de démonstration) et l'état de son alerte. */
export interface KeptWish {
  wishId: string | null;
  alert: KeptAlert;
}

/** Ce que dit le message sous la grande carte. Une pièce achetée pendant la
 * visite (« Je l'ai achetée », ou « Oui » à la question) n'a plus d'alerte :
 * le serveur la retire en l'ajoutant au Vault, et « Baisse de prix » ne
 * s'affiche jamais pour une pièce achetée. Le message ne promet donc plus de
 * baisse et ne propose plus « Couper l'alerte ». */
export function keptNoticeAlert(kept: KeptWish | undefined, bought: boolean): KeptAlert {
  return bought ? "none" : (kept?.alert ?? "none");
}

/** Ce que la décision lit de la pièce (proposition, ou Envie et sa cloche). */
export type KeepAlertPiece = Pick<Piece, "real" | "alertTrackable" | "priceFrom" | "currency">;

export interface KeepAlertContext {
  /** Pays de la recherche (lib/foreign-shop.ts, searchCountryFrom). */
  country: string;
  /** Déjà au Vault (« Ajoutée au Vault », ou cloche « achetée ») : aucune alerte ne partirait. */
  bought: boolean;
}

/** Les conditions de la fiche (partie 2), sauf la disponibilité des alertes :
 * vraie proposition, que le serveur dit suivable (`alertTrackable`), pas déjà
 * achetée, depuis un pays pris en charge par les alertes, et un prix dans la
 * devise de ce pays, ou pas de prix. Jamais pour une « Boutique à
 * l'étranger » (lib/foreign-shop.ts) : aucune baisse n'y serait vue. Un prix
 * dans une devise illisible ne compte pas non plus comme local. */
export function keepAlertPossible(piece: KeepAlertPiece, context: KeepAlertContext): boolean {
  if (piece.real !== true || piece.alertTrackable !== true || context.bought) return false;
  if (!(SEARCH_COUNTRIES as readonly string[]).includes(context.country)) return false;
  return piece.priceFrom === null || isCountryCurrency(piece.currency, context.country) === true;
}

/** Avec la disponibilité des alertes (seulement `available: true`). */
export function keepAlertAllowed(status: Pick<WishAlertsStatus, "available">, piece: KeepAlertPiece, context: KeepAlertContext): boolean {
  return status.available && keepAlertPossible(piece, context);
}

/** Le seul corps envoyé pour allumer : la baisse de prix, sans seuil (le
 * serveur le fixe) ni `enableAlerts` (l'interrupteur n'est jamais touché).
 * « Retour en stock » reste un choix de la cloche. */
export function keepAlertOnRequest(): UpdateWishAlertRequest {
  return { priceDrop: true, restock: false };
}

/** « Couper l'alerte » : tout coupé, la cloche est retirée. */
export function keepAlertOffRequest(): UpdateWishAlertRequest {
  return { priceDrop: false, restock: false };
}

/** Alertes disponibles ? L'état connu, relu sur le serveur s'il dit non
 * (première lecture pas encore revenue, site rechargé). Sans réponse : non. */
async function alertsAvailable(): Promise<boolean> {
  if (wishAlertsStatus().available) return true;
  try {
    return (await fetchWishAlertsStatus()).available;
  } catch {
    return false;
  }
}

/** Allume l'alerte de baisse de prix de l'Envie `wishId` si la pièce le
 * permet. Rend la cloche enregistrée, ou null : non permise, alertes
 * indisponibles, refus du serveur ou réseau. Ne lève jamais d'erreur. */
export async function turnOnKeepAlert(wishId: string, piece: KeepAlertPiece, context: KeepAlertContext, origin: KeepAlertOrigin): Promise<WishAlertState | null> {
  if (!keepAlertPossible(piece, context)) return null;
  if (!(await alertsAvailable())) return null;
  try {
    const state = await updateWishAlert(wishId, keepAlertOnRequest());
    if (state?.priceDrop !== true) return null;
    track("price_watch_changed", { origin });
    return state;
  } catch {
    return null;
  }
}

/** « Couper l'alerte » : retire la cloche de l'Envie `wishId`. true : coupée ;
 * false : échec (le message d'erreur s'affiche, la ligne reste). */
export async function turnOffKeepAlert(wishId: string): Promise<boolean> {
  try {
    await updateWishAlert(wishId, keepAlertOffRequest());
    track("price_watch_changed", { origin: "undo" });
    return true;
  } catch {
    return false;
  }
}
