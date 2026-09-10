import { useCallback, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { useAuth } from "@/lib/auth-context";
import { fetchVault } from "@/lib/api";
import type { VaultItem } from "@monapp/shared-types";
import { ClockIcon, GearIcon, PersonIcon, VerifiedIcon } from "@/components/icons";

export default function ProfileScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [segment, setSegment] = useState<"vault" | "lifestyle">("vault");

  useFocusEffect(
    useCallback(() => {
      fetchVault()
        .then(setItems)
        .catch(() => {});
    }, [])
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
          <GearIcon size={21} tint={color.encre} />
        </Pressable>
        <Pressable onPress={() => router.push("/post-item/new")} hitSlop={8}>
          <Text style={styles.publish}>{fr.profile.publish}</Text>
        </Pressable>
      </View>

      <View style={styles.head}>
        <View style={styles.avatar}>
          <PersonIcon size={26} tint={color.encre} />
        </View>
        <View style={styles.who}>
          <Text style={styles.name}>{profile?.displayName}</Text>
          <Text style={styles.handle}>@{profile?.username}</Text>
        </View>
      </View>
      {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

      <View style={styles.seg}>
        <Pressable onPress={() => setSegment("vault")}>
          <Text style={[styles.segItem, segment === "vault" ? styles.segItemActive : null]}>{fr.profile.vault}</Text>
        </Pressable>
        <Pressable onPress={() => setSegment("lifestyle")}>
          <Text style={[styles.segItem, segment === "lifestyle" ? styles.segItemActive : null]}>{fr.profile.lifestyle}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {segment === "vault"
          ? items.map((item) => (
              <Pressable
                key={item.id}
                style={styles.piece}
                onPress={() => router.push({ pathname: "/vault-item/[id]", params: { id: item.id } })}
              >
                <View style={styles.thumb}>
                  <ClockIcon size={30} tint={color.encre} />
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
          : (
              <Text style={styles.emptyLifestyle}>Rien à afficher pour l'instant.</Text>
            )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  publish: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  head: { paddingHorizontal: space.lg, flexDirection: "row", gap: 14, alignItems: "center" },
  avatar: { width: 64, height: 64, borderRadius: radius.full, backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center" },
  who: { flex: 1 },
  name: { fontSize: font.body, fontWeight: "600", color: color.encre },
  handle: { fontSize: font.secondary, color: color.acier, marginTop: 1 },
  bio: { fontSize: font.secondary, color: color.acier, paddingHorizontal: space.lg, paddingTop: space.md, lineHeight: 19 },
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
  piece: { width: "31%" },
  thumb: { backgroundColor: color.plinthe, borderRadius: radius.sm, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
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
  emptyLifestyle: { fontSize: font.secondary, color: color.acier, paddingTop: space.xl, textAlign: "center", width: "100%" },
});
