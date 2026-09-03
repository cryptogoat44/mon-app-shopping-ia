import { env } from "../env.js";

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

/** Interroge Google Lens (via SerpApi) à partir d'une image publiquement
 * accessible et renvoie une liste normalisée de produits candidats. */
export async function searchProductsByImageUrl(imageUrl: string): Promise<VisualMatch[]> {
  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: env.SERPAPI_KEY,
  });

  const response = await fetch(`${SERPAPI_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpApi a répondu ${response.status}`);
  }

  const data = (await response.json()) as SerpApiLensResponse;
  if (data.error) {
    throw new Error(`SerpApi : ${data.error}`);
  }

  const matches = data.visual_matches ?? [];

  return matches
    .filter((match) => match.title && match.link && (match.thumbnail || match.image))
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
