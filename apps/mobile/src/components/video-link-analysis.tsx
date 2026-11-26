// Lot « vidéo auto » : les vues de l'analyse d'une vidéo à partir de son lien,
// sur l'écran « vidéo partagée » (spot/lecteur) — la question, l'attente en
// deux étapes, les moments trouvés (image et cadre de la pièce), l'échec.
// Les images des moments restent en mémoire (« data: ») : expo-image ne les
// met dans aucun cache (cachePolicy « none »), rien n'est écrit sur l'appareil.
// Lot « propositions » (Parcours 2, 21 novembre 2026) : « Voir les
// propositions de l'IA » sur la question, puis les pièces proposées en
// pastilles (SegmentedChoice) à la place des vignettes ; les noms viennent de
// l'IA, et l'écran le dit.
import { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { VIDEO_AI, type VideoPlatform } from "@monapp/shared-types";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { SegmentedChoice } from "@/components/segmented-choice";
import { ActionButtons, PhotoFrame, QueryInput, type Action } from "@/components/spot-launch-views";
import { track } from "@/lib/analytics";
import { containBox, cropToBox } from "@/lib/crop-geometry";
import type { PieceZone } from "@/lib/piece-trace";
import {
  LINK_SLOW_MS,
  cleanQuery,
  linkFailureView,
  linkWaitingStep,
  linkWaitingSteps,
  momentClock,
  planBChoice,
  queryProblemMessage,
  type LinkAnalysis,
  type LinkFailureAction,
  type LinkFailureInfo,
  type LinkMode,
  type LinkMoment,
  type QueryProblem,
} from "@/lib/video-link-analysis";
import { themedStyles } from "@/theme/themed-styles";

/** « Que cherchez-vous dans cette vidéo ? », puis « Trouver la pièce ».
 * Lot « propositions » : avec `onPieces` (donné seulement si le serveur le
 * permet), une phrase, puis « Voir les propositions de l'IA » en bouton
 * principal, puis « ou décrivez la pièce : », le champ SANS focus d'office
 * (sur iPhone, le clavier cacherait le bouton) et « Trouver la pièce » en
 * bouton secondaire. Sans `onPieces`, l'écran d'avant, à l'identique. */
export function LinkAskView({
  query,
  onQuery,
  onFind,
  problem,
  checking,
  onPieces,
  checkingMode = null,
  focusQuery = false,
}: {
  query: string;
  onQuery: (value: string) => void;
  onFind: () => void;
  problem: QueryProblem | null;
  /** Accord en cours de vérification (réseau lent). */
  checking: boolean;
  /** « Voir les propositions de l'IA » (lot « propositions ») ; absent : l'écran d'avant. */
  onPieces?: () => void;
  /** Le geste dont l'accord est en cours de vérification : son bouton est occupé. */
  checkingMode?: LinkMode | null;
  /** Retour par « Décrire la pièce autrement » : le champ prend le focus. */
  focusQuery?: boolean;
}) {
  if (onPieces) return <LinkAskWithPieces {...{ query, onQuery, onFind, problem, checking, onPieces, checkingMode, focusQuery }} />;
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
        shortPlaceholder={t.videoLinkAuto.placeholderShort}
        label={t.videoLinkAuto.title}
        // Lot « finitions de l'œil » : le champ en bloc plein des autres écrans (plus le champ souligné).
        boxed
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

/** La question avec « Voir les propositions de l'IA » d'abord (lot « propositions »). */
function LinkAskWithPieces({
  query,
  onQuery,
  onFind,
  problem,
  checking,
  onPieces,
  checkingMode,
  focusQuery,
}: {
  query: string;
  onQuery: (value: string) => void;
  onFind: () => void;
  problem: QueryProblem | null;
  checking: boolean;
  onPieces: () => void;
  checkingMode: LinkMode | null;
  focusQuery: boolean;
}) {
  const findDisabled = cleanQuery(query).length < VIDEO_AI.queryMinLength || checking;
  const piecesBusy = checkingMode === "pieces";
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLinkAuto.title}
      </Text>
      <Text style={styles.help}>{t.videoLinkAuto.pieces.lead}</Text>
      <Pressable
        style={styles.primary}
        onPress={onPieces}
        disabled={checking}
        accessibilityRole="button"
        accessibilityState={{ disabled: checking, busy: piecesBusy }}
        testID="video-link-pieces"
      >
        {piecesBusy ? <ActivityIndicator color={color.blanc} /> : null}
        <Text style={styles.primaryLabel}>{t.videoLinkAuto.pieces.show}</Text>
      </Pressable>
      <Text style={styles.or}>{t.videoLinkAuto.pieces.or}</Text>
      <QueryInput
        value={query}
        onChangeText={onQuery}
        onSubmit={() => !findDisabled && onFind()}
        autoFocus={focusQuery}
        testID="video-link-query"
        placeholder={t.videoLinkAuto.placeholder}
        shortPlaceholder={t.videoLinkAuto.placeholderShort}
        label={t.videoLinkAuto.title}
        // Lot « finitions de l'œil » : le champ en bloc plein des autres écrans (plus le champ souligné).
        boxed
      />
      {problem ? <ErrorMessage style={styles.message}>{queryProblemMessage(problem)}</ErrorMessage> : null}
      <Pressable
        style={[styles.secondary, findDisabled ? styles.secondaryDisabled : null]}
        onPress={onFind}
        disabled={findDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: findDisabled, busy: checkingMode === "words" }}
      >
        {checkingMode === "words" ? <ActivityIndicator color={color.encre} /> : null}
        <Text style={[styles.secondaryLabel, findDisabled ? styles.secondaryLabelDisabled : null]}>{t.videoLinkAuto.find}</Text>
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

/** Attente : les deux étapes (la récupération de la vidéo, puis l'IA), la durée habituelle, « Annuler ».
 * Mode « pièces » (lot « propositions ») : « L'IA regarde les pièces… », et pas
 * de description (le texte resté dans le champ ne part pas). */
export function LinkWaitingView({ startedAt, query, mode = "words", onCancel }: { startedAt: number; query: string; mode?: LinkMode; onCancel: () => void }) {
  const elapsed = useElapsed(startedAt);
  const step = linkWaitingStep(elapsed);
  const slow = elapsed >= LINK_SLOW_MS;
  const steps = linkWaitingSteps(mode);
  const shownQuery = mode === "words" ? cleanQuery(query) : "";
  useEffect(() => {
    const label = steps[step];
    if (label) AccessibilityInfo.announceForAccessibility(label);
  }, [step, steps]);
  return (
    <>
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLinkAuto.waiting.title}
      </Text>
      {shownQuery ? <Text style={styles.query}>{t.common.quoted(shownQuery)}</Text> : null}
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

/** Titre des propositions, annoncé à VoiceOver sur iPhone (comme CalmMessage) :
 * l'écran change sans que la personne ait touché le titre. */
function PiecesTitle({ children }: { children: string }) {
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(children);
  }, [children]);
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Les moments trouvés, sur un seul écran (demande du fondateur, 17 novembre
 * 2026 : le moins d'étapes possible) : les vignettes pour choisir le moment
 * (le meilleur présélectionné), puis « Entourez la pièce » directement sur son
 * image, le cadre de l'IA déjà tracé ; « Lancer la recherche » part aussitôt.
 * Lot « propositions » : avec `analysis.labels`, les pièces proposées par
 * l'IA en pastilles (la première présélectionnée) à la place des vignettes ;
 * l'image et le cadre suivent la pièce choisie, et le second geste devient
 * « Décrire la pièce autrement » (`onDescribe`). */
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
  onDescribe,
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
  /** Mode « pièces » : retour au champ, vide (sinon « Modifier la description »). */
  onDescribe?: () => void;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const moment = analysis.moments[selected] ?? analysis.moments[0];
  if (!moment) return null;
  const count = analysis.moments.length;
  const frameHeight = Math.min(Math.max(windowHeight * 0.45, 240), 440);
  const labels = analysis.labels;
  const photo = (
    // Une image par moment : le tracé repart du cadre de l'IA à chaque changement de moment.
    <PhotoFrame
      key={`${selected}-${moment.timeSeconds}`}
      uri={moment.image}
      zone={zone}
      onChange={onZone}
      onDragChange={onDragChange}
      height={frameHeight}
      caption={zoneFromAi ? t.targeting.aiCaption : t.targeting.caption}
    />
  );
  if (labels) {
    const options = labels.map((label, rank) => ({ value: String(rank), label }));
    return (
      <>
        <PiecesTitle>{t.videoLinkAuto.pieces.title(count)}</PiecesTitle>
        <Text style={styles.help}>{t.videoLinkAuto.pieces.hint(count)}</Text>
        <View style={styles.pieces}>
          <SegmentedChoice label={t.videoLinkAuto.pieces.group} options={options} value={String(selected)} onChange={(value) => onSelect(Number(value))} />
        </View>
        {photo}
        <ActionButtons primary={{ label: t.videoLinkAuto.moments.search, onPress: onSearch }} secondary={[{ label: t.videoLinkAuto.pieces.describe, onPress: onDescribe ?? onEditQuery }]} />
      </>
    );
  }
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
      {photo}
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
 * « TikTok » ou « Instagram », pour dire qui a refusé ; `platform` : la même,
 * pour les statistiques du plan B (mesure du parcours). `mode` (lot
 * « propositions ») : en mode « pièces », « Aucune pièce proposée » et le
 * geste « Décrire la pièce autrement » (`onDescribe` : le champ, vide) ;
 * `keptDescription` : faux quand rien n'a été écrit (« Votre lien est
 * gardé. », sans parler de description). */
export function LinkFailureView({
  info,
  platformName,
  platform = null,
  mode = "words",
  keptDescription = true,
  onRetry,
  onEditQuery,
  onDescribe,
  onCapture,
}: {
  info: LinkFailureInfo;
  platformName?: string;
  platform?: VideoPlatform | null;
  mode?: LinkMode;
  keptDescription?: boolean;
  onRetry: () => void;
  onEditQuery: () => void;
  /** Mode « pièces » : « Décrire la pièce autrement » (sinon « Modifier la description », onEditQuery). */
  onDescribe?: () => void;
  onCapture: () => void;
}) {
  const view = linkFailureView(info, getActiveLocale(), platformName, mode);
  // Vidéo privée, supprimée ou refusée : la capture choisie est comptée, avec sa cause.
  const planB = planBChoice(info, platform);
  const capture = () => {
    if (planB) track("plan_b_screenshot_chosen", planB);
    onCapture();
  };
  const actionOf = (action: LinkFailureAction): Action => {
    if (action === "capture") return { label: t.videoLinkAuto.planB.capture, onPress: capture };
    if (action === "retry") return { label: t.common.retry, onPress: onRetry };
    // Le geste « décrire » suit le mode : « Décrire la pièce autrement » après les propositions de l'IA.
    if (mode === "pieces") return { label: t.videoLinkAuto.pieces.describe, onPress: onDescribe ?? onEditQuery };
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
      {view.primary === "capture" ? <Text style={styles.note}>{keptDescription ? t.videoLinkAuto.planB.kept : t.videoLinkAuto.pieces.keptLink}</Text> : null}
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
  momentFrame: { borderRadius: radius.piece, borderCurve: "continuous", overflow: "hidden", backgroundColor: color.plinthe },
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
  // Lot « propositions » : « ou décrivez la pièce : », « Trouver la pièce » en
  // bouton secondaire (couleurs existantes), les pastilles des pièces.
  or: { fontSize: font.secondary, color: color.acier, marginTop: space.lg, lineHeight: 21 },
  secondary: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 48,
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
    marginTop: space.md,
  },
  secondaryDisabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500", textAlign: "center", flexShrink: 1 },
  secondaryLabelDisabled: { color: color.surInactif },
  pieces: { marginTop: space.md },
}));
