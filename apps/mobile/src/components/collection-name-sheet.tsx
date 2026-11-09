import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { COLLECTION_NAME_MAX_LENGTH, type CollectionSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ApiError, createCollection } from "@/lib/api";
import { canSaveName, cleanCollectionName, collectionNameLength } from "@/lib/collections";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** Champ du nom d'une collection, avec son compteur (création, renommage). */
export function CollectionNameField({ value, onChange, onSubmit }: { value: string; onChange: (value: string) => void; onSubmit?: () => void }) {
  const length = collectionNameLength(value);
  return (
    <View style={styles.field}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={t.collections.namePlaceholder}
        placeholderTextColor={color.acier}
        accessibilityLabel={t.collections.nameLabel}
        // Un peu plus que la limite : les espaces en trop sont retirés à l'enregistrement.
        maxLength={COLLECTION_NAME_MAX_LENGTH + 10}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      <Text style={[styles.counter, length > COLLECTION_NAME_MAX_LENGTH ? styles.counterOver : null]} accessibilityLiveRegion="polite">
        {t.collections.nameCounter(length, COLLECTION_NAME_MAX_LENGTH)}
      </Text>
    </View>
  );
}

// « Nouvelle collection » (lot collections) : un nom, et c'est tout — une
// nouvelle collection est toujours privée.
export function CollectionNameSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (collection: CollectionSummary) => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setError(null);
  }, [visible]);

  async function handleCreate() {
    if (saving || !canSaveName(name)) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await createCollection(cleanCollectionName(name)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.collections.saveError);
    } finally {
      setSaving(false);
    }
  }

  const ready = canSaveName(name) && !saving;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.collections.close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.collections.newCollection}
        </Text>
        <CollectionNameField value={name} onChange={setName} onSubmit={() => void handleCreate()} />
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
            <Text style={styles.buttonLabel}>{t.collections.cancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primary, ready ? null : styles.disabled]}
            onPress={() => void handleCreate()}
            disabled={!ready}
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready, busy: saving }}
            testID="creer-collection"
          >
            <Text style={[styles.buttonLabel, styles.primaryLabel, ready ? null : styles.disabledLabel]}>{saving ? t.collections.creating : t.collections.create}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.xs },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  field: { gap: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, paddingHorizontal: space.sm, fontSize: font.body, color: color.encre },
  counter: { fontSize: font.caption, color: color.acier, alignSelf: "flex-end" },
  counterOver: { color: color.danger },
  error: { fontSize: font.secondary },
  buttons: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  button: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  primary: { backgroundColor: color.vert, borderColor: color.vert },
  disabled: { backgroundColor: color.inactif, borderColor: color.inactif },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  primaryLabel: { color: color.blanc },
  disabledLabel: { color: color.surInactif },
}));
