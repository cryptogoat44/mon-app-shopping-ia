// Boutiques douteuses (lot « recherche confiance », novembre 2026) : les
// membres ne doivent pas être envoyés vers de fausses boutiques. Sans aucun
// appel ni service : deux listes tenues par le fondateur (src/listes/) et
// deux signaux prudents, testés (tests/boutiquesDouteuses.test.ts).
// - Boutique officielle de la marque (liste) : mention « Boutique officielle
//   de la marque » ; jamais signalée pour son prix.
// - Boutique connue (liste) : mention « Boutique connue » ; jamais signalée
//   pour son prix.
// - Boutique masquée (liste, ou mot évident dans l'adresse : « replica »…) :
//   l'offre est retirée, toujours.
// - Prix inhabituellement bas : au moins 3 offres avec un prix dans la même
//   devise, et un prix sous le tiers de leur médiane. Jamais converti ni
//   comparé à une autre devise.
// - Adresse douteuse : une marque souvent imitée, un mot de braderie
//   (outlet, sale, cheap, discount, store…) et une extension inhabituelle
//   (.shop, .top, .xyz…), les trois ensemble.
// - Les deux signaux à la fois : offre retirée — sauf si plus rien ne
//   resterait (jamais les seuls résultats) : gardée, avec la mention. Un seul
//   signal : gardée ; la mention « Prix inhabituellement bas » seulement
//   quand le prix l'est (un constat, jamais une accusation : rien n'est dit
//   d'une adresse).
// - L'ordre (décision du fondateur, 21 novembre 2026 : « Je ne veux mettre
//   aucune marque en avant ») : seule la section « Cette pièce dans d'autres
//   boutiques » (origine « shopping » : la même pièce, aucune marque n'y passe
//   devant une autre) est rangée par les mentions — la boutique officielle de
//   la marque de la pièce en tête, reconnue à l'enregistrement (isBrandShop ;
//   toute autre boutique officielle est rangée comme une boutique connue),
//   boutiques connues remontées de KNOWN_SHOP_BOOST places au plus, offres
//   signalées (un signal) en fin de section. Partout ailleurs (recherche visuelle,
//   « Résultats pour vos mots » : des pièces qui se ressemblent seulement),
//   chaque offre garde sa place reçue, avec sa mention (sectionOrder).
// Le serveur s'en sert en deux temps : à l'enregistrement (une offre retirée
// n'est jamais rangée, observée pour les alertes ni retenue pour une vidéo)
// et à chaque relecture (mentions, ordre, et listes modifiées depuis).
// Fonctions pures : ni réseau, ni base, ni journal.
import { alertCurrency, type MatchOrigin, type OfferMark } from "@monapp/shared-types";
import { BOUTIQUES_CONNUES } from "../listes/boutiquesConnues.js";
import { AUTRES_NOMS_DES_MARQUES, BOUTIQUES_OFFICIELLES } from "../listes/boutiquesOfficielles.js";
import { BOUTIQUES_MASQUEES, MOTS_MASQUES } from "../listes/boutiquesMasquees.js";
import { sameToken } from "./lightSort.js";
import { wordsOf } from "./wordSort.js";

/** Ce qu'il faut d'une offre : son lien, et son prix s'il est connu. */
export interface TrustOffer {
  merchantUrl: string;
  priceValue?: number | null;
  currency?: string | null;
}

/** Une offre d'une section, telle que l'ordre la lit. */
export interface SectionOffer {
  /** La boutique officielle de la marque de la pièce, reconnue à
   * l'enregistrement de « Cette pièce dans d'autres boutiques » (isBrandShop ;
   * product_matches.brand_shop, migration 0054). Faux pour toute autre offre,
   * pour les lignes d'avant, et partout sans 0054. */
  brandShop: boolean;
}

/** Places gagnées au plus par une boutique connue, dans « Cette pièce dans
 * d'autres boutiques » (sectionOrder ; ailleurs, aucune). */
export const KNOWN_SHOP_BOOST = 2;
/** Un prix sous cette part de la médiane est « inhabituellement bas ». */
export const LOW_PRICE_RATIO = 1 / 3;
/** Offres avec un prix (même devise) nécessaires pour juger un prix. */
export const MIN_PRICED_OFFERS = 3;

// Extensions rarement prises par une vraie boutique de mode, très prisées
// des fausses (gratuites ou presque). Seules, elles ne disent rien.
const UNUSUAL_TLDS: ReadonlySet<string> = new Set([
  "shop", "top", "xyz", "store", "online", "vip", "icu", "site", "website", "club", "buzz", "cyou", "sbs", "cfd", "bond",
  "fun", "space", "live", "life", "today", "best", "sale", "shopping", "deals", "discount", "monster", "rest", "pw", "click",
  "link", "work", "tk", "ml", "ga", "cf", "gq",
]);
// Mots de braderie, cherchés dans l'adresse (« monclersoldes », « nike-outlet ») ;
// une extension qui en est un (« .store ») compte aussi.
const BARGAIN_WORDS: readonly string[] = ["outlet", "sale", "soldes", "cheap", "discount", "store", "promo", "deal", "clearance"];
const BARGAIN_TLDS: ReadonlySet<string> = new Set(["store", "sale", "shopping", "deals", "discount"]);
// Marques souvent imitées par les fausses boutiques, écrites sans espace ni
// signe. Une marque courte (moins de 6 lettres) doit commencer ou finir un
// mot de l'adresse (« nikeoutlet », « cheap-nike ») ; une longue peut être
// n'importe où (« bestmonclerjackets »).
const IMITATED_BRANDS: readonly string[] = [
  "nike", "adidas", "jordan", "yeezy", "newbalance", "converse", "vans", "asics", "hoka", "salomon", "reebok", "crocs", "clarks",
  "ugg", "birkenstock", "timberland", "drmartens", "moncler", "canadagoose", "northface", "thenorthface", "parajumpers",
  "woolrich", "napapijri", "barbour", "arcteryx", "patagonia", "stoneisland", "carhartt", "stussy", "supreme", "superdry",
  "lululemon", "skims", "levis", "ralphlauren", "lacoste", "tommyhilfiger", "hilfiger", "calvinklein", "hugoboss",
  "michaelkors", "longchamp", "gucci", "prada", "miumiu", "louisvuitton", "vuitton", "balenciaga", "dior", "chanel", "hermes",
  "burberry", "versace", "fendi", "givenchy", "valentino", "celine", "ysl", "saintlaurent", "bottega", "loewe", "offwhite",
  "palmangels", "goldengoose", "sezane", "zara", "zalando",
];

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

/** L'adresse sans son extension ni « www », mots joints par « - »
 * (« shop.moncler-outlet.top » → « shop-moncler-outlet »). */
function nameOf(host: string): string {
  return host
    .split(".")
    .slice(0, -1)
    .filter((label) => label !== "www")
    .join("-");
}

/** Site officiel d'une marque (src/listes/boutiquesOfficielles.ts). */
export function isOfficialShop(url: string): boolean {
  const host = hostOf(url);
  return host !== null && BOUTIQUES_OFFICIELLES.some((domain) => onDomain(host, domain));
}

/** Les noms de la marque d'une boutique officielle, écrits en un mot : son
 * adresse dans la liste, sans extension ni tiret (« hm.com » → « hm »,
 * « thenorthface.fr » → « thenorthface », « ba-sh.com » → « bash »), et
 * ses autres noms exacts (« aussi » : « Saint Laurent » → « saintlaurent »
 * pour ysl.com) ; vide : pas une boutique officielle. */
function officialBrandsOf(url: string): string[] {
  const host = hostOf(url);
  const domain = host === null ? undefined : BOUTIQUES_OFFICIELLES.find((entry) => onDomain(host, entry));
  if (domain === undefined) return [];
  const aliases = (AUTRES_NOMS_DES_MARQUES.get(domain) ?? []).map((name) => wordsOf(name).join(""));
  return [domain.split(".")[0]!.replace(/-/g, ""), ...aliases].filter((name) => name !== "");
}

/** À l'enregistrement de « Cette pièce dans d'autres boutiques » (lib/voieC.ts,
 * seul moment où la marque de la pièce est connue) : l'offre est-elle la
 * boutique officielle de cette marque ? `brand` : la marque de la requête de
 * l'IA, vérifiée par le serveur dans au moins deux titres de la recherche
 * visuelle (services/shoppingQueryAi.ts). La marque entière, ses mots collés,
 * doit être exactement un nom de la boutique (officialBrandsOf : son adresse
 * ou un de ses autres noms, pluriel toléré, comme le tri léger : « Levi's »
 * pour levi.com) : « Jules & Jenn » n'est pas jules.com, ni « Tommy Bahama »
 * tommy.com, ni « Sandro Ferrone » sandro-paris.com, et la boutique d'une
 * autre marque ne l'est jamais, même nommée dans les titres. Une marque
 * écrite autrement que l'adresse et ses autres noms laisse la boutique
 * rangée comme une boutique connue : jamais une marque en tête par erreur. */
export function isBrandShop(url: string, brand: string): boolean {
  const key = wordsOf(brand).join("");
  return key !== "" && officialBrandsOf(url).some((name) => sameToken(name, key));
}

/** Boutique sûre : un revendeur connu (src/listes/boutiquesConnues.ts) ou le
 * site officiel d'une marque. Jamais signalée pour son prix. */
export function isKnownShop(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (BOUTIQUES_CONNUES.some((domain) => onDomain(host, domain)) || isOfficialShop(url));
}

/** Le verdict (lib/verdict.ts) : le nom d'une boutique connue ou d'un site
 * officiel, tiré de son adresse dans la liste, sans extension
 * (« zalando.fr » et « zalando.be » → « zalando », « amazon.com.be » →
 * « amazon ») : deux pays d'une même enseigne ne comptent que pour une
 * boutique. null : ni connue ni officielle (jamais comptée). */
export function knownShopName(url: string): string | null {
  const host = hostOf(url);
  if (host === null) return null;
  const domain = [...BOUTIQUES_CONNUES, ...BOUTIQUES_OFFICIELLES].find((entry) => onDomain(host, entry));
  return domain === undefined ? null : domain.split(".")[0]!;
}

/** Boutique masquée : dans la liste, ou un mot évident dans son adresse
 * (src/listes/boutiquesMasquees.ts). */
export function isHiddenShop(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  if (BOUTIQUES_MASQUEES.some((domain) => onDomain(host, domain))) return true;
  const name = nameOf(host);
  return MOTS_MASQUES.some((word) => name.includes(word));
}

function mentionsBrand(name: string): boolean {
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  return IMITATED_BRANDS.some((brand) =>
    tokens.some((token) => token === brand || token.startsWith(brand) || token.endsWith(brand) || (brand.length >= 6 && token.includes(brand)))
  );
}

/** Adresse douteuse : extension inhabituelle, mot de braderie et marque
 * souvent imitée, les trois ensemble (« moncler-outlet.shop »). Une
 * boutique connue ne l'est jamais. */
export function looksLikeFakeShop(url: string): boolean {
  const host = hostOf(url);
  if (host === null || isKnownShop(url)) return false;
  const tld = host.split(".").at(-1) ?? "";
  if (!UNUSUAL_TLDS.has(tld)) return false;
  const name = nameOf(host);
  const bargain = BARGAIN_TLDS.has(tld) || BARGAIN_WORDS.some((word) => name.includes(word));
  return bargain && mentionsBrand(name);
}

/** La devise écrite d'une seule façon (« € » et « EUR » → « EUR ») ; null sans devise. */
function currencyKey(currency: string | null | undefined): string | null {
  const text = currency?.trim();
  if (!text) return null;
  return alertCurrency(text, null) ?? text.toUpperCase();
}

/** Un prix jugeable : supérieur à 0 (un prix à 0 est une donnée douteuse), avec sa devise. */
function priceOf(offer: TrustOffer): { amount: number; currency: string } | null {
  const amount = offer.priceValue;
  const currency = currencyKey(offer.currency);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || currency === null) return null;
  return { amount, currency };
}

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Médiane des prix de chaque devise qui compte au moins MIN_PRICED_OFFERS offres. */
function priceMedians(offers: readonly TrustOffer[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const offer of offers) {
    const price = priceOf(offer);
    if (price) groups.set(price.currency, [...(groups.get(price.currency) ?? []), price.amount]);
  }
  const medians = new Map<string, number>();
  for (const [currency, amounts] of groups) {
    if (amounts.length >= MIN_PRICED_OFFERS) medians.set(currency, median([...amounts].sort((a, b) => a - b)));
  }
  return medians;
}

/** Ce que les règles décident pour une offre. */
export interface OfferReview {
  /** À ne jamais montrer : boutique masquée, ou les deux signaux à la fois. */
  dropped: boolean;
  /** Pourquoi elle est retirée (compteurs du journal seulement). */
  dropReason: "hidden" | "suspicious" | null;
  /** La mention de la carte. */
  mark: OfferMark | null;
  /** Un signal (ou les deux, gardée faute d'autre offre) : rangée en fin de
   * section dans « Cette pièce dans d'autres boutiques » seulement (sectionOrder). */
  demoted: boolean;
  /** Boutique connue : remontée de KNOWN_SHOP_BOOST places au plus dans
   * « Cette pièce dans d'autres boutiques » seulement (sectionOrder). */
  boosted: boolean;
}

/** Les règles, offre par offre, dans l'ordre reçu. `context` : les offres
 * déjà gardées pour la même recherche (les résultats Lens quand arrivent
 * les boutiques) ; elles comptent pour juger les prix et comme résultats
 * restants, mais ne sont pas jugées ici. Jamais tout retirer pour les deux
 * signaux : quand plus rien ne resterait (ni ici, ni dans `context`), les
 * offres très suspectes sont gardées, avec la mention « Prix
 * inhabituellement bas » (et rangées en fin de section là où les mentions
 * comptent pour l'ordre : sectionOrder). Avec la médiane (l'offre comprise),
 * cela n'arrive pas aujourd'hui : c'est un filet, si le seuil changeait un
 * jour (`lowPriceRatio`, LOW_PRICE_RATIO par défaut). */
export function reviewOffers(offers: readonly TrustOffer[], context: readonly TrustOffer[] = [], lowPriceRatio: number = LOW_PRICE_RATIO): OfferReview[] {
  const shownContext = context.filter((offer) => !isHiddenShop(offer.merchantUrl));
  const hidden = offers.map((offer) => isHiddenShop(offer.merchantUrl));
  const known = offers.map((offer, index) => !hidden[index] && isKnownShop(offer.merchantUrl));
  const medians = priceMedians([...offers.filter((_, index) => !hidden[index]), ...shownContext]);
  const lowPrice = offers.map((offer, index) => {
    const price = priceOf(offer);
    const reference = price ? medians.get(price.currency) : undefined;
    return !hidden[index] && !known[index] && price !== null && reference !== undefined && price.amount < reference * lowPriceRatio;
  });
  const fakeLooking = offers.map((offer, index) => !hidden[index] && !known[index] && looksLikeFakeShop(offer.merchantUrl));
  const strong = offers.map((_, index) => lowPrice[index]! && fakeLooking[index]!);
  const somethingLeft = shownContext.length > 0 || offers.some((_, index) => !hidden[index] && !strong[index]);
  return offers.map((_, index): OfferReview => {
    if (hidden[index]) return { dropped: true, dropReason: "hidden", mark: null, demoted: false, boosted: false };
    if (strong[index] && somethingLeft) return { dropped: true, dropReason: "suspicious", mark: null, demoted: false, boosted: false };
    const mark: OfferMark | null = known[index]
      ? isOfficialShop(offers[index]!.merchantUrl)
        ? "official_shop"
        : "known_shop"
      : lowPrice[index]
        ? "unusual_price"
        : null;
    return { dropped: false, dropReason: null, mark, demoted: lowPrice[index]! || fakeLooking[index]!, boosted: known[index]! };
  });
}

/** Les offres gardées d'une liste, dans leur ordre (enregistrement), et ce
 * qui a été retiré (des nombres, pour le journal). */
export function withoutDubiousOffers<T>(
  items: readonly T[],
  offerOf: (item: T) => TrustOffer,
  context: readonly TrustOffer[] = []
): { kept: T[]; hidden: number; suspicious: number } {
  const reviews = reviewOffers(items.map(offerOf), context);
  return {
    kept: items.filter((_, index) => !reviews[index]!.dropped),
    hidden: reviews.filter((review) => review.dropReason === "hidden").length,
    suspicious: reviews.filter((review) => review.dropReason === "suspicious").length,
  };
}

/** L'ordre de « Cette pièce dans d'autres boutiques », à la relecture
 * (sectionOrder, qui ne lui présente comme boutique officielle que celle de
 * la marque de la pièce, reconnue à l'enregistrement) : les offres retirées
 * en moins ; les boutiques officielles en tête (dans leur ordre) ; les
 * boutiques connues remontées de KNOWN_SHOP_BOOST places au plus ; les
 * offres signalées (un signal) en fin de section ; sinon l'ordre reçu. */
export function trustOrder<T>(items: readonly T[], reviews: readonly OfferReview[]): T[] {
  const kept = items.map((item, index) => ({ item, review: reviews[index]! })).filter(({ review }) => !review.dropped);
  const ranked = kept
    .filter(({ review }) => !review.demoted)
    .map((entry, position) => ({
      ...entry,
      position,
      key: entry.review.mark === "official_shop" ? position - items.length - KNOWN_SHOP_BOOST : position - (entry.review.boosted ? KNOWN_SHOP_BOOST : 0),
    }))
    .sort((a, b) => a.key - b.key || Number(b.review.boosted) - Number(a.review.boosted) || a.position - b.position);
  const demoted = kept.filter(({ review }) => review.demoted);
  return [...ranked, ...demoted].map(({ item }) => item);
}

/** L'ordre d'une section, à la relecture (décision du fondateur, 21 novembre
 * 2026 : « Je ne veux mettre aucune marque en avant ») :
 * - « Cette pièce dans d'autres boutiques » (origine « shopping ») : la même
 *   pièce dans plusieurs boutiques, aucune marque n'y passe devant une
 *   autre — rangée par les mentions (trustOrder). Seule la boutique
 *   officielle de la marque de la pièce, reconnue à l'enregistrement (là où
 *   la marque est connue : isBrandShop), passe en tête. Les titres n'y
 *   suffisent jamais : un mot d'une autre marque, du modèle ou de la
 *   description (« jules » d'un sac Jules & Jenn), ou les pièces d'autres
 *   marques que le tri léger garde (Mango dans une section Zara), ne
 *   disent pas la marque de la pièce. Toute autre boutique officielle (une
 *   autre marque, une marque non reconnue, une ligne d'avant 0054, toutes
 *   sans 0054) est rangée exactement comme une boutique connue : remontée
 *   de KNOWN_SHOP_BOOST places au plus, jamais derrière un revendeur connu
 *   à cause de sa mention, avec sa mention (aucune marque en avant, aucune
 *   en arrière) ;
 * - partout ailleurs (recherche visuelle, « Résultats pour vos mots » : des
 *   pièces qui se ressemblent seulement) : l'ordre reçu, les offres retirées
 *   en moins ; aucune boutique officielle ou connue remontée, aucune offre
 *   signalée descendue. Les mentions, elles, restent partout.
 * `offers` : ce que l'enregistrement a noté de chaque offre, dans le même
 * ordre que `items` et `reviews`. */
export function sectionOrder<T>(origin: MatchOrigin, items: readonly T[], reviews: readonly OfferReview[], offers: readonly SectionOffer[]): T[] {
  if (origin !== "shopping") return items.filter((_, index) => !reviews[index]!.dropped);
  const forOrder = reviews.map((review, index) =>
    review.mark === "official_shop" && offers[index]?.brandShop !== true ? { ...review, mark: "known_shop" as const } : review
  );
  return trustOrder(items, forOrder);
}
