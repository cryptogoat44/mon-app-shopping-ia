import { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import type { Post } from "@monapp/shared-types";
import { reactToPost } from "@/lib/api";
import { openMerchantLink } from "@/lib/merchant-links";
import { color, font, radius, space } from "@/theme/tokens";
import { CommentIcon, HeartIcon, MoreIcon, PersonIcon, ShareIcon, VerifiedIcon } from "@/components/icons";
import { sharePost } from "@/lib/share-post";
import { SpotImage } from "@/components/spot-image";
import { useToast } from "@/lib/toast-context";
import { fr } from "@/i18n/fr";
import { timeAgo } from "@/lib/time";

const DOUBLE_TAP_DELAY_MS = 300;

// Une publication (fil, détail, profil d'un utilisateur). Le nom et la
// photo de l'auteur ouvrent son profil quand `onPressAuthor` est fourni.
export function PostCard({
  post,
  onOpenMenu,
  onPressAuthor,
  onOpenComments,
  commentCount,
}: {
  post: Post;
  onOpenMenu?: () => void;
  onPressAuthor?: () => void;
  /** Ouvre la publication et ses commentaires (absent : déjà dessus). */
  onOpenComments?: () => void;
  /** Nombre à afficher quand l'écran le tient à jour lui-même. */
  commentCount?: number;
}) {
  const { showToast } = useToast();
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [reacted, setReacted] = useState(post.viewerHasReacted);
  const [busy, setBusy] = useState(false);
  const lastTapRef = useRef(0);
  const heartPop = useRef(new Animated.Value(0)).current;

  async function like() {
    if (reacted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setReacted(true);
    setReactionCount((c) => c + 1);
    try {
      const result = await reactToPost(post.id);
      setReacted(result.viewerHasReacted);
      setReactionCount(result.reactionCount);
    } catch {
      setReacted(false);
      setReactionCount((c) => c - 1);
    }
  }

  async function handleReactButton() {
    setBusy(true);
    if (!reacted) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  function handleMediaPress() {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_DELAY_MS) {
      like();
      heartPop.setValue(0);
      Animated.sequence([
        Animated.spring(heartPop, { toValue: 1, useNativeDriver: true, friction: 4 }),
        Animated.timing(heartPop, { toValue: 0, duration: 220, delay: 300, useNativeDriver: true }),
      ]).start();
    }
    lastTapRef.current = now;
  }

  return (
    <View style={styles.post}>
      <View style={styles.author}>
        <Pressable
          onPress={onPressAuthor}
          disabled={!onPressAuthor}
          style={styles.authorLink}
          accessibilityRole={onPressAuthor ? "link" : undefined}
          accessibilityLabel={onPressAuthor ? `Voir le profil de ${post.author.displayName}` : undefined}
        >
          <View style={styles.avatar}>
            {post.author.avatarUrl ? (
              <Image source={{ uri: post.author.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <PersonIcon size={16} tint={color.acier} />
            )}
          </View>
          <Text style={styles.authorName}>{post.author.displayName}</Text>
        </Pressable>
        {post.vaultItem?.verified ? <VerifiedIcon size={13} /> : null}
        <Text style={styles.timestamp}>{timeAgo(post.createdAt)}</Text>
        {onOpenMenu ? (
          <Pressable onPress={onOpenMenu} hitSlop={11} style={styles.moreButton} accessibilityRole="button" accessibilityLabel="Plus d'options">
            <MoreIcon size={18} tint={color.acier} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={handleMediaPress}
        accessibilityRole="image"
        accessibilityLabel={`Photo publiée par ${post.author.displayName}`}
      >
        {/* « Achat » venu du Spotter : image HD du marchand, repli sur la
            miniature ; photo publiée : version d'affichage (1 600 px). */}
        <SpotImage hdUri={post.mediaHdUrl} fallbackUri={post.mediaUrl} style={styles.media} fit="cover" recyclingKey={post.id} />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.heartOverlay,
            {
              opacity: heartPop,
              transform: [{ scale: heartPop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] }) }],
            },
          ]}
        >
          <HeartIcon size={64} tint={color.blanc} filled />
        </Animated.View>
      </Pressable>

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

      {post.taggedPieces.length > 0 ? (
        <View style={styles.tagRow}>
          {post.taggedPieces.map((piece) =>
            piece.merchantUrl ? (
              <Pressable
                key={piece.id}
                style={styles.tagChip}
                hitSlop={{ top: 9, bottom: 9 }}
                onPress={() =>
                  openMerchantLink({ matchId: piece.productMatchId, url: piece.merchantUrl!, context: "post" })
                }
                accessibilityRole="button"
                accessibilityLabel={
                  piece.merchantName ? `Voir ${piece.productName} chez ${piece.merchantName}` : piece.productName
                }
              >
                <Text style={styles.tagChipLabel}>{piece.productName}</Text>
              </Pressable>
            ) : (
              <View key={piece.id} style={styles.tagChip}>
                <Text style={styles.tagChipLabel}>{piece.productName}</Text>
              </View>
            )
          )}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={handleReactButton}
          disabled={busy}
          style={styles.reactRow}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={reacted ? "Je n'aime plus" : "Aimer"}
        >
          <HeartIcon size={19} tint={reacted ? color.encre : color.acier} filled={reacted} />
          <Text style={styles.reactCount}>{reactionCount}</Text>
        </Pressable>
        <Pressable
          onPress={onOpenComments}
          disabled={!onOpenComments}
          style={styles.reactRow}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={fr.comments.countLabel(commentCount ?? post.commentCount)}
        >
          <CommentIcon size={19} />
          <Text style={styles.reactCount}>{commentCount ?? post.commentCount}</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            const outcome = await sharePost(post);
            if (outcome === "copied") showToast(fr.comments.linkCopied);
          }}
          style={[styles.reactRow, styles.shareButton]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={fr.comments.share}
        >
          <ShareIcon size={19} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  post: { paddingHorizontal: space.lg, paddingBottom: 26 },
  author: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  authorName: { fontSize: 14, fontWeight: "600", color: color.encre },
  timestamp: { fontSize: 12, color: color.acier, marginLeft: "auto" },
  moreButton: { marginLeft: space.xs, padding: 2 },
  media: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm },
  heartOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  caption: { fontSize: 14.5, color: color.encre, marginTop: 12, lineHeight: 20 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  tagChip: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 5, paddingHorizontal: 11 },
  tagChipLabel: { fontSize: font.caption, color: color.encre },
  actions: { flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: 12 },
  reactRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  shareButton: { marginLeft: "auto" },
  reactCount: { fontSize: font.secondary, color: color.acier },
  authorLink: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
});
