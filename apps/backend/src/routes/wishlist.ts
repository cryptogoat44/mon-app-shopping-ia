import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WishlistItem } from "@monapp/shared-types";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseInput } from "../lib/validation.js";

const createWishlistItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().url(),
  reference: z.string().trim().max(120).nullish(),
  priceMin: z.number().nonnegative().nullish(),
  currency: z.string().trim().max(3).nullish(),
  merchantName: z.string().trim().max(120).nullish(),
  merchantUrl: z.string().url().nullish(),
  productMatchId: z.string().uuid().nullish(),
});

interface WishlistItemRow {
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

function toWishlistItem(row: WishlistItemRow): WishlistItem {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    reference: row.reference,
    priceMin: row.price_min !== null ? Number(row.price_min) : null,
    currency: row.currency,
    merchantName: row.merchant_name,
    merchantUrl: row.merchant_url,
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

    return reply.send({ items: pageRows.map(toWishlistItem), nextCursor });
  });

  fastify.post("/api/wishlist", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = createWishlistItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Données invalides." });
    }

    const { data: inserted, error: insertError } = await fastify.supabaseAdmin
      .from("wishlist_items")
      .upsert(
        {
          user_id: userId,
          title: parsed.data.title,
          image_url: parsed.data.imageUrl,
          reference: parsed.data.reference ?? null,
          price_min: parsed.data.priceMin ?? null,
          currency: parsed.data.currency ?? "EUR",
          merchant_name: parsed.data.merchantName ?? null,
          merchant_url: parsed.data.merchantUrl ?? null,
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

    return reply.send(toWishlistItem(inserted as WishlistItemRow));
  });

  fastify.delete("/api/wishlist/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
    const userId = request.user!.id;

    await fastify.supabaseAdmin.from("wishlist_items").delete().eq("id", id).eq("user_id", userId);

    return reply.code(204).send();
  });
}
