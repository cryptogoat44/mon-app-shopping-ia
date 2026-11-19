import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { AppNotification, PostAuthor } from "@monapp/shared-types";
import { color, font, radius, serifDisplayLetterSpacing, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { unreadChanged } from "@/lib/unread-notifications";
import { NOTIFICATIONS_PAGE_SIZE, fetchMessagesStatus, fetchNotifications, markNotificationsRead } from "@/lib/api";
import { messagesEntry } from "@/lib/conversations";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useAuth } from "@/lib/auth-context";
import { knownNotifications, notificationActionText, notificationTarget, pendingRequestsCount } from "@/lib/follow-state";
import { loadErrorMessage } from "@/lib/load-error";
import { systemNotificationLines } from "@/lib/moderation-labels";
import { showsActivity } from "@/lib/push-state";
import { timeAgo } from "@/lib/format";
import { BellIcon, CommentIcon, LockIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { usePushOffer } from "@/components/push-offer-sheet";
import { themedStyles } from "@/theme/themed-styles";
import { Avatar } from "@/components/avatar";

const actionText = (notification: AppNotification): string => notificationActionText(notification.type);

function NotificationRow({ notification, actor, onPress }: { notification: AppNotification; actor: PostAuthor; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, !notification.read ? styles.rowUnread : null]}
      accessibilityRole="link"
      accessibilityLabel={`${actor.displayName} ${actionText(notification)}`}
    >
      <Avatar uri={actor.avatarUrl} userId={actor.id} displayName={actor.displayName} username={actor.username} size={36} />
      <View style={styles.rowText}>
        <Text style={styles.rowLine}>
          <Text style={styles.rowName}>{actor.displayName}</Text> {actionText(notification)}
        </Text>
        <Text style={styles.rowTime}>{timeAgo(notification.createdAt, getActiveLocale())}</Text>
      </View>
    </Pressable>
  );
}

/** Lot messages : l'entrée « Messages », avec le nombre de conversations non
 * lues. Cachée tant que la messagerie n'est pas disponible sur le serveur. */
function MessagesEntry({ label, badge, onPress }: { label: string; badge: string | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.messagesEntry} accessibilityRole="button" accessibilityLabel={label} testID="entree-messages">
      <View style={styles.avatar}>
        <CommentIcon size={18} tint={color.encre} />
      </View>
      <Text style={styles.messagesLabel}>{t.messages.entry}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** Compte privé (lot « vie sociale ») : l'entrée « Demandes d'abonnement (n) »,
 * seulement quand il y en a. */
function RequestsEntry({ count, onPress }: { count: number; onPress: () => void }) {
  const label = t.privateAccount.requestsEntry(count);
  return (
    <Pressable onPress={onPress} style={styles.messagesEntry} accessibilityRole="button" accessibilityLabel={label} testID="entree-demandes">
      <View style={styles.avatar}>
        <LockIcon size={18} tint={color.encre} />
      </View>
      <Text style={styles.messagesLabel}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** Modération et signalement traité (lot 5) : aucun auteur affiché, rien à ouvrir. */
function SystemNotificationRow({ notification, lines }: { notification: AppNotification; lines: string[] }) {
  const [first, ...details] = lines;
  return (
    <View style={[styles.row, styles.rowTop, !notification.read ? styles.rowUnread : null]} accessible>
      <View style={styles.avatar}>
        <BellIcon size={18} tint={color.acier} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLine}>{first}</Text>
        {details.map((line) => (
          <Text key={line} style={styles.rowDetail}>
            {line}
          </Text>
        ))}
        <Text style={styles.rowTime}>{timeAgo(notification.createdAt, getActiveLocale())}</Text>
      </View>
    </View>
  );
}

function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchNotifications()
        .then((data) => {
          // Un type que cette version ne connaît pas n'est pas affiché (lib/follow-state.ts).
          setNotifications(knownNotifications(data));
          setHasMore(data.length === NOTIFICATIONS_PAGE_SIZE);
          setError(null);
          setMoreError(null);
        })
        .catch((e) => setError(loadErrorMessage(e, t.notifications.loadError))),
    []
  );

  async function loadMore() {
    const last = notifications?.at(-1);
    if (!last || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const older = await fetchNotifications(last.createdAt);
      setNotifications((current) => [...(current ?? []), ...knownNotifications(older)]);
      setHasMore(older.length === NOTIFICATIONS_PAGE_SIZE);
    } catch (e) {
      setMoreError(loadErrorMessage(e, t.notifications.loadMoreError));
    } finally {
      setLoadingMore(false);
    }
  }

  return { notifications, error, hasMore, loadingMore, moreError, load, loadMore };
}

function ListSkeleton() {
  return (
    <View style={styles.content}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.row}>
          <Skeleton style={styles.avatar} />
          <View style={styles.rowText}>
            <Skeleton style={{ width: "70%", height: 13, marginBottom: 6 }} />
            <Skeleton style={{ width: "30%", height: 11 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { notifications, error, hasMore, loadingMore, moreError, load, loadMore } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const entry = messagesEntry(useMessagesStatus());
  // Compte privé : nombre de demandes d'abonnement en attente, relu à chaque retour sur l'onglet.
  const { profile, refreshProfile } = useAuth();
  const requestsCount = pendingRequestsCount(profile);
  // Lot « découverte » (migration 0051) : la première fois que l'onglet montre
  // une activité, la feuille des notifications d'activité est proposée une fois
  // (iPhone seulement, si le serveur les propose et que rien n'a été répondu).
  const activityPushOffer = usePushOffer("activity");
  const offerActivityPush = activityPushOffer.offer;
  useEffect(() => {
    if (notifications && showsActivity(notifications)) offerActivityPush();
  }, [notifications, offerActivityPush]);

  useFocusEffect(
    useCallback(() => {
      fetchMessagesStatus().catch(() => {});
      refreshProfile().catch(() => {});
      load().then(() =>
        markNotificationsRead()
          .then(unreadChanged)
          .catch(() => {})
      );
    }, [load, refreshProfile])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([load(), fetchMessagesStatus().catch(() => {}), refreshProfile().catch(() => {})]);
    setRefreshing(false);
  }

  function renderNotification(notification: AppNotification) {
    const lines = systemNotificationLines(notification);
    const actor = notification.actor;
    if (lines || !actor) return <SystemNotificationRow key={notification.id} notification={notification} lines={lines ?? [t.notifications.moderationOther]} />;
    // « J'aime » et commentaire : la publication ; abonnement et demande
    // acceptée : le profil. Pièce reçue (lot 5) : la liste des pièces reçues.
    // Demande d'abonnement : la liste des demandes (lib/follow-state.ts).
    const target = notificationTarget(notification, actor.id);
    const open = () =>
      target.screen === "pieces"
        ? router.push("/pieces-recues")
        : target.screen === "requests"
          ? router.push({ pathname: "/membres", params: { kind: "requests" } })
          : target.screen === "post"
            ? router.push({ pathname: "/publication", params: { id: target.id } })
            : router.push({ pathname: "/profil", params: { id: target.id } });
    return <NotificationRow key={notification.id} notification={notification} actor={actor} onPress={open} />;
  }

  const isEmpty = notifications?.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      {/* Onglet « Activité » de la barre (Lot F, barre A) : j'aime,
          commentaires et abonnements ; décisions de la modération (lot 5). */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{t.notifications.title}</Text>
      </View>
      {entry ? (
        <View style={styles.entryWrap}>
          <MessagesEntry label={entry.label} badge={entry.badge} onPress={() => router.push("/messages")} />
        </View>
      ) : null}
      {requestsCount > 0 ? (
        <View style={styles.entryWrap}>
          <RequestsEntry count={requestsCount} onPress={() => router.push({ pathname: "/membres", params: { kind: "requests" } })} />
        </View>
      ) : null}

      {notifications === null && !error ? (
        <ListSkeleton />
      ) : notifications === null && error ? (
        <LoadFailure message={error} onRetry={() => void load()} />
      ) : (
        <ScrollView
          contentContainerStyle={isEmpty ? styles.emptyContent : styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
        >
          {error ? <ErrorMessage style={styles.errorText}>{error}</ErrorMessage> : null}
          {isEmpty ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t.notifications.empty}</Text>
              <Pressable style={styles.secondaryButton} onPress={() => router.push("/people-search")} accessibilityRole="button">
                <Text style={styles.secondaryLabel}>{t.feed.emptyFind}</Text>
              </Pressable>
            </View>
          ) : (
            notifications?.map(renderNotification)
          )}
          {moreError ? <ErrorMessage style={styles.errorText}>{moreError}</ErrorMessage> : null}
          {hasMore ? (
            <Pressable
              style={[styles.secondaryButton, styles.loadMore]}
              onPress={() => void loadMore()}
              disabled={loadingMore}
              accessibilityRole="button"
              accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
            >
              <Text style={styles.secondaryLabel}>{t.notifications.loadMore}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
      {activityPushOffer.sheet}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headerTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, lineHeight: serifLineHeight.display, letterSpacing: serifDisplayLetterSpacing, color: color.encre },
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  emptyContent: { flexGrow: 1 },
  errorText: { fontSize: font.secondary, marginBottom: space.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60, gap: space.md },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20 },
  secondaryButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  loadMore: { alignSelf: "center", marginTop: space.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  rowTop: { alignItems: "flex-start" },
  rowUnread: { backgroundColor: color.plinthe },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  rowText: { flex: 1 },
  rowLine: { fontSize: font.secondary, color: color.encre, lineHeight: 19 },
  rowDetail: { fontSize: font.secondary, color: color.encre, lineHeight: 19, marginTop: 2 },
  rowName: { fontWeight: "600" },
  rowTime: { fontSize: font.caption, color: color.acier, marginTop: 2 },
  entryWrap: { paddingHorizontal: space.lg, maxWidth: 480, alignSelf: "center", width: "100%" },
  messagesEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
    marginBottom: space.sm,
  },
  messagesLabel: { flex: 1, fontSize: font.body, fontWeight: "600", color: color.encre },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: font.caption, fontWeight: "700", color: color.blanc },
  chevron: { fontSize: 22, color: color.acier },
}));
