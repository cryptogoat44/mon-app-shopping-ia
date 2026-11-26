import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DEFAULT_MESSAGES_FROM, type MessagesFrom } from "@monapp/shared-types";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateMessagesFrom } from "@/lib/api";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { SettingsChoice } from "@/components/settings-choice";
import { ErrorMessage } from "@/components/error-message";
import { settingsGroup, settingsGroupValues } from "@/components/settings-group";
import { space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// « Qui peut m'écrire » (lot messages) : les invitations des membres qui ne
// sont pas vos amis — tout le monde (par défaut), les comptes que je suis,
// ou mes amis seulement. Vos amis peuvent toujours vous écrire. Caché tant
// que la messagerie n'est pas disponible sur le serveur.
export function MessagesFromSetting() {
  const { profile, refreshProfile } = useAuth();
  const { enabled } = useMessagesStatus();
  const [value, setValue] = useState<MessagesFrom>(profile?.messagesFrom ?? DEFAULT_MESSAGES_FROM);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (profile?.messagesFrom) setValue(profile.messagesFrom);
  }, [profile]);

  async function choose(next: MessagesFrom) {
    const previous = value;
    setValue(next);
    setError(false);
    try {
      await updateMessagesFrom(next);
      await refreshProfile();
    } catch {
      setValue(previous);
      setError(true);
    }
  }

  if (!enabled) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t.settings.messagesFromTitle}</Text>
      <View style={settingsGroup.card}>
        {/* Lot « finitions de l'œil » : une liste simple à cocher, du plus ouvert au plus fermé (même ordre et mêmes mots
            dans chaque bloc « Qui peut… »), l'explication en pied de carte. */}
        <SettingsChoice
          label={t.settings.messagesFromTitle}
          options={[
            { value: "everyone", label: t.settings.messagesFromEveryone },
            { value: "following", label: t.settings.messagesFromFollowing },
            { value: "nobody", label: t.settings.messagesFromNobody },
          ]}
          value={value}
          onChange={(next) => void choose(next)}
        />
        <Text style={styles.hint}>{t.settings.messagesFromHint}</Text>
        {error ? <ErrorMessage style={styles.error}>{t.settings.messagesFromError}</ErrorMessage> : null}
      </View>
    </View>
  );
}

// Bloc groupé de Réglages (components/settings-group.tsx) : surtitre, puis une carte.
const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return { section: g.section, label: g.label, hint: { ...g.hint, paddingTop: space.xs }, error: g.hint };
});
