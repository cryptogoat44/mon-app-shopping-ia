// Comparer sans remonter (lot résultats lisibles) : la position de la page et
// la place de la grande image sont suivies sans nouveau rendu ; choisir une
// proposition ne fait remonter la page que si la grande image n'est plus
// assez visible (lib/result-scroll.ts). La logique sans écran est testée.
import { useEffect, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, Platform, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import { t } from "../i18n";
import { shouldRevealHero, type Area, type Viewport } from "./result-scroll";

/** « Réduire les animations » (iPhone, ou réglage du navigateur) : la page
 * saute d'un coup au lieu de défiler. Lu une fois, comme l'écran d'attente. */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
  return reduceMotion;
}

export function useHeroReveal(scrollRef: RefObject<ScrollView | null>) {
  const viewport = useRef<Viewport>({ scrollY: 0, height: 0 });
  const hero = useRef<Area>({ top: 0, height: 0 });
  const reduceMotion = useReduceMotion();

  return {
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      viewport.current.scrollY = event.nativeEvent.contentOffset.y;
    },
    onViewportLayout: (event: LayoutChangeEvent) => {
      viewport.current.height = event.nativeEvent.layout.height;
    },
    onHeroLayout: (event: LayoutChangeEvent) => {
      hero.current = { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height };
    },
    /** Après le choix d'une proposition : la page remonte en haut (« Votre
     * pièce » et la grande image ensemble) seulement si besoin. VoiceOver ne
     * suit pas ce changement (la carte touchée quitte la grille) : il est
     * dit, en file d'attente pour ne rien couper. */
    revealHero: (name: string | null) => {
      if (shouldRevealHero(viewport.current, hero.current)) scrollRef.current?.scrollTo({ y: 0, animated: !reduceMotion });
      if (name && Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(t.result.shownAbove(name), { queue: true });
    },
    /** Amener une section en haut de l'écran (prix d'abord : « Résultats pour
     * vos mots », section « Sans prix »), d'un coup avec « Réduire les animations ». */
    scrollToSection: (y: number) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y), animated: !reduceMotion });
    },
  };
}
