// La page look (lot « page look », migration facultative 0057, décisions du
// fondateur du 23 novembre 2026) : « Partager le look » crée un lien vers une
// page en lecture seule, visible sans compte, qui rejoue un résultat déjà
// payé et enregistré. Règle d'or : la vie privée d'abord ; dans le doute,
// rien ne sort.
//
// - Ce qui est copié à la création (buildLookContent) vient de la recherche
//   relue exactement comme l'écran Résultat la montre (lib/searchRows.ts,
//   toProductSearch : boutiques retirées, mentions, ordre, verdict) : la
//   pièce partagée, puis « Cette pièce dans d'autres boutiques », chaque
//   champ choisi un par un. Jamais la photo ou la capture du membre, le lien
//   de la vidéo, ses mots, un signalement, ni un identifiant interne.
// - Ce que le visiteur reçoit (publicLookOf) est reconstruit, champ par
//   champ, depuis une liste fixe : même une ligne enregistrée qui porterait
//   autre chose (écrite à la main, version future) ne laisse rien passer de
//   plus. Une page illisible répond comme une page inconnue.
// - Aucun appel payant (ni SerpApi, ni IA) : seule l'image de la pièce est
//   copiée par notre serveur (480 px), jamais un lien vers celle de la boutique.
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import {
  LOOK_LIFETIME_DAYS,
  LOOK_OFFERS_MAX,
  LOOK_SECTIONS,
  LOOK_TOKEN_PATTERN,
  OFFER_MARKS,
  VERDICT_LEVELS,
  type LookContent,
  type LookOffer,
  type ProductMatch,
  type ProductSearch,
  type PublicLook,
  type SearchVerdict,
} from "@monapp/shared-types";
import { env } from "../env.js";
import { isAffiliateLink } from "./affiliateLinks.js";
import { PUBLIC_SITE_URL } from "./brand.js";
import { bestSharedCopy, WISH_COPY_BUCKET } from "./wishShare.js";
import { isWebUrl, WEB_URL_MAX_LENGTH } from "./validation.js";

// ---- Schéma de la base (migration 0057) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0057 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const { error } = await fastify.supabaseAdmin.from("shared_looks").select("id").limit(0);
    if (!error) return true;
    fastify.log.warn({ code: error.code ?? null }, "Pages look indisponibles : migration 0057 absente, le bouton reste « Partager »");
  } catch {
    fastify.log.warn({ code: null }, "Pages look indisponibles : schéma illisible, le bouton reste « Partager »");
  }
  return false;
}

/** La base a-t-elle la migration 0057 ? Mémorisé une fois vu ; absent, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. */
export async function lookPagesReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
  if (schemaReadyAt !== null) return true;
  if (schemaMissingAt !== null && now() - schemaMissingAt < SCHEMA_RETRY_MS) return false;
  schemaProbe ??= probeSchema(fastify)
    .then((ready) => {
      if (ready) schemaReadyAt = now();
      else schemaMissingAt = now();
      return ready;
    })
    .finally(() => {
      schemaProbe = null;
    });
  return schemaProbe;
}

/** Tests seulement : oublie la sonde. */
export function resetLookPagesProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

/** L'interrupteur : seule la valeur exacte "true" de LOOK_PAGES_ENABLED permet de créer. */
export function lookPagesSwitchOn(): boolean {
  return env.LOOK_PAGES_ENABLED;
}

// ---- Jeton, lien, dates ----

export const LOOK_LIFETIME_MS = LOOK_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

/** 16 octets aléatoires (128 bits) en base64url : 22 signes, impossibles à deviner. */
export function newLookToken(): string {
  return randomBytes(16).toString("base64url");
}

export function isLookToken(value: unknown): value is string {
  return typeof value === "string" && LOOK_TOKEN_PATTERN.test(value);
}

/** Le lien partagé : un paramètre, pas un segment d'adresse (site exporté en pages statiques). */
export function lookUrl(token: string): string {
  return `${PUBLIC_SITE_URL}/look?l=${token}`;
}

/** Le jeton d'un lien collé par un administrateur (« …/look?l=<jeton> »), ou
 * le jeton seul ; null sinon. */
export function lookTokenFromLink(link: string): string | null {
  const text = link.trim();
  if (isLookToken(text)) return text;
  const match = /[?&]l=([A-Za-z0-9_-]{22})(?:[&#]|$)/.exec(text);
  return match ? match[1]! : null;
}

const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Le jour (heure de Paris) d'une date, « AAAA-MM-JJ » : jamais l'heure. */
export function parisDayOf(iso: string): string | null {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? PARIS_DAY.format(new Date(time)) : null;
}

// ---- Création : ce qui est copié ----

/** Une recherche de plus de 30 jours ne se partage plus (un prix vieux de plusieurs mois serait inutile). */
export const LOOK_SEARCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const NAME_MAX = 200;
const BRAND_MAX = 100;
const SHOP_MAX = 120;
const CURRENCY_MAX = 8;

/** Nom de la boutique, ou à défaut son nom de site (sans « www. »). */
function shopOf(match: Pick<ProductMatch, "merchantName" | "merchantUrl">): string | null {
  const name = match.merchantName?.trim();
  if (name) return name.slice(0, SHOP_MAX);
  try {
    return new URL(match.merchantUrl).hostname.replace(/^www\./, "").slice(0, SHOP_MAX) || null;
  } catch {
    return null;
  }
}

function priceOf(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Une offre de la page, champ par champ ; null si son lien n'est pas un
 * lien web ordinaire de 2 048 caractères au plus (la règle de la lecture,
 * STORED_OFFER : un lien plus long rendrait toute la page illisible). */
function offerOf(match: ProductMatch, section: LookOffer["section"]): LookOffer | null {
  const url = match.affiliateUrl;
  const shop = shopOf(match);
  if (!isWebUrl(url) || url.length > WEB_URL_MAX_LENGTH || shop === null) return null;
  const price = priceOf(match.priceMin);
  const currency = price === null ? null : (match.currency?.trim().slice(0, CURRENCY_MAX) || null);
  return {
    shop,
    url,
    affiliate: isAffiliateLink(match.affiliateUrl, match.merchantUrl),
    price,
    currency,
    mark: match.offerMark ?? null,
    inStock: typeof match.inStock === "boolean" ? match.inStock : null,
    section,
  };
}

/** Pourquoi une recherche ne peut pas (encore) être partagée ; « words_piece » :
 * la pièce vient de « Résultats pour vos mots », qui ne se partage pas. */
export type LookNotReady = "not_completed" | "shops_pending" | "too_old" | "words_piece";

/** Une pièce de « Résultats pour vos mots » ne se partage pas : ses
 * boutiques et le verdict décrivent une autre pièce (celle identifiée sur la
 * photo), et la recherche par les mots a pu être lancée bien après la
 * recherche, dont le jour serait affiché comme « vu le ». */
export function isWordsPiece(search: Pick<ProductSearch, "matches">, matchId: string): boolean {
  return search.matches.find((match) => match.id === matchId)?.origin === "words";
}

/** La recherche relue peut-elle être partagée maintenant ? */
export function lookReadiness(search: Pick<ProductSearch, "status" | "createdAt" | "complement">, shopsPending: boolean, now: number = Date.now()): LookNotReady | null {
  if (search.status !== "completed") return "not_completed";
  if (shopsPending || search.complement?.pending === true) return "shops_pending";
  const createdAt = Date.parse(search.createdAt);
  if (!Number.isFinite(createdAt) || now - createdAt > LOOK_SEARCH_MAX_AGE_MS) return "too_old";
  return null;
}

/** Taille de la page gardée sous la règle de la table (pg_column_size(content)
 * <= 16384) avec de la marge : au-delà, les dernières boutiques sont retirées. */
export const LOOK_CONTENT_MAX_BYTES = 15_000;

/** La page de la pièce `matchId`, depuis la recherche relue comme l'écran la
 * montre (toProductSearch) ; null si la pièce n'y est plus (boutique
 * masquée depuis), n'a pas de lien web, ou vient de « Résultats pour vos
 * mots ». La pièce partagée d'abord ; puis, seulement si c'est la pièce
 * identifiée (la première de la recherche visuelle, ou une de « Cette pièce
 * dans d'autres boutiques »), ces boutiques dans le même ordre, sans elle,
 * 9 au plus, et le verdict. Une autre proposition visuelle est une pièce qui
 * se ressemble : elle est montrée seule, sans boutiques ni verdict. */
export function buildLookContent(search: ProductSearch, matchId: string): LookContent | null {
  const shared = search.matches.find((match) => match.id === matchId);
  const searchedOn = parisDayOf(search.createdAt);
  if (!shared || searchedOn === null || shared.origin === "words") return null;
  const head = offerOf(shared, "shared");
  if (!head) return null;
  const firstLens = search.matches.find((match) => (match.origin ?? "lens") === "lens");
  const identified = shared.origin === "shopping" || shared.id === firstLens?.id;
  const others = identified
    ? search.matches
        .filter((match) => match.origin === "shopping" && match.id !== matchId)
        .flatMap((match) => offerOf(match, "shopping") ?? [])
        .slice(0, LOOK_OFFERS_MAX - 1)
    : [];
  const brand = shared.brand?.trim();
  const content: LookContent = {
    v: 1,
    searchedOn,
    piece: { name: shared.productName.trim().slice(0, NAME_MAX) || head.shop, brand: brand ? brand.slice(0, BRAND_MAX) : null },
    verdict: identified && search.verdict ? verdictOf(search.verdict) : null,
    offers: [head, ...others],
  };
  while (content.offers.length > 1 && Buffer.byteLength(JSON.stringify(content)) > LOOK_CONTENT_MAX_BYTES) content.offers.pop();
  return content;
}

function verdictOf(verdict: SearchVerdict): SearchVerdict {
  return {
    level: verdict.level,
    ...(typeof verdict.shopCount === "number" ? { shopCount: verdict.shopCount } : {}),
    ...(verdict.priceRange ? { priceRange: { min: verdict.priceRange.min, max: verdict.priceRange.max, currency: verdict.priceRange.currency } } : {}),
  };
}

// ---- Lecture : ce qui sort, et rien d'autre ----

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const positive = z.number().finite().positive();

const STORED_VERDICT = z.object({
  level: z.enum(VERDICT_LEVELS),
  shopCount: z.number().int().min(2).optional(),
  priceRange: z.object({ min: positive, max: positive, currency: z.string().regex(/^[A-Z]{3}$/) }).optional(),
});

const STORED_OFFER = z.object({
  shop: z.string().min(1).max(SHOP_MAX),
  url: z.string().max(2048).refine(isWebUrl),
  affiliate: z.boolean(),
  price: positive.nullable(),
  currency: z.string().min(1).max(CURRENCY_MAX).nullable(),
  mark: z.enum(OFFER_MARKS).nullable(),
  inStock: z.boolean().nullable(),
  section: z.enum(LOOK_SECTIONS),
});

const STORED_CONTENT = z.object({
  v: z.literal(1),
  searchedOn: z.string().regex(DAY),
  piece: z.object({ name: z.string().min(1).max(NAME_MAX), brand: z.string().min(1).max(BRAND_MAX).nullable() }),
  verdict: STORED_VERDICT.nullable(),
  offers: z.array(STORED_OFFER).min(1).max(LOOK_OFFERS_MAX),
});

/** Une ligne de shared_looks, telle que la route publique la lit. */
export interface StoredLook {
  user_id: string;
  content: unknown;
  image_path: string | null;
  expires_at: string;
}

/** Dossier des copies d'images des pages look, dans le bucket des photos
 * publiées. Jamais le dossier du membre : son adresse contiendrait
 * l'identifiant de son compte, et une page transmise à un inconnu le
 * dévoilerait (et, par lui, son nom d'utilisateur). Les copies sont donc
 * effacées une à une : à l'arrêt, à l'expiration, avec la recherche
 * (lib/searchRetention.ts) et avec le compte (routes/account.ts). */
export const LOOK_IMAGE_FOLDER = "looks";
const LOOK_IMAGE_PATH = /^looks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

/** Le chemin de la copie de l'image, seulement s'il a la forme attendue (looks/<uuid>.jpg). */
export function lookImagePath(path: string | null | undefined): string | null {
  return typeof path === "string" && LOOK_IMAGE_PATH.test(path) ? path : null;
}

/** Ce que reçoit le visiteur, reconstruit champ par champ (liste fixe) ;
 * null pour une page illisible, que la route traite comme inconnue. */
export function publicLookOf(row: StoredLook, imageUrl: (path: string) => string): PublicLook | null {
  const parsed = STORED_CONTENT.safeParse(row.content);
  const expiresOn = parisDayOf(row.expires_at);
  if (!parsed.success || expiresOn === null) return null;
  const content = parsed.data;
  // La pièce partagée d'abord, puis seulement des boutiques de « Cette pièce dans d'autres boutiques ».
  if (content.offers[0]!.section !== "shared" || content.offers.slice(1).some((offer) => offer.section !== "shopping")) return null;
  const path = lookImagePath(row.image_path);
  return {
    v: 1,
    searchedOn: content.searchedOn,
    expiresOn,
    piece: { name: content.piece.name, brand: content.piece.brand, image: path === null ? null : imageUrl(path) },
    verdict: content.verdict === null ? null : verdictOf(content.verdict),
    offers: content.offers.map((offer) => ({
      shop: offer.shop,
      url: offer.url,
      affiliate: offer.affiliate,
      price: offer.price,
      currency: offer.price === null ? null : offer.currency,
      mark: offer.mark,
      inStock: offer.inStock,
      section: offer.section,
    })),
  };
}

// ---- Copie de l'image ----

/** Bucket de la copie : celui des photos publiées, vidé à la suppression du compte. */
export const LOOK_IMAGE_BUCKET = WISH_COPY_BUCKET;

/** Copie l'image de la pièce (haute définition du marchand, sinon la
 * vignette ; garde-fous de lib/publicImage.ts), ré-encodée en JPEG sans
 * métadonnées, et n'en range que la petite taille (480 px) sous un nom
 * aléatoire, sans rien du membre : post-media/looks/<uuid>.jpg. Échec :
 * null, la page est créée sans image (jamais de lien vers l'image de la
 * boutique). */
export async function copyLookImage(fastify: FastifyInstance, log: FastifyBaseLogger, match: { id: string; image_url: string }): Promise<string | null> {
  try {
    const copy = await bestSharedCopy(fastify, log, { image_url: match.image_url, product_match_id: match.id }, "d'une page look");
    const path = `${LOOK_IMAGE_FOLDER}/${randomUUID()}.jpg`;
    const { error } = await fastify.supabaseAdmin.storage.from(LOOK_IMAGE_BUCKET).upload(path, copy.thumb, { contentType: "image/jpeg", upsert: false });
    if (error) {
      log.warn("Page look : copie de l'image non rangée, page sans image");
      return null;
    }
    return path;
  } catch {
    log.warn("Page look : image irrécupérable, page sans image");
    return null;
  }
}

/** Efface des copies (seulement des chemins de la forme looks/<uuid>.jpg) ; ne lève jamais. */
export async function removeLookImages(fastify: FastifyInstance, paths: (string | null)[]): Promise<void> {
  const own = paths.flatMap((path) => lookImagePath(path) ?? []);
  if (own.length === 0) return;
  try {
    const { error } = await fastify.supabaseAdmin.storage.from(LOOK_IMAGE_BUCKET).remove(own);
    if (error) fastify.log.warn({ count: own.length }, "Page look : copie d'image restée dans le stockage");
  } catch {
    fastify.log.warn({ count: own.length }, "Page look : copie d'image restée dans le stockage");
  }
}

const IMAGE_ROWS = z.array(z.object({ image_path: z.string().nullable() }));

/** Les copies d'images des pages de `userId` ; seulement celles des
 * recherches `searchIds` quand elles sont données. Sans 0057 : aucune.
 * Lecture impossible : une erreur (l'appelant décide). */
export async function lookImagesOf(fastify: FastifyInstance, userId: string, searchIds?: string[]): Promise<string[]> {
  if (!(await lookPagesReady(fastify))) return [];
  if (searchIds !== undefined && searchIds.length === 0) return [];
  let query = fastify.supabaseAdmin.from("shared_looks").select("image_path").eq("user_id", userId);
  if (searchIds !== undefined) query = query.in("search_id", searchIds);
  const { data, error } = await query;
  if (error) throw new Error("Lecture des pages look impossible");
  const rows = IMAGE_ROWS.safeParse(data ?? []);
  if (!rows.success) throw new Error("Pages look illisibles");
  return rows.data.flatMap((row) => lookImagePath(row.image_path) ?? []);
}
