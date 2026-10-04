// Nettoyage des rapports d'erreur avant envoi à Sentry : site (lot 2) et
// app iPhone (lot 3bis), mêmes règles. Fonctions pures, testées : aucune
// donnée personnelle ne doit partir.
// Imports relatifs / de types seulement : fichier testé par vitest.
import type { Breadcrumb as WebBreadcrumb, ErrorEvent as WebErrorEvent } from "@sentry/react";
import type { Breadcrumb as NativeBreadcrumb, ErrorEvent as NativeErrorEvent } from "@sentry/react-native";

const withoutQuery = (url: string) => url.split("?")[0]!.split("#")[0]!;

/** Ne garde de la page que son adresse sans paramètres, de l'utilisateur que son identifiant. */
export function scrubErrorEvent(event: WebErrorEvent): WebErrorEvent;
export function scrubErrorEvent(event: NativeErrorEvent): NativeErrorEvent;
export function scrubErrorEvent(event: WebErrorEvent | NativeErrorEvent): WebErrorEvent | NativeErrorEvent {
  if (event.request) {
    event.request = event.request.url ? { url: withoutQuery(event.request.url) } : {};
  }
  const id = typeof event.user?.id === "string" ? event.user.id : undefined;
  event.user = id ? { id } : undefined;
  return event;
}

/** Traces conservées : navigation et appels réseau, sans paramètres d'adresse.
 * Écartées : console (peut contenir un texte saisi), clics et touchers
 * (libellés à l'écran). */
export function scrubBreadcrumb(crumb: WebBreadcrumb): WebBreadcrumb | null;
export function scrubBreadcrumb(crumb: NativeBreadcrumb): NativeBreadcrumb | null;
export function scrubBreadcrumb(crumb: WebBreadcrumb | NativeBreadcrumb): WebBreadcrumb | NativeBreadcrumb | null {
  if (crumb.category === "console" || crumb.category === "touch" || crumb.category?.startsWith("ui.")) return null;
  const data = crumb.data ? { ...crumb.data } : undefined;
  if (data) {
    for (const key of ["url", "from", "to"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = withoutQuery(value);
    }
  }
  return { ...crumb, data, message: crumb.message && crumb.category === "navigation" ? withoutQuery(crumb.message) : crumb.message };
}
