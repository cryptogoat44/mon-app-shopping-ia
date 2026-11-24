import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Switch, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateFriendShelves } from "@/lib/api";
import { friendShelvesSettingShown, needsShelfConfirmation, showsVault, showsWishes } from "@/lib/friend-shelves";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

type Shelf = "wishes" | "vault";

// Réglages, bloc « Confidentialité du compte » (lot « étagères des amis »,
// migration 0058) : « Montrer mes Envies à mes amis » et « Montrer mon Vault
// à mes amis », éteints au départ. Allumer demande une confirmation, qui dit
// clairement ce que les amis verront ; éteindre se fait d'un geste. Caché
// tant que le serveur n'a pas les réglages (le profil n'en dit alors rien).
// L'interrupteur reste éteint pendant la confirmation (rien n'est montré tant
// que le membre n'a pas dit oui) ; la confirmation est annoncée à VoiceOver.
// Si l'enregistrement échoue, l'interrupteur revient et un message le dit.
export function FriendShelvesSetting() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const collections = useCollectionsStatus();
  const stored = { wishes: showsWishes(profile), vault: showsVault(profile) };
  const [value, setValue] = useState(stored);
  const [confirming, setConfirming] = useState<Shelf | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setValue({ wishes: stored.wishes, vault: stored.vault });
  }, [stored.wishes, stored.vault]);

  async function save(shelf: Shelf, next: boolean) {
    if (saving) return;
    const previous = value;
    setValue({ ...value, [shelf]: next });
    setConfirming(null);
    setSaving(true);
    setError(false);
    try {
      await updateFriendShelves({ [shelf]: next });
      await refreshProfile();
      showToast(
        shelf === "wishes"
          ? next
            ? t.friendShelves.wishesShown
            : collections.enabled
              ? t.friendShelves.wishesPrivateAgainCollections
              : t.friendShelves.wishesPrivateAgain
          : next
            ? t.friendShelves.vaultShown
            : t.friendShelves.vaultPrivateAgain
      );
    } catch {
      setValue(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function toggle(shelf: Shelf, next: boolean, confirmTitle: string, confirmBody: string) {
    if (saving) return;
    // Éteindre pendant la confirmation : comme « Annuler », rien n'avait été montré.
    if (!next && confirming === shelf && !value[shelf]) {
      setConfirming(null);
      return;
    }
    if (needsShelfConfirmation(next)) {
      setConfirming(shelf);
      // iOS n'annonce pas le rôle « alert » : on lit la confirmation à VoiceOver.
      if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(`${confirmTitle} ${confirmBody}`);
    } else void save(shelf, false);
  }

  if (!friendShelvesSettingShown(profile)) return null;

  const row = (shelf: Shelf, title: string, help: string, confirmTitle: string, confirmBody: string) => (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        <Switch
          accessibilityLabel={title}
          accessibilityHint={help}
          // Pendant la confirmation, l'interrupteur reste à la valeur enregistrée.
          value={value[shelf]}
          disabled={saving}
          onValueChange={(next) => toggle(shelf, next, confirmTitle, confirmBody)}
          trackColor={{ true: color.vert, false: color.filet }}
          testID={shelf === "wishes" ? "interrupteur-envies-amis" : "interrupteur-vault-amis"}
        />
      </View>
      <Text style={styles.hint}>{help}</Text>
      {confirming === shelf ? (
        <View style={styles.confirm} testID={shelf === "wishes" ? "confirmer-envies-amis" : "confirmer-vault-amis"}>
          <Text style={styles.confirmTitle} accessibilityRole="alert">
            {confirmTitle}
          </Text>
          <Text style={styles.confirmText}>{confirmBody}</Text>
          <View style={styles.confirmButtons}>
            <Pressable style={styles.confirmButton} onPress={() => setConfirming(null)} disabled={saving} accessibilityRole="button">
              <Text style={styles.cancelLabel}>{t.friendShelves.cancel}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, styles.confirmPrimary]}
              onPress={() => void save(shelf, true)}
              disabled={saving}
              accessibilityRole="button"
              accessibilityState={{ busy: saving }}
            >
              <Text style={styles.confirmPrimaryLabel}>{t.friendShelves.confirmCta}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.section} testID="etageres-amis">
      {row("wishes", t.friendShelves.settingWishesTitle, t.friendShelves.settingWishesHelp, t.friendShelves.confirmWishesTitle, t.friendShelves.confirmWishesBody)}
      {row("vault", t.friendShelves.settingVaultTitle, t.friendShelves.settingVaultHelp, t.friendShelves.confirmVaultTitle, t.friendShelves.confirmVaultBody)}
      {error ? <ErrorMessage style={styles.hint}>{t.friendShelves.settingError}</ErrorMessage> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  block: { marginBottom: space.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 44 },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  hint: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 19 },
  confirm: { marginTop: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, gap: space.sm },
  confirmTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  confirmText: { fontSize: font.secondary, color: color.acier, lineHeight: 19 },
  confirmButtons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm },
  confirmButton: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  confirmPrimary: { backgroundColor: color.vert },
  cancelLabel: { fontSize: font.secondary, color: color.encre },
  confirmPrimaryLabel: { fontSize: font.secondary, color: color.blanc, fontWeight: "600" },
}));
