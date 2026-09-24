import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SEARCH_QUERY_MAX_LENGTH, type CropRect } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { closeSpotter } from "@/lib/spot-navigation";
import { CropSelector } from "@/components/crop-selector";
import { DEFAULT_CROP } from "@/lib/crop-geometry";
import { draftImageUri, getDraft, updateDraft } from "@/lib/spot-draft";

// Étape 2 : l'utilisateur entoure la pièce (seule cette zone part à
// l'analyse) et peut préciser ce qu'il cherche. Toujours aucun crédit
// consommé : c'est « Lancer l'identification » qui engage la recherche.
export default function TargetingScreen() {
  const router = useRouter();
  const { searchId } = useLocalSearchParams<{ searchId?: string }>();
  const { height: windowHeight } = useWindowDimensions();
  const draft = getDraft();
  const imageUri = draft ? draftImageUri(draft) : null;

  const [crop, setCrop] = useState<CropRect>(draft?.crop ?? DEFAULT_CROP);
  const [query, setQuery] = useState(draft?.query ?? "");
  const [dragging, setDragging] = useState(false);

  // Brouillon perdu (page rechargée sur le web avec une photo importée,
  // qui ne vit que dans cet onglet) : on repart proprement.
  if (!draft || !imageUri) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.lead}>{fr.preview.missing}</Text>
          <Pressable style={styles.primary} onPress={() => closeSpotter(router)} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{fr.preview.back}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  function handleLaunch() {
    updateDraft({ crop, query: query.trim() });
    router.push({ pathname: "/spot/analysis", params: { searchId: searchId ?? "" } });
  }

  const cropHeight = Math.min(Math.max(windowHeight * 0.48, 300), 460);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.nav}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.navSide} accessibilityRole="button" accessibilityLabel="Retour">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.step}>{fr.targeting.step}</Text>
        <Pressable onPress={() => closeSpotter(router)} hitSlop={12} style={[styles.navSide, styles.navRight]} accessibilityRole="button">
          <Text style={styles.close}>{fr.spotter.close}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            {fr.targeting.title}
          </Text>
          <Text style={styles.caption}>{fr.targeting.caption}</Text>

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
            <Text style={styles.resetLabel}>{fr.targeting.reset}</Text>
          </Pressable>

          <Text style={styles.label}>
            {fr.targeting.queryLabel} <Text style={styles.optional}>{fr.targeting.queryOptional}</Text>
          </Text>
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder={fr.targeting.queryPlaceholder}
              placeholderTextColor="#A3A3A8"
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              returnKeyType="search"
              onSubmitEditing={handleLaunch}
              accessibilityLabel={`${fr.targeting.queryLabel} ${fr.targeting.queryOptional}`}
            />
            {query.length > 0 ? (
              <Text style={styles.counter}>
                {query.length}/{SEARCH_QUERY_MAX_LENGTH}
              </Text>
            ) : null}
          </View>
          <Text style={styles.caption}>{fr.targeting.queryHint}</Text>

          <Pressable style={styles.primary} onPress={handleLaunch} accessibilityRole="button">
            <Text style={styles.primaryLabel}>{fr.targeting.launch}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  flex: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, gap: space.lg },
  nav: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12 },
  navSide: { minWidth: 44, height: 44, justifyContent: "center" },
  navRight: { alignItems: "flex-end" },
  close: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  back: { fontSize: 26, color: color.encre },
  step: { fontSize: font.caption, color: color.acier },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 29 },
  caption: { fontSize: font.caption, color: color.acier, marginTop: 6, lineHeight: 18 },
  lead: { fontSize: font.secondary, color: color.acier, lineHeight: 21 },
  cropArea: { marginTop: space.md },
  reset: { alignSelf: "flex-end", minHeight: 36, justifyContent: "center" },
  resetLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.md },
  optional: { color: color.acier, opacity: 0.8 },
  field: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: color.filet },
  input: { flex: 1, fontSize: font.body, color: color.encre, paddingVertical: 12 },
  counter: { fontSize: font.caption, color: color.acier },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: space.lg },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
});
