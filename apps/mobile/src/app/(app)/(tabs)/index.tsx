import { useCallback, useState } from "react";
import { Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { color, font, radius, space, serifFont } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { getRecentlySpotted } from "@/api/client";
import type { Piece } from "@/api/types";
import { CameraIcon, ClockIcon, LinkIcon } from "@/components/icons";

function isLikelyUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function RecentItem({ piece }: { piece: Piece }) {
  return (
    <View style={styles.recentItem}>
      <View style={styles.recentThumb}>
        {piece.imageUrl ? (
          <Image source={{ uri: piece.imageUrl }} style={styles.recentThumbImage} contentFit="cover" />
        ) : (
          <ClockIcon size={30} tint={color.encre} />
        )}
      </View>
      <Text style={styles.recentName} numberOfLines={1}>
        {piece.name}
      </Text>
    </View>
  );
}

export default function SpotterScreen() {
  const router = useRouter();
  const [recent, setRecent] = useState<Piece[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadRecent = useCallback(() => getRecentlySpotted().then(setRecent).catch(() => {}), []);

  useFocusEffect(
    useCallback(() => {
      loadRecent();
    }, [loadRecent])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadRecent();
    setRefreshing(false);
  }

  async function handlePasteLink() {
    setError(null);
    const text = await Clipboard.getStringAsync();
    if (!text || !isLikelyUrl(text)) {
      setError(fr.spotter.unsupportedLink);
      return;
    }
    router.push({ pathname: "/spot/analysis", params: { type: "link", value: text.trim() } });
  }

  async function handleImportPhoto() {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    router.push({ pathname: "/spot/analysis", params: { type: "photo", value: result.assets[0].uri } });
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{fr.spotter.title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
      >
        <Text style={styles.question}>{fr.spotter.question}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.primary} onPress={handlePasteLink}>
          <LinkIcon size={18} tint={color.blanc} />
          <Text style={styles.primaryLabel}>{fr.spotter.pasteLink}</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={handleImportPhoto}>
          <CameraIcon size={18} tint={color.encre} />
          <Text style={styles.secondaryLabel}>{fr.spotter.importPhoto}</Text>
        </Pressable>

        {recent.length > 0 ? (
          <View style={styles.recentSection}>
            <Text style={styles.recentTitle}>{fr.spotter.recentlySpotted}</Text>
            <View style={styles.recentRow}>
              {recent.map((piece) => (
                <RecentItem key={piece.id} piece={piece} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  question: { fontSize: font.body, color: color.encre, marginBottom: space.md },
  error: { fontSize: font.secondary, color: color.acier, marginBottom: space.md, lineHeight: 20 },
  primary: {
    backgroundColor: color.vert,
    borderRadius: radius.md,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    paddingVertical: 15,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  recentSection: { marginTop: space.xxl - space.xs },
  recentTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.md },
  recentRow: { flexDirection: "row", gap: space.md },
  recentItem: { flex: 1 },
  recentThumb: {
    backgroundColor: color.plinthe,
    borderRadius: radius.sm,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  recentThumbImage: { width: "100%", height: "100%" },
  recentName: { fontSize: font.caption, color: color.acier, marginTop: 7, lineHeight: 16 },
});
