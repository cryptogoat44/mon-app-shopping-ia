import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { COMMENT_COUNTER_FROM, COMMENT_MAX_LENGTH, type PostComment } from "@monapp/shared-types";
import { ApiError, createComment, deleteComment, fetchComments } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { timeAgo } from "@/lib/time";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { MoreIcon, PersonIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { ReportBlockMenu } from "@/components/report-block-menu";

// Commentaires d'une publication (Lot F, section 5.A) : à plat, ordre
// chronologique ; compteur de caractères visible seulement à partir de 900,
// saisie bloquée à 1 000 ; suppression de son commentaire (ou de n'importe
// lequel sous sa propre publication) ; « ··· » pour signaler ou bloquer.
export function CommentsSection({
  postId,
  viewerId,
  onCountChange,
  onOpenProfile,
}: {
  postId: string;
  viewerId: string | undefined;
  onCountChange?: (count: number) => void;
  onOpenProfile?: (userId: string) => void;
}) {
  const { showToast } = useToast();
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState("");
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
    } catch {
      setLoadError(true);
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (comments) onCountChange?.(comments.length);
  }, [comments, onCountChange]);

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await fetchComments(postId, nextCursor);
      setComments((prev) => [...(prev ?? []), ...page.comments]);
      setNextCursor(page.nextCursor);
    } catch {
      showToast(fr.comments.loadError);
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await createComment(postId, body);
      setComments((prev) => [...(prev ?? []), created]);
      setDraft("");
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : fr.comments.error);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(commentId: string) {
    setConfirmingId(null);
    try {
      await deleteComment(commentId);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
      showToast(fr.comments.deleted);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.comments.error);
    }
  }

  const showCounter = draft.length >= COMMENT_COUNTER_FROM;

  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">{fr.comments.title}</Text>

      {comments === null && !loadError ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
      {loadError ? (
        <Pressable onPress={load} accessibilityRole="button">
          <ErrorMessage style={styles.message}>{fr.comments.loadError}</ErrorMessage>
        </Pressable>
      ) : null}
      {comments !== null && comments.length === 0 ? <Text style={styles.empty}>{fr.comments.empty}</Text> : null}

      {(comments ?? []).map((comment) => (
        <View key={comment.id} style={styles.comment}>
          <Pressable
            onPress={() => onOpenProfile?.(comment.author.id)}
            disabled={!onOpenProfile || comment.author.id === viewerId}
            style={styles.avatar}
            accessibilityRole="link"
            accessibilityLabel={`Voir le profil de ${comment.author.displayName}`}
          >
            {comment.author.avatarUrl ? (
              <Image source={{ uri: comment.author.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <PersonIcon size={14} tint={color.acier} />
            )}
          </Pressable>
          <View style={styles.commentBody}>
            <Text style={styles.commentText}>
              <Text style={styles.commentAuthor}>{comment.author.displayName} </Text>
              {comment.body}
            </Text>
            <View style={styles.commentMeta}>
              <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
              {comment.canDelete ? (
                confirmingId === comment.id ? (
                  <>
                    <Text style={styles.time}>{fr.comments.deleteConfirm}</Text>
                    <Pressable onPress={() => handleDelete(comment.id)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.danger}>{fr.comments.delete}</Text>
                    </Pressable>
                    <Pressable onPress={() => setConfirmingId(null)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.metaAction}>{fr.postDetail.cancel}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => setConfirmingId(comment.id)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.metaAction}>{fr.comments.delete}</Text>
                  </Pressable>
                )
              ) : null}
            </View>
          </View>
          {comment.author.id !== viewerId ? (
            <Pressable onPress={() => setMenuFor(comment)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={fr.comments.more}>
              <MoreIcon size={16} tint={color.acier} />
            </Pressable>
          ) : null}
        </View>
      ))}

      {nextCursor ? (
        <Pressable onPress={loadMore} style={styles.loadMore} accessibilityRole="button">
          <Text style={styles.metaAction}>Voir les commentaires suivants</Text>
        </Pressable>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={fr.comments.placeholder}
          placeholderTextColor={color.acier}
          multiline
          maxLength={COMMENT_MAX_LENGTH}
          accessibilityLabel={fr.comments.placeholder}
        />
        <Pressable
          onPress={handleSend}
          disabled={sending || !draft.trim()}
          style={[styles.send, sending || !draft.trim() ? styles.sendDisabled : null]}
          accessibilityRole="button"
        >
          <Text style={styles.sendLabel}>{sending ? fr.comments.sending : fr.comments.send}</Text>
        </Pressable>
      </View>
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
        onBlocked={(blockedId) => setComments((prev) => (prev ?? []).filter((c) => c.author.id !== blockedId))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.sm },
  loader: { marginVertical: space.md },
  message: { fontSize: font.caption, marginVertical: space.xs },
  empty: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm },
  comment: { flexDirection: "row", gap: 10, paddingVertical: 8 },
  avatar: { width: 28, height: 28, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  commentBody: { flex: 1 },
  commentText: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  commentAuthor: { fontWeight: "600" },
  commentMeta: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: 2, flexWrap: "wrap" },
  time: { fontSize: font.caption, color: color.acier },
  metaAction: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  danger: { fontSize: font.caption, color: color.danger, fontWeight: "600" },
  more: { paddingTop: 4 },
  loadMore: { minHeight: 36, justifyContent: "center" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.sm, borderTopWidth: 1, borderTopColor: color.filet, marginTop: space.sm, paddingTop: space.sm },
  input: { flex: 1, minHeight: 40, maxHeight: 140, fontSize: font.secondary, color: color.encre, paddingVertical: 10 },
  send: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: color.vert, justifyContent: "center" },
  sendDisabled: { opacity: 0.5 },
  sendLabel: { color: color.blanc, fontSize: font.secondary, fontWeight: "600" },
  counter: { fontSize: font.caption, color: color.acier, textAlign: "right", marginTop: 4 },
});
