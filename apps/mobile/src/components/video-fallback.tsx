// Écran de secours « Spottez cette vidéo » (mission « liens vidéo ») :
// lecteur coupé (build ou serveur), plateforme absente du build, accord
// refusé, code Instagram indisponible, erreur du lecteur TikTok, compte privé,
// vue web en erreur, instantané impossible. « Ouvrir la vidéo », puis trois
// gestes. Le lien reste en attente 10 minutes : la prochaine recherche lui
// est associée (lib/pending-video-link.ts).
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { CameraIcon, VideoIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

export function VideoFallback({
  lead,
  onOpenVideo,
  onAddScreenshot,
  busy,
}: {
  lead: string;
  /** null : aucune adresse sûre à ouvrir (bouton masqué). */
  onOpenVideo: (() => void) | null;
  onAddScreenshot: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">
        {t.videoLink.fallbackTitle}
      </Text>
      <Text style={styles.body}>{lead}</Text>
      {onOpenVideo ? (
        <Pressable style={styles.primary} onPress={onOpenVideo} accessibilityRole="button">
          <VideoIcon size={18} tint={color.blanc} />
          <Text style={styles.primaryLabel}>{t.player.open}</Text>
        </Pressable>
      ) : null}
      <View style={styles.steps}>
        {t.videoLink.steps.map((text, index) => (
          <View key={index} style={styles.stepRow}>
            <Text style={styles.stepNumber}>{index + 1}</Text>
            <Text style={styles.stepText}>{text}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>{t.videoLink.held}</Text>
      <Pressable style={styles.secondary} onPress={onAddScreenshot} disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }}>
        {busy ? <ActivityIndicator color={color.encre} /> : <CameraIcon size={18} tint={color.encre} />}
        <Text style={styles.secondaryLabel}>{t.firstTry.linkHelp.addScreenshot}</Text>
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  box: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, alignSelf: "stretch" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.xs },
  primary: { backgroundColor: color.vert, borderRadius: radius.md, minHeight: 48, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", marginTop: space.md },
  primaryLabel: { color: color.blanc, fontSize: font.body, fontWeight: "600" },
  steps: { marginTop: space.md, gap: space.sm },
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
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18, marginTop: space.md },
  secondary: {
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
  secondaryLabel: { color: color.encre, fontSize: font.body, fontWeight: "500" },
}));
