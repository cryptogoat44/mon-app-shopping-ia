// Empreinte « même pièce » des alertes prix et stock (lot 2, migration 0036 ;
// nouvelle version, migration 0041), sans aucun accès au réseau ni à la base.
// Règle du fondateur : même pièce = même lien de boutique, jamais par le
// titre ni par l'image ; dans le doute, pas d'empreinte, donc pas d'alerte.
//
// L'empreinte est le SHA-256 du lien DE LA BOUTIQUE normalisé (alertKeyString) :
// - « https » imposé (http et https donnent la même pièce) ;
// - hôte en minuscules, sans UN « www. » de tête (m., fr., www2. gardés) ;
// - chemin tel quel (casse comprise), sans fragment « # » ni « / » final ;
// - paramètres de suivi retirés : « utm_… » et TOUTE la liste fermée
//   TRACKING_PARAMS (services/matchFilters.ts, choix du fondateur) ;
// - tous les autres paramètres gardés, valeurs vides comprises, triés par nom
//   puis par valeur. Principe : garder un paramètre ne peut coûter qu'une
//   alerte manquée ; en retirer un pourrait créer une fausse alerte (variante
//   de couleur, taille).
// Aucune empreinte pour un résultat sans lien direct vers la boutique (une
// page de Google seulement, isGoogleLink) : jamais d'alerte pour lui (l'ancienne
// clé « page de Google + productid » de 0036 n'existe plus).
// Aucune empreinte non plus pour : les places de marché (Amazon, Farfetch,
// Etsy, Temu, DHgate, eBay, Vinted, toutes extensions, leurs liens courts
// comme amzn.to ou a.co, et toute proposition dont la BOUTIQUE est l'une
// d'elles : chez elles le prix affiché change avec le vendeur), les liens de
// redirection (raccourcisseurs, liens d'affiliation, adresse dans un
// paramètre), les pages de liste, de recherche ou de catégorie (accueil,
// /search, ?q=…, ?page=…, /collections/… ou /category/… sans segment de
// produit), et toute adresse que les filtres des résultats écartent déjà
// (exclusionReason). Une page de liste montre le prix d'une autre pièce à
// chaque fois : dans le doute, aucune empreinte (au pire une alerte manquée).
// Une liste sans aucun de ces repères (« /femme/vestes ») ne peut pas être
// reconnue sans écarter aussi de vraies pages de produit : elle garde la sienne.
//
// La base ne garde que l'empreinte (match_key_hash), jamais le lien. Le nom
// de la boutique normalisé (merchantKey) est gardé à part : deux
// observations de la même empreinte ne valent que si leurs boutiques sont
// les mêmes quand les deux en ont une.
import { createHash } from "node:crypto";
import { exclusionReason, isGoogleLink, isTrackingParam, siteOf } from "../services/matchFilters.js";

/** Version des empreintes : à changer avec les règles ci-dessous (le script
 * de rattrapage recalcule alors les empreintes des envies). 2 : le lien
 * normalisé de la boutique (migration 0041), plus aucune clé « page de Google ». */
export const ALERT_KEY_VERSION = 2;

/** Places de marché exclues (décision 4 du fondateur), reconnues par le nom
 * du site quelle que soit l'extension (amazon.fr, amazon.com.be, ebay.co.uk…),
 * et par le nom de la boutique (« eBay - vendeur », « Amazon.fr »). */
export const ALERT_EXCLUDED_MARKETPLACES = ["amazon", "farfetch", "etsy", "temu", "dhgate", "ebay", "vinted"] as const;

/** Une boutique (nom normalisé, merchantKey) qui est une place de marché :
 * son nom commence par celui de l'une d'elles (« ebayvendeurx »,
 * « amazonfrseller »). Dans le doute, exclue (au pire une alerte manquée). */
export function isMarketplaceMerchant(key: string | null): boolean {
  return key !== null && ALERT_EXCLUDED_MARKETPLACES.some((name) => key.startsWith(name));
}

// Raccourcisseurs et liens d'affiliation : la page finale n'est pas dans
// l'adresse. Liste fermée (un oubli ne coûte qu'une clé de plus, que le
// paramètre-adresse ci-dessous attrape le plus souvent).
const REDIRECTOR_DOMAINS = [
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "ow.ly",
  "linksynergy.com",
  "redirectingat.com",
  "skimresources.com",
  "awin1.com",
  "shareasale.com",
  "anrdoezrs.net",
  "dpbolvw.net",
  "jdoqocy.com",
  "kqzyfj.com",
  "tkqlhce.com",
  "googleadservices.com",
  "doubleclick.net",
  "rstyle.me",
  "pxf.io",
  "sjv.io",
  // Liens courts d'Amazon (place de marché exclue, et redirection).
  "amzn.to",
  "amzn.eu",
  "amzn.asia",
  "amzn.com",
  "a.co",
];
// Pages de recherche ou de liste : un segment du chemin, ou un paramètre de recherche.
const LISTING_SEGMENTS = new Set(["search", "recherche", "suche", "buscar", "busqueda", "ricerca", "zoeken", "catalogsearch"]);
const SEARCH_PARAMS = new Set(["q", "query", "search", "searchterm", "search_query", "keyword", "keywords"]);
// Pagination et tri : seulement sur une liste.
const LISTING_PARAMS = new Set(["page", "sort", "sortby", "sort_by", "orderby", "order_by"]);
// Pages de catégorie ou de collection (Shopify /collections/…, /category/…,
// /c/…) : une liste, sauf si un segment de produit suit (/collections/x/products/y).
const CATEGORY_SEGMENTS = new Set([
  "collections",
  "collection",
  "category",
  "categories",
  "categorie",
  "categoria",
  "categorias",
  "kategorie",
  "catalog",
  "catalogue",
  "c",
  "cat",
]);
const PRODUCT_SEGMENTS = new Set(["products", "product", "produit", "produits", "p", "dp", "item", "items", "article", "artikel", "producto", "prodotto"]);

const MAX_MERCHANT_KEY = 80;

function parseUrl(link: string | null | undefined): URL | null {
  if (typeof link !== "string" || link.trim() === "") return null;
  try {
    const url = new URL(link.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function onDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Hôte en minuscules, sans UN « www. » de tête (m., fr., www2. gardés). */
function keyHost(url: URL): string {
  return url.host.toLowerCase().replace(/^www\./, "");
}

/** Nom de boutique normalisé (« Zalando », « zalando.fr » → « zalando » ;
 * « H&M » → « hm ») ; null sans nom utilisable. */
export function merchantKey(name: string | null | undefined): string | null {
  let text = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (text === "") return null;
  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(text)) text = siteOf(text.replace(/^www\./, "")).name;
  const key = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, MAX_MERCHANT_KEY);
  return key === "" ? null : key;
}

/** Page de liste : recherche, catégorie ou collection sans segment de produit. */
function listingPath(url: URL): boolean {
  const segments = url.pathname.split("/").map((segment) => segment.toLowerCase());
  if (segments.some((segment) => LISTING_SEGMENTS.has(segment))) return true;
  return segments.some((segment) => CATEGORY_SEGMENTS.has(segment)) && !segments.some((segment) => PRODUCT_SEGMENTS.has(segment));
}

/** Adresse sans clé possible : place de marché, redirection, page de liste,
 * ou écartée par les filtres des résultats. */
function excludedLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (exclusionReason(url.href) !== null) return true;
  if ((ALERT_EXCLUDED_MARKETPLACES as readonly string[]).includes(siteOf(host).name)) return true;
  if (onDomain(host, REDIRECTOR_DOMAINS)) return true;
  for (const [name, value] of url.searchParams) {
    if (/^(?:https?:)?\/\//i.test(value.trim())) return true;
    const param = name.toLowerCase();
    if (SEARCH_PARAMS.has(param) || LISTING_PARAMS.has(param)) return true;
  }
  return listingPath(url);
}

function byNameThenValue([a, av]: [string, string], [b, bv]: [string, string]): number {
  if (a !== b) return a < b ? -1 : 1;
  if (av !== bv) return av < bv ? -1 : 1;
  return 0;
}

/** Le lien normalisé de la boutique (avant empreinte), ou null : pas
 * d'empreinte, pas d'alerte. */
export function alertKeyString(link: string | null | undefined, merchantName: string | null | undefined): string | null {
  const url = parseUrl(link);
  if (!url) return null;
  // Une offre d'une place de marché, quel que soit le lien.
  if (isMarketplaceMerchant(merchantKey(merchantName))) return null;
  // Pas de lien direct vers la boutique (page de Google seulement) : jamais d'alerte.
  if (isGoogleLink(url.href)) return null;
  if (excludedLink(url)) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  // Page d'accueil : une liste, jamais une pièce.
  if (path === "/" || path === "") return null;
  const params = [...url.searchParams].filter(([name]) => !isTrackingParam(name)).sort(byNameThenValue);
  const query = new URLSearchParams(params).toString();
  return `https://${keyHost(url)}${path}${query ? `?${query}` : ""}`;
}

/** Empreinte SHA-256 (hexadécimal) d'une clé : seule forme gardée par la base. */
export function alertKeyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Ce que la base garde d'une pièce : l'empreinte de son lien normalisé et
 * le nom de sa boutique normalisé ; null sans empreinte. */
export interface TrackingKey {
  hash: string;
  merchant: string | null;
}

export function trackingKeyOf(link: string | null | undefined, merchantName: string | null | undefined): TrackingKey | null {
  const key = alertKeyString(link, merchantName);
  if (key === null) return null;
  return { hash: alertKeyHash(key), merchant: merchantKey(merchantName) };
}
