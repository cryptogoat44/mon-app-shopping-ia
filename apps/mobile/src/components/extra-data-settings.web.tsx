// Site, Réglages → Vos données : « Essayage virtuel : retirer mon
// consentement », dès qu'un consentement est donné, essayage allumé ou
// éteint : le droit de retrait prime (GET /api/tryon/consent se lit même
// fonction éteinte). Le retrait (DELETE /api/tryon/consent) passe par une
// confirmation ; le consentement sera redemandé avant le prochain essai.
// Version iPhone : rien (extra-data-settings.tsx), règle 2.5.19 d'Apple.
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { tryonText } from "@/i18n/tryon.web";
import { withdrawTryonConsent } from "@/lib/tryon-api.web";
import { canWithdrawConsent, failureOf, withdrawFailureMessage } from "@/lib/tryon-flow.web";
import { updateTryonStatus } from "@/lib/tryon-status.web";
import { useTryonConsentGiven } from "@/lib/use-tryon-consent.web";
import { useTryonStatus } from "@/lib/use-tryon-status.web";
import { ErrorMessage } from "@/components/error-message";

type Phase = "idle" | "confirm" | "withdrawing" | "withdrawn";

export function ExtraDataSettings() {
  const status = useTryonStatus();
  const given = useTryonConsentGiven();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Double appui avant le nouveau rendu : un seul retrait part.
  const withdrawing = useRef(false);

  async function withdraw() {
    if (withdrawing.current) return;
    withdrawing.current = true;
    setPhase("withdrawing");
    setError(null);
    try {
      const consent = await withdrawTryonConsent();
      updateTryonStatus({ consent });
      setPhase("withdrawn");
    } catch (e) {
      setError(withdrawFailureMessage(failureOf(e)));
      setPhase("confirm");
    } finally {
      withdrawing.current = false;
    }
  }

  if (phase === "withdrawn") {
    return (
      <>
        <Text style={styles.title}>{tryonText.settings.title}</Text>
        <Text style={styles.body} accessibilityLiveRegion="polite">
          {tryonText.settings.withdrawn}
        </Text>
      </>
    );
  }
  if (!canWithdrawConsent(given, status)) return null;
  const busy = phase === "withdrawing";
  return (
    <>
      <Text style={styles.title}>{tryonText.settings.title}</Text>
      <Text style={styles.body}>{tryonText.settings.body}</Text>
      {phase === "idle" ? (
        <Pressable onPress={() => setPhase("confirm")} accessibilityRole="button" accessibilityLabel={tryonText.settings.withdrawLabel} style={styles.link}>
          <Text style={styles.linkLabel}>{tryonText.settings.withdraw}</Text>
        </Pressable>
      ) : (
        <View style={styles.confirm}>
          <Text style={styles.body}>{tryonText.settings.confirm}</Text>
          {error ? <ErrorMessage style={styles.body}>{error}</ErrorMessage> : null}
          <View style={styles.buttons}>
            <Pressable onPress={() => setPhase("idle")} disabled={busy} accessibilityRole="button" style={styles.link}>
              <Text style={styles.cancelLabel}>{tryonText.settings.cancel}</Text>
            </Pressable>
            <Pressable onPress={() => void withdraw()} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }} style={styles.link}>
              <Text style={styles.dangerLabel}>{busy ? tryonText.settings.withdrawing : tryonText.settings.confirmWithdraw}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

// Même présentation que les autres lignes de « Vos données » (components/player-consent-setting.tsx).
const styles = themedStyles(() => ({
  title: { fontSize: font.secondary, color: color.encre, fontWeight: "600", minHeight: 44, textAlignVertical: "center", paddingTop: space.sm },
  body: { fontSize: font.secondary, color: color.acier, marginBottom: space.sm, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: "center", marginBottom: space.sm },
  linkLabel: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  confirm: { marginBottom: space.sm },
  buttons: { flexDirection: "row", gap: space.lg },
  cancelLabel: { fontSize: font.secondary, color: color.acier, fontWeight: "600" },
  dangerLabel: { fontSize: font.secondary, color: color.danger, fontWeight: "600" },
}));
