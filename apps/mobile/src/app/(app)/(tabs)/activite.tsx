import { useCallback, useState } from "react";
import { Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { AppNotification } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { ApiError, fetchNotifications, markNotificationsRead } from "@/lib/api";
import { timeAgo } from "@/lib/time";
import { PersonIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { ErrorMessage } from "@/components/error-message";

function actionText(notification: AppNotification): string {
  if (notification.type === "follow") return fr.notifications.follow;
  if (notification.type === "comment") return fr.notifications.comment;
  return fr.notifications.like;
}

function NotificationRow({ notification, onPress }: { notification: AppNotification; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, !notification.read ? styles.rowUnread : null]}
      accessibilityRole="link"
      accessibilityLabel={`${notification.actor.displayName} ${actionText(notification)}`}
    >
      <View style={styles.avatar}>
        {notification.actor.avatarUrl ? (
          <Image source={{ uri: notification.actor.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <PersonIcon size={18} tint={color.acier} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLine}>
          <Text style={styles.rowName}>{notification.actor.displayName}</Text> {actionText(notification)}
        </Text>
        <Text style={styles.rowTime}>{timeAgo(notification.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      fetchNotifications()
        .then((data) => {
          setNotifications(data);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : fr.notifications.loadError)),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load().then(() => markNotificationsRead().catch(() => {}));
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const isEmpty = notifications?.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      {/* Onglet « Activité » de la barre (Lot F, barre A) : j'aime,
          commentaires et abonnements. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">{fr.notifications.title}</Text>
      </View>

      {notifications === null && !error ? (
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
      ) : (
        <ScrollView
          contentContainerStyle={isEmpty ? styles.emptyContent : styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
        >
          {error ? <ErrorMessage style={styles.errorText}>{error}</ErrorMessage> : null}
          {isEmpty ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{fr.notifications.empty}</Text>
            </View>
          ) : (
            notifications?.map((notification) => <NotificationRow key={notification.id} notification={notification} onPress={() =>
                  // « J'aime » et commentaire : la publication ; abonnement : le profil.
                  notification.postId
                    ? router.push({ pathname: "/publication", params: { id: notification.postId } })
                    : router.push({ pathname: "/profil", params: { id: notification.actor.id } })
                } />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headerTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: {
    height: 47,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
  },
  back: { fontSize: 26, color: color.encre },
  navSpacer: { width: 26 },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  emptyContent: { flexGrow: 1 },
  errorText: { fontSize: font.secondary, color: color.acier, marginBottom: space.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60 },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
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
  rowName: { fontWeight: "600" },
  rowTime: { fontSize: font.caption, color: color.acier, marginTop: 2 },
});
