import type { AppVersionInfo, UpdateRequiredErrorBody } from "@monapp/shared-types";
import { UPDATE_REQUIRED_ERROR } from "@monapp/shared-types";
import { BRAND } from "./brand.js";

// Mise à jour obligatoire de l'app iPhone (lot « app iPhone prête »,
// chantier 4, point 11). Le site se met à jour à chaque mise en ligne ;
// l'iPhone, non : une version installée continue de tourner. Le fondateur peut
// donc régler chez Render un build minimal (APP_MIN_IOS_BUILD). L'app iPhone
// envoie son numéro de build à chaque appel (en-tête x-spotto-build) ; en
// dessous du minimum, le serveur répond 426 « mise à jour requise » et l'app
// affiche l'écran « Mettez à jour Spotto ». L'app lit aussi ce minimum au
// démarrage (GET /api/app/version), avant même la connexion.
//
// Réglages lus avec indulgence, comme les interrupteurs de la voie C : une
// faute de frappe dans Render ne doit jamais empêcher le serveur de démarrer.
// Une valeur illisible vaut « aucun minimum » (réglage par défaut).

/** Plus grand numéro de build admis (au-delà : faute de frappe). */
const MAX_BUILD = 1_000_000;

export const UPDATE_REQUIRED_MESSAGE = `Cette version de ${BRAND} n'est plus prise en charge. Mettez à jour l'app depuis l'App Store.`;

/** Numéro de build : un entier positif écrit en chiffres seuls ; sinon null. */
export function parseBuildNumber(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  const build = Number(text);
  return build >= 1 && build <= MAX_BUILD ? build : null;
}

/** APP_MIN_IOS_BUILD : absent, vide ou illisible = aucun minimum. */
export function parseMinimumBuild(value: string | undefined): number | null {
  return parseBuildNumber(value);
}

/** APP_STORE_URL : seulement une adresse de l'App Store d'Apple ; sinon null. */
export function parseStoreUrl(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "apps.apple.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** En-tête x-spotto-build d'une requête (une seule valeur admise). */
export function buildFromHeader(value: string | string[] | undefined): number | null {
  return typeof value === "string" ? parseBuildNumber(value) : null;
}

/** Sans build connu (site, ancienne app) ou sans minimum : jamais bloqué. */
export function isBelowMinimum(build: number | null, minimum: number | null): boolean {
  return build !== null && minimum !== null && build < minimum;
}

export function appVersionInfo(minimumBuild: number | null, storeUrl: string | null): AppVersionInfo {
  return { ios: { minimumBuild, storeUrl } };
}

export function updateRequiredBody(storeUrl: string | null): UpdateRequiredErrorBody {
  return { error: UPDATE_REQUIRED_ERROR, message: UPDATE_REQUIRED_MESSAGE, storeUrl };
}

/** Adresses jamais bloquées : la lecture du minimum elle-même, et la sonde de santé. */
export function isVersionGuardExempt(url: string): boolean {
  const path = url.split("?")[0]!;
  return !path.startsWith("/api/") || path === "/api/app/version";
}
