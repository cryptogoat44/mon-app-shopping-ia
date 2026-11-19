import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ACTIVITY_PUSH_KINDS, type ActivityPushKind } from "@monapp/shared-types";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { disablePush, enablePush, loadActivityDecisions, pushPermission, pushSupported } from "@/lib/push";
import { activityPushPossible, pushSwitchValue, type ActivityDecisions, type PushPermission } from "@/lib/push-state";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { useToast } from "@/lib/toast-context";
import { themedStyles } from "@/theme/themed-styles";

type Device = { supported: boolean; decisions: ActivityDecisions; permission: PushPermission };

// Réglages, juste sous « Alertes prix et stock » (lot « découverte »,
// migration 0051) : « Notifications d'activité », quatre interrupteurs
// (« j'aime », commentaires et réponses, abonnés et demandes, mentions et
// identifications), tous éteints au départ, pour CET iPhone. Caché sur le
// site, tant que le serveur ne les propose pas (`activityPush`), et si ce
// build n'a pas le module. Allumer une sorte : si iOS n'a encore rien
// demandé, sa fenêtre (seulement à ce geste, jamais au lancement). Couper :
// le serveur ne l'envoie plus ; l'appareil est oublié s'il ne reçoit plus
// rien. Un interrupteur qui n'a pas pu être enregistré revient en arrière,
// avec un message. iOS les refuse : on dit où les autoriser.
export function ActivityPushSetting() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const status = useMessagesStatus();
  const { showToast } = useToast();
  const [device, setDevice] = useState<Device | null>(null);
  // La sorte en cours d'enregistrement, et la valeur montrée pendant ce temps.
  const [pending, setPending] = useState<{ kind: ActivityPushKind; on: boolean } | null>(null);

  const reload = useCallback(async () => {
    if (Platform.OS !== "ios" || !userId) return;
    try {
      const [supported, decisions, permission] = await Promise.all([pushSupported(), loadActivityDecisions(userId), pushPermission()]);
      setDevice({ supported, decisions, permission });
    } catch {
      setDevice(null);
    }
  }, [userId]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  async function toggle(kind: ActivityPushKind, on: boolean) {
    if (!userId || !device || pending) return;
    setPending({ kind, on });
    try {
      if (!on) await disablePush(userId, kind);
      else if ((await enablePush(userId, kind)) !== "granted") showToast(t.activityPush.denied);
    } catch {
      showToast(t.push.settingFailed);
    } finally {
      setPending(null);
      // Relu sur l'appareil : la valeur enregistrée, ou l'ancienne si rien n'a pu l'être.
      await reload();
    }
  }

  if (!activityPushPossible({ platform: Platform.OS, status, supported: device?.supported ?? false })) return null;
  const denied = device?.permission === "denied";
  return (
    <View style={styles.section}>
      <Text style={styles.label} accessibilityRole="header">
        {t.activityPush.title}
      </Text>
      <Text style={styles.body}>{t.activityPush.help}</Text>
      {ACTIVITY_PUSH_KINDS.map((kind) => {
        const value = pending?.kind === kind ? pending.on : device ? pushSwitchValue(device.decisions[kind], device.permission) : false;
        return (
          <View key={kind} style={styles.row}>
            <Text style={styles.title}>{t.activityPush[kind]}</Text>
            <Switch
              accessibilityLabel={t.activityPush[kind]}
              value={value}
              disabled={!device || pending !== null || denied}
              onValueChange={(next) => void toggle(kind, next)}
              trackColor={{ true: color.vert, false: color.filet }}
              testID={`interrupteur-activite-${kind}`}
            />
          </View>
        );
      })}
      {denied ? (
        <>
          <Text style={styles.body}>{t.activityPush.denied}</Text>
          <Pressable onPress={() => void Linking.openSettings().catch(() => showToast(t.push.openSettingsFailed))} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkLabel}>{t.push.openSettings}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  section: { marginBottom: space.lg },
  label: { fontSize: font.secondary, color: color.encre, fontWeight: "600", marginBottom: space.xs },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
}));
