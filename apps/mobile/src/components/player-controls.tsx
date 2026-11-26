// Notre barre de lecture (retours du build 3, fondateur : « le truc rouge où on
// défile ne me convient pas, pourquoi ne pas le faire à notre couleur »).
// TikTok seulement (Instagram n'offre ni commande ni temps). Posée SOUS la
// vidéo, jamais dessus : rien n'est posé sur le lecteur officiel, masqué ni
// modifié (ses commandes sont cachées par ses paramètres officiels,
// lib/player-link.ts). Rangée de 44 pt : lecture/pause, le trait (piste
// `filet`, partie lue et rond `encre` : ivoire en sombre, encre en clair), le
// temps, et le son.
// - Tant qu'aucune durée n'est arrivée (le lecteur ne construit sa vidéo
//   qu'au premier lancement) : trait à 0, sans rond ni temps, il ne prend pas
//   le doigt ; lecture/pause, lui, marche (il relance une lecture automatique
//   refusée, erreur 3002).
// - Glissé et toucher : PanResponder + Animated de React Native seulement (ni
//   gesture-handler ni Reanimated, non initialisés dans l'app ; comme
//   tab-bar.tsx). Pendant le glissé, la position suit le doigt, un seekTo au
//   plus toutes les 250 ms, un dernier au lâcher ; un toucher simple saute à
//   cet endroit. Après un seekTo, les temps plus anciens sont ignorés 400 ms
//   (sinon le rond revient en arrière).
// - Entre deux temps du lecteur : avance linéaire (Animated.timing) ;
//   « Réduire les animations » : saut direct.
// - Son (tranché le 26 novembre 2026) : les commandes de TikTok cachées, il
//   n'y aurait sinon aucun moyen de remettre le son. Trois états : inconnu,
//   activé, muet ; il suit onMute s'il arrive, sinon notre dernière commande.
// - Largeur : celle de la vidéo, jamais moins de 300 pt (controlsRowWidth),
//   dans la largeur de la colonne : sur un petit iPhone ou en grand texte, la
//   vidéo rétrécit et le trait garderait sinon quelques points à peine. Le
//   temps est plafonné en grand texte (TIME_MAX_FONT_SCALE).
// - Pendant le glissé, onDraggingChange bloque le défilement de l'écran (sur
//   iPhone, un défilement qui démarre prend le doigt) ; si le geste est quand
//   même repris, le dernier seekTo part quand même.
// Couleurs : jetons seulement (tests/couleurs-et-logo.test.ts).
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { controlsRowWidth, formatPlayerTime, progressFraction, seekSeconds } from "@/lib/player-state";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { themedStyles } from "@/theme/themed-styles";

export type PlayerSound = "unknown" | "on" | "muted";

/** Un seekTo au plus toutes les 250 ms pendant le glissé. */
const SEEK_THROTTLE_MS = 250;
/** Après un seekTo : les temps du lecteur plus anciens sont ignorés. */
const SEEK_SETTLE_MS = 400;
/** VoiceOver : balayer haut/bas avance ou recule de 2 s. */
const ACCESSIBILITY_STEP_S = 2;
const ICON = 20;
/** Le temps grandit avec le texte, au plus de 30 %. */
export const TIME_MAX_FONT_SCALE = 1.3;

export interface PlayerControlsProps {
  width: number;
  /** Durée de la vidéo (onCurrentTime) ; null tant qu'elle n'est pas arrivée. */
  duration: number | null;
  currentTime: number | null;
  playing: boolean;
  sound: PlayerSound;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  onSound: () => void;
  /** La toute première fois (bouton Lecture = accord) : la rangée au repos, son bouton son éteint. */
  idle?: boolean;
  /** Glissé en cours (true) ou fini (false) : l'écran bloque son défilement pendant ce temps. */
  onDraggingChange?: (dragging: boolean) => void;
}

export function PlayIcon({ size = ICON, fill }: { size?: number; fill: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7.5 5.2v13.6L18.8 12z" fill={fill} />
    </Svg>
  );
}

function PauseIcon({ stroke }: { stroke: string }) {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      <Path d="M8 5.5v13M16 5.5v13" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function SoundIcon({ stroke, muted }: { stroke: string; muted: boolean }) {
  return (
    <Svg width={ICON} height={ICON} viewBox="0 0 24 24">
      <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" fill="none" />
      {muted ? (
        <Path d="M16 9.5l5 5M21 9.5l-5 5" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      ) : (
        <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      )}
    </Svg>
  );
}

export function PlayerControls(p: PlayerControlsProps) {
  const reduceMotion = useReduceMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Position affichée pendant le glissé (fraction), sinon celle du lecteur.
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const lastUpdate = useRef<number | null>(null);
  const lastSeekAt = useRef(0);
  const lastSeekSent = useRef(0);
  const startX = useRef(0);
  const lastTarget = useRef(0);

  const fraction = progressFraction(p.currentTime, p.duration);
  const enabled = fraction !== null && !p.idle;

  // Le PanResponder est créé une fois : il lit l'état du moment ici.
  const live = useRef({ duration: p.duration, trackWidth, enabled, onSeek: p.onSeek, onDraggingChange: p.onDraggingChange });
  live.current = { duration: p.duration, trackWidth, enabled, onSeek: p.onSeek, onDraggingChange: p.onDraggingChange };
  // Trait encore sans largeur : il ne prend pas le doigt (un toucher ramènerait sinon à 0:00).
  const canDrag = () => live.current.enabled && live.current.trackWidth > 0;
  // Rangée retirée en plein glissé (repli sur les commandes de TikTok) : le défilement de l'écran revient.
  const draggingNow = useRef(false);
  function reportDragging(value: boolean) {
    draggingNow.current = value;
    live.current.onDraggingChange?.(value);
  }
  useEffect(
    () => () => {
      if (draggingNow.current) live.current.onDraggingChange?.(false);
    },
    []
  );

  // Avancement entre deux temps du lecteur (jamais pendant le glissé, ni juste après un seekTo).
  useEffect(() => {
    if (dragging || fraction === null) {
      if (fraction === null) progress.setValue(0);
      return;
    }
    const now = Date.now();
    if (now - lastSeekAt.current < SEEK_SETTLE_MS) return;
    const since = lastUpdate.current === null ? 0 : Math.min(1000, now - lastUpdate.current);
    lastUpdate.current = now;
    if (reduceMotion || since === 0) {
      progress.setValue(fraction);
      return;
    }
    const animation = Animated.timing(progress, { toValue: fraction, duration: since, easing: Easing.linear, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [fraction, dragging, reduceMotion, progress]);

  function fractionAt(x: number): number {
    const width = live.current.trackWidth;
    return width > 0 ? Math.min(1, Math.max(0, x / width)) : 0;
  }

  function seekTo(target: number, force: boolean) {
    const { duration, onSeek } = live.current;
    if (duration === null || duration <= 0) return;
    const now = Date.now();
    if (!force && now - lastSeekSent.current < SEEK_THROTTLE_MS) return;
    lastSeekSent.current = now;
    lastSeekAt.current = now;
    onSeek(seekSeconds(target, duration));
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: canDrag,
      onMoveShouldSetPanResponder: canDrag,
      // Le défilement de l'écran ne prend pas le geste en cours.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX;
        const target = fractionAt(startX.current);
        lastTarget.current = target;
        reportDragging(true);
        setDragging(true);
        setDragFraction(target);
        progress.setValue(target);
      },
      onPanResponderMove: (_event, gesture) => {
        const target = fractionAt(startX.current + gesture.dx);
        lastTarget.current = target;
        setDragFraction(target);
        progress.setValue(target);
        seekTo(target, false);
      },
      onPanResponderRelease: (_event, gesture) => {
        const target = fractionAt(startX.current + gesture.dx);
        progress.setValue(target);
        seekTo(target, true);
        lastUpdate.current = null;
        setDragFraction(null);
        setDragging(false);
        reportDragging(false);
      },
      // Geste repris (défilement, appel…) : le dernier endroit atteint part quand même.
      onPanResponderTerminate: () => {
        seekTo(lastTarget.current, true);
        lastUpdate.current = null;
        setDragFraction(null);
        setDragging(false);
        reportDragging(false);
      },
    })
  ).current;

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (!enabled || p.duration === null) return;
    const now = p.currentTime ?? 0;
    const step = event.nativeEvent.actionName === "increment" ? ACCESSIBILITY_STEP_S : event.nativeEvent.actionName === "decrement" ? -ACCESSIBILITY_STEP_S : 0;
    if (step === 0) return;
    lastSeekAt.current = Date.now();
    const target = seekSeconds((now + step) / p.duration, p.duration);
    progress.setValue(target / p.duration);
    p.onSeek(target);
  }

  const shownTime = dragFraction !== null && p.duration !== null ? dragFraction * p.duration : (p.currentTime ?? 0);
  const total = p.duration ?? 0;
  const timeText = enabled ? `${formatPlayerTime(shownTime)} / ${formatPlayerTime(total)}` : null;
  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, trackWidth)], extrapolate: "clamp" });
  const knob = dragging ? 14 : 10;
  const knobLeft = progress.interpolate({ inputRange: [0, 1], outputRange: [-knob / 2, Math.max(0, trackWidth) - knob / 2], extrapolate: "clamp" });
  const soundLabel = p.sound === "on" ? t.player.controls.mute : p.sound === "muted" ? t.player.controls.unmute : t.player.controls.sound;

  return (
    <View style={[styles.row, { width: controlsRowWidth(p.width) }]}>
      <Pressable
        onPress={p.playing ? p.onPause : p.onPlay}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={p.playing ? t.player.controls.pause : t.player.controls.play}
      >
        {p.playing ? <PauseIcon stroke={color.encre} /> : <PlayIcon fill={color.encre} />}
      </Pressable>
      <View
        style={styles.trackZone}
        onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.player.controls.position}
        accessibilityState={{ disabled: !enabled }}
        accessibilityValue={
          enabled && p.duration !== null
            ? { min: 0, max: Math.round(p.duration), now: Math.round(p.currentTime ?? 0), text: t.player.controls.positionValue(formatPlayerTime(p.currentTime ?? 0), formatPlayerTime(p.duration)) }
            : undefined
        }
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={onAccessibilityAction}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={[styles.track, dragging ? styles.trackDragging : null]}>
          <Animated.View style={[styles.fill, { width: fillWidth }]} />
        </View>
        {enabled ? <Animated.View pointerEvents="none" style={[styles.knob, { width: knob, height: knob, borderRadius: knob / 2, marginTop: -knob / 2, left: knobLeft }]} /> : null}
      </View>
      {timeText ? (
        <Text style={styles.time} numberOfLines={1} maxFontSizeMultiplier={TIME_MAX_FONT_SCALE}>
          {timeText}
        </Text>
      ) : null}
      <Pressable onPress={p.onSound} disabled={p.idle} style={styles.button} accessibilityRole="button" accessibilityLabel={soundLabel} accessibilityState={{ disabled: Boolean(p.idle) }}>
        <SoundIcon stroke={color.acier} muted={p.sound === "muted"} />
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", minHeight: 44, gap: space.xs, maxWidth: "100%" },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  trackZone: { flex: 1, height: 44, justifyContent: "center" },
  track: { height: 2, borderRadius: 2, backgroundColor: color.filet, overflow: "hidden" },
  trackDragging: { height: 4 },
  fill: { height: "100%", borderRadius: 2, backgroundColor: color.encre },
  knob: { position: "absolute", top: "50%", backgroundColor: color.encre },
  time: { fontSize: font.caption, color: color.acier, fontVariant: ["tabular-nums"], paddingLeft: space.xs },
}));
