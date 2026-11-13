// Recherche d'image d'iOS (mission « liens vidéo ») : le lien qui ouvre
// l'app et le nom des fichiers, vérifiés ici. Logique pure, testée ; la
// réception elle-même : visual-search-intake.ts. Imports relatifs : fichier
// testé par vitest (et lu par app/+native-intent.ts).
import { APP_SCHEME } from "../constants/brand";

/** Dossier des captures, dans le groupe d'apps (même nom que dans le Swift). */
export const VISUAL_SEARCH_FOLDER = "recherche-image";
/** Lien d'ouverture en attente, dans le groupe d'apps (même nom que dans le Swift). */
export const PENDING_VISUAL_SEARCH_FILE = "recherche-image-en-attente.txt";
/** Au-delà, une capture du groupe d'apps est effacée par l'app (au lancement
 * et à chaque retour au premier plan, sauf celle qu'elle ouvre), et un lien
 * resté dans le fichier d'attente n'est plus relu. iOS écrit la capture dès
 * qu'il montre le résultat, avant tout choix de la personne (revue de
 * sécurité) : elle ne doit pas rester. */
export const VISUAL_SEARCH_MAX_AGE_MS = 10 * 60_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CAPTURE_ID = new RegExp(`^${UUID}$`);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Adresse exacte écrite par le Swift : rien avant, rien après, identifiant en minuscules.
const OPENING = new RegExp(`^${escapeRegExp(APP_SCHEME)}://recherche-image\\?fichier=(${UUID})$`);

/** Identifiant de la capture, si `url` est exactement un lien d'ouverture de
 * la recherche d'image ; sinon null (autre adresse, identifiant qui n'est pas
 * un UUID, chemin « ../ », caractères encodés, paramètre en trop). */
export function visualSearchCaptureId(url: string): string | null {
  const match = OPENING.exec(url.trim());
  return match ? match[1]! : null;
}

/** L'app s'ouvre par la recherche d'image : l'adresse ne désigne aucun écran. */
export function isVisualSearchOpeningUrl(url: string): boolean {
  return visualSearchCaptureId(url) !== null;
}

/** Lien relu depuis le fichier d'attente, ou null : contenu inattendu, ou capture trop ancienne. Date inconnue : relu. */
export function pendingVisualSearchOpening(content: string, modifiedAt: number | null, now: number): string | null {
  const url = content.trim();
  if (!isVisualSearchOpeningUrl(url)) return null;
  if (modifiedAt !== null && now - modifiedAt > VISUAL_SEARCH_MAX_AGE_MS) return null;
  return url;
}

/** Nom du fichier d'une capture dans le dossier du groupe d'apps. */
export function captureFileName(id: string): string {
  return `${id}.jpg`;
}

/** Fichiers du dossier des captures à effacer : ceux de plus de 10 minutes,
 * sauf les captures en cours d'ouverture. Date illisible : laissé (il peut
 * s'agir de la capture qu'on va ouvrir) ; la capture suivante l'efface. */
export function staleCaptureNames(entries: readonly { name: string; modifiedAt: number | null }[], opening: Iterable<string>, now: number): string[] {
  const kept = new Set([...opening].map(captureFileName));
  return entries.filter((entry) => !kept.has(entry.name) && entry.modifiedAt !== null && now - entry.modifiedAt > VISUAL_SEARCH_MAX_AGE_MS).map((entry) => entry.name);
}

/** Un identifiant de capture : un UUID en minuscules, rien d'autre (jamais un chemin). */
export function isCaptureId(id: string): boolean {
  return CAPTURE_ID.test(id);
}

/** La recherche d'image d'iOS existe : iPhone sous iOS 26 ou suivant (Platform.Version : « 26.1 »). */
export function supportsVisualSearch(os: string, version: string | number): boolean {
  if (os !== "ios") return false;
  const major = Number.parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 26;
}

/** Carte « Astuce » de la recherche d'image : montrée une seule fois (clé de rangement sur l'appareil). */
export const VISUAL_SEARCH_TIP_KEY = "spotto.astuce-recherche-image";
