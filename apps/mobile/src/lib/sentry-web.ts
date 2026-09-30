// Suivi des erreurs du site (Sentry, région UE à Francfort) — lot 2.
// Actif uniquement sur le web, avec une adresse Sentry de la région UE
// (EXPO_PUBLIC_SENTRY_DSN). Aucune donnée personnelle : collectes
// automatiques coupées, rapports nettoyés (sentry-scrub.ts), utilisateur
// désigné par son seul identifiant interne. Pas de relecture de session ni
// de mesure de performance.
import { Platform } from "react-native";
import * as Sentry from "@sentry/react";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";
import { scrubWebBreadcrumb, scrubWebEvent } from "./sentry-scrub";

let enabled = false;

export function initWebSentry(): void {
  if (Platform.OS !== "web" || enabled) return;
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn || !SENTRY_EU_DSN_PATTERN.test(dsn)) return;
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
    beforeSend: (event) => scrubWebEvent(event),
    beforeBreadcrumb: (crumb) => scrubWebBreadcrumb(crumb),
  });
  enabled = true;
}

/** Compte connecté (identifiant interne seul), ou null à la déconnexion. */
export function setWebSentryUser(userId: string | null): void {
  if (!enabled) return;
  Sentry.setUser(userId ? { id: userId } : null);
}
