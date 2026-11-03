import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { VaultCategory } from "@monapp/shared-types";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { VAULT_CATEGORIES } from "@/lib/vault-labels";
import { themedStyles } from "@/theme/themed-styles";

/** « Dans quelle catégorie ? » avant d'ajouter une pièce au Vault : la même
 * feuille que l'écran des résultats (spot/result.tsx), pour la fiche d'une
 * envie (lot « Retrouver ses pièces »). */
export function VaultCategorySheet({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (category: VaultCategory) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
        <View style={styles.grab} />
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {t.result.categoryTitle}
        </Text>
        {VAULT_CATEGORIES.map((category) => (
          <Pressable key={category} style={styles.sheetRow} onPress={() => onChoose(category)} accessibilityRole="button">
            <Text style={styles.sheetRowLabel}>{t.vaultLabels.categories[category]}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: 10 },
  grab: { width: 36, height: 5, borderRadius: 3, backgroundColor: color.filet, alignSelf: "center", marginBottom: space.md },
  sheetTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, marginBottom: space.sm },
  sheetRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  sheetRowLabel: { fontSize: font.body, color: color.encre },
}));
