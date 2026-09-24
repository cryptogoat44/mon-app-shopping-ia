import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { closeSpotter } from "@/lib/spot-navigation";
import { CameraIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { fetchSearch } from "@/lib/api";
import { getDraft, startDraft, updateDraft, type SpotDraft } from "@/lib/spot-draft";
import { detectLink } from "@/lib/link-detection";
import { importPhotoForSpotter } from "@/lib/image-import";
import { beginFromLink, prepareFailureKind } from "@/lib/spot-flow";

// Le geste pour montrer le bon moment de la vidéo : pause, capture,
// import. (Le partage direct d'une capture vers Spotto, lot 4, le
// simplifiera.)
function CaptureSteps({ platformName }: { platformName: string }) {
  const shortcut = fr.preview.screenshotShortcut[Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web"];
  return (
    <View style={styles.steps}>
      {fr.preview.captureSteps(platformName || "l'application", shortcut).map((text, index) => (
        <View key={index} style={styles.stepRow}>
          <Text style={styles.stepNumber}>{index + 1}</Text>
          <Text style={styles.stepText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

// Aucune image récupérable : message selon la cause précise, et la suite à
// donner (corriger le lien, réessayer, ou importer une capture).
function NoPreview({
  draft,
  platformName,
  message,
  retrying,
  onImportCapture,
  onFixLink,
  onRetry,
}: {
  draft: SpotDraft;
  platformName: string;
  message: string | null;
  retrying: boolean;
  onImportCapture: () => void;
  onFixLink: () => void;
  onRetry: () => void;
}) {
  const content = draft.platform === "photo" ? "vidéo" : fr.preview.content[draft.platform];
  const issue = draft.previewIssue ?? null;

  let title: string = fr.preview.noPreviewTitle;
  let body: string = fr.preview.noPreviewBody(platformName);
  let showSteps = false;
  let primary: { label: string; onPress: () => void; busy?: boolean } = { label: fr.preview.importCapture, onPress: onImportCapture };
  let secondary: { label: string; onPress: () => void } | null = null;

  if (issue === "unavailable") {
    title = fr.preview.issue.unavailable.title(content);
    body = fr.preview.issue.unavailable.body(platformName, content);
    primary = { label: fr.preview.fixLink, onPress: onFixLink };
    secondary = { label: fr.preview.importCapture, onPress: onImportCapture };
  } else if (issue === "not_a_video") {
    title = fr.preview.issue.notAVideo.title(content);
    body = fr.preview.issue.notAVideo.body(platformName, content);
    primary = { label: fr.preview.fixLink, onPress: onFixLink };
  } else if (issue === "service_down") {
    title = fr.preview.issue.serviceDown.title(platformName);
    body = fr.preview.issue.serviceDown.body;
    primary = { label: fr.preview.retry, onPress: onRetry, busy: retrying };
    secondary = { label: fr.preview.importCapture, onPress: onImportCapture };
  } else if (issue === "no_official_access") {
    title = fr.preview.issue.noAccess.title;
    body = fr.preview.issue.noAccess.body(platformName);
    showSteps = true;
  }

  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[styles.lead, styles.spaced]}>{body}</Text>
      {showSteps ? <CaptureSteps platformName={platformName} /> : null}
      {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}
      <Pressable style={styles.primary} onPress={primary.onPress} disabled={primary.busy} accessibilityRole="button">
        {primary.busy ? <ActivityIndicator color={color.blanc} /> : primary.label === fr.preview.importCapture ? <CameraIcon size={18} tint={color.blanc} /> : null}
        <Text style={styles.primaryLabel}>{primary.label}</Text>
      </Pressable>
      {secondary ? (
        <Pressable style={styles.secondary} onPress={secondary.onPress} accessibilityRole="button">
          <CameraIcon size={17} tint={color.encre} />
          <Text style={styles.secondaryLabel}>{secondary.label}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

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
  const [stepsOpen, setStepsOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

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

  // TikTok ne répondait pas : on prépare à nouveau (gratuit) et on remplace
  // cet écran par le nouvel aperçu.
  async function handleRetry() {
    if (!draft?.sourceUrl || draft.platform === "photo") return;
    setMessage(null);
    setRetrying(true);
    try {
      const next = await beginFromLink(draft.sourceUrl, draft.platform);
      setDraft(next);
      router.setParams({ searchId: next.searchId ?? "" });
    } catch (error) {
      const kind = prepareFailureKind(error);
      setMessage(kind === "network" ? fr.spotter.networkError : kind === "server" ? fr.spotter.serverError : fr.spotter.prepareError);
    } finally {
      setRetrying(false);
    }
  }

  function handleTarget() {
    router.push({ pathname: "/spot/ciblage", params: { searchId: searchId ?? "" } });
  }

  if (missing) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.lead}>{fr.preview.missing}</Text>
          <Pressable style={styles.primary} onPress={() => closeSpotter(router)} accessibilityRole="button">
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
        <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{fr.spotter.close}</Text>
        </Pressable>
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

            {draft.localImageUri ? null : (
              <View style={styles.notice}>
                <Pressable
                  onPress={() => setStepsOpen((open) => !open)}
                  style={styles.noticeToggle}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: stepsOpen }}
                >
                  <Text style={styles.noticeTitle}>{fr.preview.notOnImageTitle}</Text>
                  <Text style={styles.noticeChevron}>{stepsOpen ? "–" : "+"}</Text>
                </Pressable>
                {stepsOpen ? (
                  <>
                    <Text style={styles.caption}>{fr.preview.notOnImageWhy(platformName)}</Text>
                    <CaptureSteps platformName={platformName} />
                    <Pressable onPress={handleImportCapture} style={styles.inlineAction} accessibilityRole="button">
                      <CameraIcon size={17} tint={color.vert} />
                      <Text style={styles.inlineActionLabel}>{fr.preview.importCapture}</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            )}

            {message ? <ErrorMessage style={styles.feedback}>{message}</ErrorMessage> : null}

            <Pressable style={styles.primary} onPress={handleTarget} accessibilityRole="button">
              <Text style={styles.primaryLabel}>{fr.preview.target}</Text>
            </Pressable>
          </>
        ) : (
          <NoPreview
            draft={draft}
            platformName={platformName}
            message={message}
            retrying={retrying}
            onImportCapture={handleImportCapture}
            onFixLink={() => closeSpotter(router)}
            onRetry={handleRetry}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
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
  noticeToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
  noticeTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre, flex: 1 },
  noticeChevron: { fontSize: 20, color: color.acier, marginLeft: space.sm },
  steps: { marginTop: space.sm, gap: 8 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1, borderColor: color.filet, textAlign: "center", lineHeight: 20, fontSize: font.caption, color: color.encre, fontWeight: "600" },
  stepText: { flex: 1, fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  secondary: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.sm },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "600" },
  inlineAction: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44, marginTop: 2 },
  inlineActionLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  feedback: { fontSize: font.caption, marginTop: space.sm },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
