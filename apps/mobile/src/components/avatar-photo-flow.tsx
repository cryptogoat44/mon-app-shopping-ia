import { useCallback, useEffect, useReducer, useRef } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { ApiError, deleteAvatar, uploadAvatar } from "@/lib/api";
import { imageFileFromUri } from "@/lib/image-file";
import { CLOSED, avatarFlow, isUploadTooLarge, refusalMessage, uploadTooLargeMessage, type AvatarPick } from "@/lib/avatar-photo";
import { CAN_TAKE_PHOTO, pickAvatarFromLibrary, releasePickedImage, takeAvatarPhoto } from "@/lib/avatar-source";
import { renderAvatarCrop } from "@/lib/avatar-image";
import type { PixelCrop } from "@/lib/avatar-crop";
import { ErrorMessage } from "@/components/error-message";
import { AvatarCrop } from "@/components/avatar-crop";

// Photo de profil (lot « profil et icône des réglages ») : menu (galerie,
// appareil photo sur iPhone, fichier sur le site, « Supprimer ma photo »),
// puis cadrage en carré avec aperçu, puis envoi. Les étapes sont dans
// lib/avatar-photo.ts. Ouvert depuis l'onglet Profil (appui sur la photo) et
// depuis « Modifier le profil ».

/** Délai de secours avant d'ouvrir la galerie, si iOS n'a pas signalé la fermeture du menu. */
const SHEET_CLOSE_FALLBACK_MS = 700;

export function AvatarPhotoFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [flow, dispatch] = useReducer(avatarFlow, CLOSED);
  // Choix à lancer une fois le menu fermé (iPhone : la galerie ne s'ouvre pas par-dessus un menu qui se ferme).
  const pendingPick = useRef<(() => Promise<AvatarPick>) | null>(null);
  const pickedUri = useRef<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) dispatch({ type: "open" });
  }, [open]);

  // Parcours terminé : l'image choisie est libérée et l'écran prévenu.
  useEffect(() => {
    if (flow.step !== "closed") {
      wasOpen.current = true;
      if (flow.step === "crop") pickedUri.current = flow.image.uri;
      return;
    }
    if (pickedUri.current) releasePickedImage(pickedUri.current);
    pickedUri.current = null;
    if (wasOpen.current) {
      wasOpen.current = false;
      onClose();
    }
  }, [flow, onClose]);

  const runPick = useCallback(async (pick: () => Promise<AvatarPick>) => {
    dispatch({ type: "picked", result: await pick() });
  }, []);

  const launchPending = useCallback(() => {
    const pick = pendingPick.current;
    pendingPick.current = null;
    if (pick) void runPick(pick);
  }, [runPick]);

  // Secours : si la fermeture du menu n'a pas été signalée, la galerie s'ouvre quand même.
  useEffect(() => {
    if (flow.step !== "picking" || Platform.OS === "web") return;
    const timer = setTimeout(launchPending, SHEET_CLOSE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [flow.step, launchPending]);

  function choose(pick: () => Promise<AvatarPick>) {
    dispatch({ type: "pick" });
    // Site : le choix du fichier s'ouvre tout de suite, dans le geste de la personne.
    if (Platform.OS === "web") void runPick(pick);
    else pendingPick.current = pick;
  }

  async function validate(crop: PixelCrop) {
    if (flow.step !== "crop") return;
    const image = flow.image;
    dispatch({ type: "validate" });
    const uri = await renderAvatarCrop(image, crop);
    if (!uri) {
      dispatch({ type: "failed", message: refusalMessage("unreadable") });
      return;
    }
    try {
      const file = await imageFileFromUri(uri);
      if (isUploadTooLarge(file.size)) {
        dispatch({ type: "failed", message: uploadTooLargeMessage() });
        return;
      }
      await uploadAvatar(uri);
      await refreshProfile();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.profile.avatarUpdated);
      dispatch({ type: "succeeded" });
    } catch (e) {
      dispatch({ type: "failed", message: e instanceof ApiError ? e.message : t.avatarPhoto.sendError });
    } finally {
      releasePickedImage(uri);
    }
  }

  async function remove() {
    dispatch({ type: "confirmDelete" });
    try {
      await deleteAvatar();
      await refreshProfile();
      showToast(t.avatarPhoto.removed);
      dispatch({ type: "succeeded" });
    } catch (e) {
      dispatch({ type: "failed", message: e instanceof ApiError ? e.message : t.avatarPhoto.removeError });
    }
  }

  const sheetVisible = flow.step === "menu" || flow.step === "confirmDelete" || flow.step === "deleting";
  const close = () => dispatch({ type: "close" });

  return (
    <>
      <Modal visible={sheetVisible} animationType="slide" transparent onRequestClose={close} onDismiss={launchPending}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t.avatarPhoto.cancel} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            {t.avatarPhoto.menuTitle}
          </Text>
          {flow.step === "menu" ? (
            <>
              {flow.error ? <ErrorMessage style={styles.error}>{flow.error}</ErrorMessage> : null}
              <SheetItem
                label={Platform.OS === "web" ? t.avatarPhoto.chooseFile : t.avatarPhoto.chooseFromLibrary}
                onPress={() => choose(pickAvatarFromLibrary)}
                border
              />
              {CAN_TAKE_PHOTO ? <SheetItem label={t.avatarPhoto.takePhoto} onPress={() => choose(takeAvatarPhoto)} border={Boolean(profile?.avatarUrl)} /> : null}
              {profile?.avatarUrl ? <SheetItem label={t.avatarPhoto.remove} onPress={() => dispatch({ type: "askDelete" })} danger /> : null}
            </>
          ) : flow.step === "confirmDelete" ? (
            <>
              <Text style={styles.confirm}>{t.avatarPhoto.removeConfirm}</Text>
              <SheetItem label={t.avatarPhoto.remove} onPress={remove} danger />
            </>
          ) : (
            <View style={styles.busy}>
              <ActivityIndicator color={color.encre} size="small" />
              <Text style={styles.busyLabel}>{t.avatarPhoto.deleting}</Text>
            </View>
          )}
          <Pressable style={styles.cancel} onPress={close} disabled={flow.step === "deleting"} accessibilityRole="button" accessibilityLabel={t.avatarPhoto.cancel}>
            <Text style={styles.cancelLabel}>{t.avatarPhoto.cancel}</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={flow.step === "crop" || flow.step === "sending"} animationType="slide" onRequestClose={close}>
        {flow.step === "crop" || flow.step === "sending" ? (
          <AvatarCrop
            image={flow.image}
            busy={flow.step === "sending"}
            error={flow.step === "crop" ? flow.error : null}
            onCancel={close}
            onValidate={validate}
          />
        ) : null}
      </Modal>
    </>
  );
}

function SheetItem({ label, onPress, border = false, danger = false }: { label: string; onPress: () => void; border?: boolean; danger?: boolean }) {
  return (
    <Pressable style={[styles.item, border ? styles.itemBorder : null]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={[styles.itemLabel, danger ? styles.itemDanger : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.secondary, color: color.acier, textAlign: "center", fontWeight: "600", paddingBottom: space.sm },
  error: { fontSize: font.caption, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.sm },
  item: { paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: "center" },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: color.filet },
  itemLabel: { fontSize: font.body, color: color.encre, fontWeight: "500" },
  itemDanger: { color: color.danger },
  confirm: { fontSize: font.secondary, color: color.acier, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.md, lineHeight: 20 },
  busy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingVertical: space.md },
  busyLabel: { fontSize: font.body, color: color.encre },
  cancel: { marginTop: space.sm, marginHorizontal: space.lg, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
