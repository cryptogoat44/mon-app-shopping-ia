import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { space } from "@/theme/tokens";
import { couleursInterrupteur } from "@/theme/accent";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateReadReceipts } from "@/lib/api";
import { changeReadReceipts, readReceiptsOffered } from "@/lib/read-receipts";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { ErrorMessage } from "@/components/error-message";
import { settingsGroupValues } from "@/components/settings-group";
import { themedStyles } from "@/theme/themed-styles";

// « Confirmations de lecture » (lot « messages vus »), sous « Qui peut
// m'écrire » : allumé par défaut. Éteint, l'autre membre ne voit plus « Vu »
// pour vos lectures, et vous ne voyez plus les siennes (réciproque). Effet
// immédiat : le serveur l'applique à chaque lecture d'une conversation.
// Rallumé : le serveur ne montre que vos lectures faites à partir de ce
// moment, jamais celles faites pendant qu'il était éteint.
// Caché tant que la messagerie n'est pas disponible, ou que le serveur ne
// propose pas ce réglage (profil sans `readReceipts`).
export function ReadReceiptsSetting() {
  const { profile, refreshProfile } = useAuth();
  const { enabled } = useMessagesStatus();
  const [value, setValue] = useState(profile?.readReceipts ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof profile?.readReceipts === "boolean") setValue(profile.readReceipts);
  }, [profile]);

  async function choose(next: boolean) {
    setSaving(true);
    await changeReadReceipts(next, value, { show: setValue, failed: setError, save: updateReadReceipts, refresh: refreshProfile });
    setSaving(false);
  }

  if (!readReceiptsOffered(enabled, profile)) return null;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>{t.settings.readReceiptsTitle}</Text>
        <Switch
          accessibilityLabel={t.settings.readReceiptsSwitchLabel}
          value={value}
          disabled={saving}
          onValueChange={(next) => void choose(next)}
          {...couleursInterrupteur(value)}
        />
      </View>
      <Text style={styles.body}>{t.settings.readReceiptsHint}</Text>
      {error ? <ErrorMessage style={styles.body}>{t.settings.readReceiptsError}</ErrorMessage> : null}
    </View>
  );
}

// Carte de Réglages sans surtitre (components/settings-group.tsx) : la vue extérieure EST la carte
// (marge du haut : suite du groupe au-dessus) ; jamais de marge du bas (40 pt entre deux cartes sinon).
const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return { section: { ...g.card, marginTop: space.sm }, row: g.row, title: g.rowTitle, body: g.hint };
});
