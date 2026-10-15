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
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { IMAGE_REMOVAL_TARGET_TYPES } from "@monapp/shared-types";
import { removeOwnedFiles } from "./storage.js";
import { parseDbRows } from "./validation.js";
import { WISH_COPY_BUCKET } from "./wishShare.js";

export type ImageRemovalTarget = (typeof IMAGE_REMOVAL_TARGET_TYPES)[number];

/** Refus possibles avant l'enregistrement de la décision. */
export type ImageErasureRefusal = "target_not_found" | "not_a_copy" | "already_removed" | "shared_copy" | "storage_failed";

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
  const report = await removeOwnedFiles(
    fastify,
    WISH_COPY_BUCKET,
    copy.urls.map((url) => ({ ownerId: copy.ownerId, url }))
  );
  if (report.failed > 0) {
    // Des nombres, jamais un chemin ni un identifiant (comme à la suppression de compte).
    log.error({ failed: report.failed }, "Retrait d'image : le stockage refuse l'effacement après 3 essais, rien n'est enregistré");
    return "storage_failed";
  }
  return null;
}
