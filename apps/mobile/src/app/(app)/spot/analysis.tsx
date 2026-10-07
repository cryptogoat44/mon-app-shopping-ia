import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { color } from "@/theme/tokens";
import { t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { draftImageUri, getDraft } from "@/lib/spot-draft";
import { identifyDraft } from "@/lib/spot-identify";
import { track } from "@/lib/analytics";
import { SpotWaitingScreen } from "@/components/spot-waiting";
import { themedStyles } from "@/theme/themed-styles";

const SLOW_AFTER_MS = 20_000;

// Identification après une correction (recadrage, autre moment de la vidéo,
// image choisie au curseur) : 1 crédit SerpApi. Même écran d'attente que le
// parcours unique (lot 4 ter). « Annuler » abandonne vraiment la requête
// côté app ; il ne promet rien sur le crédit, qui peut déjà être engagé.
export default function AnalysisScreen() {
  const router = useRouter();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!draft || !imageUri) {
      closeSpotter(router);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    void identifyDraft(draft, abort.signal).then((outcome) => {
      if (outcome.kind === "cancelled") return;
      router.replace({ pathname: "/spot/result", params: outcome.searchId ? { searchId: outcome.searchId } : {} });
    });
    return () => abort.abort();
    // Une seule identification par ouverture de l'écran.
  }, []);

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

  return (
    <SpotWaitingScreen
      image={{ source: { uri: imageUri }, size: draft.imageSize, crop: draft.crop }}
      title={t.analysis.title}
      query={draft.query}
      usual={t.analysis.usual}
      slowAfterMs={SLOW_AFTER_MS}
      onCancel={handleCancel}
      onClose={handleClose}
    />
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.nuit },
}));
