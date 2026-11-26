import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DEFAULT_MENTIONS_FROM, type MentionsFrom } from "@monapp/shared-types";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateMentionsFrom } from "@/lib/api";
import { SettingsChoice } from "@/components/settings-choice";
import { ErrorMessage } from "@/components/error-message";
import { settingsGroup, settingsGroupValues } from "@/components/settings-group";
import { space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Réglages, bloc « Confidentialité du compte » (lot « vie sociale »,
// migration 0046) : « Qui peut me mentionner » — tout le monde, les comptes
// que je suis (valeur de départ), ou personne. Caché tant que le serveur n'a
// pas les mentions (le profil ne dit alors rien du réglage). Le choix bouge
// tout de suite ; si l'enregistrement échoue, il revient et un message le dit.
export function MentionsFromSetting() {
  const { profile, refreshProfile } = useAuth();
  const stored = profile?.mentionsFrom;
  const [value, setValue] = useState<MentionsFrom>(stored ?? DEFAULT_MENTIONS_FROM);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (stored !== undefined) setValue(stored);
  }, [stored]);

  async function choose(next: MentionsFrom) {
    const previous = value;
    setValue(next);
    setError(false);
    try {
      await updateMentionsFrom(next);
      await refreshProfile();
    } catch {
      setValue(previous);
      setError(true);
    }
  }

  if (stored === undefined) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t.commentThreads.settingTitle}</Text>
      <View style={settingsGroup.card}>
        {/* Lot « finitions de l'œil » : une liste simple à cocher, du plus ouvert au plus fermé (même ordre et mêmes mots
            dans chaque bloc « Qui peut… »), l'explication en pied de carte. */}
        <SettingsChoice
          label={t.commentThreads.settingTitle}
          options={[
            { value: "everyone", label: t.commentThreads.everyone },
            { value: "following", label: t.commentThreads.following },
            { value: "nobody", label: t.commentThreads.nobody },
          ]}
          value={value}
          onChange={(next) => void choose(next)}
        />
        <Text style={styles.hint}>{t.commentThreads.settingHelp}</Text>
        {error ? <ErrorMessage style={styles.error}>{t.commentThreads.settingError}</ErrorMessage> : null}
      </View>
    </View>
  );
}

// Bloc groupé de Réglages (components/settings-group.tsx) : surtitre, puis une carte.
const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return { section: g.section, label: g.label, hint: { ...g.hint, paddingTop: space.xs }, error: g.hint };
});
