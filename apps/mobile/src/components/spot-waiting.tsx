import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import type { CropRect } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { croppedView } from "@/lib/crop-geometry";
import type { ImageSize } from "@/lib/spot-draft";
import type { FramePreview } from "@/lib/video-timeline";
import { themedStyles } from "@/theme/themed-styles";

/** Image montrée pendant l'attente : la vidéo (son aperçu), puis la zone
 * analysée dès qu'elle est connue (taille et cadre). */
export interface WaitingImage {
  source: FramePreview;
  size?: ImageSize | null;
  crop?: CropRect | null;
}

/** Une fine ligne de lumière parcourt l'image ; aucune animation si
 * « Réduire les animations » est activé. */
function useScanLine(height: number) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.timing(scan, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, scan]);
  return reduceMotion ? null : scan.interpolate({ inputRange: [0, 1], outputRange: [0, height] });
}

function useSlow(afterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  return slow;
}

/** Écran d'attente unique du Spotter (lot 4 ter) : sombre et sobre, sans
 * étapes affichées — l'image analysée, ce que l'on cherche, « Annuler ». */
export function SpotWaitingScreen({
  image,
  title,
  query,
  usual,
  slowAfterMs,
  onCancel,
  onClose,
}: {
  image: WaitingImage | null;
  title: string;
  query: string;
  /** Durée habituelle, dite à la personne. */
  usual: string;
  slowAfterMs: number;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const slow = useSlow(slowAfterMs);
  const frameWidth = Math.min(windowWidth - space.lg * 2, 432);
  const maxHeight = Math.min(windowHeight * 0.5, 440);
  const view = image?.size && image.crop ? croppedView(image.size, image.crop, frameWidth, maxHeight) : null;
  const frameHeight = view ? view.frame.height : maxHeight;
  const translateY = useScanLine(frameHeight);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.nav}>
        <Pressable onPress={onClose} hitSlop={12} style={styles.navClose} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <View style={[styles.frame, { width: view ? view.frame.width : frameWidth, height: frameHeight }]}>
          {image && view ? (
            // Le positionnement est porté par une View : sur le web, expo-image
            // ignore un décalage négatif posé directement sur l'image.
            <View style={[styles.absolute, view.image]}>
              <Image source={image.source} style={styles.fill} contentFit="fill" accessibilityIgnoresInvertColors />
            </View>
          ) : image ? (
            <Image source={image.source} style={styles.fill} contentFit="contain" />
          ) : null}
          {translateY ? <Animated.View pointerEvents="none" style={[styles.scanLine, { transform: [{ translateY }] }]} /> : null}
        </View>
        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </Text>
        {query.trim() ? <Text style={styles.query}>{t.common.quoted(query.trim())}</Text> : null}
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {slow ? t.analysis.slow : usual}
        </Text>
      </View>
      <View style={styles.footer}>
        <Pressable style={styles.cancel} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelLabel}>{t.analysis.cancel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.nuit },
  nav: { height: 47, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 12 },
  navClose: { minWidth: 44, height: 44, justifyContent: "center", alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.surNuit, fontWeight: "600" },
  content: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.xs, maxWidth: 480, alignSelf: "center", width: "100%" },
  frame: { alignSelf: "center", borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.nuitCadre },
  absolute: { position: "absolute" },
  fill: { width: "100%", height: "100%" },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: color.lueur,
    shadowColor: color.surImage,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.surNuit, marginTop: space.lg, lineHeight: 29 },
  query: { fontSize: font.secondary, color: color.brume, marginTop: 4 },
  note: { fontSize: font.caption, color: color.brume, marginTop: space.md, lineHeight: 18 },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg, maxWidth: 480, alignSelf: "center", width: "100%" },
  cancel: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: color.nuitFilet, alignItems: "center", justifyContent: "center" },
  cancelLabel: { fontSize: font.body, color: color.surNuit, fontWeight: "600" },
}));
