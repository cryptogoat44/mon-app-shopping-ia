import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, fetchFeed, reactToPost } from "@/lib/api";
import { theme } from "@/lib/theme";

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function PostCard({ post }: { post: Post }) {
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [reacted, setReacted] = useState(post.viewerHasReacted);
  const [busy, setBusy] = useState(false);

  async function handleReact() {
    setBusy(true);
    // Mise à jour optimiste — plus réactif pour un simple like.
    setReacted((r) => !r);
    setReactionCount((c) => c + (reacted ? -1 : 1));
    try {
      const result = await reactToPost(post.id);
      setReacted(result.viewerHasReacted);
      setReactionCount(result.reactionCount);
    } catch {
      setReacted(post.viewerHasReacted);
      setReactionCount(post.reactionCount);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar} />
        <View style={styles.cardHeaderText}>
          <Text style={styles.authorName}>{post.author.displayName}</Text>
          <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
        </View>
        {post.vaultItem?.verified ? (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedBadgeText}>Achat vérifié</Text>
          </View>
        ) : null}
      </View>

      <Image source={{ uri: post.mediaUrl }} style={styles.cardImage} contentFit="cover" />

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

      <Pressable onPress={handleReact} disabled={busy} style={styles.reactRow} hitSlop={8}>
        <Text style={[styles.reactIcon, reacted ? styles.reactIconActive : null]}>{reacted ? "♥" : "♡"}</Text>
        <Text style={styles.reactCount}>{reactionCount}</Text>
      </Pressable>
    </View>
  );
}

export default function FeedScreen() {
  const router = useRouter();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchFeed()
        .then((data) => {
          if (!cancelled) setPosts(data);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof ApiError ? e.message : "Impossible de charger le fil.");
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Fil</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => router.push("/people-search")} hitSlop={8}>
            <Text style={styles.headerLink}>Profils</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/post-item/new")} hitSlop={8}>
            <Text style={styles.headerLink}>+ Publier</Text>
          </Pressable>
        </View>
      </View>

      {posts === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.color.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {posts?.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Votre fil est vide. Suivez des profils pour voir leurs achats et leurs publications ici.
              </Text>
              <Pressable onPress={() => router.push("/people-search")}>
                <Text style={styles.emptyLink}>Rechercher des profils →</Text>
              </Pressable>
            </View>
          ) : null}

          {posts?.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  title: { fontSize: theme.font.title, fontWeight: "700", color: theme.color.ink },
  headerActions: { flexDirection: "row", gap: theme.space.lg },
  headerLink: { fontSize: theme.font.small, color: theme.color.accentInk, fontWeight: "600" },
  content: { padding: theme.space.lg, paddingTop: theme.space.sm, maxWidth: 480, alignSelf: "center", width: "100%" },
  errorBanner: {
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  errorText: { color: theme.color.danger, fontSize: theme.font.small },
  empty: { alignItems: "center", marginTop: theme.space.xl },
  emptyText: { fontSize: theme.font.body, color: theme.color.muted, textAlign: "center", marginBottom: theme.space.md },
  emptyLink: { fontSize: theme.font.small, color: theme.color.accentInk, fontWeight: "600" },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.lg,
    marginBottom: theme.space.md,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.space.sm,
    gap: theme.space.sm,
  },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.line },
  cardHeaderText: { flex: 1 },
  authorName: { fontSize: theme.font.small, fontWeight: "700", color: theme.color.ink },
  timestamp: { fontSize: 11, color: theme.color.muted },
  verifiedBadge: { backgroundColor: theme.color.verifiedSoft, borderRadius: 100, paddingHorizontal: 8, paddingVertical: 2 },
  verifiedBadgeText: { color: theme.color.verified, fontSize: 10, fontWeight: "700" },
  cardImage: { width: "100%", aspectRatio: 1, backgroundColor: theme.color.line },
  caption: { fontSize: theme.font.small, color: theme.color.ink, padding: theme.space.sm, paddingBottom: 0 },
  reactRow: { flexDirection: "row", alignItems: "center", gap: 6, padding: theme.space.sm },
  reactIcon: { fontSize: 18, color: theme.color.muted },
  reactIconActive: { color: theme.color.danger },
  reactCount: { fontSize: theme.font.small, color: theme.color.muted },
});
