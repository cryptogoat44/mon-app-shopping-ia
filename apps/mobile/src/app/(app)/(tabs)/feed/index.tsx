import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, fetchFeed, reactToPost } from "@/lib/api";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { HeartIcon, PersonIcon, VerifiedIcon } from "@/components/icons";

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

function PostRow({ post }: { post: Post }) {
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [reacted, setReacted] = useState(post.viewerHasReacted);
  const [busy, setBusy] = useState(false);

  async function handleReact() {
    setBusy(true);
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
    <View style={styles.post}>
      <View style={styles.author}>
        <View style={styles.avatar}>
          <PersonIcon size={16} tint={color.acier} />
        </View>
        <Text style={styles.authorName}>{post.author.displayName}</Text>
        {post.vaultItem?.verified ? <VerifiedIcon size={13} /> : null}
        <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
      </View>

      <Image source={{ uri: post.mediaUrl }} style={styles.media} contentFit="cover" />

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

      <Pressable onPress={handleReact} disabled={busy} style={styles.reactRow} hitSlop={8}>
        <HeartIcon size={19} tint={reacted ? color.encre : color.acier} filled={reacted} />
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
          if (!cancelled) {
            setPosts(data);
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

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Fil</Text>
        <Pressable onPress={() => router.push("/people-search")} hitSlop={8}>
          <Text style={styles.headerLink}>Profils</Text>
        </Pressable>
      </View>

      {posts === null && !error ? (
        <View style={styles.centered}>
          <ActivityIndicator color={color.encre} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {posts?.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                Votre fil est vide. Suivez des profils pour voir leurs achats et leurs publications ici.
              </Text>
              <Pressable onPress={() => router.push("/people-search")}>
                <Text style={styles.emptyLink}>Rechercher des profils</Text>
              </Pressable>
            </View>
          ) : null}

          {posts?.map((post, index) => (
            <View key={post.id}>
              <PostRow post={post} />
              {index < posts.length - 1 ? <View style={styles.divider} /> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  headerLink: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
  content: { paddingTop: space.sm, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  errorText: { color: color.acier, fontSize: font.secondary, paddingHorizontal: space.lg, marginBottom: space.md },
  empty: { alignItems: "center", marginTop: space.xl, paddingHorizontal: space.lg },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginBottom: space.md, lineHeight: 20 },
  emptyLink: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  post: { paddingHorizontal: space.lg, paddingBottom: 26 },
  author: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 32, height: 32, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center" },
  authorName: { fontSize: 14, fontWeight: "600", color: color.encre },
  timestamp: { fontSize: 12, color: color.acier, marginLeft: "auto" },
  media: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm },
  caption: { fontSize: 14.5, color: color.encre, marginTop: 12, lineHeight: 20 },
  reactRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  reactCount: { fontSize: font.secondary, color: color.acier },
  divider: { height: 1, backgroundColor: color.filet, marginHorizontal: space.lg, marginBottom: 26 },
});
