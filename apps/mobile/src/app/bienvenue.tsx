import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { APP_NAME } from "@/constants/brand";
import { t } from "@/i18n";
import { SegmentedChoice } from "@/components/segmented-choice";
import { usePreferences } from "@/lib/preferences-context";
import { LOCALES } from "@/lib/preferences";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

export default function BienvenueScreen() {
  const router = useRouter();
  const { locale, chooseLocale } = usePreferences();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.language}>
        <SegmentedChoice
          label={t.preferences.language}
          options={LOCALES.map((value) => ({ value, label: t.preferences.languageNames[value] }))}
          value={locale}
          onChange={(value) => chooseLocale(value, "welcome")}
        />
      </View>
      <View style={styles.center}>
        <View style={styles.ring} />
        <Text style={styles.mark} accessibilityRole="header">{APP_NAME}</Text>
        <Text style={styles.baseline}>{t.welcome.baseline}</Text>
        <Text style={styles.explain}>{t.welcome.explain}</Text>
      </View>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.cta} onPress={() => router.push("/sign-up")}>
          <Text style={styles.ctaLabel}>{t.welcome.cta}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push("/sign-in")} hitSlop={12}>
          <Text style={styles.loginLink}>{t.welcome.login}</Text>
        </Pressable>
        <View style={styles.legalRow}>
          <Pressable accessibilityRole="link" onPress={() => router.push("/conditions")} hitSlop={12}>
            <Text style={styles.legal}>{t.welcome.terms}</Text>
          </Pressable>
          <Text style={styles.legal} importantForAccessibility="no">·</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/confidentialite")} hitSlop={12}>
            <Text style={styles.legal}>{t.welcome.privacy}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const RING_SIZE = 280;

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  language: { alignItems: "center", paddingTop: space.md, paddingHorizontal: space.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  ring: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 1,
    borderColor: color.filet,
  },
  mark: { fontFamily: serifFont, fontWeight: "500", fontSize: font.display, letterSpacing: -0.5, color: color.encre },
  baseline: { fontSize: font.secondary, color: color.acier, marginTop: 10, textAlign: "center", lineHeight: 22, maxWidth: 260 },
  explain: { fontSize: font.caption, color: color.acier, marginTop: 22, textAlign: "center", lineHeight: 19, maxWidth: 270 },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg, alignItems: "center" },
  cta: { alignSelf: "stretch", backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  loginLink: { fontSize: font.secondary, color: color.acier, fontWeight: "600", marginTop: space.lg },
  legalRow: { flexDirection: "row", gap: space.sm, marginTop: space.xl },
  legal: { fontSize: font.caption, color: color.acier, textDecorationLine: "underline", paddingVertical: space.xs },
}));
