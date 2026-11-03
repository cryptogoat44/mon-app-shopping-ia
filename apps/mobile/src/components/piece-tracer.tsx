import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, Text, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Svg, { Path, Rect } from "react-native-svg";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { containBox, type Box, type Size } from "@/lib/crop-geometry";
import { extendTrace, outsidePath, toTracePoint, tracePath, zoneFromTrace, type PieceZone, type TracePoint } from "@/lib/piece-trace";
import { currentDevice } from "@/components/link-notice";
import { themedStyles } from "@/theme/themed-styles";

/** Trait du tracé (couleur d'accent), posé sur un liseré de la couleur
 * opposée : lisible sur n'importe quelle photo, en clair comme en sombre. */
const STROKE = 3;
const HALO = 7;

// Site : ni défilement ni zoom du navigateur sous le doigt, aucun texte
// sélectionné à la souris, et un curseur de dessin (styles propres au web).
const WEB_SURFACE = Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", cursor: "crosshair" } as unknown as ViewStyle) : null;
// iPhone : le parent coupe son défilement pendant le tracé. Sur le site,
// touch-action suffit ; couper le défilement y retirerait la barre de
// défilement d'un ordinateur, et l'image se décalerait sous la souris.
const LOCKS_SCROLL = Platform.OS !== "web";

const percent = (value: number) => Math.round(value * 100);

/** Contour de l'image entière, tracé juste à l'intérieur de ses bords. */
const insideEdge = (image: Box) => ({ x: image.left + HALO / 2, y: image.top + HALO / 2, width: image.width - HALO, height: image.height - HALO });

interface Props {
  uri: string;
  /** Zone choisie (entourée, ou l'image entière) ; null tant que rien n'est choisi. */
  zone: PieceZone | null;
  /** Un tracé retenu : sa zone remplace la précédente. */
  onChange: (zone: PieceZone) => void;
  /** Taille réelle de l'image, une fois chargée. */
  onImageSize?: (size: Size) => void;
  /** Vrai pendant le tracé (iPhone) — le parent coupe alors son défilement. */
  onDragChange?: (dragging: boolean) => void;
  height: number;
}

// « Entourez la pièce » (lot entourer la pièce) : l'image entière, jamais
// rognée ; la personne en fait le tour au doigt (à la souris ou au doigt sur
// le site) et le tracé s'affiche pendant et après le geste. Au lâcher, la
// zone est le rectangle qui l'englobe (lib/piece-trace.ts), tout le reste est
// assombri ; retracer remplace le tout. Un toucher ou un trait qui
// n'entoure rien n'est pas retenu. PanResponder fonctionne au doigt (iPhone)
// comme à la souris (web). VoiceOver : la zone est décrite, et le bouton
// « Utiliser toute l'image », sous l'image, remplace le tracé.
export function PieceTracer({ uri, zone, onChange, onImageSize, onDragChange, height }: Props) {
  const [container, setContainer] = useState<Size>({ width: 0, height });
  const [imageSize, setImageSize] = useState<Size | null>(null);
  // Tracé en cours, affiché pendant le geste.
  const [drawing, setDrawing] = useState<readonly TracePoint[] | null>(null);
  const [rejected, setRejected] = useState(false);

  // Où l'image s'affiche ; null tant que l'image et son cadre ne sont pas mesurés.
  const shownBox = imageSize ? containBox(container, imageSize) : null;
  const imageBox = shownBox && shownBox.width > 0 && shownBox.height > 0 ? shownBox : null;
  // Même source d'un rendu à l'autre : le tracé redessine souvent ce composant.
  const source = useMemo(() => ({ uri }), [uri]);

  // Les gestionnaires de geste sont créés une fois ; ils lisent les valeurs
  // à jour via ces références.
  const latest = useRef({ imageBox, onChange, onDragChange });
  latest.current = { imageBox, onChange, onDragChange };
  const stroke = useRef<{ start: { x: number; y: number }; trace: readonly TracePoint[] } | null>(null);

  // Zone choisie autrement (« Utiliser toute l'image ») : le message s'efface.
  useEffect(() => setRejected(false), [zone]);

  const responder = useMemo(() => {
    function finish(keep: boolean) {
      const current = stroke.current;
      const box = latest.current.imageBox;
      stroke.current = null;
      setDrawing(null);
      if (LOCKS_SCROLL) latest.current.onDragChange?.(false);
      if (!current || !box || !keep) return;
      const crop = zoneFromTrace(current.trace, box);
      if (crop) latest.current.onChange({ crop, trace: current.trace });
      else setRejected(true);
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const box = latest.current.imageBox;
        if (!box) return;
        // Le point de départ dans le cadre, puis les déplacements depuis lui.
        const start = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        stroke.current = { start, trace: [toTracePoint(start.x, start.y, box)] };
        setDrawing(stroke.current.trace);
        setRejected(false);
        if (LOCKS_SCROLL) latest.current.onDragChange?.(true);
      },
      onPanResponderMove: (_event, gesture) => {
        const current = stroke.current;
        const box = latest.current.imageBox;
        if (!current || !box) return;
        const trace = extendTrace(current.trace, toTracePoint(current.start.x + gesture.dx, current.start.y + gesture.dy, box), box);
        if (trace === current.trace) return;
        current.trace = trace;
        setDrawing(trace);
      },
      onPanResponderRelease: () => finish(true),
      // Geste interrompu par le système (appel, défilement) : le tracé partiel
      // est abandonné, la zone d'avant reste.
      onPanResponderTerminate: () => finish(false),
    });
  }, []);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height: measured } = event.nativeEvent.layout;
    setContainer({ width, height: measured });
  }

  const instruction = currentDevice() === "computer" ? t.targeting.instruction.mouse : t.targeting.instruction.finger;
  const message = drawing ? null : rejected ? t.targeting.tooSmall : zone ? null : instruction;
  const shown = drawing ?? zone?.trace ?? null;
  const path = shown && imageBox ? tracePath(shown, imageBox, !drawing) : null;
  const value = !zone ? t.crop.none : zone.trace ? t.crop.value(percent(zone.crop.width), percent(zone.crop.height)) : t.crop.whole;

  return (
    <View style={[styles.container, { height }]} onLayout={handleLayout}>
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        onLoad={(event) => {
          const size = { width: event.source.width, height: event.source.height };
          setImageSize(size);
          onImageSize?.(size);
        }}
        accessibilityIgnoresInvertColors
      />

      {imageBox ? (
        <Svg width={container.width} height={container.height} style={StyleSheet.absoluteFill}>
          {/* Hors de la zone entourée : assombri, pour montrer ce qui sera cherché */}
          {zone?.trace && !drawing ? <Path d={outsidePath(zone.crop, imageBox, container)} fill={color.voileImage} fillRule="evenodd" /> : null}
          {path ? (
            <>
              <Path d={path} fill="none" stroke={color.blanc} strokeWidth={HALO} strokeLinecap="round" strokeLinejoin="round" />
              <Path d={path} fill="none" stroke={color.vert} strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : zone ? (
            // Toute l'image : son contour, dans les couleurs du tracé.
            <>
              <Rect {...insideEdge(imageBox)} fill="none" stroke={color.blanc} strokeWidth={HALO} />
              <Rect {...insideEdge(imageBox)} fill="none" stroke={color.vert} strokeWidth={STROKE} />
            </>
          ) : null}
        </Svg>
      ) : null}

      {message ? (
        <View pointerEvents="none" style={styles.messageRow}>
          <View style={styles.message}>
            <Text style={styles.messageLabel} accessibilityLiveRegion="polite">
              {message}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Au-dessus de tout : reçoit le doigt ou la souris */}
      <View
        {...responder.panHandlers}
        style={[StyleSheet.absoluteFill, WEB_SURFACE]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={t.crop.label}
        // aria-valuetext : lu par VoiceOver comme sur le site (react-native-web ignore accessibilityValue).
        aria-valuetext={value}
        accessibilityHint={t.crop.hint(instruction, t.targeting.wholeImage)}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  container: { width: "100%", backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  messageRow: { position: "absolute", left: space.sm, right: space.sm, bottom: space.sm, alignItems: "center" },
  // Comme les messages brefs de l'app (toast) : lisible sur n'importe quelle photo.
  message: { backgroundColor: color.encre, borderRadius: radius.full, paddingHorizontal: space.md, paddingVertical: 7 },
  messageLabel: { color: color.blanc, fontSize: font.caption, fontWeight: "600", textAlign: "center" },
}));
