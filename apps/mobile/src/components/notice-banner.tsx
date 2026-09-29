import { useEffect } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, radius, space } from "@/theme/tokens";

// Bandeau discret en bas de l'écran, au-dessus de la barre d'onglets (en
// haut, il masquerait le bouton « Retour »). Conteneur pleine largeur +
// carte centrée : un élément positionné ignore « alignSelf » (calage à
// gauche sur écran large, corrigé au lot 2).

export interface NoticeAction {
  label: string;
  /** Libellé lu par les lecteurs d'écran, si différent du texte affiché. */
  accessibilityLabel?: string;
  role: "button" | "link";
  emphasis?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

const TAB_BAR_CLEARANCE = 72;

export function NoticeBanner({ message, actions, error }: { message: string; actions: NoticeAction[]; error?: string | null }) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View style={[styles.wrapper, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]} pointerEvents="box-none">
      <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.text}>{message}</Text>
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole={action.role}
              accessibilityLabel={action.accessibilityLabel ?? action.label}
              accessibilityState={{ disabled: !!action.disabled }}
              disabled={action.disabled}
              hitSlop={12}
              style={styles.action}
              onPress={action.onPress}
            >
              <Text style={action.emphasis ? styles.emphasis : styles.plain}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: "absolute", left: space.md, right: space.md, alignItems: "center", zIndex: 10 },
  banner: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: color.blanc,
    borderColor: color.filet,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    shadowColor: color.encre,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  text: { fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  error: { fontSize: font.caption, color: color.erreur, marginTop: space.xs },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.lg, marginTop: space.sm },
  action: { minHeight: 44, justifyContent: "center" },
  emphasis: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  plain: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
});
