import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";

export interface VisualMatch {
  rank: number;
  productName: string;
  imageUrl: string;
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
const MAX_MATCHES = 8;
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
// la pièce. "type=products" les élimine déjà la plupart du temps, mais le
// repli en "type=all" (voir searchProductsByImageUrl) ne filtre rien par
// lui-même — cette liste s'applique après coup, dans les deux cas, pour ne
// dépendre d'aucun des deux mécanismes.
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

/** Un seul appel SerpApi. `type: null` omet le paramètre "type" (Google
 * Lens retombe alors sur son propre défaut, "all") — c'est le repli utilisé
 * par searchProductsByImageUrl. */
async function callSerpApi(imageUrl: string, locale: SearchLocale, type: string | null): Promise<SerpApiLensResponse> {
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    country: locale.country,
    hl: locale.hl,
    api_key: env.SERPAPI_KEY,
  });
  if (type) params.set("type", type);

  const response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
    allowedHosts: ["serpapi.com"],
    signal: AbortSignal.timeout(SERPAPI_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`SerpApi a répondu ${response.status}`);
  }

  const data = (await response.json()) as SerpApiLensResponse;
  if (data.error) {
    throw new Error(`SerpApi : ${data.error}`);
  }
  return data;
}

function toVisualMatches(matches: SerpApiVisualMatch[]): VisualMatch[] {
  return matches
    .filter(
      (match) => match.title && match.link && (match.thumbnail || match.image) && !isExcludedMerchant(match.link)
    )
    .slice(0, MAX_MATCHES)
    .map((match, index) => ({
      rank: match.position ?? index + 1,
      productName: match.title!,
      imageUrl: (match.thumbnail ?? match.image)!,
      merchantName: match.source ?? null,
      merchantUrl: match.link!,
      priceValue: match.price?.extracted_value ?? null,
      currency: match.price?.currency ?? null,
    }));
}

/** Interroge Google Lens (via SerpApi) à partir d'une image publiquement
 * accessible et renvoie une liste normalisée de produits candidats.
 *
 * Restreint d'abord aux résultats "produit" (`SEARCH_TYPE`). Si cette
 * restriction ne renvoie AUCUN résultat — pièce trop rare pour avoir des
 * correspondances marchandes connues de Google — un seul repli est tenté
 * sans restriction de type. Jamais plus d'un repli : le second appel n'est
 * déclenché que par ce test précis, il n'y a pas de boucle possible même si
 * le repli est lui aussi vide. Chaque repli est journalisé pour surveiller
 * sa fréquence réelle. */
export async function searchProductsByImageUrl(
  fastify: FastifyInstance,
  imageUrl: string,
  locale: SearchLocale = DEFAULT_LOCALE
): Promise<VisualMatch[]> {
  const data = await callSerpApi(imageUrl, locale, SEARCH_TYPE);
  let matches = data.visual_matches ?? [];

  if (matches.length === 0) {
    fastify.log.warn(
      { imageUrl, type: SEARCH_TYPE },
      "SerpApi n'a renvoyé aucun résultat en type=products — repli en type=all (un seul essai)"
    );
    const fallback = await callSerpApi(imageUrl, locale, null);
    matches = fallback.visual_matches ?? [];
  }

  return toVisualMatches(matches);
}
