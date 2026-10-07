// Plans des essais photo du lot 4 ter, au plus 4 crédits SerpApi par passage,
// chacun annoncé : « nike » (étape 2, 2026-10-07, gardé pour mémoire) et
// « texte » (effet du texte « Que cherchez-vous ? », 2026-10-08). Logique pure,
// testée (tests/essaiPhoto.test.ts).
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

/** Plafond par passage (accord du fondateur) : un crédit par essai. */
export const CREDITS_MAX = 4;

/** Plan « texte » (demande du fondateur, 2026-10-08) : photo SANS personne
 * identifiable, cadrée sur le vêtement ; sans texte, puis avec le texte deux
 * fois (Google Lens varie d'un appel à l'autre). 3 crédits par photo. */
export function essaisTexte(texte: string): readonly Essai[] {
  const mots = texte.trim();
  if (mots.length < 2) throw new Error('Plan « texte » : indiquez le texte (--texte "…").');
  const avecTexte = { zone: "vetement", texte: mots, reglages: CURRENT_LENS_SETTINGS } as const;
  return [
    { numero: 1, titre: "zone du vêtement, sans texte (1 crédit)", zone: "vetement", texte: null, reglages: CURRENT_LENS_SETTINGS },
    { numero: 2, titre: `zone du vêtement + « ${mots} » (1 crédit)`, ...avecTexte },
    { numero: 3, titre: `zone du vêtement + « ${mots} », une seconde fois (1 crédit)`, ...avecTexte },
  ];
}

export function planEssais(plan: string | null, texte: string | null): readonly Essai[] {
  if (plan === "nike") return ESSAIS;
  if (plan === "texte") return essaisTexte(texte ?? "");
  throw new Error("Indiquez le plan : --plan nike (étape 2) ou --plan texte (effet du texte).");
}

/** Structure d'une réponse de SerpApi : ses rubriques et leur taille, jamais
 * leur contenu — seuls l'état et le message d'erreur, écrits par SerpApi, sont
 * repris. Montre si des propositions sont arrivées ailleurs que dans
 * « visual_matches », la seule rubrique lue par l'app. */
export interface Structure {
  rubriques: Record<string, number | "objet" | "texte" | "autre">;
  etat: string | null;
  erreur: string | null;
}

export function structureReponse(json: unknown): Structure {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { rubriques: {}, etat: null, erreur: "réponse illisible" };
  const rubriques: Structure["rubriques"] = {};
  for (const [cle, valeur] of Object.entries(json)) {
    rubriques[cle] = Array.isArray(valeur) ? valeur.length : typeof valeur === "object" && valeur !== null ? "objet" : typeof valeur === "string" ? "texte" : "autre";
  }
  const meta: unknown = Reflect.get(json, "search_metadata");
  const etat: unknown = typeof meta === "object" && meta !== null ? Reflect.get(meta, "status") : null;
  const erreur: unknown = Reflect.get(json, "error");
  return { rubriques, etat: typeof etat === "string" ? etat : null, erreur: typeof erreur === "string" ? erreur : null };
}

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
  /** Structure de la réponse de SerpApi (rubriques et tailles). */
  structure: Structure | null;
}

/** Zone en proportions de l'image, contrôlée (dans l'image, assez grande). */
export function analyserZone(zone: CropRect): CropRect {
  const { x, y, width, height } = zone;
  const ok = [x, y, width, height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1) && width >= 0.05 && height >= 0.05 && x + width <= 1.0001 && y + height <= 1.0001;
  if (!ok) throw new Error("Zone invalide : quatre nombres entre 0 et 1 (x, y, largeur, hauteur), dans l'image.");
  return zone;
}
