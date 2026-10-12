// Partage d'une envie (lot 5, section 5.C) : la copie de son image, faite par
// notre serveur au moment du partage (lib/publicImage.ts), puis rangée dans
// le dossier de la personne qui partage (post-media/<id>/…). Les publications
// « envie » et les pièces envoyées ne montrent jamais que cette copie.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRIVACY_LEVELS } from "@monapp/shared-types";
import { downloadPublicImage } from "./publicImage.js";
import { PHOTO_SIZES, optimizePhoto } from "./photos.js";
import { fetchHdImageUrls } from "./pieceImages.js";
import { DatabaseReadError, parseDbRows } from "./validation.js";
import { deleteOwnedStorageFile } from "./storage.js";

/** Bucket de la copie : celui des photos publiées, déjà vidé à la
 * suppression du compte (lib/storage.ts). */
export const WISH_COPY_BUCKET = "post-media";

export class WishImageError extends Error {}

const ID = z.string().uuid();
export const wishRowSchema = z.object({
  id: ID,
  user_id: ID,
  title: z.string(),
  image_url: z.string(),
  price_min: z.union([z.string(), z.number()]).nullable(),
  currency: z.string().nullable(),
  merchant_name: z.string().nullable(),
  merchant_url: z.string().nullable(),
  product_match_id: ID.nullable(),
  created_at: z.string(),
});
export type WishRow = z.infer<typeof wishRowSchema>;

/** L'envie `id` de `userId` (jamais celle d'un autre), ou null. */
export async function findOwnWish(fastify: FastifyInstance, userId: string, id: string): Promise<WishRow | null> {
  const { data, error } = await fastify.supabaseAdmin.from("wishlist_items").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new DatabaseReadError("Lecture d'une envie impossible");
  if (data === null) return null;
  const parsed = wishRowSchema.safeParse(data);
  if (!parsed.success) throw new DatabaseReadError("Envie illisible");
  return parsed.data;
}

const SHARED_POST_ROWS = z.array(z.object({ id: ID, privacy: z.enum(PRIVACY_LEVELS), created_at: z.string(), hidden_at: z.string().nullable() }));

/** La publication « envie » de cette envie (au plus une), masquée ou non. */
export async function findWishPost(fastify: FastifyInstance, wishId: string) {
  const rows = parseDbRows(
    SHARED_POST_ROWS,
    await fastify.supabaseAdmin.from("posts").select("id, privacy, created_at, hidden_at").eq("wishlist_item_id", wishId).limit(1),
    "Publication d'une envie"
  );
  return rows[0] ?? null;
}

/** Adresses à essayer, dans l'ordre : l'image haute définition du marchand
 * (pièce venue du Spotter, image d'origine), puis l'image de l'envie. */
async function imageSources(fastify: FastifyInstance, wish: WishRow): Promise<string[]> {
  const [hd] = await fetchHdImageUrls(fastify, [wish]);
  return [...new Set([hd, wish.image_url].filter((url): url is string => Boolean(url)))];
}

/** Copie l'image de l'envie (téléchargée, ré-encodée en JPEG sans
 * métadonnées, en deux tailles) dans le dossier de `userId`. Aucune copie
 * possible : WishImageError — le partage est alors refusé, comme une
 * publication Instagram dont l'image n'a pas pu être récupérée. */
export async function copyWishImage(fastify: FastifyInstance, userId: string, wish: WishRow): Promise<{ url: string; thumbUrl: string }> {
  let display: Buffer | null = null;
  let thumb: Buffer | null = null;
  for (const source of await imageSources(fastify, wish)) {
    try {
      const original = await downloadPublicImage(source);
      [display, thumb] = await Promise.all([optimizePhoto(original, PHOTO_SIZES.display), optimizePhoto(original, PHOTO_SIZES.thumb, 78)]);
      break;
    } catch (error) {
      fastify.log.warn({ reason: error instanceof Error ? error.message : "inconnue" }, "Copie de l'image d'une envie : source écartée");
    }
  }
  if (!display || !thumb) throw new WishImageError("Image de l'envie irrécupérable");

  const base = `${userId}/${randomUUID()}`;
  const bucket = fastify.supabaseAdmin.storage.from(WISH_COPY_BUCKET);
  const [displayUpload, thumbUpload] = await Promise.all([
    bucket.upload(`${base}.jpg`, display, { contentType: "image/jpeg", upsert: false }),
    bucket.upload(`${base}-mini.jpg`, thumb, { contentType: "image/jpeg", upsert: false }),
  ]);
  if (displayUpload.error || thumbUpload.error) {
    await bucket.remove([`${base}.jpg`, `${base}-mini.jpg`]);
    throw new Error("Échec de l'enregistrement de la copie de l'image");
  }
  return {
    url: bucket.getPublicUrl(`${base}.jpg`).data.publicUrl,
    thumbUrl: bucket.getPublicUrl(`${base}-mini.jpg`).data.publicUrl,
  };
}

/** Supprime une copie (deux tailles), seulement dans le dossier de `ownerId`. */
export async function deleteWishCopy(fastify: FastifyInstance, ownerId: string, urls: (string | null)[]): Promise<void> {
  for (const url of urls) {
    if (url) await deleteOwnedStorageFile(fastify, WISH_COPY_BUCKET, ownerId, url);
  }
}
