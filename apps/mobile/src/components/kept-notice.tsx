import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { KeptAlert } from "@/lib/keep-alert";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** Après « Garder » (lot « premier essai ») : où va la pièce, et le lien pour
 * l'y retrouver — les Envies sont le 3ᵉ onglet du Profil, qui s'ouvre sur le
 * Vault. Annoncé aussi sur iPhone (VoiceOver ignore les zones annoncées).
 * Parcours 3 : l'alerte de baisse de prix allumée par « Garder » (`alert`
 * « on ») le dit, avec « Couper l'alerte » (`onTurnOff`) ; coupée, « Alerte
 * coupée. » ; jamais allumée (« none »), le message d'avant. En échec, le
 * message d'erreur s'affiche et la ligne reste. */
export function KeptNotice({ onOpen, alert = "none", onTurnOff }: { onOpen: () => void; alert?: KeptAlert; onTurnOff?: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = alert === "on" ? t.firstTry.keptWithAlert : alert === "off" ? t.firstTry.alertTurnedOff : t.firstTry.kept;
  useEffect(() => {
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text]);

  async function turnOff() {
    if (!onTurnOff || busy) return;
    setBusy(true);
    setFailed(false);
    const off = await onTurnOff();
    setBusy(false);
    setFailed(!off);
  }

  return (
    <View accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <Text style={styles.text}>{text}</Text>
        {alert === "on" && onTurnOff ? (
          <Pressable onPress={() => void turnOff()} disabled={busy} hitSlop={8} style={styles.link} accessibilityRole="button" accessibilityState={{ disabled: busy, busy }}>
            <Text style={styles.linkLabel}>{t.firstTry.turnOffAlert}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onOpen} hitSlop={8} style={styles.link} accessibilityRole="link">
          <Text style={styles.linkLabel}>{t.firstTry.viewWishlist}</Text>
        </Pressable>
      </View>
      {failed && alert === "on" ? <ErrorMessage style={styles.error}>{t.wishAlerts.saveError}</ErrorMessage> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, marginTop: space.xs },
  text: { fontSize: font.caption, color: color.acier },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600", textDecorationLine: "underline" },
  error: { fontSize: font.caption },
}));
