import { ActivityIndicator, Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { VideoIcon } from "@/components/icons";
import { recordingDevice } from "@/lib/screen-recording";
import { themedStyles } from "@/theme/themed-styles";

function currentDevice() {
  const browser = Platform.OS === "web" && typeof navigator !== "undefined" ? navigator : null;
  return recordingDevice(Platform.OS, browser?.userAgent ?? null, browser?.maxTouchPoints ?? 0);
}

/** Lien collé (lot 4 ter) : la vidéo ne peut pas être lue depuis un lien —
 * l'analyse de la couverture est désactivée. Message court : comment ajouter
 * la vidéo (enregistrement de l'écran), et le bouton pour le faire. */
export function LinkNotice({ onAddVideo, busy = false, style }: { onAddVideo: () => void; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.box, style]} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">
        {t.linkNotice.title}
      </Text>
      <Text style={styles.body}>{t.linkNotice.body(t.linkNotice.how[currentDevice()])}</Text>
      <Pressable style={styles.button} onPress={onAddVideo} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={color.encre} /> : <VideoIcon size={18} tint={color.encre} />}
        <Text style={styles.buttonLabel}>{t.linkNotice.addVideo}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.xs },
  button: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 48,
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.md,
  },
  buttonLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
