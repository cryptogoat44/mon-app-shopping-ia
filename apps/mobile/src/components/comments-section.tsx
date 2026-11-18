import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { COMMENT_COUNTER_FROM, COMMENT_MAX_LENGTH, type PostComment, type PublicProfile } from "@monapp/shared-types";
import { ApiError, createComment, deleteComment, fetchComments, fetchReplies, likeComment, removeMyMention, searchUsers } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { timeAgo } from "@/lib/format";
import {
  MENTION_SEARCH_DELAY_MS,
  NO_REPLIES,
  appendPage,
  applyMention,
  hasThreadFields,
  likeButtonLabel,
  mentionSuggestions,
  mentionTokenAt,
  mentionsViewer,
  optimisticLikeCount,
  repliesNeedLoading,
  rootIdOf,
  showsViewReplies,
  withCreatedComment,
  withLike,
  withReplyCount,
  withoutComment,
  withoutViewerMention,
  type RepliesState,
} from "@/lib/comment-threads";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { HeartIcon, MoreIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { MentionText } from "@/components/mention-text";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

// Commentaires d'une publication (Lot F, section 5.A) : ordre
// chronologique ; compteur de caractères visible seulement à partir de 900,
// saisie bloquée à 1 000 ; suppression de son commentaire (ou de n'importe
// lequel sous sa propre publication) ; « ··· » pour signaler ou bloquer.
//
// Lot « vie sociale » (migration 0046) : un fil. Sous chaque commentaire, un
// cœur avec son nombre, « Répondre » et « Voir les n réponses » ; les
// réponses, chargées à la demande, sont décalées d'un cran (un seul niveau).
// Le champ de saisie dit à qui l'on répond et propose des membres quand le
// mot en cours commence par « @ ». Un « @pseudo » n'est un lien que si le
// serveur a retenu la mention. Sans la migration, le serveur rend la liste à
// plat d'avant : ni cœur, ni « Répondre », ni suggestions.
export function CommentsSection({
  postId,
  viewerId,
  onChanged,
  onOpenProfile,
}: {
  postId: string;
  viewerId: string | undefined;
  /** Un commentaire a été ajouté ou retiré : l'écran relit le nombre de commentaires auprès du serveur. */
  onChanged?: () => void;
  onOpenProfile?: (userId: string) => void;
}) {
  const { showToast } = useToast();
  const { profile } = useAuth();
  // Le profil ne donne le réglage des mentions que si le serveur a la migration 0046.
  const mentionsOn = profile?.mentionsFrom !== undefined;
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, RepliesState>>({});
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [replyTo, setReplyTo] = useState<{ targetId: string; rootId: string; name: string } | null>(null);
  const [suggestions, setSuggestions] = useState<PublicProfile[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<PostComment | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const page = await fetchComments(postId);
      setComments(page.comments);
      setNextCursor(page.nextCursor);
      setReplies({});
    } catch {
      setLoadError(true);
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  // Suggestions : seulement quand le mot en cours commence par « @ », après
  // une courte pause, et jamais la réponse d'une recherche déjà dépassée.
  const token = mentionsOn ? mentionTokenAt(draft, cursor) : null;
  const query = token?.query ?? null;
  useEffect(() => {
    if (query === null) {
      setSuggestions([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      searchUsers(query)
        .then((results) => {
          if (current) setSuggestions(mentionSuggestions(results));
        })
        .catch(() => {
          if (current) setSuggestions([]);
        });
    }, MENTION_SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  function chooseSuggestion(username: string) {
    if (!token) return;
    const next = applyMention(draft, token, username);
    setDraft(next.text.slice(0, COMMENT_MAX_LENGTH));
    setCursor(Math.min(next.cursor, COMMENT_MAX_LENGTH));
    setSuggestions([]);
  }

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await fetchComments(postId, nextCursor);
      setComments((prev) => appendPage(prev ?? [], page.comments));
      setNextCursor(page.nextCursor);
    } catch {
      showToast(t.comments.loadError);
    }
  }

  /** Charge les réponses d'un commentaire : la première page, ou la suivante. */
  async function loadReplies(rootId: string, more = false) {
    const before = replies[rootId] ?? NO_REPLIES;
    if (before.loading) return;
    setReplies((prev) => ({ ...prev, [rootId]: { ...(prev[rootId] ?? NO_REPLIES), loading: true, failed: false } }));
    try {
      const page = await fetchReplies(rootId, more ? (before.nextCursor ?? undefined) : undefined);
      setReplies((prev) => {
        const shown = more ? (prev[rootId]?.items ?? []) : [];
        return { ...prev, [rootId]: { items: appendPage(shown, page.comments), nextCursor: page.nextCursor, open: true, loading: false, failed: false } };
      });
    } catch {
      setReplies((prev) => ({ ...prev, [rootId]: { ...(prev[rootId] ?? NO_REPLIES), loading: false, failed: true } }));
    }
  }

  function hideReplies(rootId: string) {
    setReplies((prev) => ({ ...prev, [rootId]: { ...(prev[rootId] ?? NO_REPLIES), open: false } }));
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await createComment(postId, body, replyTo?.targetId);
      const rootId = created.parentId ?? null;
      if (rootId !== null && repliesNeedLoading(replies, rootId)) {
        // Réponses pas encore affichées : on les charge, la nouvelle en fait partie.
        setComments((prev) => withReplyCount(prev ?? [], rootId, 1));
        void loadReplies(rootId);
      } else {
        const next = withCreatedComment(comments ?? [], replies, created);
        setComments(next.comments);
        setReplies(next.replies);
      }
      setDraft("");
      setCursor(0);
      setReplyTo(null);
      onChanged?.();
    } catch (e) {
      // La phrase du serveur (commentaire introuvable, trop de commentaires…), sinon la nôtre.
      setSendError(e instanceof ApiError ? e.message : t.comments.error);
    } finally {
      setSending(false);
    }
  }

  function remove(comment: PostComment) {
    const next = withoutComment(comments ?? [], replies, comment);
    setComments(next.comments);
    setReplies(next.replies);
    if (replyTo && (replyTo.targetId === comment.id || replyTo.rootId === comment.id)) setReplyTo(null);
    onChanged?.();
  }

  async function handleDelete(comment: PostComment) {
    setConfirmingId(null);
    try {
      await deleteComment(comment.id);
      remove(comment);
      showToast(t.comments.deleted);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.comments.error);
    }
  }

  /** Remplace un commentaire (d'origine ou réponse) là où il est affiché. */
  function patch(comment: PostComment, change: (list: readonly PostComment[]) => PostComment[]) {
    const rootId = rootIdOf(comment);
    if (rootId === comment.id) {
      setComments((prev) => change(prev ?? []));
      return;
    }
    setReplies((prev) => {
      const thread = prev[rootId];
      return thread ? { ...prev, [rootId]: { ...thread, items: change(thread.items) } } : prev;
    });
  }

  // Le cœur bouge tout de suite ; si le serveur refuse, il revient à son état.
  async function toggleLike(comment: PostComment) {
    const liked = comment.viewerHasLiked !== true;
    const before = { liked: comment.viewerHasLiked === true, count: comment.likeCount ?? 0 };
    patch(comment, (list) => withLike(list, comment.id, liked, optimisticLikeCount(comment, liked)));
    try {
      const result = await likeComment(comment.id, liked);
      patch(comment, (list) => withLike(list, comment.id, result.viewerHasLiked, result.likeCount));
    } catch (e) {
      patch(comment, (list) => withLike(list, comment.id, before.liked, before.count));
      showToast(e instanceof ApiError && e.status === 429 ? e.message : t.commentThreads.likeError);
    }
  }

  async function handleRemoveMention(comment: PostComment) {
    if (!viewerId) return;
    try {
      await removeMyMention(comment.id);
      patch(comment, (list) => list.map((item) => (item.id === comment.id ? withoutViewerMention(item, viewerId) : item)));
      showToast(t.commentThreads.mentionRemoved);
    } catch {
      showToast(t.commentThreads.mentionRemoveError);
    }
  }

  function renderComment(comment: PostComment, isReply: boolean) {
    const threaded = hasThreadFields(comment);
    const liked = comment.viewerHasLiked === true;
    const likeCount = comment.likeCount ?? 0;
    return (
      <View key={comment.id} style={[styles.comment, isReply ? styles.reply : null]}>
        <Pressable
          onPress={() => onOpenProfile?.(comment.author.id)}
          disabled={!onOpenProfile || comment.author.id === viewerId}
          accessibilityRole="link"
          accessibilityLabel={t.common.viewProfile(comment.author.displayName)}
        >
          <Avatar uri={comment.author.avatarUrl} userId={comment.author.id} displayName={comment.author.displayName} username={comment.author.username} size={isReply ? 22 : 28} />
        </Pressable>
        <View style={styles.commentBody}>
          <Text style={styles.commentText}>
            <Text style={styles.commentAuthor}>{comment.author.displayName} </Text>
            <MentionText body={comment.body} mentions={comment.mentions} onOpenProfile={onOpenProfile} />
          </Text>
          <View style={styles.commentMeta}>
            <Text style={styles.time}>{timeAgo(comment.createdAt, getActiveLocale())}</Text>
            {threaded ? (
              <>
                <Pressable
                  onPress={() => void toggleLike(comment)}
                  style={styles.like}
                  accessibilityRole="button"
                  accessibilityLabel={likeButtonLabel(liked, likeCount)}
                  accessibilityState={{ selected: liked }}
                  aria-pressed={liked}
                  testID="aimer-commentaire"
                >
                  <HeartIcon size={15} filled={liked} tint={liked ? color.vert : color.acier} />
                  {likeCount > 0 ? <Text style={styles.time}>{likeCount}</Text> : null}
                </Pressable>
                <Pressable
                  onPress={() => setReplyTo({ targetId: comment.id, rootId: rootIdOf(comment), name: comment.author.displayName })}
                  style={styles.metaButton}
                  accessibilityRole="button"
                  testID="repondre-commentaire"
                >
                  <Text style={styles.metaAction}>{t.commentThreads.reply}</Text>
                </Pressable>
              </>
            ) : null}
            {comment.canDelete ? (
              confirmingId === comment.id ? (
                <>
                  <Text style={styles.time}>{t.comments.deleteConfirm}</Text>
                  <Pressable onPress={() => handleDelete(comment)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.danger}>{t.comments.delete}</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmingId(null)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.metaAction}>{t.postDetail.cancel}</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={() => setConfirmingId(comment.id)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.metaAction}>{t.comments.delete}</Text>
                </Pressable>
              )
            ) : null}
          </View>
        </View>
        {comment.author.id !== viewerId ? (
          <Pressable onPress={() => setMenuFor(comment)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={t.comments.more}>
            <MoreIcon size={16} tint={color.acier} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  function renderReplies(comment: PostComment) {
    const thread = replies[comment.id] ?? NO_REPLIES;
    if ((comment.replyCount ?? 0) === 0 && thread.items.length === 0) return null;
    return (
      <View key={`${comment.id}-reponses`} style={styles.replies}>
        {thread.open ? thread.items.map((reply) => renderComment(reply, true)) : null}
        {thread.failed ? (
          <Pressable onPress={() => void loadReplies(comment.id, thread.open)} style={styles.metaButton} accessibilityRole="button">
            <ErrorMessage style={styles.message}>{t.commentThreads.repliesLoadError}</ErrorMessage>
          </Pressable>
        ) : null}
        {thread.loading ? <ActivityIndicator color={color.encre} style={styles.repliesLoader} /> : null}
        {showsViewReplies(comment, thread) && !thread.loading ? (
          <Pressable
            onPress={() => (thread.items.length > 0 ? setReplies((prev) => ({ ...prev, [comment.id]: { ...thread, open: true } })) : void loadReplies(comment.id))}
            style={styles.metaButton}
            accessibilityRole="button"
            testID="voir-reponses"
          >
            <Text style={styles.metaAction}>{t.commentThreads.showReplies(comment.replyCount ?? 0)}</Text>
          </Pressable>
        ) : null}
        {thread.open && thread.nextCursor && !thread.loading ? (
          <Pressable onPress={() => void loadReplies(comment.id, true)} style={styles.metaButton} accessibilityRole="button">
            <Text style={styles.metaAction}>{t.commentThreads.moreReplies}</Text>
          </Pressable>
        ) : null}
        {thread.open && thread.items.length > 0 ? (
          <Pressable onPress={() => hideReplies(comment.id)} style={styles.metaButton} accessibilityRole="button">
            <Text style={styles.metaAction}>{t.commentThreads.hideReplies}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const showCounter = draft.length >= COMMENT_COUNTER_FROM;
  const menuMentionsMe = menuFor !== null && mentionsViewer(menuFor, viewerId);

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">{t.comments.title}</Text>

      {comments === null && !loadError ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
      {loadError ? (
        <Pressable onPress={load} accessibilityRole="button">
          <ErrorMessage style={styles.message}>{t.comments.loadError}</ErrorMessage>
        </Pressable>
      ) : null}
      {comments !== null && comments.length === 0 ? <Text style={styles.empty}>{t.comments.empty}</Text> : null}

      {(comments ?? []).flatMap((comment) => [renderComment(comment, false), renderReplies(comment)])}

      {nextCursor ? (
        <Pressable onPress={loadMore} style={styles.loadMore} accessibilityRole="button">
          <Text style={styles.metaAction}>{t.comments.showMore}</Text>
        </Pressable>
      ) : null}

      <View style={styles.composerBlock}>
        {replyTo ? (
          <View style={styles.replyingTo}>
            <Text style={styles.replyingToText} numberOfLines={1} accessibilityLiveRegion="polite">
              {t.commentThreads.replyingTo(replyTo.name)}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} style={styles.cancelReply} accessibilityRole="button" accessibilityLabel={t.commentThreads.cancelReply} testID="annuler-reponse">
              <Text style={styles.cancelReplyLabel}>✕</Text>
            </Pressable>
          </View>
        ) : null}
        {suggestions.length > 0 && token ? (
          <View style={styles.suggestions} role="list" accessibilityLabel={t.commentThreads.suggestionsLabel}>
            {suggestions.map((person) => (
              <Pressable
                key={person.id}
                onPress={() => chooseSuggestion(person.username)}
                style={styles.suggestion}
                accessibilityRole="button"
                accessibilityLabel={t.commentThreads.suggestionLabel(person.displayName || person.username)}
                testID="suggestion-mention"
              >
                <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={24} />
                <Text style={styles.suggestionName} numberOfLines={1}>
                  <Text style={styles.suggestionHandle}>@{person.username}</Text>
                  {person.displayName ? ` · ${person.displayName}` : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              // Sur le site, le changement de sélection n'arrive pas toujours : par défaut, le curseur suit la fin du texte.
              setCursor(text.length);
            }}
            onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
            placeholder={t.comments.placeholder}
            placeholderTextColor={color.acier}
            multiline
            maxLength={COMMENT_MAX_LENGTH}
            accessibilityLabel={t.comments.placeholder}
            accessibilityHint={mentionsOn ? t.commentThreads.mentionHint : undefined}
          />
          <Pressable
            onPress={handleSend}
            disabled={sending || !draft.trim()}
            style={[styles.send, sending || !draft.trim() ? styles.sendDisabled : null]}
            accessibilityRole="button"
          >
            <Text style={[styles.sendLabel, sending || !draft.trim() ? styles.sendLabelDisabled : null]}>{sending ? t.comments.sending : t.comments.send}</Text>
          </Pressable>
        </View>
      </View>
      {mentionsOn && draft.length === 0 ? <Text style={styles.hint}>{t.commentThreads.mentionHint}</Text> : null}
      {showCounter ? (
        <Text style={styles.counter} accessibilityLiveRegion="polite">
          {draft.length} / {COMMENT_MAX_LENGTH}
        </Text>
      ) : null}
      {sendError ? <ErrorMessage style={styles.message}>{sendError}</ErrorMessage> : null}

      <ReportBlockMenu
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        userId={menuFor?.author.id ?? ""}
        commentId={menuFor?.id}
        extraAction={menuFor && menuMentionsMe ? { label: t.commentThreads.removeMyMention, onPress: () => void handleRemoveMention(menuFor) } : undefined}
        onBlocked={() => {
          // Ses commentaires, ses réponses et les réponses qu'on lui a faites
          // disparaissent : le serveur rend le fil tel qu'il est maintenant.
          setReplyTo(null);
          void load();
          onChanged?.();
        }}
        onReported={() => {
          if (menuFor) remove(menuFor);
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.sm },
  loader: { marginVertical: space.md },
  message: { fontSize: font.caption, marginVertical: space.xs },
  empty: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm },
  comment: { flexDirection: "row", gap: 10, paddingVertical: 8 },
  reply: { paddingVertical: 6 },
  // Un seul cran de retrait : la largeur de l'avatar d'un commentaire et de son écart.
  replies: { marginLeft: 38 },
  repliesLoader: { alignSelf: "flex-start", marginVertical: space.sm },
  commentBody: { flex: 1 },
  commentText: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  commentAuthor: { fontWeight: "600" },
  commentMeta: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 2, flexWrap: "wrap" },
  time: { fontSize: font.caption, color: color.acier },
  metaAction: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  // Cibles d'au moins 44 points par le remplissage (le site ignore « hitSlop »).
  like: { minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 4, marginVertical: -12 },
  metaButton: { minHeight: 44, justifyContent: "center", marginVertical: -12 },
  danger: { fontSize: font.caption, color: color.danger, fontWeight: "600" },
  more: { paddingTop: 4 },
  loadMore: { minHeight: 36, justifyContent: "center" },
  composerBlock: { borderTopWidth: 1, borderTopColor: color.filet, marginTop: space.sm, paddingTop: space.sm },
  replyingTo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  replyingToText: { flex: 1, fontSize: font.caption, color: color.acier },
  cancelReply: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  cancelReplyLabel: { fontSize: font.secondary, color: color.acier },
  suggestions: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, marginBottom: space.sm },
  suggestion: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md },
  suggestionName: { flex: 1, fontSize: font.secondary, color: color.acier },
  suggestionHandle: { color: color.encre, fontWeight: "600" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: { flex: 1, minHeight: 40, maxHeight: 140, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  send: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: color.vert, justifyContent: "center" },
  sendDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  sendLabelDisabled: { color: color.surInactif },
  sendLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  hint: { fontSize: font.caption, color: color.acier, marginTop: 4 },
  counter: { fontSize: font.caption, color: color.acier, textAlign: "right", marginTop: 4 },
}));
