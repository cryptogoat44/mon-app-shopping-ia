import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import Svg, { Circle, Defs, Mask, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { containBox, cropToBox, type Box, type Size } from "@/lib/crop-geometry";
import {
  extendTrace,
  framePoints,
  isFrameTrace,
  roundedRectPath,
  smoothPath,
  toTracePoint,
  traceShape,
  traceSurface,
  zoneFromTrace,
  type PieceZone,
  type TracePoint,
} from "@/lib/piece-trace";
import { FRAME_LINE, HEAD_GLOW_STOPS, INSIDE_VEIL, MASK, MESSAGE_PILL, OUTSIDE_VEIL, POWDER, powderTrail, type PowderPath } from "@/lib/powder-trace";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { currentDevice } from "@/components/link-notice";
import { themedStyles } from "@/theme/themed-styles";

/** Coins du cadre de l'image (fin des bandes : le cadre prend la forme de
 * l'image). */
const IMAGE_RADIUS = 14; // = radius.piece du lot « Vitrine » : jeton à l'assemblage
/** Fondu du voile au lâcher, de la lueur, d'un tracé refusé. */
const FADE_MS = 240;
const useNativeDriver = Platform.OS !== "web";

// Site : ni défilement ni zoom du navigateur sous le doigt, aucun texte
// sélectionné à la souris (Safari veut aussi le préfixe -webkit-, que
// react-native-web n'ajoute pas aux styles en ligne), et un curseur de dessin.
// Seulement sur l'image et sa marge : à côté, le doigt fait défiler la page.
const WEB_SURFACE =
  Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: "crosshair" } as unknown as ViewStyle) : null;
// iPhone : le parent coupe son défilement pendant le tracé. Sur le site,
// touch-action suffit ; couper le défilement y retirerait la barre de
// défilement d'un ordinateur, et l'image se décalerait sous la souris.
const LOCKS_SCROLL = Platform.OS !== "web";

/** Site : le menu du clic droit, ouvert pendant un tracé, l'abandonne (sinon
 * le tracé suivait la souris sans bouton appuyé). react-native-web ne donne
 * pas les boutons de la souris, seulement le type d'événement. iPhone : le
 * tracé ne se laisse jamais prendre par le défilement. */
function yieldsGesture(event: GestureResponderEvent): boolean {
  return Platform.OS === "web" && (event.nativeEvent as { type?: string }).type === "contextmenu";
}

const percent = (value: number) => Math.round(value * 100);

/** Contour de l'image entière, un filet juste à l'intérieur de ses bords. */
const insideEdge = (image: Box) => {
  const inset = FRAME_LINE.wholeWidth / 2;
  return { x: image.left + inset, y: image.top + inset, width: image.width - FRAME_LINE.wholeWidth, height: image.height - FRAME_LINE.wholeWidth };
};

/** Une couche de la traînée de poudre : quelques chemins, chacun sa couleur et son opacité. */
function PowderLayerPaths({ paths }: { paths: readonly PowderPath[] }) {
  return (
    <>
      {paths.map((path, index) => (
        <Path key={index} d={path.d} fill={path.color} fillOpacity={path.opacity} />
      ))}
    </>
  );
}

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
// le site). Au lâcher, la zone est le rectangle qui l'englobe
// (lib/piece-trace.ts) ; retracer remplace le tout. Un toucher, un trait ou un
// balayage pour faire défiler la page n'entoure rien : il n'est pas retenu.
// Seuls l'image et une petite marge prennent le doigt ; à côté d'une capture
// verticale, le doigt fait défiler la page. PanResponder fonctionne au doigt
// (iPhone) comme à la souris (web). VoiceOver : la zone est décrite, et le
// bouton « Utiliser toute l'image », sous l'image, remplace le tracé.
//
// Le dessin (lot entourer en poudre, maquette 3-entourer-poudre) : le cadre
// prend la forme de l'image (coins de 14 pt, plus de bandes) ; pendant le
// geste, une traînée de poudre de lumière (épaisse, presque transparente,
// lumineuse au bout du doigt, qui s'estompe derrière) ; au lâcher, la lumière
// suit la forme tracée (masque), jamais le rectangle envoyé. Le dessin ne
// change rien à ce qui est envoyé : le tracé reste sur le téléphone.
export function PieceTracer({ uri, zone, onChange, onImageSize, onDragChange, height }: Props) {
  const [container, setContainer] = useState<Size>({ width: 0, height });
  const [imageSize, setImageSize] = useState<Size | null>(null);
  // Tracé en cours, affiché pendant le geste.
  const [drawing, setDrawing] = useState<readonly TracePoint[] | null>(null);
  // Tracé refusé, qui s'efface en fondu.
  const [fading, setFading] = useState<readonly TracePoint[] | null>(null);
  const [rejected, setRejected] = useState(false);
  const reduceMotion = useReduceMotion();
  // Identifiant du masque, unique par instance ; sans « : » (url(#…) sur le site).
  const maskId = `voile${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const glowId = `${maskId}tete`;

  // Le voile en forme (fondu au lâcher), la lueur du bout du doigt, la
  // traînée d'un tracé refusé : trois opacités de vues, jamais d'attribut SVG
  // animé (iPhone et site, sans reanimated).
  const veil = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const trailFade = useRef(new Animated.Value(1)).current;
  // Vrai entre un tracé retenu et l'arrivée de sa zone : elle s'allume en fondu.
  const released = useRef(false);

  // Où l'image s'affiche ; null tant que l'image et son cadre ne sont pas mesurés.
  const shownBox = imageSize ? containBox(container, imageSize) : null;
  const imageBox = shownBox && shownBox.width > 0 && shownBox.height > 0 ? shownBox : null;
  // Ce qui prend le doigt : l'image et une petite marge autour.
  const surface = imageBox ? traceSurface(imageBox, container) : null;
  // Même source d'un rendu à l'autre : le tracé redessine souvent ce composant.
  const source = useMemo(() => ({ uri }), [uri]);
  const duration = reduceMotion ? 0 : FADE_MS;

  // Les gestionnaires de geste sont créés une fois ; ils lisent les valeurs
  // à jour via ces références.
  const latest = useRef({ imageBox, surface, onChange, onDragChange, duration });
  latest.current = { imageBox, surface, onChange, onDragChange, duration };
  const stroke = useRef<{ start: { x: number; y: number }; trace: readonly TracePoint[] } | null>(null);

  // Zone choisie : le message s'efface. Après un tracé retenu, le voile en
  // forme apparaît en fondu et la lueur s'éteint ; une zone arrivée autrement
  // (« Utiliser toute l'image », cadre de l'IA, retour sur l'écran) s'affiche
  // d'emblée.
  useEffect(() => {
    setRejected(false);
    if (released.current) {
      released.current = false;
      const fade = { duration: latest.current.duration, easing: Easing.out(Easing.cubic), useNativeDriver };
      Animated.parallel([Animated.timing(veil, { ...fade, toValue: 1 }), Animated.timing(glow, { ...fade, toValue: 0 })]).start();
    } else {
      veil.setValue(1);
      glow.setValue(0);
    }
  }, [zone, veil, glow]);

  const responder = useMemo(() => {
    const fade = (value: Animated.Value, toValue: number, done?: Animated.EndCallback) =>
      Animated.timing(value, { toValue, duration: latest.current.duration, easing: Easing.out(Easing.cubic), useNativeDriver }).start(done);
    function finish(keep: boolean) {
      const current = stroke.current;
      const box = latest.current.imageBox;
      stroke.current = null;
      setDrawing(null);
      if (LOCKS_SCROLL) latest.current.onDragChange?.(false);
      const crop = current && box && keep ? zoneFromTrace(current.trace, box) : null;
      if (current && crop) {
        // Retenu : le voile repart de zéro (aucun éclair de l'ancienne zone),
        // puis s'allume en fondu quand la zone arrive.
        released.current = true;
        veil.setValue(0);
        if (Platform.OS !== "web") Haptics.selectionAsync().catch(() => {});
        latest.current.onChange({ crop, trace: current.trace });
        return;
      }
      // Refusé ou interrompu : la traînée s'efface en fondu, la zone d'avant reste.
      fade(glow, 0);
      if (current && current.trace.length > 1) {
        setFading(current.trace);
        trailFade.setValue(1);
        fade(trailFade, 0, ({ finished }) => {
          if (finished) setFading(null);
        });
      }
      if (current && box && keep) setRejected(true);
    }
    return PanResponder.create({
      // Seulement un geste qui commence sur l'image (ou sa marge), une fois
      // l'image mesurée ; jamais pris en cours de route : un défilement
      // commencé ailleurs continue.
      onStartShouldSetPanResponder: () => latest.current.surface !== null,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: yieldsGesture,
      onPanResponderGrant: (event) => {
        const box = latest.current.imageBox;
        const surface = latest.current.surface;
        if (!box || !surface) return;
        // Le point de départ dans le cadre (la surface y est décalée), puis
        // les déplacements depuis lui : le doigt reste suivi hors de la surface.
        const start = { x: surface.left + event.nativeEvent.locationX, y: surface.top + event.nativeEvent.locationY };
        stroke.current = { start, trace: [toTracePoint(start.x, start.y, box)] };
        trailFade.stopAnimation();
        glow.stopAnimation();
        glow.setValue(1);
        setFading(null);
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
      // Geste interrompu (appel, menu du clic droit sur le site) : le tracé
      // partiel est abandonné, la zone d'avant reste.
      onPanResponderTerminate: () => finish(false),
    });
  }, [veil, glow, trailFade]);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height: measured } = event.nativeEvent.layout;
    setContainer({ width, height: measured });
  }

  // Le dessin se fait dans le cadre de l'image (son coin en 0, 0).
  const frameWidth = imageBox?.width ?? 0;
  const frameHeightShown = imageBox?.height ?? 0;
  const frame = useMemo<Box | null>(
    () => (frameWidth && frameHeightShown ? { left: 0, top: 0, width: frameWidth, height: frameHeightShown } : null),
    [frameWidth, frameHeightShown]
  );
  const zoneTrace = zone?.trace ?? null;
  const aiFrame = zoneTrace !== null && isFrameTrace(zoneTrace);
  // La forme éclairée (tracé retenu, ou cadre de l'IA aux coins arrondis).
  const shapePath = useMemo(() => {
    if (!frame || !zone || !zoneTrace) return null;
    if (isFrameTrace(zoneTrace)) return roundedRectPath(cropToBox(zone.crop, frame), FRAME_LINE.frameRadius);
    const shape = traceShape(zoneTrace, frame);
    return shape ? smoothPath(shape, true) : null;
  }, [zone, zoneTrace, frame]);
  // La traînée : le geste en cours, sinon celle du tracé retenu (statique).
  const liveTrace = drawing ?? fading;
  const live = useMemo(() => (liveTrace && frame ? powderTrail(framePoints(liveTrace, frame)) : null), [liveTrace, frame]);
  const kept = useMemo(
    () => (zoneTrace && !aiFrame && frame ? powderTrail(framePoints(zoneTrace, frame)) : null),
    [zoneTrace, aiFrame, frame]
  );
  // La lueur suit la tête du geste (ou du tracé refusé, pendant son fondu).
  const headTrail = liveTrace ? live : kept;

  const instruction = currentDevice() === "computer" ? t.targeting.instruction.mouse : t.targeting.instruction.finger;
  const message = drawing ? null : rejected ? t.targeting.tooSmall : zone ? null : instruction;
  const value = !zone ? t.crop.none : zone.trace ? t.crop.value(percent(zone.crop.width), percent(zone.crop.height)) : t.crop.whole;
  // Une fois l'image mesurée, le cadre prend sa forme : pour une photo en
  // largeur, il perd aussi sa hauteur vide (jamais plus haut que `height`).
  const frameHeight = imageSize && container.width ? Math.min(height, (container.width * imageSize.height) / imageSize.width) : height;

  const messageView = message ? (
    <View pointerEvents="none" style={styles.messageRow}>
      <View style={styles.message}>
        <Text style={styles.messageLabel} accessibilityLiveRegion="polite">
          {message}
        </Text>
      </View>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { height: frameHeight }, imageBox ? null : styles.waiting]} onLayout={handleLayout}>
      <View
        style={[styles.frame, imageBox ? { left: imageBox.left, top: imageBox.top, width: imageBox.width, height: imageBox.height } : StyleSheet.absoluteFill]}
      >
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          // En mémoire seulement : aucune copie de l'image sur le disque (moment
          // d'une vidéo reçu d'un lien, gardé en « data: » ; instantané du lecteur).
          cachePolicy="memory"
          onLoad={(event) => {
            const size = { width: event.source.width, height: event.source.height };
            setImageSize(size);
            onImageSize?.(size);
          }}
          accessibilityIgnoresInvertColors
        />

        {frame ? (
          // Dessin seulement : le doigt le traverse.
          <>
            {/* 1. Le voile qui suit la forme : sombre dehors, à peine ivoire dedans. Pas pendant le geste. */}
            {shapePath && !drawing ? (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: veil }]}>
                <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
                  <Defs>
                    {/* Un masque et non « evenodd » : un tour qui se croise reste clair partout. */}
                    <Mask id={maskId} maskUnits="userSpaceOnUse" x={0} y={0} width={frame.width} height={frame.height}>
                      <Rect x={0} y={0} width={frame.width} height={frame.height} fill={MASK.veiled} />
                      <Path d={shapePath} fill="none" stroke={MASK.softOuter} strokeWidth={MASK.softOuterWidth} strokeLinejoin="round" />
                      <Path d={shapePath} fill="none" stroke={MASK.softInner} strokeWidth={MASK.softInnerWidth} strokeLinejoin="round" />
                      <Path d={shapePath} fill={MASK.clear} />
                    </Mask>
                  </Defs>
                  <Rect x={0} y={0} width={frame.width} height={frame.height} fill={OUTSIDE_VEIL.color} opacity={OUTSIDE_VEIL.opacity} mask={`url(#${maskId})`} />
                  <Path d={shapePath} fill={INSIDE_VEIL.color} opacity={INSIDE_VEIL.opacity} />
                  {/* Cadre de l'IA : un filet ivoire aux coins arrondis (pas de poudre : il n'y a pas eu de geste). */}
                  {aiFrame ? <Path d={shapePath} fill="none" stroke={FRAME_LINE.color} strokeWidth={FRAME_LINE.frameWidth} /> : null}
                </Svg>
              </Animated.View>
            ) : null}

            {/* 2. La traînée du tracé retenu, statique (comme la maquette). */}
            {kept && !drawing ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
                  <PowderLayerPaths paths={kept.halo} />
                  <PowderLayerPaths paths={kept.body} />
                  <PowderLayerPaths paths={kept.core} />
                  <PowderLayerPaths paths={kept.grains} />
                </Svg>
              </View>
            ) : null}

            {/* 3. La traînée du geste en cours, ou d'un tracé refusé qui s'efface. */}
            {live ? (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: drawing ? 1 : trailFade }]}>
                <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
                  <PowderLayerPaths paths={live.halo} />
                  <PowderLayerPaths paths={live.body} />
                  <PowderLayerPaths paths={live.core} />
                  <PowderLayerPaths paths={live.grains} />
                </Svg>
              </Animated.View>
            ) : null}

            {/* 4. La lueur ronde au bout du doigt ; elle s'éteint en fondu au lâcher. */}
            {headTrail?.head ? (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: glow }]}>
                <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
                  <Defs>
                    <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
                      {HEAD_GLOW_STOPS.map((stop) => (
                        <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
                      ))}
                    </RadialGradient>
                  </Defs>
                  <Circle cx={headTrail.head.x} cy={headTrail.head.y} r={POWDER.headGlow} fill={`url(#${glowId})`} />
                </Svg>
              </Animated.View>
            ) : null}

            {/* « Utiliser toute l'image » : un filet ivoire juste à l'intérieur des bords, aucun voile. */}
            {zone && !zoneTrace && !drawing ? (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Svg width={frame.width} height={frame.height} style={StyleSheet.absoluteFill}>
                  <Rect {...insideEdge(frame)} rx={IMAGE_RADIUS} fill="none" stroke={FRAME_LINE.color} strokeWidth={FRAME_LINE.wholeWidth} />
                </Svg>
              </View>
            ) : null}
          </>
        ) : null}

        {imageBox ? messageView : null}
      </View>

      {imageBox ? null : messageView}

      {/* Au-dessus de tout : reçoit le doigt ou la souris, sur l'image et sa
          marge seulement. Avant que l'image soit mesurée, il couvre le cadre
          (pour VoiceOver) sans prendre le doigt. */}
      <View
        {...responder.panHandlers}
        style={surface ? [styles.surface, surface, WEB_SURFACE] : StyleSheet.absoluteFill}
        accessible
        accessibilityRole="image"
        // Site : l'état de la zone est dit dans le nom (un lecteur d'écran n'y
        // lit pas aria-valuetext sur une image, et l'aide n'y existe pas).
        accessibilityLabel={Platform.OS === "web" ? `${t.crop.label}, ${value}` : t.crop.label}
        // iPhone : VoiceOver lit l'état (aria-valuetext), puis l'aide.
        aria-valuetext={value}
        accessibilityHint={t.crop.hint(instruction, t.targeting.wholeImage)}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  container: { width: "100%" },
  // Avant la mesure de l'image : la place entière, sur la plinthe.
  waiting: { backgroundColor: color.plinthe, borderRadius: IMAGE_RADIUS, overflow: "hidden" },
  // Le cadre à la forme de l'image : plus de bandes autour.
  // Coins « continus » d'iOS (comme les icônes) ; le site ne connaît pas ce style.
  frame: { position: "absolute", borderRadius: IMAGE_RADIUS, overflow: "hidden", ...(Platform.OS === "ios" ? { borderCurve: "continuous" as const } : null) },
  surface: { position: "absolute" },
  messageRow: { position: "absolute", left: space.sm, right: space.sm, bottom: space.md, alignItems: "center" },
  // Posée sur la photo : la même dans les deux thèmes, sombre et translucide.
  message: {
    backgroundColor: MESSAGE_PILL.background,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MESSAGE_PILL.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  messageLabel: { color: MESSAGE_PILL.text, fontSize: font.caption, fontWeight: "500", textAlign: "center" },
}));
