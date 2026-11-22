// Nouveautés des Envies (lot « alertes visibles ») branchées sur le Profil :
// lues à chaque retour sur le Profil, avec ce que ce compte a déjà vu sur cet
// appareil (lib/wish-alert-news.ts). Le Profil en tire la pastille de
// l'onglet Envies ; la grille des Envies, le bandeau (et le marque « vu »).
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WishAlertNews } from "@monapp/shared-types";
import { fetchWishAlertNews } from "./api";
import { useAuth } from "./auth-context";
import { loadSeenNews, markNewsSeen, unseenItems } from "./wish-alert-news";

export interface WishAlertNewsState {
  /** Les nouveautés du serveur (vides tant que rien n'est lu). */
  items: WishAlertNews[];
  /** Celles déjà vues par ce compte sur cet appareil. */
  seen: ReadonlySet<string>;
  /** Il reste du non-vu (la pastille de l'onglet Envies). */
  hasUnseen: boolean;
  refresh(): void;
  /** Note ces nouveautés vues (sur l'appareil seulement). */
  markSeen(ids: readonly string[]): void;
}

export function useWishAlertNews(): WishAlertNewsState {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [items, setItems] = useState<WishAlertNews[]>([]);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  // Numéro de la lecture en cours : une plus récente (ou un autre compte) l'abandonne.
  const run = useRef(0);

  // Autre compte, ou déconnexion : rien du compte précédent ne reste.
  useEffect(() => {
    run.current += 1;
    setItems([]);
    setSeen(new Set());
  }, [userId]);

  const refresh = useCallback(() => {
    if (!userId) return;
    const current = ++run.current;
    // La liste et les marques arrivent ensemble : jamais de pastille d'un instant.
    Promise.all([fetchWishAlertNews(), loadSeenNews(AsyncStorage, userId)])
      .then(([news, marks]) => {
        if (current !== run.current) return;
        setItems(news);
        // Ajoutées à celles déjà connues : une marque posée pendant la lecture reste.
        setSeen((known) => new Set([...known, ...marks]));
      })
      .catch(() => {
        // Hors ligne : ce qui est affiché reste.
      });
  }, [userId]);

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      if (!userId || ids.length === 0) return;
      setSeen((current) => new Set([...current, ...ids]));
      void markNewsSeen(AsyncStorage, userId, ids);
    },
    [userId]
  );

  return { items, seen, hasUnseen: unseenItems(items, seen).length > 0, refresh, markSeen };
}
