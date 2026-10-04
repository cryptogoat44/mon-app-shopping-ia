// Suivi des erreurs de l'app iPhone (Sentry, région UE à Francfort) — lot 3bis.
// Version web : error-tracking.web.ts (choisie automatiquement pour le site).
//
// Mêmes réglages que le site (décision du fondateur, 2026-10-04) : actif
// uniquement avec une adresse Sentry de la région UE (EXPO_PUBLIC_SENTRY_DSN) ;
// aucune donnée personnelle (collectes automatiques coupées, rapports nettoyés
// par sentry-scrub.ts) ; utilisateur désigné par son seul identifiant
// interne. Ni suivi de « sessions », ni mesure de performance, ni capture
// d'écran, ni relecture de session. Les plantages natifs (iOS) sont signalés.
import * as Sentry from "@sentry/react-native";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";
import { scrubBreadcrumb, scrubErrorEvent } from "./sentry-scrub";

let active = false;

export function initErrorTracking(): void {
  if (active) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn || !SENTRY_EU_DSN_PATTERN.test(dsn)) return;
  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_ENVIRONMENT?.trim() || "development",
    sendDefaultPii: false,
    // Pas de suivi de « sessions » (comme sur le site) ni de performance.
    enableAutoSessionTracking: false,
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableUserInteractionTracing: false,
    enableCaptureFailedRequests: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeSend: (event) => scrubErrorEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  active = true;
}

/** Compte connecté (identifiant interne seul), ou null à la déconnexion. */
export function setErrorTrackingUser(userId: string | null): void {
  if (active) Sentry.setUser(userId ? { id: userId } : null);
}
