import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { couleursInterrupteur } from "@/theme/accent";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { latestVideoSettings, loadLatestVideo, saveLatestVideoChoice } from "@/lib/latest-video";
import type { GalleryAccess, LatestVideoChoice } from "@/lib/latest-video-state";
import { ErrorMessage } from "@/components/error-message";
import { settingsGroup, settingsGroupValues } from "@/components/settings-group";
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
      {/* Lignes posées dans la carte « Vos données » de Réglages (components/settings-group.tsx) : un filet, jamais une carte à elles. */}
      <View style={settingsGroup.divider} />
      <View style={styles.row}>
        <Text style={styles.title}>{t.settings.latestVideoTitle}</Text>
        <Switch
          accessibilityLabel={t.settings.latestVideoSwitchLabel}
          value={settings?.choice === "yes"}
          disabled={!settings || saving}
          onValueChange={(enabled) => void toggle(enabled)}
          {...couleursInterrupteur(settings?.choice === "yes")}
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

const styles = themedStyles(() => {
  const g = settingsGroupValues();
  return {
    row: g.row,
    title: g.rowTitle,
    body: g.hint,
    link: g.linkRow,
    linkLabel: g.link,
  };
});
