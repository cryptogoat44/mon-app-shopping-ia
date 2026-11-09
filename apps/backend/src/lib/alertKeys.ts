// Clé « même pièce » des alertes prix et stock (lot 2, migration 0036), sans
// aucun accès au réseau ni à la base. Règle du fondateur : même pièce = même
// boutique ET même produit, jamais par le titre ni par l'image ; dans le
// doute, pas de clé, donc pas d'alerte.
//
// Deux sortes de clés, choisies d'après l'adresse (jamais d'après l'origine
// de la proposition) :
// - page de Google (isGoogleLink) : `v1|g|{hôte Google}|{productid}|{boutique}`.
//   Le productid est lu STRICTEMENT dans le paramètre `prds`
//   (`productid:123…`, chiffres seulement) ; sans lui, ou sans nom de
//   boutique, aucune clé. Jamais de clé « lien » sur une page de Google (elle
//   reprendrait les mots de la recherche).
// - tout autre lien http(s) : `v1|u|{hôte}{chemin}?{paramètres}`, avec les
//   règles de pageKey (services/matchFilters.ts) : hôte en minuscules, un seul
//   « www. » de tête retiré (m., fr., www2. gardés), chemin tel quel (casse
//   comprise), sans fragment ni « / » final ; seuls « utm_… » et la liste
//   fermée TRACKING_PARAMS sont retirés ; tous les autres paramètres sont
//   gardés, valeurs vides comprises, triés par nom puis par valeur.
//   Principe : garder un paramètre ne peut coûter qu'une alerte manquée ; en
//   retirer un pourrait créer une fausse alerte (variante de couleur, taille).
// Aucune clé pour : les places de marché (Amazon, Farfetch, Etsy, Temu,
// DHgate, eBay, Vinted, toutes extensions), les liens de redirection
// (raccourcisseurs, liens d'affiliation, adresse dans un paramètre), les pages
// de liste ou de recherche (accueil, /search, ?q=…), et toute adresse que les
// filtres des résultats écartent déjà (exclusionReason).
//
// La base ne garde que l'empreinte SHA-256 de la clé (match_key_hash),
// jamais l'adresse. Le nom de la boutique normalisé (merchantKey) est gardé à
// part : deux observations de la même clé ne valent que si leurs boutiques
// sont les mêmes quand les deux en ont une.
import { createHash } from "node:crypto";
import { exclusionReason, isGoogleLink, isTrackingParam, siteOf } from "../services/matchFilters.js";

/** Version des clés : à changer avec les règles ci-dessous (le script de
 * rattrapage recalcule alors les clés des envies). */
export const ALERT_KEY_VERSION = 1;

/** Places de marché exclues (décision 4 du fondateur), reconnues par le nom
 * du site quelle que soit l'extension (amazon.fr, amazon.com.be, ebay.co.uk…). */
export const ALERT_EXCLUDED_MARKETPLACES = ["amazon", "farfetch", "etsy", "temu", "dhgate", "ebay", "vinted"] as const;

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
];
// Pages de recherche ou de liste : un segment du chemin, ou un paramètre de recherche.
const LISTING_SEGMENTS = new Set(["search", "recherche", "suche", "buscar", "busqueda", "ricerca", "zoeken", "catalogsearch"]);
const SEARCH_PARAMS = new Set(["q", "query", "search", "searchterm", "search_query", "keyword", "keywords"]);

const PRODUCT_ID = /^\d{1,30}$/;
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

/** Le productid d'une page de Google, lu seulement dans `prds`
 * (« …,productid:123456,… ») ; null s'il manque, s'il n'est pas fait que de
 * chiffres, ou si deux valeurs différentes s'y trouvent. */
export function googleProductId(link: string | URL): string | null {
  const url = typeof link === "string" ? parseUrl(link) : link;
  const prds = url?.searchParams.get("prds");
  if (!prds) return null;
  const found = new Set<string>();
  for (const part of prds.split(",")) {
    const separator = part.indexOf(":");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim().toLowerCase() !== "productid") continue;
    const value = part.slice(separator + 1).trim();
    if (!PRODUCT_ID.test(value)) return null;
    found.add(value);
  }
  return found.size === 1 ? [...found][0]! : null;
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
    if (SEARCH_PARAMS.has(name.toLowerCase())) return true;
  }
  return url.pathname.split("/").some((segment) => LISTING_SEGMENTS.has(segment.toLowerCase()));
}

function byNameThenValue([a, av]: [string, string], [b, bv]: [string, string]): number {
  if (a !== b) return a < b ? -1 : 1;
  if (av !== bv) return av < bv ? -1 : 1;
  return 0;
}

/** La clé d'une pièce (avant empreinte), ou null : pas de clé, pas d'alerte. */
export function alertKeyString(link: string | null | undefined, merchantName: string | null | undefined): string | null {
  const url = parseUrl(link);
  if (!url) return null;
  if (isGoogleLink(url.href)) {
    const productId = googleProductId(url);
    const source = merchantKey(merchantName);
    if (!productId || !source) return null;
    return `v${ALERT_KEY_VERSION}|g|${keyHost(url)}|${productId}|${source}`;
  }
  if (excludedLink(url)) return null;
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  // Page d'accueil : une liste, jamais une pièce.
  if (path === "/" || path === "") return null;
  const params = [...url.searchParams].filter(([name]) => !isTrackingParam(name)).sort(byNameThenValue);
  const query = new URLSearchParams(params).toString();
  return `v${ALERT_KEY_VERSION}|u|${keyHost(url)}${path}${query ? `?${query}` : ""}`;
}

/** Empreinte SHA-256 (hexadécimal) d'une clé : seule forme gardée par la base. */
export function alertKeyHash(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Ce que la base garde d'une pièce : l'empreinte de sa clé et le nom de sa
 * boutique normalisé ; null sans clé. */
export interface TrackingKey {
  hash: string;
  merchant: string | null;
  kind: "google" | "link";
}

export function trackingKeyOf(link: string | null | undefined, merchantName: string | null | undefined): TrackingKey | null {
  const key = alertKeyString(link, merchantName);
  if (key === null) return null;
  return { hash: alertKeyHash(key), merchant: merchantKey(merchantName), kind: key.startsWith(`v${ALERT_KEY_VERSION}|g|`) ? "google" : "link" };
}
