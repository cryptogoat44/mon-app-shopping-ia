import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { spot } from "@/api/client";
import { setLastSpotResult } from "@/api/spotSession";
import { ClockIcon } from "@/components/icons";

export default function AnalysisScreen() {
  const router = useRouter();
  const { type, value } = useLocalSearchParams<{ type: "link" | "photo"; value: string }>();
  const [showReassurance, setShowReassurance] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const cancelled = useRef(false);

  useEffect(() => {
    let loopAnim: Animated.CompositeAnimation | null = null;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced || cancelled.current) return;
      loopAnim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loopAnim.start();
    });

    const reassuranceTimer = setTimeout(() => setShowReassurance(true), 8000);

    const source = type === "photo" ? ({ type: "photo", uri: value } as const) : ({ type: "link", url: value } as const);

    spot(source).then((result) => {
      if (cancelled.current) return;
      setLastSpotResult(result);
      router.replace({ pathname: "/spot/result", params: { type, value } });
    });

    return () => {
      cancelled.current = true;
      loopAnim?.stop();
      clearTimeout(reassuranceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.85] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <View style={styles.frame}>
          <ClockIcon size={64} tint={color.encre} />
          <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        </View>
        <Text style={styles.status}>{showReassurance ? fr.analysis.reassurance : fr.analysis.status}</Text>
      </View>
      <Pressable style={styles.cancel} onPress={() => router.back()}>
        <Text style={styles.cancelLabel}>{fr.analysis.cancel}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 220,
    height: 220,
    borderRadius: radius.sm,
    backgroundColor: color.plinthe,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    top: -1,
    left: -1,
    right: -1,
    bottom: -1,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.filet,
  },
  status: { fontSize: font.secondary, color: color.acier, marginTop: space.lg, textAlign: "center" },
  cancel: { position: "absolute", bottom: 64, left: 0, right: 0, alignItems: "center" },
  cancelLabel: { fontSize: font.body, color: color.acier },
});
