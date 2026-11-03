import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { draftImageUri, getDraft } from "@/lib/spot-draft";
import { checkSearch, identifyDraft, type IdentifyOutcome } from "@/lib/spot-identify";
import { notifyAppForeground, recheckOnReturn, type UnsettledState } from "@/lib/spot-recovery";
import { useForegroundReturn } from "@/lib/use-foreground-return";
import { track } from "@/lib/analytics";
import { SpotWaitingScreen } from "@/components/spot-waiting";
import { SearchRecoveryView } from "@/components/search-recovery";
import { themedStyles } from "@/theme/themed-styles";

const SLOW_AFTER_MS = 20_000;

// Identification après une correction (recadrage, autre moment de la vidéo,
// image choisie au curseur) : 1 crédit SerpApi. Même écran d'attente que le
// parcours unique (lot 4 ter). « Annuler » abandonne la requête côté app ; il
// ne promet rien sur le crédit, qui peut déjà être engagé — le numéro reste
// dans le brouillon : relancée à l'identique, la recherche est relue, pas
// repayée. Recherche coupée : « Relancer » ou « Vérifier à nouveau », jamais
// de relance sans geste (lib/spot-recovery.ts).
export default function AnalysisScreen() {
  const router = useRouter();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;
  const controller = useRef<AbortController | null>(null);
  const [unsettled, setUnsettled] = useState<{ searchId: string; state: UnsettledState } | null>(null);

  /** Une tâche à la fois (la précédente est abandonnée) : son issue ouvre le
   * résultat, ou dit où en est la recherche. */
  function follow(task: (signal: AbortSignal) => Promise<IdentifyOutcome>) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setUnsettled(null);
    void task(abort.signal).then((outcome) => {
      if (abort.signal.aborted || outcome.kind === "cancelled") return;
      if (outcome.kind === "unsettled") return setUnsettled({ searchId: outcome.searchId, state: outcome.state });
      router.replace({ pathname: "/spot/result", params: outcome.searchId ? { searchId: outcome.searchId } : {} });
    });
  }
  const recheck = (searchId: string) => follow((signal) => checkSearch(searchId, signal));
  function relaunch() {
    const current = getDraft();
    if (!current) return closeSpotter(router);
    follow((signal) => identifyDraft(current, signal));
  }

  useEffect(() => {
    if (!draft || !imageUri) {
      closeSpotter(router);
      return;
    }
    follow((signal) => identifyDraft(draft, signal));
    // Quitter l'écran abandonne la requête ; son numéro reste dans le brouillon.
    return () => controller.current?.abort();
    // Une seule identification par ouverture de l'écran.
  }, []);

  // Retour dans l'app : l'identification en cours relit sa recherche ; une
  // recherche restée sans issue est relue (gratuit), jamais relancée seule.
  useForegroundReturn(() => {
    notifyAppForeground();
    if (unsettled && recheckOnReturn(unsettled.state)) recheck(unsettled.searchId);
  });

  function handleCancel() {
    controller.current?.abort();
    track("spot_cancelled");
    router.back();
  }

  function handleClose() {
    controller.current?.abort();
    closeSpotter(router);
  }

  if (!draft || !imageUri) return <View style={styles.screen} />;

  if (unsettled) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.nav}>
          <Pressable onPress={handleClose} hitSlop={12} style={styles.navClose} accessibilityRole="button">
            <Text style={styles.close}>{t.spotter.close}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <SearchRecoveryView
            state={unsettled.state}
            onRelaunch={relaunch}
            onCheck={() => recheck(unsettled.searchId)}
            back={{ label: t.common.back, onPress: () => router.back() }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SpotWaitingScreen
      image={{ source: { uri: imageUri }, size: draft.imageSize, crop: draft.crop }}
      title={t.analysis.title}
      usual={t.analysis.usual}
      slowAfterMs={SLOW_AFTER_MS}
      onCancel={handleCancel}
      onClose={handleClose}
    />
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.nuit },
  page: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 12 },
  navClose: { minWidth: 44, height: 44, justifyContent: "center", alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
}));
