import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Post, PostTaggedPiece, PostType, PrivacyLevel, TaggedPieceInput } from "@monapp/shared-types";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { fetchAffiliateUrls } from "../lib/affiliateLinks.js";
import { INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseInput } from "../lib/validation.js";
import { canViewPost } from "../lib/visibility.js";
import { deleteOwnedStorageFile, extractOwnedStoragePath } from "../lib/storage.js";

const POST_TYPES: PostType[] = ["lifestyle", "purchase"];
const PRIVACY_LEVELS: PrivacyLevel[] = ["public", "followers", "private"];

// Une publication ne peut pas devenir une liste sans fin de tags — reste
// large pour un usage légitime (plusieurs pièces sur une même tenue) sans
// ouvrir la porte à un abus.
const MAX_TAGGED_PIECES = 10;

const taggedPieceInputSchema = z.union([
  z.object({ vaultItemId: z.string().uuid() }).strict(),
  z.object({ productMatchId: z.string().uuid() }).strict(),
]);
const postOptionalFieldsSchema = z.object({
  vaultItemId: z.string().uuid().optional(),
  privacy: z.enum(PRIVACY_LEVELS as [PrivacyLevel, ...PrivacyLevel[]]).optional(),
});

const taggedPiecesInputSchema = z.array(taggedPieceInputSchema).max(MAX_TAGGED_PIECES);

const updatePostSchema = z.object({
  privacy: z.enum(PRIVACY_LEVELS as [PrivacyLevel, ...PrivacyLevel[]]),
});

export interface PostRow {
  id: string;
  user_id: string;
  type: PostType;
  vault_item_id: string | null;
  caption: string | null;
  media_url: string | null;
  privacy: PrivacyLevel;
  created_at: string;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface VaultItemRow {
  id: string;
  title: string;
  verified: boolean;
}

interface TaggedVaultItemRow {
  id: string;
  title: string;
  image_url: string;
}

interface TaggedProductMatchRow {
  id: string;
  product_name: string;
  image_url: string;
  merchant_name: string | null;
  merchant_url: string;
}

interface PostTaggedPieceRow {
  id: string;
  post_id: string;
  vault_item_id: string | null;
  product_match_id: string | null;
  position: number;
}

/** Résultat d'une pièce taguée déjà validée (propriétaire confirmé),
 * prête à insérer dans post_tagged_pieces. */
interface ResolvedTaggedPiece {
  vaultItemId: string | null;
  productMatchId: string | null;
}

/** Vérifie côté serveur que chaque pièce à taguer appartient bien à
 * l'utilisateur — une pièce d'origine Vault OU d'une recherche récente,
 * jamais les deux à la fois (voir le schéma de post_tagged_pieces). Ne
 * fait jamais confiance à l'origine déclarée par le client sans vérifier
 * la propriété réelle en base, comme pour vaultItemId sur un post "achat"
 * ou productMatchId sur POST /api/vault. Renvoie `null` si une seule
 * pièce échoue — dans ce cas, aucune n'est insérée. */
async function resolveTaggedPieces(
  fastify: FastifyInstance,
  userId: string,
  inputs: TaggedPieceInput[]
): Promise<ResolvedTaggedPiece[] | null> {
  const seen = new Set<string>();
  const resolved: ResolvedTaggedPiece[] = [];

  for (const input of inputs) {
    if ("vaultItemId" in input) {
      const key = `vault:${input.vaultItemId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const { data: vaultItem } = await fastify.supabaseAdmin
        .from("vault_items")
        .select("id")
        .eq("id", input.vaultItemId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!vaultItem) return null;

      resolved.push({ vaultItemId: input.vaultItemId, productMatchId: null });
    } else {
      const key = `match:${input.productMatchId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Même logique que POST /api/vault : un product_match n'a pas de
      // user_id direct, la propriété passe par sa recherche parente.
      const { data: match } = await fastify.supabaseAdmin
        .from("product_matches")
        .select("id, search_id")
        .eq("id", input.productMatchId)
        .maybeSingle();
      if (!match) return null;

      const { data: search } = await fastify.supabaseAdmin
        .from("product_searches")
        .select("id")
        .eq("id", match.search_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!search) return null;

      resolved.push({ vaultItemId: null, productMatchId: input.productMatchId });
    }
  }

  return resolved;
}

export async function hydratePosts(fastify: FastifyInstance, rows: PostRow[], viewerId: string): Promise<Post[]> {
  if (rows.length === 0) return [];

  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const vaultItemIds = [...new Set(rows.map((r) => r.vault_item_id).filter((id): id is string => !!id))];
  const postIds = rows.map((r) => r.id);

  const [{ data: profiles }, { data: vaultItems }, { data: reactions }, { data: tagRows }, { data: commentRows }] = await Promise.all([
    fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", authorIds),
    vaultItemIds.length > 0
      ? fastify.supabaseAdmin.from("vault_items").select("id, title, verified").in("id", vaultItemIds)
      : Promise.resolve({ data: [] as VaultItemRow[] }),
    fastify.supabaseAdmin.from("post_reactions").select("post_id, user_id").in("post_id", postIds),
    fastify.supabaseAdmin
      .from("post_tagged_pieces")
      .select("id, post_id, vault_item_id, product_match_id, position")
      .in("post_id", postIds)
      .order("position", { ascending: true }),
    fastify.supabaseAdmin.from("comments").select("post_id").in("post_id", postIds).is("hidden_at", null),
  ]);

  const commentCountByPost = new Map<string, number>();
  for (const c of (commentRows as { post_id: string }[]) ?? []) {
    commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) ?? 0) + 1);
  }

  const profileById = new Map(((profiles as ProfileRow[]) ?? []).map((p) => [p.id, p]));
  const vaultItemById = new Map(((vaultItems as VaultItemRow[]) ?? []).map((v) => [v.id, v]));

  const reactionCountByPost = new Map<string, number>();
  const viewerReactedPosts = new Set<string>();
  for (const r of (reactions as { post_id: string; user_id: string }[]) ?? []) {
    reactionCountByPost.set(r.post_id, (reactionCountByPost.get(r.post_id) ?? 0) + 1);
    if (r.user_id === viewerId) viewerReactedPosts.add(r.post_id);
  }

  const tags = (tagRows as PostTaggedPieceRow[]) ?? [];
  const taggedVaultItemIds = [...new Set(tags.map((t) => t.vault_item_id).filter((id): id is string => !!id))];
  const taggedMatchIds = [...new Set(tags.map((t) => t.product_match_id).filter((id): id is string => !!id))];

  const [{ data: taggedVaultItems }, { data: taggedMatches }, affiliateUrlByMatchId] = await Promise.all([
    taggedVaultItemIds.length > 0
      ? fastify.supabaseAdmin.from("vault_items").select("id, title, image_url").in("id", taggedVaultItemIds)
      : Promise.resolve({ data: [] as TaggedVaultItemRow[] }),
    taggedMatchIds.length > 0
      ? fastify.supabaseAdmin
          .from("product_matches")
          .select("id, product_name, image_url, merchant_name, merchant_url")
          .in("id", taggedMatchIds)
      : Promise.resolve({ data: [] as TaggedProductMatchRow[] }),
    fetchAffiliateUrls(fastify, taggedMatchIds),
  ]);

  const taggedVaultItemById = new Map(((taggedVaultItems as TaggedVaultItemRow[]) ?? []).map((v) => [v.id, v]));
  const taggedMatchById = new Map(((taggedMatches as TaggedProductMatchRow[]) ?? []).map((m) => [m.id, m]));

  const taggedPiecesByPost = new Map<string, PostTaggedPiece[]>();
  for (const tag of tags) {
    let piece: PostTaggedPiece | null = null;

    if (tag.vault_item_id) {
      // Pièce d'origine Vault : titre/image uniquement, jamais de lien
      // marchand (voir docs/journal-decisions.md, 2026-09-23, Décision 1 —
      // la confidentialité de la pièce dans le Vault n'a aucun effet ici,
      // c'est un choix mobile qui n'implique aucune logique côté serveur).
      const v = taggedVaultItemById.get(tag.vault_item_id);
      if (v) {
        piece = {
          id: tag.id,
          productName: v.title,
          imageUrl: v.image_url,
          merchantName: null,
          merchantUrl: null,
          productMatchId: null,
        };
      }
    } else if (tag.product_match_id) {
      const m = taggedMatchById.get(tag.product_match_id);
      if (m) {
        piece = {
          id: tag.id,
          productName: m.product_name,
          imageUrl: m.image_url,
          merchantName: m.merchant_name,
          merchantUrl: affiliateUrlByMatchId.get(tag.product_match_id) ?? m.merchant_url,
          productMatchId: tag.product_match_id,
        };
      }
    }

    // La ligne référencée a disparu entre l'insertion du tag et cette
    // lecture (cas normalement impossible : suppression en cascade des
    // deux côtés) — ignorée plutôt que de faire échouer toute la page.
    if (!piece) continue;

    const list = taggedPiecesByPost.get(tag.post_id) ?? [];
    list.push(piece);
    taggedPiecesByPost.set(tag.post_id, list);
  }

  return rows.map((row) => {
    const author = profileById.get(row.user_id);
    const vaultItem = row.vault_item_id ? vaultItemById.get(row.vault_item_id) : undefined;
    return {
      id: row.id,
      type: row.type,
      caption: row.caption,
      mediaUrl: row.media_url!,
      privacy: row.privacy,
      createdAt: row.created_at,
      author: {
        id: row.user_id,
        username: author?.username ?? "",
        displayName: author?.display_name ?? "",
        avatarUrl: author?.avatar_url ?? null,
      },
      vaultItem: vaultItem ? { id: vaultItem.id, title: vaultItem.title, verified: vaultItem.verified } : null,
      taggedPieces: taggedPiecesByPost.get(row.id) ?? [],
      reactionCount: reactionCountByPost.get(row.id) ?? 0,
      viewerHasReacted: viewerReactedPosts.has(row.id),
      commentCount: commentCountByPost.get(row.id) ?? 0,
    };
  });
}

const FEED_PAGE_SIZE = 15;

export default async function postsRoutes(fastify: FastifyInstance) {
  // Fil d'activité : uniquement les publications des comptes suivis
  // (jamais les siennes), jamais les publications "privé" — même pour un
  // abonné, "privé" veut dire visible nulle part en dehors du profil de
  // son auteur.
  //
  // Pagination par curseur (created_at de la dernière publication reçue) au
  // lieu d'offset : reste correct même si de nouvelles publications
  // arrivent entre deux pages. On demande une page de plus que nécessaire
  // pour savoir s'il reste du contenu, sans jamais l'envoyer au client.
  fastify.get("/api/feed", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;
    const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
    if (!pageQuery) return;
    const cursorDate = pageQuery.cursor;

    const { data: follows } = await fastify.supabaseAdmin
      .from("follows")
      .select("followee_id")
      .eq("follower_id", userId);

    // Lot F (décision du fondateur) : le fil montre AUSSI ses propres
    // publications (toutes, même privées), mêlées à celles des comptes suivis
    // (publiques et « abonnés »), par ordre chronologique. Les identifiants
    // viennent de notre base, jamais du client. Un blocage retire l'abonnement
    // (routes/blocks.ts) : un compte bloqué n'est jamais dans cette liste.
    const followeeIds = (follows ?? []).map((f) => f.followee_id as string);
    const visibility =
      followeeIds.length > 0
        ? `user_id.eq.${userId},and(user_id.in.(${followeeIds.join(",")}),privacy.in.(public,followers))`
        : `user_id.eq.${userId}`;

    let query = fastify.supabaseAdmin
      .from("posts")
      .select("*")
      .or(visibility)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);

    if (cursorDate) {
      query = query.lt("created_at", cursorDate);
    }

    const { data: posts, error } = await query;

    if (error) {
      request.log.error({ error }, "Échec de lecture du fil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const rows = (posts as PostRow[]) ?? [];
    const hasMore = rows.length > FEED_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;

    const hydrated = await hydratePosts(fastify, pageRows, userId);
    return reply.send({ posts: hydrated, nextCursor });
  });

  // Alimente le segment "Lifestyle" du profil : uniquement les publications
  // de type "lifestyle" de l'utilisateur (les posts "achat" sont déjà
  // visibles via le segment Vault, pas la peine de les dupliquer ici).
  // Aucun filtre de confidentialité : c'est le propriétaire qui consulte
  // son propre profil, il voit tout ce qu'il a publié.
  fastify.get("/api/posts/mine", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data: posts, error } = await fastify.supabaseAdmin
      .from("posts")
      .select("*")
      .eq("user_id", userId)
      .eq("type", "lifestyle")
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des publications lifestyle");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const hydrated = await hydratePosts(fastify, (posts as PostRow[]) ?? [], userId);
    return reply.send(hydrated);
  });

  // multipart toujours, comme /api/vault : soit une photo importée (post
  // "lifestyle"), soit une référence à un objet du vault dont on reprend
  // la photo et le titre (post "achat"). "pieceTag" limite les publications
  // taguées comme les autres actions sensibles à l'abus (voir rateLimits.ts).
  fastify.post(
    "/api/posts",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("pieceTag")], config: { rateLimitName: "pieceTag" } },
    async (request, reply) => {
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

      const type = fields.type as PostType | undefined;
      if (!type || !POST_TYPES.includes(type)) {
        return reply.code(400).send({ error: "invalid_body", message: "Type de publication invalide." });
      }

      let mediaUrl: string;
      let vaultItemId: string | null = null;
      let caption = fields.caption?.trim() || null;

      if (caption && caption.length > 280) {
        return reply.code(400).send({ error: "invalid_body", message: "Le texte est trop long (280 caractères maximum)." });
      }

      // Pièces taguées (étape 1.E) : origine Vault ou recherche récente,
      // validée côté serveur ci-dessous — jamais de confiance dans
      // l'origine déclarée par le client seule.
      let taggedPiecesInput: TaggedPieceInput[] = [];
      if (fields.taggedPieces) {
        let raw: unknown;
        try {
          raw = JSON.parse(fields.taggedPieces);
        } catch {
          return reply.code(400).send({ error: "invalid_body", message: "Pièces taguées invalides." });
        }
        const parsed = taggedPiecesInputSchema.safeParse(raw);
        if (!parsed.success) {
          return reply.code(400).send({ error: "invalid_body", message: "Pièces taguées invalides." });
        }
        taggedPiecesInput = parsed.data;
      }

      let resolvedTaggedPieces: ResolvedTaggedPiece[] = [];
      if (taggedPiecesInput.length > 0) {
        const resolved = await resolveTaggedPieces(fastify, userId, taggedPiecesInput);
        if (!resolved) {
          return reply.code(404).send({ error: "piece_not_found", message: "Une pièce taguée est introuvable." });
        }
        resolvedTaggedPieces = resolved;
      }

      const optionalFields = parseInput(
        postOptionalFieldsSchema,
        { vaultItemId: fields.vaultItemId, privacy: fields.privacy },
        reply,
        { error: "invalid_body", message: "Données invalides." }
      );
      if (!optionalFields) return;

      if (type === "purchase") {
        vaultItemId = optionalFields.vaultItemId ?? null;
        if (!vaultItemId) {
          return reply.code(400).send({ error: "invalid_body", message: "Objet du vault manquant." });
        }
        const { data: vaultItem } = await fastify.supabaseAdmin
          .from("vault_items")
          .select("id, title, image_url")
          .eq("id", vaultItemId)
          .eq("user_id", userId)
          .single();

        if (!vaultItem) {
          return reply.code(404).send({ error: "vault_item_not_found", message: "Objet du vault introuvable." });
        }
        // Une pièce ne se partage qu'une fois à la fois (Lot F, décision
        // documentée dans docs/journal-decisions.md) : pour la montrer
        // autrement, on supprime d'abord sa publication.
        const { data: alreadyShared } = await fastify.supabaseAdmin
          .from("posts")
          .select("id")
          .eq("user_id", userId)
          .eq("type", "purchase")
          .eq("vault_item_id", vaultItemId)
          .limit(1);
        if (alreadyShared && alreadyShared.length > 0) {
          return reply.code(409).send({
            error: "already_shared",
            message:
              "Cette pièce est déjà partagée dans votre fil. Pour changer qui la voit, modifiez la visibilité de cette publication (depuis la publication).",
          });
        }
        mediaUrl = vaultItem.image_url;
        caption = caption ?? vaultItem.title;
      } else {
        if (!fileBuffer || !fileMimetype?.startsWith("image/")) {
          return reply.code(400).send({ error: "invalid_file", message: "Une photo est obligatoire." });
        }
        const extension = fileMimetype.split("/")[1] ?? "jpg";
        const path = `${userId}/${randomUUID()}.${extension}`;

        const { error: uploadError } = await fastify.supabaseAdmin.storage
          .from("post-media")
          .upload(path, fileBuffer, { contentType: fileMimetype, upsert: false });

        if (uploadError) {
          request.log.error({ uploadError }, "Échec d'upload de la photo du post");
          return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
        }

        mediaUrl = fastify.supabaseAdmin.storage.from("post-media").getPublicUrl(path).data.publicUrl;
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
        .from("posts")
        .insert({
          user_id: userId,
          type,
          vault_item_id: vaultItemId,
          caption,
          media_kind: "photo",
          media_url: mediaUrl,
          privacy,
        })
        .select("*")
        .single();

      if (insertError || !inserted) {
        request.log.error({ insertError }, "Échec de création du post");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }

      if (resolvedTaggedPieces.length > 0) {
        const { error: tagError } = await fastify.supabaseAdmin.from("post_tagged_pieces").insert(
          resolvedTaggedPieces.map((piece, index) => ({
            post_id: inserted.id,
            vault_item_id: piece.vaultItemId,
            product_match_id: piece.productMatchId,
            position: index,
          }))
        );
        // Best-effort : le post existe déjà et reste valide même si
        // l'enregistrement des tags échoue — on journalise pour pouvoir
        // repérer une éventuelle panne récurrente, sans faire échouer une
        // publication déjà créée avec succès.
        if (tagError) {
          request.log.error({ tagError }, "Échec d'enregistrement des pièces taguées");
        }
      }

      const [hydrated] = await hydratePosts(fastify, [inserted as PostRow], userId);
      return reply.send(hydrated);
    }
  );

  // Détail d'une publication (Lot Q, bloc 3) : visible selon sa propre
  // confidentialité et les blocages (voir lib/visibility.ts) ; sinon 404,
  // sans distinguer « n'existe pas » de « pas pour vous ».
  fastify.get("/api/posts/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;

    const { data: post } = await fastify.supabaseAdmin.from("posts").select("*").eq("id", params.id).maybeSingle();
    if (!post || !(await canViewPost(fastify, userId, post as PostRow))) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    const [hydrated] = await hydratePosts(fastify, [post as PostRow], userId);
    return reply.send(hydrated);
  });

  // Modifier la visibilité de SA publication (Lot F), sans la supprimer :
  // « j'aime » et commentaires sont conservés. Toutes les règles (fil,
  // profil, détail, commentaires, liens partagés) lisent la confidentialité
  // à chaque requête : la nouvelle valeur s'applique immédiatement.
  fastify.patch("/api/posts/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const body = parseInput(updatePostSchema, request.body, reply, { error: "invalid_body", message: "Visibilité invalide." });
    if (!body) return;
    const userId = request.user!.id;

    const { data: updated } = await fastify.supabaseAdmin
      .from("posts")
      .update({ privacy: body.privacy })
      .eq("id", params.id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (!updated) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    const [hydrated] = await hydratePosts(fastify, [updated as PostRow], userId);
    return reply.send(hydrated);
  });

  // Supprimer SA publication (Lot Q, bloc 3, UX-03). La base supprime en
  // cascade ses « j'aime », pièces taguées et notifications. Le fichier
  // n'est supprimé que s'il est dans le dossier de l'auteur (post-media) :
  // une publication « achat » montre la photo de la pièce du Vault, qui
  // reste dans le Vault.
  fastify.delete("/api/posts/:id", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const userId = request.user!.id;

    const { data: post } = await fastify.supabaseAdmin
      .from("posts")
      .select("id, media_url")
      .eq("id", params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!post) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }

    const { error } = await fastify.supabaseAdmin.from("posts").delete().eq("id", params.id).eq("user_id", userId);
    if (error) {
      request.log.error({ error }, "Échec de suppression d'une publication");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const mediaUrl = post.media_url as string | null;
    if (mediaUrl && extractOwnedStoragePath(mediaUrl, "post-media", userId)) {
      await deleteOwnedStorageFile(fastify, "post-media", userId, mediaUrl);
    }
    return reply.code(204).send();
  });

  fastify.post("/api/posts/:id/react", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
    const userId = request.user!.id;

    const { data: post } = await fastify.supabaseAdmin
      .from("posts")
      .select("id, user_id, privacy")
      .eq("id", id)
      .single();

    if (!post) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }

    if (!(await canViewPost(fastify, userId, post as { user_id: string; privacy: PrivacyLevel }))) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }

    const { data: existing } = await fastify.supabaseAdmin
      .from("post_reactions")
      .select("post_id")
      .eq("post_id", id)
      .eq("user_id", userId)
      .single();

    // Anti-spam (audit Lot Q, ROB-05) : « je n'aime plus » retire la
    // notification correspondante, et un nouveau « j'aime » n'en crée une que
    // s'il n'en existe pas déjà — aimer/ne plus aimer en boucle laisse au
    // plus UNE notification, toujours vraie.
    if (existing) {
      await fastify.supabaseAdmin.from("post_reactions").delete().eq("post_id", id).eq("user_id", userId);
      await fastify.supabaseAdmin
        .from("notifications")
        .delete()
        .eq("type", "like")
        .eq("post_id", id)
        .eq("actor_id", userId);
    } else {
      await fastify.supabaseAdmin.from("post_reactions").insert({ post_id: id, user_id: userId });
      // Jamais de notification pour un like sur sa propre publication.
      if (post.user_id !== userId) {
        const { data: alreadyNotified } = await fastify.supabaseAdmin
          .from("notifications")
          .select("id")
          .eq("type", "like")
          .eq("post_id", id)
          .eq("actor_id", userId)
          .limit(1);
        if (!alreadyNotified || alreadyNotified.length === 0) {
          await fastify.supabaseAdmin
            .from("notifications")
            .insert({ user_id: post.user_id, actor_id: userId, type: "like", post_id: id });
        }
      }
    }

    const { count } = await fastify.supabaseAdmin
      .from("post_reactions")
      .select("post_id", { count: "exact", head: true })
      .eq("post_id", id);

    return reply.send({ reactionCount: count ?? 0, viewerHasReacted: !existing });
  });
}
