import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from "react-native";
import { theme } from "@/lib/theme";

export function FormField({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.color.muted}
        style={[styles.input, error ? styles.inputError : null]}
        autoCapitalize="none"
        autoCorrect={false}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, disabled ? styles.buttonDisabled : null, pressed ? styles.buttonPressed : null]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export function ChipSelector<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={[styles.chip, selected ? styles.chipSelected : null]}
            >
              <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>{labels[option]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Checkbox({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onToggle} style={styles.checkboxRow} hitSlop={4}>
      <View style={[styles.checkboxBox, checked ? styles.checkboxBoxChecked : null]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkboxLabel}>{children}</Text>
    </Pressable>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: theme.space.md },
  label: {
    fontSize: theme.font.small,
    color: theme.color.muted,
    marginBottom: theme.space.xs,
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 12,
    fontSize: theme.font.body,
    color: theme.color.ink,
  },
  inputError: { borderColor: theme.color.danger },
  error: { color: theme.color.danger, fontSize: theme.font.small, marginTop: theme.space.xs },
  button: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.md,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: theme.space.sm,
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: theme.color.ground, fontSize: theme.font.body, fontWeight: "600" },
  link: { color: theme.color.accentInk, fontSize: theme.font.small, textAlign: "center", marginTop: theme.space.md },
  banner: {
    backgroundColor: theme.color.dangerSoft,
    borderRadius: theme.radius.md,
    padding: theme.space.sm,
    marginBottom: theme.space.md,
  },
  bannerText: { color: theme.color.danger, fontSize: theme.font.small },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  chip: {
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface,
    borderRadius: 100,
    paddingHorizontal: theme.space.md,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: theme.color.ink, borderColor: theme.color.ink },
  chipLabel: { fontSize: theme.font.small, color: theme.color.ink },
  chipLabelSelected: { color: theme.color.ground, fontWeight: "600" },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm, marginBottom: theme.space.md },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.color.line,
    backgroundColor: theme.color.surface,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxBoxChecked: { backgroundColor: theme.color.ink, borderColor: theme.color.ink },
  checkboxMark: { color: theme.color.ground, fontSize: 13, fontWeight: "700", lineHeight: 14 },
  checkboxLabel: { flex: 1, fontSize: theme.font.small, color: theme.color.ink, lineHeight: 18 },
});
