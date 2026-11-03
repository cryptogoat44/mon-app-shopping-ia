// Liens ouverts par l'app (marchands, envies, pièces reçues) : seulement des
// adresses web ordinaires. Logique pure, sans dépendance à React Native, pour
// être testée directement (tests/web-url.test.ts). Le serveur applique la même
// règle aux liens qu'il reçoit (apps/backend/src/lib/validation.ts, isWebUrl).

// Caractères de contrôle, n'importe où (tabulation, retour à la ligne…) : un
// navigateur les retire en silence avant de lire le début du lien. Refusés,
// jamais nettoyés : le lien ouvert est exactement celui qui a été vérifié.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// « http:// » ou « https:// » (majuscules comprises) au tout début, puis un
// nom de site : ni « javascript: », ni « data: », ni un lien sans protocole.
const WEB_URL_START = /^https?:\/\/[^/\\]/i;

/** Vrai seulement pour un lien qui commence, tel quel, par « http:// » ou
 * « https:// » suivi d'un nom de site, sans espace au début ni à la fin et
 * sans caractère de contrôle. Tout le reste est refusé (javascript:, data:,
 * vbscript:, file:, blob:, ftp:, « //site »…). */
export function isWebUrl(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && !CONTROL_CHARACTERS.test(value) && WEB_URL_START.test(value);
}
