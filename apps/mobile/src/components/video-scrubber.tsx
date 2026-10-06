import { useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { Image } from "expo-image";
import { t } from "@/i18n";
import { color, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { clampTime, formatClock, formatClockTenths, ratioOfTime, timeAtRatio, type FramePreview } from "@/lib/video-timeline";

/** Hauteur de la frise : nettement au-dessus des 44 pt d'une zone tactile. */
const STRIP_HEIGHT = 56;
const CURSOR_WIDTH = 4;
/** Pas des gestes d'accessibilité (balayage vers le haut ou le bas). */
const ACCESSIBILITY_STEP_MS = 1000;

// Frise de la vidéo (lot 4) : des vignettes réparties sur toute la durée,
// et un curseur à faire glisser jusqu'au bon moment. Une zone transparente,
// au-dessus de tout, reçoit le doigt (ou la souris) : sa position donne le
// moment. Pendant le glissement, la page ne défile pas (`onDragChange`, comme
// le recadrage). Sur iPhone, le geste « retour » du système (glisser vers la
// droite) coupait le curseur : il est désactivé sur cet écran (voir
// app/(app)/_layout.tsx). Lecteurs d'écran : curseur réglable, une seconde par geste.
export function VideoScrubber({
  durationMs,
  timeMs,
  thumbnails,
  count,
  onChange,
  onDragChange,
}: {
  durationMs: number;
  timeMs: number;
  /** null pendant leur préparation. */
  thumbnails: FramePreview[] | null;
  count: number;
  /** `done` : le doigt vient d'être levé. */
  onChange: (timeMs: number, done: boolean) => void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  // Valeurs à jour pour le gestionnaire de gestes, créé une seule fois.
  const latest = useRef({ width, durationMs, onChange, onDragChange });
  latest.current = { width, durationMs, onChange, onDragChange };
  const lastTime = useRef<number | null>(null);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        latest.current.onDragChange?.(true);
        report(event, false);
      },
      onPanResponderMove: (event) => report(event, false),
      onPanResponderRelease: (event) => {
        report(event, true);
        latest.current.onDragChange?.(false);
      },
      // Geste interrompu (par le système) : on garde le dernier moment atteint.
      onPanResponderTerminate: () => {
        if (lastTime.current !== null) latest.current.onChange(lastTime.current, true);
        latest.current.onDragChange?.(false);
      },
    })
  ).current;

  function report(event: GestureResponderEvent, done: boolean) {
    const { width: stripWidth, durationMs: duration, onChange: notify } = latest.current;
    if (stripWidth <= 0) return;
    lastTime.current = timeAtRatio(event.nativeEvent.locationX / stripWidth, duration);
    notify(lastTime.current, done);
  }

  const cursorLeft = ratioOfTime(timeMs, durationMs) * width - CURSOR_WIDTH / 2;

  return (
    <View style={styles.strip} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.thumbnails} pointerEvents="none">
        {Array.from({ length: count }, (_, index) => {
          const image = thumbnails?.[index];
          return image ? <Image key={index} source={image} style={styles.thumbnail} contentFit="cover" /> : <View key={index} style={[styles.thumbnail, styles.placeholder]} />;
        })}
      </View>
      <View style={[styles.cursor, { left: Math.max(0, Math.min(cursorLeft, width - CURSOR_WIDTH)) }]} pointerEvents="none" />
      <View
        style={StyleSheet.absoluteFill}
        {...responder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t.video.scrubber}
        accessibilityValue={{ text: t.video.position(formatClockTenths(timeMs, t.video.decimalSeparator), formatClock(durationMs)) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const step = event.nativeEvent.actionName === "increment" ? ACCESSIBILITY_STEP_MS : -ACCESSIBILITY_STEP_MS;
          onChange(clampTime(timeMs + step, durationMs), true);
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  strip: { height: STRIP_HEIGHT, borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  thumbnails: { flex: 1, flexDirection: "row" },
  thumbnail: { flex: 1, height: STRIP_HEIGHT },
  placeholder: { backgroundColor: color.plinthe, borderRightWidth: 1, borderRightColor: color.porcelaine },
  cursor: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: CURSOR_WIDTH,
    borderRadius: CURSOR_WIDTH / 2,
    backgroundColor: color.blanc,
    borderWidth: 1,
    borderColor: color.encre,
  },
}));
