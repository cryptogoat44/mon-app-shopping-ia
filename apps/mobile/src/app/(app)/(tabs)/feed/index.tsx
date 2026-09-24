import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, fetchFeed } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { Skeleton } from "@/components/skeleton";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { ErrorMessage } from "@/components/error-message";
import { PostCard } from "@/components/post-card";
import { useAuth } from "@/lib/auth-context";
import { fr } from "@/i18n/fr";

function FeedSkeletonRow() {
  return (
    <View style={styles.post}>
      <View style={styles.author}>
        <Skeleton style={styles.avatar} />
        <Skeleton style={{ width: 100, height: 12 }} />
      </View>
      <Skeleton style={styles.media} />
      <Skeleton style={{ width: "70%", height: 12, marginTop: 12 }} />
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id;
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menuTarget, setMenuTarget] = useState<{ userId: string; postId: string } | null>(null);

  function handleBlocked(userId: string) {
    setPosts((prev) => (prev ? prev.filter((p) => p.author.id !== userId) : prev));
  }

  const load = useCallback(async () => {
    try {
      const page = await fetchFeed();
      setPosts(page.posts);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger le fil.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchFeed()
        .then((page) => {
          if (!cancelled) {
            setPosts(page.posts);
            setNextCursor(page.nextCursor);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : "Impossible de charger le fil.");
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore || refreshing) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(nextCursor);
      setPosts((prev) => (prev ? [...prev, ...page.posts] : page.posts));
      setNextCursor(page.nextCursor);
    } catch {
      // silencieux : re-scroller vers le bas redéclenche onEndReached
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Fil</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" onPress={() => router.push("/people-search")} hitSlop={12}>
            <Text style={styles.headerLink}>Profils</Text>
          </Pressable>
        </View>
      </View>

      {posts === null && !error ? (
        <View style={styles.content}>
          <FeedSkeletonRow />
          <View style={styles.divider} />
          <FeedSkeletonRow />
        </View>
      ) : (
        <FlatList
          data={posts ?? []}
          keyExtractor={(post) => post.id}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
          renderItem={({ item: post }) => (
            <PostCard
              post={post}
              // Ses propres publications (Lot F) : pas de « signaler / bloquer ».
              onOpenMenu={post.author.id === myId ? undefined : () => setMenuTarget({ userId: post.author.id, postId: post.id })}
              onPressAuthor={() =>
                post.author.id === myId ? router.push("/profile") : router.push({ pathname: "/profil", params: { id: post.author.id } })
              }
              onOpenComments={() => router.push({ pathname: "/publication", params: { id: post.id } })}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          ListHeaderComponent={error ? <ErrorMessage style={styles.errorText}>{error}</ErrorMessage> : null}
          ListEmptyComponent={
            posts !== null && !error ? (
              // Fil vide (Lot F) : expliquer quoi faire, avec des boutons. Les
              // vraies suggestions de comptes viendront au lot 7.
              <View style={styles.empty}>
                <Text style={styles.emptyTitle} accessibilityRole="header">{fr.feed.emptyTitle}</Text>
                <Text style={styles.emptyText}>{fr.feed.emptyBody}</Text>
                <Pressable style={styles.emptyPrimary} onPress={() => router.push("/")} accessibilityRole="button">
                  <Text style={styles.emptyPrimaryLabel}>{fr.feed.emptySpot}</Text>
                </Pressable>
                <Pressable style={styles.emptySecondary} onPress={() => router.push("/post-item/new")} accessibilityRole="button">
                  <Text style={styles.emptySecondaryLabel}>{fr.feed.emptyPublish}</Text>
                </Pressable>
                <Pressable style={styles.emptySecondary} onPress={() => router.push("/people-search")} accessibilityRole="button">
                  <Text style={styles.emptySecondaryLabel}>{fr.feed.emptyFind}</Text>
                </Pressable>
              </View>
            ) : null
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={color.encre} style={styles.footerLoader} /> : null}
        />
      )}

      <ReportBlockMenu
        visible={menuTarget !== null}
        onClose={() => setMenuTarget(null)}
        userId={menuTarget?.userId ?? ""}
        postId={menuTarget?.postId}
        onBlocked={handleBlocked}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  headerActions: { flexDirection: "row", alignItems: "center", gap: space.md },
  headerLink: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
  content: { paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  errorText: { color: color.acier, fontSize: font.secondary, paddingHorizontal: space.lg, marginBottom: space.md },
  empty: { alignItems: "center", marginTop: space.xl, paddingHorizontal: space.lg },
  emptyTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, textAlign: "center", marginBottom: space.sm },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginBottom: space.lg, lineHeight: 20 },
  emptyPrimary: { alignSelf: "stretch", minHeight: 50, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  emptyPrimaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  emptySecondary: { alignSelf: "stretch", minHeight: 50, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  emptySecondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "600" },
  // Squelette de chargement (mêmes proportions qu'une publication).
  post: { paddingHorizontal: space.lg, paddingBottom: 26 },
  author: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: radius.full },
  media: { width: "100%", aspectRatio: 1, borderRadius: radius.sm },
  divider: { height: 1, backgroundColor: color.filet, marginHorizontal: space.lg, marginBottom: 26 },
  footerLoader: { paddingVertical: space.lg },
});
