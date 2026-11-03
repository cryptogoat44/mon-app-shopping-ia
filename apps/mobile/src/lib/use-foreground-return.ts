import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/** Retour dans l'app : sur iPhone après un passage par une autre app
 * (TikTok…), sur le site quand l'onglet redevient visible. `onReturn` est la
 * dernière fonction passée : elle voit l'état à jour de l'écran. */
export function useForegroundReturn(onReturn: () => void): void {
  const latest = useRef(onReturn);
  useEffect(() => {
    latest.current = onReturn;
  });
  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") latest.current();
      previous = next;
    });
    return () => subscription.remove();
  }, []);
}
