// Lot « vidéo auto » : les vues de l'analyse d'une vidéo à partir de son lien,
// sur l'écran « vidéo partagée » (spot/lecteur) — la question, l'attente en
// deux étapes, les moments trouvés (image et cadre de la pièce), l'échec.
// Les images des moments restent en mémoire (« data: ») : expo-image ne les
// met dans aucun cache (cachePolicy « none »), rien n'est écrit sur l'appareil.
import { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { VIDEO_AI } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { ActionButtons, PhotoFrame, QueryInput, type Action } from "@/components/spot-launch-views";
import { containBox, cropToBox } from "@/lib/crop-geometry";
import type { PieceZone } from "@/lib/piece-trace";
import {
  LINK_SLOW_MS,
  cleanQuery,
  linkFailureView,
  linkWaitingStep,
  momentClock,
  queryProblemMessage,
  type LinkAnalysis,
  type LinkFailureAction,
  type LinkFailureInfo,
  type LinkMoment,
  type QueryProblem,
} from "@/lib/video-link-analysis";
import { themedStyles } from "@/theme/themed-styles";

/** « Que cherchez-vous dans cette vidéo ? », puis « Trouver la pièce ». */
export function LinkAskView({
  query,
  onQuery,
  onFind,
  problem,
  checking,
}: {
  query: string;
  onQuery: (value: string) => void;
  onFind: () => void;
  problem: QueryProblem | null;
  /** Accord en cours de vérification (réseau lent). */
  checking: boolean;
}) {
  const disabled = cleanQuery(query).length < VIDEO_AI.queryMinLength || checking;
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLinkAuto.title}
      </Text>
      <QueryInput
        value={query}
        onChangeText={onQuery}
        onSubmit={() => !disabled && onFind()}
        autoFocus
        testID="video-link-query"
        placeholder={t.videoLinkAuto.placeholder}
        label={t.videoLinkAuto.title}
      />
      <Text style={styles.help}>{t.videoLinkAuto.help}</Text>
      {problem ? <ErrorMessage style={styles.message}>{queryProblemMessage(problem)}</ErrorMessage> : null}
      <Pressable
        style={[styles.primary, disabled ? styles.primaryDisabled : null]}
        onPress={onFind}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled, busy: checking }}
      >
        {checking ? <ActivityIndicator color={color.blanc} /> : null}
        <Text style={[styles.primaryLabel, disabled ? styles.primaryLabelDisabled : null]}>{t.videoLinkAuto.find}</Text>
      </Pressable>
      <Text style={styles.note}>{t.videoLinkAuto.privacy}</Text>
    </>
  );
}

function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, now - startedAt);
}

/** Attente : les deux étapes (la récupération de la vidéo, puis l'IA), la durée habituelle, « Annuler ». */
export function LinkWaitingView({ startedAt, query, onCancel }: { startedAt: number; query: string; onCancel: () => void }) {
  const elapsed = useElapsed(startedAt);
  const step = linkWaitingStep(elapsed);
  const slow = elapsed >= LINK_SLOW_MS;
  const steps = t.videoLinkAuto.waiting.steps;
  useEffect(() => {
    const label = steps[step];
    if (label) AccessibilityInfo.announceForAccessibility(label);
  }, [step, steps]);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLinkAuto.waiting.title}
      </Text>
      {cleanQuery(query) ? <Text style={styles.query}>{t.common.quoted(cleanQuery(query))}</Text> : null}
      <View style={styles.steps}>
        {steps.map((label, index) => {
          const current = index === step;
          return (
            <View key={label} style={styles.stepRow} accessible accessibilityLabel={t.videoLinkAuto.waiting.stepLabel(label, current)}>
              <View style={styles.stepMark}>{current ? <ActivityIndicator size="small" color={color.encre} /> : <View style={styles.stepDot} />}</View>
              <Text style={[styles.stepText, current ? styles.stepCurrent : null]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note} accessibilityLiveRegion="polite">
        {slow ? t.videoLinkAuto.waiting.slow : t.videoLinkAuto.waiting.usual}
      </Text>
      <ActionButtons secondary={[{ label: t.analysis.cancel, onPress: onCancel }]} />
    </>
  );
}

/** Image d'un moment, entière, avec le cadre de la pièce par-dessus. */
function MomentImage({ moment, maxWidth, maxHeight, label }: { moment: LinkMoment; maxWidth: number; maxHeight: number; label?: string }) {
  const fitted = containBox({ width: maxWidth, height: maxHeight }, moment.size);
  const frame = { width: Math.round(fitted.width), height: Math.round(fitted.height) };
  const box = cropToBox(moment.box, { left: 0, top: 0, ...frame });
  return (
    <View
      style={[styles.momentFrame, frame]}
      accessible={label !== undefined}
      accessibilityRole={label !== undefined ? "image" : undefined}
      accessibilityLabel={label}
    >
      <Image source={{ uri: moment.image }} style={styles.fill} contentFit="fill" cachePolicy="none" accessibilityIgnoresInvertColors />
      <View pointerEvents="none" style={[styles.box, box]}>
        <View style={styles.boxInner} />
      </View>
    </View>
  );
}

const THUMB = { width: 88, height: 112 };

/** Les moments trouvés, sur un seul écran (demande du fondateur, 17 novembre
 * 2026 : le moins d'étapes possible) : les vignettes pour choisir le moment
 * (le meilleur présélectionné), puis « Entourez la pièce » directement sur son
 * image, le cadre de l'IA déjà tracé ; « Lancer la recherche » part aussitôt. */
export function LinkMomentsView({
  analysis,
  selected,
  zone,
  zoneFromAi,
  onSelect,
  onZone,
  onDragChange,
  onSearch,
  onEditQuery,
}: {
  analysis: LinkAnalysis;
  selected: number;
  zone: PieceZone;
  zoneFromAi: boolean;
  onSelect: (rank: number) => void;
  onZone: (zone: PieceZone) => void;
  onDragChange: (dragging: boolean) => void;
  onSearch: () => void;
  onEditQuery: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const moment = analysis.moments[selected] ?? analysis.moments[0];
  if (!moment) return null;
  const count = analysis.moments.length;
  const frameHeight = Math.min(Math.max(windowHeight * 0.45, 240), 440);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLinkAuto.moments.title(count)}
      </Text>
      {count > 1 ? <Text style={styles.help}>{t.videoLinkAuto.moments.lead(count)}</Text> : null}
      {count > 1 ? (
        <View style={styles.thumbs}>
          {analysis.moments.map((item, rank) => {
            const active = rank === selected;
            return (
              <Pressable
                key={`${rank}-${item.timeSeconds}`}
                onPress={() => onSelect(rank)}
                style={[styles.thumb, active ? styles.thumbActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.videoLinkAuto.moments.choose(rank + 1, momentClock(item.timeSeconds))}
              >
                <MomentImage moment={item} maxWidth={THUMB.width} maxHeight={THUMB.height} />
                <Text style={[styles.thumbTime, active ? styles.thumbTimeActive : null]}>{momentClock(item.timeSeconds)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* Une image par moment : le tracé repart du cadre de l'IA à chaque changement de moment. */}
      <PhotoFrame
        key={`${selected}-${moment.timeSeconds}`}
        uri={moment.image}
        zone={zone}
        onChange={onZone}
        onDragChange={onDragChange}
        height={frameHeight}
        caption={zoneFromAi ? t.targeting.aiCaption : t.targeting.caption}
      />
      <ActionButtons primary={{ label: t.videoLinkAuto.moments.search, onPress: onSearch }} secondary={[{ label: t.videoLinkAuto.moments.editQuery, onPress: onEditQuery }]} />
    </>
  );
}

/** Un constat (vidéo privée, refus de la plateforme, pièce non repérée) : pas
 * en rouge, mais annoncé comme un message d'erreur (VoiceOver, lecteurs du site). */
function CalmMessage({ children }: { children: string }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(children);
  }, [children]);
  return (
    <Text style={styles.body} accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

/** Échec, plan B en un geste (lot « recherche confiance ») : un titre, une
 * phrase calme, UN bouton — la capture d'écran le plus souvent, le lien et la
 * description gardés (l'écran s'en charge, `onCapture`) — et au plus un lien
 * discret (« Réessayer », ou la capture quand le bouton est un autre geste).
 * La capture est toujours proposée : jamais d'impasse. `platformName` :
 * « TikTok » ou « Instagram », pour dire qui a refusé. */
export function LinkFailureView({
  info,
  platformName,
  onRetry,
  onEditQuery,
  onCapture,
}: {
  info: LinkFailureInfo;
  platformName?: string;
  onRetry: () => void;
  onEditQuery: () => void;
  onCapture: () => void;
}) {
  const view = linkFailureView(info, getActiveLocale(), platformName);
  const actionOf = (action: LinkFailureAction): Action => {
    if (action === "capture") return { label: t.videoLinkAuto.planB.capture, onPress: onCapture };
    if (action === "retry") return { label: t.common.retry, onPress: onRetry };
    return { label: t.videoLinkAuto.moments.editQuery, onPress: onEditQuery };
  };
  const secondary = view.secondary ? actionOf(view.secondary) : null;
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {view.title}
      </Text>
      {view.isError ? <ErrorMessage style={styles.message}>{view.message}</ErrorMessage> : <CalmMessage>{view.message}</CalmMessage>}
      <ActionButtons primary={actionOf(view.primary)} />
      {view.primary === "capture" ? <Text style={styles.note}>{t.videoLinkAuto.planB.kept}</Text> : null}
      {secondary ? (
        <Pressable onPress={secondary.onPress} style={styles.discreet} accessibilityRole="button">
          <Text style={styles.discreetLabel}>{secondary.label}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: serifLineHeight.title, marginTop: space.md },
  help: { fontSize: font.caption, color: color.acier, marginTop: space.sm, lineHeight: 18 },
  body: { fontSize: font.secondary, color: color.encre, marginTop: space.md, lineHeight: 21 },
  message: { fontSize: font.secondary, marginTop: space.md, lineHeight: 21 },
  note: { fontSize: font.caption, color: color.acier, marginTop: space.md, lineHeight: 18, textAlign: "center" },
  query: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
  steps: { marginTop: space.lg, gap: space.md },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 },
  stepMark: { width: 24, alignItems: "center", justifyContent: "center" },
  stepDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.filet },
  stepText: { flex: 1, fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  stepCurrent: { color: color.encre, fontWeight: "600" },
  preview: { marginTop: space.md, alignItems: "center" },
  momentFrame: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  // Cadre de la pièce : blanc bordé de sombre, lisible sur toute image.
  box: { position: "absolute", borderWidth: 2, borderColor: color.surImage, borderRadius: radius.sm },
  boxInner: { flex: 1, borderWidth: 1, borderColor: color.voileImage, borderRadius: radius.sm },
  thumbs: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  thumb: { padding: space.xs, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent", alignItems: "center", gap: space.xs, minWidth: 44, minHeight: 44 },
  thumbActive: { borderColor: color.vert },
  thumbTime: { fontSize: font.caption, color: color.acier, fontVariant: ["tabular-nums"] },
  thumbTimeActive: { color: color.encre, fontWeight: "600" },
  discreet: { minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "stretch", marginTop: space.xs },
  discreetLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline", textAlign: "center" },
}));
