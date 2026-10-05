import type { Profile } from "@monapp/shared-types";
import { isProfileComplete } from "@monapp/shared-types";
import { RECOVERY_PATH } from "./password-recovery";

/** État du chargement du profil de la personne connectée.
 * - "idle" : pas de session, rien à charger ;
 * - "loading" : premier essai en cours (l'écran de démarrage reste affiché) ;
 * - "retrying" : le premier essai a échoué, de nouveaux essais sont en
 *   cours (typiquement : le serveur se réveille) ;
 * - "failed" : tous les essais ont échoué ;
 * - "ready" : profil chargé. */
export type ProfileStatus = "idle" | "loading" | "retrying" | "failed" | "ready";

export type RootRoute = "splash" | "welcome" | "unavailable" | "complete-profile" | "app";

/** Décide quel groupe d'écrans afficher à la racine de l'app.
 *
 * Point clé (audit Lot Q, ROB-01) : un profil qu'on n'a PAS PU charger
 * (serveur lent ou injoignable) n'est jamais confondu avec un profil
 * INCOMPLET. Seul un profil réellement chargé et sans nom d'utilisateur
 * mène à "Dernière étape" — sinon une utilisatrice déjà inscrite pourrait
 * y écraser son nom d'utilisateur pendant une simple panne. */
export function resolveRootRoute(input: {
  session: unknown | null | undefined;
  profileStatus: ProfileStatus;
  profile: Profile | null;
}): RootRoute {
  const { session, profileStatus, profile } = input;

  if (session === undefined) return "splash";
  if (session === null) return "welcome";

  if (profileStatus === "idle" || profileStatus === "loading") return "splash";
  if (profileStatus === "retrying" || profileStatus === "failed" || profile === null) return "unavailable";

  return isProfileComplete(profile) ? "app" : "complete-profile";
}

/** Pendant l'écran de démarrage (« splash »), la navigation est retirée le
 * temps de charger la police éditoriale, puis de connaître la session et le
 * profil. Exception, une fois la police prête : l'écran du nouveau mot de
 * passe, ouvert par le lien de l'e-mail. La session qu'il ouvre fait
 * recharger le profil ; retirer la navigation à ce moment ramenait à
 * l'accueil de l'app, sans le formulaire (constaté sur iPhone, lot 3bis).
 * Cet écran est hors des groupes protégés : il reste affiché. */
export function showsNavigator(route: RootRoute, pathname: string, fontsReady: boolean): boolean {
  if (!fontsReady) return false;
  return route !== "splash" || pathname === RECOVERY_PATH;
}
