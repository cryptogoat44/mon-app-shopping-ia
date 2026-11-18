import { findMentions, type CommentMention, type PostComment, type PublicProfile } from "@monapp/shared-types";
import { t } from "../i18n";

// Commentaires : réponses, « j'aime », mentions (lot « vie sociale »,
// migration 0046). Ce que le fil affiche et ce que le champ de saisie
// propose. Fonctions pures, sans écran.

/** Le serveur a-t-il renvoyé un fil (migration 0046 et « v=2 ») ? Sans cela,
 * le commentaire arrive sans ses « j'aime » : ni cœur ni « Répondre ». */
export function hasThreadFields(comment: PostComment): boolean {
  return typeof comment.likeCount === "number";
}

// ---- Texte d'un commentaire ----

export interface TextPart {
  text: string;
  /** Présent : ce morceau est un « @pseudo » qui mène à ce profil. */
  userId?: string;
}

/** Découpe le texte d'un commentaire. Un « @pseudo » ne devient un lien que
 * si le serveur a renvoyé cette mention : tout autre « @mot » (pseudo
 * inconnu, mention refusée ou retirée, compte bloqué) reste un simple texte,
 * sans que rien ne les distingue. */
export function splitMentions(body: string, mentions: readonly CommentMention[] | undefined): TextPart[] {
  const byHandle = new Map((mentions ?? []).map((mention) => [mention.handle.toLowerCase(), mention.userId]));
  if (byHandle.size === 0) return [{ text: body }];
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const span of findMentions(body)) {
    const userId = byHandle.get(span.handle);
    if (!userId) continue;
    if (span.start > cursor) parts.push({ text: body.slice(cursor, span.start) });
    parts.push({ text: body.slice(span.start, span.end), userId });
    cursor = span.end;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts.length > 0 ? parts : [{ text: body }];
}

/** Ce commentaire mentionne-t-il le lecteur ? (« Retirer ma mention ») */
export function mentionsViewer(comment: Pick<PostComment, "mentions">, viewerId: string | undefined): boolean {
  return viewerId !== undefined && (comment.mentions ?? []).some((mention) => mention.userId === viewerId);
}

/** Le commentaire sans la mention du lecteur : le texte ne change pas, le lien disparaît. */
export function withoutViewerMention<C extends Pick<PostComment, "mentions">>(comment: C, viewerId: string): C {
  return { ...comment, mentions: (comment.mentions ?? []).filter((mention) => mention.userId !== viewerId) };
}

// ---- Saisie : le mot en cours commence-t-il par « @ » ? ----

export interface MentionToken {
  /** Ce qui suit l'arobase, en minuscules (au moins un caractère). */
  query: string;
  /** Place de l'arobase et fin du mot en cours (le curseur). */
  start: number;
  end: number;
}

/** Suggestions proposées au plus. */
export const MENTION_SUGGESTIONS_MAX = 5;
/** Attente après la dernière frappe avant de chercher (ms). */
export const MENTION_SEARCH_DELAY_MS = 300;

const HANDLE_CHARS = /^[a-z0-9_]{1,20}$/i;
const BEFORE_AT_FORBIDDEN = /[a-z0-9_.@]/i;

/** Le « @mot » que la personne est en train de taper, juste avant le
 * curseur ; null sinon (pas d'arobase, arobase collée à un mot comme dans
 * une adresse e-mail, espace entre l'arobase et le curseur, mot trop long). */
export function mentionTokenAt(text: string, cursor: number): MentionToken | null {
  if (cursor < 1 || cursor > text.length) return null;
  const at = text.lastIndexOf("@", cursor - 1);
  if (at < 0) return null;
  const query = text.slice(at + 1, cursor);
  if (!HANDLE_CHARS.test(query)) return null;
  if (at > 0 && BEFORE_AT_FORBIDDEN.test(text[at - 1]!)) return null;
  return { query: query.toLowerCase(), start: at, end: cursor };
}

/** Remplace le mot en cours par « @pseudo » suivi d'un espace. `cursor` :
 * où placer le curseur ensuite. La fin d'un pseudo déjà tapé après le
 * curseur est remplacée aussi. */
export function applyMention(text: string, token: MentionToken, username: string): { text: string; cursor: number } {
  let end = token.end;
  while (end < text.length && /[a-z0-9_]/i.test(text[end]!)) end += 1;
  const before = `${text.slice(0, token.start)}@${username} `;
  const after = text.slice(end).replace(/^ /, "");
  return { text: before + after, cursor: before.length };
}

/** Les comptes à proposer : ceux qui ont un pseudo, les MENTION_SUGGESTIONS_MAX premiers. */
export function mentionSuggestions(results: readonly PublicProfile[]): PublicProfile[] {
  return results.filter((profile) => profile.username.length > 0).slice(0, MENTION_SUGGESTIONS_MAX);
}

// ---- Le fil ----

export interface RepliesState {
  items: PostComment[];
  nextCursor: string | null;
  open: boolean;
  loading: boolean;
  failed: boolean;
}

export const NO_REPLIES: RepliesState = { items: [], nextCursor: null, open: false, loading: false, failed: false };

/** Le commentaire d'origine d'un commentaire : lui-même, ou celui auquel il répond. */
export function rootIdOf(comment: Pick<PostComment, "id" | "parentId">): string {
  return comment.parentId ?? comment.id;
}

/** Après un « j'aime » (ou son retour en arrière) : le commentaire porte le
 * nouvel état, les autres ne sont pas recopiés. */
export function withLike<C extends Pick<PostComment, "id" | "likeCount" | "viewerHasLiked">>(comments: readonly C[], id: string, liked: boolean, likeCount: number): C[] {
  return comments.map((comment) => (comment.id === id ? { ...comment, viewerHasLiked: liked, likeCount: Math.max(0, likeCount) } : comment));
}

/** Le nombre affiché tout de suite, avant la réponse du serveur. */
export function optimisticLikeCount(comment: Pick<PostComment, "likeCount" | "viewerHasLiked">, liked: boolean): number {
  const current = comment.likeCount ?? 0;
  if (liked === (comment.viewerHasLiked === true)) return current;
  return Math.max(0, current + (liked ? 1 : -1));
}

/** Le nombre de réponses d'un commentaire d'origine, après en avoir ajouté ou retiré. */
export function withReplyCount<C extends Pick<PostComment, "id" | "replyCount">>(comments: readonly C[], rootId: string, delta: number): C[] {
  return comments.map((comment) => (comment.id === rootId ? { ...comment, replyCount: Math.max(0, (comment.replyCount ?? 0) + delta) } : comment));
}

/** « Voir les n réponses » : seulement s'il y en a, et tant qu'elles ne sont pas affichées. */
export function showsViewReplies(comment: Pick<PostComment, "replyCount">, replies: RepliesState): boolean {
  return (comment.replyCount ?? 0) > 0 && !replies.open;
}

/** Ce que le cœur annonce aux lecteurs d'écran : l'action, puis le nombre. */
export function likeButtonLabel(liked: boolean, count: number): string {
  return `${liked ? t.commentThreads.unlike : t.commentThreads.like}, ${t.commentThreads.likes(count)}`;
}

/** Après la suppression ou le signalement d'un commentaire : le fil sans
 * lui. Un commentaire d'origine emporte ses réponses ; une réponse retire un
 * du nombre de réponses de son commentaire d'origine. */
export function withoutComment(
  comments: readonly PostComment[],
  replies: Readonly<Record<string, RepliesState>>,
  removed: Pick<PostComment, "id" | "parentId">
): { comments: PostComment[]; replies: Record<string, RepliesState> } {
  const rootId = removed.parentId ?? null;
  if (rootId === null) {
    const { [removed.id]: _gone, ...rest } = replies;
    return { comments: comments.filter((comment) => comment.id !== removed.id), replies: rest };
  }
  const thread = replies[rootId];
  const wasShown = thread?.items.some((reply) => reply.id === removed.id) ?? false;
  return {
    comments: wasShown ? withReplyCount(comments, rootId, -1) : [...comments],
    replies: thread ? { ...replies, [rootId]: { ...thread, items: thread.items.filter((reply) => reply.id !== removed.id) } } : { ...replies },
  };
}

/** Après l'envoi d'un commentaire : une réponse va sous son commentaire
 * d'origine, un commentaire ordinaire à la fin du fil. Pour une réponse, à
 * n'appeler que si les réponses de ce commentaire sont déjà affichées
 * (sinon l'écran les charge : voir repliesNeedLoading). */
export function withCreatedComment(
  comments: readonly PostComment[],
  replies: Readonly<Record<string, RepliesState>>,
  created: PostComment
): { comments: PostComment[]; replies: Record<string, RepliesState> } {
  const rootId = created.parentId ?? null;
  if (rootId === null) return { comments: [...comments, created], replies: { ...replies } };
  const thread = replies[rootId] ?? NO_REPLIES;
  return {
    comments: withReplyCount(comments, rootId, 1),
    replies: { ...replies, [rootId]: { ...thread, items: [...thread.items, created], open: true } },
  };
}

/** Les réponses de ce commentaire sont-elles encore à charger avant d'y ajouter la nouvelle ? */
export function repliesNeedLoading(replies: Readonly<Record<string, RepliesState>>, rootId: string): boolean {
  return replies[rootId]?.open !== true;
}

/** Ajoute une page à une liste déjà affichée, sans doublon (une réponse
 * qu'on vient d'écrire peut revenir dans la page suivante). */
export function appendPage(shown: readonly PostComment[], page: readonly PostComment[]): PostComment[] {
  const known = new Set(shown.map((comment) => comment.id));
  return [...shown, ...page.filter((comment) => !known.has(comment.id))];
}
