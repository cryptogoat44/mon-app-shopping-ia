import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { INITIAL_POLL, nextPoll, type PollState } from "./conversations";

/** Relit avec `poll` tant que l'écran est affiché et l'app au premier plan :
 * toutes les 5 s, puis plus lentement quand rien ne bouge ou que le réseau
 * échoue (lib/conversations.ts, nextPoll). `poll` dit s'il y avait du
 * nouveau ; une erreur ralentit. `kick()` relance aussitôt le rythme rapide
 * (après un envoi). Rien ne tourne en arrière-plan. */
export function usePolling(poll: () => Promise<"new" | "same">): { kick: () => void } {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  });
  const state = useRef<PollState>(INITIAL_POLL);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const schedule = useCallback(() => {
    stop();
    if (!active.current) return;
    timer.current = setTimeout(async () => {
      timer.current = null;
      let outcome: "new" | "same" | "error";
      try {
        outcome = await latest.current();
      } catch {
        outcome = "error";
      }
      state.current = nextPoll(state.current, outcome);
      if (timer.current === null) schedule();
    }, state.current.delay);
  }, [stop]);

  useFocusEffect(
    useCallback(() => {
      active.current = AppState.currentState !== "background";
      state.current = INITIAL_POLL;
      schedule();
      const subscription = AppState.addEventListener("change", (next) => {
        const wasActive = active.current;
        active.current = next === "active";
        if (active.current && !wasActive) {
          state.current = INITIAL_POLL;
          schedule();
        } else if (!active.current) {
          stop();
        }
      });
      return () => {
        active.current = false;
        stop();
        subscription.remove();
      };
    }, [schedule, stop])
  );

  const kick = useCallback(() => {
    state.current = INITIAL_POLL;
    schedule();
  }, [schedule]);
  return { kick };
}
