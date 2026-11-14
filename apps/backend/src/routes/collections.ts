// Collections d'envies (lot collections, migration 0033) : les siennes
// (créer, renommer, montrer aux amis ou rendre privée, supprimer, y ranger
// une envie) et celles de ses amis (sur leur profil : la liste, une
// collection, « Garder » une envie). Règles et copies des images :
// lib/collections.ts. Aucune notification (décision du lot). Le nom d'une
// collection n'est jamais écrit au journal. Lot modération des collections
// (migration 0034) : une collection masquée par la modération n'est plus
// montrée aux amis, ni remontrable par son auteur tant qu'elle l'est ; celle
// qu'un ami a signalée disparaît de ce qu'il voit.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  COLLECTION_ITEMS_MAX,
  COLLECTION_NAME_MAX_LENGTH,
  COLLECTION_VISIBILITIES,
  COLLECTIONS_MAX,
  type CollectionsList,
  type CollectionsStatus,
  type KeepSharedItemResponse,
  type SharedCollectionPage,
  type SharedCollectionsList,
  type WishCollections,
  type WishlistPage,
} from "@monapp/shared-types";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import {
  COLLECTION_COLUMNS,
  COLLECTION_FULL,
  COLLECTION_HIDDEN,
  COLLECTION_LIMIT,
  COLLECTION_NAME_EMPTY,
  COLLECTION_NAME_TOO_LONG,
  COLLECTION_NOT_FOUND,
  COLLECTION_ROWS,
  COLLECTIONS_UNAVAILABLE,
  INVALID_COLLECTION,
  ITEM_COLUMNS,
  ITEM_ROWS,
  canSeeFriendCollections,
  collectionStats,
  collectionsReady,
  nameLength,
  normalizeCollectionName,
  readItemWish,
  readOwnCollection,
  readSharedCollection,
  readSharedItem,
  syncFriendCopiesQuietly,
  toCollectionSummary,
  toSharedItems,
  type CollectionRow,
  type ItemRow,
} from "../lib/collections.js";
import { collectionModerationReady } from "../lib/collectionModeration.js";
import { CONTENT_NOT_ALLOWED, containsBannedWords } from "../lib/contentFilter.js";
import { ACCOUNT_SUSPENDED, isSuspended } from "../lib/moderation.js";
import { readAll, chunks } from "../lib/pagedReads.js";
import { fetchHdImageUrls } from "../lib/pieceImages.js";
import { RATE_LIMITS } from "../lib/rateLimits.js";
import { reportedIdsFor } from "../lib/reportedByViewer.js";
import { INVALID_ID, idParamsSchema, parseDbRows, parseInput, userIdParamsSchema, webUrlOrNull } from "../lib/validation.js";
import { findOwnWish } from "../lib/wishShare.js";
import { trackNewWish } from "../lib/wishAlerts.js";
import { searchLocaleFor } from "../lib/locale.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";
import { toWishlistItem, WISHLIST_FULL, wishlistFull, type WishlistItemRow } from "./wishlist.js";

/** Envies par page (les siennes dans une collection ; celles d'un ami). */
const OWN_PAGE_SIZE = 24;
const SHARED_PAGE_SIZE = 30;

const ID = z.guid();
// Date d'ajout telle que la base la renvoie (microsecondes comprises), jamais
// réécrite : la page suivante ne saute ni ne répète aucune envie.
const TIMESTAMP_PARAM = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/);
const pageQuerySchema = z.object({ cursor: TIMESTAMP_PARAM.optional() });
// Limite large avant le nettoyage des espaces ; la vraie limite suit.
const NAME = z.string().max(COLLECTION_NAME_MAX_LENGTH * 4);
const createSchema = z.object({ name: NAME });
const updateSchema = z
  .object({ name: NAME.optional(), visibility: z.enum(COLLECTION_VISIBILITIES).optional() })
  .refine((body) => body.name !== undefined || body.visibility !== undefined);
const membershipSchema = z.object({ collectionIds: z.array(ID).max(COLLECTIONS_MAX) });

const INVALID_QUERY = { error: "invalid_query", message: "Paramètre de liste invalide." } as const;
const WISH_NOT_FOUND = { error: "wishlist_item_not_found", message: "Envie introuvable." } as const;
const SERVER_ERROR = { error: "internal_error", message: "Une erreur est survenue." } as const;

const PROFILE_ROWS = z.array(z.object({ id: ID, username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable() }));

/** 404 « indisponible » tant que la migration 0033 manque ; vrai sinon. */
async function ensureReady(fastify: FastifyInstance, reply: FastifyReply): Promise<boolean> {
  if (await collectionsReady(fastify)) return true;
  void reply.code(404).send(COLLECTIONS_UNAVAILABLE);
  return false;
}

/** Le nom nettoyé, ou null (réponse 400 déjà envoyée) : vide, trop long, ou
 * avec un mot interdit (les amis peuvent le voir). */
function checkName(raw: string, reply: FastifyReply): string | null {
  const name = normalizeCollectionName(raw);
  if (name.length === 0) {
    void reply.code(400).send(COLLECTION_NAME_EMPTY);
    return null;
  }
  if (nameLength(name) > COLLECTION_NAME_MAX_LENGTH) {
    void reply.code(400).send(COLLECTION_NAME_TOO_LONG);
    return null;
  }
  if (containsBannedWords(name)) {
    void reply.code(400).send(CONTENT_NOT_ALLOWED);
    return null;
  }
  return name;
}

function sendLimit(reply: FastifyReply, name: "collectionVisibility") {
  const rule = RATE_LIMITS[name];
  return reply.code(429).send({ error: rule.error, message: rule.message });
}

/** Envies d'une collection, les plus récemment ajoutées d'abord. */
async function readItemsPage(fastify: FastifyInstance, collectionId: string, cursor: string | undefined, pageSize: number): Promise<{ rows: ItemRow[]; nextCursor: string | null }> {
  let query = fastify.supabaseAdmin.from("collection_items").select(ITEM_COLUMNS).eq("collection_id", collectionId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize + 1);
  if (cursor) query = query.lt("created_at", cursor);
  const rows = parseDbRows(ITEM_ROWS, await query, "Envies d'une collection");
  const page = rows.slice(0, pageSize);
  return { rows: page, nextCursor: rows.length > pageSize ? (page.at(-1)?.created_at ?? null) : null };
}

/** Identifiants des envies d'une collection (toutes : 100 au plus). */
async function collectionWishIds(fastify: FastifyInstance, collectionId: string): Promise<string[]> {
  const rows = await readAll<{ id: string; wishlist_item_id: string }>(
    "Envies d'une collection",
    () => fastify.supabaseAdmin.from("collection_items").select("id, wishlist_item_id", { count: "exact" }).eq("collection_id", collectionId),
    ["id"]
  );
  return rows.map((row) => row.wishlist_item_id);
}

async function countItems(fastify: FastifyInstance, collectionId: string): Promise<number> {
  const { count, error } = await fastify.supabaseAdmin.from("collection_items").select("id", { count: "exact", head: true }).eq("collection_id", collectionId);
  if (error) throw new Error("Lecture du nombre d'envies d'une collection impossible");
  return count ?? 0;
}

export default async function collectionsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: fastify.requireAuth };
  const write = {
    preHandler: [fastify.requireAuth, fastify.rateLimit("collectionWrite")],
    config: { rateLimitName: "collectionWrite" as const },
  };

  // Disponibilité : l'app cache toutes les collections sans 0033, et
  // « Signaler » une collection sans 0034.
  fastify.get("/api/collections/status", auth, async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const enabled = await collectionsReady(fastify);
    return reply.send({ enabled, reportable: enabled && (await collectionModerationReady(fastify)) } satisfies CollectionsStatus);
  });

  // Ses collections, dans l'ordre de création, avec leur nombre d'envies.
  fastify.get("/api/collections", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const userId = request.user!.id;
    const rows = parseDbRows(
      COLLECTION_ROWS,
      await fastify.supabaseAdmin.from("collections").select(COLLECTION_COLUMNS).eq("user_id", userId).order("created_at", { ascending: true }).order("id", { ascending: true }),
      "Collections"
    );
    const stats = await collectionStats(fastify, userId, rows.map((row) => row.id), false);
    reply.header("Cache-Control", "no-store");
    return reply.send({ collections: rows.map((row) => toCollectionSummary(row, stats.get(row.id)?.itemCount ?? 0)) } satisfies CollectionsList);
  });

  // Nouvelle collection : toujours privée (la montrer aux amis est un second
  // geste, confirmé dans l'app).
  fastify.post("/api/collections", write, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const body = parseInput(createSchema, request.body, reply, INVALID_COLLECTION);
    if (!body) return;
    const name = checkName(body.name, reply);
    if (!name) return;
    const userId = request.user!.id;
    const { count, error: countError } = await fastify.supabaseAdmin.from("collections").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (countError) {
      request.log.error({ error: countError }, "Échec de lecture du nombre de collections");
      return reply.code(500).send(SERVER_ERROR);
    }
    if ((count ?? 0) >= COLLECTIONS_MAX) return reply.code(409).send(COLLECTION_LIMIT);
    const { data, error } = await fastify.supabaseAdmin.from("collections").insert({ user_id: userId, name }).select(COLLECTION_COLUMNS).single();
    if (error || !data) {
      // Jamais le nom : seulement le code de l'erreur (lib/logPrivacy.ts).
      request.log.error({ error }, "Échec de la création d'une collection");
      return reply.code(500).send(SERVER_ERROR);
    }
    const [row] = parseDbRows(COLLECTION_ROWS, { data: [data], error: null }, "Collection créée");
    return reply.code(201).send(toCollectionSummary(row!, 0));
  });

  // Renommer, et/ou changer la visibilité. Passer à « Mes amis » copie les
  // images de ses envies ; revenir à « Privée » efface les copies qui ne
  // servent plus à aucune collection montrée aux amis.
  fastify.patch("/api/collections/:id", write, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(updateSchema, request.body, reply, INVALID_COLLECTION);
    if (!body) return;
    const name = body.name === undefined ? undefined : checkName(body.name, reply);
    if (name === null) return;
    const userId = request.user!.id;
    const collection = await readOwnCollection(fastify, userId, params.id);
    if (!collection) return reply.code(404).send(COLLECTION_NOT_FOUND);

    const visibilityChanges = body.visibility !== undefined && body.visibility !== collection.visibility;
    if (visibilityChanges) {
      // Montrer ses envies à d'autres : refusé à un compte suspendu (ses collections sont cachées).
      if (body.visibility === "friends" && (await isSuspended(fastify, userId))) return reply.code(403).send(ACCOUNT_SUSPENDED);
      // Masquée par la modération : elle ne revient pas chez les amis tant que la décision tient.
      if (body.visibility === "friends" && collection.hidden_at !== null) return reply.code(409).send(COLLECTION_HIDDEN);
      if (!consumeRateLimit(request, "collectionVisibility")) return sendLimit(reply, "collectionVisibility");
    }
    const now = new Date().toISOString();
    const { data, error } = await fastify.supabaseAdmin
      .from("collections")
      .update({
        ...(name !== undefined ? { name } : {}),
        ...(visibilityChanges ? { visibility: body.visibility, visibility_changed_at: now } : {}),
        updated_at: now,
      })
      .eq("id", collection.id)
      .eq("user_id", userId)
      .select(COLLECTION_COLUMNS);
    if (error) {
      request.log.error({ error }, "Échec de la modification d'une collection");
      return reply.code(500).send(SERVER_ERROR);
    }
    const [row] = parseDbRows(COLLECTION_ROWS, { data, error: null }, "Collection modifiée");
    if (!row) return reply.code(404).send(COLLECTION_NOT_FOUND);
    if (visibilityChanges) {
      await syncFriendCopiesQuietly(fastify, request.log, userId, await collectionWishIds(fastify, row.id));
      request.log.info({ visibility: row.visibility }, "Visibilité d'une collection changée");
    }
    return reply.send(toCollectionSummary(row, await countItems(fastify, row.id)));
  });

  // Supprimer une collection : ses envies restent dans les Envies ; les copies
  // qui ne servent plus à aucune collection montrée aux amis sont effacées.
  fastify.delete("/api/collections/:id", write, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    const collection = await readOwnCollection(fastify, userId, params.id);
    if (!collection) return reply.code(404).send(COLLECTION_NOT_FOUND);
    const wishIds = collection.visibility === "friends" ? await collectionWishIds(fastify, collection.id) : [];
    const { error } = await fastify.supabaseAdmin.from("collections").delete().eq("id", collection.id).eq("user_id", userId);
    if (error) {
      request.log.error({ error }, "Échec de la suppression d'une collection");
      return reply.code(500).send(SERVER_ERROR);
    }
    await syncFriendCopiesQuietly(fastify, request.log, userId, wishIds);
    return reply.code(204).send();
  });

  // Ses envies rangées dans une de ses collections (puce de l'écran Envies),
  // comme GET /api/wishlist : les plus récemment ajoutées d'abord.
  fastify.get("/api/collections/:id/wishlist", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const query = parseInput(pageQuerySchema, request.query, reply, INVALID_QUERY);
    if (!query) return;
    const userId = request.user!.id;
    if (!(await readOwnCollection(fastify, userId, params.id))) return reply.code(404).send(COLLECTION_NOT_FOUND);
    const { rows, nextCursor } = await readItemsPage(fastify, params.id, query.cursor, OWN_PAGE_SIZE);
    const wishIds = rows.map((row) => row.wishlist_item_id);
    const { data, error } = wishIds.length > 0 ? await fastify.supabaseAdmin.from("wishlist_items").select("*").eq("user_id", userId).in("id", wishIds) : { data: [], error: null };
    if (error) {
      request.log.error({ error }, "Échec de lecture des envies d'une collection");
      return reply.code(500).send(SERVER_ERROR);
    }
    const byId = new Map(((data as WishlistItemRow[] | null) ?? []).map((row) => [row.id, row]));
    const wishes = wishIds.map((id) => byId.get(id)).filter((row): row is WishlistItemRow => row !== undefined);
    const [affiliateUrls, hdUrls] = await Promise.all([
      fetchAffiliateUrls(fastify, wishes.map((row) => row.product_match_id).filter((id): id is string => id !== null)),
      fetchHdImageUrls(fastify, wishes),
    ]);
    reply.header("Cache-Control", "no-store");
    return reply.send({ items: wishes.map((row, index) => toWishlistItem(row, affiliateUrls, hdUrls[index])), nextCursor } satisfies WishlistPage);
  });

  // Une collection d'un ami (ou la sienne, montrée aux amis), telle que ses
  // amis la voient. Sinon : 404, exactement comme une collection inexistante.
  fastify.get("/api/collections/:id/shared", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const query = parseInput(pageQuerySchema, request.query, reply, INVALID_QUERY);
    if (!query) return;
    const collection = await readSharedCollection(fastify, request.user!.id, params.id);
    if (!collection) return reply.code(404).send(COLLECTION_NOT_FOUND);
    const [owner] = parseDbRows(
      PROFILE_ROWS,
      await fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").eq("id", collection.user_id).limit(1),
      "Auteur d'une collection"
    );
    if (!owner?.username) return reply.code(404).send(COLLECTION_NOT_FOUND);
    const [{ rows, nextCursor }, itemCount] = await Promise.all([readItemsPage(fastify, collection.id, query.cursor, SHARED_PAGE_SIZE), countItems(fastify, collection.id)]);
    const page: SharedCollectionPage = {
      collection: {
        id: collection.id,
        name: collection.name,
        itemCount,
        owner: { id: owner.id, username: owner.username, displayName: owner.display_name, avatarUrl: owner.avatar_url },
      },
      items: await toSharedItems(fastify, collection.user_id, rows),
      nextCursor,
    };
    reply.header("Cache-Control", "no-store");
    return reply.send(page);
  });

  // Les collections qu'un membre montre à ses amis (section « Collections »
  // de son profil). Pour tout autre visiteur : une liste vide, comme un ami
  // qui n'en montre aucune (rien ne dit pourquoi). Jamais une collection
  // masquée par la modération, ni une que le visiteur a signalée.
  fastify.get("/api/users/:userId/collections", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(userIdParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    reply.header("Cache-Control", "no-store");
    if (!(await canSeeFriendCollections(fastify, request.user!.id, params.userId))) return reply.send({ collections: [] } satisfies SharedCollectionsList);
    const all = parseDbRows(
      COLLECTION_ROWS,
      await fastify.supabaseAdmin
        .from("collections")
        .select(COLLECTION_COLUMNS)
        .eq("user_id", params.userId)
        .eq("visibility", "friends")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      "Collections montrées aux amis"
    );
    const reported = params.userId === request.user!.id ? new Set<string>() : new Set(await reportedIdsFor(fastify, request.log, request.user!.id, "collection"));
    const rows = all.filter((row) => row.hidden_at === null && !reported.has(row.id));
    const stats = await collectionStats(fastify, params.userId, rows.map((row) => row.id), true);
    const list: SharedCollectionsList = {
      collections: rows.map((row: CollectionRow) => ({ id: row.id, name: row.name, itemCount: stats.get(row.id)?.itemCount ?? 0, coverUrl: stats.get(row.id)?.coverUrl ?? null })),
    };
    return reply.send(list);
  });

  // Les collections qui contiennent une de ses envies (feuille « Ajouter à
  // une collection »).
  fastify.get("/api/wishlist/:id/collections", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;
    if (!(await findOwnWish(fastify, userId, params.id))) return reply.code(404).send(WISH_NOT_FOUND);
    reply.header("Cache-Control", "no-store");
    return reply.send({ collectionIds: await wishCollectionIds(fastify, userId, params.id) } satisfies WishCollections);
  });

  // Ranger une de ses envies dans ces collections (et la retirer des autres),
  // en une fois. Une envie qui devient visible par les amis : copie de son
  // image ; qui ne l'est plus par aucune collection : copie effacée.
  fastify.put("/api/wishlist/:id/collections", write, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(membershipSchema, request.body, reply, INVALID_COLLECTION);
    if (!body) return;
    const userId = request.user!.id;
    if (!(await findOwnWish(fastify, userId, params.id))) return reply.code(404).send(WISH_NOT_FOUND);
    const wanted = [...new Set(body.collectionIds)];
    const owned = wanted.length > 0
      ? parseDbRows(COLLECTION_ROWS, await fastify.supabaseAdmin.from("collections").select(COLLECTION_COLUMNS).eq("user_id", userId).in("id", wanted), "Collections choisies")
      : [];
    // Une collection inconnue ou d'un autre : rien n'est changé.
    if (owned.length !== wanted.length) return reply.code(404).send(COLLECTION_NOT_FOUND);

    const current = await wishCollectionIds(fastify, userId, params.id);
    const toAdd = wanted.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !wanted.includes(id));
    if (toAdd.length > 0) {
      const counts = new Map<string, number>();
      for (const part of chunks(toAdd)) {
        const rows = await readAll<{ id: string; collection_id: string }>(
          "Taille des collections",
          () => fastify.supabaseAdmin.from("collection_items").select("id, collection_id", { count: "exact" }).in("collection_id", part),
          ["id"]
        );
        for (const row of rows) counts.set(row.collection_id, (counts.get(row.collection_id) ?? 0) + 1);
      }
      if (toAdd.some((id) => (counts.get(id) ?? 0) >= COLLECTION_ITEMS_MAX)) return reply.code(409).send(COLLECTION_FULL);
      const rows = toAdd.map((collectionId) => ({ collection_id: collectionId, wishlist_item_id: params.id, user_id: userId }));
      const { error } = await fastify.supabaseAdmin.from("collection_items").insert(rows);
      // 23505 : rangée en même temps par une autre demande (déjà fait) ; une par une, sans les doublons.
      if (error?.code === "23505") {
        for (const row of rows) {
          const single = await fastify.supabaseAdmin.from("collection_items").insert(row);
          if (single.error && single.error.code !== "23505") return failMembership(request.log, reply, single.error);
        }
      } else if (error) {
        return failMembership(request.log, reply, error);
      }
    }
    if (toRemove.length > 0) {
      const { error } = await fastify.supabaseAdmin.from("collection_items").delete().eq("user_id", userId).eq("wishlist_item_id", params.id).in("collection_id", toRemove);
      if (error) return failMembership(request.log, reply, error);
    }
    // Visible par les amis ou plus : la copie suit (rien à faire sinon).
    if (toAdd.length > 0 || toRemove.length > 0) await syncFriendCopiesQuietly(fastify, request.log, userId, [params.id]);
    return reply.send({ collectionIds: await wishCollectionIds(fastify, userId, params.id) } satisfies WishCollections);
  });

  // Une envie d'une collection d'un ami (carte jointe d'avance à « En parler »).
  fastify.get("/api/collection-items/:id", auth, async (request, reply) => {
    if (!(await ensureReady(fastify, reply))) return;
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const shared = await readSharedItem(fastify, request.user!.id, params.id);
    const [item] = shared ? await toSharedItems(fastify, shared.collection.user_id, [shared.item]) : [];
    if (!item) return reply.code(404).send(COLLECTION_NOT_FOUND);
    reply.header("Cache-Control", "no-store");
    return reply.send(item);
  });

  // « Garder » une envie d'un ami : elle entre dans vos Envies, avec les
  // informations du marchand (titre, image, prix, lien), comme un résultat
  // gardé. Sans la proposition d'origine (elle vient d'une recherche de
  // l'ami) : « Je l'ai achetée » passe alors par l'ajout au Vault à la main.
  fastify.post(
    "/api/collection-items/:id/keep",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("collectionKeep")], config: { rateLimitName: "collectionKeep" } },
    async (request, reply) => {
      if (!(await ensureReady(fastify, reply))) return;
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const userId = request.user!.id;
      const shared = await readSharedItem(fastify, userId, params.id);
      const wish = shared ? await readItemWish(fastify, shared.item) : null;
      if (!wish) return reply.code(404).send(COLLECTION_NOT_FOUND);

      // Déjà gardée (même titre, même image) : rien n'est ajouté.
      const { data: existing, error: existingError } = await fastify.supabaseAdmin
        .from("wishlist_items")
        .select("*")
        .eq("user_id", userId)
        .eq("title", wish.title)
        .eq("image_url", wish.image_url)
        .limit(1);
      if (existingError) {
        request.log.error({ error: existingError }, "Échec de lecture des Envies avant « Garder »");
        return reply.code(500).send(SERVER_ERROR);
      }
      const already = (existing as WishlistItemRow[] | null)?.[0];
      if (already) return reply.send({ item: toWishlistItem(already), alreadyKept: true } satisfies KeepSharedItemResponse);
      // Plafond d'envies par membre (lot « durcissement des alertes »), comme POST /api/wishlist.
      try {
        if (await wishlistFull(fastify, userId)) return reply.code(409).send(WISHLIST_FULL);
      } catch (error) {
        request.log.error({ error }, "Échec de lecture du nombre d'envies avant « Garder »");
        return reply.code(500).send(SERVER_ERROR);
      }

      const { data, error } = await fastify.supabaseAdmin
        .from("wishlist_items")
        .insert({
          user_id: userId,
          title: wish.title,
          image_url: wish.image_url,
          reference: null,
          price_min: wish.price_min,
          currency: wish.currency,
          merchant_name: wish.merchant_name,
          // Recopié seulement si c'est un lien web ordinaire.
          merchant_url: webUrlOrNull(wish.merchant_url),
          product_match_id: null,
        })
        .select("*")
        .single();
      if (error || !data) {
        request.log.error({ error }, "Échec de « Garder » une envie d'un ami");
        return reply.code(500).send(SERVER_ERROR);
      }
      // Alertes prix et stock (lot 2, 0036) : le suivi de l'envie, sans prix
      // de référence (aucune proposition d'origine : la première observation
      // le fixera). Ne fait jamais échouer « Garder » ; sans 0036, rien.
      const kept = data as WishlistItemRow;
      await trackNewWish(
        fastify,
        request.log,
        { id: kept.id, userId, merchantUrl: kept.merchant_url, merchantName: kept.merchant_name, productMatchId: kept.product_match_id },
        searchLocaleFor(request).country
      );
      return reply.code(201).send({ item: toWishlistItem(kept), alreadyKept: false } satisfies KeepSharedItemResponse);
    }
  );
}

function failMembership(log: FastifyInstance["log"], reply: FastifyReply, error: unknown) {
  log.error({ error }, "Échec du rangement d'une envie dans une collection");
  return reply.code(500).send(SERVER_ERROR);
}

/** Les collections (les siennes) qui contiennent l'envie `wishId`. */
async function wishCollectionIds(fastify: FastifyInstance, userId: string, wishId: string): Promise<string[]> {
  const rows = parseDbRows(
    z.array(z.object({ collection_id: ID })),
    await fastify.supabaseAdmin.from("collection_items").select("collection_id").eq("user_id", userId).eq("wishlist_item_id", wishId).order("created_at", { ascending: true }),
    "Collections d'une envie"
  );
  return rows.map((row) => row.collection_id);
}
