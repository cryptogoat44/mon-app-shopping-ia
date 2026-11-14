// Essayage virtuel photo (site) : petits éléments communs aux étapes du
// parcours (titres, paragraphes, listes, boutons), dans le style des écrans
// de l'app (fiches, feuilles). Fichier .web : jamais dans l'app iPhone.
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, radius, serifFont, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

export function StepTitle({ children }: { children: string }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function SubTitle({ children }: { children: string }) {
  return (
    <Text style={styles.subtitle} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Texte courant ; `strong` : le texte principal de l'étape (encre, plus grand). */
export function Paragraph({ children, strong = false }: { children: string; strong?: boolean }) {
  return <Text style={[styles.paragraph, strong ? styles.strong : null]}>{children}</Text>;
}

export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <View role="list" style={styles.list}>
      {items.map((item) => (
        <View key={item} role="listitem" style={styles.item}>
          <Text style={styles.bullet} aria-hidden>
            ·
          </Text>
          <Text style={styles.itemText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Action en cours : le bouton ne répond plus et le dit aux lecteurs d'écran. */
  busy?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function PrimaryButton({ label, onPress, disabled = false, busy = false, accessibilityLabel, testID }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      style={[styles.primary, off ? styles.primaryOff : null]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      testID={testID}
    >
      <Text style={[styles.primaryLabel, off ? styles.primaryLabelOff : null]}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, disabled = false, busy = false, accessibilityLabel, testID }: ButtonProps) {
  const off = disabled || busy;
  return (
    <Pressable
      style={styles.secondary}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy }}
      testID={testID}
    >
      <Text style={[styles.secondaryLabel, off ? styles.labelOff : null]}>{label}</Text>
    </Pressable>
  );
}

/** Lien discret (« En savoir plus », « Fermer ») ; `expanded` : il ouvre un bloc. */
export function TextButton({ label, onPress, expanded, disabled = false }: { label: string; onPress: () => void; expanded?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      style={styles.textButton}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? { disabled } : { disabled, expanded }}
    >
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.sm },
  subtitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre, marginTop: space.md, marginBottom: space.xs },
  paragraph: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginBottom: space.sm },
  strong: { fontSize: font.body, color: color.encre, lineHeight: 24 },
  list: { marginBottom: space.sm, gap: space.xs },
  item: { flexDirection: "row", gap: space.sm },
  bullet: { fontSize: font.secondary, color: color.acier, lineHeight: 21, fontWeight: "700" },
  itemText: { flex: 1, fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.md },
  primary: {
    minHeight: 48,
    minWidth: size.touchTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.vert,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
  },
  primaryOff: { backgroundColor: color.inactif },
  primaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
  primaryLabelOff: { color: color.surInactif },
  secondary: {
    minHeight: 48,
    minWidth: size.touchTarget,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
  },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
  labelOff: { color: color.acier },
  textButton: { minHeight: size.touchTarget, justifyContent: "center", alignSelf: "flex-start" },
  textButtonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
