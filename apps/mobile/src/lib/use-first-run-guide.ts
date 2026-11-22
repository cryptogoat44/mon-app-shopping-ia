// Guide de la première recherche (lib/first-run-guide.ts), branché sur
// l'appareil : « unknown » tant que l'historique n'est pas lu, puis « shown »
// (la marque est rangée à l'affichage) ou « hidden ». Décidé une seule fois
// par ouverture de Spotter.
import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { claimFirstRunGuide, skipFirstRunGuide, trackFirstRunGuide } from "./first-run-guide";

export type FirstRunGuideState = "unknown" | "shown" | "hidden";

/** `eligible` : historique vide (true), non vide (false), pas encore lu (null). */
export function useFirstRunGuide(eligible: boolean | null): { state: FirstRunGuideState; close: () => void } {
  const [state, setState] = useState<FirstRunGuideState>("unknown");
  const decided = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );
  useEffect(() => {
    if (eligible === null || decided.current) return;
    decided.current = true;
    if (!eligible) {
      void skipFirstRunGuide(AsyncStorage);
      setState("hidden");
      return;
    }
    void claimFirstRunGuide(AsyncStorage).then((claimed) => {
      if (!mounted.current) return;
      setState(claimed ? "shown" : "hidden");
      // Mesure du parcours : montré, donc une seule fois par appareil (la marque est rangée).
      if (claimed) trackFirstRunGuide("shown");
    });
  }, [eligible]);
  return { state, close: () => setState("hidden") };
}
