import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_MENTIONS_FROM, MENTIONS_FROM, extractMentions, type CommentMention, type MentionsFrom, type PrivacyLevel } from "@monapp/shared-types";
import { postVisibleTo, readViewersAudience } from "./audience.js";
import { suspendedAmong } from "./moderation.js";
import { parseDbRows } from "./validation.js";

// Mentions « @pseudo » (lot « vie sociale », migration 0046 ; les
// identifications sur une publication, migration 0047, passent par la même
// règle : acceptMentionTargets, lib/peopleTags.ts). Une mention n'est
// retenue que si TOUT est vrai :
//   - le pseudo est celui d'un compte, qui n'est pas l'auteur du texte ;
//   - aucun blocage entre ce compte et l'auteur, dans un sens ou dans l'autre ;
//   - ce compte n'est pas suspendu ;
//   - son réglage « Qui peut me mentionner » le permet (mayMention) ;
//   - il peut VOIR la publication (lib/audience.ts) : sinon la mention lui
//     apprendrait qu'elle existe ;
//   - pour une réponse, il peut VOIR le fil : aucun blocage entre lui et
//     l'auteur du commentaire d'origine (`threadAuthorId`), dans un sens ou
//     dans l'autre ;
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

export interface MentionTargetsInput {
  /** Qui écrit le texte (ou identifie). */
  authorId: string;
  /** La publication sous laquelle le texte est écrit (ou sur laquelle on identifie). */
  post: { user_id: string; privacy: PrivacyLevel };
  /** Pour une réponse : l'auteur du commentaire d'origine (lib/comments.ts, rootAuthorId). */
  threadAuthorId?: string;
  /** Compte une mention retenue dans le budget de l'auteur ; false : budget épuisé. */
  consume: () => boolean;
}

export interface ResolveMentionsInput extends MentionTargetsInput {
  text: string;
}

/** Un compte à mentionner (ou à identifier) et son réglage « Qui peut me mentionner ». */
export interface MentionTarget {
  userId: string;
  setting: MentionsFrom;
}

/** Les comptes retenus parmi `candidates` (déjà sans l'auteur lui-même), dans
 * leur ordre, selon la règle en tête de ce fichier ; chacun retenu consomme
 * le budget de l'auteur, et le budget épuisé arrête tout. Une lecture
 * impossible relève une erreur : l'appelant ne retient alors personne. */
export async function acceptMentionTargets<T extends MentionTarget>(fastify: FastifyInstance, input: MentionTargetsInput, candidates: readonly T[]): Promise<T[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((candidate) => candidate.userId);
  const [toAuthor, suspended] = await Promise.all([readViewersAudience(fastify, ids, input.authorId), suspendedAmong(fastify, ids)]);
  const toPostAuthor = input.post.user_id === input.authorId ? toAuthor : await readViewersAudience(fastify, ids, input.post.user_id);
  const threadAuthorId = input.threadAuthorId ?? input.authorId;
  const toThreadAuthor =
    threadAuthorId === input.authorId ? toAuthor : threadAuthorId === input.post.user_id ? toPostAuthor : await readViewersAudience(fastify, ids, threadAuthorId);

  const accepted: T[] = [];
  for (const candidate of candidates) {
    const author = toAuthor.get(candidate.userId);
    const post = toPostAuthor.get(candidate.userId);
    const thread = toThreadAuthor.get(candidate.userId);
    if (!author || !post || !thread || author.self || author.blocked || thread.blocked || suspended.has(candidate.userId)) continue;
    if (!mayMention(candidate.setting, author.follows)) continue;
    if (!postVisibleTo(post, input.post.privacy)) continue;
    // Budget épuisé : cette mention et les suivantes restent un simple texte.
    if (!input.consume()) break;
    accepted.push(candidate);
  }
  return accepted;
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
  const accepted = await acceptMentionTargets(fastify, input, candidates);
  return accepted.map((candidate): CommentMention => ({ handle: candidate.handle, userId: candidate.userId }));
}
