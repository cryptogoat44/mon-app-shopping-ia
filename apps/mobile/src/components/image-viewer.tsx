import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SpotImage } from "@/components/spot-image";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { t } from "@/i18n";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { touchDistance } from "@/lib/avatar-crop";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { useScreenReader } from "@/lib/use-screen-reader";
import { ZOOM_HINT_MS, claimZoomHint } from "@/lib/zoom-hint";
import {
  DOUBLE_TAP_MS,
  INPLACE_START,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
  VIEWER_START,
  VIEWER_ZOOM_STEP,
  clampViewerView,
  doubleTapViewer,
  isTap,
  panInPlace,
  panViewer,
  pinchInPlace,
  pinchViewerZoom,
  zoomViewerTo,
  type InPlaceView,
  type ViewerFrame,
  type ViewerView,
} from "@/lib/image-viewer";

// Image d'une pièce : fiche d'une envie, pièce du Vault, grande carte d'un
// résultat. Jamais sur les images des grilles ni dans le fil : seulement là
// où EnlargeableImage est posé.
//
// iPhone, depuis les retours du build 3 (« qu'avec deux doigts seulement on
// puisse zoomer dessus sans cliquer », « enlève ce − et + », « en relâchant
// simplement les deux doigts […] revenir au point de départ ») : on pince
// directement la tuile de la fiche, sans la toucher avant. Elle grandit sous
// les doigts, autour du point entre eux, et passe devant le titre et les
// boutons ; un doigt levé garde le zoom (le doigt restant déplace l'image) ;
// au dernier doigt levé, elle revient en ressort à sa place et à sa taille.
// Un doigt seul : la page défile comme avant ; un toucher : rien. Avec
// VoiceOver (qui prend le pincement pour lui), le double toucher ouvre le
// plein écran ci-dessous, où l'on zoome en balayant vers le haut ou le bas.
// « Pincez pour zoomer » : la toute première fois seulement (lib/zoom-hint.ts).
//
// Site : clic pour ouvrir le plein écran, Échap pour fermer (la fenêtre de
// react-native-web appelle onRequestClose), boutons − et + pour zoomer (une
// souris ne pince pas). Gestes de React Native seulement (PanResponder et
// Animated), aucune dépendance. Même image que l'écran (SpotImage « large ») :
// rien de plus n'est téléchargé ; sur iPhone elle est seulement décodée en
// pleine taille (fullResolution), dans le plein écran comme sur les trois
// grandes images qui se zooment sur place.

// Site : le doigt déplace l'image, jamais la page ; la main montre qu'on peut la saisir.
const WEB_GESTURE_STYLE: ViewStyle | null =
  Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: "grab" } as unknown as ViewStyle) : null;
const WEB_ZOOM_CURSOR: ViewStyle | null = Platform.OS === "web" ? ({ cursor: "zoom-in" } as unknown as ViewStyle) : null;

export type ZoomState = "idle" | "zooming" | "returning";

/** Retour au relâché : un ressort franc, sans rebond visible (à régler sur l'iPhone). */
const RETURN_SPRING = { stiffness: 260, damping: 26, mass: 1 } as const;
/** « Réduire les animations » : un retour court, sans ressort. */
const RETURN_REDUCED_MS = 120;

// L'aide n'est demandée qu'une fois par ouverture de l'app, même si le
// stockage refuse d'écrire (et jamais deux images à la fois).
let zoomHintAsked = false;

/** L'image d'une fiche : zoom à deux doigts sur place (iPhone), plein écran au clic (site) ou au double toucher de VoiceOver. */
export function EnlargeableImage({
  hdUri,
  fallbackUri,
  label,
  style,
  onLayout,
  onZoomStateChange,
  children,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  /** Nom de la pièce, lu par VoiceOver. */
  label: string;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  /** iPhone : l'écran bloque son défilement pendant « zooming ». */
  onZoomStateChange?: (state: ZoomState) => void;
  /** L'image telle que l'écran la montre déjà (la tuile entière). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const viewer = open ? <ImageViewer hdUri={hdUri} fallbackUri={fallbackUri} label={label} onClose={() => setOpen(false)} /> : null;
  if (Platform.OS === "web") {
    return (
      <>
        <Pressable
          onPress={() => setOpen(true)}
          onLayout={onLayout}
          style={[style, WEB_ZOOM_CURSOR]}
          // Site : « imagebutton » n'a pas d'équivalent (react-native-web n'écrit aucun rôle) ; « button » s'annonce et s'ouvre au clavier.
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={t.common.imageViewer.openHint}
          testID="image-agrandir"
        >
          {children}
        </Pressable>
        {viewer}
      </>
    );
  }
  return (
    <>
      <PinchInPlace label={label} style={style} onLayout={onLayout} onZoomStateChange={onZoomStateChange} onOpen={() => setOpen(true)}>
        {children}
      </PinchInPlace>
      {viewer}
    </>
  );
}

/** Milieu de deux doigts, en points de la fenêtre. */
function midpoint(event: GestureResponderEvent): { x: number; y: number } {
  const [a, b] = event.nativeEvent.touches;
  return { x: (a!.pageX + b!.pageX) / 2, y: (a!.pageY + b!.pageY) / 2 };
}

/** iPhone : la tuile se pince sur place et revient au relâché. */
function PinchInPlace({
  label,
  style,
  onLayout,
  onZoomStateChange,
  onOpen,
  children,
}: {
  label: string;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  onZoomStateChange?: (state: ZoomState) => void;
  onOpen: () => void;
  children: ReactNode;
}) {
  const screenReader = useScreenReader();
  const reduceMotion = useReduceMotion();
  const [zoomState, setZoomState] = useState<ZoomState>("idle");
  const [hintShown, setHintShown] = useState(false);
  const outer = useRef<View>(null);
  // Échelle et déplacement, pilotés en natif pendant le retour.
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const hintOpacity = useRef(new Animated.Value(0)).current;
  // Valeurs lues par les gestes (créés une seule fois).
  const latest = useRef({ reduceMotion, onZoomStateChange });
  latest.current = { reduceMotion, onZoomStateChange };
  const hintVisible = useRef(false);
  const center = useRef({ x: 0, y: 0 });

  const changeState = (next: ZoomState) => {
    setZoomState(next);
    latest.current.onZoomStateChange?.(next);
  };
  const changeStateRef = useRef(changeState);
  changeStateRef.current = changeState;

  const hideHint = () => {
    if (!hintVisible.current) return;
    hintVisible.current = false;
    if (latest.current.reduceMotion) {
      hintOpacity.setValue(0);
      setHintShown(false);
      return;
    }
    Animated.timing(hintOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setHintShown(false));
  };
  const hideHintRef = useRef(hideHint);
  hideHintRef.current = hideHint;

  // « Pincez pour zoomer » : la toute première fois, VoiceOver éteint (il a son propre chemin).
  useEffect(() => {
    if (screenReader || zoomHintAsked) return;
    zoomHintAsked = true;
    let active = true;
    // Le crochet ne connaît VoiceOver qu'après un instant : on le redemande avant de ranger la marque.
    void AccessibilityInfo.isScreenReaderEnabled()
      .catch(() => true)
      .then((readerOn) => (readerOn ? false : claimZoomHint(AsyncStorage, Platform.OS)))
      .then((claimed) => {
        if (!active || !claimed) return;
        hintVisible.current = true;
        setHintShown(true);
        if (latest.current.reduceMotion) hintOpacity.setValue(1);
        else Animated.timing(hintOpacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      });
    return () => {
      active = false;
    };
  }, [screenReader, hintOpacity]);
  useEffect(() => {
    if (!hintShown) return;
    const timer = setTimeout(() => hideHintRef.current(), ZOOM_HINT_MS);
    return () => clearTimeout(timer);
  }, [hintShown]);

  const responder = useMemo(() => {
    let view: InPlaceView = INPLACE_START;
    let base: InPlaceView = INPLACE_START;
    let mode: "pinch" | "pan" | null = null;
    let startDistance = 0;
    let startMid = { x: 0, y: 0 };
    let panStart = { x: 0, y: 0 };
    const show = (next: InPlaceView) => {
      view = next;
      scale.setValue(next.scale);
      tx.setValue(next.x);
      ty.setValue(next.y);
    };
    const twoFingers = (event: GestureResponderEvent) => event.nativeEvent.touches.length >= 2;
    const giveBack = () => {
      mode = null;
      changeStateRef.current("returning");
      const values: [Animated.Value, number][] = [
        [scale, 1],
        [tx, 0],
        [ty, 0],
      ];
      view = INPLACE_START;
      Animated.parallel(
        values.map(([value, toValue]) =>
          latest.current.reduceMotion
            ? Animated.timing(value, { toValue, duration: RETURN_REDUCED_MS, useNativeDriver: true })
            : Animated.spring(value, { toValue, useNativeDriver: true, ...RETURN_SPRING })
        )
      ).start(({ finished }) => {
        // Interrompu par un nouveau pincement : il garde la main.
        if (finished) changeStateRef.current("idle");
      });
    };
    return PanResponder.create({
      // Un doigt : rien n'est pris (la page défile, le toucher reste au bouton) ; deux doigts : le pincement.
      onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        changeStateRef.current("zooming");
        hideHintRef.current();
        // Un retour en cours s'arrête là où il en est.
        let stopped = { ...view };
        scale.stopAnimation((value) => (stopped = { ...stopped, scale: value }));
        tx.stopAnimation((value) => (stopped = { ...stopped, x: value }));
        ty.stopAnimation((value) => (stopped = { ...stopped, y: value }));
        view = stopped;
        mode = null;
      },
      onPanResponderMove: (event) => {
        const touches = event.nativeEvent.touches;
        if (twoFingers(event)) {
          const distance = touchDistance(touches[0]!, touches[1]!);
          const mid = midpoint(event);
          if (mode !== "pinch") {
            // Début du pincement, ou deuxième doigt reposé : on repart de la vue en cours.
            mode = "pinch";
            base = view;
            startDistance = distance;
            startMid = mid;
          }
          const focal = { x: startMid.x - center.current.x, y: startMid.y - center.current.y };
          show(pinchInPlace(focal, { dx: mid.x - startMid.x, dy: mid.y - startMid.y }, startDistance > 0 ? distance / startDistance : 1, base));
          return;
        }
        const finger = touches[0];
        if (!finger) return;
        if (mode !== "pan") {
          // Un doigt levé : le zoom reste, le doigt restant déplace l'image.
          mode = "pan";
          base = view;
          panStart = { x: finger.pageX, y: finger.pageY };
        }
        show(panInPlace(base, finger.pageX - panStart.x, finger.pageY - panStart.y));
      },
      // Dernier doigt levé, ou geste repris par le système : retour à la place d'avant.
      onPanResponderRelease: giveBack,
      onPanResponderTerminate: giveBack,
    });
  }, [scale, tx, ty]);

  // Mesure à chaque toucher (la page a pu défiler) : centre de la tuile dans la fenêtre.
  const measure = () =>
    outer.current?.measureInWindow((x, y, width, height) => {
      center.current = { x: x + width / 2, y: y + height / 2 };
    });

  return (
    <View
      ref={outer}
      onLayout={onLayout}
      onTouchStart={measure}
      // Pendant le zoom, le cadre passe devant le titre et les boutons qui le suivent, et peut en sortir.
      style={[style, zoomState !== "idle" ? styles.lifted : null]}
      {...responder.panHandlers}
    >
      <Animated.View style={{ transform: [{ translateX: tx }, { translateY: ty }, { scale }] }}>
        <Pressable
          // Sans VoiceOver, toucher l'image ne fait rien (on la pince) ; avec VoiceOver, le double toucher l'ouvre en grand.
          onPress={screenReader ? onOpen : undefined}
          disabled={!screenReader}
          accessibilityRole="imagebutton"
          accessibilityLabel={label}
          accessibilityHint={screenReader ? t.common.imageViewer.openHint : undefined}
          testID="image-agrandir"
        >
          {children}
        </Pressable>
      </Animated.View>
      {hintShown ? (
        <Animated.View pointerEvents="none" style={[styles.hint, { opacity: hintOpacity }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.hintPill}>
            <View style={styles.hintBackdrop} />
            <Text style={styles.hintLabel}>{t.common.zoomHint}</Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Plein écran : gardé pour le site (clic) et pour VoiceOver (double toucher) ; plus ouvert par un toucher simple sur iPhone. */
export function ImageViewer({ hdUri, fallbackUri, label, onClose }: { hdUri?: string | null; fallbackUri: string; label: string; onClose: () => void }) {
  // Marges lues par le crochet (contexte React, qui traverse le Modal) : un
  // SafeAreaView posé dans le Modal lisait 0 sur iPhone, et « Fermer »
  // tombait sous l'heure et la batterie (capture 12 du build 3).
  const insets = useSafeAreaInsets();
  const [frame, setFrame] = useState<ViewerFrame>({ width: 0, height: 0 });
  const [view, setView] = useState<ViewerView>(VIEWER_START);
  // Valeurs lues par les gestes (créés une seule fois).
  const latest = useRef({ view, frame });
  latest.current = { view, frame };

  const responder = useMemo(() => {
    let base: ViewerView = VIEWER_START;
    let from = { dx: 0, dy: 0 };
    let pinch: { distance: number; zoom: number } | null = null;
    let pinched = false;
    let lastTap = 0;
    const update = (next: ViewerView) => {
      latest.current.view = next;
      setView(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        base = latest.current.view;
        from = { dx: 0, dy: 0 };
        pinch = null;
        pinched = false;
      },
      onPanResponderMove: (event, gesture) => {
        const shownFrame = latest.current.frame;
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          // Deux doigts : zoom ; le déplacement reprendra d'ici.
          const distance = touchDistance(touches[0]!, touches[1]!);
          if (!pinch) pinch = { distance, zoom: latest.current.view.zoom };
          pinched = true;
          const next = zoomViewerTo(latest.current.view, pinchViewerZoom(pinch.zoom, pinch.distance, distance), shownFrame);
          update(next);
          base = next;
          from = { dx: gesture.dx, dy: gesture.dy };
          return;
        }
        if (pinch) {
          pinch = null;
          base = latest.current.view;
          from = { dx: gesture.dx, dy: gesture.dy };
        }
        update(panViewer(base, gesture.dx - from.dx, gesture.dy - from.dy, shownFrame));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (pinched || !isTap(gesture.dx, gesture.dy)) {
          lastTap = 0;
          return;
        }
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          update(doubleTapViewer(latest.current.view, latest.current.frame));
        } else lastTap = now;
      },
    });
  }, []);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame({ width, height });
    setView((current) => clampViewerView(current, { width, height }));
  };
  const zoomBy = (step: number) => setView((current) => zoomViewerTo(current, current.zoom + step, latest.current.frame));
  const zoomPercent = Math.round(view.zoom * 100);

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View
        style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}
        accessibilityViewIsModal
      >
        {/* Fond sombre dans les deux thèmes : heure et batterie claires (comme spot-waiting.tsx). */}
        <StatusBar style="light" />
        <View style={styles.nav}>
          <Pressable onPress={onClose} hitSlop={8} style={styles.close} accessibilityRole="button" accessibilityLabel={t.common.close} testID="image-fermer">
            <Text style={styles.closeLabel}>{t.common.close}</Text>
          </Pressable>
        </View>
        <View
          style={styles.stage}
          onLayout={onLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${label}. ${Platform.OS === "web" ? t.common.imageViewer.viewerLabelWeb : t.common.imageViewer.viewerLabel}`}
          accessibilityValue={{ text: t.common.imageViewer.zoomValue(zoomPercent) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => zoomBy(event.nativeEvent.actionName === "increment" ? VIEWER_ZOOM_STEP : -VIEWER_ZOOM_STEP)}
          testID="image-plein-ecran"
        >
          {frame.width > 0 ? (
            <SpotImage
              hdUri={hdUri}
              fallbackUri={fallbackUri}
              fit="contain"
              // Décodée en entier (iPhone) : le zoom montre les vrais détails de la photo.
              fullResolution
              style={{ width: frame.width, height: frame.height, transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.zoom }] }}
            />
          ) : null}
          {/* Calque qui reçoit les gestes (sur le site, l'image elle-même partirait en glisser-déposer). */}
          <View style={[styles.gestures, WEB_GESTURE_STYLE]} {...responder.panHandlers} />
        </View>
        {/* − et + : sur le site seulement (une souris ne pince pas) ; sur iPhone, VoiceOver zoome en balayant (rôle « adjustable »). */}
        {Platform.OS === "web" ? (
          <View style={styles.tools}>
            <Pressable
              onPress={() => zoomBy(-VIEWER_ZOOM_STEP)}
              disabled={view.zoom <= VIEWER_MIN_ZOOM}
              style={[styles.round, view.zoom <= VIEWER_MIN_ZOOM ? styles.roundDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel={t.common.imageViewer.zoomOut}
              accessibilityState={{ disabled: view.zoom <= VIEWER_MIN_ZOOM }}
            >
              <MinusIcon size={20} tint={color.surNuit} />
            </Pressable>
            <Pressable
              onPress={() => zoomBy(VIEWER_ZOOM_STEP)}
              disabled={view.zoom >= VIEWER_MAX_ZOOM}
              style={[styles.round, view.zoom >= VIEWER_MAX_ZOOM ? styles.roundDisabled : null]}
              accessibilityRole="button"
              accessibilityLabel={t.common.imageViewer.zoomIn}
              accessibilityState={{ disabled: view.zoom >= VIEWER_MAX_ZOOM }}
            >
              <PlusIcon size={20} tint={color.surNuit} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.nuit },
  nav: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.md, minHeight: 47, alignItems: "center" },
  close: { minHeight: 44, minWidth: 44, justifyContent: "center", alignItems: "flex-end" },
  closeLabel: { fontSize: font.body, color: color.surNuit, fontWeight: "600" },
  stage: { flex: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  gestures: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  tools: { flexDirection: "row", justifyContent: "center", gap: space.lg, paddingVertical: space.md },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.nuitFilet,
    alignItems: "center",
    justifyContent: "center",
  },
  roundDisabled: { opacity: 0.4 },
  // Zoom sur place : le cadre passe devant ses frères suivants (titre, prix, boutons) et peut sortir de sa place.
  lifted: { zIndex: 10, overflow: "visible" },
  // « Pincez pour zoomer » : pastille centrée en bas de l'image, fond sombre à 72 %, texte ivoire.
  hint: { position: "absolute", left: 0, right: 0, bottom: space.md, alignItems: "center" },
  hintPill: { borderRadius: radius.full, overflow: "hidden", paddingHorizontal: space.md, paddingVertical: space.sm },
  hintBackdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color.nuit, opacity: 0.72 },
  hintLabel: { fontSize: font.caption, color: color.surNuit, fontWeight: "600" },
}));
