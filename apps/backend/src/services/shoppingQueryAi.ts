// Voie C (lot c, 2026-11-02) — l'IA d'Anthropic lit les TITRES des résultats
// Google Lens et écrit une requête courte pour Google Shopping, qui cherche
// la même pièce dans d'autres boutiques. Non utilisé tant que
// VOIE_C_AI_ENABLED n'est pas "true" (consignes à relire par le fondateur :
// services/shoppingQueryInstructions.ts).
//
// Ce qui part chez Anthropic : seulement du TEXTE — les titres et les sites
// des 15 premiers résultats Lens gardés, nettoyés. Jamais d'image (une garde
// le vérifie avant chaque envoi), de prix, de compte ni de mot tapé par la
// personne.
//
// Sécurité : les titres viennent de pages web quelconques et peuvent contenir
// des instructions piégées. Ils sont déclarés comme des données dans les
// consignes, placés entre balises (chevrons retirés : impossible d'en
// sortir), et la réponse n'est jamais suivie : elle est contrôlée ici, sans
// IA (opérateurs de recherche, 2 à 8 mots, chaque mot présent dans un titre,
// marque commune à au moins deux titres…). Au moindre écart : pas de
// recherche Shopping, résultats Lens seuls.
// Rien n'est journalisé ici ; l'appelant ne journalise que des nombres et des
// types d'erreur, jamais la requête, la marque, le modèle ni les titres.
//
// Même façon de faire que services/videoMoments.ts : appel HTTP direct par
// safeFetch (liste blanche d'hôtes), sortie JSON imposée, erreurs typées
// sans contenu. Documentation vérifiée le 2026-11-02 (référence claude-api du
// 2026-10-06) : sur Claude Sonnet 5.5, `thinking: {type: "between_tools"}`
// coupe la réflexion préalable (accepté à l'effort « high » ou moins, sans
// autre champ) ; ni température ni `tool_choice` forcé (400 sur ce modèle).
// Pas de modèle de repli en cas de refus (`fallbacks`) : un refus donne les
// résultats Lens seuls, dans un budget de 3 s. Écart volontaire à la
// recommandation d'Anthropic, décision du fondateur.
import { createHash } from "node:crypto";
import { z } from "zod";
import { SEARCH_QUERY_MAX_LENGTH } from "@monapp/shared-types";
import { allTokensPresent, referenceTokens, sameToken } from "../lib/lightSort.js";
import { safeFetch } from "../lib/safeFetch.js";
import { cacheKey } from "../lib/searchCache.js";
import { wordsOf } from "../lib/wordSort.js";
import type { SearchLocale } from "./lensSettings.js";
import { SHOPPING_QUERY_INSTRUCTIONS } from "./shoppingQueryInstructions.js";

/** Modèle proposé (à confirmer par le fondateur) : Claude Sonnet 5.5, déjà
 * utilisé pour l'analyse des vidéos, 2 $ / 10 $ le million de jetons lus /
 * écrits (≈ 0,25 centime par photo, à vérifier sur la facture). Effort bas,
 * pas de réflexion préalable. Avec claude-haiku-5-5, la réflexion se coupe
 * par `thinking: {type: "disabled"}` (between_tools y est refusé) : la
 * requête construite ici devrait changer. */
export const SHOPPING_QUERY_AI_SETTINGS = { model: "claude-sonnet-5-5", effort: "low", thinking: "between_tools" } as const;

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_HOSTS = ["api.anthropic.com"];
const ANTHROPIC_VERSION = "2023-06-01";
/** Réponse de trois chaînes courtes, sans réflexion. */
const MAX_OUTPUT_TOKENS = 256;

/** Bornes de la requête (règle 7 des consignes, contrôlées ici aussi). */
export const SHOPPING_QUERY_MIN_WORDS = 2;
export const SHOPPING_QUERY_MAX_WORDS = 8;
export const SHOPPING_QUERY_MAX_CHARS = SEARCH_QUERY_MAX_LENGTH;
/** La marque doit figurer dans au moins deux titres (règle 12 stricte). */
const MIN_TITLES_WITH_BRAND = 2;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string" },
    brand: { type: "string" },
    model: { type: "string" },
  },
  required: ["query", "brand", "model"],
  additionalProperties: false,
} as const;

/** Un résultat Lens tel qu'il est envoyé : son titre et son site (nom de
 * domaine ; null s'il manque). */
export interface ShoppingQueryItem {
  title: string;
  site: string | null;
}

/** Requête validée, avec la marque et le modèle lus dans les titres (pour le
 * tri léger) ; jamais journalisés ni enregistrés avec la recherche. */
export interface ShoppingQueryValue {
  query: string;
  brand: string;
  model: string;
}

export interface ShoppingQueryUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Pourquoi aucune requête n'est retenue (réponse normale, pas une panne) :
 * - empty : requête vide (réponse attendue quand les titres ne s'accordent pas) ;
 * - operators : deux-points, mot commençant par « - », OR, AND ou « .. » ;
 * - too_long : hors des bornes, trop courte comme trop longue (2 à 8 mots,
 *   60 caractères au plus) ;
 * - invented : un mot de la requête, ou le modèle, absent des titres ; ou le
 *   modèle absent de la requête ;
 * - brand_not_shared : marque vide, présente dans moins de deux titres, ou
 *   absente de la requête. */
export type ShoppingQueryRejection = "empty" | "invented" | "brand_not_shared" | "too_long" | "operators";

export type ShoppingQueryResult =
  | { kind: "query"; value: ShoppingQueryValue; usage: ShoppingQueryUsage }
  | { kind: "no_query"; reason: ShoppingQueryRejection; usage: ShoppingQueryUsage };

/** Échec de l'appel. Le message ne contient jamais de contenu (ni titre, ni
 * réponse du modèle) : seulement un type et, pour une réponse HTTP, son code. */
export class ShoppingQueryError extends Error {
  constructor(
    public readonly kind: "unavailable" | "refused" | "invalid_output",
    public readonly status: number | null = null
  ) {
    super(`shopping_query_${kind}`);
  }
}

type TextBlock = { type: "text"; text: string };

/** Corps envoyé à l'API Messages : du texte seulement. */
export interface ShoppingQueryRequestBody {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: "user"; content: TextBlock[] }[];
  output_config: { format: { type: "json_schema"; schema: typeof OUTPUT_SCHEMA }; effort: "low" };
  thinking: { type: "between_tools" };
}

export interface AskShoppingQueryOptions {
  apiKey: string;
  /** Délai de l'appel, fixé par l'appelant : min(3 s, temps restant − 4 s). */
  signal: AbortSignal;
  /** Garde « aucune image de la personne », appelée sur le corps avant tout
   * envoi. Le branchement passe aiSwitches.assertNoUserImage ; par défaut,
   * assertTextOnly (plus stricte : tout bloc autre que du texte). */
  assertNoImage?(body: ShoppingQueryRequestBody): void;
}

/** Caractères de contrôle (y compris les caractères invisibles de mise en
 * forme) et chevrons retirés — ils ne pourraient servir qu'à sortir de la
 * balise <resultats_lens> ou à cacher du texte —, espaces resserrés, coupé à
 * `maxChars` caractères. */
function cleanText(text: string, maxChars: number): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}<>]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(flat).slice(0, maxChars).join("").trim();
}

/** Nom de domaine d'une adresse, sans « www. » ; null si l'adresse est illisible. */
export function siteOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

function cleanSite(site: string): string | null {
  const domain = /^https?:\/\//i.test(site.trim()) ? siteOf(site.trim()) : site;
  if (domain === null) return null;
  const cleaned = cleanText(domain, SHOPPING_QUERY_INSTRUCTIONS.maxTitleChars).replace(/^www\./i, "");
  return cleaned === "" ? null : cleaned;
}

/** Ce qui est vraiment envoyé : titres et sites nettoyés, titres vides
 * écartés, les 15 premiers dans l'ordre reçu (celui de Lens). */
function preparedItems(items: readonly ShoppingQueryItem[]): ShoppingQueryItem[] {
  return items
    .map((item) => ({ title: cleanText(item.title, SHOPPING_QUERY_INSTRUCTIONS.maxTitleChars), site: item.site === null ? null : cleanSite(item.site) }))
    .filter((item) => item.title !== "")
    .slice(0, SHOPPING_QUERY_INSTRUCTIONS.maxLensResults);
}

/** Message (rôle « user ») d'après le gabarit des consignes. Remplacements
 * par fonction : un « $& » dans un titre reste du texte. */
function userMessage(items: readonly ShoppingQueryItem[], locale: SearchLocale): string {
  const lines = items
    .map((item, index) => {
      const line = SHOPPING_QUERY_INSTRUCTIONS.resultLine.replace("{rang}", () => String(index + 1)).replace("{titre}", () => item.title);
      return item.site === null ? line.replace(" — {site}", () => "") : line.replace("{site}", () => item.site ?? "");
    })
    .join("\n");
  return SHOPPING_QUERY_INSTRUCTIONS.userTemplate
    .replace("{country}", () => cleanText(locale.country, 8))
    .replace("{hl}", () => cleanText(locale.hl, 8))
    .replace("{resultats}", () => lines);
}

/** Corps de la requête à l'API Messages (fonction pure, testée). */
export function buildShoppingQueryRequest(
  items: readonly ShoppingQueryItem[],
  locale: SearchLocale,
  settings: { model: string } = SHOPPING_QUERY_AI_SETTINGS
): ShoppingQueryRequestBody {
  return {
    model: settings.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SHOPPING_QUERY_INSTRUCTIONS.system,
    messages: [{ role: "user", content: [{ type: "text", text: userMessage(preparedItems(items), locale) }] }],
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA }, effort: SHOPPING_QUERY_AI_SETTINGS.effort },
    thinking: { type: SHOPPING_QUERY_AI_SETTINGS.thinking },
  };
}

/** Garde par défaut : refuse tout bloc qui n'est pas du texte (image,
 * document…). La voie C n'envoie jamais d'image ; une erreur ici est un
 * défaut du code, pas une panne de l'IA. */
export function assertTextOnly(body: { messages: readonly { content: readonly { type: string }[] }[] }): void {
  if (body.messages.some((message) => message.content.some((block) => block.type !== "text"))) {
    throw new Error("shopping_query_non_text_block");
  }
}

/** Clé du cache des requêtes (étape « query ») : version des consignes,
 * modèle, pays, langue et empreinte de ce qui est envoyé (titres et sites
 * nettoyés). Changer les consignes ou le modèle ne ressert jamais une
 * ancienne réponse. */
export function aiInputKey(
  items: readonly ShoppingQueryItem[],
  locale: SearchLocale,
  settings: { version: string; model: string } = { version: SHOPPING_QUERY_INSTRUCTIONS.version, model: SHOPPING_QUERY_AI_SETTINGS.model }
): string {
  const input = createHash("sha256")
    .update(JSON.stringify(preparedItems(items).map((item) => [item.title, item.site])))
    .digest("hex");
  return cacheKey("query", [settings.version, settings.model, locale.country, locale.hl, input]);
}

const apiResponseSchema = z.object({
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

// Trois chaînes ; toute autre propriété fait rejeter la réponse.
const modelOutputSchema = z.object({ query: z.string(), brand: z.string(), model: z.string() }).strict();

/** Apostrophes typographiques ramenées à « ' » (seule gardée). */
const APOSTROPHES = /[‘’ʼ]/g;
/** Deux-points, y compris leurs variantes : « site: », « intitle: »… */
const COLONS = /[:：﹕]/;
/** Ce qui reste d'une requête : lettres, chiffres, espaces et ' - . & + */
const NOT_ALLOWED = /[^\p{L}\p{N}\s'\-.&+]/gu;
/** Tiret ailleurs qu'entre deux lettres ou chiffres (« t-shirt », « X-200 »
 * gardés) : l'exclusion de Google (« -mot »), même cachée derrière ' . & +
 * (« '-mot », « +-mot »). Même règle dans lib/voieC.ts (sanitizeShoppingQuery). */
const LOOSE_HYPHEN = /(?:^|[^\p{L}\p{M}\p{N}])-|-(?:$|[^\p{L}\p{M}\p{N}])/u;

/** Marque ou modèle : même nettoyage que les titres. */
function tidy(text: string): string {
  return cleanText(text.normalize("NFC").replace(APOSTROPHES, "'"), Number.MAX_SAFE_INTEGER);
}

/** Contrôles du serveur, sans IA (fonction pure, testée). `titles` : les
 * titres tels qu'envoyés. */
export function checkShoppingQuery(
  output: ShoppingQueryValue,
  titles: readonly string[]
): { kind: "query"; value: ShoppingQueryValue } | { kind: "no_query"; reason: ShoppingQueryRejection } {
  const reject = (reason: ShoppingQueryRejection) => ({ kind: "no_query" as const, reason });
  const visible = tidy(output.query);
  if (visible === "") return reject("empty");
  if (COLONS.test(visible)) return reject("operators");
  // Guillemets et autres signes retirés ; un tiret isolé n'est qu'un séparateur.
  const words = visible
    .replace(NOT_ALLOWED, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !/^-+$/.test(word));
  if (words.some((word) => LOOSE_HYPHEN.test(word) || word === "OR" || word === "AND" || word.includes(".."))) return reject("operators");
  if (words.length === 0) return reject("empty");
  const query = words.join(" ");
  if (words.length < SHOPPING_QUERY_MIN_WORDS || words.length > SHOPPING_QUERY_MAX_WORDS || Array.from(query).length > SHOPPING_QUERY_MAX_CHARS) {
    return reject("too_long");
  }

  // Chaque mot dans au moins un titre (accents et majuscules ignorés, pluriel toléré).
  const queryTokens = wordsOf(query);
  const titleTokenLists = titles.map((title) => wordsOf(title));
  const inSomeTitle = (token: string) => titleTokenLists.some((tokens) => tokens.some((word) => sameToken(token, word)));
  if (queryTokens.length === 0 || !queryTokens.every(inSomeTitle)) return reject("invented");

  // Marque : non vide, dans au moins deux titres ET dans la requête.
  const brand = tidy(output.brand);
  const brandTokens = referenceTokens(brand);
  if (brand.length > SHOPPING_QUERY_MAX_CHARS || brandTokens.length === 0) return reject("brand_not_shared");
  if (titleTokenLists.filter((tokens) => allTokensPresent(brandTokens, tokens)).length < MIN_TITLES_WITH_BRAND) return reject("brand_not_shared");
  if (!allTokensPresent(brandTokens, queryTokens)) return reject("brand_not_shared");

  // Modèle, s'il est donné : dans au moins un titre ET dans la requête. Fait
  // seulement de signes ou de petits mots : considéré comme non donné.
  const modelTokens = referenceTokens(tidy(output.model));
  const model = modelTokens.length === 0 ? "" : tidy(output.model);
  if (model !== "") {
    if (model.length > SHOPPING_QUERY_MAX_CHARS) return reject("invented");
    if (!titleTokenLists.some((tokens) => allTokensPresent(modelTokens, tokens))) return reject("invented");
    if (!allTokensPresent(modelTokens, queryTokens)) return reject("invented");
  }
  return { kind: "query", value: { query, brand, model } };
}

/** Réponse de l'API → requête validée, ou « aucune requête » et pourquoi.
 * Relève ShoppingQueryError : refus du modèle (« refused ») ; réponse
 * coupée, de forme inattendue ou avec un autre champ (« invalid_output »). */
export function parseShoppingQueryResponse(json: unknown, items: readonly ShoppingQueryItem[]): ShoppingQueryResult {
  const parsed = apiResponseSchema.safeParse(json);
  if (!parsed.success) throw new ShoppingQueryError("invalid_output");
  const response = parsed.data;
  if (response.stop_reason === "refusal") throw new ShoppingQueryError("refused");
  if (response.stop_reason !== "end_turn") throw new ShoppingQueryError("invalid_output");
  const text = response.content.find((block) => block.type === "text")?.text;
  if (text === undefined) throw new ShoppingQueryError("invalid_output");
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    throw new ShoppingQueryError("invalid_output");
  }
  const checked = modelOutputSchema.safeParse(output);
  if (!checked.success) throw new ShoppingQueryError("invalid_output");
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  const titles = preparedItems(items).map((item) => item.title);
  return { ...checkShoppingQuery(checked.data, titles), usage };
}

/** Interroge l'API d'Anthropic (liste blanche d'hôtes, délai fixé par
 * l'appelant). Toute réponse non réussie — limite de dépense (400), trop de
 * requêtes (429), surcharge (529), panne (5xx) —, délai dépassé, annulation
 * ou réseau coupé : ShoppingQueryError("unavailable"), corps abandonné, rien
 * de journalisé. Aucun titre utilisable : « aucune requête », sans appel. */
export async function askShoppingQuery(
  items: readonly ShoppingQueryItem[],
  locale: SearchLocale,
  options: AskShoppingQueryOptions
): Promise<ShoppingQueryResult> {
  if (preparedItems(items).length === 0) return { kind: "no_query", reason: "empty", usage: { inputTokens: 0, outputTokens: 0 } };
  const body = buildShoppingQueryRequest(items, locale);
  if (options.assertNoImage) options.assertNoImage(body);
  else assertTextOnly(body);
  let response: Response;
  try {
    response = await safeFetch(ANTHROPIC_MESSAGES_URL, {
      allowedHosts: ANTHROPIC_HOSTS,
      method: "POST",
      headers: { "x-api-key": options.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch {
    throw new ShoppingQueryError("unavailable");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ShoppingQueryError("unavailable", response.status);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    // Coupé pendant la lecture (délai dépassé) : indisponible, pas invalide.
    throw new ShoppingQueryError(options.signal.aborted ? "unavailable" : "invalid_output");
  }
  return parseShoppingQueryResponse(json, items);
}
