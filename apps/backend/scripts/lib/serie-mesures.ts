// Mesures de la série : des nombres, des domaines, des devises et des rangs,
// jamais un titre, une adresse complète ni une image (décision du fondateur,
// 2026-10-24). Les réponses de SerpApi sont lues avec zod puis oubliées.
// Logique pure, testée (tests/serieMesure.test.ts).
import { z } from "zod";
import { measureLens, type LensMeasure } from "../../src/services/lensMeasure.js";
import { exclusionReason, withoutDuplicates } from "../../src/services/matchFilters.js";
import { filterVisualMatches, MAX_MATCHES, type LensResponse, type SerpApiVisualMatch } from "../../src/services/visualSearch.js";

/** La règle des prix (décision du fondateur du 21 octobre) : au plus 10
 * propositions avec un prix ajoutées au-delà des 30 gardées. */
export const AJOUTS_MAX = 10;

/** Domaine d'un lien, sans « www. » ; null s'il est illisible. */
export function domaineDe(lien: string | null | undefined): string | null {
  if (!lien) return null;
  try {
    return new URL(lien).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface Ajout {
  rang: number;
  domaine: string;
  devise: string | null;
  /** Image de la proposition, en mémoire seulement (planche) : jamais écrite dans le relevé. */
  vignette: string | null;
}

/** Propositions qu'ajouterait la règle des prix : complètes, ni réseau
 * social ni professionnel, sans doublon, au-delà des 30 gardées, avec un prix. */
export function ajoutsRegleDesPrix(matches: readonly SerpApiVisualMatch[], country: string): Ajout[] {
  const completes = matches.filter((m): m is SerpApiVisualMatch & { title: string; link: string } => Boolean(m.title && m.link && (m.thumbnail || m.image)));
  const achetables = completes.filter((m) => exclusionReason(m.link) === null);
  const uniques = withoutDuplicates(achetables, country);
  return uniques
    .slice(MAX_MATCHES)
    .filter((m) => typeof m.price?.extracted_value === "number")
    .slice(0, AJOUTS_MAX)
    .map((m, index) => ({ rang: m.position ?? MAX_MATCHES + index + 1, domaine: domaineDe(m.link) ?? "?", devise: m.price?.currency?.trim().slice(0, 8) ?? null, vignette: m.thumbnail ?? null }));
}

export interface MesureLens {
  mesure: LensMeasure;
  /** Domaines des propositions gardées, dans l'ordre (répétabilité, comparaison avec le lien marchand). */
  domainesGardes: string[];
  ajouts: Ajout[];
}

/** Mesure d'une réponse de Google Lens, avec les filtres et la mesure du serveur. */
export function mesurerLens(reponse: LensResponse, country: string): MesureLens {
  const { matches, counts } = filterVisualMatches(reponse, country);
  return {
    mesure: measureLens(reponse, counts, matches, country),
    domainesGardes: matches.map((m) => domaineDe(m.merchantUrl) ?? "?"),
    ajouts: ajoutsRegleDesPrix(reponse.matches, country),
  };
}

/** Mots qui comptent dans une recherche par texte (3 lettres ou plus, sans accent). */
export function motsSignificatifs(texte: string): string[] {
  return [...new Set(sansAccent(texte).split(/[^a-z0-9]+/).filter((mot) => mot.length >= 3))];
}

function sansAccent(texte: string): string {
  return texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const RESULTAT_SHOPPING = z.object({
  title: z.string().optional(),
  source: z.string().optional(),
  price: z.string().optional(),
  extracted_price: z.number().optional(),
  product_id: z.string().optional(),
  immersive_product_page_token: z.string().optional(),
});
const REPONSE_SHOPPING = z.object({ shopping_results: z.array(z.unknown()).optional() }).passthrough();

/** Produit choisi pour le lien marchand : en mémoire seulement, jamais relevé. */
export interface ProduitChoisi {
  productId: string | null;
  pageToken: string | null;
}

export interface MesureShopping {
  mesures: Record<string, number>;
  produit: ProduitChoisi | null;
}

const enEuros = (prix: string | undefined): boolean => Boolean(prix && /€|EUR/.test(prix));

/** Mesure d'une réponse de Google Shopping Light : nombres seulement. La
 * pertinence compte, en mémoire, les titres qui contiennent au moins un mot
 * de la recherche (garde-fou contre les résultats « empoisonnés »). */
export function mesurerShopping(json: unknown, texte: string): MesureShopping | null {
  const lu = REPONSE_SHOPPING.safeParse(json);
  if (!lu.success) return null;
  const resultats = (lu.data.shopping_results ?? []).flatMap((r) => {
    const un = RESULTAT_SHOPPING.safeParse(r);
    return un.success ? [un.data] : [];
  });
  const mots = motsSignificatifs(texte);
  const pertinents = resultats.filter((r) => mots.some((mot) => sansAccent(r.title ?? "").includes(mot))).length;
  const premier = resultats.find((r) => r.product_id || r.immersive_product_page_token);
  return {
    mesures: {
      resultats: resultats.length,
      avecPrix: resultats.filter((r) => typeof r.extracted_price === "number").length,
      enEuros: resultats.filter((r) => enEuros(r.price)).length,
      marchandsDistincts: new Set(resultats.map((r) => r.source).filter(Boolean)).size,
      pertinents,
    },
    produit: premier ? { productId: premier.product_id ?? null, pageToken: premier.immersive_product_page_token ?? null } : null,
  };
}

/** Pertinence douteuse : une minorité de résultats contient un mot de la recherche. */
export function pertinenceDouteuse(mesures: Record<string, number>): boolean {
  return (mesures.resultats ?? 0) > 0 && (mesures.pertinents ?? 0) * 2 < (mesures.resultats ?? 0);
}

const BOUTIQUE = z.object({ link: z.string().optional(), price: z.string().optional(), extracted_price: z.number().optional() });
const REPONSE_BOUTIQUES = z.object({ product_results: z.object({ stores: z.array(z.unknown()).optional() }).passthrough().optional(), stores: z.array(z.unknown()).optional() }).passthrough();

export interface MesureMarchand {
  mesures: Record<string, number | string[] | null>;
  /** Liens des boutiques, en mémoire seulement (vérification du lien), jamais relevés. */
  liens: string[];
}

/** Mesure des boutiques d'un produit (Immersive Product ou Google Product).
 * `domainesLens` : null si Google Lens n'a pas encore été mesuré pour la
 * pièce (lot 10 en premier) ; la comparaison se fait alors dans le rapport. */
export function mesurerBoutiques(json: unknown, domainesLens: readonly string[] | null): MesureMarchand | null {
  const lu = REPONSE_BOUTIQUES.safeParse(json);
  if (!lu.success) return null;
  const brutes = lu.data.stores ?? lu.data.product_results?.stores ?? [];
  const boutiques = brutes.flatMap((b) => {
    const une = BOUTIQUE.safeParse(b);
    return une.success ? [une.data] : [];
  });
  const domaines = boutiques.map((b) => domaineDe(b.link)).filter((d): d is string => d !== null);
  const directs = domaines.filter((d) => !/(^|\.)google\./.test(d));
  return {
    mesures: {
      boutiques: boutiques.length,
      liensDirects: directs.length,
      domainesFrEu: directs.filter((d) => /\.(fr|eu)$/.test(d)).length,
      prixEnEuros: boutiques.filter((b) => enEuros(b.price)).length,
      communsAvecLens: domainesLens ? new Set(directs.filter((d) => domainesLens.includes(d))).size : null,
      domaines: [...new Set(directs)].slice(0, 30),
    },
    liens: boutiques.map((b) => b.link).filter((l): l is string => Boolean(l)),
  };
}

/** Part de domaines communs entre deux listes (répétabilité, 0 à 1). */
export function partCommune(a: readonly string[], b: readonly string[]): number {
  const ea = new Set(a);
  const eb = new Set(b);
  const union = new Set([...ea, ...eb]);
  if (union.size === 0) return 1;
  return [...ea].filter((d) => eb.has(d)).length / union.size;
}
