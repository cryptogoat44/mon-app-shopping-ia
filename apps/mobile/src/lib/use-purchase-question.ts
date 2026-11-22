// Parcours 3 : « Vous l'avez achetée ? » branché sur un écran
// (lib/purchase-question.ts) : ouvre la boutique, guette le retour, puis pose
// la question quand elle est due. L'écran Résultat et la fiche d'une Envie le
// donnent à leurs boutons par ShopWatchContext ; sans ce contexte (grille des
// Envies, Vault, publications…), rien ne change : la boutique s'ouvre, rien
// n'est guetté. L'appel openMerchantLink est reçu tel quel, jamais réécrit.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MerchantLinkContext } from "@monapp/shared-types";
import type { Piece } from "../api/types";
import { track } from "./analytics";
import { afterSheetClose } from "./after-sheet-close";
import type { OpenMerchantLinkResult } from "./merchant-links";
import {
  claimPurchaseQuestion,
  createShopWatcher,
  purchaseContextOf,
  questionDue,
  targetOfPiece,
  watchPlatformOf,
  type PurchaseContext,
  type QuestionTarget,
  type ShopReturn,
  type ShopWatcher,
} from "./purchase-question";

export interface ShopWatch {
  /** Ouvre la boutique par `open` (l'appel openMerchantLink, tel quel) et
   * guette le retour. `piece` : la proposition de la carte touchée (écran
   * Résultat) ; absente, la pièce de l'écran (fiche d'une Envie). */
  open(context: MerchantLinkContext, open: () => Promise<OpenMerchantLinkResult>, piece?: Piece): Promise<OpenMerchantLinkResult>;
}

/** Sans écran qui guette : la boutique s'ouvre, rien de plus. */
const DIRECT: ShopWatch = { open: (_context, open) => open() };

export const ShopWatchContext = createContext<ShopWatch | null>(null);

export function useShopWatch(): ShopWatch {
  return useContext(ShopWatchContext) ?? DIRECT;
}

/** La question à l'écran : la pièce ouverte, et d'où. */
export interface PendingQuestion {
  target: QuestionTarget;
  context: PurchaseContext;
}

export interface PurchaseQuestionOptions {
  /** Compte connecté (null : jamais de question). */
  userId: string | null;
  /** Fiche d'une Envie : sa pièce (null sans proposition d'origine). */
  screenTarget?: QuestionTarget | null;
  /** Déjà au Vault : jamais de question. */
  owned: (target: QuestionTarget) => boolean;
  /** Une autre feuille de l'écran est ouverte : jamais par-dessus. */
  sheetOpen: boolean;
}

export function usePurchaseQuestion(options: PurchaseQuestionOptions): { watch: ShopWatch; question: PendingQuestion | null; close: () => void } {
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  // Lus au retour, qui arrive bien après le rendu du clic : toujours l'état à jour de l'écran.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const shown = useRef<PendingQuestion | null>(null);
  const watcher = useRef<ShopWatcher | null>(null);

  useEffect(() => {
    let active = true;
    // iPhone : la feuille s'ouvre 700 ms après la fermeture de la fenêtre
    // Safari (fin parfois signalée avant la fin de l'animation : une fenêtre
    // demandée pendant une fermeture n'est jamais montrée). Site : tout de suite.
    const afterBrowser = afterSheetClose(Platform.OS !== "ios");
    const facts = (back: ShopReturn) => {
      const current = latest.current;
      return { awayMs: back.awayMs, userId: current.userId, owned: current.owned(back.target), sheetOpen: current.sheetOpen || shown.current !== null };
    };
    async function show(back: ShopReturn) {
      if (!active || !questionDue(facts(back))) return;
      const claimed = await claimPurchaseQuestion(AsyncStorage, latest.current.userId!, back.target.matchId, new Date());
      if (!claimed || !active || !questionDue(facts(back))) return;
      shown.current = { target: back.target, context: back.context };
      setQuestion(shown.current);
      track("purchase_question", { action: "shown", context: back.context });
    }
    const current = createShopWatcher(watchPlatformOf(Platform.OS), () => Date.now(), (back) => {
      // Chaque retour repéré, question posée ou non (sous 30 s compris).
      track("shop_returned", { context: back.context, away_ms: back.awayMs });
      if (questionDue(facts(back))) afterBrowser.schedule(() => void show(back));
    });
    watcher.current = current;
    // Site : la page cachée par la boutique, puis revenue (visibilitychange).
    const subscription = AppState.addEventListener("change", (state) => current.appStateChanged(state));
    return () => {
      active = false;
      watcher.current = null;
      current.stop();
      afterBrowser.cancel();
      subscription?.remove();
    };
  }, []);

  const watch = useMemo<ShopWatch>(
    () => ({
      open(context, open, piece) {
        const target = piece ? targetOfPiece(piece) : (latest.current.screenTarget ?? null);
        return watcher.current ? watcher.current.open(target, purchaseContextOf(context), open) : open();
      },
    }),
    []
  );

  const close = useCallback(() => {
    shown.current = null;
    setQuestion(null);
  }, []);

  return { watch, question, close };
}
