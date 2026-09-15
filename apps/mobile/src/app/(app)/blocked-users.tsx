import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import type { BlockedUser } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { ApiError, fetchBlockedUsers, unblockUser } from "@/lib/api";
import { PersonIcon } from "@/components/icons";
import { Skeleton } from "@/components/skeleton";
import { useToast } from "@/lib/toast-context";

function BlockedUserRow({ user, onUnblocked }: { user: BlockedUser; onUnblocked: (id: string) => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function handleUnblock() {
    setBusy(true);
    try {
      await unblockUser(user.id);
      onUnblocked(user.id);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.blockedUsers.unblockError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        {user.avatarUrl ? (
          <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <PersonIcon size={20} tint={color.acier} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.displayName}>{user.displayName}</Text>
        <Text style={styles.username}>@{user.username}</Text>
      </View>
      <Pressable onPress={handleUnblock} disabled={busy} hitSlop={4}>
        <Text style={styles.unblockLabel}>{fr.blockedUsers.unblock}</Text>
      </Pressable>
    </View>
  );
}

export default function BlockedUsersScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      fetchBlockedUsers()
        .then((data) => {
          setUsers(data);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : fr.blockedUsers.loadError));
    }, [])
  );

  function handleUnblocked(id: string) {
    setUsers((prev) => (prev ? prev.filter((u) => u.id !== id) : prev));
  }

  const isEmpty = !error && users?.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{fr.blockedUsers.title}</Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {users === null && !error ? (
          [0, 1].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton style={styles.avatar} />
              <View style={styles.rowText}>
                <Skeleton style={{ width: "50%", height: 13 }} />
              </View>
            </View>
          ))
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : isEmpty ? (
          <Text style={styles.empty}>{fr.blockedUsers.empty}</Text>
        ) : (
          users?.map((user) => <BlockedUserRow key={user.id} user={user} onUnblocked={handleUnblocked} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  back: { fontSize: 26, color: color.encre },
  navSpacer: { width: 26 },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  error: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg },
  empty: { fontSize: font.secondary, color: color.acier, textAlign: "center", marginTop: space.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  rowText: { flex: 1 },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  unblockLabel: { fontSize: font.caption, fontWeight: "600", color: color.vert },
});
