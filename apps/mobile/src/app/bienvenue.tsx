import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { APP_NAME } from "@/constants/brand";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";

export default function BienvenueScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.center}>
        <View style={styles.ring} />
        <Text style={styles.mark}>{APP_NAME}</Text>
        <Text style={styles.baseline}>{fr.welcome.baseline}</Text>
        <Text style={styles.explain}>{fr.welcome.explain}</Text>
      </View>

      <View style={styles.footer}>
        <Pressable style={styles.cta} onPress={() => router.push("/sign-up")}>
          <Text style={styles.ctaLabel}>{fr.welcome.cta}</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/sign-in")} hitSlop={8}>
          <Text style={styles.loginLink}>{fr.welcome.login}</Text>
        </Pressable>
        <Text style={styles.legal}>{fr.welcome.legal}</Text>
      </View>
    </SafeAreaView>
  );
}

const RING_SIZE = 280;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
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
  legal: { fontSize: 11, color: color.acier, marginTop: space.xl, textAlign: "center" },
});
