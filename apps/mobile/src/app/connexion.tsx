import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { fr } from "@/i18n/fr";
import { color, font, radius, serifFont, space } from "@/theme/tokens";

// Affiché quand la personne est connectée mais que son profil n'a pas pu
// être chargé (serveur qui se réveille, réseau coupé...). Remplace l'ancien
// comportement qui l'envoyait à tort vers "Dernière étape" (audit Lot Q,
// ROB-01). Tant que les relances automatiques tournent, on patiente ; une
// fois épuisées, on propose de réessayer ou de se déconnecter.
export default function ConnexionScreen() {
  const { profileStatus, retryProfile, signOut } = useAuth();
  const failed = profileStatus === "failed";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        {failed ? null : <ActivityIndicator color={color.encre} style={styles.spinner} />}
        <Text style={styles.title} accessibilityRole="header">
          {failed ? fr.connection.failedTitle : fr.connection.connectingTitle}
        </Text>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {failed ? fr.connection.failedBody : fr.connection.connectingBody}
        </Text>

        {failed ? (
          <Pressable style={styles.cta} onPress={retryProfile} accessibilityRole="button">
            <Text style={styles.ctaLabel}>{fr.connection.retry}</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={signOut} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryLabel}>{fr.connection.signOut}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, maxWidth: 480, alignSelf: "center", width: "100%" },
  spinner: { alignSelf: "flex-start", marginBottom: space.lg },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 30 },
  body: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 21 },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.xl },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: { minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: space.md },
  secondaryLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
});
