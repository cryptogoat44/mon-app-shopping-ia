import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { CameraIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { fetchSearch } from "@/lib/api";
import { getDraft, startDraft, updateDraft, type SpotDraft } from "@/lib/spot-draft";
import { detectLink } from "@/lib/link-detection";
import { importPhotoForSpotter } from "@/lib/image-import";

// Étape 1 : l'image qui sera analysée, montrée AVANT tout lancement (aucun
// crédit consommé ici). Si la pièce n'y figure pas — la vignette de
// couverture d'une vidéo ne montre pas toujours la pièce —, on propose
// d'importer une capture prise au bon moment.
export default function PreviewScreen() {
  const router = useRouter();
  const { searchId } = useLocalSearchParams<{ searchId?: string }>();
  const [draft, setDraft] = useState<SpotDraft | null>(() => getDraft());
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Page rechargée (web) : le brouillon a disparu, on le reconstruit depuis
  // la recherche préparée, quand elle vient d'un lien.
  useEffect(() => {
    if (draft || !searchId) {
      if (!draft) setMissing(true);
      return;
    }
    fetchSearch(searchId)
      .then((search) => {
        const detection = search.sourceUrl ? detectLink(search.sourceUrl) : null;
        if (search.status !== "pending" || !search.sourceUrl || detection?.kind !== "supported") {
          setMissing(true);
          return;
        }
        setDraft(
          startDraft({
            searchId: search.id,
            sourceUrl: search.sourceUrl,
            platform: detection.platform,
            previewUrl: search.thumbnailUrl,
            localImageUri: null,
          })
        );
      })
      .catch(() => setMissing(true));
  }, [draft, searchId]);

  async function handleImportCapture() {
    setMessage(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "denied") {
      setMessage(fr.spotter.photoDenied);
      return;
    }
    if (picked.kind !== "picked") return;
    updateDraft({ localImageUri: picked.uri, imageSize: { width: picked.width, height: picked.height }, crop: null });
    router.push({ pathname: "/spot/ciblage", params: { searchId: searchId ?? "" } });
  }

  function handleTarget() {
    router.push({ pathname: "/spot/ciblage", params: { searchId: searchId ?? "" } });
  }

  if (missing) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.lead}>{fr.preview.missing}</Text>
          <Pressable style={styles.primary} onPress={() => router.replace("/")} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{fr.preview.back}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!draft) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={color.encre} />
        </View>
      </SafeAreaView>
    );
  }

  const platformName = draft.platform === "photo" ? "" : fr.spotter.platformName[draft.platform];
  const imageUri = draft.localImageUri ?? draft.previewUrl;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel="Retour">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.step}>{fr.preview.step}</Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {imageUri ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              {fr.preview.title}
            </Text>
            <Text style={styles.caption}>{draft.localImageUri ? fr.preview.captureCaption : fr.preview.caption(platformName)}</Text>
            <View style={styles.frame}>
              <Image source={{ uri: imageUri }} style={styles.fill} contentFit="contain" accessibilityLabel={fr.preview.title} />
            </View>

            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>{fr.preview.notOnImageTitle}</Text>
              <Text style={styles.caption}>{fr.preview.notOnImageBody}</Text>
              <Pressable onPress={handleImportCapture} style={styles.inlineAction} accessibilityRole="button">
                <CameraIcon size={17} tint={color.vert} />
                <Text style={styles.inlineActionLabel}>{fr.preview.importCapture}</Text>
              </Pressable>
            </View>

            {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}

            <Pressable style={styles.primary} onPress={handleTarget} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{fr.preview.target}</Text>
            </Pressable>
          </>
        ) : (
          // Aucune image récupérable (Instagram sans jeton Meta, Pinterest,
          // vignette absente) : seule voie, la capture d'écran.
          <>
            <Text style={styles.title} accessibilityRole="header">
              {fr.preview.noPreviewTitle}
            </Text>
            <Text style={[styles.lead, styles.spaced]}>{fr.preview.noPreviewBody(platformName)}</Text>
            {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}
            <Pressable style={styles.primary} onPress={handleImportCapture} accessibilityRole="button">
              <CameraIcon size={18} tint={color.blanc} />
              <Text style={styles.primaryLabel}>{fr.preview.importCapture}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { width: 44, height: 44, justifyContent: "center" },
  back: { fontSize: 26, color: color.encre },
  step: { fontSize: font.caption, color: color.acier },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  caption: { fontSize: font.caption, color: color.acier, marginTop: 6, lineHeight: 18 },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  spaced: { marginTop: space.sm },
  frame: { height: 420, marginTop: space.md, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  notice: { marginTop: space.md, padding: space.md, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md },
  noticeTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  inlineAction: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44, marginTop: 2 },
  inlineActionLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  feedback: { fontSize: font.caption, marginTop: space.sm },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
