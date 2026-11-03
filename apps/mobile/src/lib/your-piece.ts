// « Votre pièce » sur l'écran Résultat (lot résultats lisibles) : la zone
// montrée à Spotto, en petite vignette au-dessus de la grande image, pour
// juger « est-ce la même ? » sans avoir à s'en souvenir. Seulement juste
// après le lancement, quand l'image est encore sur l'appareil (brouillon en
// mémoire, celui de ce résultat). Une recherche rouverte (historique, page
// rechargée) n'en montre aucune : le serveur ne garde pas l'image analysée,
// et rien de nouveau n'est gardé pour cela. Logique pure, testée.
// Imports relatifs : fichier testé par vitest.
import type { CropRect } from "@monapp/shared-types";
import { WHOLE_IMAGE, croppedView, type Box, type Size } from "./crop-geometry";
import { draftImageUri, type ImageSize, type SpotDraft } from "./spot-draft";

export interface YourPieceImage {
  uri: string;
  /** Taille de l'image entière ; null si inconnue (elle est alors montrée entière). */
  size: ImageSize | null;
  /** Zone analysée ; null : l'image entière est partie. */
  crop: CropRect | null;
}

function knownSize(size: ImageSize | null): size is ImageSize {
  return size !== null && size.width > 0 && size.height > 0;
}

/** L'image de « Votre pièce » (celle de l'écran d'attente), ou null :
 * résultat rouvert, brouillon absent, ou zone impossible à retrouver faute
 * de connaître la taille de l'image. */
export function yourPieceImage(fromLaunch: boolean, draft: SpotDraft | null): YourPieceImage | null {
  if (!fromLaunch || !draft) return null;
  const uri = draftImageUri(draft);
  if (!uri) return null;
  const size = knownSize(draft.imageSize) ? draft.imageSize : null;
  if (draft.crop && !size) return null;
  return { uri, size, crop: draft.crop };
}

/** Cadre de la vignette (au plus maxWidth × maxHeight, aux proportions de la
 * zone) et place de l'image entière dedans, le cadre masquant le reste.
 * `image` null : taille inconnue, l'image entière est contenue dans le cadre. */
export function yourPieceView(image: YourPieceImage, maxWidth: number, maxHeight: number): { frame: Size; image: Box | null } {
  if (!image.size) return { frame: { width: maxWidth, height: maxHeight }, image: null };
  const view = croppedView(image.size, image.crop ?? WHOLE_IMAGE, maxWidth, maxHeight);
  return { frame: view.frame, image: view.image };
}
