import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { z } from "zod";
import type { PrivacyLevel, VaultCategory, VaultItem, VaultItemDetail } from "@monapp/shared-types";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { deleteOwnedStorageFile, extractOwnedStoragePath } from "../lib/storage.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseInput } from "../lib/validation.js";

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

const vaultOptionalFieldsSchema = z.object({
  productMatchId: z.string().uuid().optional(),
  privacy: z.enum(PRIVACY_LEVELS as [PrivacyLevel, ...PrivacyLevel[]]).optional(),
});

const updateVaultItemSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  category: z.enum(VAULT_CATEGORIES as [VaultCategory, ...VaultCategory[]]).optional(),
  privacy: z.enum(PRIVACY_LEVELS as [PrivacyLevel, ...PrivacyLevel[]]).optional(),
})
  // Un corps vide passait jusqu'à la base et revenait en 404 trompeur.
  .refine((body) => Object.keys(body).length > 0);

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

const VAULT_PAGE_SIZE = 24;

export default async function vaultRoutes(fastify: FastifyInstance) {
  // Pagination par curseur (created_at du dernier objet reçu), comme le
  // fil — reste correct même si de nouveaux objets sont ajoutés entre deux
  // pages. `count: "exact"` compte les lignes qui passent TOUS les filtres
  // de la requête, curseur inclus — demandé uniquement sur la première page
  // (sans curseur), sinon il ne compterait que les objets restants, pas le
  // vrai total. Utilisé pour le compteur "Vault" du profil.
  fastify.get("/api/vault", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const cursorDate = pageQuery.cursor;

    let query = fastify.supabaseAdmin
      .from("vault_items")
      .select("*", cursorDate ? undefined : { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(VAULT_PAGE_SIZE + 1);

    if (cursorDate) {
      query = query.lt("created_at", cursorDate);
    }

    const { data, error, count } = await query;

    if (error) {
      request.log.error({ error }, "Échec de lecture du vault");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const rows = (data as VaultItemRow[]) ?? [];
    const hasMore = rows.length > VAULT_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, VAULT_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;

    const totalCount = cursorDate ? null : (count ?? pageRows.length);
    return reply.send({ items: pageRows.map(toVaultItem), nextCursor, totalCount });
  });

  fastify.get("/api/vault/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
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

    // Publications "achat" qui montrent cet objet : le retirer les
    // supprimerait aussi (cascade, migration 0014) — le mobile s'en sert
    // pour avertir avant confirmation.
    const { count, error: countError } = await fastify.supabaseAdmin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("vault_item_id", id)
      .eq("user_id", userId);

    if (countError) {
      request.log.error({ countError }, "Échec du comptage des publications d'un objet du vault");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Lien marchand : celui de la pièce identifiée d'origine (Spotter),
    // jamais pour une pièce ajoutée à la main.
    const item = toVaultItem(data as VaultItemRow);
    let merchant: { merchantName: string | null; merchantUrl: string | null; affiliateUrl: string | null } = {
      merchantName: null,
      merchantUrl: null,
      affiliateUrl: null,
    };
    if (item.productMatchId) {
      const { data: match } = await fastify.supabaseAdmin
        .from("product_matches")
        .select("merchant_name, merchant_url")
        .eq("id", item.productMatchId)
        .maybeSingle();
      if (match?.merchant_url) {
        const affiliateUrls = await fetchAffiliateUrls(fastify, [item.productMatchId]);
        merchant = {
          merchantName: match.merchant_name ?? null,
          merchantUrl: match.merchant_url,
          affiliateUrl: affiliateUrls.get(item.productMatchId) ?? null,
        };
      }
    }

    const detail: VaultItemDetail = { ...item, purchasePostCount: count ?? 0, ...merchant };
    return reply.send(detail);
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

    // Champs facultatifs, validés eux aussi (audit Lot Q, SEC-03) : un
    // identifiant ou une confidentialité fantaisistes sont refusés au lieu
    // d'être transmis tels quels à la base.
    const optionalFields = parseInput(
      vaultOptionalFieldsSchema,
      { productMatchId: fields.productMatchId, privacy: fields.privacy },
      reply,
      { error: "invalid_body", message: "Données invalides." }
    );
    if (!optionalFields) return;

    let imageUrl: string;

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
    } else if (optionalFields.productMatchId) {
      // Ajout depuis un produit identifié : l'image vient de la recherche
      // visuelle, potentiellement hébergée par le marchand (donc jamais
      // dans notre propre bucket) — impossible de la limiter au préfixe de
      // l'utilisateur. On va donc la chercher nous-mêmes en base plutôt que
      // de faire confiance à l'URL envoyée par le client, et on vérifie au
      // passage que ce produit appartient bien à une recherche de cet
      // utilisateur (même contrôle que POST /api/product-matches/:id/click).
      const { data: match } = await fastify.supabaseAdmin
        .from("product_matches")
        .select("id, search_id, image_url")
        .eq("id", optionalFields.productMatchId)
        .maybeSingle();

      if (!match) {
        return reply.code(404).send({ error: "product_match_not_found", message: "Produit introuvable." });
      }

      const { data: search } = await fastify.supabaseAdmin
        .from("product_searches")
        .select("id")
        .eq("id", match.search_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (!search) {
        return reply.code(404).send({ error: "product_match_not_found", message: "Produit introuvable." });
      }

      imageUrl = match.image_url as string;
    } else if (fields.imageUrl) {
      // `imageUrl` n'est lue (et donc vérifiée) QUE dans ce cas : lors d'un
      // ajout depuis un produit identifié, l'app l'envoie encore mais le
      // serveur l'ignore — la refuser là casserait « Je l'ai achetée » pour
      // une adresse que personne n'utilise.
      // Ni fichier envoyé ni produit identifié : la seule URL qu'on accepte
      // est celle d'un fichier qui nous appartient déjà, dans le dossier de
      // cet utilisateur — une vraie analyse de l'URL (origine + chemin),
      // jamais une recherche de texte. Toute autre valeur est refusée.
      const path = extractOwnedStoragePath(fields.imageUrl, "vault-media", userId);
      if (!path) {
        return reply.code(400).send({ error: "invalid_body", message: "Cette image n'est pas autorisée." });
      }
      imageUrl = fields.imageUrl;
    } else {
      return reply.code(400).send({ error: "invalid_body", message: "Une photo est obligatoire." });
    }

    let privacy = optionalFields.privacy;
    if (!privacy) {
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
        product_match_id: optionalFields.productMatchId ?? null,
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
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
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
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
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

    // Publications "achat" qui montrent cet objet : supprimées avec lui par
    // la base (cascade, migration 0014 — avec leurs pièces taguées, j'aime
    // et notifications), en une seule instruction atomique. On relève
    // leurs fichiers avant, pour pouvoir les nettoyer du stockage après.
    const { data: purchasePosts, error: postsError } = await fastify.supabaseAdmin
      .from("posts")
      .select("media_url")
      .eq("vault_item_id", id)
      .eq("user_id", userId);

    if (postsError) {
      request.log.error({ postsError }, "Échec de lecture des publications liées à un objet du vault");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const { error } = await fastify.supabaseAdmin.from("vault_items").delete().eq("id", id).eq("user_id", userId);

    if (error) {
      request.log.error({ error }, "Échec de suppression du vault_item");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    // Best-effort : si la photo était hébergée par nous (ajout manuel), on
    // la supprime aussi — mais seulement si son URL prouve qu'elle nous
    // appartient bien, dans le dossier de CET utilisateur (voir
    // extractOwnedStoragePath). Une image externe (venue d'un produit
    // identifié), une URL inattendue, ou un chemin qui n'est pas le sien
    // n'entraîne aucune suppression.
    await deleteOwnedStorageFile(fastify, "vault-media", userId, existing.image_url as string);

    // Une publication "achat" réutilise la photo de l'objet (déjà supprimée
    // ci-dessus) : on ne touche qu'à un éventuel fichier distinct, et
    // seulement s'il est dans le dossier de l'utilisateur (post-media).
    for (const post of (purchasePosts as { media_url: string | null }[]) ?? []) {
      if (post.media_url && post.media_url !== existing.image_url) {
        await deleteOwnedStorageFile(fastify, "post-media", userId, post.media_url);
      }
    }

    return reply.code(204).send();
  });
}
