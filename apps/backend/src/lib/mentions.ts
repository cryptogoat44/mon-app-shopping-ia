import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_MENTIONS_FROM, MENTIONS_FROM, extractMentions, type CommentMention, type MentionsFrom, type PrivacyLevel } from "@monapp/shared-types";
import { postVisibleTo, readViewersAudience } from "./audience.js";
import { suspendedAmong } from "./moderation.js";
import { parseDbRows } from "./validation.js";

// Mentions « @pseudo » (lot « vie sociale », migration 0046 ; les
// identifications sur une photo, migration 0047, s'appuieront sur les mêmes
// fonctions). Une mention n'est retenue que si TOUT est vrai :
//   - le pseudo est celui d'un compte, qui n'est pas l'auteur du texte ;
//   - aucun blocage entre ce compte et l'auteur, dans un sens ou dans l'autre ;
//   - ce compte n'est pas suspendu ;
//   - son réglage « Qui peut me mentionner » le permet (mayMention) ;
//   - il peut VOIR la publication (lib/audience.ts) : sinon la mention lui
//     apprendrait qu'elle existe ;
//   - l'auteur n'a pas épuisé son budget de mentions de l'heure (`consume`).
// Une mention écartée ne produit rien : ni ligne, ni notification, ni erreur,
// ni message. Le « @pseudo » reste un simple texte, et l'auteur ne peut pas
// savoir pourquoi (le réglage d'un autre membre ne se devine pas).

/** Le réglage du membre mentionné laisse-t-il cet auteur le mentionner ?
 * « following » : seulement les comptes que le membre mentionné suit. */
export function mayMention(setting: MentionsFrom, targetFollowsAuthor: boolean): boolean {
  if (setting === "everyone") return true;
  if (setting === "following") return targetFollowsAuthor;
  return false;
}

const PROFILE_ROWS = z.array(
  z.object({
    id: z.guid(),
    username: z.string().nullable(),
    // Colonne obligatoire dans la base ; illisible ou absente : la valeur de départ, protectrice.
    mentions_from: z.enum(MENTIONS_FROM).nullable().optional().catch(DEFAULT_MENTIONS_FROM),
  })
);

export interface ResolveMentionsInput {
  /** Qui écrit le texte. */
  authorId: string;
  text: string;
  /** La publication sous laquelle le texte est écrit. */
  post: { user_id: string; privacy: PrivacyLevel };
  /** Compte une mention retenue dans le budget de l'auteur ; false : budget épuisé. */
  consume: () => boolean;
}

/** Les mentions retenues d'un texte, dans l'ordre où elles sont écrites.
 * Les pseudos viennent d'extractMentions (lettres minuscules, chiffres et
 * « _ » seulement) : ils peuvent partir tels quels dans un filtre. Une
 * lecture impossible relève une erreur : l'appelant publie alors le texte
 * sans aucune mention. */
export async function resolveMentions(fastify: FastifyInstance, input: ResolveMentionsInput): Promise<CommentMention[]> {
  const handles = extractMentions(input.text);
  if (handles.length === 0) return [];

  const profiles = parseDbRows(
    PROFILE_ROWS,
    await fastify.supabaseAdmin.from("profiles").select("id, username, mentions_from").in("username", handles),
    "Comptes mentionnés"
  );
  const byHandle = new Map(profiles.flatMap((row) => (row.username && row.id !== input.authorId ? [[row.username, row] as const] : [])));
  const candidates = handles.flatMap((handle) => {
    const row = byHandle.get(handle);
    return row ? [{ handle, userId: row.id, setting: row.mentions_from ?? DEFAULT_MENTIONS_FROM }] : [];
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((candidate) => candidate.userId);
  const [toAuthor, suspended] = await Promise.all([readViewersAudience(fastify, ids, input.authorId), suspendedAmong(fastify, ids)]);
  const toPostAuthor = input.post.user_id === input.authorId ? toAuthor : await readViewersAudience(fastify, ids, input.post.user_id);

  const accepted: CommentMention[] = [];
  for (const candidate of candidates) {
    const author = toAuthor.get(candidate.userId);
    const post = toPostAuthor.get(candidate.userId);
    if (!author || !post || author.blocked || suspended.has(candidate.userId)) continue;
    if (!mayMention(candidate.setting, author.follows)) continue;
    if (!postVisibleTo(post, input.post.privacy)) continue;
    // Budget épuisé : cette mention et les suivantes restent un simple texte.
    if (!input.consume()) break;
    accepted.push({ handle: candidate.handle, userId: candidate.userId });
  }
  return accepted;
}
