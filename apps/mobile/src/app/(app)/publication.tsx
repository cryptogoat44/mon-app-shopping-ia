import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, deletePost, fetchPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { PostCard } from "@/components/post-card";
import { CommentsSection } from "@/components/comments-section";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { ErrorMessage } from "@/components/error-message";

// Détail d'une publication (Lot Q, bloc 3, UX-03) : la sienne peut être
// supprimée (après confirmation) ; celle d'un autre se signale ou mène à
// son profil. Visible seulement si le serveur l'autorise (confidentialité,
// blocages) — sinon « n'est pas disponible ».
export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { showToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setState("loading");
    try {
      setPost(await fetchPost(id));
      setState("ready");
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  async function handleDelete() {
    if (!post) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePost(post.id);
      showToast(fr.postDetail.deleted);
      goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fr.postDetail.deleteError);
      setDeleting(false);
    }
  }

  const isMine = post !== null && post.author.id === session?.user.id;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel="Retour">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.navTitle}>{fr.postDetail.title}</Text>
        <View style={styles.navSide} />
      </View>

      {state !== "ready" || !post ? (
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? fr.postDetail.notFound : fr.userProfile.loadError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={load} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>Réessayer</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PostCard
            post={post}
            onOpenMenu={isMine ? undefined : () => setMenuOpen(true)}
            onPressAuthor={isMine ? undefined : () => router.push({ pathname: "/profil", params: { id: post.author.id } })}
            commentCount={commentCount ?? post.commentCount}
          />

          {isMine ? (
            <View style={styles.owner}>
              {error ? <ErrorMessage style={styles.message}>{error}</ErrorMessage> : null}
              {!confirming ? (
                <Pressable onPress={() => setConfirming(true)} hitSlop={12} style={styles.deleteRow} accessibilityRole="button">
                  <Text style={styles.deleteLabel}>{fr.postDetail.delete}</Text>
                </Pressable>
              ) : (
                <View style={styles.confirm}>
                  <Text style={styles.confirmText} accessibilityRole="alert">
                    {post.type === "purchase" ? fr.postDetail.deleteConfirmPurchase : fr.postDetail.deleteConfirm}
                  </Text>
                  <View style={styles.confirmButtons}>
                    <Pressable onPress={() => setConfirming(false)} disabled={deleting} hitSlop={12} accessibilityRole="button">
                      <Text style={styles.cancelLabel}>{fr.postDetail.cancel}</Text>
                    </Pressable>
                    <Pressable onPress={handleDelete} disabled={deleting} hitSlop={12} accessibilityRole="button">
                      <Text style={styles.deleteLabel}>{deleting ? fr.postDetail.deleting : fr.postDetail.confirm}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ) : null}

          <CommentsSection
            postId={post.id}
            viewerId={session?.user.id}
            onCountChange={setCommentCount}
            onOpenProfile={(userId) => router.push({ pathname: "/profil", params: { id: userId } })}
          />
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {post && !isMine ? (
        <ReportBlockMenu visible={menuOpen} onClose={() => setMenuOpen(false)} userId={post.author.id} postId={post.id} onBlocked={goBack} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navTitle: { fontSize: font.caption, color: color.acier },
  back: { fontSize: 26, color: color.encre },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center" },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  content: { paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  owner: { paddingHorizontal: space.lg },
  deleteRow: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  deleteLabel: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  confirm: { backgroundColor: color.plinthe, borderRadius: radius.md, padding: space.md },
  confirmText: { fontSize: font.secondary, color: color.encre, marginBottom: space.sm, lineHeight: 20 },
  confirmButtons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
});
