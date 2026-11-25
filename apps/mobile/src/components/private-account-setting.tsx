import { useEffect, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { couleursInterrupteur } from "@/theme/accent";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updatePrivateAccount } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { themedStyles } from "@/theme/themed-styles";

// Réglages, bloc « Confidentialité du compte » (lot « vie sociale »,
// migration 0045) : « Compte privé », coupé par défaut. Caché tant que le
// serveur n'a pas le compte privé (le profil ne dit alors rien du réglage).
// Allumer : immédiat, les abonnés actuels restent. Couper : une confirmation
// d'abord, car les demandes en attente sont effacées. L'interrupteur bouge
// tout de suite ; si l'enregistrement échoue, il revient et un message le dit.
export function PrivateAccountSetting() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const stored = profile?.isPrivate;
  const [value, setValue] = useState(stored === true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (stored !== undefined) setValue(stored);
  }, [stored]);

  async function apply(next: boolean) {
    const previous = value;
    setConfirming(false);
    setValue(next);
    setSaving(true);
    try {
      await updatePrivateAccount(next);
      await refreshProfile();
    } catch {
      setValue(previous);
      showToast(t.privateAccount.settingError);
    } finally {
      setSaving(false);
    }
  }

  function toggle(next: boolean) {
    if (saving) return;
    // Repasser en public efface les demandes en attente : on demande d'abord.
    if (!next) setConfirming(true);
    else void apply(true);
  }

  if (stored === undefined) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{t.privateAccount.sectionTitle}</Text>
      <View style={styles.row}>
        <Text style={styles.title}>{t.privateAccount.settingTitle}</Text>
        <Switch
          accessibilityLabel={t.privateAccount.settingTitle}
          accessibilityHint={t.privateAccount.settingHelp}
          value={value}
          disabled={saving}
          onValueChange={toggle}
          {...couleursInterrupteur(value)}
          testID="interrupteur-compte-prive"
        />
      </View>
      <Text style={styles.hint}>{t.privateAccount.settingHelp}</Text>
      {confirming ? (
        <View style={styles.confirm} accessibilityRole="alert">
          <Text style={styles.confirmText}>{t.privateAccount.goPublicConfirm}</Text>
          <View style={styles.confirmActions}>
            <Pressable style={styles.button} onPress={() => setConfirming(false)} accessibilityRole="button">
              <Text style={styles.buttonLabel}>{t.privateAccount.goPublicNo}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void apply(false)} accessibilityRole="button" testID="confirmer-compte-public">
              <Text style={styles.buttonLabel}>{t.privateAccount.goPublicYes}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  label: { fontSize: font.caption, fontWeight: "600", color: color.acier, marginBottom: space.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 44 },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  hint: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 19 },
  confirm: { marginTop: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, gap: space.md },
  confirmText: { fontSize: font.secondary, color: color.encre, lineHeight: 20 },
  confirmActions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  button: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
