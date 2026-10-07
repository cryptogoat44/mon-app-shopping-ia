import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { latestVideoSettings, loadLatestVideo, saveLatestVideoChoice } from "@/lib/latest-video";
import type { GalleryAccess, LatestVideoChoice } from "@/lib/latest-video-state";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

type Settings = { choice: LatestVideoChoice | null; access: GalleryAccess };

/** Texte sous l'interrupteur : ce que fait l'option, et l'accès réellement accordé par iOS. */
function describe({ choice, access }: Settings): { body: string; accessLeft: boolean } {
  if (choice === "yes") return { body: access === "full" ? t.settings.latestVideoOn : t.settings.latestVideoOnNoAccess, accessLeft: false };
  return { body: t.settings.latestVideoOff, accessLeft: access === "full" || access === "limited" };
}

/** Réglages → Vos données (app iPhone) : « Proposer automatiquement ma
 * dernière vidéo » (lot 4 ter). Activer fait demander l'accès par iOS (une
 * fois) ; désactiver ne retire pas l'accès accordé à iOS — on dit où le faire. */
export function LatestVideoSetting() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"read" | "save" | "open" | null>(null);

  const reload = useCallback(async () => {
    if (Platform.OS !== "ios" || !userId) return;
    try {
      setSettings(await latestVideoSettings(userId));
    } catch {
      setError("read");
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  async function toggle(enabled: boolean) {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await saveLatestVideoChoice(userId, enabled ? "yes" : "no");
      // Après un « oui », iOS demande l'accès s'il ne l'a jamais fait.
      if (enabled) await loadLatestVideo(userId);
      setSettings(await latestVideoSettings(userId));
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  if (Platform.OS !== "ios") return null;
  const described = settings ? describe(settings) : null;
  const showOpenSettings = settings !== null && (described?.accessLeft || (settings.choice === "yes" && settings.access !== "full"));
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.title}>{t.settings.latestVideoTitle}</Text>
        <Switch
          accessibilityLabel={t.settings.latestVideoSwitchLabel}
          value={settings?.choice === "yes"}
          disabled={!settings || saving}
          onValueChange={(enabled) => void toggle(enabled)}
          trackColor={{ true: color.vert, false: color.filet }}
        />
      </View>
      <Text style={styles.body}>{described ? described.body : error === "read" ? t.settings.latestVideoUnavailable : t.settings.analyticsLoading}</Text>
      {described?.accessLeft ? <Text style={styles.body}>{t.settings.latestVideoAccessLeft}</Text> : null}
      {showOpenSettings ? (
        <Pressable onPress={() => void Linking.openSettings().catch(() => setError("open"))} accessibilityRole="link" style={styles.link}>
          <Text style={styles.linkLabel}>{t.settings.latestVideoOpenSettings}</Text>
        </Pressable>
      ) : null}
      {error === "save" ? <ErrorMessage style={styles.body}>{t.settings.latestVideoFailed}</ErrorMessage> : null}
      {error === "open" ? <ErrorMessage style={styles.body}>{t.settings.latestVideoOpenFailed}</ErrorMessage> : null}
    </>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
