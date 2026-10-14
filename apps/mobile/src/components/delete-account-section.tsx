import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ACCOUNT_DELETION_WORDS, isAccountDeletionWord } from "@monapp/shared-types";
import { color, font, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { ApiError, deleteMyAccount } from "@/lib/api";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** « Supprimer mon compte » (Réglages) : l'avertissement, puis le mot de
 * confirmation à taper dans la langue de l'app (lot 5). Le bouton ne s'active
 * qu'avec le bon mot ; le serveur le revérifie, et refuse un compte
 * administrateur avec un message clair, affiché ici. */
export function DeleteAccountSection({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = getActiveLocale();
  const word = ACCOUNT_DELETION_WORDS[locale];
  const ready = isAccountDeletionWord(typed, locale) && !deleting;

  async function handleDelete() {
    if (!ready) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteMyAccount(typed);
      await onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t.settings.deleteError);
      setDeleting(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t.settings.dangerZone}</Text>
      {!confirming ? (
        <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} hitSlop={12}>
          <Text style={styles.danger}>{t.settings.deleteAccount}</Text>
        </Pressable>
      ) : (
        <View>
          <Text style={styles.body}>{t.settings.deleteConfirm}</Text>
          <Text style={styles.body}>{t.settings.deleteTypeWord(word)}</Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            editable={!deleting}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            accessibilityLabel={t.settings.deleteWordLabel(word)}
            returnKeyType="done"
            onSubmitEditing={() => void handleDelete()}
          />
          {error ? <ErrorMessage style={styles.body}>{error}</ErrorMessage> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={cancel} disabled={deleting} hitSlop={12}>
              <Text style={styles.cancel}>{t.common.cancel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              onPress={() => void handleDelete()}
              disabled={!ready}
              hitSlop={12}
            >
              <Text style={[styles.danger, !ready ? styles.inactive : null]}>{deleting ? t.settings.deleting : t.settings.confirmDelete}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { borderTopWidth: 1, borderTopColor: color.filet, paddingTop: space.lg },
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.sm },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  input: {
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: color.filet,
    paddingVertical: 10,
    fontSize: font.body,
    color: color.encre,
    marginBottom: space.md,
  },
  actions: { flexDirection: "row", gap: space.lg, marginTop: space.xs },
  danger: { color: color.danger, fontSize: font.secondary, fontWeight: "600" },
  // Désactivé : texte secondaire, contraste AA conservé (4,9:1 en clair, 7,6:1 en sombre).
  inactive: { color: color.acier },
  cancel: { color: color.acier, fontSize: font.secondary, fontWeight: "600" },
}));
