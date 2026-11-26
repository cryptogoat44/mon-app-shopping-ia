import { useEffect, useReducer, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { CollectionSummary, Post } from "@monapp/shared-types";
import { ApiError, reactToPost, savePost, unsavePost } from "@/lib/api";
import { likeCountOpensList, likesListRoute } from "@/lib/member-lists";
import { openMerchantLink } from "@/lib/merchant-links";
import { color, font, radius, space } from "@/theme/tokens";
import { BookmarkIcon, CommentIcon, HeartIcon, MoreIcon, SendIcon, ShareIcon, TaggedPeopleIcon, VerifiedIcon } from "@/components/icons";
import { sharePost } from "@/lib/share-post";
import { sendPostHref } from "@/lib/send-post";
import { useMessagesStatus } from "@/lib/use-messages-status";
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
import { peopleShown, photosOf } from "@/lib/post-extras";
import { useAuth } from "@/lib/auth-context";
import { SavePostSheet } from "@/components/save-post-sheet";
import { bookmarkA11y, bookmarkShown, bookmarkTapAction, filedMessage, saveReducer, saveRequestCollection, saveStateOf, type SaveState } from "@/lib/saved-posts";

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
  // Lot « messages, plus de confort » : « Envoyer dans un message », seulement
  // si le serveur sait envoyer une publication (migration 0044).
  const canSendInMessage = useMessagesStatus().actions === true;
  const [reactionCount, setReactionCount] = useState(post.reactionCount);
  const [reacted, setReacted] = useState(post.viewerHasReacted);
  const [busy, setBusy] = useState(false);
  const lastTapRef = useRef(0);
  const heartPop = useRef(new Animated.Value(0)).current;
  // Plusieurs photos, personnes identifiées (migration 0047) : absents d'un serveur sans elles.
  const { session } = useAuth();
  const photos = photosOf(post);
  // Les personnes se relisent dans la publication à chaque affichage (fil
  // relu, visibilité changée : le serveur a pu en retirer) ; seuls les
  // retraits faits ici restent en mémoire. Une identification retirée ne
  // revient jamais du serveur.
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const people = peopleShown(post, removedIds);
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Publications enregistrées (migration 0048) : le signet, absent d'un serveur sans elles.
  const withBookmark = bookmarkShown(post);
  const [saveState, dispatchSave] = useReducer(saveReducer, post, saveStateOf);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  // La carte reste à l'écran quand le fil se relit (même clé) : le signet se
  // recale sur ce que le serveur dit maintenant (enregistrée ou rangée sur un
  // autre écran), sauf pendant une demande, dont la réponse fait foi.
  useEffect(() => {
    if (!saveBusy) dispatchSave({ type: "synced", state: saveStateOf(post) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.viewerHasSaved, post.viewerSavedCollectionId]);

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

  /** Un geste sur le signet : affiché tout de suite, confirmé par le serveur,
   * annulé (avec la phrase du serveur) s'il refuse. */
  async function changeSave(action: "save" | "unsave" | { collectionId: string | null }, collections: readonly CollectionSummary[] | null = null) {
    if (saveBusy) return;
    const before: SaveState = saveState;
    setSaveBusy(true);
    if (action === "save") dispatchSave({ type: "save" });
    else if (action === "unsave") dispatchSave({ type: "unsave" });
    else dispatchSave({ type: "file", collectionId: action.collectionId });
    if (action !== "unsave") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      if (action === "unsave") {
        await unsavePost(post.id);
        showToast(t.savedPosts.removed);
      } else {
        const result = await savePost(post.id, saveRequestCollection(action), { firstSave: !before.saved });
        dispatchSave({ type: "confirmed", state: { saved: true, collectionId: result.collectionId } });
        showToast(action === "save" ? t.savedPosts.saved : filedMessage(result.collectionId, collections));
      }
      setSaveSheetOpen(false);
    } catch (e) {
      dispatchSave({ type: "rollback", state: before });
      showToast(e instanceof ApiError ? e.message : action === "unsave" ? t.savedPosts.unsaveError : t.savedPosts.saveError);
    } finally {
      setSaveBusy(false);
    }
  }

  function handleBookmarkPress() {
    if (bookmarkTapAction(saveState) === "openSheet") setSaveSheetOpen(true);
    else void changeSave("save");
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
        {/* Envoyer cette publication dans un message : le choix de la conversation,
            puis la conversation avec la publication jointe. La personne qui la
            reçoit ne la voit que si elle a le droit de la voir (jamais proposé
            pour une publication que vous seul pouvez voir). */}
        {canSendInMessage && post.privacy !== "private" ? (
          <Pressable
            onPress={() => router.push(sendPostHref(post.id))}
            style={styles.reactRow}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t.messageActions.sendPost}
            testID="envoyer-publication"
          >
            <SendIcon size={19} />
          </Pressable>
        ) : null}
        {/* Publications enregistrées (migration 0048) : le signet, au bout de la
            rangée. Pas enregistrée : le toucher l'enregistre ; enregistrée : il
            ouvre les choix (ranger, retirer). L'appui long les ouvre aussi (iPhone). */}
        {withBookmark ? (
          <Pressable
            onPress={handleBookmarkPress}
            onLongPress={() => setSaveSheetOpen(true)}
            disabled={saveBusy}
            style={styles.bookmarkButton}
            accessibilityRole="button"
            accessibilityLabel={bookmarkA11y(saveState).label}
            accessibilityHint={bookmarkA11y(saveState).hint}
            accessibilityState={{ selected: saveState.saved, disabled: saveBusy }}
            // VoiceOver : « Ranger » ouvre les choix, comme l'appui long, même avant d'enregistrer.
            accessibilityActions={[{ name: "file", label: t.savedPosts.file }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "file") setSaveSheetOpen(true);
            }}
            testID="bouton-enregistrer"
          >
            <BookmarkIcon size={19} tint={saveState.saved ? color.encre : color.acier} filled={saveState.saved} />
          </Pressable>
        ) : null}
      </View>
      {withBookmark ? (
        <SavePostSheet
          visible={saveSheetOpen}
          state={saveState}
          busy={saveBusy}
          onClose={() => setSaveSheetOpen(false)}
          onChoose={(collectionId, collections) => void changeSave({ collectionId }, collections)}
          onRemove={() => void changeSave("unsave")}
        />
      ) : null}
      {people.length > 0 ? (
        <TaggedPeopleSheet
          postId={post.id}
          people={people}
          visible={peopleOpen}
          viewerId={session?.user.id ?? null}
          onClose={() => setPeopleOpen(false)}
          onRemoved={(userId) => setRemovedIds((ids) => [...ids, userId])}
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
  media: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.piece, borderCurve: "continuous", overflow: "hidden" },
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
  // Le signet : une cible de 44 points par le remplissage (le site ignore
  // « hitSlop »), qui déborde dans la marge de droite de la publication ; les
  // marges négatives gardent l'icône et la rangée à leur place.
  bookmarkButton: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center", paddingRight: 12, marginRight: -12, marginVertical: -6, marginLeft: -space.sm },
  reactCount: { fontSize: font.secondary, color: color.acier },
  authorLink: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
}));
