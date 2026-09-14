import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import { color, radius } from "@/theme/tokens";

// Silhouette animée du contenu à venir, à la place d'une simple roue qui
// tourne — respecte "Réduire les animations" (même pattern que
// spot/analysis.tsx) en restant fixe à mi-opacité plutôt que de pulser.
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    let mounted = true;
    let loop: Animated.CompositeAnimation | null = null;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!mounted || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
        ])
      );
      loop.start();
    });

    return () => {
      mounted = false;
      loop?.stop();
    };
  }, [opacity]);

  return <Animated.View style={[styles.base, style, { opacity }]} />;
}

const styles = StyleSheet.create({
  base: { backgroundColor: color.plinthe, borderRadius: radius.sm },
});
