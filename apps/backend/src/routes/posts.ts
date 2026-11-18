import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MEMBER_LIST_PAGE_SIZE,
  PEOPLE_TAGS_MAX,
  POST_MEDIA_WINDOW_MIN,
  POST_PHOTOS_MAX,
  POST_TYPES,
  PRIVACY_LEVELS,
  type AddPostMediaResponse,
  type MemberPage,
  type Post,
  type PostAuthor,
  type PostExtrasStatus,
  type PostPhoto,
  type PostTaggedPiece,
  type PostWish,
  type PrivacyLevel,
  type TaggedPieceInput,
} from "@monapp/shared-types";
import { isFileTooLargeError } from "../lib/multipartErrors.js";
import { fetchAffiliateUrls, isAffiliateLink } from "../lib/affiliateLinks.js";
import { DatabaseReadError, INVALID_CURSOR, INVALID_ID, cursorQuerySchema, idParamsSchema, parseDbRows, parseInput, webUrlOrNull } from "../lib/validation.js";
import { canViewPost, findViewablePost, shownPosts } from "../lib/visibility.js";
import { fetchHdImageUrls } from "../lib/pieceImages.js";
import { PHOTO_SIZES, optimizePhoto } from "../lib/photos.js";
import { deleteOwnedStorageFile, extractOwnedStoragePath } from "../lib/storage.js";
import { CONTENT_NOT_ALLOWED, containsBannedWords } from "../lib/contentFilter.js";
import { notInFilter, reportedIdsFor } from "../lib/reportedByViewer.js";
import { withoutSuspendedFaces } from "../lib/profileModeration.js";
import { notify } from "../lib/notify.js";
import { fetchBlockedUserIds } from "../lib/blocks.js";
import { toMemberRows } from "../lib/memberRows.js";
import { commentThreadsReady } from "../lib/comments.js";
import { POST_EXTRAS_UNAVAILABLE, postExtrasReady } from "../lib/postExtras.js";
import { PEOPLE_TAG_NOT_FOUND, dropUnseeableTags, resolvePeopleTags } from "../lib/peopleTags.js";
import { readSavedState, savedPostsReady } from "../lib/savedPosts.js";
import { ImageQueueFullError } from "../lib/imageSafety.js";
import { consumeRateLimit } from "../plugins/rateLimit.js";

// Une publication ne peut pas devenir une liste sans fin de tags — reste
// large pour un usage légitime (plusieurs pièces sur une même tenue) sans
// ouvrir la porte à un abus.
const MAX_TAGGED_PIECES = 10;

const taggedPieceInputSchema = z.union([
  z.object({ vaultItemId: z.guid() }).strict(),
  z.object({ productMatchId: z.guid() }).strict(),
]);
const postOptionalFieldsSchema = z.object({
  vaultItemId: z.guid().optional(),
  privacy: z.enum(PRIVACY_LEVELS).optional(),
});

const taggedPiecesInputSchema = z.array(taggedPieceInputSchema).max(MAX_TAGGED_PIECES);

// Types créés par POST /api/posts. Une publication « envie » (lot 5) ne se
// crée qu'en republiant une envie (routes/pieces.ts), avec la copie de son image.
const CREATABLE_POST_TYPES = ["lifestyle", "purchase"] as const;

const updatePostSchema = z.object({
  privacy: z.enum(PRIVACY_LEVELS),
});

// Personnes identifiées (migration 0047) : PEOPLE_TAGS_MAX comptes distincts au plus.
const peopleTagsInputSchema = z
  .array(z.guid())
  .max(PEOPLE_TAGS_MAX)
  .refine((ids) => new Set(ids).size === ids.length);
const INVALID_PEOPLE_TAGS = { error: "invalid_body", message: "Identifications invalides." } as const;
const POST_NOT_FOUND = { error: "post_not_found", message: "Publication introuvable." } as const;
const POST_MEDIA_CLOSED = { error: "post_media_closed", message: "Cette publication ne peut plus recevoir de photo." } as const;
const POST_MEDIA_FULL = { error: "post_media_full", message: "Cette publication a déjà ses 5 photos." } as const;
const POST_MEDIA_CONFLICT = { error: "post_media_conflict", message: "Une autre photo de cette publication arrivait au même moment. Réessayez." } as const;
const postTagParamsSchema = z.object({ id: z.guid(), userId: z.guid() });
/** Photos 2 à 5 (migration 0047), dans l'ordre. */
const POST_MEDIA_ROWS = z.array(z.object({ post_id: z.guid(), position: z.number().int(), media_url: z.string(), media_thumb_url: z.string() }));
const PEOPLE_TAG_ROWS = z.array(z.object({ post_id: z.guid(), user_id: z.guid() }));

// Ligne de la table `posts` lue avec select("*"), relue sans lui faire confiance.
const postRowSchema = z.object({
  id: z.guid(),
  user_id: z.guid(),
  type: z.enum(POST_TYPES),
  vault_item_id: z.guid().nullable(),
  wishlist_item_id: z.guid().nullable().optional(),
  caption: z.string().nullable(),
  media_url: z.string().nullable(),
  media_thumb_url: z.string().nullable().optional(),
  /** Lot 5, partie B : image copiée retirée par la modération (migration 0026). */
  media_removed_at: z.string().nullable(),
  privacy: z.enum(PRIVACY_LEVELS),
  created_at: z.string(),
});
export type PostRow = z.infer<typeof postRowSchema>;
export const POST_ROWS = z.array(postRowSchema);

function parsePostRow(data: unknown): PostRow {
  const parsed = postRowSchema.safeParse(data);
  if (!parsed.success) throw new DatabaseReadError("Publication illisible");
  return parsed.data;
}

// « Aimé par » (lot « vie sociale ») : qui a aimé, et quand (la date ne sert
// qu'au tri et au curseur, jamais renvoyée ligne par ligne).
const REACTION_ROWS = z.array(z.object({ user_id: z.guid(), created_at: z.string() }));

const ALREADY_SHARED_ROWS = z.array(z.object({ id: z.guid(), hidden_at: z.string().nullable() }));

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
  image_url: string;
  product_match_id: string | null;
}

const WISH_ROWS = z.array(
  z.object({
    id: z.guid(),
    title: z.string(),
    merchant_name: z.string().nullable(),
    merchant_url: z.string().nullable(),
    product_match_id: z.guid().nullable(),
    price_min: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable(),
  })
);

/** Publications « envie » (lot 5) : la pièce, son marchand et son prix, lus
 * sur l'envie d'origine (la publication est supprimée avec elle). */
async function fetchPostWishes(fastify: FastifyInstance, rows: PostRow[]): Promise<Map<string, PostWish>> {
  const wishIds = [...new Set(rows.map((row) => row.wishlist_item_id).filter((id): id is string => !!id))];
  if (wishIds.length === 0) return new Map();
  const wishes = parseDbRows(
    WISH_ROWS,
    await fastify.supabaseAdmin
      .from("wishlist_items")
      .select("id, title, merchant_name, merchant_url, product_match_id, price_min, currency")
      .in("id", wishIds),
    "Envies republiées"
  );
  const affiliateUrls = await fetchAffiliateUrls(
    fastify,
    wishes.map((wish) => wish.product_match_id).filter((id): id is string => id !== null)
  );
  return new Map(
    wishes.map((wish) => {
      const affiliateUrl = wish.product_match_id ? (affiliateUrls.get(wish.product_match_id) ?? null) : null;
      return [
        wish.id,
        {
          title: wish.title,
          merchantName: wish.merchant_name,
          // Seulement un lien web ordinaire (lib/validation.ts), même pour une envie rangée plus tôt.
          merchantUrl: webUrlOrNull(affiliateUrl ?? wish.merchant_url),
          isAffiliate: isAffiliateLink(affiliateUrl, wish.merchant_url),
          productMatchId: wish.product_match_id,
          priceMin: wish.price_min === null ? null : Number(wish.price_min),
          currency: wish.currency,
        },
      ];
    })
  );
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

interface PostExtras {
  media: Map<string, PostPhoto[]>;
  people: Map<string, PostAuthor[]>;
}

/** Photos 2 à 5 et personnes identifiées d'une page de publications
 * (migration 0047) : deux lectures sur les identifiants de la page, puis LA
 * règle des listes de membres (lib/memberRows.ts : ni compte en blocage avec
 * le lecteur, ni suspendu, ni sans nom ; un compte privé seulement pour
 * lui-même, ses abonnés acceptés et l'auteur de la publication). Seules les
 * publications « Une photo » en ont. Relève une erreur si une lecture échoue. */
async function readPostExtras(fastify: FastifyInstance, rows: PostRow[], viewerId: string): Promise<PostExtras> {
  const extras: PostExtras = { media: new Map(), people: new Map() };
  const photoPosts = rows.filter((row) => row.type === "lifestyle");
  if (photoPosts.length === 0 || !(await postExtrasReady(fastify))) return extras;
  const postIds = photoPosts.map((row) => row.id);
  const db = fastify.supabaseAdmin;
  const [mediaRows, tagRows] = await Promise.all([
    db.from("post_media").select("post_id, position, media_url, media_thumb_url").in("post_id", postIds).order("position", { ascending: true }),
    db.from("post_people_tags").select("post_id, user_id").in("post_id", postIds).order("created_at", { ascending: true }),
  ]);
  const media = parseDbRows(POST_MEDIA_ROWS, mediaRows, "Photos des publications");
  const tags = parseDbRows(PEOPLE_TAG_ROWS, tagRows, "Personnes identifiées");

  for (const row of photoPosts) {
    const more = media.filter((photo) => photo.post_id === row.id).sort((a, b) => a.position - b.position);
    if (more.length === 0 || row.media_url === null) continue;
    extras.media.set(row.id, [{ url: row.media_url, thumbUrl: row.media_thumb_url ?? row.media_url }, ...more.map((photo) => ({ url: photo.media_url, thumbUrl: photo.media_thumb_url }))]);
  }

  if (tags.length > 0) {
    // L'auteur voit toutes les personnes qu'il a identifiées ; les autres
    // lecteurs, selon la règle commune. Deux appels au plus par page.
    const authorOf = new Map(photoPosts.map((row) => [row.id, row.user_id]));
    const onOwnPosts = tags.filter((tag) => authorOf.get(tag.post_id) === viewerId);
    const onOthers = tags.filter((tag) => authorOf.get(tag.post_id) !== viewerId);
    const [ownRows, otherRows] = await Promise.all([
      toMemberRows(
        fastify,
        viewerId,
        onOwnPosts.map((tag) => tag.user_id),
        { contextOwnerId: viewerId }
      ),
      toMemberRows(
        fastify,
        viewerId,
        onOthers.map((tag) => tag.user_id),
        { contextOwnerId: null }
      ),
    ]);
    const shownOwn = new Map(ownRows.map((member) => [member.id, member]));
    const shownOther = new Map(otherRows.map((member) => [member.id, member]));
    for (const tag of tags) {
      const member = (authorOf.get(tag.post_id) === viewerId ? shownOwn : shownOther).get(tag.user_id);
      if (!member) continue;
      const list = extras.people.get(tag.post_id) ?? [];
      list.push({ id: member.id, username: member.username, displayName: member.displayName, avatarUrl: member.avatarUrl });
      extras.people.set(tag.post_id, list);
    }
  }
  return extras;
}

/** `knownBlocked` : les comptes en blocage avec le lecteur, quand l'appelant
 * les connaît déjà. Les deux créations (publication, republication d'une
 * envie) passent un ensemble vide : une publication toute neuve n'a ni
 * « j'aime » ni commentaire, et une panne de lecture des blocages ne doit pas
 * répondre « erreur » pour une publication déjà enregistrée. */
export async function hydratePosts(fastify: FastifyInstance, rows: PostRow[], viewerId: string, knownBlocked?: ReadonlySet<string>): Promise<Post[]> {
  if (rows.length === 0) return [];

  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const vaultItemIds = [...new Set(rows.map((r) => r.vault_item_id).filter((id): id is string => !!id))];
  const postIds = rows.map((r) => r.id);

  // « Aimé par » (lot « vie sociale ») : les « j'aime » et les commentaires des
  // comptes en blocage avec le lecteur, dans un sens ou dans l'autre, ne sont
  // plus comptés — les listes les excluaient déjà, le nombre affiché suit.
  // Une lecture des blocages par page, jamais une par publication ; lecture
  // impossible : une erreur, jamais un compte fait comme si personne n'était bloqué.
  // Réponses (migration 0046) : une réponse dont le commentaire d'origine
  // n'est pas montré n'est pas comptée (voir plus bas). Une publication toute
  // neuve n'a aucun commentaire : la sonde n'est pas interrogée.
  const threads = knownBlocked === undefined && (await commentThreadsReady(fastify));
  const [{ data: storedProfiles }, { data: vaultItems }, { data: reactions }, { data: tagRows }, { data: commentRows }, blocked] = await Promise.all([
    fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", authorIds),
    vaultItemIds.length > 0
      ? fastify.supabaseAdmin.from("vault_items").select("id, title, verified, image_url, product_match_id").in("id", vaultItemIds)
      : Promise.resolve({ data: [] as VaultItemRow[] }),
    fastify.supabaseAdmin.from("post_reactions").select("post_id, user_id").in("post_id", postIds),
    fastify.supabaseAdmin
      .from("post_tagged_pieces")
      .select("id, post_id, vault_item_id, product_match_id, position")
      .in("post_id", postIds)
      .order("position", { ascending: true }),
    fastify.supabaseAdmin
      .from("comments")
      .select(threads ? "id, post_id, user_id, parent_id" : "post_id, user_id")
      .in("post_id", postIds)
      .is("hidden_at", null),
    knownBlocked ?? fetchBlockedUserIds(fastify, viewerId),
  ]);

  // Le nombre affiché suit ce que la liste montre : ni les commentaires des
  // comptes en blocage avec le lecteur, ni les réponses à un commentaire
  // masqué par la modération ou écrit par un tel compte (filtre sur les
  // lignes déjà lues : les commentaires masqués n'en font pas partie).
  const countedComments = ((commentRows as unknown as { id?: string; post_id: string; user_id: string; parent_id?: string | null }[]) ?? []).filter((c) => !blocked.has(c.user_id));
  const shownRootIds = new Set(countedComments.filter((c) => (c.parent_id ?? null) === null && c.id !== undefined).map((c) => c.id!));
  const commentCountByPost = new Map<string, number>();
  for (const c of countedComments) {
    if (typeof c.parent_id === "string" && !shownRootIds.has(c.parent_id)) continue;
    commentCountByPost.set(c.post_id, (commentCountByPost.get(c.post_id) ?? 0) + 1);
  }

  // Lot « conformité Apple » : la photo d'un auteur suspendu n'est plus montrée aux autres.
  const profiles = await withoutSuspendedFaces(fastify, (storedProfiles as ProfileRow[]) ?? [], viewerId);
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const vaultItemById = new Map(((vaultItems as VaultItemRow[]) ?? []).map((v) => [v.id, v]));

  const reactionCountByPost = new Map<string, number>();
  const viewerReactedPosts = new Set<string>();
  for (const r of (reactions as { post_id: string; user_id: string }[]) ?? []) {
    if (blocked.has(r.user_id)) continue;
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
          isAffiliate: false,
          productMatchId: null,
        };
      }
    } else if (tag.product_match_id) {
      const m = taggedMatchById.get(tag.product_match_id);
      if (m) {
        const affiliateUrl = affiliateUrlByMatchId.get(tag.product_match_id) ?? null;
        piece = {
          id: tag.id,
          productName: m.product_name,
          imageUrl: m.image_url,
          merchantName: m.merchant_name,
          merchantUrl: affiliateUrl ?? m.merchant_url,
          // La mention « Lien affilié » suit la pièce taguée (lot « mention Lien affilié »).
          isAffiliate: isAffiliateLink(affiliateUrl, m.merchant_url),
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

  // Publications « achat » : image haute définition de la pièce venue du
  // Spotter (même mécanisme que le Vault), si la pièce affiche encore
  // l'image du résultat d'origine. Avant : la miniature de Google, floue.
  const purchaseVaultItems = [...vaultItemById.values()];
  const hdByVaultItem = new Map<string, string | null>();
  // Photos 2 à 5 et personnes identifiées (migration 0047). Lecture
  // impossible : la publication part avec sa seule première photo et sans
  // personne identifiée — jamais une liste non filtrée, jamais une erreur
  // pour une publication déjà enregistrée.
  const noExtras: PostExtras = { media: new Map(), people: new Map() };
  const [hdUrls, wishByItem, extras, saved] = await Promise.all([
    fetchHdImageUrls(fastify, purchaseVaultItems),
    fetchPostWishes(fastify, rows),
    readPostExtras(fastify, rows, viewerId).catch(() => {
      fastify.log.warn("Publications sans leurs photos 2 à 5 ni personnes identifiées : lecture impossible");
      return noExtras;
    }),
    readViewerSaved(fastify, rows, viewerId, knownBlocked !== undefined),
  ]);
  purchaseVaultItems.forEach((item, index) => hdByVaultItem.set(item.id, hdUrls[index] ?? null));

  return rows.map((row) => {
    const author = profileById.get(row.user_id);
    const vaultItem = row.vault_item_id ? vaultItemById.get(row.vault_item_id) : undefined;
    const mediaHdUrl =
      vaultItem && row.media_url === vaultItem.image_url ? (hdByVaultItem.get(vaultItem.id) ?? null) : null;
    const media = extras.media.get(row.id);
    const people = extras.people.get(row.id);
    return {
      id: row.id,
      type: row.type,
      caption: row.caption,
      mediaUrl: row.media_url,
      mediaRemoved: row.media_removed_at !== null,
      mediaHdUrl,
      mediaThumbUrl: row.media_thumb_url ?? null,
      privacy: row.privacy,
      createdAt: row.created_at,
      author: {
        id: row.user_id,
        username: author?.username ?? "",
        displayName: author?.display_name ?? "",
        avatarUrl: author?.avatar_url ?? null,
      },
      vaultItem: vaultItem ? { id: vaultItem.id, title: vaultItem.title, verified: vaultItem.verified } : null,
      wish: row.type === "wish" && row.wishlist_item_id ? (wishByItem.get(row.wishlist_item_id) ?? null) : null,
      taggedPieces: taggedPiecesByPost.get(row.id) ?? [],
      reactionCount: reactionCountByPost.get(row.id) ?? 0,
      viewerHasReacted: viewerReactedPosts.has(row.id),
      commentCount: commentCountByPost.get(row.id) ?? 0,
      ...(media ? { media } : {}),
      ...(people && people.length > 0 ? { people } : {}),
      ...(saved ? { viewerHasSaved: saved.has(row.id), viewerSavedCollectionId: saved.get(row.id) ?? null } : {}),
    };
  });
}

/** Publications enregistrées (migration 0048) : pour chaque publication de
 * la page que le lecteur a enregistrée, sa collection (ou null). Une lecture
 * sur les identifiants de la page. null : pas de signet (base sans 0048, ou
 * lecture impossible — jamais une erreur pour la page). Une publication toute
 * neuve (`fresh`) n'est enregistrée par personne : rien n'est lu. */
async function readViewerSaved(fastify: FastifyInstance, rows: PostRow[], viewerId: string, fresh: boolean): Promise<Map<string, string | null> | null> {
  try {
    if (!(await savedPostsReady(fastify))) return null;
    if (fresh) return new Map();
    return await readSavedState(
      fastify,
      viewerId,
      rows.map((row) => row.id)
    );
  } catch {
    fastify.log.warn("Publications sans leur signet : lecture des publications enregistrées impossible");
    return null;
  }
}

const FEED_PAGE_SIZE = 15;

export default async function postsRoutes(fastify: FastifyInstance) {
  // Fil d'activité : ses propres publications (toutes) et celles des
  // comptes suivis (publiques et « abonnés ») — décision du Lot F.
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

    let query = shownPosts(fastify, "*")
      .or(visibility)
      .order("created_at", { ascending: false })
      .limit(FEED_PAGE_SIZE + 1);
    // Chantier 3 : une publication signalée sort aussitôt du fil de la personne qui l'a signalée.
    const reported = notInFilter(await reportedIdsFor(fastify, request.log, userId, "post"));
    if (reported) query = query.not("id", "in", reported);

    if (cursorDate) {
      query = query.lt("created_at", cursorDate);
    }

    const { data: posts, error } = await query;

    if (error) {
      request.log.error({ error }, "Échec de lecture du fil");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const rows = parseDbRows(POST_ROWS, { data: posts, error: null }, "Fil");
    const hasMore = rows.length > FEED_PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, FEED_PAGE_SIZE) : rows;
    const nextCursor = hasMore ? (pageRows.at(-1)?.created_at ?? null) : null;

    const hydrated = await hydratePosts(fastify, pageRows, userId);
    return reply.send({ posts: hydrated, nextCursor });
  });

  // Plusieurs photos et identifications (migration 0047) : la base sait-elle
  // les garder ? Sans elles, l'app garde le choix d'une seule photo et cache
  // « Identifier des personnes ». Base illisible : « non », sans erreur.
  fastify.get("/api/posts/status", { preHandler: fastify.requireAuth }, async (_request, reply) => {
    const ready = await postExtrasReady(fastify).catch(() => false);
    const status: PostExtrasStatus = { carousel: ready, peopleTags: ready };
    return reply.send(status);
  });

  // Alimente le segment "Lifestyle" du profil : uniquement les publications
  // de type "lifestyle" de l'utilisateur (les posts "achat" sont déjà
  // visibles via le segment Vault, pas la peine de les dupliquer ici).
  // Aucun filtre de confidentialité : c'est le propriétaire qui consulte
  // son propre profil, il voit tout ce qu'il a publié.
  fastify.get("/api/posts/mine", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const userId = request.user!.id;

    const { data: posts, error } = await shownPosts(fastify, "*")
      .eq("user_id", userId)
      .eq("type", "lifestyle")
      .order("created_at", { ascending: false });

    if (error) {
      request.log.error({ error }, "Échec de lecture des publications lifestyle");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const hydrated = await hydratePosts(fastify, parseDbRows(POST_ROWS, { data: posts, error: null }, "Publications lifestyle"), userId);
    return reply.send(hydrated);
  });

  // multipart toujours, comme /api/vault : soit une photo importée (post
  // "lifestyle"), soit une référence à un objet du vault dont on reprend
  // la photo et le titre (post "achat"). "pieceTag" limite les publications
  // taguées comme les autres actions sensibles à l'abus (voir rateLimits.ts).
  fastify.post(
    "/api/posts",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("pieceTag")], config: { rateLimitName: "pieceTag" } },
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

      const parsedType = z.enum(CREATABLE_POST_TYPES).safeParse(fields.type);
      if (!parsedType.success) {
        return reply.code(400).send({ error: "invalid_body", message: "Type de publication invalide." });
      }
      const type = parsedType.data;

      let mediaUrl: string;
      let mediaThumbUrl: string | null = null;
      let vaultItemId: string | null = null;
      let caption = fields.caption?.trim() || null;

      if (caption && caption.length > 280) {
        return reply.code(400).send({ error: "invalid_body", message: "Le texte est trop long (280 caractères maximum)." });
      }
      // Filtre des mots interdits (chantier 3, règle 1.2 d'Apple), avant tout envoi de photo.
      if (containsBannedWords(caption)) return reply.code(400).send(CONTENT_NOT_ALLOWED);

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

      // Personnes identifiées (migration 0047) : une publication « Une photo »
      // seulement. Sans la migration, la publication est refusée AVANT toute
      // écriture : jamais publiée sans les identifications demandées.
      let peopleTagIds: string[] = [];
      if (fields.peopleTags) {
        let raw: unknown;
        try {
          raw = JSON.parse(fields.peopleTags);
        } catch {
          return reply.code(400).send(INVALID_PEOPLE_TAGS);
        }
        const parsed = peopleTagsInputSchema.safeParse(raw);
        if (!parsed.success) return reply.code(400).send(INVALID_PEOPLE_TAGS);
        peopleTagIds = parsed.data;
      }
      if (peopleTagIds.length > 0) {
        if (type !== "lifestyle") {
          return reply.code(400).send({ error: "invalid_body", message: "Seule une publication « Une photo » peut identifier des personnes." });
        }
        if (!(await postExtrasReady(fastify))) return reply.code(404).send(POST_EXTRAS_UNAVAILABLE);
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
          return reply.code(400).send({ error: "invalid_body", message: "Pièce du vault manquante." });
        }
        const { data: vaultItem } = await fastify.supabaseAdmin
          .from("vault_items")
          .select("id, title, image_url")
          .eq("id", vaultItemId)
          .eq("user_id", userId)
          .single();

        if (!vaultItem) {
          return reply.code(404).send({ error: "vault_item_not_found", message: "Pièce du vault introuvable." });
        }
        // Une pièce ne se partage qu'une fois à la fois (Lot F, décision
        // documentée dans docs/journal-decisions.md) : pour la montrer
        // autrement, on supprime d'abord sa publication.
        // Une publication masquée par la modération compte aussi : la
        // republier contournerait la décision (lot 5).
        const alreadyShared = parseDbRows(
          ALREADY_SHARED_ROWS,
          await fastify.supabaseAdmin
            .from("posts")
            .select("id, hidden_at")
            .eq("user_id", userId)
            .eq("type", "purchase")
            .eq("vault_item_id", vaultItemId)
            .limit(1),
          "Publication d'une pièce"
        );
        if (alreadyShared[0]?.hidden_at) {
          return reply.code(409).send({
            error: "already_shared_hidden",
            message: "Cette pièce a déjà été partagée, et sa publication a été masquée par la modération.",
          });
        }
        if (alreadyShared.length > 0) {
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
        // Photo optimisée (lib/photos.ts) : version d'affichage + miniature.
        let display: Buffer;
        let thumb: Buffer;
        try {
          [display, thumb] = await Promise.all([
            optimizePhoto(fileBuffer, PHOTO_SIZES.display),
            optimizePhoto(fileBuffer, PHOTO_SIZES.thumb, 78),
          ]);
        } catch {
          return reply.code(400).send({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
        }
        const base = `${userId}/${randomUUID()}`;
        const bucket = fastify.supabaseAdmin.storage.from("post-media");
        const [displayUpload, thumbUpload] = await Promise.all([
          bucket.upload(`${base}.jpg`, display, { contentType: "image/jpeg", upsert: false }),
          bucket.upload(`${base}-mini.jpg`, thumb, { contentType: "image/jpeg", upsert: false }),
        ]);

        if (displayUpload.error || thumbUpload.error) {
          request.log.error({ uploadError: displayUpload.error ?? thumbUpload.error }, "Échec d'upload de la photo du post");
          await bucket.remove([`${base}.jpg`, `${base}-mini.jpg`]);
          return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
        }

        mediaUrl = bucket.getPublicUrl(`${base}.jpg`).data.publicUrl;
        mediaThumbUrl = bucket.getPublicUrl(`${base}-mini.jpg`).data.publicUrl;
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
          media_thumb_url: mediaThumbUrl,
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

      // Personnes identifiées : seulement celles que la règle laisse passer
      // (lib/peopleTags.ts), chacune sur le budget de mentions de l'heure. Une
      // lecture ou une écriture impossible publie sans identification, jamais
      // une erreur pour une publication déjà enregistrée.
      let people: string[] = [];
      if (peopleTagIds.length > 0) {
        try {
          people = await resolvePeopleTags(fastify, { authorId: userId, privacy, userIds: peopleTagIds, consume: () => consumeRateLimit(request, "mentionNotify") });
        } catch {
          request.log.warn("Identifications non retenues : règles illisibles");
        }
      }
      if (people.length > 0) {
        const written = await fastify.supabaseAdmin.from("post_people_tags").insert(people.map((personId) => ({ post_id: inserted.id, user_id: personId, author_id: userId })));
        if (written.error) {
          request.log.warn({ code: (written.error as { code?: string }).code ?? null }, "Identifications non enregistrées");
          people = [];
        }
      }
      // Chaque membre identifié est prévenu (lib/notify.ts : jamais à qui ne voit pas la publication).
      for (const personId of people) {
        await notify(fastify, request.log, { recipientId: personId, actorId: userId, type: "tag", postId: inserted.id, oncePerPost: true });
      }

      // Publication toute neuve : aucun « j'aime », aucun commentaire, donc
      // aucun blocage à lire — et rien qui puisse la faire échouer après coup.
      const [hydrated] = await hydratePosts(fastify, [parsePostRow(inserted)], userId, new Set());
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

    const { data, error } = await shownPosts(fastify, "*").eq("id", params.id).maybeSingle();
    if (error) throw new DatabaseReadError("Lecture d'une publication impossible");
    const post = data === null ? null : parsePostRow(data);
    if (!post || !(await canViewPost(fastify, userId, post))) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    const [hydrated] = await hydratePosts(fastify, [post], userId);
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

    // Une publication masquée par la modération est introuvable, même pour son auteur (lib/visibility.ts).
    const { data: updated } = await fastify.supabaseAdmin
      .from("posts")
      .update({ privacy: body.privacy })
      .eq("id", params.id)
      .eq("user_id", userId)
      .is("hidden_at", null)
      .select("*")
      .maybeSingle();
    if (!updated) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    // Une identification suit l'accès (migration 0047) : qui ne voit plus la
    // publication perd la sienne. Échec : journalisé, la visibilité est déjà changée.
    if (await postExtrasReady(fastify).catch(() => false)) {
      await dropUnseeableTags(fastify, { authorId: userId, postId: params.id }).catch(() => {
        request.log.warn("Visibilité réduite : identifications non relues");
      });
    }
    const [hydrated] = await hydratePosts(fastify, [parsePostRow(updated)], userId);
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
      .select("id, media_url, media_thumb_url")
      .eq("id", params.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!post) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    // Photos 2 à 5 (migration 0047) : lues AVANT la suppression (la base les
    // efface en cascade), pour effacer aussi leurs fichiers. Lecture
    // impossible : rien n'est supprimé, à réessayer — jamais une photo laissée
    // en ligne derrière une publication supprimée.
    const extraFiles: string[] = [];
    if (await postExtrasReady(fastify)) {
      const extras = parseDbRows(
        POST_MEDIA_ROWS,
        await fastify.supabaseAdmin.from("post_media").select("post_id, position, media_url, media_thumb_url").eq("post_id", params.id).eq("user_id", userId),
        "Photos d'une publication à supprimer"
      );
      for (const photo of extras) extraFiles.push(photo.media_url, photo.media_thumb_url);
    }

    const { error } = await fastify.supabaseAdmin.from("posts").delete().eq("id", params.id).eq("user_id", userId);
    if (error) {
      request.log.error({ error }, "Échec de suppression d'une publication");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }

    const mediaUrl = post.media_url as string | null;
    for (const url of [mediaUrl, post.media_thumb_url as string | null, ...extraFiles]) {
      if (url && extractOwnedStoragePath(url, "post-media", userId)) {
        await deleteOwnedStorageFile(fastify, "post-media", userId, url);
      }
    }
    return reply.code(204).send();
  });

  // Ajouter une photo (2 à 5) à SA publication « Une photo » (migration
  // 0047), une par requête : les limites de l'envoi (un fichier par requête)
  // et la mémoire du serveur restent celles d'une publication. Seulement dans
  // les 10 minutes qui suivent la publication : ensuite, elle a pu être vue,
  // et vérifiée par la modération ; elle ne change plus. Même traitement
  // qu'une photo publiée (lib/photos.ts) ; les fichiers vont dans le dossier
  // de l'auteur, comme la photo 1. Rien n'est jamais rangé sans être rattaché
  // à la publication : un enregistrement manqué efface les deux fichiers.
  fastify.post(
    "/api/posts/:id/media",
    { preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("postMedia")], config: { rateLimitName: "postMedia" } },
    async (request, reply) => {
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const userId = request.user!.id;
      if (!(await postExtrasReady(fastify))) return reply.code(404).send(POST_EXTRAS_UNAVAILABLE);

      // Sa publication, « Une photo », pas masquée : sinon 404, sans dire pourquoi.
      const { data, error } = await shownPosts(fastify, "*").eq("id", params.id).eq("user_id", userId).maybeSingle();
      if (error) throw new DatabaseReadError("Lecture d'une publication impossible");
      const post = data === null ? null : parsePostRow(data);
      if (!post || post.type !== "lifestyle" || post.media_url === null) return reply.code(404).send(POST_NOT_FOUND);
      if (Date.now() - Date.parse(post.created_at) >= POST_MEDIA_WINDOW_MIN * 60_000) return reply.code(409).send(POST_MEDIA_CLOSED);

      const db = fastify.supabaseAdmin;
      const countExtras = async (): Promise<number> => {
        const { count, error: countError } = await db.from("post_media").select("post_id", { count: "exact", head: true }).eq("post_id", post.id);
        if (countError || typeof count !== "number") throw new DatabaseReadError("Photos d'une publication : nombre illisible");
        return count;
      };
      if ((await countExtras()) >= POST_PHOTOS_MAX - 1) return reply.code(409).send(POST_MEDIA_FULL);

      let fileBuffer: Buffer;
      try {
        const file = await request.file();
        if (!file || !file.mimetype.startsWith("image/")) {
          return reply.code(400).send({ error: "invalid_file", message: "Une photo est obligatoire." });
        }
        fileBuffer = await file.toBuffer();
      } catch (fileError) {
        if (isFileTooLargeError(fileError)) {
          return reply.code(413).send({ error: "file_too_large", message: "Le fichier est trop volumineux (10 Mo maximum)." });
        }
        throw fileError;
      }

      let display: Buffer;
      let thumb: Buffer;
      try {
        [display, thumb] = await Promise.all([optimizePhoto(fileBuffer, PHOTO_SIZES.display), optimizePhoto(fileBuffer, PHOTO_SIZES.thumb, 78)]);
      } catch (photoError) {
        // File des traitements pleine : « réessayez » (app.ts), pas « photo illisible ».
        if (photoError instanceof ImageQueueFullError) throw photoError;
        return reply.code(400).send({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
      }
      const base = `${userId}/${randomUUID()}`;
      const paths = [`${base}.jpg`, `${base}-mini.jpg`];
      const bucket = db.storage.from("post-media");
      const [displayUpload, thumbUpload] = await Promise.all([
        bucket.upload(paths[0]!, display, { contentType: "image/jpeg", upsert: false }),
        bucket.upload(paths[1]!, thumb, { contentType: "image/jpeg", upsert: false }),
      ]);
      const removeFiles = async () => {
        const removed = await bucket.remove(paths);
        if (removed.error) request.log.warn("Photo d'une publication : fichiers non effacés après un échec");
      };
      if (displayUpload.error || thumbUpload.error) {
        request.log.error({ uploadError: displayUpload.error ?? thumbUpload.error }, "Échec d'upload d'une photo de publication");
        await removeFiles();
        return reply.code(500).send({ error: "upload_failed", message: "L'envoi de la photo a échoué." });
      }
      const photo: PostPhoto = { url: bucket.getPublicUrl(paths[0]!).data.publicUrl, thumbUrl: bucket.getPublicUrl(paths[1]!).data.publicUrl };

      // Position : le nombre de photos déjà là, plus un. Deux envois en même
      // temps visent la même place : la clé unique en refuse un, essayé une
      // seconde fois à la place suivante, puis 409.
      let failure: { code?: string } | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let position: number;
        try {
          position = (await countExtras()) + 1;
        } catch (countError) {
          await removeFiles();
          throw countError;
        }
        if (position > POST_PHOTOS_MAX - 1) {
          await removeFiles();
          return reply.code(409).send(POST_MEDIA_FULL);
        }
        const written = await db.from("post_media").insert({ user_id: userId, post_id: post.id, position, media_url: photo.url, media_thumb_url: photo.thumbUrl });
        failure = written.error ? (written.error as { code?: string }) : null;
        if (failure?.code !== "23505") break;
      }
      if (failure) {
        await removeFiles();
        if (failure.code === "23505") return reply.code(409).send(POST_MEDIA_CONFLICT);
        // 23503 : la publication vient d'être supprimée.
        if (failure.code === "23503") return reply.code(404).send(POST_NOT_FOUND);
        request.log.error({ code: failure.code ?? null }, "Échec d'enregistrement d'une photo de publication");
        return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
      }

      // Toutes les photos, la première comprise. Relecture impossible : la
      // photo est enregistrée, la réponse le dit quand même (l'app ne la
      // renvoie pas une seconde fois).
      const first: PostPhoto = { url: post.media_url, thumbUrl: post.media_thumb_url ?? post.media_url };
      const stored = await db.from("post_media").select("post_id, position, media_url, media_thumb_url").eq("post_id", post.id).order("position", { ascending: true });
      const parsed = POST_MEDIA_ROWS.safeParse(stored.data);
      const more = !stored.error && parsed.success ? parsed.data.map((row) => ({ url: row.media_url, thumbUrl: row.media_thumb_url })) : [photo];
      const body: AddPostMediaResponse = { media: [first, ...more] };
      return reply.code(201).send(body);
    }
  );

  // Retirer une identification (migration 0047) : le membre identifié (le
  // sien, même sur une publication qu'il ne voit plus) ou l'auteur de la
  // publication. Sa notification part avec. Tout autre compte : 404, comme
  // pour une identification qui n'existe pas. Permis à un compte suspendu :
  // on ne fait que retirer quelque chose.
  fastify.delete("/api/posts/:id/people-tags/:userId", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const params = parseInput(postTagParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const viewerId = request.user!.id;
    if (!(await postExtrasReady(fastify))) return reply.code(404).send(POST_EXTRAS_UNAVAILABLE);

    const db = fastify.supabaseAdmin;
    const { data, error } = await db.from("post_people_tags").select("post_id, user_id, author_id").eq("post_id", params.id).eq("user_id", params.userId).maybeSingle();
    if (error) throw new DatabaseReadError("Lecture d'une identification impossible");
    const tag = data as { user_id?: unknown; author_id?: unknown } | null;
    if (!tag || (viewerId !== tag.user_id && viewerId !== tag.author_id)) return reply.code(404).send(PEOPLE_TAG_NOT_FOUND);

    const removed = await db.from("post_people_tags").delete().eq("post_id", params.id).eq("user_id", params.userId);
    if (removed.error) {
      request.log.error({ code: (removed.error as { code?: string }).code ?? null }, "Échec du retrait d'une identification");
      return reply.code(500).send({ error: "internal_error", message: "Une erreur est survenue." });
    }
    const notice = await db.from("notifications").delete().eq("user_id", params.userId).eq("type", "tag").eq("post_id", params.id);
    if (notice.error) request.log.warn("Identification retirée, notification restée");
    return reply.code(204).send();
  });

  // « Aimé par » (lot « vie sociale », sans migration) : les membres qui ont
  // aimé une publication, les plus récents d'abord, 30 lignes lues par page.
  //   - La liste n'existe que pour qui peut voir la publication : masquée,
  //     blocage avec l'auteur, confidentialité, compte privé → 404, la même
  //     réponse que pour une publication inconnue.
  //   - Chaque ligne passe par LA règle des listes (lib/memberRows.ts) : ni
  //     compte en blocage avec le lecteur, ni suspendu, ni sans nom
  //     d'utilisateur ; un compte privé n'est montré qu'à lui-même, à ses
  //     abonnés acceptés et à l'auteur de la publication.
  //   - Le tri se fait APRÈS la lecture : une page peut être plus courte que
  //     prévu, ou vide, alors qu'il en reste ; la réponse ne dit jamais
  //     combien de lignes ont été laissées de côté, et le nombre de « j'aime »
  //     de la publication peut dépasser le nombre de lignes montrées.
  //   - Jamais la date d'un « j'aime » dans une ligne : le curseur est la date
  //     de la dernière ligne LUE.
  // Une lecture, pas une écriture : permise à un compte suspendu, comme le fil.
  fastify.get(
    "/api/posts/:id/likes",
    { preHandler: [fastify.requireAuth, fastify.rateLimit("memberList")], config: { rateLimitName: "memberList" as const } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
      if (!params) return;
      const pageQuery = parseInput(cursorQuerySchema, request.query, reply, INVALID_CURSOR);
      if (!pageQuery) return;
      const viewerId = request.user!.id;

      const post = await findViewablePost(fastify, viewerId, params.id);
      if (!post) {
        return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
      }

      let query = fastify.supabaseAdmin
        .from("post_reactions")
        .select("user_id, created_at")
        .eq("post_id", post.id)
        .order("created_at", { ascending: false })
        .limit(MEMBER_LIST_PAGE_SIZE + 1);
      if (pageQuery.cursor) query = query.lt("created_at", pageQuery.cursor);
      const rows = parseDbRows(REACTION_ROWS, await query, "« J'aime » d'une publication");
      const hasMore = rows.length > MEMBER_LIST_PAGE_SIZE;
      const pageRows = hasMore ? rows.slice(0, MEMBER_LIST_PAGE_SIZE) : rows;

      const page: MemberPage = {
        members: await toMemberRows(
          fastify,
          viewerId,
          pageRows.map((row) => row.user_id),
          { contextOwnerId: post.user_id }
        ),
        nextCursor: hasMore ? (pageRows.at(-1)?.created_at ?? null) : null,
      };
      return reply.send(page);
    }
  );

  // Aimer / ne plus aimer. Limite « postReact » (lot « vie sociale ») : large
  // pour un membre, assez pour arrêter un script qui aimerait en boucle.
  const reactOptions = {
    preHandler: [fastify.requireAuth, fastify.requireActiveAccount, fastify.rateLimit("postReact")],
    config: { rateLimitName: "postReact" as const },
  };
  fastify.post("/api/posts/:id/react", reactOptions, async (request, reply) => {
    const params = parseInput(idParamsSchema, request.params, reply, INVALID_ID);
    if (!params) return;
    const { id } = params;
    const userId = request.user!.id;

    // Masquée, bloquée ou hors de sa confidentialité : 404, sans dire pourquoi.
    const post = await findViewablePost(fastify, userId, id);
    if (!post) {
      return reply.code(404).send({ error: "post_not_found", message: "Publication introuvable." });
    }
    // Lus AVANT d'écrire : une panne de cette lecture ne laisse pas un « j'aime »
    // enregistré derrière une réponse d'erreur.
    const blocked = await fetchBlockedUserIds(fastify, userId);

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
      // Jamais pour un like sur sa propre publication, jamais deux fois (lib/notify.ts).
      await notify(fastify, request.log, { recipientId: post.user_id, actorId: userId, type: "like", postId: id, oncePerPost: true });
    }

    // Le même compte que dans le fil (hydratePosts) : sans les comptes en
    // blocage avec le lecteur.
    let countQuery = fastify.supabaseAdmin.from("post_reactions").select("post_id", { count: "exact", head: true }).eq("post_id", id);
    if (blocked.size > 0) countQuery = countQuery.not("user_id", "in", `(${[...blocked].join(",")})`);
    const { count } = await countQuery;

    return reply.send({ reactionCount: count ?? 0, viewerHasReacted: !existing });
  });
}
