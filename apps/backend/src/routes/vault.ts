import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrivacyLevel, VaultCategory, VaultItem } from "@monapp/shared-types";
import { isFileTooLargeError } from "../lib/multipartErrors.js";

const VAULT_CATEGORIES: VaultCategory[] = [
  "clothing",
  "watches",
  "accessories",
  "shoes",
  "bags",
  "home",
  "other",
];
const PRIVACY_LEVELS: PrivacyLevel[] = ["public", "followers", "private"];

const updateVaultItemSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  category: z.enum(VAULT_CATEGORIES as [VaultCategory, ...VaultCategory[]]).optional(),
  privacy: z.enum(PRIVACY_LEVELS as [PrivacyLevel, ...PrivacyLevel[]]).optional(),
});

interface VaultItemRow {
  id: string;
  title: string;
  image_url: string;
  category: VaultCategory;
  privacy: PrivacyLevel;
  verified: boolean;
  product_match_id: string | null;
  created_at: string;
}

function toVaultItem(row: VaultItemRow): VaultItem {
  return {
    id: row.id,
    title: row.title,
    imageUrl: row.image_url,
    category: row.category,
    privacy: row.privacy,
    verified: row.verified,
    productMatchId: row.product_match_id,
    createdAt: row.created_at,
  };
}

const VAULT_MEDIA_PUBLIC_PREFIX = "/storage/v1/object/public/vault-media/";

export default async function vaultRoutes(fastify: FastifyInstance) {
  fastify.get("/api/vault", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("vault_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture du vault");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.send((data as VaultItemRow[]).map(toVaultItem));
  });

  fastify.get("/api/vault/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const { data, error } = await fastify.supabaseAdmin
      .from("vault_items")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return reply.code(404).send({ error: "vault_item_not_found", message: "Objet introuvable." });
    }

    return reply.send(toVaultItem(data as VaultItemRow));
  });

  // multipart toujours : soit un fichier (ajout manuel, photo importée
  // depuis l'appareil), soit un champ imageUrl (ajout depuis un produit
  // identifié — l'image vient déjà de la recherche visuelle).
  fastify.post("/api/vault", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileMimetype: string | null = null;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          fileBuffer = await part.toBuffer();
          fileMimetype = part.mimetype;
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
      }
      throw error;
    }

    const title = fields.title?.trim();
    const category = fields.category as VaultCategory | undefined;

    if (!title || !category || !VAULT_CATEGORIES.includes(category)) {
      return reply.code(400).send({ error: "invalid_body", message: "Titre et catégorie sont obligatoires." });
    }
    if (title.length > 120) {
      return reply.code(400).send({ error: "invalid_body", message: "Le titre est trop long (120 caractères maximum)." });
    }

    if (!fileBuffer && !fields.imageUrl) {
      return reply.code(400).send({ error: "invalid_body", message: "Une photo est obligatoire." });
    }

    let imageUrl = fields.imageUrl ?? null;

    if (fileBuffer) {
      if (!fileMimetype?.startsWith("image/")) {
        return reply.code(400).send({ error: "invalid_file", message: "Le fichier doit être une image." });
      }
      const extension = fileMimetype.split("/")[1] ?? "jpg";
      const path = `${userId}/${randomUUID()}.${extension}`;

      const { error: uploadError } = await fastify.supabaseAdmin.storage
        .from("vault-media")
        .upload(path, fileBuffer, { contentType: fileMimetype, upsert: false });

      if (uploadError) {
        request.log.error({ uploadError }, "Échec d'upload de la photo du vault");
        return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
      }

      imageUrl = fastify.supabaseAdmin.storage.from("vault-media").getPublicUrl(path).data.publicUrl;
    }

    let privacy = fields.privacy as PrivacyLevel | undefined;
    if (!privacy || !PRIVACY_LEVELS.includes(privacy)) {
      const { data: profile } = await fastify.supabaseAdmin
        .from("profiles")
        .select("default_privacy")
        .eq("id", userId)
        .single();
      privacy = (profile?.default_privacy as PrivacyLevel | undefined) ?? "followers";
    }

    const { data: inserted, error: insertError } = await fastify.supabaseAdmin
      .from("vault_items")
      .insert({
        user_id: userId,
        title,
        image_url: imageUrl,
        category,
        privacy,
        product_match_id: fields.productMatchId || null,
        // Aucune vérification automatique pour l'instant : ça nécessite un
        // webhook de conversion d'un vrai programme d'affiliation, pas
        // encore rejoint. Voir la note du bloc 3.
        verified: false,
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      request.log.error({ insertError }, "Échec de création du vault_item");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    return reply.send(toVaultItem(inserted as VaultItemRow));
  });

  fastify.patch("/api/vault/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const parsed = updateVaultItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", message: "Requête invalide." });
    }

    const updates: Record<string, string> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.privacy !== undefined) updates.privacy = parsed.data.privacy;

    const { data: updated, error } = await fastify.supabaseAdmin
      .from("vault_items")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error || !updated) {
      return reply.code(404).send({ error: "vault_item_not_found", message: "Objet introuvable." });
    }

    return reply.send(toVaultItem(updated as VaultItemRow));
  });

  fastify.delete("/api/vault/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const { data: existing } = await fastify.supabaseAdmin
      .from("vault_items")
      .select("image_url")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (!existing) {
      return reply.code(404).send({ error: "vault_item_not_found", message: "Objet introuvable." });
    }

    const { error } = await fastify.supabaseAdmin.from("vault_items").delete().eq("id", id).eq("user_id", userId);

    if (error) {
      request.log.error({ error }, "Échec de suppression du vault_item");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Best-effort : si la photo était hébergée par nous (ajout manuel),
    // on la supprime aussi. Une image externe (venue d'un produit
    // identifié) n'est jamais touchée.
    const publicUrlIndex = (existing.image_url as string).indexOf(VAULT_MEDIA_PUBLIC_PREFIX);
    if (publicUrlIndex !== -1) {
      const path = (existing.image_url as string).slice(publicUrlIndex + VAULT_MEDIA_PUBLIC_PREFIX.length);
      await fastify.supabaseAdmin.storage.from("vault-media").remove([path]);
    }

    return reply.code(204).send();
  });
}
