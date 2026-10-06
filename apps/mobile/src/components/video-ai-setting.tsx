import { useState } from "react";
import { Switch, Text, View } from "react-native";
import type { ConsentStatus } from "@monapp/shared-types";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { fetchConsentStatus, recordVideoAiChoice } from "@/lib/api";
import { track } from "@/lib/analytics";
import { hasCurrentConsent } from "@/lib/policy-notice";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** Réglages → Vos données : consentement « analyse automatique de la vidéo »
 * (lot 4, temps 1 bis). Chaque changement est un nouvel événement daté ; un
 * retrait prend effet immédiatement (le serveur refuse alors tout envoi). */
export function VideoAiSetting({
  consents,
  failed,
  onChange,
}: {
  consents: ConsentStatus[] | null;
  failed: boolean;
  onChange: (statuses: ConsentStatus[]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const enabled = consents ? hasCurrentConsent(consents, "analyse_video_ia") : false;

  async function toggle(granted: boolean) {
    setSaving(true);
    setError(false);
    try {
      await recordVideoAiChoice(granted);
      track("video_ai_consent", { decision: granted ? "granted" : "withdrawn", context: "settings" });
      onChange(await fetchConsentStatus());
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <View style={styles.row}>
        <Text style={styles.title}>{t.settings.videoAiTitle}</Text>
        <Switch
          accessibilityLabel={t.settings.videoAiSwitchLabel}
          value={enabled}
          disabled={!consents || saving}
          onValueChange={(granted) => void toggle(granted)}
          trackColor={{ true: color.vert, false: color.filet }}
        />
      </View>
      <Text style={styles.body}>
        {failed ? t.settings.consentFailed : !consents ? t.settings.analyticsLoading : enabled ? t.settings.videoAiOn : t.settings.videoAiOff}
      </Text>
      {error ? <ErrorMessage style={styles.body}>{t.settings.videoAiFailed}</ErrorMessage> : null}
    </>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, gap: space.sm },
  title: { flex: 1, fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
}));
