import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, SafeAreaView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { closeSpotter } from "@/lib/spot-navigation";
import { CheckIcon } from "@/components/icons";
import { ApiError, runSearch } from "@/lib/api";
import { croppedView } from "@/lib/crop-geometry";
import { draftImageUri, getDraft } from "@/lib/spot-draft";
import { freshSearchId, markSearchUsed } from "@/lib/spot-flow";
import { toSpotResult } from "@/lib/spot-result";
import { setLastSpotResult } from "@/api/spotSession";
import type { SpotFailReason } from "@/api/types";

const SLOW_AFTER_MS = 20_000;
type Step = 0 | 1 | 2;

function StepRow({ label, state }: { label: string; state: "done" | "now" | "next" }) {
  return (
    <View style={styles.stepRow} accessibilityState={{ busy: state === "now" }}>
      <View style={[styles.dot, state === "done" ? styles.dotDone : state === "now" ? styles.dotNow : styles.dotNext]}>
        {state === "done" ? <CheckIcon size={11} tint={color.blanc} /> : state === "now" ? <View style={styles.dotInner} /> : null}
      </View>
      <Text style={[styles.stepLabel, state === "next" ? styles.stepLabelNext : null]}>{label}</Text>
    </View>
  );
}

// Étape 3 : l'identification (1 crédit SerpApi). Écran sombre, seul du
// parcours : la zone choisie en grand, parcourue par une fine ligne de
// lumière (fixe si « Réduire les animations » est activé). « Annuler »
// abandonne vraiment la requête côté app ; il ne promet rien sur le crédit,
// qui peut déjà être engagé côté serveur.
export default function AnalysisScreen() {
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;

  const [step, setStep] = useState<Step>(0);
  const [slow, setSlow] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const scan = useRef(new Animated.Value(0)).current;
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(scan, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, scan]);

  useEffect(() => {
    if (!draft || !imageUri) {
      closeSpotter(router);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const stepTimer = setTimeout(() => setStep(1), 1200);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    const finish = (searchId: string | null, failReason: SpotFailReason) => {
      setLastSpotResult({ searchId, status: "failed", pieces: [], similarPieces: [], failReason, query: draft.query });
      router.replace({ pathname: "/spot/result", params: searchId ? { searchId } : {} });
    };

    (async () => {
      let searchId: string | null = null;
      try {
        searchId = await freshSearchId(draft);
        markSearchUsed();
        const search = await runSearch(
          searchId,
          { crop: draft.crop, query: draft.query, imageUri: draft.localImageUri },
          abort.signal
        );
        if (abort.signal.aborted) return;
        setStep(2);
        setLastSpotResult(toSpotResult(search));
        setTimeout(() => router.replace({ pathname: "/spot/result", params: { searchId: search.id } }), 350);
      } catch (error) {
        if (abort.signal.aborted) return; // annulé par l'utilisateur : rien à afficher
        if (error instanceof ApiError && error.status === 429) return finish(null, "rate_limited");
        if (error instanceof ApiError && error.body.error === "preview_unavailable") return finish(null, "needs_photo");
        // Réseau coupé, serveur injoignable, panne : jamais présenté comme
        // « pièce introuvable » (audit Lot Q, ROB-02).
        finish(null, "technical");
      }
    })();

    return () => {
      clearTimeout(stepTimer);
      clearTimeout(slowTimer);
      abort.abort();
    };
    // Une seule identification par ouverture de l'écran.
  }, []);

  function handleCancel() {
    controller.current?.abort();
    router.back();
  }

  function handleClose() {
    controller.current?.abort();
    closeSpotter(router);
  }

  if (!draft || !imageUri) return <View style={styles.screen} />;

  const frameWidth = Math.min(windowWidth - space.lg * 2, 432);
  const maxHeight = Math.min(windowHeight * 0.5, 440);
  const view = draft.imageSize && draft.crop ? croppedView(draft.imageSize, draft.crop, frameWidth, maxHeight) : null;
  const frameHeight = view ? view.frame.height : maxHeight;
  const translateY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, frameHeight] });

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.nav}>
        <Pressable onPress={handleClose} hitSlop={12} style={styles.navClose} accessibilityRole="button">
          <Text style={styles.close}>{fr.spotter.close}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <View style={[styles.frame, { width: view ? view.frame.width : frameWidth, height: frameHeight }]}>
          {view ? (
            // Le positionnement est porté par une View : sur le web, expo-image
            // ignore un décalage négatif posé directement sur l'image.
            <View style={[styles.absolute, view.image]}>
              <Image source={{ uri: imageUri }} style={styles.fill} contentFit="fill" accessibilityIgnoresInvertColors />
            </View>
          ) : (
            <Image source={{ uri: imageUri }} style={styles.fill} contentFit="contain" />
          )}
          {reduceMotion ? null : <Animated.View pointerEvents="none" style={[styles.scanLine, { transform: [{ translateY }] }]} />}
        </View>

        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
          {fr.analysis.title}
        </Text>
        {draft.query ? <Text style={styles.query}>« {draft.query} »</Text> : null}

        <View style={styles.steps}>
          <StepRow label={fr.analysis.stepZone} state={step >= 1 ? "done" : "now"} />
          <StepRow label={fr.analysis.stepSearch} state={step >= 2 ? "done" : step === 1 ? "now" : "next"} />
          <StepRow label={fr.analysis.stepSelect} state={step === 2 ? "now" : "next"} />
        </View>
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {slow ? fr.analysis.slow : fr.analysis.usual}
        </Text>
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.cancel} onPress={handleCancel} accessibilityRole="button">
          <Text style={styles.cancelLabel}>{fr.analysis.cancel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.nuit },
  nav: { height: 47, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 12 },
  navClose: { minWidth: 44, height: 44, justifyContent: "center", alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.surNuit, fontWeight: "600" },
  content: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xs, maxWidth: 480, alignSelf: "center", width: "100%" },
  frame: { alignSelf: "center", borderRadius: radius.sm, overflow: "hidden", backgroundColor: "#1E1C1A" },
  absolute: { position: "absolute" },
  fill: { width: "100%", height: "100%" },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.85)",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.surNuit, marginTop: space.lg, lineHeight: 29 },
  query: { fontSize: font.secondary, color: color.brume, marginTop: 4 },
  steps: { marginTop: space.md, gap: 4 },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 32 },
  dot: { width: 20, height: 20, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  dotDone: { backgroundColor: color.vert },
  dotNow: { borderWidth: 1.5, borderColor: color.surNuit },
  dotNext: { borderWidth: 1.5, borderColor: "#4A4744" },
  dotInner: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.surNuit },
  stepLabel: { fontSize: font.secondary, color: color.surNuit },
  stepLabelNext: { color: color.brume },
  note: { fontSize: font.caption, color: color.brume, marginTop: space.md, lineHeight: 18 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg, maxWidth: 480, alignSelf: "center", width: "100%" },
  cancel: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: "#3A3734", alignItems: "center", justifyContent: "center" },
  cancelLabel: { fontSize: font.body, color: color.surNuit, fontWeight: "600" },
});
