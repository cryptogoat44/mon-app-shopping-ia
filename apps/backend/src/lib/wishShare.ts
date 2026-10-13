// Partage d'une envie (lot 5, section 5.C) : la copie de son image, faite par
// notre serveur au moment du partage (lib/publicImage.ts), puis rangée dans
// le dossier de la personne qui partage (post-media/<id>/…). Les publications
// « envie » et les pièces envoyées ne montrent jamais que cette copie.
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { PRIVACY_LEVELS } from "@monapp/shared-types";
import { ImageSourceError } from "./imageProcessing.js";
import { PublicImageError, downloadPublicImage } from "./publicImage.js";
import { encodeSharedCopy, measureSharedSource, type SharedCopy } from "./photos.js";
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

/** Une source possible de la copie, et sa nature (pour le journal). */
interface ImageSource {
  kind: "hd" | "thumbnail";
  url: string;
}

/** Une source téléchargée et lisible, avec ses dimensions. */
interface Candidate {
  source: ImageSource;
  original: Buffer;
  width: number;
  height: number;
}

// À taille égale, l'image haute définition du marchand passe avant la vignette.
const KIND_ORDER: Record<ImageSource["kind"], number> = { hd: 0, thumbnail: 1 };

/** Sources possibles : l'image haute définition du marchand (pièce venue du
 * Spotter, image d'origine) et l'image de l'envie (souvent la vignette de
 * Google). La « haute définition » n'en est pas toujours une : beaucoup de
 * marchands donnent une petite version (constaté : 200 à 513 px de large),
 * parfois plus petite que la vignette — d'où le choix par la taille réelle. */
async function imageSources(fastify: FastifyInstance, wish: WishRow): Promise<ImageSource[]> {
  const [hd] = await fetchHdImageUrls(fastify, [wish]);
  const sources: ImageSource[] = hd ? [{ kind: "hd", url: hd }] : [];
  if (wish.image_url && wish.image_url !== hd) sources.push({ kind: "thumbnail", url: wish.image_url });
  return sources;
}

/** Nom d'hôte seulement : jamais l'adresse complète dans le journal (le
 * chemin d'une image de marchand, relié à la requête, dirait ce qu'une
 * personne désire). Il suffit pour voir quel marchand refuse notre serveur. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "adresse invalide";
  }
}

/** Motif d'un refus, pour le journal : nos propres messages seulement
 * (jamais le texte d'une erreur imprévue, qui pourrait contenir une adresse). */
function reasonOf(error: unknown): string {
  return error instanceof PublicImageError || error instanceof ImageSourceError ? error.message : "inconnue";
}

/** Copie l'image de l'envie (téléchargée, ré-encodée en JPEG sans
 * métadonnées, en deux tailles : lib/photos.ts, encodeSharedCopy) dans le
 * dossier de `userId`. Les sources sont téléchargées ensemble ; la plus
 * grande image réellement reçue l'emporte (à égalité : la haute définition),
 * et si elle ne se décode pas jusqu'au bout, la suivante prend sa place. Le
 * journal de la requête (`log`) dit quelle source a été retenue ou écartée,
 * et pourquoi : sa nature, son nom d'hôte, jamais l'adresse complète, ni la
 * personne, ni l'envie. Aucune copie possible : WishImageError — le partage
 * est alors refusé, comme une publication Instagram dont l'image n'a pas pu
 * être récupérée. */
export async function copyWishImage(
  fastify: FastifyInstance,
  log: FastifyBaseLogger,
  userId: string,
  wish: WishRow
): Promise<{ url: string; thumbUrl: string }> {
  const discard = (source: ImageSource, error: unknown) =>
    log.warn(
      {
        source: source.kind,
        host: hostOf(source.url),
        status: error instanceof PublicImageError ? error.status : undefined,
        reason: reasonOf(error),
      },
      "Copie de l'image d'une envie : source écartée"
    );

  // Téléchargements en parallèle, chacun sous les garde-fous de publicImage.ts.
  const sources = await imageSources(fastify, wish);
  const downloads = await Promise.allSettled(sources.map((source) => downloadPublicImage(source.url)));
  const candidates: Candidate[] = [];
  for (const [index, download] of downloads.entries()) {
    const source = sources[index]!;
    if (download.status === "rejected") {
      discard(source, download.reason);
      continue;
    }
    try {
      candidates.push({ source, original: download.value, ...(await measureSharedSource(download.value)) });
    } catch (error) {
      discard(source, error);
    }
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height || KIND_ORDER[a.source.kind] - KIND_ORDER[b.source.kind]);

  // La plus grande d'abord ; l'en-tête a pu se lire sans que l'image entière
  // se décode (fichier tronqué) : la suivante est alors essayée.
  let copy: SharedCopy | null = null;
  let keptIndex = -1;
  for (const [index, candidate] of candidates.entries()) {
    try {
      copy = await encodeSharedCopy(candidate.original);
      keptIndex = index;
      break;
    } catch (error) {
      discard(candidate.source, error);
    }
  }
  const kept = candidates[keptIndex];
  if (!copy || !kept) throw new WishImageError("Image de l'envie irrécupérable");
  log.info(
    { source: kept.source.kind, host: hostOf(kept.source.url), width: kept.width, height: kept.height, bytes: copy.display.length },
    "Copie de l'image d'une envie : source retenue"
  );
  // Les autres, lisibles mais pas plus grandes : leurs dimensions disent si la
  // « haute définition » du marchand n'était qu'une petite version.
  for (const other of candidates.slice(keptIndex + 1)) {
    log.info(
      { source: other.source.kind, host: hostOf(other.source.url), width: other.width, height: other.height },
      "Copie de l'image d'une envie : autre source, non retenue"
    );
  }

  const base = `${userId}/${randomUUID()}`;
  const bucket = fastify.supabaseAdmin.storage.from(WISH_COPY_BUCKET);
  const [displayUpload, thumbUpload] = await Promise.all([
    bucket.upload(`${base}.jpg`, copy.display, { contentType: "image/jpeg", upsert: false }),
    bucket.upload(`${base}-mini.jpg`, copy.thumb, { contentType: "image/jpeg", upsert: false }),
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
