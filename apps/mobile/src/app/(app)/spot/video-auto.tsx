import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchConsentStatus, recordVideoAiChoice } from "@/lib/api";
import { track } from "@/lib/analytics";
import { hasCurrentConsent } from "@/lib/policy-notice";
import { prepareErrorMessage } from "@/lib/spot-flow";
import { closeSpotter } from "@/lib/spot-navigation";
import { getSpotVideo, holdSpotVideo, letGoSpotVideo } from "@/lib/spot-video";
import { analyzeVideo, prepareMoment } from "@/lib/video-auto";
import { PhaseView, type AutoPhase, type PhaseActions } from "@/components/video-auto-views";
import { themedStyles } from "@/theme/themed-styles";
import type { OpenedVideo } from "@/lib/video-timeline";

// Étape 1 d'une vidéo, en automatique (lot 4, temps 1 bis) : quelques mots,
// puis tout le reste se fait seul — meilleurs moments, cadrage de la pièce,
// identification. Au premier usage, le consentement est demandé ; sans lui,
// aucune image ne part et le curseur manuel reste toujours proposé.
export default function VideoAutoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ query?: string }>();
  const [phase, setPhase] = useState<AutoPhase>({ kind: "checking" });
  const [query, setQuery] = useState(typeof params.query === "string" ? params.query : "");
  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  // Chaque lancement a son numéro : le résultat d'un lancement annulé est ignoré.
  const run = useRef(0);
  const controller = useRef<AbortController | null>(null);

  // La vidéo reste ouverte tant que cet écran est dans le parcours (essayer
  // un autre moment, curseur manuel) ; libérée quand on quitte le Spotter.
  useEffect(() => {
    holdSpotVideo();
    return letGoSpotVideo;
  }, []);

  async function checkConsent() {
    setPhase({ kind: "checking" });
    try {
      setConsented(hasCurrentConsent(await fetchConsentStatus(), "analyse_video_ia"));
      setPhase({ kind: "ask" });
    } catch {
      setPhase({ kind: "check_failed" });
    }
  }

  useEffect(() => {
    void checkConsent();
    // Une vérification à l'ouverture de l'écran.
  }, []);

  async function identifyBest(video: OpenedVideo, id: number) {
    try {
      const draft = await prepareMoment(video, 0);
      if (id !== run.current) return;
      setPhase({ kind: "ask" });
      router.push({ pathname: "/spot/analysis", params: { searchId: draft.searchId ?? "" } });
    } catch (error) {
      if (id === run.current) setPhase({ kind: "prepare_failed", message: prepareErrorMessage(error) });
    }
  }

  async function start() {
    const video = getSpotVideo();
    if (!video) return closeSpotter(router);
    const id = (run.current += 1);
    const abort = new AbortController();
    controller.current = abort;
    setPhase({ kind: "working", step: "frames" });
    const outcome = await analyzeVideo(video, query, (step) => id === run.current && setPhase({ kind: "working", step }), abort.signal);
    if (id !== run.current || outcome.kind === "cancelled") return;
    if (outcome.kind === "not_found") return setPhase({ kind: "not_found" });
    if (outcome.kind === "failed") {
      const { reason } = outcome;
      if (reason !== "consent") return setPhase({ kind: "failed", reason });
      // Accord retiré entre-temps (sur un autre appareil, par exemple).
      setConsented(false);
      return setPhase({ kind: "consent" });
    }
    await identifyBest(video, id);
  }

  function handleFind() {
    if (consented) void start();
    else setPhase({ kind: "consent" });
  }

  function handleCancel() {
    run.current += 1;
    controller.current?.abort();
    setPhase({ kind: "ask" });
  }

  async function handleAccept() {
    setSaving(true);
    setConsentError(null);
    try {
      await recordVideoAiChoice(true);
    } catch {
      setConsentError(t.videoAuto.consentFailed);
      return;
    } finally {
      setSaving(false);
    }
    track("video_ai_consent", { decision: "granted", context: "first_use" });
    setConsented(true);
    void start();
  }

  async function handleDecline() {
    setSaving(true);
    try {
      await recordVideoAiChoice(false);
      track("video_ai_consent", { decision: "declined", context: "first_use" });
    } catch {
      // Refus non enregistré (réseau) : sans conséquence — aucune image ne
      // part sans accord ; la question sera simplement reposée.
    } finally {
      setSaving(false);
    }
    setPhase({ kind: "ask" });
    chooseMyself();
  }

  function chooseMyself() {
    router.push("/spot/video");
  }

  // Les moments sont déjà trouvés : réessayer ne refait que la préparation (aucun appel à l'IA).
  function retryPrepare() {
    const video = getSpotVideo();
    if (!video) return closeSpotter(router);
    setPhase({ kind: "working", step: "ai" });
    void identifyBest(video, (run.current += 1));
  }

  const actions: PhaseActions = {
    query,
    onQuery: setQuery,
    saving,
    consentError,
    find: handleFind,
    cancel: handleCancel,
    accept: () => void handleAccept(),
    decline: () => void handleDecline(),
    policy: () => router.push("/confidentialite"),
    chooseMyself,
    retryCheck: () => void checkConsent(),
    retryAnalysis: () => void start(),
    retryPrepare,
    editQuery: () => setPhase({ kind: "ask" }),
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.step}>{t.videoAuto.step}</Text>
        <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <PhaseView phase={phase} actions={actions} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  back: { fontSize: 26, color: color.encre },
  step: { fontSize: font.caption, color: color.acier },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
}));
