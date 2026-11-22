// Le verdict (lot « verdict ») : la phrase de tête de l'écran Résultat, telle
// que le serveur l'a décidée (apps/backend/src/lib/verdict.ts, migration
// facultative 0055) à partir des titres des boutiques. L'app ne décide rien :
// elle relit le champ, n'en garde qu'une forme connue (un serveur plus récent
// pourrait en ajouter une), et écrit la phrase. Absent : rien n'est affiché.
// Le verdict ne change l'ordre de rien. Logique pure, testée. Imports
// relatifs : fichier testé par vitest.
import { VERDICT_LEVELS, type SearchVerdict, type VerdictLevel } from "@monapp/shared-types";
import type { Catalog } from "../i18n/types";
import { formatPrice } from "./format";
import type { Locale } from "./preferences";

function isLevel(value: unknown): value is VerdictLevel {
  return typeof value === "string" && (VERDICT_LEVELS as readonly string[]).includes(value);
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Le verdict reçu, seulement sous une forme connue ; undefined sinon (rien d'affiché).
 * Le nombre de boutiques n'est gardé qu'avec « identified » et à partir de 2 ;
 * la fourchette, seulement avec lui, et seulement cohérente (deux prix
 * positifs, le plus bas d'abord, un code de devise ISO). */
export function parseVerdict(raw: unknown): SearchVerdict | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (!isLevel(value.level)) return undefined;
  if (value.level !== "identified") return { level: value.level };
  // « identified » sans un nombre de boutiques lisible : rien n'est affirmé.
  if (!Number.isInteger(value.shopCount) || (value.shopCount as number) < 2) return undefined;
  const range = value.priceRange as Record<string, unknown> | undefined;
  const rangeOk =
    typeof range === "object" && range !== null && positive(range.min) && positive(range.max) && range.min <= range.max && typeof range.currency === "string" && /^[A-Z]{3}$/.test(range.currency);
  return {
    level: "identified",
    shopCount: value.shopCount as number,
    ...(rangeOk ? { priceRange: { min: range.min as number, max: range.max as number, currency: range.currency as string } } : {}),
  };
}

/** La phrase, dans la langue du catalogue donné. */
export function verdictSentence(verdict: SearchVerdict, texts: Catalog["result"]["verdict"], locale: Locale): string {
  if (verdict.level === "close") return texts.close;
  if (verdict.level === "lookalikes") return texts.lookalikes;
  const shops = verdict.shopCount ?? 2;
  const range = verdict.priceRange;
  if (!range) return texts.identified(shops);
  if (range.min === range.max) return texts.identifiedOnePrice(shops, formatPrice(range.min, range.currency, locale));
  return texts.identifiedWithPrices(shops, formatPrice(range.min, range.currency, locale), formatPrice(range.max, range.currency, locale));
}

/** Faut-il envoyer verdict_shown ? Une fois par résultat affiché, et de
 * nouveau si le niveau change (boutiques arrivées ensuite) : `last` est ce
 * qui a déjà été envoyé pour cet écran (identifiant de la recherche et niveau). */
export function verdictToTrack(
  searchId: string | null,
  verdict: SearchVerdict | undefined,
  last: { searchId: string | null; level: VerdictLevel } | null
): { searchId: string | null; level: VerdictLevel } | null {
  if (!verdict) return null;
  if (last && last.searchId === searchId && last.level === verdict.level) return null;
  return { searchId, level: verdict.level };
}
