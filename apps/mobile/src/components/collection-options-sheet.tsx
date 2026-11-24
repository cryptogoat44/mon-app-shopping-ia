import { useEffect, useMemo } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import type { CollectionSummary } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { collectionState } from "@/lib/collections";
import { afterSheetClose } from "@/lib/after-sheet-close";
import { themedStyles } from "@/theme/themed-styles";

// Retours du build 2 (Envies compactes) : « … » au bout des puces, pour la
// collection choisie. Ce qui était sous les puces y passe : qui la voit
// (textes inchangés), ses publications enregistrées (seulement quand le
// serveur les connaît) et « Gérer ». Jamais deux fenêtres à la fois : la
// suite (« Gérer » ouvre une autre feuille) attend que celle-ci soit fermée
// (lib/after-sheet-close.ts).
export function CollectionOptionsSheet({
  collection,
  visible,
  savedPosts,
  onClose,
  onPosts,
  onManage,
}: {
  collection: CollectionSummary | null;
  visible: boolean;
  /** Le serveur connaît les publications enregistrées (migration 0048). */
  savedPosts: boolean;
  onClose: () => void;
  onPosts: (collection: CollectionSummary) => void;
  onManage: (collection: CollectionSummary) => void;
}) {
  const afterClose = useMemo(() => afterSheetClose(Platform.OS === "web"), []);
  useEffect(() => () => afterClose.cancel(), [afterClose]);

  function then(run: () => void) {
    onClose();
    afterClose.schedule(run);
  }

  return (
    <Modal visible={visible && collection !== null} animationType="slide" transparent onRequestClose={onClose} onDismiss={() => afterClose.flush()}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      {collection ? (
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
            {collection.name}
          </Text>
          <Text style={styles.body}>{collectionState(collection)}</Text>
          {/* Les publications enregistrées rangées dans cette collection (vous seul les voyez). */}
          {savedPosts ? (
            <Pressable
              style={styles.button}
              onPress={() => then(() => onPosts(collection))}
              accessibilityRole="link"
              accessibilityLabel={t.savedPosts.collectionTabLabel(collection.name)}
              testID="publications-de-la-collection"
            >
              <Text style={styles.buttonLabel}>{t.collections.ownOptionsPosts}</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.button}
            onPress={() => then(() => onManage(collection))}
            accessibilityRole="button"
            accessibilityLabel={t.collections.manageLabel(collection.name)}
            testID="gerer-collection"
          >
            <Text style={styles.buttonLabel}>{t.collections.manage}</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={onClose} accessibilityRole="button">
            <Text style={styles.buttonLabel}>{t.common.close}</Text>
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.sm },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.xs },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 20 },
  button: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: color.filet, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  buttonLabel: { fontSize: font.secondary, fontWeight: "600", color: color.encre, textAlign: "center" },
}));
