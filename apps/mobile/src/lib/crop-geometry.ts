// Géométrie du recadrage (écran Ciblage) et de l'aperçu de la zone choisie
// (écran d'attente). Logique pure, testée sans écran. Le cadre est manipulé
// en proportions de l'IMAGE (0 à 1) : c'est ce que le serveur reçoit, et ça
// ne dépend pas de la taille d'affichage.
import type { CropRect } from "@monapp/shared-types";

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

export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Taille minimale du cadre, en proportion de l'image (le serveur refuse
 * en dessous de 5 %). */
export const MIN_CROP = 0.12;

/** Cadre proposé par défaut : centré, 70 % de l'image. */
export const DEFAULT_CROP: CropRect = { x: 0.15, y: 0.15, width: 0.7, height: 0.7 };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

/** Déplace le cadre entier (dx, dy en proportions), sans jamais sortir de l'image. */
export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  };
}

/** Tire un coin du cadre ; le coin opposé reste fixe. Taille minimale et
 * bords de l'image toujours respectés. */
export function resizeCrop(crop: CropRect, corner: Corner, dx: number, dy: number): CropRect {
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;

  if (corner === "topLeft" || corner === "bottomLeft") left = clamp(left + dx, 0, right - MIN_CROP);
  else right = clamp(right + dx, left + MIN_CROP, 1);
  if (corner === "topLeft" || corner === "topRight") top = clamp(top + dy, 0, bottom - MIN_CROP);
  else bottom = clamp(bottom + dy, top + MIN_CROP, 1);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Le cadre (proportions de l'image) converti en points écran. */
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

/** Agrandit (facteur > 1) ou réduit le cadre autour de son centre — pour
 * VoiceOver, qui ne peut pas faire glisser les coins. */
export function scaleCrop(crop: CropRect, factor: number): CropRect {
  const width = clamp(crop.width * factor, MIN_CROP, 1);
  const height = clamp(crop.height * factor, MIN_CROP, 1);
  const centerX = crop.x + crop.width / 2;
  const centerY = crop.y + crop.height / 2;
  return {
    x: clamp(centerX - width / 2, 0, 1 - width),
    y: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}
