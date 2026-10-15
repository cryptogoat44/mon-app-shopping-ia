import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";
import { isExcludedMerchant, withoutDuplicates } from "./matchFilters.js";
import { CURRENT_LENS_SETTINGS, DEFAULT_LOCALE, type LensSettings, type SearchLocale } from "./lensSettings.js";

export { CURRENT_LENS_SETTINGS, type LensSettings, type SearchLocale };

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

// Réponse de SerpApi lue avec zod (charte, règle 19) : une proposition mal
// formée est écartée, sans faire échouer les autres.
const SERPAPI_VISUAL_MATCH = z.object({
  position: z.number().optional(),
  title: z.string().optional(),
  link: z.string().optional(),
  source: z.string().optional(),
  thumbnail: z.string().optional(),
  image: z.string().optional(),
  price: z.object({ value: z.string().optional(), extracted_value: z.number().optional(), currency: z.string().optional() }).optional(),
});
export type SerpApiVisualMatch = z.infer<typeof SERPAPI_VISUAL_MATCH>;
const SERPAPI_LENS_RESPONSE = z.object({ visual_matches: z.array(z.unknown()).optional(), error: z.string().optional() });

const SERPAPI_ENDPOINT = "https://serpapi.com/search";
// Nombre de propositions gardées (programme, étape 4.A, confirmé par le
// fondateur au Lot S : jusqu'à 30, l'app en montre 12 puis « Voir plus »).
// SerpApi en renvoie ~60, dont beaucoup sans prix.
export const MAX_MATCHES = 30;

// SerpApi lente ou muette ne doit jamais laisser une recherche bloquée en
// "processing" indéfiniment côté mobile.
const SERPAPI_TIMEOUT_MS = 15_000;

/** Un seul appel SerpApi. `query` (texte « Que cherchez-vous ? ») n'est
 * transmis que s'il est rempli : sur une image recadrée il écarte les pièces
 * voisines, mais sur une image entière il avait dégradé le résultat (essais
 * du 2026-09-22 et du 2026-09-24, docs/lot-s-design/README.md). */
export async function callSerpApi(imageUrl: string, settings: LensSettings, query: string | null): Promise<SerpApiVisualMatch[]> {
  const params = new URLSearchParams({ engine: "google_lens", url: imageUrl, type: settings.type, api_key: env.SERPAPI_KEY });
  if (settings.locale) {
    params.set("country", settings.locale.country);
    params.set("hl", settings.locale.hl);
  }
  if (query) params.set("q", query);

  const response = await safeFetch(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
    allowedHosts: ["serpapi.com"],
    signal: AbortSignal.timeout(SERPAPI_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`SerpApi a répondu ${response.status}`);
  }

  const data = SERPAPI_LENS_RESPONSE.safeParse(await response.json().catch(() => null));
  if (!data.success) throw new Error("SerpApi : réponse inattendue");
  // "Google Lens hasn't returned any results" arrive sous forme d'erreur
  // alors que c'est simplement une recherche vide : on la traite comme telle.
  if (data.data.error && !/hasn't returned any results/i.test(data.data.error)) {
    throw new Error(`SerpApi : ${data.data.error}`);
  }
  return (data.data.visual_matches ?? []).flatMap((item) => {
    const match = SERPAPI_VISUAL_MATCH.safeParse(item);
    return match.success ? [match.data] : [];
  });
}

type UsableMatch = SerpApiVisualMatch & { title: string; link: string };

/** Titre, lien et image présents, et un endroit où un particulier peut acheter. */
function isUsable(match: SerpApiVisualMatch): match is UsableMatch {
  return Boolean(match.title && (match.thumbnail || match.image)) && Boolean(match.link) && !isExcludedMerchant(match.link ?? "");
}

// Ce que la base sait ranger (product_matches) : aucun caractère nul, une
// devise de 3 caractères au plus (char(3)), un prix de moins de 100 millions
// (numeric(10,2)). Une valeur étrange n'annule jamais la proposition, ni les
// autres : le texte est nettoyé, le prix retiré (2026-10-15).
const MAX_CURRENCY_CHARACTERS = 3;
const MAX_PRICE = 99_999_999.99;

function withoutNul(text: string | undefined): string | undefined {
  return text?.replace(/\u0000/g, "");
}

function withCleanTexts(match: SerpApiVisualMatch): SerpApiVisualMatch {
  return { ...match, title: withoutNul(match.title), link: withoutNul(match.link), source: withoutNul(match.source), thumbnail: withoutNul(match.thumbnail), image: withoutNul(match.image) };
}

/** Prix et devise rangeables tels quels, sinon aucun prix. */
function storablePrice(price: SerpApiVisualMatch["price"]): Pick<VisualMatch, "priceValue" | "currency"> {
  const value = price?.extracted_value;
  const currency = withoutNul(price?.currency)?.trim() || null;
  const currencyFits = currency === null || [...currency].length <= MAX_CURRENCY_CHARACTERS;
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > MAX_PRICE || !currencyFits) {
    return { priceValue: null, currency: null };
  }
  return { priceValue: value, currency };
}

/** `country` : pays de la recherche, dont le site passe devant quand un
 * marchand propose le même article sur plusieurs sites de pays. */
export function toVisualMatches(matches: SerpApiVisualMatch[], country: string): VisualMatch[] {
  return withoutDuplicates(matches.map(withCleanTexts).filter(isUsable), country)
    .slice(0, MAX_MATCHES)
    // Rang renuméroté APRÈS filtrage : le rang de Google compte aussi les
    // réseaux sociaux écartés, et une liste qui commençait au rang 2 posait
    // problème ailleurs (audit Lot Q, ROB-04).
    .map((match, index) => ({
      rank: index + 1,
      productName: match.title,
      imageUrl: (match.thumbnail ?? match.image)!,
      imageHdUrl: match.image ?? null,
      merchantName: match.source ?? null,
      merchantUrl: match.link,
      ...storablePrice(match.price),
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
  const locale = options.locale ?? DEFAULT_LOCALE;
  const settings: LensSettings = { ...CURRENT_LENS_SETTINGS, locale };
  const matches = toVisualMatches(await callSerpApi(imageUrl, settings, query), locale.country);
  if (matches.length === 0) {
    fastify.log.info({ type: settings.type, withQuery: query !== null }, "Recherche visuelle sans résultat");
  }
  return matches;
}
