// Brouillon du parcours Spotter en cours (Ciblage → Attente →
// Résultat), gardé en mémoire le temps du parcours. L'identifiant de la
// recherche passe aussi dans l'adresse de chaque écran : après un
// rechargement de page (web), l'écran relit la recherche sur le serveur
// quand c'est possible, ou renvoie proprement vers Spotter.
import type { CropRect } from "@monapp/shared-types";
import type { UnsettledLaunch } from "./spot-recovery";

export interface ImageSize {
  width: number;
  height: number;
}

export interface SpotDraft {
  /** Recherche préparée, encore jamais lancée. Null une fois lancée (même
   * annulée) : un nouveau lancement prépare une nouvelle recherche, gratuite —
   * sauf relance à l'identique d'un lancement resté sans issue (`unsettled`). */
  searchId: string | null;
  /** Photo ou capture importée, ou image d'une vidéo de la personne : la
   * seule image analysée. */
  localImageUri: string | null;
  /** Taille de l'image affichée, connue une fois chargée. */
  imageSize: ImageSize | null;
  crop: CropRect | null;
  /** Zone trouvée par l'IA (moment d'une vidéo) : comptée « ajustée » dans la
   * statistique, même quand elle couvre toute l'image. Retombe à faux quand
   * la personne entoure la pièce elle-même (« Recadrer »). */
  zoneByAi?: boolean;
  /** Mots tapés sous une photo : ils trient les propositions, sans partir avec
   * l'image ; repris par « Recadrer » (petit lot 2). Jamais enregistrés. */
  words: string | null;
  /** Dernier lancement dont l'issue n'a pas encore été montrée (annulé,
   * écran quitté, réponse perdue) : relancé à l'identique, il est relu au
   * lieu d'être repayé (lib/spot-recovery.ts). */
  unsettled?: UnsettledLaunch | null;
}

let current: SpotDraft | null = null;

export function startDraft(draft: Omit<SpotDraft, "crop" | "imageSize" | "words"> & Partial<SpotDraft>): SpotDraft {
  current = { crop: null, imageSize: null, words: null, ...draft };
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

/** L'image à analyser : celle que la personne a importée. */
export function draftImageUri(draft: SpotDraft): string | null {
  return draft.localImageUri;
}

export function clearDraft(): void {
  current = null;
}
