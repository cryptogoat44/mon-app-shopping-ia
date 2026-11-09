// Collections d'envies (lot collections, migration 0033). Règles, en un
// seul endroit :
// - une collection est privée par défaut ; « Mes amis » la montre aux
//   membres qui suivent son auteur et qu'il suit (les mêmes amis que pour
//   les messages) ;
// - un blocage, dans un sens ou dans l'autre, la cache ; un compte suspendu
//   ne montre plus ses collections ; pour tous ces cas, la même réponse
//   « introuvable » qu'une collection qui n'existe pas ;
// - les amis voient le titre, la copie de l'image faite par notre serveur,
//   le prix et le lien vers la boutique ; jamais l'image du marchand, jamais
//   la référence notée par la personne ;
// - la copie (lib/wishShare.ts, même choix de l'image que pour republier ou
//   envoyer une pièce) est faite quand l'envie devient visible par les amis,
//   et effacée quand elle ne l'est plus par aucune collection. Copie
//   impossible : l'envie est montrée sans image, jamais avec l'adresse
//   d'origine.
// Ici aussi : la sonde du schéma (le serveur fonctionne sans 0033 : routes
// « indisponibles », app sans collections). Le nom d'une collection n'est
// jamais écrit au journal.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import {
  COLLECTION_ITEMS_MAX,
  COLLECTION_NAME_MAX_LENGTH,
  COLLECTION_VISIBILITIES,
  COLLECTIONS_MAX,
  type CollectionSummary,
  type SharedCollectionItem,
} from "@monapp/shared-types";
import { fetchAffiliateUrls } from "./affiliateLinks.js";
import { isSuspended } from "./moderation.js";
import { chunks, readAll } from "./pagedReads.js";
import { extractOwnedStoragePath } from "./storage.js";
import { DatabaseReadError, parseDbRows, webUrlOrNull } from "./validation.js";
import { isBlockedEitherWay, isFollowing } from "./visibility.js";
import { WISH_COPY_BUCKET, WishImageError, copyWishImage, deleteWishCopy, wishRowSchema, type WishRow } from "./wishShare.js";

// ---- Réponses ----

export const COLLECTIONS_UNAVAILABLE = { error: "collections_unavailable", message: "Les collections ne sont pas encore disponibles." } as const;
/** Même réponse pour une collection inexistante, d'un autre, privée, ou
 * cachée (pas amis, blocage, compte suspendu) : rien ne dit pourquoi. */
export const COLLECTION_NOT_FOUND = { error: "collection_not_found", message: "Collection introuvable." } as const;
export const INVALID_COLLECTION = { error: "invalid_body", message: "Collection invalide." } as const;
export const COLLECTION_NAME_EMPTY = { error: "invalid_body", message: "Donnez un nom à la collection." } as const;
export const COLLECTION_NAME_TOO_LONG = {
  error: "invalid_body",
  message: `Le nom est trop long (${COLLECTION_NAME_MAX_LENGTH} caractères maximum).`,
} as const;
export const COLLECTION_LIMIT = {
  error: "collection_limit",
  message: `Vous avez déjà ${COLLECTIONS_MAX} collections : supprimez-en une pour en créer une autre.`,
} as const;
export const COLLECTION_FULL = {
  error: "collection_full",
  message: `Cette collection contient déjà ${COLLECTION_ITEMS_MAX} envies : retirez-en une pour en ajouter une autre.`,
} as const;

// ---- Lignes de la base ----

const ID = z.string().uuid();
const TIMESTAMP = z.string().min(1);

export const COLLECTION_COLUMNS = "id, user_id, name, visibility, visibility_changed_at, created_at, updated_at";
export const COLLECTION_ROWS = z.array(
  z.object({
    id: ID,
    user_id: ID,
    name: z.string(),
    visibility: z.enum(COLLECTION_VISIBILITIES),
    visibility_changed_at: TIMESTAMP.nullable(),
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  })
);
export type CollectionRow = z.infer<typeof COLLECTION_ROWS>[number];

export const ITEM_COLUMNS = "id, collection_id, wishlist_item_id, user_id, created_at";
export const ITEM_ROWS = z.array(z.object({ id: ID, collection_id: ID, wishlist_item_id: ID, user_id: ID, created_at: TIMESTAMP }));
export type ItemRow = z.infer<typeof ITEM_ROWS>[number];

const COPY_ROWS = z.array(z.object({ wishlist_item_id: ID, image_url: z.string(), image_thumb_url: z.string() }));
type CopyRow = z.infer<typeof COPY_ROWS>[number];

// Ce que les amis peuvent lire d'une envie : jamais image_url (l'adresse du
// marchand) ni reference (une note de la personne).
const SHARED_WISH_COLUMNS = "id, title, price_min, currency, merchant_name, merchant_url, product_match_id";
const SHARED_WISH_ROWS = z.array(
  z.object({
    id: ID,
    title: z.string(),
    price_min: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
    merchant_name: z.string().nullable(),
    merchant_url: z.string().nullable(),
    product_match_id: ID.nullable(),
  })
);

/** Nom d'une collection : espaces de début et de fin retirés, suites
 * d'espaces (retours à la ligne compris) réduites à une seule. */
export function normalizeCollectionName(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim();
}

/** Longueur comptée comme la base (char_length : un emoji vaut 1). */
export function nameLength(name: string): number {
  return [...name].length;
}

function priceOf(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

export function toCollectionSummary(row: CollectionRow, itemCount: number): CollectionSummary {
  return { id: row.id, name: row.name, visibility: row.visibility, itemCount, createdAt: row.created_at };
}

// ---- Qui voit quoi ----

/** `viewerId` voit-il les collections « Mes amis » de `ownerId` ? Lui-même
 * toujours ; sinon seulement entre amis (chacun suit l'autre), sans blocage
 * dans un sens ou dans l'autre, et jamais celles d'un compte suspendu. */
export async function canSeeFriendCollections(fastify: FastifyInstance, viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const [blocked, suspended, viewerFollows, ownerFollows] = await Promise.all([
    isBlockedEitherWay(fastify, viewerId, ownerId),
    isSuspended(fastify, ownerId),
    isFollowing(fastify, viewerId, ownerId),
    isFollowing(fastify, ownerId, viewerId),
  ]);
  return !blocked && !suspended && viewerFollows && ownerFollows;
}

/** La collection `id`, ou null. */
export async function readCollection(fastify: FastifyInstance, id: string): Promise<CollectionRow | null> {
  const rows = parseDbRows(COLLECTION_ROWS, await fastify.supabaseAdmin.from("collections").select(COLLECTION_COLUMNS).eq("id", id).limit(1), "Collection");
  return rows[0] ?? null;
}

/** La collection `id` de `userId` (jamais celle d'un autre), ou null. */
export async function readOwnCollection(fastify: FastifyInstance, userId: string, id: string): Promise<CollectionRow | null> {
  const row = await readCollection(fastify, id);
  return row && row.user_id === userId ? row : null;
}

/** La collection `id` telle qu'un ami la voit : montrée aux amis et visible
 * par `viewerId` (son auteur compris) ; sinon null, quelle que soit la raison. */
export async function readSharedCollection(fastify: FastifyInstance, viewerId: string, id: string): Promise<CollectionRow | null> {
  const row = await readCollection(fastify, id);
  if (!row || row.visibility !== "friends") return null;
  return (await canSeeFriendCollections(fastify, viewerId, row.user_id)) ? row : null;
}

/** Une envie d'une collection montrée aux amis, visible par `viewerId`, ou null. */
export async function readSharedItem(fastify: FastifyInstance, viewerId: string, itemId: string): Promise<{ item: ItemRow; collection: CollectionRow } | null> {
  const [item] = parseDbRows(ITEM_ROWS, await fastify.supabaseAdmin.from("collection_items").select(ITEM_COLUMNS).eq("id", itemId).limit(1), "Envie d'une collection");
  if (!item) return null;
  const collection = await readSharedCollection(fastify, viewerId, item.collection_id);
  return collection ? { item, collection } : null;
}

/** L'envie complète derrière une envie de collection (pour « Garder » et
 * « En parler » : lue par le serveur, jamais renvoyée telle quelle). */
export async function readItemWish(fastify: FastifyInstance, item: ItemRow): Promise<WishRow | null> {
  const { data, error } = await fastify.supabaseAdmin.from("wishlist_items").select("*").eq("id", item.wishlist_item_id).eq("user_id", item.user_id).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'une envie impossible");
  if (data === null) return null;
  const parsed = wishRowSchema.safeParse(data);
  if (!parsed.success) throw new DatabaseReadError("Envie illisible");
  return parsed.data;
}

/** Copie montrée aux amis : seulement une adresse de notre stockage, dans le
 * dossier de l'auteur de l'envie (jamais une autre adresse, même rangée par erreur). */
function ownCopyUrl(url: string, ownerId: string): string | null {
  return extractOwnedStoragePath(url, WISH_COPY_BUCKET, ownerId) ? url : null;
}

async function readCopies(fastify: FastifyInstance, ownerId: string, wishIds: string[]): Promise<Map<string, CopyRow>> {
  const copies = new Map<string, CopyRow>();
  for (const part of chunks([...new Set(wishIds)])) {
    const rows = parseDbRows(
      COPY_ROWS,
      await fastify.supabaseAdmin.from("collection_image_copies").select("wishlist_item_id, image_url, image_thumb_url").eq("user_id", ownerId).in("wishlist_item_id", part),
      "Copies des images des collections"
    );
    for (const row of rows) copies.set(row.wishlist_item_id, row);
  }
  return copies;
}

/** Les envies d'une collection telles que les amis les voient (dans l'ordre
 * de `items`). L'image est la copie de notre stockage, ou null. */
export async function toSharedItems(fastify: FastifyInstance, ownerId: string, items: ItemRow[]): Promise<SharedCollectionItem[]> {
  if (items.length === 0) return [];
  const wishIds = items.map((item) => item.wishlist_item_id);
  const [wishes, copies] = await Promise.all([
    fastify.supabaseAdmin
      .from("wishlist_items")
      .select(SHARED_WISH_COLUMNS)
      .eq("user_id", ownerId)
      .in("id", wishIds)
      .then((result) => parseDbRows(SHARED_WISH_ROWS, result, "Envies d'une collection")),
    readCopies(fastify, ownerId, wishIds),
  ]);
  const wishById = new Map(wishes.map((wish) => [wish.id, wish]));
  const affiliateUrls = await fetchAffiliateUrls(fastify, [...new Set(wishes.map((wish) => wish.product_match_id).filter((id): id is string => id !== null))]);
  return items.flatMap((item) => {
    const wish = wishById.get(item.wishlist_item_id);
    if (!wish) return [];
    const copy = copies.get(item.wishlist_item_id);
    const imageUrl = copy ? ownCopyUrl(copy.image_url, ownerId) : null;
    const imageThumbUrl = copy ? ownCopyUrl(copy.image_thumb_url, ownerId) : null;
    const affiliateUrl = wish.product_match_id ? (affiliateUrls.get(wish.product_match_id) ?? null) : null;
    return [
      {
        id: item.id,
        title: wish.title,
        // Les deux tailles ou aucune : jamais une image à moitié.
        imageUrl: imageUrl && imageThumbUrl ? imageUrl : null,
        imageThumbUrl: imageUrl && imageThumbUrl ? imageThumbUrl : null,
        merchantName: wish.merchant_name,
        merchantUrl: webUrlOrNull(affiliateUrl ?? wish.merchant_url),
        isAffiliate: affiliateUrl !== null && affiliateUrl !== wish.merchant_url,
        productMatchId: wish.product_match_id,
        priceMin: priceOf(wish.price_min),
        currency: wish.currency,
        addedAt: item.created_at,
      },
    ];
  });
}

/** Nombre d'envies et couverture (la copie de la première envie qui en a
 * une, dans l'ordre des envies les plus récemment ajoutées) de chaque
 * collection de `ownerId` listée. */
export async function collectionStats(
  fastify: FastifyInstance,
  ownerId: string,
  collectionIds: string[],
  withCovers: boolean
): Promise<Map<string, { itemCount: number; coverUrl: string | null }>> {
  const stats = new Map(collectionIds.map((id) => [id, { itemCount: 0, coverUrl: null as string | null }]));
  if (collectionIds.length === 0) return stats;
  const db = fastify.supabaseAdmin;
  const items: { collection_id: string; wishlist_item_id: string; created_at: string; id: string }[] = [];
  for (const part of chunks(collectionIds)) {
    items.push(
      ...(await readAll<{ collection_id: string; wishlist_item_id: string; created_at: string; id: string }>(
        "Envies des collections",
        () => db.from("collection_items").select("id, collection_id, wishlist_item_id, created_at", { count: "exact" }).eq("user_id", ownerId).in("collection_id", part),
        ["created_at", "id"]
      ))
    );
  }
  for (const item of items) {
    const entry = stats.get(item.collection_id);
    if (entry) entry.itemCount += 1;
  }
  if (!withCovers) return stats;
  const copies = await readCopies(fastify, ownerId, items.map((item) => item.wishlist_item_id));
  // Les plus récemment ajoutées d'abord, comme dans la collection.
  for (const item of [...items].reverse()) {
    const entry = stats.get(item.collection_id);
    const copy = copies.get(item.wishlist_item_id);
    if (entry && entry.coverUrl === null && copy) entry.coverUrl = ownCopyUrl(copy.image_thumb_url, ownerId);
  }
  return stats;
}

// ---- Copies des images montrées aux amis ----

/** Copies faites en même temps, au plus (téléchargement, ré-encodage, envoi). */
const COPY_CONCURRENCY = 4;

async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await run(item);
    }
  });
  await Promise.all(workers);
}

/** Envies de `userId` visibles par ses amis (dans au moins une de ses
 * collections « Mes amis »), parmi `wishIds`. */
async function friendVisibleWishes(fastify: FastifyInstance, userId: string, wishIds: string[]): Promise<Set<string>> {
  const db = fastify.supabaseAdmin;
  const shared = parseDbRows(
    z.array(z.object({ id: ID })),
    await db.from("collections").select("id").eq("user_id", userId).eq("visibility", "friends"),
    "Collections montrées aux amis"
  ).map((row) => row.id);
  const visible = new Set<string>();
  if (shared.length === 0) return visible;
  for (const part of chunks(wishIds)) {
    const rows = parseDbRows(
      z.array(z.object({ wishlist_item_id: ID })),
      await db.from("collection_items").select("wishlist_item_id").eq("user_id", userId).in("wishlist_item_id", part).in("collection_id", shared),
      "Envies montrées aux amis"
    );
    for (const row of rows) visible.add(row.wishlist_item_id);
  }
  return visible;
}

/** Fait la copie d'une envie et l'enregistre. Copie impossible : rien n'est
 * enregistré, l'envie est montrée sans image (jamais avec l'adresse du marchand). */
async function makeCopy(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, wish: WishRow): Promise<boolean> {
  let copy: { url: string; thumbUrl: string };
  try {
    copy = await copyWishImage(fastify, log, userId, wish);
  } catch (error) {
    // Ni l'envie, ni la personne, ni la collection : le motif seulement.
    log.warn({ reason: error instanceof WishImageError ? "image_irrecuperable" : "erreur" }, "Collections : image d'une envie non copiée, montrée sans image");
    return false;
  }
  const { error } = await fastify.supabaseAdmin
    .from("collection_image_copies")
    .insert({ wishlist_item_id: wish.id, user_id: userId, image_url: copy.url, image_thumb_url: copy.thumbUrl });
  if (error) {
    // 23505 : une autre demande a fait la copie en même temps (la sienne reste).
    await deleteWishCopy(fastify, userId, [copy.url, copy.thumbUrl]);
    if (error.code !== "23505") log.error({ error }, "Collections : copie d'une image non enregistrée");
    return false;
  }
  return true;
}

/** Remet les copies en accord avec les collections, pour ces envies de
 * `userId` : une copie pour chaque envie visible par les amis (faite si elle
 * manque, réessayée si elle avait échoué), aucune pour les autres (fichier
 * effacé). À appeler après chaque changement : ajout ou retrait d'une envie,
 * changement de visibilité, collection supprimée. */
export async function syncFriendCopies(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, wishIds: string[]): Promise<void> {
  const ids = [...new Set(wishIds)];
  if (ids.length === 0) return;
  const db = fastify.supabaseAdmin;
  const [visible, copies] = await Promise.all([friendVisibleWishes(fastify, userId, ids), readCopies(fastify, userId, ids)]);

  const stale = [...copies.values()].filter((copy) => !visible.has(copy.wishlist_item_id));
  for (const part of chunks(stale)) {
    const { error } = await db
      .from("collection_image_copies")
      .delete()
      .eq("user_id", userId)
      .in(
        "wishlist_item_id",
        part.map((copy) => copy.wishlist_item_id)
      );
    if (error) {
      log.error({ error }, "Collections : copies d'images non retirées");
      continue;
    }
    for (const copy of part) await deleteWishCopy(fastify, userId, [copy.image_url, copy.image_thumb_url]);
  }

  const missing = ids.filter((id) => visible.has(id) && !copies.has(id));
  if (missing.length === 0) return;
  const wishes: WishRow[] = [];
  for (const part of chunks(missing)) {
    wishes.push(...parseDbRows(z.array(wishRowSchema), await db.from("wishlist_items").select("*").eq("user_id", userId).in("id", part), "Envies à copier"));
  }
  let failed = 0;
  await eachLimited(wishes, COPY_CONCURRENCY, async (wish) => {
    if (!(await makeCopy(fastify, log, userId, wish))) failed += 1;
  });
  if (wishes.length > 0) log.info({ copies: wishes.length - failed, failed }, "Collections : images copiées pour les amis");
}

/** Comme syncFriendCopies, sans jamais faire échouer la demande : le
 * changement de la collection est déjà enregistré. Un échec laisse au pire
 * une envie sans image (jamais l'adresse du marchand) ou une copie à effacer
 * plus tard (elle part avec le compte). */
export async function syncFriendCopiesQuietly(fastify: FastifyInstance, log: FastifyBaseLogger, userId: string, wishIds: string[]): Promise<void> {
  try {
    await syncFriendCopies(fastify, log, userId, wishIds);
  } catch (error) {
    log.error({ errorName: error instanceof Error ? error.name : "inconnue" }, "Collections : copies des images non mises à jour");
  }
}

/** La copie d'une envie (pour l'effacer avec elle), ou null. */
export async function readCopy(fastify: FastifyInstance, userId: string, wishId: string): Promise<CopyRow | null> {
  return (await readCopies(fastify, userId, [wishId])).get(wishId) ?? null;
}

/** Toutes les copies de `userId` (suppression du compte). Lecture
 * impossible : erreur (la suppression s'arrête, comme pour les messages). */
export async function allOwnCopies(fastify: FastifyInstance, userId: string): Promise<{ ownerId: string; url: string }[]> {
  const rows = await readAll<unknown>(
    "Copies des images des collections (suppression)",
    () => fastify.supabaseAdmin.from("collection_image_copies").select("wishlist_item_id, image_url, image_thumb_url", { count: "exact" }).eq("user_id", userId),
    ["wishlist_item_id"]
  );
  return parseDbRows(COPY_ROWS, { data: rows, error: null }, "Copies des images des collections").flatMap((row) => [
    { ownerId: userId, url: row.image_url },
    { ownerId: userId, url: row.image_thumb_url },
  ]);
}

// ---- Schéma de la base (migration 0033) ----

/** Sonde refaite au plus toutes les 5 minutes tant que 0033 manque. */
const SCHEMA_RETRY_MS = 5 * 60_000;

let schemaReadyAt: number | null = null;
let schemaMissingAt: number | null = null;
let schemaProbe: Promise<boolean> | null = null;

async function probeSchema(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">): Promise<boolean> {
  try {
    const db = fastify.supabaseAdmin;
    const checks = await Promise.all([
      db.from("collections").select("id, visibility").limit(0),
      db.from("collection_items").select("id, wishlist_item_id").limit(0),
      db.from("collection_image_copies").select("wishlist_item_id, image_url").limit(0),
    ]);
    const failed = checks.find((check) => check.error);
    if (!failed) return true;
    fastify.log.warn({ code: failed.error?.code ?? null }, "Collections coupées : migration 0033 absente");
  } catch {
    fastify.log.warn({ code: null }, "Collections coupées : schéma illisible");
  }
  return false;
}

/** La base a-t-elle la migration 0033 ? Mémorisé une fois vu ; absente, un
 * avertissement, puis la sonde n'est refaite qu'au bout de 5 minutes. Sans
 * elle : routes des collections « indisponibles », export et suppression de
 * compte sans collections. */
export async function collectionsReady(fastify: Pick<FastifyInstance, "supabaseAdmin" | "log">, now: () => number = Date.now): Promise<boolean> {
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
export function resetCollectionsProbe(): void {
  schemaReadyAt = null;
  schemaMissingAt = null;
  schemaProbe = null;
}

// ---- « En parler » (messages) ----

/** L'envie de collection `itemId` à joindre à un message pour `recipientId` :
 * elle doit être dans une collection de cette personne, montrée à ses amis
 * et visible par l'expéditeur. Sinon null (même réponse dans tous les cas). */
export async function sharedWishForMessage(fastify: FastifyInstance, senderId: string, recipientId: string, itemId: string): Promise<WishRow | null> {
  if (!(await collectionsReady(fastify))) return null;
  const shared = await readSharedItem(fastify, senderId, itemId);
  if (!shared || shared.collection.user_id !== recipientId) return null;
  return readItemWish(fastify, shared.item);
}
