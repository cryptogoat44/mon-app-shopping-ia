import { useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { SpotResult } from "@/api/types";
import { ActionButtons, type Action } from "@/components/spot-launch-views";
import { LinkNotice } from "@/components/link-notice";
import type { Correction, CorrectionContext } from "@/lib/spot-corrections";
import { getDraft } from "@/lib/spot-draft";
import { getSpotVideo } from "@/lib/spot-video";
import { useVideoImport } from "@/lib/use-video-import";
import { lastTriedMoment, prepareMoment, remainingMoments } from "@/lib/video-auto";
import { themedStyles } from "@/theme/themed-styles";

/** Ce qui peut être corrigé sur l'écran Résultat, et comment (lot 4 ter). */
export function useCorrections(result: SpotResult | null, onMessage: (message: string | null) => void) {
  const router = useRouter();
  const draft = getDraft();
  const video = getSpotVideo();
  const remaining = remainingMoments(video);
  const [preparing, setPreparing] = useState(false);
  const { importing, importVideo } = useVideoImport(onMessage);
  const context: CorrectionContext = {
    hasDraft: Boolean(draft),
    hasVideo: Boolean(video),
    remainingMoments: remaining.length,
    fromLink: Boolean(result?.sourceUrl ?? draft?.sourceUrl),
  };

  // Chaque autre moment est un geste de la personne : une identification consentie.
  async function tryAnother() {
    const rank = remaining[0];
    if (!video || rank === undefined) return;
    onMessage(null);
    setPreparing(true);
    try {
      await prepareMoment(video, rank);
      router.replace({ pathname: "/spot/analysis", params: {} });
    } catch {
      onMessage(t.video.frameError);
    } finally {
      setPreparing(false);
    }
  }

  /** Le curseur part du dernier moment essayé ; les mots suivent jusqu'au recadrage. */
  function chooseMyself() {
    const start = lastTriedMoment(video);
    const query = (draft?.query ?? result?.query ?? "").trim();
    router.push({ pathname: "/spot/video", params: { ...(start === null ? {} : { start: String(start) }), ...(query ? { query } : {}) } });
  }

  const actions: Record<Correction, Action> = {
    reframe: { label: t.result.reframe, onPress: () => router.replace({ pathname: "/spot/ciblage", params: {} }) },
    try_another: { label: t.videoAuto.tryAnother(remaining.length), onPress: () => void tryAnother(), busy: preparing },
    choose_myself: { label: t.videoAuto.chooseMyself, onPress: chooseMyself },
    retry: { label: t.result.retry, onPress: () => router.replace({ pathname: "/spot/analysis", params: {} }) },
    add_video: { label: t.linkNotice.addVideo, onPress: () => void importVideo(), busy: importing },
  };
  return { context, actions, addVideo: () => void importVideo(), importing };
}

/** Corrections : la plus utile en bouton principal ; une ancienne recherche
 * par lien explique plutôt comment ajouter la vidéo. */
export function CorrectionButtons({ list, actions, onAddVideo, importing }: { list: Correction[]; actions: Record<Correction, Action>; onAddVideo: () => void; importing: boolean }) {
  if (list.length === 1 && list[0] === "add_video") return <LinkNotice style={styles.notice} onAddVideo={onAddVideo} busy={importing} />;
  const [first, ...rest] = list.map((correction) => actions[correction]);
  return <ActionButtons primary={first} secondary={rest} />;
}

/** Un seul lien discret sous les résultats ; il ouvre les corrections. */
export function CorrectionsLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.link} accessibilityRole="button">
      <Text style={styles.linkLabel}>{t.result.notRight}</Text>
    </Pressable>
  );
}

export function CorrectionsSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {t.result.notRight}
        </Text>
        <Text style={styles.sheetLead}>{t.result.correctionsLead}</Text>
        {children}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  notice: { marginTop: space.lg },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline" },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: 10 },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  sheetTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  sheetLead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
}));
