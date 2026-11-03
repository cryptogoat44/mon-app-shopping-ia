import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Choix exclusif en pastilles (lot 3 : langue, apparence). Annoncé comme un
// groupe de boutons radio ; chaque pastille fait au moins 44 pt de haut.
// Lot 2 (Vault) : `value` à null tant que rien n'est choisi (catégorie d'une
// pièce à ajouter) ; `disabled` pendant un envoi. Sur le site, l'état coché
// passe par aria-checked : react-native-web ignore accessibilityState.
export function SegmentedChoice<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V | null;
  onChange: (value: V) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            accessibilityLabel={option.label}
            disabled={disabled}
            onPress={() => (selected ? undefined : onChange(option.value))}
            style={[styles.pill, selected ? styles.pillActive : null]}
          >
            <Text style={[styles.pillLabel, selected ? styles.pillLabelActive : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  pill: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  pillActive: { backgroundColor: color.vert, borderColor: color.vert },
  pillLabel: { fontSize: font.secondary, color: color.encre },
  pillLabelActive: { color: color.blanc, fontWeight: "600" },
}));
