// Nettoyage des rapports d'erreur du site avant envoi à Sentry (lot 2).
// Fonctions pures, testées : aucune donnée personnelle ne doit partir.
// Imports relatifs / de types seulement : fichier testé par vitest.
import type { Breadcrumb, ErrorEvent } from "@sentry/react";

const withoutQuery = (url: string) => url.split("?")[0]!.split("#")[0]!;

/** Ne garde de la page que son adresse sans paramètres, de l'utilisateur que son identifiant. */
export function scrubWebEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request = event.request.url ? { url: withoutQuery(event.request.url) } : {};
  }
  const id = typeof event.user?.id === "string" ? event.user.id : undefined;
  event.user = id ? { id } : undefined;
  return event;
}

/** Traces conservées : navigation et appels réseau, sans paramètres d'adresse.
 * Écartées : console (peut contenir un texte saisi) et clics (libellés). */
export function scrubWebBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === "console" || crumb.category?.startsWith("ui.")) return null;
  const data = crumb.data ? { ...crumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = withoutQuery(data[key] as string);
    }
  }
  return { ...crumb, data, message: crumb.message && crumb.category === "navigation" ? withoutQuery(crumb.message) : crumb.message };
}
