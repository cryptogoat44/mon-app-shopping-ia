import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import Svg, { Path, Rect } from "react-native-svg";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { containBox, type Box, type Size } from "@/lib/crop-geometry";
import { extendTrace, outsidePath, toTracePoint, tracePath, traceSurface, zoneFromTrace, type PieceZone, type TracePoint } from "@/lib/piece-trace";
import { currentDevice } from "@/components/link-notice";
import { themedStyles } from "@/theme/themed-styles";

/** Trait du tracé (couleur d'accent), posé sur un liseré de la couleur
 * opposée : lisible sur n'importe quelle photo, en clair comme en sombre. */
const STROKE = 3;
const HALO = 7;

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
// assombri ; retracer remplace le tout. Un toucher, un trait ou un balayage
// pour faire défiler la page n'entoure rien : il n'est pas retenu. Seuls
// l'image et une petite marge prennent le doigt ; les bandes vides à côté
// d'une capture verticale font défiler la page. PanResponder fonctionne au
// doigt (iPhone) comme à la souris (web). VoiceOver : la zone est décrite, et
// le bouton « Utiliser toute l'image », sous l'image, remplace le tracé.
export function PieceTracer({ uri, zone, onChange, onImageSize, onDragChange, height }: Props) {
  const [container, setContainer] = useState<Size>({ width: 0, height });
  const [imageSize, setImageSize] = useState<Size | null>(null);
  // Tracé en cours, affiché pendant le geste.
  const [drawing, setDrawing] = useState<readonly TracePoint[] | null>(null);
  const [rejected, setRejected] = useState(false);

  // Où l'image s'affiche ; null tant que l'image et son cadre ne sont pas mesurés.
  const shownBox = imageSize ? containBox(container, imageSize) : null;
  const imageBox = shownBox && shownBox.width > 0 && shownBox.height > 0 ? shownBox : null;
  // Ce qui prend le doigt : l'image et une petite marge autour.
  const surface = imageBox ? traceSurface(imageBox, container) : null;
  // Même source d'un rendu à l'autre : le tracé redessine souvent ce composant.
  const source = useMemo(() => ({ uri }), [uri]);

  // Les gestionnaires de geste sont créés une fois ; ils lisent les valeurs
  // à jour via ces références.
  const latest = useRef({ imageBox, surface, onChange, onDragChange });
  latest.current = { imageBox, surface, onChange, onDragChange };
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
        // Dessin seulement : le doigt le traverse (dans les bandes vides, la page défile).
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
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
        </View>
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
  container: { width: "100%", backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  surface: { position: "absolute" },
  messageRow: { position: "absolute", left: space.sm, right: space.sm, bottom: space.sm, alignItems: "center" },
  // Comme les messages brefs de l'app (toast) : lisible sur n'importe quelle photo.
  message: { backgroundColor: color.encre, borderRadius: radius.full, paddingHorizontal: space.md, paddingVertical: 7 },
  messageLabel: { color: color.blanc, fontSize: font.caption, fontWeight: "600", textAlign: "center" },
}));
