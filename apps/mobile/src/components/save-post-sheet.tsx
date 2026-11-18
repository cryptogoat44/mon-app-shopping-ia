import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { CollectionSummary } from "@monapp/shared-types";
import { fetchCollections } from "@/lib/api";
import { saveSheetOptions, type SaveSheetOption, type SaveState } from "@/lib/saved-posts";
import { ErrorMessage } from "@/components/error-message";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// « Ranger dans une collection » (publications enregistrées, migration 0048) :
// ses collections, « Sans collection », et « Retirer des enregistrées » quand
// la publication l'est. Les choix de rangement se comportent comme des boutons
// radio (un seul coché). C'est le seul chemin vers ces choix sur le site ; sur
// l'iPhone, l'appui long sur le signet l'ouvre aussi. Vos collections sont
// relues à chaque ouverture ; illisibles, les deux derniers choix restent.

interface SavePostSheetProps {
  visible: boolean;
  state: SaveState;
  busy: boolean;
  onClose: () => void;
  /** Ranger dans cette collection (null : sans collection) ; enregistre aussi. */
  onChoose: (collectionId: string | null, collections: readonly CollectionSummary[] | null) => void;
  onRemove: () => void;
}

export function SavePostSheet({ visible, state, busy, onClose, onChoose, onRemove }: SavePostSheetProps) {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setFailed(false);
    fetchCollections()
      .then((list) => {
        if (active) setCollections(list);
      })
      .catch(() => {
        if (!active) return;
        setCollections(null);
        setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const options = saveSheetOptions(collections, state);
  const filing = options.filter((option) => option.kind !== "remove");
  const remove = options.find((option) => option.kind === "remove");

  function choose(option: SaveSheetOption) {
    if (busy || option.selected) return;
    onChoose(option.collectionId, collections);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.savedPosts.sheetTitle}
        </Text>
        <Text style={styles.note}>{t.savedPosts.privateNote}</Text>
        {loading ? <ActivityIndicator color={color.encre} style={styles.loader} /> : null}
        {failed ? <ErrorMessage style={styles.error}>{t.savedPosts.collectionsLoadError}</ErrorMessage> : null}
        <ScrollView style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={t.savedPosts.sheetTitle}>
          {filing.map((option) => (
            <Pressable
              key={option.key}
              style={[styles.row, busy ? styles.busy : null]}
              onPress={() => choose(option)}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.selected, selected: option.selected, disabled: busy }}
              aria-checked={option.selected}
              accessibilityLabel={option.label}
              testID={option.kind === "none" ? "ranger-sans-collection" : `ranger-${option.key}`}
            >
              <View style={[styles.radio, option.selected ? styles.radioOn : null]}>{option.selected ? <View style={styles.radioDot} /> : null}</View>
              <Text style={[styles.label, option.kind === "none" ? styles.labelNone : null]} numberOfLines={2}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {remove ? (
          <Pressable
            style={[styles.remove, busy ? styles.busy : null]}
            onPress={() => {
              if (!busy) onRemove();
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            testID="retirer-des-enregistrees"
          >
            <Text style={styles.removeLabel}>{remove.label}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelLabel}>{t.common.close}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl, maxHeight: "75%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  note: { fontSize: font.caption, color: color.acier, textAlign: "center", paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm, lineHeight: 18 },
  loader: { paddingVertical: space.sm },
  error: { fontSize: font.secondary, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.sm },
  list: { paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52, borderBottomWidth: 1, borderBottomColor: color.filet },
  radio: { width: 22, height: 22, borderRadius: radius.full, borderWidth: 1.5, borderColor: color.acier, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: color.vert },
  radioDot: { width: 11, height: 11, borderRadius: radius.full, backgroundColor: color.vert },
  label: { flex: 1, fontSize: font.secondary, color: color.encre },
  labelNone: { color: color.acier },
  busy: { opacity: 0.6 },
  remove: { marginTop: space.md, marginHorizontal: space.lg, minHeight: 44, justifyContent: "center", alignItems: "center" },
  removeLabel: { fontSize: font.secondary, fontWeight: "600", color: color.danger },
  cancel: { marginTop: space.sm, marginHorizontal: space.lg, minHeight: 44, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
