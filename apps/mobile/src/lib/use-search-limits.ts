// Lot limites annoncées (2026-11-03) : le compteur des recherches partagé par
// l'accueil du Spotter et l'écran de cadrage. Relu à chaque visite si la
// dernière lecture a plus de 20 s, après chaque recherche lancée, et une fois
// minuit (ou le renouvellement) passé ; jamais en boucle. Lecture échouée :
// rien n'est annoncé, rien n'est bloqué. La logique est dans search-limits.ts (testée).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";
import { getActiveLocale } from "../i18n";
import { fetchSearchCapacity } from "./api";
import { useAuth } from "./auth-context";
import { capacityCopy, createLimitsStore, limitsNotice, nextBoundary, onSearchLaunched } from "./search-limits";
import type { CapacityFailReason } from "./spot-capacity";

const store = createLimitsStore(fetchSearchCapacity);
onSearchLaunched(store.markStale);

// Un minuteur long peut être suspendu (app en arrière-plan) : jamais plus d'une heure, puis il se recale.
const MAX_TIMER_MS = 3_600_000;

export function useSearchLimits() {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const read = useCallback(() => store.current(owner), [owner]);
  const status = useSyncExternalStore(store.subscribe, read, read);
  const [now, setNow] = useState(() => Date.now());

  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      void store.refresh(owner);
    }, [owner])
  );

  // À minuit (ou au renouvellement), l'annonce tombe d'elle-même : « Lancer »
  // n'attend pas une nouvelle visite. La relecture viendra à la prochaine visite.
  useEffect(() => {
    const boundary = nextBoundary(status, now);
    if (boundary === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(boundary - now + 1_000, MAX_TIMER_MS));
    return () => clearTimeout(timer);
  }, [status, now]);

  return { notice: limitsNotice(status, now), refresh: () => store.refresh(owner, true) };
}

/** Messages de limite (écran Résultat, « Que cherchez-vous ? »), avec le
 * dernier compteur lu : celui de ce compte, lu à l'accueil ou au cadrage. */
export function capacityMessages(reason: CapacityFailReason, resumesOn?: string | null): [string, string] {
  return capacityCopy(reason, resumesOn, store.latest(), Date.now(), getActiveLocale());
}
