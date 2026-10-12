import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { color, font, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ReceivedPieces } from "@/components/received-pieces";
import { themedStyles } from "@/theme/themed-styles";

// Pièces reçues (lot 5, 5.C), ouvert depuis l'Activité (« … vous a envoyé
// une pièce »). Même liste que l'onglet « Reçues » des Envies.
export default function ReceivedPiecesScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/activite"))}
          hitSlop={12}
          style={styles.navBack}
          accessibilityRole="button"
          accessibilityLabel={t.received.back}
        >
          <Text style={styles.backLabel}>‹ {t.received.back}</Text>
        </Pressable>
      </View>
      <ScrollView>
        <Text style={styles.title} accessibilityRole="header">
          {t.received.title}
        </Text>
        <ReceivedPieces />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: space.lg },
  navBack: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  backLabel: { color: color.encre, fontSize: font.secondary },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, paddingHorizontal: space.lg, maxWidth: 640, alignSelf: "center", width: "100%" },
}));
