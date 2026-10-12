import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { AppNotification, PostAuthor } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { unreadChanged } from "@/lib/unread-notifications";
import { NOTIFICATIONS_PAGE_SIZE, fetchNotifications, markNotificationsRead } from "@/lib/api";
import { loadErrorMessage } from "@/lib/load-error";
import { systemNotificationLines } from "@/lib/moderation-labels";
import { timeAgo } from "@/lib/format";
import { BellIcon, PersonIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";
import { LoadFailure } from "@/components/load-failure";
import { themedStyles } from "@/theme/themed-styles";

function actionText(notification: AppNotification): string {
  if (notification.type === "follow") return t.notifications.follow;
  if (notification.type === "comment") return t.notifications.comment;
  if (notification.type === "piece_received") return t.notifications.pieceReceived;
  return t.notifications.like;
}

function NotificationRow({ notification, actor, onPress }: { notification: AppNotification; actor: PostAuthor; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, !notification.read ? styles.rowUnread : null]}
      accessibilityRole="link"
      accessibilityLabel={`${actor.displayName} ${actionText(notification)}`}
    >
      <View style={styles.avatar}>
        {actor.avatarUrl ? (
          <Image source={{ uri: actor.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <PersonIcon size={18} tint={color.acier} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLine}>
          <Text style={styles.rowName}>{actor.displayName}</Text> {actionText(notification)}
        </Text>
        <Text style={styles.rowTime}>{timeAgo(notification.createdAt, getActiveLocale())}</Text>
      </View>
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
          setNotifications(data);
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
      setNotifications((current) => [...(current ?? []), ...older]);
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

  useFocusEffect(
    useCallback(() => {
      load().then(() =>
        markNotificationsRead()
          .then(unreadChanged)
          .catch(() => {})
      );
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function renderNotification(notification: AppNotification) {
    const lines = systemNotificationLines(notification);
    const actor = notification.actor;
    if (lines || !actor) return <SystemNotificationRow key={notification.id} notification={notification} lines={lines ?? [t.notifications.moderationOther]} />;
    // « J'aime » et commentaire : la publication ; abonnement : le profil.
    // Pièce reçue (lot 5) : la liste des pièces reçues.
    const open = () =>
      notification.type === "piece_received"
        ? router.push("/pieces-recues")
        : notification.postId
          ? router.push({ pathname: "/publication", params: { id: notification.postId } })
          : router.push({ pathname: "/profil", params: { id: actor.id } });
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
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headerTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
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
  avatarImage: { width: "100%", height: "100%" },
  rowText: { flex: 1 },
  rowLine: { fontSize: font.secondary, color: color.encre, lineHeight: 19 },
  rowDetail: { fontSize: font.secondary, color: color.encre, lineHeight: 19, marginTop: 2 },
  rowName: { fontWeight: "600" },
  rowTime: { fontSize: font.caption, color: color.acier, marginTop: 2 },
}));
