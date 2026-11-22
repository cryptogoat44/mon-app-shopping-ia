import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { Piece } from "@/api/types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// Stock affiché (lot « stock visible ») : « En stock » ou « Épuisée », quand
// Google le disait au moment de la recherche (apps/backend, migration 0056) ;
// rien quand c'est inconnu. Discrète, sous la proposition, à côté de sa
// mention de boutique (components/offer-mark.tsx), et de la même façon :
// touchée, une feuille d'une phrase dit d'où et de quand vient
// l'information. Zone à part, jamais dans celle qui met la carte en grand ;
// son libellé lu par VoiceOver dit déjà la source.

export function StockNote({ piece }: { piece: Pick<Piece, "inStock"> }) {
  const [open, setOpen] = useState(false);
  if (typeof piece.inStock !== "boolean") return null;
  const label = piece.inStock ? t.result.stock.inStock : t.result.stock.soldOut;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        // 32 points + 12 : la zone tactile minimale (44), sans mordre sur le lien de la boutique.
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        style={styles.note}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${t.result.stock.source}`}
        accessibilityHint={t.result.stock.hint}
        testID="mention-stock"
      >
        <Text style={piece.inStock ? [styles.label, styles.inStock] : styles.label}>
          {label} <Text style={styles.more}>ⓘ</Text>
        </Text>
      </Pressable>
      {open ? <StockSheet title={label} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** La feuille d'une phrase : l'état touché, d'où et de quand il vient, « J'ai compris ». */
function StockSheet({ title, onClose }: { title: string; onClose: () => void }) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>{t.result.stock.explanation}</Text>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" testID="mention-stock-fermer">
          <Text style={styles.closeLabel}>{t.result.stock.close}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// Mêmes mesures et mêmes couleurs que la mention de boutique (contrastes déjà vérifiés).
const styles = themedStyles(() => ({
  note: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 32 },
  label: { fontSize: 12, color: color.acier, flexShrink: 1 },
  inStock: { color: color.vert, fontWeight: "600" },
  more: { fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm, textAlign: "center" },
  close: { marginTop: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  closeLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc },
}));
