import { useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, PanResponder, Platform, Pressable, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SpotImage } from "@/components/spot-image";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { t } from "@/i18n";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { touchDistance } from "@/lib/avatar-crop";
import {
  DOUBLE_TAP_MS,
  VIEWER_MAX_ZOOM,
  VIEWER_MIN_ZOOM,
  VIEWER_START,
  VIEWER_ZOOM_STEP,
  clampViewerView,
  doubleTapViewer,
  isTap,
  panViewer,
  pinchViewerZoom,
  zoomViewerTo,
  type ViewerFrame,
  type ViewerView,
} from "@/lib/image-viewer";

// Image d'une pièce en plein écran (retours du build 2 : « les gens ne
// peuvent pas voir correctement la pièce »). Toucher l'image d'une envie,
// d'une pièce du Vault ou de la grande carte d'un résultat l'ouvre en grand,
// sur fond sombre : pincer pour zoomer, glisser pour se déplacer dans l'image
// zoomée, double toucher pour zoomer ou revenir à l'image entière, boutons
// − et + (VoiceOver : balayer vers le haut ou le bas sur l'image), « Fermer ».
// Site : clic pour ouvrir, Échap pour fermer (la fenêtre de react-native-web
// appelle onRequestClose), boutons − et + pour zoomer. Mêmes gestes de React
// Native que le recadrage de la photo de profil (PanResponder), aucune
// dépendance. Jamais sur les images des grilles : seulement là où
// EnlargeableImage est posé. Même image que l'écran qui l'ouvre (la plus
// nette des deux, SpotImage « large ») : rien de plus n'est téléchargé.

// Site : le doigt déplace l'image, jamais la page ; la main montre qu'on peut la saisir.
const WEB_GESTURE_STYLE: ViewStyle | null =
  Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: "grab" } as unknown as ViewStyle) : null;
const WEB_ZOOM_CURSOR: ViewStyle | null = Platform.OS === "web" ? ({ cursor: "zoom-in" } as unknown as ViewStyle) : null;

/** L'image d'une fiche, qui s'ouvre en plein écran quand on la touche. */
export function EnlargeableImage({
  hdUri,
  fallbackUri,
  label,
  style,
  children,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  /** Nom de la pièce, lu par VoiceOver. */
  label: string;
  style?: StyleProp<ViewStyle>;
  /** L'image telle que l'écran la montre déjà. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[style, WEB_ZOOM_CURSOR]}
        // Site : « imagebutton » n'a pas d'équivalent (react-native-web n'écrit aucun rôle) ; « button » s'annonce et s'ouvre au clavier.
        accessibilityRole={Platform.OS === "web" ? "button" : "imagebutton"}
        accessibilityLabel={label}
        accessibilityHint={t.common.imageViewer.openHint}
        testID="image-agrandir"
      >
        {children}
      </Pressable>
      {open ? <ImageViewer hdUri={hdUri} fallbackUri={fallbackUri} label={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ImageViewer({ hdUri, fallbackUri, label, onClose }: { hdUri?: string | null; fallbackUri: string; label: string; onClose: () => void }) {
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
      <SafeAreaView style={styles.screen} accessibilityViewIsModal>
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
              style={{ width: frame.width, height: frame.height, transform: [{ translateX: view.x }, { translateY: view.y }, { scale: view.zoom }] }}
            />
          ) : null}
          {/* Calque qui reçoit les gestes (sur le site, l'image elle-même partirait en glisser-déposer). */}
          <View style={[styles.gestures, WEB_GESTURE_STYLE]} {...responder.panHandlers} />
        </View>
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
      </SafeAreaView>
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
}));
