import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, radius, serifFont, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { reportStockGone } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { isAlertsUnavailable, stockReportErrorMessage, stockReportRequest, type StockReportTarget } from "@/lib/wish-alerts";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Lot 2 — « Plus disponible » : un lien discret, en gris, sous une
// proposition (grande carte, sections, liste triée par prix) ou sur la fiche
// d'une envie, puis une confirmation. Le serveur marque la pièce épuisée pour
// les membres qui la suivent, SANS leur envoyer d'alerte ; son retour en
// stock, plus tard, pourra les prévenir. Personne ne sait qui a signalé.

/** « Plus disponible ? » : zone séparée de la carte (jamais dans la zone qui
 * la met en grand). Le nom de la pièce est lu par VoiceOver. */
export function StockReportLink({ pieceName, onPress, style }: { pieceName: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={[styles.link, style]} accessibilityRole="button" accessibilityLabel={t.wishAlerts.reportLinkLabel(pieceName)} testID="plus-disponible">
      <Text style={styles.linkLabel} numberOfLines={1}>
        {t.wishAlerts.reportLink}
      </Text>
    </Pressable>
  );
}

/** La confirmation. Ouverte tant que `target` n'est pas null ; `onReported`
 * après un signalement accepté. */
export function StockReportSheet({ target, onClose, onReported }: { target: StockReportTarget | null; onClose: () => void; onReported?: (target: StockReportTarget) => void }) {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setSending(false);
    setError(null);
  }, [target?.kind, target?.id]);

  async function confirm() {
    if (!target || sending) return;
    setSending(true);
    setError(null);
    try {
      await reportStockGone(stockReportRequest(target));
      showToast(t.wishAlerts.reportDone);
      onReported?.(target);
      onClose();
    } catch (e) {
      // Alertes devenues indisponibles : le lien disparaît, la feuille aussi.
      if (isAlertsUnavailable(e)) {
        onClose();
        return;
      }
      setError(stockReportErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  const dismiss = () => (sending ? undefined : onClose());
  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.title} accessibilityRole="header">
          {t.wishAlerts.reportTitle}
        </Text>
        {target ? (
          <Text style={styles.pieceTitle} numberOfLines={2}>
            {target.title}
          </Text>
        ) : null}
        <Text style={styles.body}>{t.wishAlerts.reportBody}</Text>
        {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
        <View style={styles.row}>
          <Pressable style={styles.secondary} onPress={onClose} disabled={sending} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>{t.wishAlerts.reportCancel}</Text>
          </Pressable>
          <Pressable
            style={styles.primary}
            onPress={() => void confirm()}
            disabled={sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: sending, busy: sending }}
            testID="confirmer-plus-disponible"
          >
            <Text style={styles.primaryLabel}>{sending ? t.wishAlerts.reportSending : t.wishAlerts.reportConfirm}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  link: { minHeight: size.touchTarget, justifyContent: "center", alignSelf: "flex-start" },
  linkLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600", lineHeight: 17 },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
    width: "100%",
    maxWidth: size.contentMaxWidth,
    alignSelf: "center",
  },
  grab: { width: size.sheetHandle.width, height: size.sheetHandle.height, borderRadius: radius.full, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.xs },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  pieceTitle: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  error: { fontSize: font.caption },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.sm },
  secondary: { minHeight: size.touchTarget, minWidth: size.touchTarget, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.acier },
  primary: { minHeight: size.touchTarget, minWidth: size.touchTarget, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontSize: font.secondary, fontWeight: "600", color: color.blanc },
}));
