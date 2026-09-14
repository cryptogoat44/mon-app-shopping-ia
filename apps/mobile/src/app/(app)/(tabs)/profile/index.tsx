import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { useAuth } from "@/lib/auth-context";
import { ApiError, fetchMyLifestylePosts, fetchVault, uploadAvatar } from "@/lib/api";
import type { Post, VaultItem } from "@monapp/shared-types";
import { CameraIcon, ClockIcon, GearIcon, PersonIcon, VerifiedIcon } from "@/components/icons";
import { useToast } from "@/lib/toast-context";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [lifestylePosts, setLifestylePosts] = useState<Post[]>([]);
  const [segment, setSegment] = useState<"vault" | "lifestyle">("vault");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([
        fetchVault().then(setItems).catch(() => {}),
        fetchMyLifestylePosts().then(setLifestylePosts).catch(() => {}),
      ]),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([load(), refreshProfile()]);
    setRefreshing(false);
  }

  const isEmptyVault = segment === "vault" && items.length === 0;
  const isEmptyLifestyle = segment === "lifestyle" && lifestylePosts.length === 0;
  const isEmpty = isEmptyVault || isEmptyLifestyle;

  async function handlePickAvatar() {
    if (uploadingAvatar) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      await uploadAvatar(result.assets[0].uri);
      await refreshProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(fr.profile.avatarUpdated);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.profile.avatarError);
    } finally {
      setUploadingAvatar(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Text style={styles.navHandle}>@{profile?.username}</Text>
        <Pressable onPress={() => router.push("/settings")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Réglages">
          <GearIcon size={21} tint={color.encre} />
        </Pressable>
      </View>

      <View style={styles.head}>
        <Pressable
          style={styles.avatar}
          onPress={handlePickAvatar}
          disabled={uploadingAvatar}
          accessibilityRole="button"
          accessibilityLabel="Changer la photo de profil"
        >
          {profile?.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} contentFit="cover" />
          ) : (
            <PersonIcon size={26} tint={color.encre} />
          )}
          {uploadingAvatar ? (
            <View style={styles.avatarOverlay}>
              <ActivityIndicator color={color.blanc} size="small" />
            </View>
          ) : (
            <View style={styles.avatarBadge}>
              <CameraIcon size={12} tint={color.blanc} strokeWidth={1.6} />
            </View>
          )}
        </Pressable>
        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{items.length}</Text>
            <Text style={styles.statLabel}>{fr.profile.vault}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{profile?.followersCount ?? 0}</Text>
            <Text style={styles.statLabel}>{fr.profile.followers}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{profile?.followingCount ?? 0}</Text>
            <Text style={styles.statLabel}>{fr.profile.followingCount}</Text>
          </View>
        </View>
      </View>
      <View style={styles.who}>
        <Text style={styles.name}>{profile?.displayName}</Text>
        {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      </View>

      <View style={styles.seg}>
        <Pressable
          onPress={() => setSegment("vault")}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === "vault" }}
        >
          <Text style={[styles.segItem, segment === "vault" ? styles.segItemActive : null]}>{fr.profile.vault}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSegment("lifestyle")}
          accessibilityRole="tab"
          accessibilityState={{ selected: segment === "lifestyle" }}
        >
          <Text style={[styles.segItem, segment === "lifestyle" ? styles.segItemActive : null]}>{fr.profile.lifestyle}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={isEmpty ? styles.emptyContent : styles.grid}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
      >
        {segment === "vault" ? (
          isEmptyVault ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{fr.profile.emptyVault}</Text>
              <Pressable onPress={() => router.push("/(app)/(tabs)")}>
                <Text style={styles.emptyCta}>{fr.profile.emptyVaultCta}</Text>
              </Pressable>
            </View>
          ) : (
            items.map((item) => (
              <Pressable
                key={item.id}
                style={styles.piece}
                onPress={() => router.push({ pathname: "/vault-item/[id]", params: { id: item.id } })}
              >
                <View style={styles.thumb}>
                  {item.imageUrl ? (
                    <Image source={{ uri: item.imageUrl }} style={styles.thumbImage} contentFit="cover" />
                  ) : (
                    <ClockIcon size={30} tint={color.encre} />
                  )}
                </View>
                {item.verified ? (
                  <View style={styles.verifiedBadge}>
                    <VerifiedIcon size={16} />
                  </View>
                ) : null}
                <Text style={styles.pname} numberOfLines={1}>
                  {item.title}
                </Text>
                {!item.verified ? <Text style={styles.pstate}>{fr.profile.pendingVerification}</Text> : null}
              </Pressable>
            ))
          )
        ) : isEmptyLifestyle ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{fr.profile.emptyLifestyle}</Text>
            <Pressable onPress={() => router.push("/post-item/new")}>
              <Text style={styles.emptyCta}>{fr.profile.emptyLifestyleCta}</Text>
            </Pressable>
          </View>
        ) : (
          lifestylePosts.map((post) => (
            <View key={post.id} style={styles.piece}>
              <View style={styles.thumb}>
                <Image source={{ uri: post.mediaUrl }} style={styles.thumbImage} contentFit="cover" />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  navHandle: { fontSize: font.body, fontWeight: "600", color: color.encre },
  head: { paddingHorizontal: space.lg, flexDirection: "row", gap: space.xl, alignItems: "center" },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  avatarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(29,29,31,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: color.vert,
    borderWidth: 2,
    borderColor: color.porcelaine,
    alignItems: "center",
    justifyContent: "center",
  },
  stats: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statNumber: { fontSize: font.body, fontWeight: "600", color: color.encre },
  statLabel: { fontSize: font.caption, color: color.acier, marginTop: 2 },
  who: { paddingHorizontal: space.lg, paddingTop: space.md },
  name: { fontSize: font.body, fontWeight: "600", color: color.encre },
  bio: { fontSize: font.secondary, color: color.acier, marginTop: 4, lineHeight: 19 },
  seg: { flexDirection: "row", gap: 22, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: color.filet },
  segItem: { fontSize: 14.5, color: color.acier, paddingBottom: 12 },
  segItemActive: { color: color.encre, fontWeight: "600" },
  grid: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    maxWidth: 640,
    alignSelf: "center",
    width: "100%",
  },
  emptyContent: { flexGrow: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl, marginTop: -60 },
  emptyText: { fontSize: font.secondary, color: color.acier, textAlign: "center", lineHeight: 20, marginBottom: space.md },
  emptyCta: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  piece: { width: "31%" },
  thumb: {
    backgroundColor: color.plinthe,
    borderRadius: radius.sm,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  verifiedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: color.blanc,
    alignItems: "center",
    justifyContent: "center",
  },
  pname: { fontSize: font.caption, color: color.encre, marginTop: space.xs },
  pstate: { fontSize: 11, color: color.acier, marginTop: 1 },
});
