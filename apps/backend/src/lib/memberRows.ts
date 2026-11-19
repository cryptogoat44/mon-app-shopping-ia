import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FollowState, MemberRow } from "@monapp/shared-types";
import { readAudience, type Audience } from "./audience.js";
import { parseDbRows } from "./validation.js";

// LA règle de toutes les listes de membres (demandes reçues ; puis abonnés,
// abonnements, « Aimé par », personnes identifiées, suggestions…). Une ligne
// est laissée de côté quand le compte :
//   - n'a pas de nom d'utilisateur (profil pas encore complété) ;
//   - est suspendu par la modération ;
//   - est en blocage avec le lecteur, dans un sens ou dans l'autre ;
//   - est PRIVÉ, et que le lecteur n'est ni ce compte, ni un de ses abonnés
//     acceptés, ni `contextOwnerId` (le propriétaire de la liste, ou l'auteur
//     de la publication).
// Un compte privé n'apparaît donc jamais à un inconnu dans la liste d'un
// autre. La réponse ne dit jamais combien de lignes ont été laissées de côté.
//
// Une lecture groupée de plus que readAudience (les profils), quel que
// soit le nombre de lignes.

const PROFILE_ROWS = z.array(z.object({ id: z.guid(), username: z.string().nullable(), display_name: z.string(), avatar_url: z.string().nullable() }));

export interface MemberRowsContext {
  /** À qui est la liste (ses abonnés, les demandes qu'il a reçues), ou
   * l'auteur de la publication (« Aimé par ») : lui seul y voit les comptes
   * privés qu'il ne suit pas. */
  contextOwnerId: string | null;
}

/** Ce compte peut-il figurer dans une liste lue par ce lecteur ? */
export function memberShown(audience: Audience, hasUsername: boolean, viewerIsContextOwner: boolean): boolean {
  if (!hasUsername || audience.suspended || audience.blocked) return false;
  return !audience.isPrivate || audience.self || audience.follows || viewerIsContextOwner;
}

export function followStateOf(audience: Pick<Audience, "follows" | "requested">): FollowState {
  return audience.follows ? "following" : audience.requested ? "requested" : "none";
}

/** Les lignes à montrer à `viewerId`, dans l'ordre de `userIds` (doublons
 * retirés). Lecture impossible : DatabaseReadError (jamais une ligne montrée
 * par défaut). */
export async function toMemberRows(fastify: FastifyInstance, viewerId: string, userIds: readonly string[], context: MemberRowsContext): Promise<MemberRow[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const [audiences, profiles] = await Promise.all([
    readAudience(fastify, viewerId, ids),
    fastify.supabaseAdmin.from("profiles").select("id, username, display_name, avatar_url").in("id", ids),
  ]);
  const profileById = new Map(parseDbRows(PROFILE_ROWS, profiles, "Profils d'une liste de membres").map((row) => [row.id, row]));
  const viewerIsContextOwner = context.contextOwnerId !== null && context.contextOwnerId === viewerId;

  const rows: MemberRow[] = [];
  for (const id of ids) {
    const profile = profileById.get(id);
    const audience = audiences.get(id);
    if (!profile || !audience || !memberShown(audience, Boolean(profile.username), viewerIsContextOwner)) continue;
    rows.push({
      id,
      username: profile.username ?? "",
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      isFollowing: audience.follows,
      isPrivate: audience.isPrivate,
      followState: followStateOf(audience),
      isMe: audience.self,
    });
  }
  return rows;
}
