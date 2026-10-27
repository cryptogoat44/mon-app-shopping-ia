// Filtres appliqués aux propositions de Google Lens, sans aucun appel :
// propositions où l'on ne peut pas acheter, et doublons. Chacun ne retire
// qu'une proposition qui ne peut pas être la bonne pour un particulier, ou
// qui existe déjà dans la liste : l'ordre de Google n'est jamais modifié ici
// (fiabilité des résultats, phase 1 — réponses enregistrées dans
// tests/fixtures/serpapi). Le classement de la règle des prix vient ensuite
// (services/visualSearch.ts).

// Simples publications de réseaux sociaux : jamais un endroit où acheter la
// pièce. Depuis « visual_matches » (2026-10-20 ; l'ancien "type=products" les
// éliminait lui-même), Google Lens en renvoie davantage : cette liste les écarte
// après coup.
const SOCIAL_NETWORK_DOMAINS = ["tiktok.com", "instagram.com", "youtube.com", "youtu.be", "facebook.com", "twitter.com", "x.com"];
// Réseaux sociaux présents sous plusieurs extensions (pinterest.fr,
// pinterest.com, pinterest.co.uk…) : reconnus par leur nom de site.
const SOCIAL_NETWORK_NAMES = ["pinterest"];
// Vente en gros réservée aux boutiques : jamais achetable par un particulier
// (« à acheter en B2B pour votre magasin », réponse enregistrée du 2026-09-24).
const PROFESSIONAL_ONLY_DOMAINS = ["faire.com"];

export type ExclusionReason = "social" | "professional";

// Extensions à deux niveaux (« co.uk », « com.be ») : le nom du site est le
// libellé qui les précède.
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "ac", "gov"]);

function parseLink(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

/** Nom du site sans son pays : « zalando » (et « zalando.ch ») pour
 * fr.zalando.ch ; « zalando » (et « zalando.co.uk ») pour www.zalando.co.uk.
 * Exporté aussi pour l'outil qui neutralise les réponses de test. */
export function siteOf(host: string): { name: string; domain: string } {
  const labels = host.toLowerCase().split(".");
  const last = labels.at(-1) ?? "";
  const beforeLast = labels.at(-2) ?? "";
  const suffixLength = labels.length >= 3 && last.length === 2 && SECOND_LEVEL_LABELS.has(beforeLast) ? 2 : 1;
  return { name: labels.at(-suffixLength - 1) ?? host, domain: labels.slice(-suffixLength - 1).join(".") };
}

function isOnDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Pourquoi une proposition est écartée d'office, ou null si elle est gardée. */
export function exclusionReason(link: string): ExclusionReason | null {
  const host = parseLink(link)?.hostname.toLowerCase();
  if (!host) return null;
  if (isOnDomain(host, SOCIAL_NETWORK_DOMAINS) || SOCIAL_NETWORK_NAMES.includes(siteOf(host).name)) return "social";
  if (isOnDomain(host, PROFESSIONAL_ONLY_DOMAINS)) return "professional";
  return null;
}

export function isExcludedMerchant(link: string): boolean {
  return exclusionReason(link) !== null;
}

// Paramètres de suivi publicitaire : ils ne changent jamais la page affichée.
// Liste FERMÉE : un paramètre inconnu peut désigner une variante (couleur,
// taille) et compte toujours.
const TRACKING_PARAMS = new Set(["gclid", "gbraid", "wbraid", "dclid", "fbclid", "msclkid", "ttclid", "twclid", "igshid", "yclid", "srsltid", "mc_cid", "mc_eid", "_ga", "_gl"]);

function isTrackingParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/** Chemin et paramètres utiles d'une adresse : sans fragment « # », barre
 * finale ni paramètre de suivi. */
function pageOf(url: URL): string {
  const query = new URLSearchParams([...url.searchParams].filter(([name]) => !isTrackingParam(name))).toString();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
  return query ? `${path}?${query}` : path;
}

/** Même page produit, même si Google la renvoie deux fois sous des écritures
 * différentes (fragment, barre finale, casse du site, paramètres de suivi). */
function pageKey(link: string): string {
  const url = parseLink(link);
  if (!url) return link.split("#")[0]!.replace(/\/$/, "");
  return `${url.hostname.toLowerCase()}${pageOf(url)}`;
}

/** Titre sans le nom du site : « … - ZALANDO.CH » et « … - ZALANDO.FR » se valent. */
function titleWithoutSite(title: string, domain: string): string {
  return title.toLowerCase().split(domain).join(" ").replace(/\s+/g, " ").replace(/[\s\-–—|·:]+$/u, "").trim();
}

/** Ce qui identifie le titre d'un article (titre sans le nom du site), et ce
 * nom de site s'il figurait dans le titre. Sert à l'outil qui neutralise les
 * réponses de test (scripts/lib/essai-type.ts) : deux titres « identiques au
 * nom du site près » y restent identiques. */
export function articleTitleParts(link: string, title: string): { key: string; siteInTitle: string | null } {
  const url = parseLink(link);
  if (!url) return { key: title.toLowerCase().replace(/\s+/g, " ").trim(), siteInTitle: null };
  const { domain } = siteOf(url.hostname);
  return { key: titleWithoutSite(title, domain), siteInTitle: title.toLowerCase().includes(domain) ? domain : null };
}

/** Même article chez le même marchand, sur le site d'un autre pays : même
 * nom de site, même chemin, mêmes paramètres et même titre au nom du site
 * près. Deux titres identiques à des adresses différentes ne suffisent
 * jamais (variantes possibles : couleur, vendeur). */
function articleKey(link: string, title: string): string {
  const url = parseLink(link);
  if (!url) return `lien:${link}`;
  const site = siteOf(url.hostname);
  return `${site.name}${pageOf(url)}|${titleWithoutSite(title, site.domain)}`;
}

/** Extension des sites du pays de la recherche (« uk » pour le Royaume-Uni). */
function countryTld(country: string): string {
  return country === "gb" ? "uk" : country;
}

/** Site du pays de la recherche : extension du pays (.fr) d'abord, puis sous-domaine (fr.). */
function countryScore(link: string, country: string): number {
  const labels = parseLink(link)?.hostname.toLowerCase().split(".") ?? [];
  if (labels.at(-1) === countryTld(country)) return 2;
  return labels[0] === country ? 1 : 0;
}

/** Site du pays de la recherche (.fr) ou européen (.eu) : classement de la règle des prix. */
export function isCountryOrEuSite(link: string, country: string): boolean {
  const tld = parseLink(link)?.hostname.toLowerCase().split(".").at(-1);
  return tld === countryTld(country) || tld === "eu";
}

export interface LinkedMatch {
  title: string;
  link: string;
}

/** Une proposition par page produit, et une par article quand le marchand le
 * vend sur plusieurs sites de pays : le site du pays de la recherche prend la
 * place de la première apparition, l'ordre de Google est conservé. */
export function withoutDuplicates<T extends LinkedMatch>(matches: T[], country: string): T[] {
  const kept: T[] = [];
  const pages = new Set<string>();
  const articles = new Map<string, number>();
  for (const match of matches) {
    const page = pageKey(match.link);
    if (pages.has(page)) continue;
    pages.add(page);
    const article = articleKey(match.link, match.title);
    const index = articles.get(article);
    if (index === undefined) {
      articles.set(article, kept.push(match) - 1);
    } else if (countryScore(match.link, country) > countryScore(kept[index]!.link, country)) {
      kept[index] = match;
    }
  }
  return kept;
}
