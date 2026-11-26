import { useState, type ReactNode } from "react";
import { Modal, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
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
    // Image effacée après la recherche (instantané du lecteur, capture de la recherche d'image d'iOS) : rien à recadrer.
    hasDraft: Boolean(draft?.localImageUri),
    hasVideo: Boolean(video),
    remainingMoments: remaining.length,
    fromLink: Boolean(result?.sourceUrl),
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

  /** Le curseur part du dernier moment essayé ; l'image choisie part seule, sans mots (petit lot). */
  function chooseMyself() {
    const start = lastTriedMoment(video);
    router.push({ pathname: "/spot/video", params: start === null ? {} : { start: String(start) } });
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

/** Un seul lien discret, sous la proposition affichée ; il ouvre les corrections. `inline` : sur la ligne
 * du prix de la grande carte, il ne prend que la hauteur de cette ligne (18 points) ; sa zone de 44 points
 * déborde vers le HAUT, sur le nom de la pièce (rien de touchable), jamais vers le bas, où sont les
 * mentions (une vraie boîte, pas une zone élargie : le site l'ignore). Correctif du lot « finitions de l'œil ». */
export function CorrectionsLink({ onPress, style, inline = false }: { onPress: () => void; style?: StyleProp<ViewStyle>; inline?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.link, inline ? styles.linkInline : null, style]} accessibilityRole="button" testID="corrections-link">
      <Text style={inline ? [styles.linkLabel, styles.linkLabelInline] : styles.linkLabel}>{t.result.notRight}</Text>
    </Pressable>
  );
}

/** Ce que la zone du lien `inline` déborde au-dessus de sa ligne : 44 - 18. */
export const CORRECTIONS_LINK_OVERFLOW_UP = 26;

/** `withoutPrice` (prix d'abord, lib/spot-corrections.ts successSheetActions) :
 * voir d'abord, gratuitement, les propositions repliées sans prix ; les
 * corrections, qui relancent une recherche, viennent ensuite. `onDismiss` :
 * la feuille a fini de se fermer (sur le site, le lien qui l'a ouverte vient
 * de reprendre le focus, ce qui fait remonter la page jusqu'à lui). */
export function CorrectionsSheet({
  visible,
  onClose,
  onDismiss,
  withoutPrice,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  withoutPrice?: Action | null;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {t.result.notRight}
        </Text>
        {withoutPrice ? (
          <>
            <Text style={styles.sheetLead}>{t.result.notRightWithoutPriceLead}</Text>
            <ActionButtons secondary={[withoutPrice]} />
          </>
        ) : null}
        <Text style={[styles.sheetLead, withoutPrice ? styles.leadAfter : null]}>{t.result.correctionsLead}</Text>
        {children}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  notice: { marginTop: space.lg },
  link: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  linkLabel: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "400" },
  // Boîte de 44 points (et plus au grand texte) dont seuls les points du bas, ceux du texte, comptent dans la ligne.
  linkInline: { minHeight: 44, marginTop: -CORRECTIONS_LINK_OVERFLOW_UP, paddingTop: CORRECTIONS_LINK_OVERFLOW_UP, justifyContent: "flex-start", alignItems: "flex-start" },
  linkLabelInline: { lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: 10 },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  sheetTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, lineHeight: serifLineHeight.title, color: color.encre },
  sheetLead: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  leadAfter: { marginTop: space.lg },
}));
