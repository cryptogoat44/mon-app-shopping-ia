import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, loadPushDecision, pushPermission, pushSupported } from "@/lib/push";
import { pushSwitchValue, pushSwitchVisible, type PushDecision, type PushPermission } from "@/lib/push-state";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { PushOfferSheet } from "@/components/push-offer-sheet";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

type Settings = { supported: boolean; decision: PushDecision | null; permission: PushPermission };

// Réglages, sous « Qui peut m'écrire » (lot notifications) : « Notifications
// de messages ». Caché sur le site, et tant que le serveur ne les propose pas
// (ou que ce build n'a pas le module). Allumer : si iOS n'a encore rien
// demandé, la feuille d'explication d'abord, puis la fenêtre d'iOS ; si iOS
// les a refusées, on dit où les autoriser. Couper : cet appareil est oublié
// sur le serveur (l'autorisation d'iOS, elle, reste).
export function MessagePushSetting() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useMessagesStatus();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<"save" | "open" | null>(null);

  const reload = useCallback(async () => {
    if (Platform.OS !== "ios" || !userId) return;
    try {
      const [supported, decision, permission] = await Promise.all([pushSupported(), loadPushDecision(userId), pushPermission()]);
      setSettings({ supported, decision, permission });
    } catch {
      setSettings(null);
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  async function toggle(on: boolean) {
    if (!userId || !settings) return;
    setError(null);
    // Jamais demandé par iOS : l'explication d'abord (la feuille demande ensuite).
    if (on && settings.permission === "undetermined") {
      setExplaining(true);
      return;
    }
    setSaving(true);
    try {
      if (on) await enablePush(userId);
      else await disablePush(userId);
    } catch {
      setError("save");
    } finally {
      setSaving(false);
      await reload();
    }
  }

  if (!pushSwitchVisible({ platform: Platform.OS, status, supported: settings?.supported ?? false })) return null;
  const value = settings ? pushSwitchValue(settings.decision, settings.permission) : false;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>{t.push.settingTitle}</Text>
        <Switch
          accessibilityLabel={t.push.settingSwitchLabel}
          value={value}
          disabled={!settings || saving}
          onValueChange={(on) => void toggle(on)}
          trackColor={{ true: color.vert, false: color.filet }}
        />
      </View>
      <Text style={styles.body}>{!settings ? t.push.settingLoading : value ? t.push.settingOn : t.push.settingOff}</Text>
      {settings?.permission === "denied" ? (
        <>
          <Text style={styles.body}>{t.push.deniedHint}</Text>
          <Pressable onPress={() => void Linking.openSettings().catch(() => setError("open"))} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkLabel}>{t.push.openSettings}</Text>
          </Pressable>
        </>
      ) : null}
      {error === "save" ? <ErrorMessage style={styles.body}>{t.push.settingFailed}</ErrorMessage> : null}
      {error === "open" ? <ErrorMessage style={styles.body}>{t.push.openSettingsFailed}</ErrorMessage> : null}
      <PushOfferSheet
        visible={explaining}
        onClose={() => {
          setExplaining(false);
          void reload();
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
