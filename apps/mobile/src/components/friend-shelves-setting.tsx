import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Switch } from "@/components/switch";
import { space } from "@/theme/tokens";
import { couleursInterrupteur } from "@/theme/accent";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateFriendShelves } from "@/lib/api";
import { friendShelvesInformed, friendShelvesSettingShown, shelfToast, showsVault, showsWishes } from "@/lib/friend-shelves";
import { useCollectionsStatus } from "@/lib/use-collections-status";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { FriendShelvesNotice } from "@/components/friend-shelves-notice";
import { settingsGroupValues } from "@/components/settings-group";
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
// Raccord avec la nouvelle interface (lot « fidélité aux maquettes », maquette
// « Écrin » 7) : une carte par réglage, comme « Proposer mon compte aux autres
// membres » juste au-dessus (components/settings-group.tsx), le message
// d'échec dans la carte du réglage touché.
export function FriendShelvesSetting() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const collections = useCollectionsStatus();
  const stored = { wishes: showsWishes(profile), vault: showsVault(profile) };
  const [value, setValue] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Shelf | null>(null);

  useEffect(() => {
    setValue({ wishes: stored.wishes, vault: stored.vault });
  }, [stored.wishes, stored.vault]);

  async function save(shelf: Shelf, next: boolean) {
    if (saving) return;
    const previous = value;
    setValue({ ...value, [shelf]: next });
    setSaving(true);
    setError(null);
    try {
      await updateFriendShelves({ [shelf]: next });
      await refreshProfile();
      showToast(shelfToast(shelf, next, friendShelvesInformed(profile), collections.enabled));
    } catch {
      setValue(previous);
      setError(shelf);
    } finally {
      setSaving(false);
    }
  }

  if (!friendShelvesSettingShown(profile)) return null;

  const row = (shelf: Shelf, title: string, help: string) => (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>{title}</Text>
        <Switch
          accessibilityLabel={title}
          accessibilityHint={help}
          value={value[shelf]}
          disabled={saving}
          onValueChange={(next) => void save(shelf, next)}
          {...couleursInterrupteur(value[shelf])}
          testID={shelf === "wishes" ? "interrupteur-envies-amis" : "interrupteur-vault-amis"}
        />
      </View>
      <Text style={styles.hint}>{help}</Text>
      {error === shelf ? <ErrorMessage style={styles.hint}>{t.friendShelves.settingError}</ErrorMessage> : null}
    </View>
  );

  return (
    <View testID="etageres-amis">
      <FriendShelvesNotice style={styles.notice} />
      {row("wishes", t.friendShelves.settingWishesTitle, t.friendShelves.settingWishesHelp)}
      {row("vault", t.friendShelves.settingVaultTitle, t.friendShelves.settingVaultHelp)}
    </View>
  );
}

// Cartes de Réglages sans surtitre (components/settings-group.tsx) : la vue de chaque réglage EST la carte (marge du
// haut : suite du groupe « Confidentialité du compte » au-dessus) ; jamais de marge du bas (40 pt entre deux cartes sinon).
const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return { notice: { marginTop: space.sm }, section: { ...g.card, marginTop: space.sm }, row: g.row, title: g.rowTitle, hint: g.hint };
});
