import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** État « erreur » d'un écran (charte, règle 1) : le message, annoncé aux
 * lecteurs d'écran (hors ligne compris, voir lib/load-error.ts), et
 * « Réessayer ». */
export function LoadFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.box}>
      <ErrorMessage style={styles.message}>{message}</ErrorMessage>
      <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button" accessibilityLabel={t.common.retry}>
        <Text style={styles.buttonLabel}>{t.common.retry}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { alignItems: "center", paddingVertical: space.xl, gap: space.md },
  message: { fontSize: font.secondary, textAlign: "center", lineHeight: 20 },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.filet,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.vert },
}));
