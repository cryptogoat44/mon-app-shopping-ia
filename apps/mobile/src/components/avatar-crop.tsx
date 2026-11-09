import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Platform, Pressable, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Svg, { Circle, Path } from "react-native-svg";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";
import { MinusIcon, PlusIcon } from "@/components/icons";
import { ErrorMessage } from "@/components/error-message";
import { INITIAL_VIEW, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, cropRect, imageLayout, panView, pinchZoom, touchDistance, zoomView, type CropView, type PixelCrop } from "@/lib/avatar-crop";
import type { PickedImage } from "@/lib/avatar-photo";

// Cadrage de la photo de profil (lot « profil et icône des réglages »), le
// même sur le site et l'iPhone : la photo se déplace au doigt ou à la
// souris, se zoome par pincement ou avec les boutons − et + ; le cercle
// montre ce qui sera gardé, et l'aperçu, la photo à la taille du fil. Le
// calcul est dans lib/avatar-crop.ts.

const PREVIEW_SIZE = 56;
const MAX_VIEWPORT = 340;
// Site : le doigt déplace la photo, jamais la page (ni un zoom du navigateur) ;
// la main de la souris montre qu'on peut la saisir.
const WEB_GESTURE_STYLE: ViewStyle | null =
  Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: "grab" } as unknown as ViewStyle) : null;

interface AvatarCropProps {
  image: PickedImage;
  /** Envoi en cours : boutons inactifs. */
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onValidate: (crop: PixelCrop) => void;
}

export function AvatarCrop({ image, busy, error, onCancel, onValidate }: AvatarCropProps) {
  const { width } = useWindowDimensions();
  const viewport = Math.round(Math.min(width - space.lg * 2, MAX_VIEWPORT));
  const [view, setView] = useState<CropView>(INITIAL_VIEW);
  // Valeurs lues par les gestes (créés une seule fois).
  const latest = useRef({ view, image, viewport });
  latest.current = { view, image, viewport };

  const responder = useMemo(() => {
    let base: CropView = INITIAL_VIEW;
    let from = { dx: 0, dy: 0 };
    let pinch: { distance: number; zoom: number } | null = null;
    const update = (next: CropView) => {
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
      },
      onPanResponderMove: (event, gesture) => {
        const { image: shown, viewport: side } = latest.current;
        const touches = event.nativeEvent.touches;
        if (touches.length >= 2) {
          // Deux doigts : zoom ; le déplacement reprendra d'ici.
          const distance = touchDistance(touches[0]!, touches[1]!);
          if (!pinch) pinch = { distance, zoom: latest.current.view.zoom };
          const next = zoomView(latest.current.view, pinchZoom(pinch.zoom, pinch.distance, distance), shown, side);
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
        update(panView(base, gesture.dx - from.dx, gesture.dy - from.dy, shown, side));
      },
    });
  }, []);

  const zoomBy = (step: number) => setView((current) => zoomView(current, current.zoom + step, image, viewport));
  const layout = imageLayout(view, image, viewport);
  const preview = imageLayout(view, image, viewport, PREVIEW_SIZE);
  const half = viewport / 2;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={onCancel} disabled={busy} hitSlop={12} accessibilityRole="button" accessibilityLabel={t.avatarPhoto.cancel} style={styles.navSide}>
          <Text style={[styles.navLabel, busy ? styles.disabledLabel : null]}>{t.avatarPhoto.cancel}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.avatarPhoto.cropTitle}
        </Text>
        <Text style={styles.hint}>{Platform.OS === "web" ? t.avatarPhoto.cropHintWeb : t.avatarPhoto.cropHint}</Text>

        <View
          style={[styles.viewport, { width: viewport, height: viewport }]}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t.avatarPhoto.cropArea}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) => zoomBy(event.nativeEvent.actionName === "increment" ? ZOOM_STEP : -ZOOM_STEP)}
          testID="zone-recadrage"
        >
          <Image source={{ uri: image.uri }} style={[styles.absolute, layout]} contentFit="fill" />
          <Svg width={viewport} height={viewport} style={styles.absolute} pointerEvents="none">
            <Path d={`M0 0H${viewport}V${viewport}H0Z M${half} 0A${half} ${half} 0 1 0 ${half} ${viewport}A${half} ${half} 0 1 0 ${half} 0Z`} fill={color.voileImage} fillRule="evenodd" />
            <Circle cx={half} cy={half} r={half - 1} stroke={color.surImage} strokeWidth={1.5} fill="none" />
          </Svg>
          {/* Calque qui reçoit les gestes (sur le site, l'image elle-même partirait en glisser-déposer). */}
          <View style={[styles.absolute, { width: viewport, height: viewport }, WEB_GESTURE_STYLE]} {...responder.panHandlers} />
        </View>

        <View style={styles.tools}>
          <Pressable
            onPress={() => zoomBy(-ZOOM_STEP)}
            disabled={busy || view.zoom <= MIN_ZOOM}
            style={[styles.round, view.zoom <= MIN_ZOOM ? styles.roundDisabled : null]}
            accessibilityRole="button"
            accessibilityLabel={t.avatarPhoto.zoomOut}
          >
            <MinusIcon size={20} tint={color.encre} />
          </Pressable>
          <View style={styles.previewBlock}>
            <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Image source={{ uri: image.uri }} style={[styles.absolute, preview]} contentFit="fill" />
            </View>
            <Text style={styles.previewLabel}>{t.avatarPhoto.preview}</Text>
          </View>
          <Pressable
            onPress={() => zoomBy(ZOOM_STEP)}
            disabled={busy || view.zoom >= MAX_ZOOM}
            style={[styles.round, view.zoom >= MAX_ZOOM ? styles.roundDisabled : null]}
            accessibilityRole="button"
            accessibilityLabel={t.avatarPhoto.zoomIn}
          >
            <PlusIcon size={20} tint={color.encre} />
          </Pressable>
        </View>

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        <Pressable
          style={[styles.cta, busy ? styles.ctaBusy : null]}
          onPress={() => onValidate(cropRect(view, image, viewport))}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={busy ? t.avatarPhoto.sending : t.avatarPhoto.validate}
          accessibilityState={{ busy, disabled: busy }}
        >
          {busy ? <ActivityIndicator color={color.blanc} size="small" style={styles.spinner} /> : null}
          <Text style={styles.ctaLabel}>{busy ? t.avatarPhoto.sending : t.avatarPhoto.validate}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, flexDirection: "row", alignItems: "center", paddingHorizontal: space.md },
  navSide: { minHeight: 44, justifyContent: "center" },
  navLabel: { fontSize: font.body, color: color.encre },
  disabledLabel: { color: color.acier },
  content: { flex: 1, alignItems: "center", paddingHorizontal: space.lg, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, alignSelf: "flex-start" },
  hint: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginTop: space.xs, marginBottom: space.md, alignSelf: "flex-start" },
  viewport: { overflow: "hidden", backgroundColor: color.nuit, borderRadius: radius.sm },
  absolute: { position: "absolute", left: 0, top: 0 },
  tools: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.lg, marginTop: space.md },
  round: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    backgroundColor: color.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  roundDisabled: { opacity: 0.4 },
  previewBlock: { alignItems: "center" },
  preview: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: radius.full, overflow: "hidden", backgroundColor: color.plinthe },
  previewLabel: { fontSize: font.caption, color: color.acier, marginTop: space.xs },
  error: { fontSize: font.caption, marginTop: space.md, textAlign: "center" },
  cta: {
    flexDirection: "row",
    alignSelf: "stretch",
    backgroundColor: color.vert,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.lg,
  },
  ctaBusy: { opacity: 0.7 },
  spinner: { marginRight: space.sm },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
