import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { CollectionSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ApiError, fetchCollections, fetchWishCollections, setWishCollections } from "@/lib/api";
import { selectionChanged, toggleSelection } from "@/lib/collections";
import { loadErrorMessage } from "@/lib/load-error";
import { useToast } from "@/lib/toast-context";
import { CollectionNameSheet } from "@/components/collection-name-sheet";
import { ErrorMessage } from "@/components/error-message";
import { PlusIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// « Ajouter à une collection » (lot collections), depuis une envie : ses
// collections, à cocher (une envie peut être dans plusieurs), et « Nouvelle
// collection ». Les collections marquées « Amis » sont visibles par ses amis.
export function AddToCollectionSheet({ wishId, visible, onClose }: { wishId: string; visible: boolean; onClose: () => void }) {
  const { showToast } = useToast();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [initial, setInitial] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setCollections(null);
    setError(null);
    Promise.all([fetchCollections(), fetchWishCollections(wishId)])
      .then(([all, ids]) => {
        if (cancelled) return;
        setCollections(all);
        setInitial(ids);
        setSelected(ids);
      })
      .catch((e) => {
        if (!cancelled) setError(loadErrorMessage(e, t.collections.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [visible, wishId]);

  async function handleDone() {
    if (!selectionChanged(initial, selected)) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setWishCollections(wishId, selected);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.collections.saved);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.collections.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.collections.close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.collections.sheetTitle}
        </Text>
        <Text style={styles.hint}>{t.collections.sheetHint}</Text>
        <ScrollView contentContainerStyle={styles.list}>
          {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
          {collections === null && !error ? <ActivityIndicator color={color.encre} /> : null}
          {collections?.length === 0 ? <Text style={styles.empty}>{t.collections.sheetEmpty}</Text> : null}
          {collections?.map((collection) => {
            const checked = selected.includes(collection.id);
            const shared = collection.visibility === "friends";
            return (
              <Pressable
                key={collection.id}
                style={styles.row}
                onPress={() => setSelected((current) => toggleSelection(current, collection.id))}
                disabled={saving}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                aria-checked={checked}
                accessibilityLabel={t.collections.chipLabel(collection.name, shared)}
              >
                <View style={[styles.box, checked ? styles.boxChecked : null]}>{checked ? <Text style={styles.mark}>✓</Text> : null}</View>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {collection.name}
                </Text>
                {shared ? <Text style={styles.badge}>{t.collections.sharedBadge}</Text> : null}
              </Pressable>
            );
          })}
          {collections !== null ? (
            <Pressable style={styles.row} onPress={() => setCreating(true)} disabled={saving} accessibilityRole="button" testID="nouvelle-collection">
              <View style={styles.plus}>
                <PlusIcon size={14} tint={color.vert} />
              </View>
              <Text style={styles.newLabel}>{t.collections.newCollection}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
            <Text style={styles.buttonLabel}>{t.collections.cancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primary]}
            onPress={() => void handleDone()}
            disabled={saving || collections === null}
            accessibilityRole="button"
            accessibilityState={{ busy: saving }}
            testID="valider-collections"
          >
            <Text style={[styles.buttonLabel, styles.primaryLabel]}>{saving ? t.collections.saving : t.collections.sheetDone}</Text>
          </Pressable>
        </View>
      </View>
      <CollectionNameSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(collection) => {
          // La nouvelle collection est cochée d'office.
          setCollections((current) => [...(current ?? []), collection]);
          setSelected((current) => [...current, collection.id]);
          setCreating(false);
          showToast(t.collections.created);
        }}
      />
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { maxHeight: "80%", backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, paddingHorizontal: space.lg },
  hint: { fontSize: font.caption, color: color.acier, lineHeight: 18, paddingHorizontal: space.lg, marginTop: 4, marginBottom: space.sm },
  list: { paddingHorizontal: space.lg, paddingBottom: space.md },
  error: { fontSize: font.secondary, marginBottom: space.sm },
  empty: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48 },
  box: { width: 22, height: 22, borderRadius: 4, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  boxChecked: { backgroundColor: color.vert, borderColor: color.vert },
  mark: { color: color.blanc, fontSize: font.caption, fontWeight: "700" },
  rowTitle: { flex: 1, fontSize: font.body, color: color.encre },
  badge: { fontSize: font.caption, color: color.vert, fontWeight: "600" },
  plus: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1, borderColor: color.vert, alignItems: "center", justifyContent: "center" },
  newLabel: { fontSize: font.body, color: color.vert, fontWeight: "600" },
  buttons: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, marginTop: space.sm },
  button: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: color.vert, borderColor: color.vert },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  primaryLabel: { color: color.blanc },
}));
