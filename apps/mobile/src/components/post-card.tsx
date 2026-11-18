import { useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { Post } from "@monapp/shared-types";
import { ApiError, reactToPost } from "@/lib/api";
import { likeCountOpensList, likesListRoute } from "@/lib/member-lists";
import { openMerchantLink } from "@/lib/merchant-links";
import { color, font, radius, space } from "@/theme/tokens";
import { CommentIcon, HeartIcon, MoreIcon, ShareIcon, TaggedPeopleIcon, VerifiedIcon } from "@/components/icons";
import { sharePost } from "@/lib/share-post";
import { SpotImage } from "@/components/spot-image";
import { ProductFrame } from "@/components/product-frame";
import { ImageUnavailable } from "@/components/image-unavailable";
import { showsProductPicture } from "@/lib/post-media";
import { useToast } from "@/lib/toast-context";
import { getActiveLocale, t } from "@/i18n";
import { formatPrice, timeAgo } from "@/lib/format";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { AffiliateMention } from "@/components/affiliate-mention";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";
import { PostCarousel } from "@/components/post-carousel";
import { TaggedPeopleSheet } from "@/components/tagged-people-sheet";
import { peopleOf, photosOf } from "@/lib/post-extras";
import { useAuth } from "@/lib/auth-context";

const DOUBLE_TAP_DELAY_MS = 300;

function mediaLabel(post: Post): string {
  const label = post.type === "wish" ? t.post.wishBy(post.author.displayName) : t.post.photoBy(post.author.displayName);
  return post.mediaUrl === null ? `${label}. ${t.common.imageUnavailable}` : label;
}

/** Image d'une pièce (envie republiée : notre copie ; « achat » venu du
 * Spotter : image HD du marchand, repli sur la miniature) : entière, dans le
 * cadre 4:5 de l'écran d'une envie. Photo de la personne : version
 * d'affichage (1 600 px), carré pleine largeur. Image retirée par la
 * modération (lot 5, partie B) : « Image indisponible », même cadre. */
function PostMedia({ post }: { post: Post }) {
  if (post.mediaUrl === null) return <ImageUnavailable variant="frame" accessible={false} />;
  if (showsProductPicture(post)) return <ProductFrame hdUri={post.mediaHdUrl} fallbackUri={post.mediaUrl} recyclingKey={post.id} />;
  return <SpotImage hdUri={post.mediaHdUrl} fallbackUri={post.mediaUrl} style={styles.media} fit="cover" recyclingKey={post.id} />;
}

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
  const router = useRouter();
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [reacted, setReacted] = useState(post.viewerHasReacted);
  const [busy, setBusy] = useState(false);
  const lastTapRef = useRef(0);
  const heartPop = useRef(new Animated.Value(0)).current;
  // Plusieurs photos, personnes identifiées (migration 0047) : absents d'un serveur sans elles.
  const { session } = useAuth();
  const photos = photosOf(post);
  const [people, setPeople] = useState(() => peopleOf(post));
  const [peopleOpen, setPeopleOpen] = useState(false);

  /** Trop de « j'aime » en peu de temps (429) : le serveur le dit, l'app le répète. */
  function tooManyLikes(e: unknown) {
    if (e instanceof ApiError && e.status === 429) showToast(e.message);
  }

  async function like() {
    if (reacted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setReacted(true);
    setReactionCount((c) => c + 1);
    try {
      const result = await reactToPost(post.id);
      setReacted(result.viewerHasReacted);
      setReactionCount(result.reactionCount);
    } catch (e) {
      setReacted(false);
      setReactionCount((c) => c - 1);
      tooManyLikes(e);
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
    } catch (e) {
      setReacted(post.viewerHasReacted);
      setReactionCount(post.reactionCount);
      tooManyLikes(e);
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
          accessibilityLabel={onPressAuthor ? t.common.viewProfile(post.author.displayName) : undefined}
        >
          <Avatar uri={post.author.avatarUrl} userId={post.author.id} displayName={post.author.displayName} username={post.author.username} size={32} />
          <Text style={styles.authorName}>{post.author.displayName}</Text>
        </Pressable>
        {/* Badge « achat vérifié » : jamais sur une envie (lot 5). */}
        {post.type !== "wish" && post.vaultItem?.verified ? <VerifiedIcon size={13} /> : null}
        <Text style={styles.timestamp}>{timeAgo(post.createdAt, getActiveLocale())}</Text>
        {onOpenMenu ? (
          <Pressable onPress={onOpenMenu} hitSlop={11} style={styles.moreButton} accessibilityRole="button" accessibilityLabel={t.common.moreOptions}>
            <MoreIcon size={18} tint={color.acier} />
          </Pressable>
        ) : null}
      </View>

      <View>
      {photos.length > 1 ? (
        <PostCarousel photos={photos} label={mediaLabel(post)} recyclingKey={post.id} onPress={handleMediaPress} />
      ) : (
      <Pressable
        onPress={handleMediaPress}
        accessibilityRole="image"
        accessibilityLabel={mediaLabel(post)}
      >
        <PostMedia post={post} />
      </Pressable>
      )}
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
          <HeartIcon size={64} tint={color.surImage} filled />
        </Animated.View>
        {/* Personnes identifiées : une icône posée sur la photo, qui ouvre la liste (la rangée des actions ne change pas). */}
        {people.length > 0 ? (
          <Pressable
            onPress={() => setPeopleOpen(true)}
            style={styles.peopleButton}
            accessibilityRole="button"
            accessibilityLabel={t.carousel.showPeople(people.length)}
            testID="personnes-identifiees"
          >
            <View style={styles.peopleBadge}>
              <TaggedPeopleIcon size={15} />
            </View>
          </Pressable>
        ) : null}
      </View>

      {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

      {/* Publication « envie » (lot 5) : une pièce qu'on aimerait avoir,
          distincte d'un achat. Lien marchand ; la mention « lien affilié »
          est affichée par le bouton lui-même. */}
      {post.wish ? (
        <View style={styles.wishBox} testID="publication-envie">
          <Text style={styles.wishLabel}>{t.post.wishLabel}</Text>
          <Text style={styles.wishTitle}>{post.wish.title}</Text>
          {post.wish.merchantName || post.wish.priceMin !== null ? (
            <Text style={styles.wishMeta}>
              {[post.wish.merchantName, post.wish.priceMin !== null ? formatPrice(post.wish.priceMin, post.wish.currency, getActiveLocale()) : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          {post.wish.merchantUrl ? (
            <MerchantLinkButton
              url={post.wish.merchantUrl}
              merchantName={post.wish.merchantName}
              matchId={post.wish.productMatchId}
              context="post"
              isAffiliate={post.wish.isAffiliate}
              compact
            />
          ) : null}
        </View>
      ) : null}

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
                accessibilityLabel={[
                  piece.merchantName ? t.post.viewPieceAt(piece.productName, piece.merchantName) : piece.productName,
                  piece.isAffiliate ? t.result.affiliateDisclosure : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                {/* Pièce taguée : la pastille ouvre la boutique, la mention « Lien affilié » s'écrit dedans. */}
                <Text style={styles.tagChipLabel}>
                  {piece.productName}
                  <AffiliateMention isAffiliate={piece.isAffiliate} inline />
                </Text>
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
        {/* Le cœur aime ou n'aime plus ; le nombre, à côté, ouvre la liste
            « Aimé par » (lot « vie sociale »). À zéro : un simple texte, dans
            le bouton du cœur — le toucher aime, comme avant. */}
        <View style={styles.likeGroup}>
          <Pressable
            onPress={handleReactButton}
            disabled={busy}
            style={[styles.likeButton, likeCountOpensList(reactionCount) ? styles.likeButtonBeforeCount : styles.likeButtonAlone]}
            accessibilityRole="button"
            accessibilityLabel={reacted ? t.post.unlike : t.post.like}
            testID="bouton-jaime"
          >
            <HeartIcon size={19} tint={reacted ? color.encre : color.acier} filled={reacted} />
            {likeCountOpensList(reactionCount) ? null : <Text style={styles.reactCount}>{reactionCount}</Text>}
          </Pressable>
          {likeCountOpensList(reactionCount) ? (
            <Pressable
              onPress={() => router.push(likesListRoute(post.id, reactionCount))}
              style={styles.likeCount}
              accessibilityRole="link"
              accessibilityLabel={t.memberLists.openLikes(reactionCount)}
              testID="nombre-jaime"
            >
              <Text style={styles.reactCount}>{reactionCount}</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={onOpenComments}
          disabled={!onOpenComments}
          style={styles.reactRow}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.comments.countLabel(commentCount ?? post.commentCount)}
        >
          <CommentIcon size={19} />
          <Text style={styles.reactCount}>{commentCount ?? post.commentCount}</Text>
        </Pressable>
        <Pressable
          onPress={async () => {
            const outcome = await sharePost(post);
            if (outcome === "copied") showToast(t.comments.linkCopied);
          }}
          style={[styles.reactRow, styles.shareButton]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.comments.share}
        >
          <ShareIcon size={19} />
        </Pressable>
      </View>
      {people.length > 0 ? (
        <TaggedPeopleSheet
          postId={post.id}
          people={people}
          visible={peopleOpen}
          viewerId={session?.user.id ?? null}
          onClose={() => setPeopleOpen(false)}
          onRemoved={(userId) => setPeople((current) => current.filter((person) => person.id !== userId))}
        />
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  post: { paddingHorizontal: space.lg, paddingBottom: 26 },
  author: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  authorName: { fontSize: 14, fontWeight: "600", color: color.encre },
  timestamp: { fontSize: 12, color: color.acier, marginLeft: "auto" },
  moreButton: { marginLeft: space.xs, padding: 2 },
  media: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm },
  heartOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  // Cible de 44 points, l'icône de 28 dans le coin bas gauche de la photo.
  peopleButton: { position: "absolute", left: 0, bottom: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  peopleBadge: { width: 28, height: 28, borderRadius: radius.full, backgroundColor: color.voileImage, alignItems: "center", justifyContent: "center" },
  caption: { fontSize: 14.5, color: color.encre, marginTop: 12, lineHeight: 20 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  wishBox: { marginTop: 12, gap: 2 },
  wishLabel: { alignSelf: "flex-start", fontSize: 11.5, fontWeight: "600", color: color.acier, borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 2, marginBottom: 4 },
  wishTitle: { fontSize: 14.5, fontWeight: "600", color: color.encre },
  wishMeta: { fontSize: font.caption, color: color.acier },
  tagChip: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 5, paddingHorizontal: 11 },
  tagChipLabel: { fontSize: font.caption, color: color.encre },
  actions: { flexDirection: "row", alignItems: "center", gap: space.lg, marginTop: 12 },
  reactRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
  likeGroup: { flexDirection: "row", alignItems: "center" },
  // Le cœur : une cible de 44 points au moins, par le remplissage (pas par
  // « hitSlop », que le site ignore). Elle s'étend vers la gauche, dans la
  // marge de la publication (24), et couvre les 6 points jusqu'au nombre :
  // 19 + 19 (l'icône) + 6 = 44. Les marges négatives gardent l'icône, la
  // rangée (32 de haut) et les écarts à leur place.
  likeButton: { flexDirection: "row", alignItems: "center", minHeight: 44, minWidth: 44, paddingLeft: 19, marginLeft: -19, marginVertical: -6 },
  likeButtonBeforeCount: { paddingRight: 6 },
  // À zéro, le nombre est dans le bouton : le toucher aime.
  likeButtonAlone: { gap: 6, paddingRight: 12, marginRight: -12 },
  // Cible de 44 points de haut par le remplissage, sans grossir le texte.
  likeCount: { minHeight: 44, paddingRight: 12, marginVertical: -6, marginRight: -12, justifyContent: "center" },
  shareButton: { marginLeft: "auto" },
  reactCount: { fontSize: font.secondary, color: color.acier },
  authorLink: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
}));
