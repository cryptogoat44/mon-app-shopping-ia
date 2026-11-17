import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateReadReceipts } from "@/lib/api";
import { changeReadReceipts, readReceiptsOffered } from "@/lib/read-receipts";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// « Confirmations de lecture » (lot « messages vus »), sous « Qui peut
// m'écrire » : allumé par défaut. Éteint, l'autre membre ne voit plus « Vu »
// pour vos lectures, et vous ne voyez plus les siennes (réciproque). Effet
// immédiat : le serveur l'applique à chaque lecture d'une conversation.
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
          trackColor={{ true: color.vert, false: color.filet }}
        />
      </View>
      <Text style={styles.body}>{t.settings.readReceiptsHint}</Text>
      {error ? <ErrorMessage style={styles.body}>{t.settings.readReceiptsError}</ErrorMessage> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
}));
