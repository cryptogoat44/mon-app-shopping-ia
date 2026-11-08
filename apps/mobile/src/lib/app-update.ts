// Mise à jour obligatoire de l'app iPhone (lot « app iPhone prête »,
// chantier 4, point 11). Le serveur fixe un build minimal (réglage chez
// Render, coupé par défaut). L'app l'apprend de deux façons :
// - au démarrage et au retour dans l'app, en lisant GET /api/app/version
//   (sans compte : l'accueil aussi doit pouvoir le dire) ;
// - à n'importe quel appel du serveur, qui répond 426 « update_required »
//   à un build trop ancien (l'en-tête x-spotto-build porte le build).
// Dès lors, l'écran « Mettez à jour Spotto » remplace toute l'app jusqu'à la
// mise à jour. Logique pure et testée ; imports relatifs (vitest).
import type { AppVersionInfo } from "@monapp/shared-types";
import { APP_BUILD_HEADER, UPDATE_REQUIRED_ERROR } from "@monapp/shared-types";

/** Numéro de build (CFBundleVersion, ou valeur reçue) : un entier positif, sinon null. */
export function parseBuildNumber(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,7}$/.test(text)) return null;
  const build = Number(text);
  return build >= 1 ? build : null;
}

// Build de l'app iPhone installée, fixé au démarrage (use-app-update.ts) ;
// null sur le site et tant qu'il n'est pas connu : aucun en-tête envoyé.
let appBuild: number | null = null;

export function setAppBuild(build: number | null): void {
  appBuild = build;
}

export function currentAppBuild(): number | null {
  return appBuild;
}

/** En-tête « x-spotto-build » de chaque appel du serveur (app iPhone seulement). */
export function appBuildHeaders(): Record<string, string> {
  return appBuild === null ? {} : { [APP_BUILD_HEADER]: String(appBuild) };
}

/** Seule adresse acceptée pour le bouton : la fiche de l'App Store d'Apple. */
export function parseStoreUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "apps.apple.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Réponse de GET /api/app/version, lue prudemment (null : illisible). */
export function readAppVersionInfo(body: unknown): { minimumBuild: number | null; storeUrl: string | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const ios = (body as Partial<AppVersionInfo>).ios;
  if (typeof ios !== "object" || ios === null) return null;
  return { minimumBuild: parseBuildNumber(ios.minimumBuild), storeUrl: parseStoreUrl(ios.storeUrl) };
}

/** Sans build connu (site, développement) ou sans minimum : jamais bloqué. */
export function isBelowMinimum(build: number | null, minimum: number | null): boolean {
  return build !== null && minimum !== null && build < minimum;
}

/** Réponse d'un appel du serveur : « mise à jour requise » ? */
export function isUpdateRequiredResponse(status: number, body: unknown): boolean {
  return status === 426 && typeof body === "object" && body !== null && (body as { error?: unknown }).error === UPDATE_REQUIRED_ERROR;
}

// État : une fois la mise à jour exigée, elle le reste jusqu'à la fermeture de
// l'app (la mise à jour depuis l'App Store relance l'app de toute façon).
export interface UpdateRequired {
  storeUrl: string | null;
}

let required: UpdateRequired | null = null;
const listeners = new Set<() => void>();

/** Mise à jour exigée ; une adresse connue n'est jamais effacée par une réponse qui n'en a pas. */
export function markUpdateRequired(storeUrl: string | null): void {
  const next = { storeUrl: storeUrl ?? required?.storeUrl ?? null };
  if (required && required.storeUrl === next.storeUrl) return;
  required = next;
  for (const listener of listeners) listener();
}

export function peekUpdateRequired(): UpdateRequired | null {
  return required;
}

export function subscribeUpdateRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests uniquement. */
export function __resetUpdateRequired(): void {
  required = null;
}

/** Lecture du minimum au plus une fois toutes les 5 minutes (retours répétés dans l'app). */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;

export function shouldCheckVersion(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= VERSION_CHECK_INTERVAL_MS;
}
