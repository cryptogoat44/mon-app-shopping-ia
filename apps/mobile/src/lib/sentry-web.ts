// Suivi des erreurs du site (Sentry, région UE à Francfort) — lot 2.
// Actif uniquement sur le web, avec une adresse Sentry de la région UE
// (EXPO_PUBLIC_SENTRY_DSN). Aucune donnée personnelle : collectes
// automatiques coupées, rapports nettoyés (sentry-scrub.ts), utilisateur
// désigné par son seul identifiant interne. Pas de relecture de session ni
// de mesure de performance.
//
// Chargé À PART, après le démarrage (import dynamique) : intégré au fichier
// principal, Sentry l'alourdissait de ~270 Ko compressés (+56 %) pour tous
// les visiteurs. Contrepartie : une erreur dans la toute première seconde,
// avant son chargement, n'est pas capturée.
import { Platform } from "react-native";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";
import { scrubBreadcrumb, scrubErrorEvent } from "./sentry-scrub";

type SentryModule = typeof import("@sentry/react");

let sentry: SentryModule | null = null;
let pendingUser: string | null = null;

export function initWebSentry(): void {
  if (Platform.OS !== "web" || sentry) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn || !SENTRY_EU_DSN_PATTERN.test(dsn)) return;
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.EXPO_PUBLIC_ENVIRONMENT?.trim() || "development",
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          databaseQueryData: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
        },
        tracesSampleRate: 0,
        // Pas de suivi de « sessions » (il enverrait l'adresse IP de chaque visite).
        integrations: (defaults) => defaults.filter((integration) => integration.name !== "BrowserSession"),
        beforeSend: (event) => scrubErrorEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
      });
      sentry = Sentry;
      if (pendingUser) Sentry.setUser({ id: pendingUser });
    })
    .catch(() => {
      // Chargement impossible (réseau) : le site fonctionne sans suivi.
    });
}

/** Compte connecté (identifiant interne seul), ou null à la déconnexion. */
export function setWebSentryUser(userId: string | null): void {
  pendingUser = userId;
  sentry?.setUser(userId ? { id: userId } : null);
}

/** Échec imprévu rattrapé par un écran (la personne voit déjà un message) :
 * signalé quand même, avec le même nettoyage. `where` : le parcours concerné. */
export function reportWebError(error: unknown, where: string): void {
  sentry?.captureException(error, { tags: { where } });
}
