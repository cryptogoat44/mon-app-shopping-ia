// La page look (lot « page look », migration 0057, décisions du fondateur du
// 23 novembre 2026) : logique pure, testée (tests/page-look.test.ts).
// Règle d'or : la vie privée d'abord ; dans le doute, rien ne s'affiche.
//
// - parsePublicLook : la réponse de GET /api/looks/public/:token, revérifiée
//   champ par champ (forme, version 1, liens http(s) seulement, image
//   seulement sous l'adresse publique des copies de notre stockage) ; tout
//   écart donne « introuvable ».
// - Les phrases de la page (prix datés, stock daté, verdict daté, libellés
//   des liens) et le message partagé.
// - lookShareAllowed : quand « Partager » devient « Partager le look ».
// Imports relatifs : fichier testé par vitest.
import {
  LOOK_OFFERS_MAX,
  LOOK_SECTIONS,
  LOOK_TOKEN_PATTERN,
  OFFER_MARKS,
  type LookOffer,
  type LookPagesStatus,
  type PublicLook,
  type SearchVerdict,
} from "@monapp/shared-types";
import type { Catalog } from "../i18n/types";
import type { Piece, SpotResult } from "../api/types";
import { formatLongDate, formatPrice, formatShortDate } from "./format";
import type { Locale } from "./preferences";
import { parseVerdict, verdictSentence } from "./verdict";
import { isWebUrl } from "./web-url";

/** Chemin de l'écran public (hors des groupes protégés, lib/root-route.ts). */
export const LOOK_PATH = "/look";

/** Une recherche de plus de 30 jours ne se partage plus. */
export const LOOK_SEARCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Le jeton lu dans l'adresse (/look?l=…), seulement s'il a la bonne forme ;
 * sinon null : la page est « introuvable » sans rien demander au serveur. */
export function lookTokenFrom(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && LOOK_TOKEN_PATTERN.test(raw) ? raw : null;
}

/** Préfixe des copies d'images des pages look dans notre stockage Supabase. */
export function lookImagePrefix(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl || !isWebUrl(supabaseUrl)) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/post-media/looks/`;
}

const IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() !== "" && value.length <= max;
const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function offerOf(raw: unknown): LookOffer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!isText(value.shop, 120) || !isWebUrl(value.url) || typeof value.affiliate !== "boolean") return null;
  if (!(LOOK_SECTIONS as readonly unknown[]).includes(value.section)) return null;
  const price = value.price === null ? null : isPrice(value.price) ? value.price : undefined;
  if (price === undefined) return null;
  const currency = price === null || value.currency === null ? null : isText(value.currency, 8) ? value.currency : undefined;
  if (currency === undefined) return null;
  const mark = value.mark === null ? null : (OFFER_MARKS as readonly unknown[]).includes(value.mark) ? (value.mark as LookOffer["mark"]) : undefined;
  if (mark === undefined) return null;
  const inStock = value.inStock === null ? null : typeof value.inStock === "boolean" ? value.inStock : undefined;
  if (inStock === undefined) return null;
  return { shop: value.shop, url: value.url, affiliate: value.affiliate, price, currency, mark, inStock, section: value.section as LookOffer["section"] };
}

/** La page reçue, revérifiée ; null (« introuvable ») au moindre écart. */
export function parsePublicLook(raw: unknown, imagePrefix: string | null): PublicLook | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== 1 || typeof value.searchedOn !== "string" || !DAY.test(value.searchedOn) || typeof value.expiresOn !== "string" || !DAY.test(value.expiresOn)) return null;
  const piece = value.piece as Record<string, unknown> | null;
  if (typeof piece !== "object" || piece === null || !isText(piece.name, 200)) return null;
  const brand = piece.brand === null ? null : isText(piece.brand, 100) ? piece.brand : undefined;
  if (brand === undefined) return null;
  let image: string | null = null;
  if (piece.image !== null) {
    // Seulement une copie de notre stockage : jamais une image d'un autre site.
    if (typeof piece.image !== "string" || imagePrefix === null || !piece.image.startsWith(imagePrefix) || !IMAGE_NAME.test(piece.image.slice(imagePrefix.length))) return null;
    image = piece.image;
  }
  let verdict: SearchVerdict | null = null;
  if (value.verdict !== null) {
    const parsed = parseVerdict(value.verdict);
    if (!parsed) return null;
    verdict = parsed;
  }
  if (!Array.isArray(value.offers) || value.offers.length === 0 || value.offers.length > LOOK_OFFERS_MAX) return null;
  const offers = value.offers.map(offerOf);
  if (offers.some((offer) => offer === null)) return null;
  const kept = offers as LookOffer[];
  if (kept[0]!.section !== "shared" || kept.slice(1).some((offer) => offer.section !== "shopping")) return null;
  return { v: 1, searchedOn: value.searchedOn, expiresOn: value.expiresOn, piece: { name: piece.name, brand, image }, verdict, offers: kept };
}

type LookTexts = Catalog["look"];

/** « 49,95 € · vu le 23 nov. 2026 », ou « Prix à vérifier chez le marchand » : jamais un prix sans sa date. */
export function lookPriceText(offer: Pick<LookOffer, "price" | "currency">, searchedOn: string, texts: LookTexts, priceOnSite: string, locale: Locale): string {
  if (offer.price === null) return priceOnSite;
  return texts.priceSeen(formatPrice(offer.price, offer.currency, locale), formatShortDate(searchedOn, locale));
}

/** « En stock, d'après Google le 23 nov. 2026 » ; null quand c'est inconnu. */
export function lookStockText(offer: Pick<LookOffer, "inStock">, searchedOn: string, texts: LookTexts, locale: Locale): string | null {
  if (offer.inStock === null) return null;
  const date = formatShortDate(searchedOn, locale);
  return offer.inStock ? texts.inStock(date) : texts.soldOut(date);
}

/** La phrase du verdict que le membre voyait, la date à la place de « au moment de la recherche ». */
export function lookVerdictSentence(verdict: SearchVerdict, searchedOn: string, catalog: Pick<Catalog, "look" | "result">, locale: Locale): string {
  const range = verdict.level === "identified" ? verdict.priceRange : undefined;
  if (!range) return verdictSentence(verdict, catalog.result.verdict, locale);
  const shops = verdict.shopCount ?? 2;
  const date = formatShortDate(searchedOn, locale);
  if (range.min === range.max) return catalog.look.verdictIdentifiedOnePrice(shops, formatPrice(range.min, range.currency, locale), date);
  return catalog.look.verdictIdentifiedWithPrices(shops, formatPrice(range.min, range.currency, locale), formatPrice(range.max, range.currency, locale), date);
}

/** Libellé lu par VoiceOver sur un lien de boutique : « Voir chez Zara, 49,95 €, vu le 23 nov. 2026 ». */
export function lookShopLinkLabel(offer: Pick<LookOffer, "shop" | "price" | "currency">, searchedOn: string, texts: LookTexts, locale: Locale): string {
  if (offer.price === null) return texts.shopLinkLabelNoPrice(offer.shop);
  return texts.shopLinkLabel(offer.shop, formatPrice(offer.price, offer.currency, locale), formatShortDate(searchedOn, locale));
}

/** « Prix et stock vus dans les boutiques le 23 novembre 2026… » */
export function lookDateNote(searchedOn: string, texts: LookTexts, locale: Locale): string {
  return texts.dateNote(formatLongDate(searchedOn, locale));
}

/** Le message partagé : la phrase, puis le lien de la page (aucune mention
 * « lien affilié » : il mène à Spotto, la mention est sur la page). */
export function lookShareMessage(pieceName: string, url: string, texts: LookTexts): string {
  return `${texts.shareMessage(pieceName)}\n${url}`;
}

/** « Signaler cette page » : un e-mail à l'éditeur, le lien de la page dans le corps ; null sans adresse réelle. */
export function lookReportMailto(email: string | null, pageUrl: string, texts: Pick<LookTexts, "reportSubject">): string | null {
  if (!email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(texts.reportSubject)}&body=${encodeURIComponent(pageUrl)}`;
}

/** « Partager le look » à la place de « Partager » ? Seulement quand le
 * serveur le permet (statut lu, 0057 et l'interrupteur), pour une vraie
 * proposition (jamais une pièce de démonstration), d'une recherche terminée
 * dont les boutiques sont arrivées, de moins de 30 jours. Sinon : le bouton
 * d'aujourd'hui, inchangé. */
export function lookShareAllowed(
  status: LookPagesStatus | null,
  piece: Pick<Piece, "real"> | null,
  result: Pick<SpotResult, "searchId" | "status" | "complement" | "createdAt"> | null,
  now: number = Date.now()
): boolean {
  if (status?.enabled !== true || piece?.real !== true || !result?.searchId || result.status !== "success") return false;
  if (result.complement?.pending === true) return false;
  const createdAt = Date.parse(result.createdAt ?? "");
  return Number.isFinite(createdAt) && now - createdAt <= LOOK_SEARCH_MAX_AGE_MS;
}

/** Jour (« AAAA-MM-JJ ») d'une date, pour la feuille de confirmation. */
export function dayOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ---- « Trouver la mienne » : inscription venue d'une page (statistiques) ----
// Drapeau gardé en MÉMOIRE seulement (jamais sur l'appareil ni dans
// l'adresse) : l'inscription est partie de « Trouver la mienne » dans cette
// session de l'onglet. Lu une fois par complete-profile.tsx pour look_signup.

let signupFromLook = false;

export function markSignupFromLook(): void {
  signupFromLook = true;
}

/** Vrai une seule fois, puis oublié. */
export function takeSignupFromLook(): boolean {
  const value = signupFromLook;
  signupFromLook = false;
  return value;
}

/** Le statut reçu de GET /api/looks/status, seulement sous une forme connue ;
 * tout le reste (ancien serveur : 404, réponse illisible) : tout caché. */
export function readLookPagesStatus(body: unknown): LookPagesStatus {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const manage = value.manage === true;
  return { enabled: manage && value.enabled === true, manage };
}
