import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Post, PostType, PrivacyLevel } from "@monapp/shared-types";

const POST_TYPES: PostType[] = ["lifestyle", "purchase"];
const PRIVACY_LEVELS: PrivacyLevel[] = ["public", "followers", "private"];

interface PostRow {
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

async function hydratePosts(fastify: FastifyInstance, rows: PostRow[], viewerId: string): Promise<Post[]> {
  if (rows.length === 0) return [];

  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const vaultItemIds = [...new Set(rows.map((r) => r.vault_item_id).filter((id): id is string => !!id))];
  const postIds = rows.map((r) => r.id);

  const [{ data: profiles }, { data: vaultItems }, { data: reactions }] = await Promise.all([
    fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", authorIds),
    vaultItemIds.length > 0
      ? fastify.supabaseAdmin.from("vault_items").select("id, title, verified").in("id", vaultItemIds)
      : Promise.resolve({ data: [] as VaultItemRow[] }),
    fastify.supabaseAdmin.from("post_reactions").select("post_id, user_id").in("post_id", postIds),
  ]);

  const profileById = new Map(((profiles as ProfileRow[]) ?? []).map((p) => [p.id, p]));
  const vaultItemById = new Map(((vaultItems as VaultItemRow[]) ?? []).map((v) => [v.id, v]));

  const reactionCountByPost = new Map<string, number>();
  const viewerReactedPosts = new Set<string>();
  for (const r of (reactions as { post_id: string; user_id: string }[]) ?? []) {
    reactionCountByPost.set(r.post_id, (reactionCountByPost.get(r.post_id) ?? 0) + 1);
    if (r.user_id === viewerId) viewerReactedPosts.add(r.post_id);
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
      reactionCount: reactionCountByPost.get(row.id) ?? 0,
      viewerHasReacted: viewerReactedPosts.has(row.id),
    };
  });
}

export default async function postsRoutes(fastify: FastifyInstance) {
  // Fil d'activité : uniquement les publications des comptes suivis
  // (jamais les siennes), jamais les publications "privé" — même pour un
  // abonné, "privé" veut dire visible nulle part en dehors du profil de
  // son auteur.
  fastify.get("/api/feed", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data: follows } = await fastify.supabaseAdmin
      .from("follows")
      .select("followee_id")
      .eq("follower_id", userId);

    const followeeIds = (follows ?? []).map((f) => f.followee_id as string);
    if (followeeIds.length === 0) {
      return reply.send([]);
    }

    const { data: posts, error } = await fastify.supabaseAdmin
      .from("posts")
      .select("*")
      .in("user_id", followeeIds)
      .in("privacy", ["public", "followers"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      request.log.error({ error }, "Échec de lecture du fil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const hydrated = await hydratePosts(fastify, (posts as PostRow[]) ?? [], userId);
    return reply.send(hydrated);
  });

  // multipart toujours, comme /api/vault : soit une photo importée (post
  // "lifestyle"), soit une référence à un objet du vault dont on reprend
  // la photo et le titre (post "achat").
  fastify.post("/api/posts", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileMimetype: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        fileMimetype = part.mimetype;
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    const type = fields.type as PostType | undefined;
    if (!type || !POST_TYPES.includes(type)) {
      return reply.code(400).send({ error: "invalid_body", message: "Type de publication invalide." });
    }

    let mediaUrl: string;
    let vaultItemId: string | null = null;
    let caption = fields.caption?.trim() || null;

    if (type === "purchase") {
      vaultItemId = fields.vaultItemId ?? null;
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

    const [hydrated] = await hydratePosts(fastify, [inserted as PostRow], userId);
    return reply.send(hydrated);
  });

  fastify.post("/api/posts/:id/react", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user!.id;

    const { data: post } = await fastify.supabaseAdmin
      .from("posts")
      .select("id, user_id, privacy")
      .eq("id", id)
      .single();

    if (!post) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }

    if (post.user_id !== userId) {
      if (post.privacy === "private") {
        return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
      }
      if (post.privacy === "followers") {
        const { data: rel } = await fastify.supabaseAdmin
          .from("follows")
          .select("follower_id")
          .eq("follower_id", userId)
          .eq("followee_id", post.user_id)
          .single();
        if (!rel) {
          return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
        }
      }
    }

    const { data: existing } = await fastify.supabaseAdmin
      .from("post_reactions")
      .select("post_id")
      .eq("post_id", id)
      .eq("user_id", userId)
      .single();

    if (existing) {
      await fastify.supabaseAdmin.from("post_reactions").delete().eq("post_id", id).eq("user_id", userId);
    } else {
      await fastify.supabaseAdmin.from("post_reactions").insert({ post_id: id, user_id: userId });
    }

    const { count } = await fastify.supabaseAdmin
      .from("post_reactions")
      .select("post_id", { count: "exact", head: true })
      .eq("post_id", id);

    return reply.send({ reactionCount: count ?? 0, viewerHasReacted: !existing });
  });
}
