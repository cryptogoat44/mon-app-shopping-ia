import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { VaultCategory } from "@monapp/shared-types";
import { addVaultItemFromPhoto } from "@/lib/api";
import { importPhotoForSpotter } from "@/lib/image-import";
import { vaultChanged } from "@/lib/vault-changes";
import {
  VAULT_TITLE_MAX_LENGTH,
  checkNewVaultItem,
  vaultCategoryChoices,
  vaultFormIssueMessage,
  vaultSaveErrorMessage,
} from "@/lib/vault-form";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { CameraIcon } from "@/components/icons";
import { SpotImage } from "@/components/spot-image";
import { SegmentedChoice } from "@/components/segmented-choice";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Lot 2 (Vault) : ajouter à la main une pièce qu'on possède déjà — une photo
// de la galerie, un titre et une catégorie, tous obligatoires (mêmes règles
// que le serveur : lib/vault-form.ts). Présenté comme « Nouvelle
// publication » (feuille modale). La photo passe par le même import que
// « Changer la photo » : réduite avant l'envoi, site et iPhone. Après
// l'ajout, retour au Vault, qui se relit en reprenant la main (profil).

// iPhone : pendant l'envoi, la feuille ne se ferme pas non plus en la
// glissant vers le bas, comme « Annuler ». Deux objets fixes : les options
// de l'écran ne changent qu'au début et à la fin d'un envoi.
const SHEET_OPEN = { gestureEnabled: true };
const SHEET_LOCKED = { gestureEnabled: false };

export default function NewVaultItemScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<VaultCategory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Garde immédiate contre un double appui : l'état `submitting` ne
  // désactive le bouton qu'au rendu suivant.
  const submittingRef = useRef(false);
  // Feuille quittée pendant l'envoi (retour du navigateur, sur le site) : la
  // pièce est quand même ajoutée et le profil se relit (lib/vault-changes.ts) ;
  // on le dit, ou on dit l'échec, par un message flottant, sans naviguer.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function safeBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/profile");
  }

  // Le message d'erreur disparaît dès que la personne corrige le formulaire.
  function changeTitle(value: string) {
    setTitle(value);
    setError(null);
  }

  function chooseCategory(value: VaultCategory) {
    setCategory(value);
    setError(null);
  }

  async function handlePickPhoto() {
    setError(null);
    const picked = await importPhotoForSpotter();
    if (picked.kind === "unavailable") return setError(t.common.photoUnavailable);
    if (picked.kind !== "picked") return;
    setImageUri(picked.uri);
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    setError(null);
    const checked = checkNewVaultItem({ imageUri, title, category });
    if (!checked.ok) {
      setError(vaultFormIssueMessage(checked.issue));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await addVaultItemFromPhoto(checked.value);
      // Prévenu avant le retour : sous la feuille, le profil se relira en
      // reprenant la main (une seule lecture) ; déjà revenu au premier plan
      // (feuille quittée pendant l'envoi), il se relit tout de suite.
      vaultChanged();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.vaultForm.added);
      // Le bouton reste désactivé jusqu'à la fermeture : jamais d'ajout en double.
      if (mountedRef.current) safeBack();
    } catch (e) {
      const message = vaultSaveErrorMessage(e, t.vaultForm.addError);
      if (!mountedRef.current) return showToast(message);
      setError(message);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.sheet}>
      <Stack.Screen options={submitting ? SHEET_LOCKED : SHEET_OPEN} />
      <View style={styles.handle} />
      <View style={styles.nav}>
        {/* Pas d'annulation pendant l'envoi : l'ajout ne peut plus être retenu. */}
        <Pressable accessibilityRole="button" onPress={safeBack} disabled={submitting} hitSlop={12} style={styles.navSide}>
          <Text style={styles.cancel}>{t.vaultForm.cancel}</Text>
        </Pressable>
        <Text style={styles.navTitle} accessibilityRole="header">
          {t.vaultForm.title}
        </Text>
        <View style={styles.navSide} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.note}>{t.vaultForm.privateNote}</Text>

        {imageUri ? (
          <>
            {/* Image entière, comme sur l'écran de la pièce. */}
            <View style={[styles.photo, styles.photoFilled]}>
              <SpotImage fallbackUri={imageUri} style={styles.photoPreview} accessibilityLabel={t.vaultForm.photoLabel} />
            </View>
            <Pressable onPress={handlePickPhoto} disabled={submitting} hitSlop={8} style={styles.changePhoto} accessibilityRole="button">
              <Text style={styles.changePhotoLabel}>{t.vaultForm.changePhoto}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[styles.photo, styles.photoEmpty]}
            onPress={handlePickPhoto}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={t.vaultForm.addPhoto}
          >
            <CameraIcon size={28} tint={color.acier} />
            <Text style={styles.photoHint}>{t.vaultForm.addPhoto}</Text>
          </Pressable>
        )}

        <Text style={styles.label}>{t.vaultForm.titleLabel}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={changeTitle}
          placeholder={t.vaultForm.titlePlaceholder}
          placeholderTextColor={color.acier}
          maxLength={VAULT_TITLE_MAX_LENGTH}
          returnKeyType="done"
          editable={!submitting}
          accessibilityLabel={t.vaultForm.titleLabel}
        />

        <Text style={styles.label}>{t.vaultForm.categoryLabel}</Text>
        <SegmentedChoice
          label={t.vaultForm.categoryLabel}
          options={vaultCategoryChoices()}
          value={category}
          onChange={chooseCategory}
          disabled={submitting}
        />

        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

        <Pressable
          style={[styles.cta, submitting ? styles.ctaDisabled : null]}
          onPress={handleSubmit}
          disabled={submitting}
          accessibilityRole="button"
          aria-busy={submitting}
        >
          <Text style={[styles.ctaLabel, submitting ? styles.ctaLabelDisabled : null]}>
            {submitting ? t.vaultForm.submitting : t.vaultForm.submit}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => ({
  sheet: { flex: 1, backgroundColor: color.porcelaine },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9 },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, paddingTop: 14, paddingBottom: 6 },
  navSide: { minWidth: 64 },
  cancel: { fontSize: font.secondary, color: color.acier },
  navTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  body: { paddingHorizontal: space.md, paddingTop: 18, paddingBottom: space.xxl, maxWidth: 480, alignSelf: "center", width: "100%" },
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginBottom: space.md },
  // Cadre 4:5 de l'écran de la pièce, en plus petit : le formulaire tient
  // presque entier sur un écran d'iPhone.
  photo: {
    width: "100%",
    maxWidth: 240,
    aspectRatio: 4 / 5,
    alignSelf: "center",
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // Sans photo : un cadre en pointillés sur le fond (la plinthe ne porte
  // jamais de texte).
  photoEmpty: { borderWidth: 1, borderColor: color.filet, borderStyle: "dashed", gap: space.sm },
  photoFilled: { backgroundColor: color.plinthe },
  photoPreview: { width: "100%", height: "100%" },
  photoHint: { fontSize: font.caption, color: color.acier },
  changePhoto: { alignSelf: "center", minHeight: 40, justifyContent: "center" },
  changePhotoLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.lg, marginBottom: space.xs },
  input: { borderBottomWidth: 1, borderBottomColor: color.filet, paddingVertical: 10, fontSize: font.body, color: color.encre },
  error: { fontSize: font.secondary, marginTop: space.lg },
  cta: { backgroundColor: color.vert, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: space.lg },
  ctaDisabled: { backgroundColor: color.inactif },
  ctaLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  ctaLabelDisabled: { color: color.surInactif },
}));
