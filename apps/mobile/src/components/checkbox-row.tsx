import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, font, space } from "@/theme/tokens";

// Case à cocher avec son libellé (consentements : inscription, nouvelle
// version des conditions). Toute la ligne est touchable.
export function CheckboxRow({
  label,
  checked,
  onToggle,
  style,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      style={[styles.row, style]}
      onPress={onToggle}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <View style={[styles.box, checked ? styles.boxChecked : null]}>{checked ? <Text style={styles.mark}>✓</Text> : null}</View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export const CHECKBOX_SIZE = 20;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, minHeight: 24 },
  box: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxChecked: { backgroundColor: color.vert, borderColor: color.vert },
  mark: { color: color.blanc, fontSize: font.caption, fontWeight: "700", lineHeight: 14 },
  label: { flex: 1, fontSize: font.caption, color: color.acier, lineHeight: 18 },
});
