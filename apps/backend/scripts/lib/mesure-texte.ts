// Règles de la mesure de l'effet du texte « Que cherchez-vous ? » sur Google
// Lens (lot 4 ter, demande du fondateur, 2026-10-08). Logique pure, testée
// (tests/mesureTexte.test.ts).
import { z } from "zod";
import { CURRENT_LENS_SETTINGS } from "../../src/services/lensSettings.js";
import type { Essai } from "./essai-photo.js";

/** Plafond fixé par le fondateur pour toute la mesure. */
export const CREDITS_MESURE_MAX = 12;

/** Page d'état publique de SerpApi (format lisible par un programme, sans clé ni crédit). */
export const ETAT_SERPAPI = "https://status.serpapi.com/api/v2/components.json";
/** Page d'état injoignable, ou « Lens API » absente : comme une panne — aucun crédit dépensé. */
export const ETAT_ILLISIBLE = "illisible";
const COMPOSANTS = z.object({ components: z.array(z.object({ name: z.string(), status: z.string() })) });

/** État de « Lens API » d'après la page d'état (ex. « operational », « degraded_performance »), ou null.
 * Le 2026-10-08, une mesure lancée pendant un incident n'a rendu que des zéros et
 * un dépassement de délai : aucun crédit n'est plus dépensé si l'état n'est pas « operational ». */
export function etatLens(json: unknown): string | null {
  const lu = COMPOSANTS.safeParse(json);
  return lu.success ? (lu.data.components.find((c) => c.name === "Lens API")?.status ?? null) : null;
}

/** Une pièce : une photo, ou une vidéo et l'instant choisi ; la zone du
 * vêtement (visage exclu, contrôlé avant) ; les mots tapés. */
export const PIECE = z
  .object({
    nom: z.string().regex(/^[a-z0-9-]+$/),
    texte: z.string().trim().min(2),
    zone: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    image: z.string().min(1).optional(),
    video: z.string().min(1).optional(),
    seconde: z.number().nonnegative().optional(),
  })
  .refine((p) => (p.image ? !p.video && p.seconde === undefined : Boolean(p.video) && p.seconde !== undefined), "Une image, ou une vidéo et l'instant (seconde).");
export type Piece = z.infer<typeof PIECE>;

const essai = (numero: number, titre: string, texte: string | null): Essai => ({ numero, titre, zone: "vetement", texte, reglages: CURRENT_LENS_SETTINGS });

/** Les deux recherches de chaque pièce : le cadre seul, puis le cadre et le texte. */
export function essaisDeBase(piece: Piece): [Essai, Essai] {
  return [essai(1, `${piece.nom} : cadre seul (1 crédit)`, null), essai(2, `${piece.nom} : cadre + « ${piece.texte} » (1 crédit)`, piece.texte)];
}

/** Forte divergence entre deux recherches (propositions gardées par Spotto) :
 * l'une vide et l'autre avec au moins 5 propositions, ou au moins deux fois
 * plus d'un côté, avec au moins 10 d'écart. */
export function divergenceForte(a: number, b: number): boolean {
  const [petit, grand] = a <= b ? [a, b] : [b, a];
  if (petit === 0) return grand >= 5;
  return grand >= 2 * petit && grand - petit >= 10;
}

/** Troisième recherche, seulement en cas de forte divergence : on refait la
 * plus pauvre des deux (Google Lens varie d'un appel à l'autre). */
export function troisiemeEssai(piece: Piece, sansTexte: number, avecTexte: number): Essai {
  const refaireTexte = avecTexte <= sansTexte;
  return essai(3, `${piece.nom} : ${refaireTexte ? `cadre + « ${piece.texte} »` : "cadre seul"}, une seconde fois (1 crédit)`, refaireTexte ? piece.texte : null);
}

/** Valeur retenue pour une condition recherchée plusieurs fois : la moyenne. */
export function moyenne(valeurs: number[]): number {
  return valeurs.length === 0 ? 0 : valeurs.reduce((somme, v) => somme + v, 0) / valeurs.length;
}

/** Le texte « réduit nettement » les résultats (au moins deux fois moins de
 * propositions gardées) ou les vide. */
export function texteNuisible(sansTexte: number, avecTexte: number): boolean {
  return avecTexte === 0 ? sansTexte > 0 : avecTexte * 2 <= sansTexte;
}

/** Règle du fondateur : texte nuisible dans au moins la moitié des pièces →
 * on cesse de l'envoyer à Google Lens ; sinon on le garde. */
export function decision(pieces: readonly { sansTexte: number; avecTexte: number }[]): "cesser" | "garder" {
  const nuisibles = pieces.filter((p) => texteNuisible(p.sansTexte, p.avecTexte)).length;
  return nuisibles * 2 >= pieces.length ? "cesser" : "garder";
}
