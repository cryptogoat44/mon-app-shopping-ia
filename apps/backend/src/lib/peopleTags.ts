import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_MENTIONS_FROM, MENTIONS_FROM, PEOPLE_TAGS_MAX, PRIVACY_LEVELS, type PrivacyLevel } from "@monapp/shared-types";
import { postVisibleTo, readViewersAudience, type Audience } from "./audience.js";
import { acceptMentionTargets } from "./mentions.js";
import { chunks, readAll } from "./pagedReads.js";
import { parseDbRows } from "./validation.js";

// Personnes identifiées sur une publication (lot « vie sociale », migration
// 0047). Deux règles, et une seule fonction pour chacune :
//
// 1. Qui peut être identifié (resolvePeopleTags) : la même règle que les
//    mentions (lib/mentions.ts, acceptMentionTargets). Un compte est écarté
//    EN SILENCE quand il est inconnu ou sans nom d'utilisateur, quand c'est
//    l'auteur lui-même, en blocage avec lui dans un sens ou dans l'autre,
//    suspendu, quand son réglage « Qui peut me mentionner » le refuse (au
//    départ : seulement les comptes qu'il suit), ou quand il ne peut pas voir
//    la publication à sa visibilité. Chaque identification retenue consomme
//    le budget de mentions de l'heure (mentionNotify, 20 par heure et par
//    auteur) ; au-delà, plus rien n'est retenu. L'auteur ne sait jamais qui a
//    été écarté, ni pourquoi.
//
// 2. Une identification suit l'accès (dropUnseeableTags) : un membre qui ne
//    peut plus voir la publication perd son identification (et sa
//    notification). Appelée aux moments où l'accès se perd : visibilité de la
//    publication réduite, compte passé en privé, abonnement retiré par le
//    membre ou par l'auteur, blocage (routes/blocks.ts retire tout entre les
//    deux comptes, sans relire). Une publication masquée par la modération
//    garde ses identifications (elle peut être rétablie) : elle n'est montrée
//    à personne, ni elles avec.

export const PEOPLE_TAG_NOT_FOUND = { error: "people_tag_not_found", message: "Identification introuvable." } as const;

const PROFILE_ROWS = z.array(
  z.object({
    id: z.guid(),
    username: z.string().nullable(),
    // Colonne obligatoire dans la base (0046) ; illisible : la valeur de départ, protectrice.
    mentions_from: z.enum(MENTIONS_FROM).nullable().optional().catch(DEFAULT_MENTIONS_FROM),
  })
);

export interface ResolvePeopleTagsInput {
  /** L'auteur de la publication, qui identifie. */
  authorId: string;
  /** La visibilité choisie pour la publication. */
  privacy: PrivacyLevel;
  /** Les comptes demandés, dans l'ordre. */
  userIds: readonly string[];
  /** Compte une identification retenue dans le budget de l'auteur ; false : budget épuisé. */
  consume: () => boolean;
}

/** Les comptes retenus, dans l'ordre demandé (doublons retirés,
 * PEOPLE_TAGS_MAX au plus). Une lecture impossible relève une erreur :
 * l'appelant publie alors sans aucune identification. */
export async function resolvePeopleTags(fastify: FastifyInstance, input: ResolvePeopleTagsInput): Promise<string[]> {
  const ids = [...new Set(input.userIds)].filter((id) => id !== input.authorId).slice(0, PEOPLE_TAGS_MAX);
  if (ids.length === 0) return [];
  const profiles = parseDbRows(PROFILE_ROWS, await fastify.supabaseAdmin.from("profiles").select("id, username, mentions_from").in("id", ids), "Comptes identifiés");
  const byId = new Map(profiles.map((row) => [row.id, row]));
  const candidates = ids.flatMap((id) => {
    const row = byId.get(id);
    return row?.username ? [{ userId: id, setting: row.mentions_from ?? DEFAULT_MENTIONS_FROM }] : [];
  });
  const accepted = await acceptMentionTargets(fastify, { authorId: input.authorId, post: { user_id: input.authorId, privacy: input.privacy }, consume: input.consume }, candidates);
  return accepted.map((candidate) => candidate.userId);
}

const TAG_ROWS = z.array(z.object({ post_id: z.guid(), user_id: z.guid() }));
const POST_PRIVACY_ROWS = z.array(z.object({ id: z.guid(), privacy: z.enum(PRIVACY_LEVELS) }));

/** Les identifications à relire : celles d'un auteur, sur une publication
 * (`postId`) et/ou pour un membre (`userId`). */
export interface TagScope {
  authorId: string;
  postId?: string;
  userId?: string;
}

/** Le lien de chacun de ces membres avec l'auteur, par paquets (adresse des requêtes). */
async function linksToAuthor(fastify: FastifyInstance, userIds: readonly string[], authorId: string): Promise<Map<string, Audience>> {
  const links = new Map<string, Audience>();
  for (const part of chunks([...new Set(userIds)])) {
    for (const [id, audience] of await readViewersAudience(fastify, part, authorId)) links.set(id, audience);
  }
  return links;
}

/** Retire les identifications (et leurs notifications) des membres qui ne
 * peuvent plus voir la publication, dans `scope`. Rend le nombre retiré.
 * Relève une erreur si une lecture ou une écriture échoue : l'appelant, dont
 * l'action est déjà faite, le journalise. À n'appeler qu'avec la migration 0047. */
export async function dropUnseeableTags(fastify: FastifyInstance, scope: TagScope): Promise<number> {
  const db = fastify.supabaseAdmin;
  const tags = parseDbRows(
    TAG_ROWS,
    {
      data: await readAll(
        "Identifications à relire",
        () => {
          let query = db.from("post_people_tags").select("post_id, user_id", { count: "exact" }).eq("author_id", scope.authorId);
          if (scope.postId !== undefined) query = query.eq("post_id", scope.postId);
          if (scope.userId !== undefined) query = query.eq("user_id", scope.userId);
          return query;
        },
        ["post_id", "user_id"]
      ),
      error: null,
    },
    "Identifications à relire"
  );
  if (tags.length === 0) return 0;

  // Toutes les publications, masquées comprises : une publication masquée garde ses identifications.
  const privacyByPost = new Map<string, PrivacyLevel>();
  for (const part of chunks([...new Set(tags.map((tag) => tag.post_id))])) {
    for (const row of parseDbRows(POST_PRIVACY_ROWS, await db.from("posts").select("id, privacy").eq("user_id", scope.authorId).in("id", part), "Visibilité des publications")) {
      privacyByPost.set(row.id, row.privacy);
    }
  }
  const links = await linksToAuthor(
    fastify,
    tags.map((tag) => tag.user_id),
    scope.authorId
  );

  // Membre → publications qu'il ne voit plus.
  const lost = new Map<string, string[]>();
  for (const tag of tags) {
    const privacy = privacyByPost.get(tag.post_id);
    // Publication partie entre-temps : ses identifications sont parties avec elle.
    if (privacy === undefined) continue;
    const link = links.get(tag.user_id);
    if (link && postVisibleTo(link, privacy)) continue;
    lost.set(tag.user_id, [...(lost.get(tag.user_id) ?? []), tag.post_id]);
  }

  let removed = 0;
  for (const [userId, postIds] of lost) {
    for (const part of chunks(postIds)) {
      const erased = await db.from("post_people_tags").delete().eq("author_id", scope.authorId).eq("user_id", userId).in("post_id", part);
      if (erased.error) throw new Error("Identifications : effacement impossible");
      const notices = await db.from("notifications").delete().eq("user_id", userId).eq("type", "tag").in("post_id", part);
      if (notices.error) throw new Error("Identifications : notifications non effacées");
      removed += part.length;
    }
  }
  return removed;
}

/** Retire toutes les identifications entre deux comptes, dans les deux sens
 * (blocage), et leurs notifications. Relève une erreur si une écriture échoue. */
export async function dropTagsBetween(fastify: FastifyInstance, a: string, b: string): Promise<void> {
  const db = fastify.supabaseAdmin;
  for (const [authorId, userId] of [
    [a, b],
    [b, a],
  ] as const) {
    const erased = await db.from("post_people_tags").delete().eq("author_id", authorId).eq("user_id", userId);
    if (erased.error) throw new Error("Identifications : effacement impossible");
  }
}
