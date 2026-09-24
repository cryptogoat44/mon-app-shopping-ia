import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";

export interface VisualMatch {
  rank: number;
  productName: string;
  /** Petite vignette hébergée par Google — toujours présente, sert de repli. */
  imageUrl: string;
  /** Image originale du marchand (haute définition), quand fournie. */
  imageHdUrl: string | null;
  merchantName: string | null;
  merchantUrl: string;
  priceValue: number | null;
  currency: string | null;
}

interface SerpApiPrice {
  value?: string;
  extracted_value?: number;
  currency?: string;
}

interface SerpApiVisualMatch {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  image?: string;
  price?: SerpApiPrice;
}

interface SerpApiLensResponse {
  visual_matches?: SerpApiVisualMatch[];
  error?: string;
}

const SERPAPI_ENDPOINT = "https://serpapi.com/search";
// Nombre de propositions gardées (programme, étape 4.A, confirmé par le
// fondateur au Lot S : jusqu'à 30, l'app en montre 12 puis « Voir plus »).
// SerpApi en renvoie ~60, dont beaucoup sans prix.
export const MAX_MATCHES = 30;

// Même page produit = même proposition, même si Google la renvoie deux fois
// (seul le fragment « # » diffère parfois).
function linkKey(link: string): string {
  return link.split("#")[0]!.replace(/\/$/, "");
}
// SerpApi lente ou muette ne doit jamais laisser une recherche bloquée en
// "processing" indéfiniment côté mobile.
const SERPAPI_TIMEOUT_MS = 15_000;

// --- Configuration de la recherche visuelle ---------------------------
//
// Comparée empiriquement à "type=all" (le comportement précédent) avant
// d'être adoptée : sur un cas de test réel, "products" a fait passer la
// part de résultats avec un vrai prix marchand de 16/60 à 20/60 et a
// éliminé tous les résultats de réseaux sociaux (11/60 → 0/60), à
// condition d'être combiné à la localisation ci-dessous — sans elle, le
// premier résultat était une mauvaise marque. Voir docs/journal-decisions.md,
// 2026-09-22.
/** Restreint Google Lens aux résultats qu'il classe "produit" (prix, lien
 * marchand) plutôt qu'à toute image simplement ressemblante. */
const SEARCH_TYPE = "products";

export interface SearchLocale {
  /** Code pays à deux lettres (ex. "fr", "us") — paramètre `country` de SerpApi. */
  country: string;
  /** Code langue (ex. "fr", "en") — paramètre `hl` de SerpApi. */
  hl: string;
}

/** Localisation par défaut des recherches visuelles, fixée en dur tant
 * qu'elle n'est pas branchée sur la langue/le pays réels de l'utilisateur
 * (prévu au Lot 3 — voir docs/points-de-vigilance.md). Le paramètre
 * `locale` de `searchProductsByImageUrl` existe déjà pour que ce
 * branchement futur n'ait pas besoin de toucher ce fichier : il suffira
 * d'appeler la fonction avec la locale réelle de l'utilisateur au lieu de
 * laisser la valeur par défaut. */
const DEFAULT_LOCALE: SearchLocale = { country: "fr", hl: "fr" };

// Un lien vers une simple publication n'est jamais un endroit où acheter
// la pièce. "type=products" les élimine déjà la plupart du temps ; cette
// liste s'applique en plus, après coup, pour ne pas en dépendre.
const EXCLUDED_MERCHANT_DOMAINS = [
  "tiktok.com",
  "instagram.com",
  "pinterest.",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "twitter.com",
  "x.com",
];

function isExcludedMerchant(link: string): boolean {
  let host: string;
  try {
    host = new URL(link).hostname.toLowerCase();
  } catch {
    return false;
  }
  return EXCLUDED_MERCHANT_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Un seul appel SerpApi. `query` (texte « Que cherchez-vous ? ») n'est
 * transmis que s'il est rempli : sur une image recadrée il écarte les pièces
 * voisines, mais sur une image entière il avait dégradé le résultat (essais
 * du 2026-09-22 et du 2026-09-24, docs/lot-s-design/README.md). */
async function callSerpApi(imageUrl: string, locale: SearchLocale, query: string | null): Promise<SerpApiLensResponse> {
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    country: locale.country,
    hl: locale.hl,
    type: SEARCH_TYPE,
    api_key: env.SERPAPI_KEY,
  });
  if (query) params.set("q", query);

  const response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
    allowedHosts: ["serpapi.com"],
    signal: AbortSignal.timeout(SERPAPI_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`SerpApi a répondu ${response.status}`);
  }

  const data = (await response.json()) as SerpApiLensResponse;
  // "Google Lens hasn't returned any results" arrive sous forme d'erreur
  // alors que c'est simplement une recherche vide : on la traite comme telle.
  if (data.error && !/hasn't returned any results/i.test(data.error)) {
    throw new Error(`SerpApi : ${data.error}`);
  }
  return data;
}

function toVisualMatches(matches: SerpApiVisualMatch[]): VisualMatch[] {
  const seen = new Set<string>();
  return matches
    .filter(
      (match) => match.title && match.link && (match.thumbnail || match.image) && !isExcludedMerchant(match.link)
    )
    .filter((match) => {
      const key = linkKey(match.link!);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MATCHES)
    // Rang renuméroté APRÈS filtrage : le rang de Google compte aussi les
    // réseaux sociaux écartés, et une liste qui commençait au rang 2 posait
    // problème ailleurs (audit Lot Q, ROB-04).
    .map((match, index) => ({
      rank: index + 1,
      productName: match.title!,
      imageUrl: (match.thumbnail ?? match.image)!,
      imageHdUrl: match.image ?? null,
      merchantName: match.source ?? null,
      merchantUrl: match.link!,
      priceValue: match.price?.extracted_value ?? null,
      currency: match.price?.currency ?? null,
    }));
}

export interface VisualSearchOptions {
  /** Texte « Que cherchez-vous ? » — ignoré s'il est vide. */
  query?: string | null;
  locale?: SearchLocale;
}

/** Interroge Google Lens (via SerpApi) à partir d'une image publiquement
 * accessible et renvoie une liste normalisée de produits candidats.
 *
 * Exactement UN appel SerpApi (1 crédit), jamais de repli : l'ancien repli
 * en type=all doublait le coût de chaque échec pour un résultat
 * généralement aussi vide sur une image non recadrée (Lot S, décision du
 * fondateur). Un échec se traite désormais en recadrant, pas en relançant. */
export async function searchProductsByImageUrl(
  fastify: FastifyInstance,
  imageUrl: string,
  options: VisualSearchOptions = {}
): Promise<VisualMatch[]> {
  const query = options.query?.trim() || null;
  const data = await callSerpApi(imageUrl, options.locale ?? DEFAULT_LOCALE, query);
  const matches = toVisualMatches(data.visual_matches ?? []);
  if (matches.length === 0) {
    fastify.log.info({ type: SEARCH_TYPE, withQuery: query !== null }, "Recherche visuelle sans résultat");
  }
  return matches;
}
