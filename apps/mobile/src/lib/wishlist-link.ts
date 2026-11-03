// « Voir mes Envies » après « Garder » (lot « premier essai ») : le Profil
// s'ouvre directement sur l'onglet Envies. Sans ce paramètre, il s'ouvre
// toujours sur le Vault. Imports relatifs : fichier testé par vitest.
import type { useRouter } from "expo-router";
import { clearDraft } from "./spot-draft";

type Router = ReturnType<typeof useRouter>;

export type ProfileSegment = "vault" | "lifestyle" | "wishlist";

/** Valeur du paramètre `segment` de l'écran Profil qui ouvre les Envies. */
export const WISHLIST_SEGMENT = "wishlist";

/** Onglet demandé dans l'adresse du Profil ; null : l'onglet habituel (Vault). */
export function requestedProfileSegment(param: string | string[] | undefined): ProfileSegment | null {
  return param === WISHLIST_SEGMENT ? "wishlist" : null;
}

/** Depuis un résultat du Spotter : comme « Fermer » (les étapes du Spotter
 * quittent l'historique), mais vers le Profil, onglet Envies. */
export function openWishlistFromSpotter(router: Router): void {
  clearDraft();
  router.dismissTo({ pathname: "/profile", params: { segment: WISHLIST_SEGMENT } });
}
