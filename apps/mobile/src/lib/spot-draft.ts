// Brouillon du parcours Spotter en cours (Aperçu → Ciblage → Attente →
// Résultat), gardé en mémoire le temps du parcours. L'identifiant de la
// recherche passe aussi dans l'adresse de chaque écran : après un
// rechargement de page (web), l'écran relit la recherche sur le serveur
// quand c'est possible, ou renvoie proprement vers Spotter.
import type { CropRect } from "@monapp/shared-types";
import type { LinkPlatform } from "./link-detection";

export interface ImageSize {
  width: number;
  height: number;
}

export interface SpotDraft {
  /** Recherche préparée, encore jamais lancée. Null une fois lancée (même
   * annulée) : un nouveau lancement prépare une nouvelle recherche, gratuite. */
  searchId: string | null;
  /** Lien d'origine (null pour une photo importée). */
  sourceUrl: string | null;
  platform: LinkPlatform | "photo";
  /** Vignette officielle renvoyée par « préparer », si elle existe. */
  previewUrl: string | null;
  /** Photo ou capture importée : remplace la vignette. */
  localImageUri: string | null;
  /** Taille de l'image affichée, connue une fois chargée. */
  imageSize: ImageSize | null;
  crop: CropRect | null;
  query: string;
}

let current: SpotDraft | null = null;

export function startDraft(draft: Omit<SpotDraft, "crop" | "query" | "imageSize"> & Partial<SpotDraft>): SpotDraft {
  current = { crop: null, query: "", imageSize: null, ...draft };
  return current;
}

export function getDraft(): SpotDraft | null {
  return current;
}

export function updateDraft(patch: Partial<SpotDraft>): SpotDraft | null {
  if (!current) return null;
  current = { ...current, ...patch };
  return current;
}

/** L'image à analyser : la capture importée si elle existe, sinon la vignette. */
export function draftImageUri(draft: SpotDraft): string | null {
  return draft.localImageUri ?? draft.previewUrl;
}

export function clearDraft(): void {
  current = null;
}
