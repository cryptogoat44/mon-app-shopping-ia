import { useEffect } from "react";
import { ensureStatuses } from "./api";
import { useAuth } from "./auth-context";

/** Disponibilités (messagerie, collections, alertes prix et stock) : demandées
 * au serveur une fois par compte, quel que soit l'écran connecté ouvert en
 * premier. Sans cela, un écran ouvert directement par son adresse ou rechargé
 * dans le navigateur (profil d'un membre, collection d'un ami, envie,
 * Réglages…) n'a pas de barre d'onglets pour les lire : « Message » et
 * « Collections » restaient cachés. Rien n'est redemandé si la réponse est
 * connue ou en route (la barre d'onglets garde ses relectures), rien sans
 * compte connecté (lib/status-loading.ts). */
export function useStatusesLoaded(): void {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  useEffect(() => {
    void ensureStatuses(userId);
  }, [userId]);
}
