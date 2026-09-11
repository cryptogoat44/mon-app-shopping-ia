import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import type { PrivacyLevel } from "@monapp/shared-types";
import { useAuth } from "@/lib/auth-context";
import { ApiError, createLifestylePost } from "@/lib/api";
import { PRIVACY_LABELS, PRIVACY_LEVELS } from "@/lib/vault-labels";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { getRecentlySpotted } from "@/api/client";
import type { Piece } from "@/api/types";
import { CameraIcon } from "@/components/icons";

export default function NewPostScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<PrivacyLevel>(profile?.defaultPrivacy ?? "followers");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentPieces, setRecentPieces] = useState<Piece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Autorisez l'accès à vos photos pour publier.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setImageUri(result.assets[0].uri);
  }

  function openPicker() {
    setPickerOpen(true);
    if (recentPieces === null) {
      getRecentlySpotted()
        .then(setRecentPieces)
        .catch(() => setRecentPieces([]));
    }
  }

  function addPieceTag(piece: Piece) {
    setPieces((current) => (current.some((p) => p.id === piece.id) ? current : [...current, piece]));
    setPickerOpen(false);
  }

  function removePieceTag(id: string) {
    setPieces((current) => current.filter((p) => p.id !== id));
  }

  async function handleSubmit() {
    setError(null);
    if (!imageUri) {
      setError("Ajoutez une photo.");
      return;
    }

    setSubmitting(true);
    try {
      await createLifestylePost({ caption: caption.trim(), imageUri, privacy });
      safeBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "La publication a échoué, réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <View style={styles.nav}>
        <Pressable onPress={safeBack} hitSlop={8} style={styles.navSide}>
          <Text style={styles.cancel}>{fr.publish.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle}>{fr.publish.title}</Text>
        <Pressable onPress={handleSubmit} disabled={submitting || !imageUri} hitSlop={8} style={[styles.navSide, styles.navSideRight]}>
          <Text style={[styles.publishLabel, (submitting || !imageUri) ? styles.publishLabelDisabled : null]}>
            {submitting ? "…" : fr.publish.publish}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.photo} onPress={handlePickPhoto}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoPreview} />
          ) : (
            <>
              <CameraIcon size={30} tint={color.acier} />
              <Text style={styles.photoLabel}>{fr.publish.addPhoto}</Text>
            </>
          )}
        </Pressable>

        <TextInput
          style={styles.caption}
          placeholder={fr.publish.captionPlaceholder}
          placeholderTextColor={color.acier}
          value={caption}
          onChangeText={setCaption}
          multiline
          maxLength={280}
        />

        <Text style={styles.label}>{fr.publish.piecesLabel}</Text>
        <View style={styles.tags}>
          {pieces.map((piece) => (
            <View key={piece.id} style={styles.tag}>
              <View style={styles.tagDot} />
              <Text style={styles.tagLabel}>{piece.name}</Text>
              <Pressable onPress={() => removePieceTag(piece.id)} hitSlop={8}>
                <Text style={styles.tagRemove}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.addTag} onPress={openPicker}>
            <Text style={styles.addTagLabel}>+ {fr.publish.addPiece}</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>{fr.publish.visibility}</Text>
        <View style={styles.tags}>
          {PRIVACY_LEVELS.map((level) => (
            <Pressable key={level} style={[styles.privacyPill, privacy === level ? styles.privacyPillActive : null]} onPress={() => setPrivacy(level)}>
              <Text style={[styles.privacyLabel, privacy === level ? styles.privacyLabelActive : null]}>{PRIVACY_LABELS[level]}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalNav}>
            <Text style={styles.navTitle}>{fr.publish.addPiece}</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
              <Text style={styles.cancel}>{fr.publish.closePicker}</Text>
            </Pressable>
          </View>
          {recentPieces?.length === 0 ? (
            <Text style={styles.emptyPicker}>{fr.publish.noRecentPieces}</Text>
          ) : (
            recentPieces?.map((piece) => (
              <Pressable key={piece.id} style={styles.pickerRow} onPress={() => addPieceTag(piece)}>
                <View style={styles.tagDot} />
                <View>
                  <Text style={styles.pickerRowName}>{piece.name}</Text>
                  {piece.material ? <Text style={styles.pickerRowMaterial}>{piece.material}</Text> : null}
                </View>
              </Pressable>
            ))
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.porcelaine },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingTop: 14, paddingBottom: 6 },
  navSide: { minWidth: 64 },
  navSideRight: { alignItems: "flex-end" },
  cancel: { fontSize: font.secondary, color: color.acier },
  navTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  publishLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  publishLabelDisabled: { color: color.acier, opacity: 0.5 },
  body: { paddingHorizontal: space.md, paddingTop: 18, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  error: { fontSize: font.caption, color: color.acier, marginBottom: space.md },
  photo: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" },
  photoPreview: { width: "100%", height: "100%" },
  photoLabel: { fontSize: font.caption, color: color.acier },
  caption: { marginTop: 18, fontSize: font.secondary, color: color.encre, lineHeight: 21, minHeight: 44 },
  label: { fontSize: font.caption, color: color.acier, marginTop: 22, marginBottom: 10 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingLeft: 6, paddingRight: 10 },
  tagDot: { width: 20, height: 20, borderRadius: radius.sm - 1, backgroundColor: color.plinthe },
  tagLabel: { fontSize: font.caption, color: color.encre },
  tagRemove: { fontSize: font.caption, color: color.acier, marginLeft: 2 },
  addTag: { borderWidth: 1, borderColor: color.filet, borderStyle: "dashed", borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  addTagLabel: { fontSize: font.caption, color: color.acier },
  privacyPill: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.full, paddingVertical: 6, paddingHorizontal: 12 },
  privacyPillActive: { backgroundColor: color.vert, borderColor: color.vert },
  privacyLabel: { fontSize: font.caption, color: color.acier },
  privacyLabelActive: { color: color.blanc, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalSheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl, maxHeight: "70%" },
  modalNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: space.md, borderBottomWidth: 1, borderBottomColor: color.filet },
  emptyPicker: { fontSize: font.secondary, color: color.acier, textAlign: "center", padding: space.xl, lineHeight: 20 },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space.md, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: color.filet },
  pickerRowName: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  pickerRowMaterial: { fontSize: font.caption, color: color.acier, marginTop: 2 },
});
