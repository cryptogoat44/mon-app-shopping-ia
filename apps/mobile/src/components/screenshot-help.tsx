import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { CameraIcon, VideoIcon } from "@/components/icons";
import { currentDevice } from "@/components/link-notice";
import { themedStyles } from "@/theme/themed-styles";

/** Lien TikTok, Instagram ou Pinterest (lot « premier essai ») : la capture
 * d'écran au bon moment d'abord — une photo, sans IA ni mots obligatoires —,
 * puis l'enregistrement de l'écran, le chemin le plus lourd. */
export function ScreenshotHelp({ onAddScreenshot, onAddVideo, busy }: { onAddScreenshot: () => void; onAddVideo: () => void; busy: boolean }) {
  const device = currentDevice();
  const shortcut = t.preview.screenshotShortcut[device === "computer" ? "web" : device];
  // Pause et capture : les trois premières étapes de l'écran Aperçu (désactivé) ;
  // la dernière nomme le bouton ci-dessous.
  const steps = [...t.preview.captureSteps(t.preview.theApp, shortcut).slice(0, 3), t.firstTry.linkHelp.lastStep(t.firstTry.linkHelp.addScreenshot)];
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">
        {t.firstTry.linkHelp.title}
      </Text>
      <Text style={styles.body}>{t.firstTry.linkHelp.lead}</Text>
      <View style={styles.steps}>
        {steps.map((text, index) => (
          <View key={index} style={styles.stepRow}>
            <Text style={styles.stepNumber}>{index + 1}</Text>
            <Text style={styles.stepText}>{text}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.primary} onPress={onAddScreenshot} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }}>
        <CameraIcon size={18} tint={color.blanc} />
        <Text style={styles.primaryLabel}>{t.firstTry.linkHelp.addScreenshot}</Text>
      </Pressable>
      <Text style={[styles.body, styles.spaced]}>{t.firstTry.linkHelp.recording(t.linkNotice.how[device])}</Text>
      <Pressable style={styles.secondary} onPress={onAddVideo} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }}>
        {busy ? <ActivityIndicator color={color.encre} /> : <VideoIcon size={18} tint={color.encre} />}
        <Text style={styles.secondaryLabel}>{t.linkNotice.addVideo}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.xs },
  spaced: { marginTop: space.lg },
  steps: { marginTop: space.sm, gap: space.sm },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.filet,
    textAlign: "center",
    lineHeight: 20,
    fontSize: font.caption,
    color: color.encre,
    fontWeight: "600",
  },
  stepText: { flex: 1, fontSize: font.secondary, color: color.encre, lineHeight: 21 },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 48, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.md },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderColor: color.filet,
    borderRadius: radius.md,
    minHeight: 48,
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: space.sm,
  },
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
