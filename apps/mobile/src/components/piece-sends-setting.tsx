import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { PieceSendsFrom } from "@monapp/shared-types";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updatePieceSendsFrom } from "@/lib/api";
import { SegmentedChoice } from "@/components/segmented-choice";
import { ErrorMessage } from "@/components/error-message";
import { settingsGroup, settingsGroupValues } from "@/components/settings-group";
import { themedStyles } from "@/theme/themed-styles";

// « Qui peut m'envoyer des pièces » (lot 5, 5.C) : les comptes que je suis
// (par défaut), tout le monde, ou personne. Effet immédiat ; le serveur
// l'applique à chaque envoi, blocages compris.
export function PieceSendsSetting() {
  const { profile, refreshProfile } = useAuth();
  const [value, setValue] = useState<PieceSendsFrom>(profile?.pieceSendsFrom ?? "following");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (profile) setValue(profile.pieceSendsFrom);
  }, [profile]);

  async function choose(next: PieceSendsFrom) {
    const previous = value;
    setValue(next);
    setError(false);
    try {
      await updatePieceSendsFrom(next);
      await refreshProfile();
    } catch {
      setValue(previous);
      setError(true);
    }
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t.settings.pieceSendsTitle}</Text>
      <View style={settingsGroup.card}>
        <View style={styles.choice}>
          <SegmentedChoice
            label={t.settings.pieceSendsTitle}
            options={[
              { value: "following", label: t.settings.pieceSendsFollowing },
              { value: "everyone", label: t.settings.pieceSendsEveryone },
              { value: "nobody", label: t.settings.pieceSendsNobody },
            ]}
            value={value}
            onChange={(next) => void choose(next)}
          />
        </View>
        <Text style={styles.hint}>{t.settings.pieceSendsHint}</Text>
        {error ? <ErrorMessage style={styles.hint}>{t.settings.pieceSendsError}</ErrorMessage> : null}
      </View>
    </View>
  );
}

// Bloc groupé de Réglages (components/settings-group.tsx) : surtitre, puis une carte.
const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return { section: g.section, label: g.label, choice: g.choice, hint: g.hint };
});
