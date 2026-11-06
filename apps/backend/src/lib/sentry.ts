// Suivi des erreurs du serveur (Sentry, région UE à Francfort) — lot 2.
//
// Actif seulement si SENTRY_DSN est défini (jamais dans les tests). Aucune
// donnée personnelle : pas d'adresse IP, d'en-têtes, de cookies, de corps de
// requête ni de paramètres d'adresse ; l'utilisateur n'est désigné que par
// son identifiant interne. Seules les erreurs inattendues (réponses 500)
// sont transmises — voir le gestionnaire d'erreurs de app.ts.
import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

let enabled = false;

export { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";

/** Aucune catégorie de données collectée automatiquement. */
export const NO_PERSONAL_DATA: NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};

/** Retire tout ce qui pourrait contenir une donnée personnelle (fonction pure, testée). */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    const url = event.request.url ? event.request.url.split("?")[0] : undefined;
    event.request = { method: event.request.method, url };
  }
  const id = typeof event.user?.id === "string" ? event.user.id : undefined;
  event.user = id ? { id } : undefined;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => {
      const data = crumb.data && typeof crumb.data.url === "string" ? { ...crumb.data, url: crumb.data.url.split("?")[0] } : crumb.data;
      return { ...crumb, data };
    });
  }
  return event;
}

export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment,
    // Sentry 11 collecte beaucoup par défaut : tout est coupé explicitement,
    // en plus du nettoyage de scrubEvent (double protection).
    dataCollection: NO_PERSONAL_DATA,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  enabled = true;
}

/** Réponse 500 renvoyée par une route (erreur déjà gérée et journalisée par
 * elle) : signalée par la forme générique de la route (ex. /api/posts/:id),
 * jamais par l'adresse réelle. */
export function captureServerFailure(method: string, route: string, status: number, userId: string | undefined): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (userId) scope.setUser({ id: userId });
    scope.setTag("route", route);
    Sentry.captureMessage(`Réponse ${status} : ${method} ${route}`, "error");
  });
}

/** Erreur inattendue (réponse 500) : transmise avec l'identifiant interne seul. */
export function captureServerError(error: unknown, userId: string | undefined): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (userId) scope.setUser({ id: userId });
    Sentry.captureException(error);
  });
}

/** Alerte du serveur (lot garde-fous) : un avertissement, sans aucune donnée
 * personnelle (ni compte, ni contenu : des étiquettes de listes fermées). Le
 * tag « alerte » porte son type : une seule règle Sentry (« nouveau problème
 * avec le tag alerte ») prévient le fondateur. `fingerprint` : une alerte
 * nouvelle = un nouveau problème dans Sentry, donc une notification. */
export function captureAlert(message: string, tags: Record<string, string>, fingerprint: string[]): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTags(tags);
    scope.setFingerprint(fingerprint);
    Sentry.captureMessage(message, "warning");
  });
}

/** Événement de modération (chantier 3, point 6) : un signalement arrive, ou
 * un contenu vient d'être masqué automatiquement (lib/autoHide.ts). Envoyé
 * comme simple avertissement, sans aucune donnée sur la personne qui
 * signale ; une règle d'alerte de Sentry (« nouveau problème », tag
 * « alerte », voir ALERTES.md) prévient le fondateur sur son téléphone ou par
 * e-mail. Un contenu = un problème Sentry : plusieurs signalements du même
 * contenu se regroupent, un nouveau contenu signalé déclenche une nouvelle
 * alerte. C'est la SEULE alerte envoyée pour un signalement. */
export interface ModerationEvent {
  kind: "report" | "auto_hide";
  targetType: string;
  targetId: string;
  reason?: string;
}

/** Texte de l'événement (fonction pure, testée). */
export function moderationEventMessage(event: ModerationEvent): string {
  return event.kind === "report"
    ? `Nouveau signalement à traiter : ${event.targetType}${event.reason ? ` (${event.reason})` : ""}`
    : `Contenu masqué automatiquement (plusieurs signalements) : ${event.targetType}`;
}

/** Tags de l'événement (fonction pure, testée) : le tag « alerte » (règle
 * unique du lot garde-fous) et le tag « moderation » (chantier 3). Des
 * valeurs de listes fermées seulement : rien sur la personne qui signale. */
export function moderationEventTags(event: ModerationEvent): Record<string, string> {
  return {
    alerte: event.kind === "report" ? "signalement" : "masquage_auto",
    moderation: event.kind,
    target_type: event.targetType,
    ...(event.reason ? { reason: event.reason } : {}),
  };
}

export function captureModerationEvent(event: ModerationEvent): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTags(moderationEventTags(event));
    scope.setFingerprint(["moderation", event.kind, event.targetType, event.targetId]);
    Sentry.captureMessage(moderationEventMessage(event), "warning");
  });
}
