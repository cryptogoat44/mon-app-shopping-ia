// La page look, côté visiteur (lot « page look », décision du fondateur n° 4 :
// la page est servie par une route du serveur sans compte). Un seul appel à
// l'affichage, GET /api/looks/public/:token, sans session ni identifiant
// (même pour un membre connecté : rien ne relie la visite à un compte) ; un
// seul appel à /health au toucher de « Trouver la mienne », pour commencer à
// réveiller le serveur pendant l'inscription. Rien n'est écrit sur
// l'appareil. Imports relatifs : fichier testé par vitest.
import type { PublicLook } from "@monapp/shared-types";
import { acceptLanguage } from "../i18n";
import { lookImagePrefix, parsePublicLook } from "./look-page";

/** found : la page ; gone : introuvable (inconnue, arrêtée, expirée,
 * illisible : une seule réponse) ; error : réseau ou serveur, à réessayer. */
export type PublicLookResult = { kind: "found"; look: PublicLook } | { kind: "gone" } | { kind: "error" };

function apiBase(): string | null {
  const url = process.env.EXPO_PUBLIC_API_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

/** La page du jeton `token` (déjà vérifié par lookTokenFrom). */
export async function fetchPublicLook(token: string, signal?: AbortSignal): Promise<PublicLookResult> {
  const base = apiBase();
  if (!base) return { kind: "error" };
  let response: Response;
  try {
    response = await fetch(`${base}/api/looks/public/${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { "Accept-Language": acceptLanguage() },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch {
    return { kind: "error" };
  }
  if (response.status === 404) return { kind: "gone" };
  if (!response.ok) return { kind: "error" };
  const look = parsePublicLook(await response.json().catch(() => null), lookImagePrefix(process.env.EXPO_PUBLIC_SUPABASE_URL));
  return look ? { kind: "found", look } : { kind: "gone" };
}

/** Au toucher de « Trouver la mienne » seulement : un appel, jamais attendu,
 * jamais répété (pas un maintien en éveil). */
export function wakeServer(): void {
  const base = apiBase();
  if (!base) return;
  fetch(`${base}/health`, { method: "GET", credentials: "omit", referrerPolicy: "no-referrer" }).catch(() => undefined);
}
