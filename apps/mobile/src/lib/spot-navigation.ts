import type { useRouter } from "expo-router";
import { clearDraft } from "./spot-draft";

type Router = ReturnType<typeof useRouter>;

/** « Fermer » depuis n'importe quelle étape du Spotter (aperçu, ciblage,
 * attente, résultats) : retour à l'accueil du Spotter, avec sa barre de
 * navigation. Les étapes intermédiaires sont retirées de l'historique (pas
 * de « Retour » qui y ramènerait) ; après un rechargement de page (web),
 * l'accueil remplace simplement l'écran courant. */
export function closeSpotter(router: Router): void {
  clearDraft();
  router.dismissTo("/");
}
