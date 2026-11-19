import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateDiscoverable } from "@/lib/api";
import { discoverableSettingShown } from "@/lib/for-you";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Réglages, bloc « Confidentialité du compte » (lot « découverte », migration
// 0050) : « Proposer mon compte aux autres membres », allumé par défaut.
// Éteint, ni « Pour vous » ni les suggestions ne montrent le compte ou ses
// publications aux membres qui ne le suivent pas. Caché tant que le serveur
// n'a pas le réglage (le profil n'en dit alors rien). L'interrupteur bouge
// tout de suite ; si l'enregistrement échoue, il revient et un message le dit.
export function DiscoverableSetting() {
  const { profile, refreshProfile } = useAuth();
  const stored = profile?.discoverable;
  const [value, setValue] = useState(stored !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (stored !== undefined) setValue(stored);
  }, [stored]);

  async function toggle(next: boolean) {
    if (saving) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(false);
    try {
      await updateDiscoverable(next);
      await refreshProfile();
    } catch {
      setValue(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!discoverableSettingShown(profile)) return null;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>{t.forYou.settingTitle}</Text>
        <Switch
          accessibilityLabel={t.forYou.settingTitle}
          accessibilityHint={t.forYou.settingHelp}
          value={value}
          disabled={saving}
          onValueChange={(next) => void toggle(next)}
          trackColor={{ true: color.vert, false: color.filet }}
          testID="interrupteur-proposer-compte"
        />
      </View>
      <Text style={styles.hint}>{t.forYou.settingHelp}</Text>
      {error ? <ErrorMessage style={styles.hint}>{t.forYou.settingError}</ErrorMessage> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 44 },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  hint: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 19 },
}));
