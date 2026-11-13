import type { FastifyInstance } from "fastify";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { fetchHdImageUrls } from "../lib/pieceImages.js";
import { z } from "zod";
import type { WishlistItem, WishlistItemDetail } from "@monapp/shared-types";
import { findOwnMatch } from "../lib/ownMatches.js";
import { keptMatchIds } from "../lib/keptPieces.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseInput, webUrlOrNull, webUrlSchema } from "../lib/validation.js";
import { deleteWishCopy, findWishPost } from "../lib/wishShare.js";
import { collectionsReady, readCopy } from "../lib/collections.js";
import { trackNewWish } from "../lib/wishAlerts.js";
import { searchLocaleFor } from "../lib/locale.js";

// Liens d'une envie rangés tels que l'app les envoie : http ou https
// seulement, 2 048 caractères au plus (lib/validation.ts, webUrlSchema).
const typedLinksSchema = z.object({ imageUrl: webUrlSchema, merchantUrl: webUrlSchema.nullish() });

const createWishlistItemSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    imageUrl: z.string(),
    reference: z.string().trim().max(120).nullish(),
    priceMin: z.number().nonnegative().nullish(),
    currency: z.string().trim().max(3).nullish(),
    merchantName: z.string().trim().max(120).nullish(),
    merchantUrl: z.string().nullish(),
    productMatchId: z.guid().nullish(),
  })
  // Liens vérifiés quand ce sont eux qui sont rangés : envie sans résultat du
  // Spotter. Avec un résultat, ceux de la base les remplacent (plus bas) et la
  // copie que l'app envoie encore n'est pas lue, comme pour POST /api/vault :
  // la refuser ferait échouer « Garder » pour un lien que personne ne range.
  .refine((body) => Boolean(body.productMatchId) || typedLinksSchema.safeParse(body).success);

const PRODUCT_MATCH_NOT_FOUND = { error: "product_match_not_found", message: "Produit introuvable." } as const;

/** Nom de domaine d'un lien web, sans « www. » (« boutique.example ») : le
 * nom montré pour un lien dont la boutique n'est pas connue du serveur. */
export function siteNameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 120) || null;
  } catch {
    return null;
  }
}

export interface WishlistItemRow {
  id: string;
  title: string;
  image_url: string;
  reference: string | null;
  price_min: string | null;
  currency: string | null;
  merchant_name: string | null;
  merchant_url: string | null;
  product_match_id: string | null;
  created_at: string;
}

export function toWishlistItem(
  row: WishlistItemRow,
  affiliateUrls: Map<string, string> = new Map(),
  imageHdUrl: string | null = null
): WishlistItem {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    imageHdUrl,
    reference: row.reference,
    priceMin: row.price_min !== null ? Number(row.price_min) : null,
    currency: row.currency,
    merchantName: row.merchant_name,
    // Seulement un lien web ordinaire, même pour une envie rangée plus tôt.
    merchantUrl: webUrlOrNull(row.merchant_url),
    affiliateUrl: row.product_match_id ? (affiliateUrls.get(row.product_match_id) ?? null) : null,
    productMatchId: row.product_match_id,
    createdAt: row.created_at,
  };
}

const WISHLIST_PAGE_SIZE = 24;

export default async function wishlistRoutes(fastify: FastifyInstance) {
  // Pagination par curseur (created_at du dernier objet reçu), même
  // logique que le fil et le vault.
  fastify.get("/api/wishlist", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const cursorDate = pageQuery.cursor;

    let query = fastify.supabaseAdmin
      .from("wishlist_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(WISHLIST_PAGE_SIZE + 1);

    if (cursorDate) {
      query = query.lt("created_at", cursorDate);
    }

    const { data, error } = await query;

    if (error) {
      request.log.error({ error }, "Échec de lecture de wishlist_items");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const rows = (data as WishlistItemRow[]) ?? [];
    const hasMore = rows.length > WISHLIST_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, WISHLIST_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;

    const affiliateUrls = await fetchAffiliateUrls(
      fastify,
      pageRows.map((row) => row.product_match_id).filter((id): id is string => id !== null)
    );
    const hdUrls = await fetchHdImageUrls(fastify, pageRows);
    return reply.send({ items: pageRows.map((row, index) => toWishlistItem(row, affiliateUrls, hdUrls[index])), nextCursor });
  });

  fastify.post("/api/wishlist", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = createWishlistItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Données invalides." });
    }

    // Envie venue d'un résultat du Spotter : ce résultat doit venir d'une
    // recherche de cette personne (même règle que POST /api/vault), et ses
    // liens (image, marchand) sont repris de la base, jamais de la requête.
    // L'app envoie exactement ceux du résultat : rien ne change pour elle.
    // Sans résultat : les liens envoyés, vérifiés par typedLinksSchema.
    // Revue de sécurité du 12 novembre 2026 : le nom de la boutique ne vient
    // plus jamais de la requête quand un lien est rangé. Avant, un appel
    // direct pouvait ranger « Zara » avec un lien vers n'importe quel site,
    // et le bouton « Voir chez Zara » montré aux autres membres (publication,
    // message, pièce envoyée, collection) y menait. Avec un résultat : le nom
    // rangé avec ce résultat. Sans résultat (l'app n'en crée jamais) : le nom
    // de domaine du lien, pour que le bouton dise où il mène.
    let imageUrl = parsed.data.imageUrl;
    let merchantUrl = parsed.data.merchantUrl ?? null;
    let merchantName = merchantUrl === null ? (parsed.data.merchantName ?? null) : siteNameOf(merchantUrl);
    if (parsed.data.productMatchId) {
      const match = await findOwnMatch(fastify, userId, parsed.data.productMatchId);
      if (!match) return reply.code(404).send(PRODUCT_MATCH_NOT_FOUND);
      imageUrl = match.imageUrl;
      merchantUrl = webUrlOrNull(match.merchantUrl);
      merchantName = match.merchantName ?? parsed.data.merchantName ?? null;
    }

    const { data: inserted, error: insertError } = await fastify.supabaseAdmin
      .from("wishlist_items")
      .upsert(
        {
          user_id: userId,
          title: parsed.data.title,
          image_url: imageUrl,
          reference: parsed.data.reference ?? null,
          price_min: parsed.data.priceMin ?? null,
          currency: parsed.data.currency ?? "EUR",
          merchant_name: merchantName,
          merchant_url: merchantUrl,
          product_match_id: parsed.data.productMatchId ?? null,
        },
        { onConflict: "user_id,product_match_id" }
      )
      .select("*")
      .single();

    if (insertError || !inserted) {
      request.log.error({ insertError }, "Échec de création de wishlist_items");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Alertes prix et stock (lot 2, 0036) : le suivi de l'envie (clé « même
    // pièce », prix de référence relu dans la base). Ne fait jamais échouer
    // « Garder » ; sans 0036, rien.
    const row = inserted as WishlistItemRow;
    await trackNewWish(
      fastify,
      request.log,
      { id: row.id, userId, merchantUrl: row.merchant_url, merchantName: row.merchant_name, productMatchId: row.product_match_id },
      searchLocaleFor(request).country
    );
    return reply.send(toWishlistItem(row));
  });

  // Détail d'une Envie (Lot Q, bloc 3, UX-04) — seulement la sienne. Lot 5 :
  // avec sa publication « envie » si elle a été republiée (jamais une
  // publication masquée par la modération, invisible pour son auteur aussi).
  fastify.get("/api/wishlist/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;

    const { data } = await fastify.supabaseAdmin
      .from("wishlist_items")
      .select("*")
      .eq("id", params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) {
      return reply.code(404).send({ error: "wishlist_item_not_found", message: "Envie introuvable." });
    }
    const row = data as WishlistItemRow;
    const matchIds = row.product_match_id ? [row.product_match_id] : [];
    const [affiliateUrls, hdUrls, wishPost, inVault] = await Promise.all([
      fetchAffiliateUrls(fastify, matchIds),
      fetchHdImageUrls(fastify, [row]),
      findWishPost(fastify, row.id),
      // « Je l'ai achetée » déjà fait (depuis le résultat ou cette fiche) : « Ajoutée au Vault ».
      keptMatchIds(fastify, "vault_items", userId, matchIds),
    ]);
    const detail: WishlistItemDetail = {
      ...toWishlistItem(row, affiliateUrls, hdUrls[0] ?? null),
      sharedPost:
        wishPost && !wishPost.hidden_at ? { id: wishPost.id, privacy: wishPost.privacy, createdAt: wishPost.created_at } : null,
      inVault: inVault.length > 0,
    };
    return reply.send(detail);
  });

  fastify.delete("/api/wishlist/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
    const userId = request.user!.id;

    // Lot 5 : sa publication « envie » est supprimée avec elle (cascade en
    // base) ; la copie de son image, rangée dans le dossier de l'auteur, aussi.
    const { data: wishPosts } = await fastify.supabaseAdmin
      .from("posts")
      .select("media_url, media_thumb_url")
      .eq("wishlist_item_id", id)
      .eq("user_id", userId);
    // Lot collections : l'envie quitte ses collections (cascade en base) ; la
    // copie de son image montrée aux amis, rangée chez son auteur, est effacée.
    const friendsCopy = (await collectionsReady(fastify)) ? await readCopy(fastify, userId, id) : null;

    const { error } = await fastify.supabaseAdmin.from("wishlist_items").delete().eq("id", id).eq("user_id", userId);
    if (error) {
      request.log.error({ error }, "Échec du retrait d'une envie");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    for (const post of (wishPosts as { media_url: string | null; media_thumb_url: string | null }[] | null) ?? []) {
      await deleteWishCopy(fastify, userId, [post.media_url, post.media_thumb_url]);
    }
    if (friendsCopy) await deleteWishCopy(fastify, userId, [friendsCopy.image_url, friendsCopy.image_thumb_url]);

    return reply.code(204).send();
  });
}
