import { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { PhotoFrame } from "@/components/spot-launch-views";
import { zoneReady, type PieceZone } from "@/lib/piece-trace";
import { draftImageUri, getDraft, updateDraft } from "@/lib/spot-draft";
import { themedStyles } from "@/theme/themed-styles";

// Étape 2 : l'utilisateur entoure la pièce (seule cette zone part à
// l'analyse, sans mots depuis le petit lot, 2026-10-25 ; les mots tapés sous
// la photo, s'il y en a, trient encore les propositions : petit lot 2). Aucun
// crédit consommé : c'est « Lancer l'identification » qui engage la recherche.
// Comme pour une photo (lot entourer la pièce), il attend la zone : entourée
// au doigt, ou l'image entière. « Recadrer » repart d'une image sans tracé.
export default function TargetingScreen() {
  const router = useRouter();
  const { searchId } = useLocalSearchParams<{ searchId?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;

  const [zone, setZone] = useState<PieceZone | null>(null);
  const [dragging, setDragging] = useState(false);

  // Brouillon perdu (page rechargée sur le web avec une photo importée,
  // qui ne vit que dans cet onglet) : on repart proprement.
  if (!draft || !imageUri) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.lead}>{t.preview.missing}</Text>
          <Pressable style={styles.primary} onPress={() => closeSpotter(router)} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{t.preview.back}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const ready = zoneReady(zone);
  function handleLaunch() {
    if (!zoneReady(zone)) return;
    // La zone entourée ici est celle de la personne, plus celle de l'IA.
    updateDraft({ crop: zone.crop, zoneByAi: false });
    router.push({ pathname: "/spot/analysis", params: { searchId: searchId ?? "" } });
  }

  const cropHeight = Math.min(Math.max(windowHeight * 0.48, 300), 460);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel={t.common.back}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{t.spotter.close}</Text>
        </Pressable>
      </View>

      <View style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <PhotoFrame
            uri={imageUri}
            zone={zone}
            onChange={setZone}
            onDragChange={setDragging}
            onImageSize={(size) => updateDraft({ imageSize: size })}
            height={cropHeight}
          />

          <Pressable
            style={[styles.primary, ready ? null : styles.primaryDisabled]}
            onPress={handleLaunch}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
          >
            <Text style={[styles.primaryLabel, ready ? null : styles.primaryLabelDisabled]}>{t.targeting.launch}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryDisabled: { backgroundColor: color.inactif },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  primaryLabelDisabled: { color: color.surInactif },
}));
