// Partage d'une envie (lot 5, section 5.C). Les envies restent privées par
// défaut : chaque partage est un geste volontaire, refusé à un compte suspendu.
// - Republier sur son profil : publication « envie », distincte d'un achat
//   (jamais de badge d'achat vérifié), confidentialité au choix.
// - Envoyer à une personne : selon SON réglage « Qui peut m'envoyer des
//   pièces » (les comptes qu'elle suit par défaut), jamais en cas de blocage,
//   avec une limite de débit ; elle peut signaler la pièce reçue.
// Dans les deux cas, l'image montrée est une copie faite par notre serveur
// (lib/wishShare.ts), jamais l'adresse d'origine.
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { PIECE_SENDS_FROM, PRIVACY_LEVELS, type ReceivedPiece } from "@monapp/shared-types";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseDbRows, parseInput } from "../lib/validation.js";
import { isBlockedEitherWay, isFollowing } from "../lib/visibility.js";
import { WishImageError, copyWishImage, deleteWishCopy, findOwnWish, findWishPost, type WishRow } from "../lib/wishShare.js";
import { POST_ROWS, hydratePosts } from "./posts.js";

const RECEIVED_PAGE_SIZE = 24;

const republishSchema = z.object({ privacy: z.enum(PRIVACY_LEVELS) });
const sendSchema = z.object({ recipientId: z.string().uuid() });

const WISH_NOT_FOUND = { error: "wishlist_item_not_found", message: "Envie introuvable." } as const;
const IMAGE_UNAVAILABLE = {
  error: "wish_image_unavailable",
  message: "L'image de cette envie n'a pas pu être récupérée. Réessayez plus tard.",
} as const;
// « Introuvable » sans dire pourquoi (profil inexistant, incomplet ou blocage).
const RECIPIENT_NOT_FOUND = { error: "recipient_not_found", message: "Personne introuvable." } as const;
const RECIPIENT_NOT_ACCEPTING = {
  error: "recipient_not_accepting",
  message: "Cette personne ne reçoit pas de pièces de votre part.",
} as const;

const ID = z.string().uuid();
const RECIPIENT_ROWS = z.array(z.object({ id: ID, username: z.string().nullable(), piece_sends_from: z.enum(PIECE_SENDS_FROM) }));
const PIECE_ROWS = z.array(
  z.object({
    id: ID,
    sender_id: ID,
    title: z.string(),
    image_url: z.string(),
    image_thumb_url: z.string(),
    merchant_name: z.string().nullable(),
    merchant_url: z.string().nullable(),
    product_match_id: ID.nullable(),
    price_min: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
    created_at: z.string(),
  })
);
type PieceRow = z.infer<typeof PIECE_ROWS>[number];
const SENDER_ROWS = z.array(z.object({ id: ID, username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable() }));

function priceOf(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

/** Pièce reçue, avec son lien marchand (affilié s'il existe, mention obligatoire). */
async function toReceivedPieces(fastify: FastifyInstance, rows: PieceRow[]): Promise<ReceivedPiece[]> {
  if (rows.length === 0) return [];
  const senderIds = [...new Set(rows.map((row) => row.sender_id))];
  const [senders, affiliateUrls] = await Promise.all([
    fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", senderIds),
    fetchAffiliateUrls(fastify, rows.map((row) => row.product_match_id).filter((id): id is string => id !== null)),
  ]);
  const senderById = new Map(parseDbRows(SENDER_ROWS, senders, "Expéditeurs des pièces").map((s) => [s.id, s]));
  return rows.map((row) => {
    const sender = senderById.get(row.sender_id);
    const affiliateUrl = row.product_match_id ? (affiliateUrls.get(row.product_match_id) ?? null) : null;
    const merchantUrl = affiliateUrl ?? row.merchant_url;
    return {
      id: row.id,
      sender: { id: row.sender_id, username: sender?.username ?? "", displayName: sender?.display_name ?? "", avatarUrl: sender?.avatar_url ?? null },
      title: row.title,
      imageUrl: row.image_url,
      imageThumbUrl: row.image_thumb_url,
      merchantName: row.merchant_name,
      merchantUrl,
      isAffiliate: affiliateUrl !== null && affiliateUrl !== row.merchant_url,
      productMatchId: row.product_match_id,
      priceMin: priceOf(row.price_min),
      currency: row.currency,
      createdAt: row.created_at,
    };
  });
}

/** La personne `recipientId` accepte-t-elle une pièce de `senderId` ? Réponse
 * d'erreur envoyée sinon (et `false`). */
async function checkRecipient(fastify: FastifyInstance, reply: FastifyReply, senderId: string, recipientId: string): Promise<boolean> {
  const [recipient] = parseDbRows(
    RECIPIENT_ROWS,
    await fastify.supabaseAdmin.from("profiles").select("id, username, piece_sends_from").eq("id", recipientId).limit(1),
    "Destinataire d'une pièce"
  );
  if (!recipient || !recipient.username || (await isBlockedEitherWay(fastify, senderId, recipientId))) {
    void reply.code(404).send(RECIPIENT_NOT_FOUND);
    return false;
  }
  const accepts =
    recipient.piece_sends_from === "everyone" ||
    (recipient.piece_sends_from === "following" && (await isFollowing(fastify, recipientId, senderId)));
  if (!accepts) {
    void reply.code(403).send(RECIPIENT_NOT_ACCEPTING);
    return false;
  }
  return true;
}

/** Copie l'image de l'envie ; null (réponse déjà envoyée) si impossible. */
async function copyOrReply(fastify: FastifyInstance, reply: FastifyReply, userId: string, wish: WishRow) {
  try {
    return await copyWishImage(fastify, userId, wish);
  } catch (error) {
    if (error instanceof WishImageError) {
      void reply.code(422).send(IMAGE_UNAVAILABLE);
      return null;
    }
    throw error;
  }
}

export default async function piecesRoutes(fastify: FastifyInstance) {
  // Republier une envie sur son profil (publication « envie »).
  fastify.post(
    "/api/wishlist/:id/republish",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("pieceTag")], config: { rateLimitName: "pieceTag" } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const body = parseInput(republishSchema, request.body, reply, { error: "invalid_body", message: "Visibilité invalide." });
      if (!body) return;
      const userId = request.user!.id;

      const wish = await findOwnWish(fastify, userId, params.id);
      if (!wish) return reply.code(404).send(WISH_NOT_FOUND);

      // Une envie ne se republie qu'une fois à la fois, comme un achat ; une
      // publication masquée par la modération compte aussi.
      const existing = await findWishPost(fastify, wish.id);
      if (existing?.hidden_at) {
        return reply.code(409).send({
          error: "already_shared_hidden",
          message: "Cette envie a déjà été republiée, et sa publication a été masquée par la modération.",
        });
      }
      const alreadyShared = {
        error: "already_shared",
        message: "Cette envie est déjà sur votre profil. Pour changer qui la voit, modifiez la visibilité de cette publication (depuis la publication).",
      };
      if (existing) return reply.code(409).send(alreadyShared);

      const copy = await copyOrReply(fastify, reply, userId, wish);
      if (!copy) return;

      const { data: inserted, error } = await fastify.supabaseAdmin
        .from("posts")
        .insert({
          user_id: userId,
          type: "wish",
          wishlist_item_id: wish.id,
          caption: null,
          media_kind: "photo",
          media_url: copy.url,
          media_thumb_url: copy.thumbUrl,
          privacy: body.privacy,
        })
        .select("*")
        .single();
      if (error || !inserted) {
        await deleteWishCopy(fastify, userId, [copy.url, copy.thumbUrl]);
        // Deux demandes simultanées : la base n'en garde qu'une (index unique).
        if (error?.code === "23505") return reply.code(409).send(alreadyShared);
        request.log.error({ error }, "Échec de la republication d'une envie");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }
      const [post] = await hydratePosts(fastify, parseDbRows(POST_ROWS, { data: [inserted], error: null }, "Publication « envie »"), userId);
      return reply.send(post);
    }
  );

  // Envoyer une envie à une personne sur Spotto.
  fastify.post(
    "/api/wishlist/:id/send",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("pieceSend")], config: { rateLimitName: "pieceSend" } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const body = parseInput(sendSchema, request.body, reply, { error: "invalid_body", message: "Destinataire invalide." });
      if (!body) return;
      const userId = request.user!.id;
      if (body.recipientId === userId) {
        return reply.code(400).send({ error: "invalid_body", message: "Vous ne pouvez pas vous envoyer une pièce." });
      }

      const wish = await findOwnWish(fastify, userId, params.id);
      if (!wish) return reply.code(404).send(WISH_NOT_FOUND);
      if (!(await checkRecipient(fastify, reply, userId, body.recipientId))) return;

      const copy = await copyOrReply(fastify, reply, userId, wish);
      if (!copy) return;

      const { data: sent, error } = await fastify.supabaseAdmin
        .from("piece_sends")
        .insert({
          sender_id: userId,
          recipient_id: body.recipientId,
          title: wish.title,
          image_url: copy.url,
          image_thumb_url: copy.thumbUrl,
          merchant_name: wish.merchant_name,
          merchant_url: wish.merchant_url,
          product_match_id: wish.product_match_id,
          price_min: wish.price_min,
          currency: wish.currency,
        })
        .select("id")
        .single();
      if (error || !sent) {
        await deleteWishCopy(fastify, userId, [copy.url, copy.thumbUrl]);
        request.log.error({ error }, "Échec de l'envoi d'une pièce");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }

      // Notification in-app (jamais push, lot 6). Best-effort : la pièce est
      // déjà dans « Reçues » même si la notification échoue.
      const { error: notifyError } = await fastify.supabaseAdmin
        .from("notifications")
        .insert({ user_id: body.recipientId, actor_id: userId, type: "piece_received", piece_send_id: sent.id });
      if (notifyError) request.log.error({ notifyError }, "Échec de la notification d'une pièce reçue");

      return reply.code(201).send({ id: sent.id as string });
    }
  );

  // Pièces reçues (onglet « Reçues ») : jamais celles d'un compte en blocage
  // avec vous, ni celles masquées par la modération.
  fastify.get("/api/pieces/received", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const userId = request.user!.id;
    const blocked = await fetchBlockedUserIds(fastify, userId);

    let query = fastify.supabaseAdmin
      .from("piece_sends")
      .select("id, sender_id, title, image_url, image_thumb_url, merchant_name, merchant_url, product_match_id, price_min, currency, created_at")
      .eq("recipient_id", userId)
      .is("hidden_at", null)
      .order("created_at", { ascending: false })
      .limit(RECEIVED_PAGE_SIZE + 1);
    // Identifiants venus de notre base, jamais du client.
    if (blocked.size > 0) query = query.not("sender_id", "in", `(${[...blocked].join(",")})`);
    if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);

    const rows = parseDbRows(PIECE_ROWS, await query, "Pièces reçues");
    const hasMore = rows.length > RECEIVED_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, RECEIVED_PAGE_SIZE) : rows;
    return reply.send({
      pieces: await toReceivedPieces(fastify, pageRows),
      nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
    });
  });

  // Retirer une pièce reçue : elle disparaît, avec la copie de son image.
  fastify.delete("/api/pieces/received/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("piece_sends")
      .delete()
      .eq("id", params.id)
      .eq("recipient_id", userId)
      .select("sender_id, image_url, image_thumb_url");
    if (error) {
      request.log.error({ error }, "Échec du retrait d'une pièce reçue");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const [removed] = parseDbRows(z.array(z.object({ sender_id: ID, image_url: z.string(), image_thumb_url: z.string() })), { data, error: null }, "Pièce retirée");
    if (!removed) return reply.code(404).send({ error: "piece_not_found", message: "Pièce introuvable." });
    await deleteWishCopy(fastify, removed.sender_id, [removed.image_url, removed.image_thumb_url]);
    return reply.code(204).send();
  });
}
