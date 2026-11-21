import { useEffect, useRef, useState, type ComponentType } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { color, font, radius, serifFont, serifLineHeight, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { FIRST_RUN_GUIDE_STEPS, nextGuideStep } from "@/lib/first-run-guide";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// Guide de la première recherche (lot « recherche confiance ») : trois
// étapes, une à la fois, avec nos propres dessins (jamais une image ni une
// vidéo d'un tiers). « Passer » à tout moment ; la dernière étape lance une
// vraie recherche (le choix d'une capture ou d'une photo). Montré une seule
// fois par appareil (lib/first-run-guide.ts). Accessibilité : dessins
// décoratifs masqués aux lecteurs d'écran, étape lue en toutes lettres et
// annoncée à chaque changement, textes à la taille choisie sur l'appareil
// (rien n'a de hauteur fixe), aucun fondu avec « Réduire les animations ».
// Couleurs du thème : clair et sombre.

const ART = { width: 160, height: 100 };

/** 1. Partager depuis TikTok ou Instagram, ou coller le lien : un téléphone qui lit une vidéo, la flèche du partage, un maillon. */
function ShareArt() {
  return (
    <Svg width={ART.width} height={ART.height} viewBox="0 0 160 100" fill="none">
      <Rect x={28} y={6} width={46} height={88} rx={9} stroke={color.encre} strokeWidth={2} />
      <Rect x={34} y={16} width={34} height={62} rx={3} fill={color.plinthe} />
      <Path d="M46 37l14 10-14 10z" fill={color.encre} />
      <Path d="M45 86h12" stroke={color.encre} strokeWidth={2} strokeLinecap="round" />
      <Path d="M82 42c14-14 30-16 42-6" stroke={color.vert} strokeWidth={2} strokeLinecap="round" />
      <Path d="M117 30l8 6-9 4" stroke={color.vert} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Rect x={96} y={60} width={24} height={12} rx={6} stroke={color.vert} strokeWidth={2} />
      <Rect x={112} y={68} width={24} height={12} rx={6} stroke={color.vert} strokeWidth={2} />
    </Svg>
  );
}

/** 2. Entourer la pièce : une veste, et un tour tracé à main levée autour. */
function CircleArt() {
  return (
    <Svg width={ART.width} height={ART.height} viewBox="0 0 160 100" fill="none">
      <Path
        d="M66 30l10-6c3 4 5 5 4 5s1-1 4-5l10 6 12 12-8 8-6-5v33H68V45l-6 5-8-8z"
        stroke={color.encre}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={color.plinthe}
      />
      <Path d="M80 29v49" stroke={color.encre} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M84 12c34-2 50 26 42 52-8 26-72 30-86 6-12-22 6-52 48-56" stroke={color.vert} strokeWidth={2.5} strokeLinecap="round" />
    </Svg>
  );
}

/** 3. Comparer les boutiques et les prix, créer une alerte : trois offres, la moins chère marquée, une cloche. */
function CompareArt() {
  return (
    <Svg width={ART.width} height={ART.height} viewBox="0 0 160 100" fill="none">
      {[0, 1, 2].map((row) => {
        const y = 14 + row * 26;
        return [
          <Rect key={`card-${row}`} x={12} y={y} width={110} height={20} rx={5} stroke={color.filet} strokeWidth={1.5} />,
          <Rect key={`thumb-${row}`} x={17} y={y + 4} width={12} height={12} rx={2} fill={color.plinthe} />,
          <Path key={`shop-${row}`} d={`M36 ${y + 10}h${40 - row * 6}`} stroke={color.encre} strokeWidth={2} strokeLinecap="round" />,
          <Rect
            key={`price-${row}`}
            x={92}
            y={y + 5}
            width={24}
            height={10}
            rx={5}
            fill={row === 0 ? color.vert : "none"}
            stroke={color.vert}
            strokeWidth={1.5}
          />,
        ];
      })}
      <Path d="M141 18a7 7 0 0 0-7 7v6l-3 4h20l-3-4v-6a7 7 0 0 0-7-7z" stroke={color.vert} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M138 39a3 3 0 0 0 6 0" stroke={color.vert} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const ARTS: ComponentType[] = [ShareArt, CircleArt, CompareArt];

export function FirstRunGuide({ onClose, onStart }: { onClose: () => void; onStart: () => void }) {
  const [step, setStep] = useState(0);
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const firstStep = useRef(true);
  const steps = t.firstRunGuide.steps;
  const stepLabel = t.firstRunGuide.stepOf(step + 1, FIRST_RUN_GUIDE_STEPS);
  const text = steps[step] ?? "";
  const Art = ARTS[step] ?? ShareArt;
  const last = nextGuideStep(step) === null;

  // Étape suivante : annoncée (VoiceOver garde le bouton), puis un fondu court, sauf « Réduire les animations ».
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    AccessibilityInfo.announceForAccessibility(`${stepLabel}. ${text}`);
    if (reduceMotion) return;
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
    // Seulement au changement d'étape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function next() {
    const following = nextGuideStep(step);
    if (following === null) return onStart();
    setStep(following);
  }

  return (
    <View style={styles.card} testID="guide-premiere-recherche">
      <View style={styles.header}>
        <Text style={styles.stepOf}>{stepLabel}</Text>
        <Pressable onPress={onClose} hitSlop={8} style={styles.skip} accessibilityRole="button" accessibilityLabel={t.firstRunGuide.skipLabel}>
          <Text style={styles.skipLabel}>{t.firstRunGuide.skip}</Text>
        </Pressable>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {t.firstRunGuide.title}
      </Text>
      <Animated.View style={[styles.stepBody, { opacity }]}>
        <View style={styles.art} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Art />
        </View>
        <Text style={styles.stepText}>{text}</Text>
      </Animated.View>
      <View style={styles.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {steps.map((_, index) => (
          <View key={index} style={index === step ? [styles.dot, styles.dotActive] : styles.dot} />
        ))}
      </View>
      <Pressable style={styles.primary} onPress={next} accessibilityRole="button" accessibilityHint={last ? t.firstRunGuide.startHint : undefined}>
        <Text style={styles.primaryLabel}>{last ? t.firstRunGuide.start : t.firstRunGuide.next}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { marginTop: space.lg, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, backgroundColor: color.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.sm },
  stepOf: { fontSize: font.caption, color: color.acier, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6, flexShrink: 1 },
  skip: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.xs },
  skipLabel: { fontSize: font.secondary, color: color.acier, textDecorationLine: "underline" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, lineHeight: serifLineHeight.body, color: color.encre },
  stepBody: { alignItems: "center", gap: space.md, marginTop: space.md },
  art: { width: ART.width, height: ART.height, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: font.body, color: color.encre, lineHeight: 24, textAlign: "center", alignSelf: "stretch" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: space.md },
  dot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: color.filet },
  dotActive: { width: 16, backgroundColor: color.vert },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md, marginTop: space.md },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600", textAlign: "center" },
}));
