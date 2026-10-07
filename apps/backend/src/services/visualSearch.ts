import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { safeFetch } from "../lib/safeFetch.js";
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

// Même page produit = même proposition, même si Google la renvoie deux fois
// (seul le fragment « # » diffère parfois).
function linkKey(link: string): string {
  return link.split("#")[0]!.replace(/\/$/, "");
}
// SerpApi lente ou muette ne doit jamais laisser une recherche bloquée en
// "processing" indéfiniment côté mobile.
const SERPAPI_TIMEOUT_MS = 15_000;

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

export function isExcludedMerchant(link: string): boolean {
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

export function toVisualMatches(matches: SerpApiVisualMatch[]): VisualMatch[] {
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
  const settings: LensSettings = { ...CURRENT_LENS_SETTINGS, locale: options.locale ?? DEFAULT_LOCALE };
  const matches = toVisualMatches(await callSerpApi(imageUrl, settings, query));
  if (matches.length === 0) {
    fastify.log.info({ type: settings.type, withQuery: query !== null }, "Recherche visuelle sans résultat");
  }
  return matches;
}
