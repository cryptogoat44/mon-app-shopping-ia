import { Pressable, StyleSheet, Text, View } from "react-native";
import { color, font } from "@/theme/tokens";
import { CheckIcon } from "@/components/icons";
import { settingsGroupValues } from "@/components/settings-group";
import { themedStyles } from "@/theme/themed-styles";

// Lot « finitions de l'œil » (maquette « Écrin » 7) : un choix exclusif des
// Réglages (« Qui peut… », Langue, Apparence) en liste simple à cocher, dans
// la carte : une ligne de 44 points par choix, le libellé à gauche, la coche à
// droite, un filet entre les lignes — comme les autres lignes des Réglages et
// la feuille du tri du Résultat. Plus de grosses pastilles qui s'empilent une
// par ligne à 320 points. Annoncé comme un groupe de boutons radio (sur le
// site, l'état coché passe par aria-checked) ; mêmes valeurs enregistrées,
// mêmes libellés, dans l'ordre donné par l'écran.
export function SettingsChoice<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (value: V) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            accessibilityLabel={option.label}
            onPress={() => (selected ? undefined : onChange(option.value))}
            style={[styles.row, index > 0 ? styles.divided : null]}
          >
            <Text style={[styles.rowTitle, selected ? styles.selected : null]}>{option.label}</Text>
            {selected ? (
              <View accessible={false}>
                <CheckIcon size={16} tint={color.encre} strokeWidth={2} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return {
    row: g.row,
    rowTitle: g.rowTitle,
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.filet },
    selected: { fontWeight: "500" as const, fontSize: font.secondary },
  };
});
