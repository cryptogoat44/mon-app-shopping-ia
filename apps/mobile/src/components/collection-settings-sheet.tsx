import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CollectionSummary, CollectionVisibility } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ApiError, deleteCollection, updateCollection } from "@/lib/api";
import { canSaveName, cleanCollectionName, needsShareConfirmation, visibilityOptions, visibilityState } from "@/lib/collections";
import { useToast } from "@/lib/toast-context";
import { CollectionNameField } from "@/components/collection-name-sheet";
import { ErrorMessage } from "@/components/error-message";
import { SegmentedChoice } from "@/components/segmented-choice";
import { themedStyles } from "@/theme/themed-styles";

// « Gérer » une collection (lot collections) : la renommer, choisir qui la
// voit (« Privée » par défaut, ou « Mes amis » après une confirmation qui dit
// ce que les amis verront), ou la supprimer (ses envies restent).
export function CollectionSettingsSheet({
  collection,
  onClose,
  onChanged,
  onDeleted,
}: {
  collection: CollectionSummary | null;
  onClose: () => void;
  onChanged: (collection: CollectionSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmShare, setConfirmShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(collection?.name ?? "");
    setError(null);
    setConfirmShare(false);
    setConfirmDelete(false);
  }, [collection?.id, collection?.name]);

  if (!collection) return null;
  const current = collection;
  const renamable = canSaveName(name) && cleanCollectionName(name) !== current.name && !busy;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.collections.actionError);
    } finally {
      setBusy(false);
    }
  }

  function handleRename() {
    if (!renamable) return;
    void run(async () => {
      onChanged(await updateCollection(current.id, { name: cleanCollectionName(name) }));
      showToast(t.collections.renamed);
    });
  }

  function applyVisibility(visibility: CollectionVisibility) {
    setConfirmShare(false);
    void run(async () => {
      const updated = await updateCollection(current.id, { visibility });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onChanged(updated);
      showToast(updated.visibility === "friends" ? t.collections.shared : t.collections.madePrivate);
    });
  }

  function handleVisibility(visibility: CollectionVisibility) {
    // Passer à « Mes amis » : d'abord ce que les amis verront.
    if (needsShareConfirmation(current.visibility, visibility)) setConfirmShare(true);
    else applyVisibility(visibility);
  }

  function handleDelete() {
    void run(async () => {
      await deleteCollection(current.id);
      showToast(t.collections.deleted);
      onDeleted(current.id);
    });
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.collections.close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {current.name}
          </Text>

          <Text style={styles.label}>{t.collections.nameLabel}</Text>
          <CollectionNameField value={name} onChange={setName} onSubmit={handleRename} />
          <Pressable
            style={[styles.button, renamable ? null : styles.buttonDisabled]}
            onPress={handleRename}
            disabled={!renamable}
            accessibilityRole="button"
            accessibilityState={{ disabled: !renamable, busy }}
          >
            <Text style={[styles.buttonLabel, renamable ? null : styles.labelDisabled]}>{t.collections.save}</Text>
          </Pressable>

          <Text style={styles.label}>{t.collections.visibilityTitle}</Text>
          <SegmentedChoice
            label={t.collections.visibilityTitle}
            options={visibilityOptions()}
            value={confirmShare ? "friends" : current.visibility}
            onChange={handleVisibility}
            disabled={busy}
          />
          <Text style={styles.hint}>{visibilityState(current.visibility)}</Text>
          {confirmShare ? (
            <View style={styles.confirm} testID="confirmer-amis">
              <Text style={styles.confirmTitle} accessibilityRole="alert">
                {t.collections.shareConfirmTitle}
              </Text>
              <Text style={styles.confirmText}>{t.collections.shareConfirm}</Text>
              <View style={styles.confirmButtons}>
                <Pressable style={styles.confirmButton} onPress={() => setConfirmShare(false)} disabled={busy} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>{t.collections.cancel}</Text>
                </Pressable>
                <Pressable
                  style={[styles.confirmButton, styles.confirmPrimary]}
                  onPress={() => applyVisibility("friends")}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ busy }}
                >
                  <Text style={styles.confirmPrimaryLabel}>{t.collections.shareConfirmCta}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}

          {confirmDelete ? (
            <View style={styles.confirm}>
              <Text style={styles.confirmText} accessibilityRole="alert">
                {t.collections.deleteConfirm}
              </Text>
              <View style={styles.confirmButtons}>
                <Pressable style={styles.confirmButton} onPress={() => setConfirmDelete(false)} disabled={busy} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>{t.collections.cancel}</Text>
                </Pressable>
                <Pressable style={styles.confirmButton} onPress={handleDelete} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}>
                  <Text style={styles.dangerLabel}>{t.collections.deleteConfirmCta}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.deleteRow} onPress={() => setConfirmDelete(true)} disabled={busy} accessibilityRole="button">
              <Text style={styles.dangerLabel}>{t.collections.delete}</Text>
            </Pressable>
          )}
        </ScrollView>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button">
          <Text style={styles.closeLabel}>{t.collections.close}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { maxHeight: "85%", backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  content: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  label: { fontSize: font.caption, color: color.acier, marginTop: space.sm },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
  button: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  labelDisabled: { color: color.acier },
  confirm: { backgroundColor: color.plinthe, borderRadius: radius.md, padding: space.md, gap: space.sm },
  confirmTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  confirmText: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  confirmButtons: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  confirmButton: { flexGrow: 1, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  confirmPrimary: { backgroundColor: color.vert, borderColor: color.vert },
  confirmPrimaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  cancelLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  dangerLabel: { fontSize: font.secondary, fontWeight: "600", color: color.danger },
  deleteRow: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  error: { fontSize: font.secondary },
  close: { marginTop: space.sm, marginHorizontal: space.lg, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  closeLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
