import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { MESSAGE_COUNTER_FROM, MESSAGE_MAX_LENGTH, type ChatMessage, type ConversationThread } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { getActiveLocale, t } from "@/i18n";
import {
  ApiError,
  acceptInvitation,
  declineInvitation,
  deleteMessage,
  fetchConversation,
  fetchCollectionItem,
  fetchConversationWith,
  fetchMessagesStatus,
  fetchPost,
  fetchWishlistItem,
  markConversationRead,
  sendMessage,
  setMessageReaction,
} from "@/lib/api";
import {
  applyChanges,
  attachedLabels,
  attachmentFor,
  canSend,
  canWrite,
  composerNotice,
  hasNewFromOther,
  likeLabel,
  mergeMessages,
  messageActionsFor,
  newestCreatedAt,
  nextSyncedAt,
  quoteText,
  replyTargetOf,
  withLike,
  withoutContent,
  type MessageAction,
  type ReplyTarget,
} from "@/lib/conversations";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { readReadReceipts, receiptMention, sameReceipts, threadAfterPoll, threadAfterSend, withReadReceipts } from "@/lib/read-receipts";
import { afterSheetClose } from "@/lib/after-sheet-close";
import { track } from "@/lib/analytics";
import { forgetPieceToSend, pieceToSend } from "@/lib/send-to-friend";
import { timeAgo } from "@/lib/format";
import { loadErrorMessage } from "@/lib/load-error";
import { useToast } from "@/lib/toast-context";
import { usePolling } from "@/lib/use-polling";
import { HeartIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { ImageUnavailable } from "@/components/image-unavailable";
import { MessageActionsSheet } from "@/components/message-actions-sheet";
import { MessagePostCard } from "@/components/message-post-card";
import { MessageWishCard } from "@/components/message-wish-card";
import { ReportBlockMenu } from "@/components/report-block-menu";
import { SpotImage } from "@/components/spot-image";
import { WishPicker, type PickedWish } from "@/components/wish-picker";
import { usePushOffer } from "@/components/push-offer-sheet";
import { setOpenConversation } from "@/lib/push-state";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

/** Deux appuis en moins de ce délai : « j'aime » (comme sur une publication). */
const DOUBLE_TAP_DELAY_MS = 300;

// Un message. Lot « messages, plus de confort » : le message cité, la
// publication envoyée, un cœur sous la bulle quand il est aimé, la ligne
// « Message supprimé ». Deux appuis : « j'aime ». « ••• » et l'appui long
// ouvrent les actions du message (`onOptions`) : toujours pour un message
// reçu (signaler, bloquer), et pour un des vôtres quand il y a quelque chose
// à faire (`ownActions` : aimer, répondre, supprimer).
function Bubble({
  message,
  otherName,
  ownActions,
  onOptions,
  onLike,
  onOpenPost,
}: {
  message: ChatMessage;
  otherName: string;
  ownActions: boolean;
  onOptions: () => void;
  /** Absent : ce message ne peut pas être aimé (déjà aimé, supprimé, invitation, serveur plus ancien). */
  onLike?: () => void;
  onOpenPost: (postId: string) => void;
}) {
  const lastTap = useRef(0);
  const liked = likeLabel(message, otherName);
  const quote = message.replyTo ?? null;

  function handlePress() {
    const now = Date.now();
    if (onLike && now - lastTap.current < DOUBLE_TAP_DELAY_MS) onLike();
    lastTap.current = now;
  }

  return (
    <View>
      <View style={[styles.bubbleRow, message.mine ? styles.rowMine : styles.rowTheirs]} testID={`message-${message.id}`}>
        {/* Ses propres messages : le même bouton, quand il y a une action à proposer. */}
        {message.mine && ownActions ? (
          <Pressable
            onPress={onOptions}
            hitSlop={10}
            style={styles.bubbleMore}
            testID={`message-options-${message.id}`}
            accessibilityRole="button"
            accessibilityLabel={t.messages.messageOptions}
            accessibilityHint={t.messageActions.optionsHint}
          >
            <MoreIcon size={16} tint={color.acier} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={handlePress}
          onLongPress={message.mine && !ownActions ? undefined : onOptions}
          style={[styles.bubble, message.mine ? styles.bubbleMine : styles.bubbleTheirs]}
          accessible
        >
          {message.deleted ? (
            <Text style={[styles.bubbleDeleted, message.mine ? styles.bubbleTextMine : null]}>{t.messageActions.deleted}</Text>
          ) : (
            <>
              {quote ? (
                <View style={[styles.quote, message.mine ? styles.quoteMine : null]} testID="message-cite">
                  {quote.kind === "unavailable" ? null : (
                    <Text style={[styles.quoteWho, message.mine ? styles.bubbleTextMine : null]} numberOfLines={1}>
                      {quote.mine ? t.messageActions.quoteFromYou : otherName}
                    </Text>
                  )}
                  <Text style={[styles.quoteText, message.mine ? styles.bubbleTextMine : null]} numberOfLines={2}>
                    {quoteText(quote)}
                  </Text>
                </View>
              ) : null}
              {message.post ? <MessagePostCard card={message.post} onOpen={onOpenPost} /> : null}
              {message.wish ? <MessageWishCard card={message.wish} mine={message.mine} /> : null}
              {message.text ? <Text style={[styles.bubbleText, message.mine ? styles.bubbleTextMine : null]}>{message.text}</Text> : null}
            </>
          )}
          <Text style={[styles.bubbleTime, message.mine ? styles.bubbleTimeMine : null]}>{timeAgo(message.createdAt, getActiveLocale())}</Text>
        </Pressable>
        {/* Signaler un message reçu : un bouton « ••• » toujours visible à côté
            du message (règle 1.2 d'Apple ; le site n'a pas d'appui long), en plus
            de l'appui long. Il ouvre les actions du message, dont « Signaler »
            et « Bloquer » ; sans autre action possible, le menu « Signaler ce
            message / Bloquer » directement. */}
        {message.mine ? null : (
          <Pressable
            onPress={onOptions}
            hitSlop={10}
            style={styles.bubbleMore}
            testID={`message-options-${message.id}`}
            accessibilityRole="button"
            accessibilityLabel={t.messages.messageOptions}
            accessibilityHint={t.messages.messageOptionsHint}
          >
            <MoreIcon size={16} tint={color.acier} />
          </Pressable>
        )}
      </View>
      {/* Aimé par vous, par l'autre membre, ou par les deux : un cœur sous la bulle, lu par VoiceOver. */}
      {liked ? (
        <View style={[styles.liked, message.mine ? styles.likedMine : styles.likedTheirs]} accessible accessibilityLabel={liked} testID={`message-aime-${message.id}`}>
          <HeartIcon size={13} tint={color.encre} filled />
          {message.liked?.mine && message.liked.theirs ? <HeartIcon size={13} tint={color.encre} filled /> : null}
        </View>
      ) : null}
    </View>
  );
}

// Une conversation (lot messages) : ouverte depuis la liste (`id`), depuis un
// profil (`userId`, la conversation peut ne pas exister encore) ou depuis une
// envie (`wishId`, jointe d'avance). Lot collections : « En parler » d'une
// envie d'une collection d'un ami (`userId` et `collectionItemId`, jointe d'avance). Relue toutes les 5 s environ tant que
// l'écran est ouvert ; marquée comme lue à l'ouverture et à chaque nouveau
// message. Une invitation reçue s'accepte, se refuse ou mène au blocage.
// « Envoyer à un ami » (écran Résultat) : une proposition d'une de vos
// recherches (`matchId`), jointe d'avance ; une fois envoyée, retour au
// résultat, laissé tel quel, avec une courte confirmation.
// Lot notifications (app iPhone) : après un message envoyé, ou un message
// reçu affiché, la feuille « Être prévenu de vos nouveaux messages ? » est
// proposée une fois ; une notification touchée ouvre cet écran avec `id`.
// Lot « messages vus » : sous votre dernier message, « Vu » quand l'autre
// membre a ouvert la conversation depuis, « Envoyé » sinon ; rien quand le
// serveur ne renvoie pas de confirmations (invitation, réglage éteint chez
// l'un des deux). Tenu à jour à chaque relecture (lib/read-receipts.ts).
// Lot « messages, plus de confort » : aimer un message (deux appuis, ou la
// feuille des actions), y répondre (barre « Réponse à … » au-dessus du
// champ), supprimer un des siens (confirmé), envoyer une publication
// (`postId`, jointe d'avance depuis le fil). Ces actions ne sont proposées
// que si le serveur les a (`actions` de l'état de la messagerie) ; chaque
// relecture rapporte aussi ce que l'autre membre a aimé ou supprimé.
export default function ConversationScreen() {
  const { id, userId, wishId, collectionItemId, matchId } = useLocalSearchParams<{
    id?: string;
    userId?: string;
    wishId?: string;
    collectionItemId?: string;
    matchId?: string;
  }>();
  // Lot « messages, plus de confort » : une publication du fil, jointe d'avance.
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const router = useRouter();
  const { showToast } = useToast();
  const [thread, setThread] = useState<ConversationThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "not_found" | "error">("loading");
  const [draft, setDraft] = useState("");
  const [wish, setWish] = useState<PickedWish | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  // Lot « messages, plus de confort » : la feuille des actions d'un message,
  // l'étape du menu « Signaler / Bloquer » quand elle lui passe la main, et
  // le message auquel on répond.
  const [sheetFor, setSheetFor] = useState<ChatMessage | null>(null);
  const [menuStep, setMenuStep] = useState<"root" | "report" | "confirmBlock">("root");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const actionsEnabled = useMessagesStatus().actions === true;
  // Date de la dernière réponse du serveur : il renvoie ce qui a changé depuis.
  const syncedAt = useRef<string | null>(null);
  const [profileMenu, setProfileMenu] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Lot notifications : proposées une fois, après un message envoyé ou reçu.
  const pushOffer = usePushOffer();
  const offerPush = pushOffer.offer;
  const messagesRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const stickToEnd = useRef(true);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const markRead = useCallback((conversationId: string) => {
    markConversationRead(conversationId)
      .then(() => fetchMessagesStatus())
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const data = id ? await fetchConversation(id) : userId ? await fetchConversationWith(userId) : null;
      if (!data) {
        setState("not_found");
        return;
      }
      stickToEnd.current = true;
      setThread(withReadReceipts(data));
      setMessages(data.messages);
      syncedAt.current = nextSyncedAt(null, data);
      setState("ready");
      if (data.id) markRead(data.id);
      if (data.messages.some((message) => !message.mine)) offerPush();
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? "not_found" : "error");
    }
  }, [id, userId, markRead, offerPush]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Envie jointe d'avance (« Envoyer dans une conversation », depuis une envie).
  useEffect(() => {
    if (!wishId) return;
    fetchWishlistItem(wishId)
      .then((item) => setWish({ id: item.id, title: item.title, imageUrl: item.imageUrl }))
      .catch(() => {});
  }, [wishId]);

  // « En parler » (lot collections) : l'envie de l'ami, avec la copie de son image.
  useEffect(() => {
    if (!collectionItemId) return;
    fetchCollectionItem(collectionItemId)
      .then((item) => setWish({ id: item.id, title: item.title, imageUrl: item.imageThumbUrl, kind: "collectionItem" }))
      .catch(() => {});
  }, [collectionItemId]);

  // « Envoyer à un ami » : la proposition, telle que l'écran Résultat la montrait
  // (gardée en mémoire ; page rechargée sur le site : un libellé sans image).
  useEffect(() => {
    if (!matchId) return;
    const piece = pieceToSend(matchId);
    setWish({ id: matchId, title: piece?.title ?? t.messages.attachedPieceFallback, imageUrl: piece?.imageUrl ?? null, kind: "match" });
  }, [matchId]);

  // Publication jointe d'avance (« Envoyer dans un message », depuis le fil) :
  // sa miniature et son auteur, si vous pouvez la voir ; sinon un simple libellé.
  useEffect(() => {
    if (!postId) return;
    setWish({ id: postId, title: t.messageActions.attachedPost, imageUrl: null, kind: "post" });
    fetchPost(postId)
      .then((post) =>
        setWish((current) =>
          current?.id === postId ? { id: postId, title: t.messageActions.attachedPostBy(post.author.displayName), imageUrl: post.mediaThumbUrl ?? post.mediaUrl, kind: "post" } : current
        )
      )
      .catch(() => {});
  }, [postId]);

  const poll = useCallback(async (): Promise<"new" | "same"> => {
    const conversationId = thread?.id;
    if (!conversationId) return "same";
    let data: ConversationThread;
    try {
      data = await fetchConversation(conversationId, { after: newestCreatedAt(messagesRef.current), changedSince: syncedAt.current });
    } catch (e) {
      // Conversation devenue introuvable (blocage, refus sur un autre appareil).
      if (e instanceof ApiError && e.status === 404) setState("not_found");
      throw e;
    }
    const before = messagesRef.current;
    const merged = mergeMessages(before, data.messages);
    // Ce que l'autre membre a aimé ou supprimé depuis la dernière relecture.
    const next = applyChanges(merged, data.changed);
    const touched = next !== merged;
    syncedAt.current = nextSyncedAt(syncedAt.current, data);
    const fresh = hasNewFromOther(before, merged);
    // « Vu » qui apparaît compte comme du nouveau : la relecture reste rapide.
    const receiptsChanged = !sameReceipts(thread?.readReceipts, readReadReceipts(data.readReceipts));
    const changed = merged.length !== before.length || touched || data.sendMode !== thread?.sendMode || data.state !== thread?.state || receiptsChanged;
    if (merged.length !== before.length) stickToEnd.current = true;
    if (merged.length !== before.length || touched) setMessages(next);
    setThread((current) => threadAfterPoll(current, data));
    if (fresh) {
      markRead(conversationId);
      offerPush();
    }
    return changed ? "new" : "same";
  }, [thread?.id, thread?.sendMode, thread?.state, thread?.readReceipts, markRead, offerPush]);
  const { kick } = usePolling(poll);

  // Pas de bannière pour la conversation à l'écran (elle se relit déjà).
  useFocusEffect(
    useCallback(() => {
      setOpenConversation(thread?.id ?? null);
      return () => setOpenConversation(null);
    }, [thread?.id])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/messages");
  }

  async function handleSend() {
    if (!thread || sending || !canSend(draft, wish?.id ?? null, MESSAGE_MAX_LENGTH)) return;
    setSending(true);
    setSendError(null);
    try {
      const text = draft.trim();
      const sent = await sendMessage({ recipientId: thread.other.id, ...(text ? { text } : {}), ...(replyTo ? { replyToId: replyTo.id } : {}), ...attachmentFor(wish) });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (wish?.kind === "match") {
        // Statistiques : d'où la pièce est partie, rien d'autre (liste fermée, consentement).
        track("piece_sent_to_friend", { from: pieceToSend(wish.id)?.from });
        forgetPieceToSend();
        showToast(sent.state === "invitation_sent" ? t.messages.pieceSentInvitation(thread.other.displayName) : t.messages.pieceSent(thread.other.displayName));
        // Retour au résultat, tel qu'il était (même grande carte, liste au même endroit).
        if (matchId && router.canGoBack()) {
          router.back();
          return;
        }
      }
      stickToEnd.current = true;
      setMessages((current) => mergeMessages(current, [sent.message]));
      setThread((current) => (current ? threadAfterSend(current, sent) : current));
      setDraft("");
      setWish(null);
      setReplyTo(null);
      kick();
      offerPush();
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : loadErrorMessage(e, t.messages.sendError));
      // Invitation en attente, réglage changé : l'état réel est relu.
      if (e instanceof ApiError && (e.status === 403 || e.status === 409)) void load();
    } finally {
      setSending(false);
    }
  }

  // ---- Lot « messages, plus de confort » ----

  // « Signaler » ou « Bloquer » choisi dans la feuille des actions : le menu
  // ne s'ouvre qu'une fois la feuille fermée. Sur iPhone, une fenêtre demandée
  // pendant qu'une autre se referme n'est jamais montrée (lib/after-sheet-close.ts).
  const afterSheet = useMemo(() => afterSheetClose(Platform.OS === "web"), []);
  useEffect(() => () => afterSheet.cancel(), [afterSheet]);

  /** Ce que la personne peut faire de ce message (lib/conversations.ts). */
  function actionsFor(message: ChatMessage): MessageAction[] {
    return messageActionsFor(message, { actions: actionsEnabled, open: thread?.state === "open", canWrite: thread ? canWrite(thread.sendMode) : false });
  }

  /** « ••• » ou appui long : la feuille des actions ; s'il n'y a que
   * « Signaler » et « Bloquer » (serveur plus ancien, message supprimé,
   * invitation reçue), le menu existant directement, comme avant. */
  function openOptions(message: ChatMessage) {
    const list = actionsFor(message);
    if (list.length === 0) return;
    if (list.every((action) => action === "report" || action === "block")) {
      setMenuStep("root");
      setMenuFor(message);
    } else {
      setSheetFor(message);
    }
  }

  /** Le « j'aime » est montré tout de suite ; si le serveur refuse, il revient en arrière, avec un message. */
  async function toggleLike(message: ChatMessage, liked: boolean) {
    if (liked) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setMessages((current) => current.map((entry) => (entry.id === message.id ? withLike(entry, liked) : entry)));
    try {
      const saved = await setMessageReaction(message.id, liked);
      setMessages((current) => applyChanges(current, [saved]));
    } catch (e) {
      setMessages((current) => current.map((entry) => (entry.id === message.id ? withLike(entry, !liked) : entry)));
      showToast(e instanceof ApiError ? e.message : t.messageActions.likeError);
    }
  }

  /** Supprimer un de ses messages, pour les deux membres (déjà confirmé dans la feuille). */
  async function handleDelete(message: ChatMessage) {
    try {
      await deleteMessage(message.id);
      setMessages((current) => withoutContent(current, message.id, false));
      setReplyTo((current) => (current?.id === message.id ? null : current));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.messageActions.deleteError);
    }
  }

  function openPost(openedId: string) {
    router.push({ pathname: "/publication", params: { id: openedId } });
  }

  function handleAction(message: ChatMessage, action: MessageAction) {
    if (action === "like" || action === "unlike") void toggleLike(message, action === "like");
    else if (action === "reply") setReplyTo(replyTargetOf(message, thread?.other.displayName ?? ""));
    else if (action === "delete") void handleDelete(message);
    else if (action === "openPost") {
      // Même chemin que la carte dans la bulle (VoiceOver ne peut pas la toucher).
      if (message.post?.available) openPost(message.post.id);
    } else {
      // « Signaler » ou « Bloquer » : le menu existant, à l'étape choisie, une fois la feuille fermée.
      afterSheet.schedule(() => {
        setMenuStep(action === "report" ? "report" : "confirmBlock");
        setMenuFor(message);
      });
    }
  }

  async function handleAccept() {
    if (!thread?.id) return;
    setAnswering(true);
    try {
      await acceptInvitation(thread.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.messages.accepted);
      await load();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.messages.actionError);
    } finally {
      setAnswering(false);
    }
  }

  async function handleDecline() {
    if (!thread?.id) return;
    setAnswering(true);
    try {
      await declineInvitation(thread.id);
      showToast(t.messages.declined);
      fetchMessagesStatus().catch(() => {});
      goBack();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.messages.actionError);
      setAnswering(false);
    }
  }

  async function loadOlder() {
    const oldest = messages[0];
    if (!thread?.id || !oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchConversation(thread.id, { before: oldest.createdAt });
      stickToEnd.current = false;
      setMessages((current) => mergeMessages(data.messages, current));
      setThread((current) => (current ? { ...current, hasOlder: data.hasOlder } : current));
    } catch (e) {
      showToast(loadErrorMessage(e, t.messages.loadConversationError));
    } finally {
      setLoadingOlder(false);
    }
  }

  const other = thread?.other;
  const nav = (
    <View style={styles.nav}>
      <Pressable onPress={goBack} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.messages.back}>
        <Text style={styles.back}>‹</Text>
      </Pressable>
      {other ? (
        <Pressable
          onPress={() => router.push({ pathname: "/profil", params: { id: other.id } })}
          style={styles.navTitle}
          accessibilityRole="link"
          accessibilityLabel={t.common.viewProfile(other.displayName)}
        >
          <Avatar uri={other.avatarUrl} userId={other.id} displayName={other.displayName} username={other.username} size={32} />
          <View style={styles.navText}>
            <Text style={styles.navName} numberOfLines={1} accessibilityRole="header">
              {other.displayName}
            </Text>
            <Text style={styles.navHandle} numberOfLines={1}>
              @{other.username}
            </Text>
          </View>
        </Pressable>
      ) : (
        <View style={styles.navTitle} />
      )}
      {other ? (
        <Pressable onPress={() => setProfileMenu(true)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button" accessibilityLabel={t.messages.more}>
          <MoreIcon size={20} tint={color.encre} />
        </Pressable>
      ) : (
        <View style={styles.navSide} />
      )}
    </View>
  );

  if (state !== "ready" || !thread || !other) {
    return (
      <SafeAreaView style={styles.screen}>
        {nav}
        <View style={styles.centered}>
          {state === "loading" ? (
            <ActivityIndicator color={color.encre} />
          ) : (
            <>
              <ErrorMessage style={styles.message}>{state === "not_found" ? t.messages.notFound : t.messages.loadConversationError}</ErrorMessage>
              {state === "error" ? (
                <Pressable onPress={() => void load()} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryLabel}>{t.common.retry}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const notice = composerNotice(thread.sendMode, other.displayName);
  const sendable = canSend(draft, wish?.id ?? null, MESSAGE_MAX_LENGTH) && !sending;
  // « Vu » ou « Envoyé », sous votre dernier message seulement (ou rien).
  const receipt = receiptMention(messages, thread.readReceipts, other.displayName);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
      {nav}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (stickToEnd.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {thread.hasOlder ? (
            <Pressable onPress={() => void loadOlder()} disabled={loadingOlder} style={styles.older} accessibilityRole="button" accessibilityState={{ busy: loadingOlder }}>
              {loadingOlder ? <ActivityIndicator color={color.encre} /> : <Text style={styles.olderLabel}>{t.messages.loadOlder}</Text>}
            </Pressable>
          ) : null}
          {messages.length === 0 ? <Text style={styles.empty}>{t.messages.emptyThread}</Text> : null}
          {messages.map((message) => (
            <View key={message.id}>
              <Bubble
                message={message}
                otherName={other.displayName}
                ownActions={message.mine && actionsFor(message).length > 0}
                onOptions={() => openOptions(message)}
                onLike={actionsFor(message).includes("like") ? () => void toggleLike(message, true) : undefined}
                onOpenPost={openPost}
              />
              {/* Une ligne de hauteur fixe : « Envoyé » devient « Vu » sans rien déplacer. */}
              {receipt?.messageId === message.id ? (
                <Text style={styles.receipt} numberOfLines={1} accessibilityLabel={receipt.label} accessibilityLiveRegion="polite" testID="confirmation-lecture">
                  {receipt.text}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {thread.sendMode === "answer" ? (
            confirmDecline ? (
              <View style={styles.confirm}>
                <Text style={styles.confirmText} accessibilityRole="alert">
                  {t.messages.declineConfirm}
                </Text>
                <View style={styles.answerRow}>
                  <Pressable style={styles.answerButton} onPress={() => setConfirmDecline(false)} disabled={answering} accessibilityRole="button">
                    <Text style={styles.answerLabel}>{t.messages.cancel}</Text>
                  </Pressable>
                  <Pressable style={styles.answerButton} onPress={() => void handleDecline()} disabled={answering} accessibilityRole="button" accessibilityState={{ busy: answering }}>
                    <Text style={[styles.answerLabel, styles.danger]}>{t.messages.declineConfirmCta}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.answerRow}>
                <Pressable
                  style={[styles.answerButton, styles.acceptButton]}
                  onPress={() => void handleAccept()}
                  disabled={answering}
                  accessibilityRole="button"
                  accessibilityState={{ busy: answering }}
                >
                  <Text style={[styles.answerLabel, styles.acceptLabel]}>{t.messages.accept}</Text>
                </Pressable>
                <Pressable style={styles.answerButton} onPress={() => setConfirmDecline(true)} disabled={answering} accessibilityRole="button">
                  <Text style={styles.answerLabel}>{t.messages.decline}</Text>
                </Pressable>
                <Pressable style={styles.answerButton} onPress={() => setProfileMenu(true)} disabled={answering} accessibilityRole="button">
                  <Text style={[styles.answerLabel, styles.danger]}>{t.messages.block}</Text>
                </Pressable>
              </View>
            )
          ) : canWrite(thread.sendMode) ? (
            <>
              {/* Réponse à un message précis : rappelé au-dessus du champ, avec un bouton pour l'annuler. */}
              {replyTo ? (
                <View style={styles.attached} testID="reponse-a">
                  <View style={styles.replyText}>
                    <Text style={styles.replyTitle} numberOfLines={1}>
                      {replyTo.title}
                    </Text>
                    {replyTo.excerpt ? (
                      <Text style={styles.replyExcerpt} numberOfLines={1}>
                        {replyTo.excerpt}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.messageActions.cancelReply}>
                    <Text style={styles.attachedRemove}>×</Text>
                  </Pressable>
                </View>
              ) : null}
              {wish ? (
                <View style={styles.attached}>
                  <View style={styles.attachedThumb}>
                    {wish.imageUrl ? <SpotImage hdUri={null} fallbackUri={wish.imageUrl} style={styles.fill} fit="cover" size="small" /> : <ImageUnavailable variant="thumb" />}
                  </View>
                  <Text style={styles.attachedTitle} numberOfLines={1}>
                    {attachedLabels(wish).title}
                  </Text>
                  <Pressable onPress={() => setWish(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={attachedLabels(wish).remove}>
                    <Text style={styles.attachedRemove}>×</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.composer}>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  style={styles.attach}
                  accessibilityRole="button"
                  accessibilityLabel={t.messages.attachWish}
                  testID="joindre-envie"
                >
                  <PlusIcon size={18} tint={color.vert} />
                </Pressable>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t.messages.placeholder}
                  placeholderTextColor={color.acier}
                  multiline
                  maxLength={MESSAGE_MAX_LENGTH}
                  accessibilityLabel={t.messages.placeholder}
                />
                <Pressable
                  onPress={() => void handleSend()}
                  disabled={!sendable}
                  style={[styles.send, sendable ? null : styles.sendDisabled]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !sendable, busy: sending }}
                >
                  <Text style={[styles.sendLabel, sendable ? null : styles.sendLabelDisabled]}>{sending ? t.messages.sending : t.messages.send}</Text>
                </Pressable>
              </View>
              {draft.length >= MESSAGE_COUNTER_FROM ? (
                <Text style={styles.counter} accessibilityLiveRegion="polite">
                  {draft.length} / {MESSAGE_MAX_LENGTH}
                </Text>
              ) : null}
            </>
          ) : null}
          {sendError ? <ErrorMessage style={styles.message}>{sendError}</ErrorMessage> : null}
        </View>
      </KeyboardAvoidingView>

      <WishPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setWish(picked);
          setPickerOpen(false);
        }}
      />
      <ReportBlockMenu
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        userId={other.id}
        messageId={menuFor?.id}
        initialStep={menuStep}
        onBlocked={() => goBack()}
        onReported={() => {
          const reportedId = menuFor?.id;
          if (!reportedId) return;
          // Le message signalé quitte l'écran ; une réponse qui le citait montre « Message indisponible ».
          setMessages((current) => withoutContent(current, reportedId, true));
          setReplyTo((current) => (current?.id === reportedId ? null : current));
        }}
      />
      <MessageActionsSheet
        visible={sheetFor !== null}
        actions={sheetFor ? actionsFor(sheetFor) : []}
        onClose={() => setSheetFor(null)}
        onDismissed={afterSheet.flush}
        onAction={(action) => {
          if (sheetFor) handleAction(sheetFor, action);
        }}
      />
      <ReportBlockMenu visible={profileMenu} onClose={() => setProfileMenu(false)} userId={other.id} onBlocked={() => goBack()} />
      {pushOffer.sheet}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  nav: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: color.filet },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  navTitle: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, minHeight: 44 },
  navText: { flexShrink: 1 },
  navName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  navHandle: { fontSize: font.caption, color: color.acier },
  back: { fontSize: 26, color: color.encre },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  message: { fontSize: font.secondary, textAlign: "center", marginTop: space.xs },
  retry: { marginTop: space.md, minHeight: 44, justifyContent: "center" },
  retryLabel: { ...lienSouligne, fontSize: font.body, color: color.vert, fontWeight: "600" },
  thread: { padding: space.md, gap: space.sm, maxWidth: 640, alignSelf: "center", width: "100%" },
  older: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: space.md },
  olderLabel: { ...lienSouligne, fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.xl },
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: radius.lg, paddingHorizontal: space.sm, paddingVertical: space.xs, gap: 4 },
  bubbleMine: { backgroundColor: color.vert, borderBottomRightRadius: radius.sm },
  bubbleTheirs: { backgroundColor: color.plinthe, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontSize: font.body, color: color.encre, lineHeight: 21 },
  bubbleTextMine: { color: color.blanc },
  bubbleTime: { fontSize: 11, color: color.acier, alignSelf: "flex-end" },
  bubbleTimeMine: { color: color.blanc, opacity: 0.8 },
  bubbleMore: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center" },
  bubbleDeleted: { fontSize: font.secondary, fontStyle: "italic", color: color.acier, lineHeight: 21 },
  quote: { borderLeftWidth: 2, borderLeftColor: color.acier, paddingLeft: space.xs, gap: 1 },
  quoteMine: { borderLeftColor: color.blanc },
  quoteWho: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  quoteText: { fontSize: font.caption, color: color.encre, lineHeight: 17, opacity: 0.85 },
  liked: { flexDirection: "row", gap: 2, marginTop: 2, minHeight: 16 },
  likedMine: { justifyContent: "flex-end", paddingRight: space.xs },
  likedTheirs: { justifyContent: "flex-start", paddingLeft: space.xs },
  replyText: { flex: 1, minWidth: 0 },
  replyTitle: { fontSize: font.caption, fontWeight: "600", color: color.encre },
  replyExcerpt: { fontSize: font.caption, color: color.acier },
  receipt: { alignSelf: "flex-end", marginTop: 2, lineHeight: 18, fontSize: font.caption, color: color.acier },
  footer: { borderTopWidth: 1, borderTopColor: color.filet, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xs },
  notice: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.xs },
  attach: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.lg,
    paddingHorizontal: space.sm,
    paddingVertical: 9,
    fontSize: font.body,
    color: color.encre,
  },
  send: { minHeight: 40, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  sendDisabled: { backgroundColor: color.inactif },
  sendLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  sendLabelDisabled: { color: color.surInactif },
  counter: { fontSize: font.caption, color: color.acier, alignSelf: "flex-end" },
  attached: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.xs, borderRadius: radius.md, backgroundColor: color.plinthe },
  attachedThumb: { width: 36, height: 36, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.filet },
  fill: { width: "100%", height: "100%" },
  attachedTitle: { flex: 1, fontSize: font.secondary, color: color.encre },
  attachedRemove: { fontSize: 22, color: color.acier, paddingHorizontal: space.xs },
  answerRow: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  answerButton: {
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButton: { backgroundColor: color.vert, borderColor: color.vert },
  answerLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  acceptLabel: { color: color.blanc },
  danger: { color: color.danger },
  confirm: { gap: space.sm },
  confirmText: { fontSize: font.secondary, color: color.encre, lineHeight: 19 },
}));
