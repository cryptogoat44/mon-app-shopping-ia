import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateFriendShelves } from "@/lib/api";
import { friendShelvesInformed, friendShelvesSettingShown, shelfToast, showsVault, showsWishes } from "@/lib/friend-shelves";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { FriendShelvesNotice } from "@/components/friend-shelves-notice";
import { themedStyles } from "@/theme/themed-styles";

type Shelf = "wishes" | "vault";

// Réglages, bloc « Confidentialité du compte » (lot « étagères des amis »,
// migration 0058, refonte selon le fondateur) : « Montrer mes Envies à mes
// amis » et « Montrer mon Vault à mes amis », allumés par défaut. Éteindre ou
// rallumer se fait d'un geste, sans confirmation ; un message court confirme
// chaque changement. Tant que le membre n'a pas vu l'information « Ce que vos
// amis peuvent voir », elle est aussi montrée ici, au-dessus des
// interrupteurs (rien n'est montré aux amis avant sa réponse). Caché tant
// que le serveur n'a pas les réglages (le profil n'en dit alors rien). Si
// l'enregistrement échoue, l'interrupteur revient et un message le dit.
export function FriendShelvesSetting() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const collections = useCollectionsStatus();
  const stored = { wishes: showsWishes(profile), vault: showsVault(profile) };
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setValue({ wishes: stored.wishes, vault: stored.vault });
  }, [stored.wishes, stored.vault]);

  async function save(shelf: Shelf, next: boolean) {
    if (saving) return;
    const previous = value;
    setValue({ ...value, [shelf]: next });
    setSaving(true);
    setError(false);
    try {
      await updateFriendShelves({ [shelf]: next });
      await refreshProfile();
      showToast(shelfToast(shelf, next, friendShelvesInformed(profile), collections.enabled));
    } catch {
      setValue(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (!friendShelvesSettingShown(profile)) return null;

  const row = (shelf: Shelf, title: string, help: string) => (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        <Switch
          accessibilityLabel={title}
          accessibilityHint={help}
          value={value[shelf]}
          disabled={saving}
          onValueChange={(next) => void save(shelf, next)}
          trackColor={{ true: color.vert, false: color.filet }}
          testID={shelf === "wishes" ? "interrupteur-envies-amis" : "interrupteur-vault-amis"}
        />
      </View>
      <Text style={styles.hint}>{help}</Text>
    </View>
  );

  return (
    <View style={styles.section} testID="etageres-amis">
      <FriendShelvesNotice />
      {row("wishes", t.friendShelves.settingWishesTitle, t.friendShelves.settingWishesHelp)}
      {row("vault", t.friendShelves.settingVaultTitle, t.friendShelves.settingVaultHelp)}
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
}));
