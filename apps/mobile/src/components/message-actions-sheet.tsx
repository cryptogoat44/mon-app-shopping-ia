import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import type { MessageAction } from "@/lib/conversations";
import { themedStyles } from "@/theme/themed-styles";

// Ce qu'on peut faire d'un message (lot « messages, plus de confort ») :
// l'aimer, y répondre, le supprimer (confirmé ici), le signaler ou bloquer la
// personne. Ouverte par « ••• » comme par l'appui long : toutes les actions
// y sont, le site n'ayant pas d'appui long. « Signaler » et « Bloquer »
// passent la main au menu existant (règle 1.2 d'Apple : son chemin ne change
// pas). La liste des actions vient de lib/conversations.ts (messageActionsFor).

/** Libellés lus à l'affichage (la langue peut changer pendant que l'app est ouverte). */
function actionLabel(action: MessageAction): string {
  const labels: Record<MessageAction, string> = {
    like: t.messageActions.like,
    unlike: t.messageActions.unlike,
    reply: t.messageActions.reply,
    delete: t.messageActions.delete,
    report: t.messageActions.report,
    block: t.messageActions.block,
  };
  return labels[action];
}

const DESTRUCTIVE: readonly MessageAction[] = ["delete", "block"];

export function MessageActionsSheet({
  visible,
  actions,
  onClose,
  onAction,
}: {
  visible: boolean;
  actions: readonly MessageAction[];
  onClose: () => void;
  /** L'action choisie ; « Supprimer » n'arrive ici qu'une fois confirmé. */
  onAction: (action: MessageAction) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (visible) setConfirmDelete(false);
  }, [visible]);

  function choose(action: MessageAction) {
    if (action === "delete" && !confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onClose();
    onAction(action);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.moderation.cancel} />
      <View style={styles.sheet} testID="actions-message">
        <View style={styles.handle} />
        {confirmDelete ? (
          <>
            <Text style={styles.confirmText} accessibilityRole="alert">
              {t.messageActions.deleteConfirm}
            </Text>
            <Pressable style={styles.item} onPress={() => choose("delete")} accessibilityRole="button" accessibilityLabel={t.messageActions.delete}>
              <Text style={[styles.itemLabel, styles.itemLabelDestructive]}>{t.messageActions.delete}</Text>
            </Pressable>
          </>
        ) : (
          actions.map((action, index) => (
            <Pressable
              key={action}
              style={[styles.item, index < actions.length - 1 ? styles.itemBorder : null]}
              onPress={() => choose(action)}
              accessibilityRole="button"
              accessibilityLabel={actionLabel(action)}
              testID={`action-message-${action}`}
            >
              <Text style={[styles.itemLabel, DESTRUCTIVE.includes(action) ? styles.itemLabelDestructive : null]}>{actionLabel(action)}</Text>
            </Pressable>
          ))
        )}
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.moderation.cancel}>
          <Text style={styles.cancelLabel}>{t.moderation.cancel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  item: { minHeight: 44, paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: color.filet },
  itemLabel: { fontSize: font.body, color: color.encre, fontWeight: "500" },
  itemLabelDestructive: { color: color.danger },
  confirmText: { fontSize: font.secondary, color: color.encre, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.sm, lineHeight: 19 },
  cancel: {
    marginTop: space.sm,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: "center",
    backgroundColor: color.plinthe,
    borderRadius: radius.md,
  },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
