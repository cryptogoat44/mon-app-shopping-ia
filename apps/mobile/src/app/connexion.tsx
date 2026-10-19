import { Pressable, Text } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { t } from "@/i18n";
import { ConnectingNotice, ConnectingScreen } from "@/components/connecting";
import { color, font, radius, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Affiché quand la personne est connectée mais que son profil n'a pas pu
// être chargé (serveur qui se réveille, réseau coupé...). Remplace l'ancien
// comportement qui l'envoyait à tort vers "Dernière étape" (audit Lot Q,
// ROB-01). Tant que les relances automatiques tournent, on patiente : le
// premier essai a échoué ou n'a pas répondu, le serveur se réveille
// probablement ; une fois épuisées, on propose de réessayer ou de se
// déconnecter.
export default function ConnexionScreen() {
  const { profileStatus, retryProfile, signOut } = useAuth();
  const failed = profileStatus === "failed";

  return (
    <ConnectingScreen>
      <ConnectingNotice state={failed ? "failed" : "waking"} />

      {failed ? (
        <Pressable style={styles.cta} onPress={retryProfile} accessibilityRole="button">
          <Text style={styles.ctaLabel}>{t.connection.retry}</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={signOut} style={styles.secondary} accessibilityRole="button">
        <Text style={styles.secondaryLabel}>{t.connection.signOut}</Text>
      </Pressable>
    </ConnectingScreen>
  );
}

const styles = themedStyles(() => ({
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: space.md, alignItems: "center", marginTop: space.xl },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: { minHeight: size.touchTarget, justifyContent: "center", alignItems: "center", marginTop: space.md },
  secondaryLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
}));
