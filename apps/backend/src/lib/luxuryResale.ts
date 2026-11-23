// Seconde main de luxe (lot « seconde main de luxe », sans migration) : sous
// une pièce qui semble venir d'une maison de luxe, l'app propose une entrée
// discrète qui ouvre la recherche publique des sites de revente choisis par
// le fondateur (src/listes/secondeMainDeLuxe.ts), déjà remplie avec des mots
// tirés du TITRE d'une offre montrée. Fonction pure, sans réseau, sans base
// ni journal : le serveur n'appelle jamais ces sites, ne lit aucun prix
// d'occasion, et rien n'est enregistré (ni la maison, ni les mots). Comme le
// verdict (lib/verdict.ts), la maison est recalculée à chaque relecture à
// partir des propositions réellement montrées ; elle ne change l'ordre de
// rien et n'ajoute aucune mention.
//
// Règle d'or : la prudence. Dans le doute, rien (aucune entrée, aucun
// message). Une maison M est retenue si :
// (A) au moins LUXURY_MIN_SOURCES (2) sources sûres et DISTINCTES la
//     désignent. Une source est :
//     - son site officiel : une offre dont l'adresse est l'une de celles de
//       M (sous-domaines compris, chaque pays à part) ; nommée par cette
//       adresse ;
//     - ou une boutique connue comptée (countedShopName : sans les places de
//       marché ni les sites de revente), qui n'est le site officiel d'aucune
//       marque (isOfficialShop faux), et dont le titre nomme M en mots
//       entiers et consécutifs (wordsOf : accents, majuscules et signes ne
//       comptent pas ; un mot plus long ou un pluriel ne compte pas), sans
//       nommer une autre marque qui contient le nom de M (« sauf ») ; nommée
//       par countedShopName (zalando.fr et zalando.be : une seule source) ;
// (B) ou une offre de « Cette pièce dans d'autres boutiques » porte
//     brand_shop (0054 : la boutique de la marque de la pièce, vérifiée par
//     le serveur) et son adresse est l'une de celles de M. Sans 0054, ce cas
//     n'arrive jamais : seul (A) joue.
// Propositions lues : celles montrées, sans les offres retirées, sans les
// offres signalées (rangées en fin de section, ou « Prix inhabituellement
// bas »), et seulement de la recherche visuelle et de « Cette pièce dans
// d'autres boutiques » — jamais « Résultats pour vos mots », qui répètent les
// mots tapés par le membre.
// L'entrée n'est proposée que si la recherche est terminée, qu'au moins une
// proposition est montrée, qu'EXACTEMENT une maison est retenue, qu'au moins
// un site de revente est valable et que les mots ne sont pas vides.
//
// Les mots : le titre de la première offre du site officiel de M (dans
// l'ordre montré), à défaut celui de la première boutique connue qui nomme
// M ; les mots dans leur écriture d'origine, sans signes (sauf « ' », « - »
// et « & »), sans petits mots courants, sans référence (5 chiffres ou plus),
// sans prix (un nombre collé à une devise, ou égal au prix d'une offre
// montrée) ni nom d'une boutique ; les 8 premiers ; le nom de M en tête
// s'il n'y est pas ; 80 caractères au plus, coupés sur une fin de mot.
// Jamais les mots du membre (query, description d'une vidéo, requête de
// l'IA) : ils ne sont pas lus ici.
import type { LuxuryResale, MatchOrigin, OfferMark } from "@monapp/shared-types";
import { MAISONS_DE_LUXE, SITES_DE_REVENTE, type MaisonDeLuxe, type SiteDeRevente } from "../listes/secondeMainDeLuxe.js";
import type { MatchRow, SearchRow } from "./searchRows.js";
import { isOfficialShop } from "./shopTrust.js";
import { countedShopName } from "./verdict.js";
import { SMALL_WORDS, wordsOf } from "./wordSort.js";

/** Sources distinctes nécessaires pour retenir une maison par (A). */
export const LUXURY_MIN_SOURCES = 2;
/** Sites de revente montrés au plus. */
export const LUXURY_MAX_SITES = 5;
/** Mots gardés du titre (avant le nom de la maison, s'il faut l'ajouter). */
export const LUXURY_MAX_WORDS = 8;
/** Longueur des mots, au plus. */
export const LUXURY_MAX_LENGTH = 80;
/** L'endroit des mots dans l'adresse de recherche d'un site. */
export const WORDS_PLACEHOLDER = "{mots}";

/** Une proposition montrée, telle que la relecture la met en forme
 * (lib/searchRows.ts, trustedMatches). */
export interface LuxuryShownMatch {
  match: Pick<MatchRow, "merchant_url" | "product_name" | "origin" | "brand_shop" | "price_min" | "price_max">;
  mark: OfferMark | null;
  demoted: boolean;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isHouseSite(url: string, house: MaisonDeLuxe): boolean {
  const host = hostOf(url);
  return host !== null && house.adresses.some((domain) => onDomain(host, domain));
}

/** `words` contient-il la suite `name`, en mots entiers et consécutifs ? */
function containsSequence(words: readonly string[], name: readonly string[]): boolean {
  if (name.length === 0 || name.length > words.length) return false;
  for (let start = 0; start + name.length <= words.length; start += 1) {
    if (name.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

function houseNames(house: MaisonDeLuxe): string[][] {
  return [house.nom, ...(house.aussi ?? [])].map(wordsOf).filter((name) => name.length > 0);
}

/** Le texte nomme-t-il la maison (en mots entiers), sans nommer une autre
 * marque qui contient son nom (« sauf ») ? */
export function namesHouse(text: string, house: MaisonDeLuxe): boolean {
  const words = wordsOf(text);
  if ((house.sauf ?? []).some((other) => containsSequence(words, wordsOf(other)))) return false;
  return houseNames(house).some((name) => containsSequence(words, name));
}

/** Les propositions lues : montrées, ni retirées (déjà absentes), ni
 * signalées, de la recherche visuelle ou des boutiques ; jamais « words ». */
function readable(shown: readonly LuxuryShownMatch[]): LuxuryShownMatch[] {
  return shown.filter(({ match, mark, demoted }) => {
    const origin: MatchOrigin = match.origin ?? "lens";
    return (origin === "lens" || origin === "shopping") && !demoted && mark !== "unusual_price";
  });
}

/** Une boutique connue comptée, qui n'est le site officiel d'aucune marque :
 * son nom (countedShopName), ou null. */
function retailerName(url: string): string | null {
  return isOfficialShop(url) ? null : countedShopName(url);
}

/** La maison est-elle retenue (règle A ou B) ? */
function houseRetained(house: MaisonDeLuxe, offers: readonly LuxuryShownMatch[]): boolean {
  const sources = new Set<string>();
  for (const { match } of offers) {
    if ((match.origin ?? "lens") === "shopping" && match.brand_shop === true && isHouseSite(match.merchant_url, house)) return true;
    if (isHouseSite(match.merchant_url, house)) {
      const host = hostOf(match.merchant_url)!;
      sources.add(house.adresses.find((domain) => onDomain(host, domain))!);
      continue;
    }
    const retailer = retailerName(match.merchant_url);
    if (retailer !== null && namesHouse(match.product_name, house)) sources.add(retailer);
  }
  return sources.size >= LUXURY_MIN_SOURCES;
}

/** Le titre de départ : la première offre du site officiel de la maison,
 * à défaut la première boutique connue qui la nomme. */
function sourceTitle(house: MaisonDeLuxe, offers: readonly LuxuryShownMatch[]): string | null {
  const official = offers.find(({ match }) => isHouseSite(match.merchant_url, house));
  if (official) return official.match.product_name;
  const retailer = offers.find(({ match }) => retailerName(match.merchant_url) !== null && namesHouse(match.product_name, house));
  return retailer ? retailer.match.product_name : null;
}

const CURRENCY_SYMBOL = /[€$£¥]/u;
const CURRENCY_WORDS: ReadonlySet<string> = new Set(["eur", "euro", "euros", "usd", "gbp", "chf", "dollar", "dollars"]);
const NUMBERISH = /^[\d.,'  ]*\d[\d.,'  ]*$/u;

function isCurrencyToken(token: string): boolean {
  const bare = token.replace(/^[^\p{L}\p{N}€$£¥]+|[^\p{L}\p{N}€$£¥]+$/gu, "");
  return /^[€$£¥]+$/u.test(bare) || CURRENCY_WORDS.has(bare.toLowerCase());
}

/** Les entiers des prix des offres montrées (« 1 250,00 » → 1250 et 1). */
function priceNumbers(shown: readonly LuxuryShownMatch[]): Set<string> {
  const numbers = new Set<string>();
  for (const { match } of shown) {
    for (const value of [match.price_min, match.price_max]) {
      const amount = value === null ? NaN : Number(value);
      if (Number.isFinite(amount) && amount > 0) numbers.add(String(Math.trunc(amount)));
    }
  }
  return numbers;
}

/** Les mots de la recherche, tirés d'un titre (voir l'en-tête). */
export function searchWordsOf(title: string, house: MaisonDeLuxe, shown: readonly LuxuryShownMatch[]): string {
  const raw = title.replace(/[‘’ʼ]/g, "'").split(/\s+/u).filter(Boolean);
  // Prix : la devise, et les nombres qui la touchent (« 1 250,00 € », « €1250 », « 1250 EUR »).
  const dropped = raw.map(() => false);
  raw.forEach((token, index) => {
    const currency = isCurrencyToken(token);
    const glued = !currency && CURRENCY_SYMBOL.test(token) && /\d/.test(token);
    if (!currency && !glued) return;
    dropped[index] = true;
    for (let before = index - 1; before >= 0 && NUMBERISH.test(raw[before]!); before -= 1) dropped[before] = true;
    if (currency) for (let after = index + 1; after < raw.length && NUMBERISH.test(raw[after]!); after += 1) dropped[after] = true;
  });
  const prices = priceNumbers(shown);
  const shops = new Set(shown.flatMap(({ match }) => {
    const name = retailerName(match.merchant_url);
    return name === null ? [] : [name];
  }));
  const kept = raw
    .filter((_, index) => !dropped[index])
    .flatMap((token) => token.replace(/[^\p{L}\p{N}'\-& ]/gu, " ").split(" "))
    .map((token) => token.replace(/^['\-&]+|['\-&]+$/g, ""))
    .filter((token) => {
      if (!/[\p{L}\p{N}]/u.test(token)) return false;
      const words = wordsOf(token);
      if (words.every((word) => SMALL_WORDS.has(word))) return false;
      if (/\d{5,}/u.test(token)) return false;
      if (/^\d+$/u.test(token) && prices.has(String(Number(token)))) return false;
      if (shops.has(words.join(""))) return false;
      return true;
    })
    .slice(0, LUXURY_MAX_WORDS);
  const named = houseNames(house).some((name) => containsSequence(wordsOf(kept.join(" ")), name));
  const all = named ? kept : [house.nom, ...kept];
  let words = "";
  for (const word of all) {
    const next = words === "" ? word : `${words} ${word}`;
    if (next.length > LUXURY_MAX_LENGTH) break;
    words = next;
  }
  return words;
}

/** Les mots dans une adresse : encodage strict (RFC 3986), y compris
 * « ' », « ( », « ) », « ! » et « * », que encodeURIComponent laisse. */
export function encodeWords(words: string): string {
  return encodeURIComponent(words).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** L'adresse de recherche d'un site, remplie avec les mots ; null si
 * l'adresse de la liste n'est pas une adresse https lisible avec un seul
 * {mots}, ou si le résultat n'est plus exactement sur le même hôte. */
export function searchUrlOf(template: string, words: string): string | null {
  if (!template.startsWith("https://") || template.split(WORDS_PLACEHOLDER).length !== 2 || words.trim() === "") return null;
  let base: URL;
  let filled: URL;
  const url = template.replace(WORDS_PLACEHOLDER, encodeWords(words));
  try {
    base = new URL(template.replace(WORDS_PLACEHOLDER, ""));
    filled = new URL(url);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" || filled.protocol !== "https:" || base.username !== "" || base.password !== "" || base.port !== "") return null;
  if (filled.host !== base.host || filled.username !== "" || filled.password !== "") return null;
  // Exactement l'adresse de la liste, les mots encodés à leur place : rien de réécrit par le navigateur.
  return filled.href === url ? url : null;
}

/** Les sites de revente valables, remplis avec les mots, par ordre
 * alphabétique de leur nom (jamais selon une préférence), 5 au plus. */
export function resaleSitesFor(words: string, sites: readonly SiteDeRevente[] = SITES_DE_REVENTE): LuxuryResale["sites"] {
  return sites
    .flatMap((site) => {
      const name = site.nom.trim();
      const url = name === "" ? null : searchUrlOf(site.recherche, words);
      return url === null ? [] : [{ name, url }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }))
    .slice(0, LUXURY_MAX_SITES);
}

/** L'entrée « Seconde main de luxe » d'une recherche relue ; undefined :
 * dans le doute, rien. `houses` et `sites` : les listes du fondateur (les
 * tests en passent d'autres). */
export function luxuryResaleOf(
  row: Pick<SearchRow, "status">,
  shown: readonly LuxuryShownMatch[],
  houses: readonly MaisonDeLuxe[] = MAISONS_DE_LUXE,
  sites: readonly SiteDeRevente[] = SITES_DE_REVENTE
): LuxuryResale | undefined {
  if (row.status !== "completed" || shown.length === 0 || sites.length === 0) return undefined;
  const offers = readable(shown);
  const retained = houses.filter((house) => houseRetained(house, offers));
  if (retained.length !== 1) return undefined;
  const house = retained[0]!;
  const title = sourceTitle(house, offers);
  if (title === null) return undefined;
  const words = searchWordsOf(title, house, shown);
  if (words === "") return undefined;
  const resale = resaleSitesFor(words, sites);
  if (resale.length === 0) return undefined;
  return { house: house.nom, words, sites: resale };
}
