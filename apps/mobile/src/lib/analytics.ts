// Statistiques d'usage (PostHog, hébergement UE à Francfort) — lot 2.
//
// Envoi direct à l'API officielle de capture, sans la bibliothèque PostHog :
// ni collecte automatique, ni enregistrement de session, ni cookie, ni
// stockage sur l'appareil. Rien n'est envoyé :
// - sans clé de projet (développement local, tests) ;
// - sans compte connecté ;
// - sans consentement « statistiques d'usage » en vigueur (et le retrait
//   coupe immédiatement : rien n'est mis en file d'attente).
// Identification : l'identifiant interne du compte uniquement. Propriétés :
// catalogue fermé (analytics-events.ts). Un échec d'envoi n'affecte jamais
// l'app. Imports relatifs : fichier testé par vitest.
import { type AnalyticsEvent, type AnalyticsProps, sanitizeProps } from "./analytics-events";

/** Seul hôte autorisé : PostHog Cloud UE (Francfort). */
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

interface AnalyticsState {
  apiKey: string | null;
  environment: string;
  platform: string;
  userId: string | null;
  consent: boolean;
}

const state: AnalyticsState = {
  apiKey: process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() || null,
  environment: process.env.EXPO_PUBLIC_ENVIRONMENT?.trim() || "development",
  platform: "web",
  userId: null,
  consent: false,
};

type Sender = (url: string, body: string) => void;

let send: Sender = (url, body) => {
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
};

/** Plateforme (web, ios, android), fournie par l'app au démarrage. */
export function setAnalyticsPlatform(platform: string): void {
  state.platform = platform;
}

/** Compte connecté et son choix « statistiques d'usage » (null : déconnexion). */
export function setAnalyticsUser(userId: string | null, consent: boolean): void {
  state.userId = userId;
  state.consent = userId !== null && consent;
}

/** Accord ou retrait, effet immédiat. */
export function setAnalyticsConsent(consent: boolean): void {
  state.consent = state.userId !== null && consent;
}

export function isAnalyticsActive(): boolean {
  return state.apiKey !== null && state.userId !== null && state.consent;
}

/** Corps exact envoyé à PostHog (fonction pure, testée). */
export function buildCapturePayload(
  event: AnalyticsEvent,
  props: AnalyticsProps | undefined,
  context: { apiKey: string; userId: string; environment: string; platform: string; timestamp: string }
) {
  return {
    api_key: context.apiKey,
    event,
    distinct_id: context.userId,
    timestamp: context.timestamp,
    properties: {
      ...sanitizeProps(event, props),
      environment: context.environment,
      platform: context.platform,
      // Ni géolocalisation par l'adresse IP, ni profil de personne enrichi.
      $geoip_disable: true,
      $process_person_profile: false,
    },
  };
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (!isAnalyticsActive() || !state.apiKey || !state.userId) return;
  const payload = buildCapturePayload(event, props, {
    apiKey: state.apiKey,
    userId: state.userId,
    environment: state.environment,
    platform: state.platform,
    timestamp: new Date().toISOString(),
  });
  send(`${POSTHOG_EU_HOST}/i/v0/e/`, JSON.stringify(payload));
}

/** Tests uniquement : clé, plateforme et envoi simulés. */
export function __setAnalyticsTestHooks(hooks: { apiKey?: string | null; platform?: string; sender?: Sender }): void {
  if (hooks.apiKey !== undefined) state.apiKey = hooks.apiKey;
  if (hooks.platform) state.platform = hooks.platform;
  if (hooks.sender) send = hooks.sender;
}
