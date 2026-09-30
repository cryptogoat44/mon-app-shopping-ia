import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Choix exclusif en pastilles (lot 3 : langue, apparence). Annoncé comme un
// groupe de boutons radio ; chaque pastille fait au moins 44 pt de haut.
export function SegmentedChoice<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
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
            accessibilityLabel={option.label}
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
