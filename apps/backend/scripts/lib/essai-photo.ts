// Plan des essais de l'étape 2 du lot 4 ter (photo du t-shirt Nike) : au plus
// 4 crédits SerpApi, chacun annoncé. Logique pure, testée (tests/essaiPhoto.test.ts).
import { DEFAULT_CROP, type CropRect } from "@monapp/shared-types";
import { CURRENT_LENS_SETTINGS, PREVIOUS_LENS_SETTINGS, type LensSettings } from "../../src/services/lensSettings.js";

/** Zone analysée par l'app pour une photo qu'on ne recadre pas. */
export const ZONE_APP: CropRect = DEFAULT_CROP;

export interface Essai {
  numero: number;
  titre: string;
  /** « app » : zone de l'app ; « vetement » : zone du vêtement, tracée à la main. */
  zone: "app" | "vetement";
  texte: string | null;
  reglages: LensSettings;
}

// Pas de cadrage par l'IA d'Anthropic : la photo montre le visage d'un tiers,
// qui ne part pas chez un nouveau prestataire (décision du fondateur, 2026-10-07).
export const ESSAIS: readonly Essai[] = [
  { numero: 1, titre: "comme l'app aujourd'hui : zone centrale, sans texte, réglages actuels (1 crédit)", zone: "app", texte: null, reglages: CURRENT_LENS_SETTINGS },
  { numero: 2, titre: "zone du vêtement, sans texte, réglages actuels (1 crédit)", zone: "vetement", texte: null, reglages: CURRENT_LENS_SETTINGS },
  { numero: 3, titre: "zone du vêtement + « t-shirt Nike noir », réglages actuels (1 crédit)", zone: "vetement", texte: "t-shirt Nike noir", reglages: CURRENT_LENS_SETTINGS },
  { numero: 4, titre: "comme l'essai 1, avec les réglages d'avant le 22 septembre : type « all », sans localisation (1 crédit)", zone: "app", texte: null, reglages: PREVIOUS_LENS_SETTINGS },
];

/** Crédits SerpApi du plan : un par essai. */
export const CREDITS_SERPAPI = ESSAIS.length;

export interface Resultat {
  essai: Essai;
  /** Résultats renvoyés par Google Lens. */
  brutes: number;
  /** Dont réseaux sociaux (écartés par Spotto). */
  reseauxSociaux: number;
  /** Gardés par Spotto (filtres, doublons, 30 au plus). */
  gardees: number;
  avecPrix: number;
  premiers: string[];
}

/** Zone en proportions de l'image, contrôlée (dans l'image, assez grande). */
export function analyserZone(zone: CropRect): CropRect {
  const { x, y, width, height } = zone;
  const ok = [x, y, width, height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && width >= 0.05 && height >= 0.05 && x + width <= 1.0001 && y + height <= 1.0001;
  if (!ok) throw new Error("Zone invalide : quatre nombres entre 0 et 1 (x, y, largeur, hauteur), dans l'image.");
  return zone;
}
