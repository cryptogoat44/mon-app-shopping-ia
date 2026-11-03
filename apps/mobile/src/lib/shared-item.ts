// Élément reçu par la feuille de partage d'iOS (lot « partager vers Spotto ») :
// un lien, une image ou une vidéo, classé ici, puis gardé en attente jusqu'à
// ce que le Spotter puisse l'ouvrir (personne connectée, profil chargé : les
// écrans qui le prennent n'existent qu'à ce moment-là). Logique pure, testée ;
// la réception elle-même : share-intake.ts (app iPhone).
import { t } from "../i18n";
import { extractUrl } from "./link-detection";

/** Schéma de l'app (app.json « scheme ») : l'extension rouvre l'app par « spotto://dataUrl=spottoShareKey?… ». */
export const APP_SCHEME = "spotto";
/** Clé sous laquelle l'extension dépose le partage (réglages du groupe d'apps). */
export const SHARE_KEY = `${APP_SCHEME}ShareKey`;
/** Groupe d'apps de l'app et de son extension (app.json, module expo-share-intent). */
export const APP_GROUP = "group.com.spottoapp.ios";
// Au-delà, ce n'est plus un lien de partage ordinaire.
const MAX_LINK_LENGTH = 2048;

/** Ce que transmet l'extension (forme d'expo-share-intent ; champs parfois vides malgré ses types). */
export interface SharedFileInput {
  path?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
}

export interface ShareInput {
  files?: SharedFileInput[] | null;
  webUrl?: string | null;
  text?: string | null;
}

export type SharedRefusal = "several" | "unsupported" | "unreadable";

export type SharedItem =
  /** Lien web, déjà extrait du texte qui l'accompagne. */
  | { kind: "link"; text: string }
  | { kind: "image"; uri: string; width: number | null; height: number | null }
  | { kind: "video"; uri: string; sizeBytes: number | null }
  /** Plusieurs éléments, fichier quelconque, texte sans lien, ou partage illisible. */
  | { kind: "refused"; reason: SharedRefusal };

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp"];
const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v", "3gp"];

/** Lien d'un partage : le premier lien web du texte (TikTok et Instagram y
 * ajoutent souvent une phrase), sans espaces ni ponctuation finale — la même
 * extraction que le champ de lien (extractUrl), pour un même résultat. */
export function normalizeSharedLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = extractUrl(value);
  if (!url || url.length > MAX_LINK_LENGTH) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Adresse locale du fichier copié par l'extension ; rien d'autre n'est accepté. */
function fileUri(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("file://")) return path;
  return path.startsWith("/") ? `file://${path}` : null;
}

function mediaKind(file: SharedFileInput): "image" | "video" | null {
  const mime = (file.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  // Type absent ou générique : l'extension du nom tranche.
  const extension = (file.fileName || file.path || "").split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return VIDEO_EXTENSIONS.includes(extension) ? "video" : null;
}

const known = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** Lien, image, vidéo ou refus, d'après le contenu réel du partage. */
export function classifySharedItem(input: ShareInput | null | undefined): SharedItem {
  const files = (input?.files ?? []).filter((file) => Boolean(file?.path));
  if (files.length > 1) return { kind: "refused", reason: "several" };
  const file = files[0];
  if (file) {
    const uri = fileUri(file.path);
    const kind = mediaKind(file);
    if (!uri) return { kind: "refused", reason: "unreadable" };
    if (kind === "image") return { kind: "image", uri, width: known(file.width), height: known(file.height) };
    if (kind === "video") return { kind: "video", uri, sizeBytes: known(file.size) };
    return { kind: "refused", reason: "unsupported" };
  }
  const link = normalizeSharedLink(input?.webUrl) ?? normalizeSharedLink(input?.text);
  if (link) return { kind: "link", text: link };
  return { kind: "refused", reason: input?.text?.trim() || input?.webUrl ? "unsupported" : "unreadable" };
}

/** Message clair quand l'élément partagé ne peut pas s'ouvrir. */
export function sharedRefusalMessage(reason: SharedRefusal): string {
  return t.share[reason];
}

/** L'app s'ouvre par l'extension de partage : l'adresse ne désigne aucun écran. */
export function isShareOpeningUrl(url: string): boolean {
  return url.startsWith(`${APP_SCHEME}://dataUrl=${SHARE_KEY}`);
}

// Élément en attente : un seul, le plus récent ; gardé en mémoire tant que
// l'app reste ouverte (même en arrière-plan), jamais enregistré.
let waiting: SharedItem | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Nouveau partage. Rend celui qu'il remplace, encore en attente, pour en effacer la copie. */
export function receiveSharedItem(item: SharedItem): SharedItem | null {
  const replaced = waiting;
  waiting = item;
  notify();
  return replaced;
}

export function peekSharedItem(): SharedItem | null {
  return waiting;
}

/** Le Spotter prend l'élément : il ne s'ouvre qu'une fois. */
export function takeSharedItem(): SharedItem | null {
  const item = waiting;
  waiting = null;
  if (item) notify();
  return item;
}

export function subscribeSharedItem(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
