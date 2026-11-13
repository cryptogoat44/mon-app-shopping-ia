import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchWishAlertsStatus, updateWishAlertsSettings } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { loadPushDecision, pushPermission, pushSupported, savePushDecision, syncPushDevice } from "@/lib/push";
import { alertsPushOn, alertsPushPossible, alertsPushStep, type PushDecisions, type PushPermission } from "@/lib/push-state";
import { useWishAlertsStatus } from "@/lib/use-wish-alerts-status";
import { isAlertsUnavailable, pushNote, pushNoteText } from "@/lib/wish-alerts";
import { PushOfferSheet } from "@/components/push-offer-sheet";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

type Device = { supported: boolean; decisions: PushDecisions; permission: PushPermission };

// Réglages, sous les notifications de messages (lot 2) : « Alertes prix et
// stock », coupé par défaut. Caché tant que le serveur n'a pas les alertes
// (migration 0036). Allumer : sur l'iPhone, l'explication des notifications
// d'abord si la personne n'a encore rien répondu ; l'interrupteur s'allume
// quelle que soit la réponse. Couper : plus aucune alerte, les cloches
// restent ; l'appareil n'est oublié que si les messages ne le gardent pas.
// Le site : l'interrupteur se règle, les notifications n'arrivent que sur
// l'app iPhone. Notifications pas encore allumées sur le serveur : on le dit.
// Dessous (nouvelle version, 0041) : « Aider les autres membres », un réglage
// à part, allumé par défaut — coupé, vos recherches et vos signalements « Plus
// disponible » ne servent qu'à vos propres envies (vos alertes marchent toujours).
export function WishAlertsSetting() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useWishAlertsStatus();
  const [device, setDevice] = useState<Device | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"save" | "open" | "help" | null>(null);
  const [savingHelp, setSavingHelp] = useState(false);
  // Explication des notifications ouverte : avant d'allumer l'interrupteur,
  // ou pour les recevoir sur cet iPhone (interrupteur déjà allumé).
  const [explaining, setExplaining] = useState<"enable" | "device" | null>(null);

  const reloadDevice = useCallback(async () => {
    if (Platform.OS !== "ios" || !userId) return;
    try {
      const [supported, messages, alerts, permission] = await Promise.all([pushSupported(), loadPushDecision(userId, "messages"), loadPushDecision(userId, "alerts"), pushPermission()]);
      setDevice({ supported, decisions: { messages, alerts }, permission });
    } catch {
      setDevice(null);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      fetchWishAlertsStatus().catch(() => {});
      void reloadDevice();
    }, [reloadDevice])
  );

  async function apply(enabled: boolean) {
    setSaving(true);
    setError(null);
    try {
      await updateWishAlertsSettings(enabled);
      // Coupé : l'appareil est oublié si les messages ne le gardent pas ; allumé : enregistré si la personne a dit oui.
      if (userId) await syncPushDevice(userId).catch(() => {});
    } catch (e) {
      if (!isAlertsUnavailable(e)) setError("save");
    } finally {
      setSaving(false);
      void reloadDevice();
    }
  }

  async function toggleHelp(on: boolean) {
    if (savingHelp) return;
    setSavingHelp(true);
    setError(null);
    try {
      await updateWishAlertsSettings({ helpOthers: on });
    } catch (e) {
      if (!isAlertsUnavailable(e)) setError("help");
    } finally {
      setSavingHelp(false);
    }
  }

  async function toggle(on: boolean) {
    if (!userId || saving) return;
    setError(null);
    if (on && device) {
      const next = alertsPushStep({ platform: Platform.OS, status, supported: device.supported }, device.decisions, device.permission);
      if (next === "offer") {
        setExplaining("enable");
        return;
      }
      if (next === "adopt") await savePushDecision(userId, "on", "alerts").catch(() => {});
    }
    await apply(on);
  }

  if (!status.available) return null;
  const note = pushNoteText(pushNote(status, Platform.OS));
  // Sur cet iPhone, interrupteur allumé : les notifications des alertes arrivent-elles ?
  const devicePossible = device !== null && status.enabled && alertsPushPossible({ platform: Platform.OS, status, supported: device.supported });
  const deviceDenied = devicePossible && device.permission === "denied";
  const deviceOff = devicePossible && !deviceDenied && !alertsPushOn(device.decisions, device.permission);
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>{t.wishAlerts.settingTitle}</Text>
        <Switch
          accessibilityLabel={t.wishAlerts.settingSwitchLabel}
          value={status.enabled}
          disabled={saving}
          onValueChange={(on) => void toggle(on)}
          trackColor={{ true: color.vert, false: color.filet }}
          testID="interrupteur-alertes-prix"
        />
      </View>
      <Text style={styles.body}>{status.enabled ? t.wishAlerts.settingOn : t.wishAlerts.settingOff}</Text>
      {note ? <Text style={styles.body}>{note}</Text> : null}
      {deviceDenied ? (
        <>
          <Text style={styles.body}>{t.push.deniedHint}</Text>
          <Pressable onPress={() => void Linking.openSettings().catch(() => setError("open"))} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkLabel}>{t.push.openSettings}</Text>
          </Pressable>
        </>
      ) : null}
      {deviceOff ? (
        <>
          <Text style={styles.body}>{t.wishAlerts.devicePushOff}</Text>
          <Pressable onPress={() => setExplaining("device")} accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkLabel}>{t.wishAlerts.devicePushTurnOn}</Text>
          </Pressable>
        </>
      ) : null}
      {error === "save" ? <ErrorMessage style={styles.body}>{t.wishAlerts.settingFailed}</ErrorMessage> : null}
      {error === "open" ? <ErrorMessage style={styles.body}>{t.push.openSettingsFailed}</ErrorMessage> : null}
      <View style={[styles.row, styles.helpRow]}>
        <Text style={styles.title}>{t.wishAlerts.helpOthersTitle}</Text>
        <Switch
          accessibilityLabel={t.wishAlerts.helpOthersSwitchLabel}
          value={status.helpOthers}
          disabled={savingHelp}
          onValueChange={(on) => void toggleHelp(on)}
          trackColor={{ true: color.vert, false: color.filet }}
          testID="interrupteur-aider-membres"
        />
      </View>
      <Text style={styles.body}>{status.helpOthers ? t.wishAlerts.helpOthersOn : t.wishAlerts.helpOthersOff}</Text>
      {error === "help" ? <ErrorMessage style={styles.body}>{t.wishAlerts.settingFailed}</ErrorMessage> : null}
      <PushOfferSheet
        kind="alerts"
        visible={explaining !== null}
        onClose={() => {
          const reason = explaining;
          setExplaining(null);
          // « Activer » ou « Plus tard » : l'interrupteur s'allume dans les deux cas.
          if (reason === "enable") void apply(true);
          else void reloadDevice();
        }}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  helpRow: { marginTop: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
