// Plan de la série de mesure sans nouvelles photos (décisions du fondateur,
// 2026-10-24) : lots 10, 2, 3, 9, 11 et 7, 46 recherches au plus, sous une
// seule autorisation tapée. Le lot 12 (description par l'IA) n'en fait pas
// partie. Logique pure, testée (tests/serieMesure.test.ts).
import { z } from "zod";
import type { SearchLocale } from "../../src/services/lensSettings.js";
import { PIECE, type Piece } from "./mesure-texte.js";

/** Phrase que le fondateur tape à la main pour toute la série. */
export const PHRASE_SERIE = "OK série sans nouvelles photos : lots 2, 3, 7, 9, 10 et 11, 46 recherches au plus";
/** Recherches couvertes par cette phrase. */
export const AUTORISATION_SERIE = 46;

/** Les pièces de la série (zones du 8 octobre, sous le menton). */
export const PIECES_SERIE = ["maillot-nike", "veste-bleu-marine", "tshirt-blanc", "pull-blanc", "pull-noir"] as const;
export type NomPiece = (typeof PIECES_SERIE)[number];

const FRANCE: SearchLocale = { country: "fr", hl: "fr" };
const SUISSE: SearchLocale = { country: "ch", hl: "fr" };
const ROYAUME_UNI: SearchLocale = { country: "gb", hl: "en" };

/** Image envoyée à Google Lens : au moment choisi le 8 octobre ; la plus
 * nette à moins d'une demi-seconde ; ou découpée avant la réduction. */
export type SourceImage = "moment" | "plus-nette" | "pleine-definition";

export type EtapeSerie =
  | { numero: number; lot: number; service: "lens"; piece: NomPiece; image: SourceImage; texte: boolean; locale: SearchLocale; sansCache: boolean; planche: boolean }
  | { numero: number; lot: 10; service: "shopping"; piece: NomPiece }
  | { numero: number; lot: 10; service: "immersive" | "product"; piece: NomPiece };

type SansNumero<T> = T extends unknown ? Omit<T, "numero"> : never;
type Brouillon = SansNumero<EtapeSerie>;

const lens = (lot: number, piece: NomPiece, options: Partial<{ image: SourceImage; texte: boolean; locale: SearchLocale; sansCache: boolean }> = {}): Brouillon => ({
  lot,
  service: "lens",
  piece,
  image: options.image ?? "moment",
  texte: options.texte ?? false,
  locale: options.locale ?? FRANCE,
  sansCache: options.sansCache ?? false,
  // Planches des propositions qu'ajouterait la règle des prix : lots 2 et 3 seulement (décision du fondateur).
  planche: lot === 2 || lot === 3,
});

/** Lot 10 : les 2 pièces dont un produit de Google Shopping Light est
 * demandé aux deux API du lien marchand (même produit, 2 × 2 recherches). */
export const PIECES_LIEN_MARCHAND: readonly NomPiece[] = ["maillot-nike", "veste-bleu-marine"];

function lot10(): Brouillon[] {
  const etapes: Brouillon[] = [];
  // Le produit passe d'un appel à l'autre en mémoire seulement : les deux API
  // suivent tout de suite la recherche de sa pièce.
  for (const piece of PIECES_LIEN_MARCHAND) {
    etapes.push({ lot: 10, service: "shopping", piece }, { lot: 10, service: "immersive", piece }, { lot: 10, service: "product", piece });
  }
  for (const piece of PIECES_SERIE.filter((p) => !PIECES_LIEN_MARCHAND.includes(p))) etapes.push({ lot: 10, service: "shopping", piece });
  return etapes;
}

/** Les 46 étapes, dans l'ordre : le lot 10 d'abord (recherche par texte et
 * liens marchands, qui répond au problème des prix — décision du fondateur,
 * 2026-10-24), puis les lots Google Lens 2, 3, 9, 11 et 7. */
export function planSerie(): EtapeSerie[] {
  const brouillons: Brouillon[] = [
    ...lot10(),
    // Lot 2 : image seule ; le pull blanc, puis une seconde mesure des 5 pièces.
    lens(2, "pull-blanc"),
    ...PIECES_SERIE.map((p) => lens(2, p)),
    // Lot 3 : image et mots du 8 octobre, 2 mesures par pièce.
    ...PIECES_SERIE.flatMap((p) => [lens(3, p, { texte: true }), lens(3, p, { texte: true })]),
    // Lot 9 : répétabilité, sans le cache de SerpApi.
    ...(["veste-bleu-marine", "maillot-nike"] as const).flatMap((p) => Array.from({ length: 4 }, () => lens(9, p, { sansCache: true }))),
    // Lot 11 : image plus nette, puis cadre en pleine définition (vidéos en haute définition).
    ...(["veste-bleu-marine", "tshirt-blanc", "pull-noir"] as const).map((p) => lens(11, p, { image: "plus-nette" })),
    ...(["pull-blanc", "pull-noir"] as const).map((p) => lens(11, p, { image: "pleine-definition" })),
    // Lot 7 : pays et devise.
    ...(["veste-bleu-marine", "tshirt-blanc", "maillot-nike", "pull-noir"] as const).flatMap((p) => [lens(7, p, { locale: SUISSE }), lens(7, p, { locale: ROYAUME_UNI })]),
  ];
  return brouillons.map((etape, index): EtapeSerie => ({ ...etape, numero: index + 1 }));
}

/** Les pièces du fichier du 8 octobre, réduites aux 5 de la série. */
export function piecesDeSerie(json: unknown): Map<NomPiece, Piece> {
  const pieces = z.array(PIECE).parse(json);
  const trouvees = new Map<NomPiece, Piece>();
  for (const nom of PIECES_SERIE) {
    const piece = pieces.find((p) => p.nom === nom);
    if (!piece) throw new Error(`Pièce absente du fichier des pièces : ${nom}.`);
    trouvees.set(nom, piece);
  }
  return trouvees;
}

/** Titre court d'une étape, pour l'écran et le relevé (jamais de contenu). */
export function titreEtape(etape: EtapeSerie): string {
  if (etape.service === "shopping") return `lot 10 · ${etape.piece} · Google Shopping Light, texte seul`;
  if (etape.service !== "lens") return `lot 10 · ${etape.piece} · lien marchand (${etape.service === "immersive" ? "Immersive Product" : "Google Product"})`;
  const details = [etape.texte ? "image et mots" : "image seule", etape.image !== "moment" ? etape.image : null, etape.locale.country !== "fr" ? `${etape.locale.country}/${etape.locale.hl}` : null, etape.sansCache ? "sans cache" : null];
  return `lot ${etape.lot} · ${etape.piece} · ${details.filter(Boolean).join(", ")}`;
}
