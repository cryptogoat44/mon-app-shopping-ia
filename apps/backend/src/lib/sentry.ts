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
