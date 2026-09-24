import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { getRecentSearches } from "@/api/client";
import type { Piece } from "@/api/types";
import { CameraIcon, ClipboardIcon, ClockIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { SpotImage } from "@/components/spot-image";
import { detectLink, type LinkDetection } from "@/lib/link-detection";
import { beginFromLink, beginFromPhoto, prepareFailureKind } from "@/lib/spot-flow";
import { importPhotoForSpotter } from "@/lib/image-import";

function DetectionCard({ detection }: { detection: LinkDetection }) {
  if (detection.kind === "supported") {
    return (
      <View style={styles.detected} accessibilityLiveRegion="polite">
        <View style={styles.platformChip}>
          <Text style={styles.platformChipLabel}>{fr.spotter.platformName[detection.platform]}</Text>
        </View>
        <Text style={styles.detectedLabel}>{fr.spotter.detected[detection.platform]}</Text>
      </View>
    );
  }
  if (detection.kind === "unsupported") return <ErrorMessage style={styles.feedback}>{fr.spotter.unsupportedLink}</ErrorMessage>;
  if (detection.kind === "not_a_link") return <ErrorMessage style={styles.feedback}>{fr.spotter.notALink}</ErrorMessage>;
  if (detection.kind === "not_a_video") return <ErrorMessage style={styles.feedback}>{fr.spotter.notAVideo[detection.platform]}</ErrorMessage>;
  return null;
}

function prepareErrorMessage(error: unknown): string {
  const kind = prepareFailureKind(error);
  return kind === "network" ? fr.spotter.networkError : kind === "server" ? fr.spotter.serverError : fr.spotter.prepareError;
}

export default function SpotterScreen() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [recent, setRecent] = useState<{ searchId: string; piece: Piece }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"link" | "photo" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const detection = detectLink(link);
  const canContinue = detection.kind === "supported" && busy === null;

  const loadRecent = useCallback(() => getRecentSearches().then(setRecent).catch(() => {}), []);
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

  async function handlePaste() {
    setMessage(null);
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || detectLink(text).kind === "not_a_link") {
        setMessage(fr.spotter.pasteEmpty);
        return;
      }
      setLink(text.trim());
    } catch {
      // Web : le navigateur a refusé la lecture du presse-papiers.
      setMessage(fr.spotter.pasteDenied);
    }
  }

  async function handleContinue() {
    if (detection.kind !== "supported") return;
    setMessage(null);
    setBusy("link");
    try {
      const draft = await beginFromLink(detection.url, detection.platform);
      router.push({ pathname: "/spot/apercu", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      setMessage(prepareErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleImportPhoto() {
    setMessage(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "denied") {
      setMessage(fr.spotter.photoDenied);
      return;
    }
    if (picked.kind !== "picked") return;
    setBusy("photo");
    try {
      const draft = await beginFromPhoto(picked.uri, { width: picked.width, height: picked.height });
      router.push({ pathname: "/spot/ciblage", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      setMessage(prepareErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={color.encre} />}
        >
          <Text style={styles.title} accessibilityRole="header">
            {fr.spotter.title}
          </Text>
          <Text style={styles.lead}>{fr.spotter.lead}</Text>

          <Text style={styles.label}>{fr.spotter.linkLabel}</Text>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={link}
              onChangeText={(text) => {
                setLink(text);
                setMessage(null);
              }}
              placeholder={fr.spotter.linkPlaceholder}
              placeholderTextColor={color.acier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              accessibilityLabel={fr.spotter.linkLabel}
            />
            <Pressable onPress={handlePaste} hitSlop={10} style={styles.pasteButton} accessibilityRole="button">
              <ClipboardIcon size={16} tint={color.vert} />
              <Text style={styles.pasteLabel}>{fr.spotter.paste}</Text>
            </Pressable>
          </View>

          <DetectionCard detection={detection} />
          {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}

          <Pressable
            style={[styles.primary, !canContinue ? styles.primaryDisabled : null]}
            onPress={handleContinue}
            disabled={!canContinue}
            accessibilityRole="button"
          >
            {busy === "link" ? <ActivityIndicator color={color.blanc} /> : null}
            <Text style={styles.primaryLabel}>{busy === "link" ? fr.spotter.preparing : fr.spotter.continue}</Text>
          </Pressable>

          <View style={styles.or}>
            <View style={styles.orLine} />
            <Text style={styles.orLabel}>{fr.spotter.or}</Text>
            <View style={styles.orLine} />
          </View>

          <Pressable style={styles.secondary} onPress={handleImportPhoto} disabled={busy !== null} accessibilityRole="button">
            {busy === "photo" ? <ActivityIndicator color={color.encre} /> : <CameraIcon size={18} tint={color.encre} />}
            <Text style={styles.secondaryLabel}>{fr.spotter.importPhoto}</Text>
          </Pressable>

          {recent.length > 0 ? (
            <View style={styles.recentSection}>
              <Text style={styles.recentTitle} accessibilityRole="header">
                {fr.spotter.recentlySpotted}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
                {recent.map(({ searchId, piece }) => (
                  <Pressable
                    key={searchId}
                    style={styles.recentItem}
                    onPress={() => router.push({ pathname: "/spot/result", params: { searchId } })}
                    accessibilityRole="button"
                    accessibilityLabel={piece.name}
                  >
                    <View style={styles.recentThumb}>
                      {piece.imageUrl ? (
                        <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} fit="cover" />
                      ) : (
                        <ClockIcon size={26} tint={color.acier} />
                      )}
                    </View>
                    <Text style={styles.recentName} numberOfLines={1}>
                      {piece.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  content: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, color: color.encre },
  lead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.xl },
  field: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.filet, gap: space.sm },
  input: { flex: 1, fontSize: font.body, color: color.encre, paddingVertical: 12 },
  pasteButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44 },
  pasteLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  detected: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md },
  platformChip: { backgroundColor: color.encre, borderRadius: radius.full, paddingHorizontal: 11, height: 26, justifyContent: "center" },
  platformChipLabel: { color: color.blanc, fontSize: font.caption, fontWeight: "600" },
  detectedLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  feedback: { fontSize: font.caption, marginTop: space.sm, lineHeight: 18 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: space.lg },
  primaryDisabled: { opacity: 0.45 },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  or: { flexDirection: "row", alignItems: "center", gap: 14, marginVertical: space.lg },
  orLine: { flex: 1, height: 1, backgroundColor: color.filet },
  orLabel: { fontSize: font.caption, color: color.acier },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
  recentSection: { marginTop: space.xxl - space.xs },
  recentTitle: { fontSize: font.body, fontWeight: "600", color: color.encre, marginBottom: space.md },
  recentRow: { gap: space.md },
  recentItem: { width: 104 },
  recentThumb: { width: 104, height: 104, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  recentName: { fontSize: font.caption, color: color.acier, marginTop: 7, lineHeight: 16 },
});
