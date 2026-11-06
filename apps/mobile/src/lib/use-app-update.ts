// Mise à jour obligatoire de l'app iPhone, vue des écrans (lot « app iPhone
// prête », chantier 4, point 11). La logique et l'état : app-update.ts.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { fetchAppVersionInfo } from "./api";
import { currentAppBuild, isBelowMinimum, markUpdateRequired, parseBuildNumber, peekUpdateRequired, setAppBuild, shouldCheckVersion, subscribeUpdateRequired, type UpdateRequired } from "./app-update";
import { useForegroundReturn } from "./use-foreground-return";

// Build de l'app iPhone installée (CFBundleVersion, fixé par EAS à chaque
// build), lu une fois, avant tout appel du serveur : chaque appel le porte.
// Le site n'en a pas : il n'est jamais concerné.
setAppBuild(Platform.OS === "ios" ? parseBuildNumber(Constants.platform?.ios?.buildNumber) : null);

const nothingOnServer = () => null;

export function useUpdateRequired(): UpdateRequired | null {
  return useSyncExternalStore(subscribeUpdateRequired, peekUpdateRequired, nothingOnServer);
}

/** Lit le build minimal au démarrage et au retour dans l'app (au plus une
 * fois toutes les 5 minutes). Serveur injoignable ou endormi : rien ne bloque,
 * on réessaiera ; la réponse 426 d'un appel suffit aussi à afficher l'écran. */
export function useMinimumVersionCheck(): void {
  const lastCheck = useRef<number | null>(null);
  const check = useCallback(() => {
    const build = currentAppBuild();
    const now = Date.now();
    if (build === null || !shouldCheckVersion(lastCheck.current, now)) return;
    lastCheck.current = now;
    fetchAppVersionInfo()
      .then((info) => {
        if (info && isBelowMinimum(build, info.minimumBuild)) markUpdateRequired(info.storeUrl);
      })
      .catch(() => {
        // Réseau coupé : nouvel essai au prochain retour dans l'app.
        lastCheck.current = null;
      });
  }, []);
  useEffect(check, [check]);
  useForegroundReturn(check);
}
