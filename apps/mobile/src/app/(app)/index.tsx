import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { PrimaryButton } from "@/components/form";
import { useAuth } from "@/lib/auth-context";
import { theme } from "@/lib/theme";

export default function HomeScreen() {
  const { profile, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>Connecté</Text>
        <Text style={styles.title}>Bonjour {profile?.displayName ?? ""}</Text>
        <Text style={styles.subtitle}>@{profile?.username}</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Prochain bloc</Text>
          <Text style={styles.cardBody}>
            Reconnaissance produit par IA : collez un lien, obtenez les produits identifiés.
          </Text>
        </View>

        <PrimaryButton label="Se déconnecter" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.ground },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: theme.space.lg },
  eyebrow: { fontSize: theme.font.small, color: theme.color.accentInk, letterSpacing: 1, textTransform: "uppercase", marginBottom: theme.space.xs },
  title: { fontSize: theme.font.display, fontWeight: "700", color: theme.color.ink },
  subtitle: { fontSize: theme.font.body, color: theme.color.muted, marginBottom: theme.space.lg },
  card: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.line,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    marginBottom: theme.space.lg,
  },
  cardLabel: { fontSize: theme.font.small, color: theme.color.muted, marginBottom: theme.space.xs },
  cardBody: { fontSize: theme.font.body, color: theme.color.ink },
});
