import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import type { KeptAlert } from "@/lib/keep-alert";
import { keptNoticeAnnounces, TURN_OFF_IDLE, turnOffFinished, turnOffStarted, turnOffStateFor, type AnnouncedNotice } from "@/lib/kept-notice-state";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

/** Après « Garder » (lot « premier essai ») : où va la pièce, et le lien pour
 * l'y retrouver — les Envies sont le 3ᵉ onglet du Profil, qui s'ouvre sur le
 * Vault. Annoncé aussi sur iPhone (VoiceOver ignore les zones annoncées).
 * Parcours 3 : l'alerte de baisse de prix allumée par « Garder » (`alert`
 * « on ») le dit, avec « Couper l'alerte » (`onTurnOff`) ; coupée, « Alerte
 * coupée. » ; jamais allumée (« none »), le message d'avant. En échec, le
 * message d'erreur s'affiche et la ligne reste. `pieceId` : la pièce de la
 * grande carte ; « en cours » et « en échec » restent à leur pièce
 * (lib/kept-notice-state.ts), sans remonter le message, qui n'est donc pas
 * relu quand la grande carte passe d'une pièce gardée à une autre. */
export function KeptNotice({ pieceId, onOpen, alert = "none", onTurnOff }: { pieceId: string; onOpen: () => void; alert?: KeptAlert; onTurnOff?: () => Promise<boolean> }) {
  const [turnOffState, setTurnOffState] = useState(TURN_OFF_IDLE);
  const { busy, failed } = turnOffStateFor(turnOffState, pieceId);
  const text = alert === "on" ? t.firstTry.keptWithAlert : alert === "off" ? t.firstTry.alertTurnedOff : t.firstTry.kept;
  const announced = useRef<AnnouncedNotice | null>(null);
  useEffect(() => {
    const next = { pieceId, text };
    if (keptNoticeAnnounces(announced.current, next) && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
    announced.current = next;
  }, [pieceId, text]);

  async function turnOff() {
    if (!onTurnOff || busy) return;
    const piece = pieceId;
    setTurnOffState(turnOffStarted(piece));
    const off = await onTurnOff();
    setTurnOffState((prev) => turnOffFinished(prev, piece, off));
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
  linkLabel: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "600" },
  error: { fontSize: font.caption },
}));
