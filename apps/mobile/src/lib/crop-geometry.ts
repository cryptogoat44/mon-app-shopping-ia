// Géométrie de la zone à chercher (tracé « Entourez la pièce ») et de son
// aperçu (écran d'attente). Logique pure, testée sans écran. La zone est
// exprimée en proportions de l'IMAGE (0 à 1) : c'est ce que le serveur
// reçoit, et ça ne dépend pas de la taille d'affichage.
import { DEFAULT_CROP, type CropRect } from "@monapp/shared-types";

export interface Size {
  width: number;
  height: number;
}

/** Rectangle d'affichage, en points écran. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Taille minimale de la zone, en proportion de l'image (le serveur refuse
 * en dessous de 5 %). */
export const MIN_CROP = 0.12;

/** Ancienne zone par défaut : centrée, 70 % de l'image (définie une seule
 * fois, dans les types partagés : l'outil d'essai du serveur l'utilise aussi). */
export { DEFAULT_CROP };

/** L'image entière : « Utiliser toute l'image ». */
export const WHOLE_IMAGE: CropRect = { x: 0, y: 0, width: 1, height: 1 };

const SIDES = ["x", "y", "width", "height"] as const;

/** Zone obtenue sans entourer la pièce : l'image entière, ou l'ancienne zone
 * centrale par défaut. Conseil d'entourer la pièce seule, et statistique
 * « zone ajustée » (lots « premier essai » et « entourer la pièce »). */
export function isDefaultCrop(crop: CropRect | null): boolean {
  return crop !== null && [DEFAULT_CROP, WHOLE_IMAGE].some((reference) => SIDES.every((side) => crop[side] === reference[side]));
}

/** « Zone ajustée » : la personne a entouré la pièce. */
export function isAdjustedCrop(crop: CropRect | null): boolean {
  return crop !== null && !isDefaultCrop(crop);
}

/** Où l'image s'affiche dans son conteneur quand elle est « contenue »
 * (entière, sans déformation, centrée). */
export function containBox(container: Size, image: Size): Box {
  if (!image.width || !image.height || !container.width || !container.height) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

/** La zone (proportions de l'image) convertie en points écran. */
export function cropToBox(crop: CropRect, imageBox: Box): Box {
  return {
    left: imageBox.left + crop.x * imageBox.width,
    top: imageBox.top + crop.y * imageBox.height,
    width: crop.width * imageBox.width,
    height: crop.height * imageBox.height,
  };
}

/** Pour afficher SEULEMENT la zone choisie dans un cadre de largeur donnée
 * (écran d'attente, écran d'échec) : taille du cadre, et taille/position de
 * l'image entière à placer dedans (le cadre masque le reste). */
export function croppedView(image: Size, crop: CropRect, frameWidth: number, maxHeight: number) {
  const cropAspect = (crop.width * image.width) / (crop.height * image.height);
  let width = frameWidth;
  let height = width / cropAspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * cropAspect;
  }
  const scale = width / (crop.width * image.width);
  return {
    frame: { width, height },
    image: {
      width: image.width * scale,
      height: image.height * scale,
      left: -crop.x * image.width * scale,
      top: -crop.y * image.height * scale,
    },
  };
}
