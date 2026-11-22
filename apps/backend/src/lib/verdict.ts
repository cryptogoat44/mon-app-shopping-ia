// Le verdict (lot « verdict », migration facultative 0055) : une phrase en tête
// de l'écran Résultat dit si Spotto a retrouvé la même pièce dans plusieurs
// boutiques, ou seulement des pièces qui se ressemblent. Fonction pure, sans
// réseau ni base : elle se calcule à chaque relecture, à partir des
// propositions réellement montrées (celles que les règles des boutiques
// douteuses gardent, lib/shopTrust.ts), pour que la phrase dise exactement ce
// que l'écran affiche. Elle ne change l'ordre de rien.
//
// Règle d'or : la prudence. Annoncer « la même pièce » à tort serait
// trompeur ; dans le doute, le verdict est le plus modeste, et quand on ne
// sait pas, il n'y en a pas du tout. Les seuils :
// - « identified » : au moins VERDICT_MIN_SHOPS (2) boutiques DISTINCTES de
//   « Cette pièce dans d'autres boutiques » nomment dans leur titre la marque
//   ET le modèle de la pièce (palier 0, lib/lightSort.ts, verdictTier), et ne
//   comptent que les boutiques connues et les sites officiels des marques
//   (listes du fondateur, src/listes/) : sur Google Shopping, des titres
//   « bourrés de marques » de boutiques inconnues suffiraient sinon. Deux
//   offres d'une même enseigne (même adresse, ou deux pays de la même
//   enseigne : zalando.fr et zalando.be) comptent pour une. Une offre signalée
//   (prix inhabituellement bas ou adresse douteuse : rangée en fin de
//   section) ne compte jamais, ni une offre retirée.
// - « close » : sinon, une offre gardée et non signalée au moins nomme la
//   marque dans son titre (palier 0 ou 1) — modèle absent, une seule
//   boutique, ou seulement des boutiques inconnues.
// - « lookalikes » : rien de tel, ou pas de recherche dans les boutiques
//   parce que la pièce n'a pas de marque reconnue (« no_query »), que les
//   boutiques n'ont rien renvoyé (« empty ») ou que l'IA est coupée
//   (« skipped »).
// - Aucun verdict (on ne sait pas) : base sans 0055 (la route ne le demande
//   alors pas : sonde lib/verdictColumn.ts), recherche ou ligne des boutiques d'avant 0055 (palier vide),
//   boutiques encore attendues (« pending », « running ») ou étape non
//   terminée, étape en échec (« ai_failed », « shopping_failed », « no_time »,
//   « no_capacity », « error »), voie C qui n'a pas tourné, recherche non
//   terminée ou sans proposition montrée.
// Avec « identified » seulement : le nombre de boutiques comptées, et la
// fourchette de leurs prix quand au moins deux d'entre elles en affichaient
// un, tous dans la même devise reconnue (jamais converti ni mélangé).
import { alertCurrency, type MatchOrigin, type OfferMark, type SearchVerdict } from "@monapp/shared-types";
import { deferredStateOf } from "./deferredComplement.js";
import type { MatchRow, SearchRow } from "./searchRows.js";
import { knownShopName } from "./shopTrust.js";

/** Boutiques distinctes, connues ou officielles, nécessaires pour « identified ». */
export const VERDICT_MIN_SHOPS = 2;
/** Prix (de boutiques distinctes) nécessaires pour la fourchette. */
export const VERDICT_MIN_PRICES = 2;

/** Une proposition montrée, telle que la relecture la met en forme
 * (lib/searchRows.ts, trustedMatches) : sa ligne, sa mention, et si elle est
 * signalée (rangée en fin de section). Les offres retirées n'y sont pas. */
export interface ShownMatch {
  match: Pick<MatchRow, "merchant_url" | "price_min" | "currency" | "origin" | "title_tier">;
  mark: OfferMark | null;
  demoted: boolean;
}

/** Issues du complément qui disent qu'aucune boutique ne s'accorde. */
const LOOKALIKE_STATUSES: ReadonlySet<string> = new Set(["no_query", "empty", "skipped"]);

function priceOf(value: number | string | null): number | null {
  if (value === null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** La fourchette des prix des offres comptées : au moins VERDICT_MIN_PRICES
 * boutiques distinctes avec un prix, toutes dans la même devise reconnue
 * (code ISO) ; un seul prix dans une autre devise, ou dans une devise
 * illisible, et il n'y a pas de fourchette. */
function priceRangeOf(offers: readonly { shop: string; match: ShownMatch["match"] }[]): SearchVerdict["priceRange"] {
  const priced = offers.flatMap(({ shop, match }) => {
    const amount = priceOf(match.price_min);
    return amount === null ? [] : [{ shop, amount, currency: alertCurrency(match.currency, null) }];
  });
  const currencies = new Set(priced.map((offer) => offer.currency));
  const currency = priced[0]?.currency;
  if (currencies.size !== 1 || typeof currency !== "string") return undefined;
  if (new Set(priced.map((offer) => offer.shop)).size < VERDICT_MIN_PRICES) return undefined;
  const amounts = priced.map((offer) => offer.amount);
  return { min: Math.min(...amounts), max: Math.max(...amounts), currency };
}

/** Le verdict d'une recherche relue, sur une base qui a 0055 (la route l'a
 * vérifié) ; undefined : on ne sait pas, rien n'est affirmé. */
export function searchVerdict(
  row: Pick<SearchRow, "status" | "complement_status" | "complement_deferred" | "complement_deferred_at">,
  shown: readonly ShownMatch[],
  now: number = Date.now()
): SearchVerdict | undefined {
  if (row.status !== "completed" || shown.length === 0) return undefined;
  // Boutiques encore attendues, ou étape jamais close : on ne sait pas encore.
  const deferred = deferredStateOf(row, now);
  if (deferred !== "none" && deferred !== "done") return undefined;
  const status = row.complement_status ?? null;
  if (status !== null && LOOKALIKE_STATUSES.has(status)) return { level: "lookalikes" };
  if (status !== "shown") return undefined;

  const shopping = shown.filter(({ match }) => (match.origin ?? ("lens" as MatchOrigin)) === "shopping");
  // Une ligne des boutiques sans palier (rangée avant 0055, ou insertion
  // refaite sans lui) : le verdict ne se calcule jamais sur une partie.
  if (shopping.some(({ match }) => match.title_tier === null || match.title_tier === undefined)) return undefined;
  const counted = shopping.filter(({ demoted }) => !demoted);

  const agreeing = counted.flatMap(({ match, mark }) => {
    const shop = match.title_tier === 0 && (mark === "known_shop" || mark === "official_shop") ? knownShopName(match.merchant_url) : null;
    return shop === null ? [] : [{ shop, match }];
  });
  const shopCount = new Set(agreeing.map(({ shop }) => shop)).size;
  if (shopCount >= VERDICT_MIN_SHOPS) {
    const priceRange = priceRangeOf(agreeing);
    return { level: "identified", shopCount, ...(priceRange ? { priceRange } : {}) };
  }
  if (counted.some(({ match }) => match.title_tier === 0 || match.title_tier === 1)) return { level: "close" };
  return { level: "lookalikes" };
}
