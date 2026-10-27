import { useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CropRect } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { closeSpotter } from "@/lib/spot-navigation";
import { CropSelector } from "@/components/crop-selector";
import { DEFAULT_CROP } from "@/lib/crop-geometry";
import { draftImageUri, getDraft, updateDraft } from "@/lib/spot-draft";
import { themedStyles } from "@/theme/themed-styles";

// Étape 2 : l'utilisateur entoure la pièce (seule cette zone part à
// l'analyse, sans mots depuis le petit lot, 2026-10-25). Toujours aucun
// crédit consommé : c'est « Lancer l'identification » qui engage la recherche.
export default function TargetingScreen() {
  const router = useRouter();
  const { searchId } = useLocalSearchParams<{ searchId?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;

  const [crop, setCrop] = useState<CropRect>(draft?.crop ?? DEFAULT_CROP);
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

  function handleLaunch() {
    updateDraft({ crop });
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
          <Text style={styles.title} accessibilityRole="header">
            {t.targeting.title}
          </Text>
          <Text style={styles.caption}>{t.targeting.caption}</Text>

          <View style={styles.cropArea}>
            <CropSelector
              uri={imageUri}
              crop={crop}
              onChange={setCrop}
              onDragChange={setDragging}
              onImageSize={(size) => updateDraft({ imageSize: size })}
              height={cropHeight}
            />
          </View>
          <Pressable onPress={() => setCrop(DEFAULT_CROP)} style={styles.reset} hitSlop={8} accessibilityRole="button">
            <Text style={styles.resetLabel}>{t.targeting.reset}</Text>
          </Pressable>

          <Pressable style={styles.primary} onPress={handleLaunch} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{t.targeting.launch}</Text>
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
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  caption: { fontSize: font.caption, color: color.acier, marginTop: 6, lineHeight: 18 },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  cropArea: { marginTop: space.md },
  reset: { alignSelf: "flex-end", minHeight: 36, justifyContent: "center" },
  resetLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
}));
