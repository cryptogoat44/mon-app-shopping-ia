import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// La page look (lot « page look ») : la feuille de confirmation, à chaque
// création d'un lien (même forme que les feuilles des mentions,
// components/offer-mark.tsx) : ce que la page montre et ne montre pas, sa
// durée, où l'arrêter ; « Créer le lien » / « Annuler ».

export function LookConfirmSheet({ date, onConfirm, onClose }: { date: string; onConfirm: () => void; onClose: () => void }) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.look.sheetTitle}
        </Text>
        {/* Grand texte sur un petit écran : le texte défile, les boutons restent visibles. */}
        <ScrollView style={styles.scroll}>
          <Text style={styles.body}>{t.look.sheetBody(date)}</Text>
        </ScrollView>
        <Pressable style={styles.confirm} onPress={onConfirm} accessibilityRole="button" testID="look-creer">
          <Text style={styles.confirmLabel}>{t.look.confirm}</Text>
        </Pressable>
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button" testID="look-annuler">
          <Text style={styles.cancelLabel}>{t.look.cancel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
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
  scroll: { maxHeight: 320 },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm, textAlign: "center" },
  confirm: { marginTop: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  confirmLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc, textAlign: "center" },
  cancel: { marginTop: space.sm, minHeight: 48, alignItems: "center", justifyContent: "center" },
  cancelLabel: { fontSize: font.body, color: color.encre },
}));
