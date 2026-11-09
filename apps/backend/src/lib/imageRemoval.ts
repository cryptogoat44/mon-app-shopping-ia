// Retirer l'image copiée (lot 5, partie B, décisions du fondateur du
// 2026-10-15) : seulement les copies d'images de marchands faites par notre
// serveur — publication « envie », pièce envoyée —, jamais la photo publiée
// par une personne (elle a « Masquer »). Ordre choisi pour que rien ne se
// perde ni ne reste en ligne en silence :
//   1. lire le contenu visé, refuser ce qui n'est pas une copie ;
//   2. vérifier qu'aucun autre contenu n'utilise ces fichiers : chaque partage
//      fait sa propre copie (lib/wishShare.ts), un fichier commun serait une
//      anomalie — on ne touche alors à rien ;
//   3. effacer les deux fichiers (3 essais, comme à la suppression de compte) :
//      s'ils refusent, rien n'est enregistré et l'administrateur recommence ;
//   4. puis seulement enregistrer la décision (fonction moderation_remove_image,
//      migration 0026), appelée par la route.
// Un fichier déjà absent ne bloque rien : le stockage l'accepte comme effacé.
// Lot modération des collections (migration 0034) : même ordre pour la copie
// de l'image d'une envie d'une collection montrée aux amis (une par envie) ;
// la décision est enregistrée par moderation_remove_collection_image.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IMAGE_REMOVAL_TARGET_TYPES } from "@monapp/shared-types";
import { removeOwnedFiles } from "./storage.js";
import { parseDbRows } from "./validation.js";
import { WISH_COPY_BUCKET } from "./wishShare.js";

/** Publication « envie » ou pièce envoyée (une collection : eraseCollectionCopy). */
export type ImageRemovalTarget = Exclude<(typeof IMAGE_REMOVAL_TARGET_TYPES)[number], "collection">;

/** Refus possibles avant l'enregistrement de la décision. « no_copy » :
 * l'envie d'une collection n'a pas de copie (déjà montrée sans image). */
export type ImageErasureRefusal = "target_not_found" | "not_a_copy" | "no_copy" | "already_removed" | "shared_copy" | "storage_failed";

const ID = z.string().uuid();
const POST_ROWS = z.array(
  z.object({
    user_id: ID,
    type: z.string(),
    media_url: z.string().nullable(),
    media_thumb_url: z.string().nullable(),
    media_removed_at: z.string().nullable(),
  })
);
const PIECE_ROWS = z.array(
  z.object({ sender_id: ID, image_url: z.string().nullable(), image_thumb_url: z.string().nullable(), image_removed_at: z.string().nullable() })
);
const ID_ROWS = z.array(z.object({ id: ID }));
const COLLECTION_ITEM_ROWS = z.array(z.object({ user_id: ID, wishlist_item_id: ID }));
const COLLECTION_COPY_ROWS = z.array(z.object({ image_url: z.string().nullable(), image_thumb_url: z.string().nullable() }));

type CopyLookup = { ownerId: string; urls: string[] } | { refusal: "target_not_found" | "not_a_copy" | "already_removed" };

function present(urls: (string | null)[]): string[] {
  return urls.filter((url): url is string => url !== null);
}

/** Étape 1 : le propriétaire de la copie et ses adresses. Relève DatabaseReadError si la lecture échoue. */
async function findCopy(fastify: FastifyInstance, targetType: ImageRemovalTarget, targetId: string): Promise<CopyLookup> {
  const db = fastify.supabaseAdmin;
  if (targetType === "post") {
    const result = await db.from("posts").select("user_id, type, media_url, media_thumb_url, media_removed_at").eq("id", targetId);
    const post = parseDbRows(POST_ROWS, result, "Publication visée")[0];
    if (!post) return { refusal: "target_not_found" };
    if (post.type !== "wish") return { refusal: "not_a_copy" };
    if (post.media_removed_at !== null) return { refusal: "already_removed" };
    return { ownerId: post.user_id, urls: present([post.media_url, post.media_thumb_url]) };
  }
  const result = await db.from("piece_sends").select("sender_id, image_url, image_thumb_url, image_removed_at").eq("id", targetId);
  const piece = parseDbRows(PIECE_ROWS, result, "Pièce visée")[0];
  if (!piece) return { refusal: "target_not_found" };
  if (piece.image_removed_at !== null) return { refusal: "already_removed" };
  return { ownerId: piece.sender_id, urls: present([piece.image_url, piece.image_thumb_url]) };
}

/** Étape 2 : un AUTRE contenu (publication ou pièce) cite-t-il l'un de ces
 * fichiers ? Relève DatabaseReadError si une lecture échoue. */
async function usedElsewhere(fastify: FastifyInstance, targetType: ImageRemovalTarget, targetId: string, urls: string[]): Promise<boolean> {
  if (urls.length === 0) return false;
  const db = fastify.supabaseAdmin;
  const uses: [table: "posts" | "piece_sends", column: string, owner: ImageRemovalTarget][] = [
    ["posts", "media_url", "post"],
    ["posts", "media_thumb_url", "post"],
    ["piece_sends", "image_url", "piece"],
    ["piece_sends", "image_thumb_url", "piece"],
  ];
  const results = await Promise.all(
    uses.map(([table, column, owner]) => {
      const query = db.from(table).select("id").in(column, urls).limit(1);
      return owner === targetType ? query.neq("id", targetId) : query;
    })
  );
  return results.some((result) => parseDbRows(ID_ROWS, result, "Autres usages de la copie").length > 0);
}

/** Efface les fichiers d'une copie (étape 3), 3 essais. null : effacés (ou
 * déjà absents) ; « storage_failed » sinon (rien n'est enregistré). */
async function eraseFiles(fastify: FastifyInstance, log: FastifyInstance["log"], ownerId: string, urls: string[]): Promise<"storage_failed" | null> {
  const report = await removeOwnedFiles(
    fastify,
    WISH_COPY_BUCKET,
    urls.map((url) => ({ ownerId, url }))
  );
  if (report.failed > 0) {
    // Des nombres, jamais un chemin ni un identifiant (comme à la suppression de compte).
    log.error({ failed: report.failed }, "Retrait d'image : le stockage refuse l'effacement après 3 essais, rien n'est enregistré");
    return "storage_failed";
  }
  return null;
}

/** Étapes 1 à 3. null : fichiers effacés (ou déjà absents), la décision peut
 * être enregistrée ; sinon le refus, sans rien avoir changé. Relève
 * DatabaseReadError si une lecture échoue. */
export async function eraseCopiedImage(
  fastify: FastifyInstance,
  log: FastifyInstance["log"],
  targetType: ImageRemovalTarget,
  targetId: string
): Promise<ImageErasureRefusal | null> {
  const copy = await findCopy(fastify, targetType, targetId);
  if ("refusal" in copy) return copy.refusal;
  if (await usedElsewhere(fastify, targetType, targetId, copy.urls)) {
    log.warn({ targetType }, "Retrait d'image : copie utilisée par un autre contenu, rien n'est effacé");
    return "shared_copy";
  }
  return eraseFiles(fastify, log, copy.ownerId, copy.urls);
}

/** Les mêmes étapes pour la copie de l'image de l'envie `itemId` de la
 * collection `collectionId` (lot modération des collections) : l'envie doit
 * être dans cette collection et avoir une copie encore en place ; aucun autre
 * contenu ne doit citer ces fichiers ; puis les fichiers sont effacés. null :
 * la décision peut être enregistrée ; sinon le refus, sans rien avoir changé.
 * Relève DatabaseReadError si une lecture échoue. */
export async function eraseCollectionCopy(
  fastify: FastifyInstance,
  log: FastifyInstance["log"],
  collectionId: string,
  itemId: string
): Promise<ImageErasureRefusal | null> {
  const db = fastify.supabaseAdmin;
  const item = parseDbRows(
    COLLECTION_ITEM_ROWS,
    await db.from("collection_items").select("user_id, wishlist_item_id").eq("id", itemId).eq("collection_id", collectionId).limit(1),
    "Envie de la collection visée"
  )[0];
  if (!item) return "target_not_found";
  const copy = parseDbRows(
    COLLECTION_COPY_ROWS,
    await db.from("collection_image_copies").select("image_url, image_thumb_url").eq("wishlist_item_id", item.wishlist_item_id).eq("user_id", item.user_id).limit(1),
    "Copie de l'image visée"
  )[0];
  if (!copy) return "no_copy";
  if (copy.image_url === null || copy.image_thumb_url === null) return "already_removed";
  const urls = [copy.image_url, copy.image_thumb_url];
  const uses: [table: "posts" | "piece_sends" | "collection_image_copies", column: string][] = [
    ["posts", "media_url"],
    ["posts", "media_thumb_url"],
    ["piece_sends", "image_url"],
    ["piece_sends", "image_thumb_url"],
    ["collection_image_copies", "image_url"],
    ["collection_image_copies", "image_thumb_url"],
  ];
  const results = await Promise.all(
    uses.map(([table, column]) => {
      if (table !== "collection_image_copies") return db.from(table).select("id").in(column, urls).limit(1);
      return db.from(table).select("wishlist_item_id").in(column, urls).neq("wishlist_item_id", item.wishlist_item_id).limit(1);
    })
  );
  if (results.some((result) => parseDbRows(z.array(z.unknown()), result, "Autres usages de la copie").length > 0)) {
    log.warn({ targetType: "collection" }, "Retrait d'image : copie utilisée par un autre contenu, rien n'est effacé");
    return "shared_copy";
  }
  return eraseFiles(fastify, log, item.user_id, urls);
}
