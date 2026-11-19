import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { MemberRow } from "@monapp/shared-types";
import { ApiError, blockUser, removeFollower } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { useToast } from "@/lib/toast-context";
import { themedStyles } from "@/theme/themed-styles";

// Retirer un abonné (lot « vie sociale ») : une confirmation, jamais un seul
// geste. La personne n'est pas prévenue. Compte public : elle peut se
// réabonner aussitôt — la feuille le dit, et propose de la bloquer (avec sa
// propre confirmation).

type Step = "confirm" | "confirmBlock";

interface RemoveFollowerSheetProps {
  /** L'abonné à retirer ; null : feuille fermée. */
  member: MemberRow | null;
  /** Le compte du membre connecté est public (ou le serveur ne connaît pas le compte privé). */
  publicAccount: boolean;
  onClose: () => void;
  /** L'abonné est retiré, ou bloqué : sa ligne quitte la liste. */
  onGone: (userId: string) => void;
}

export function RemoveFollowerSheet({ member, publicAccount, onClose, onGone }: RemoveFollowerSheetProps) {
  const [step, setStep] = useState<Step>("confirm");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  function close() {
    onClose();
    setTimeout(() => setStep("confirm"), 300);
  }

  async function run(action: "remove" | "block") {
    if (!member || busy) return;
    setBusy(true);
    try {
      if (action === "remove") await removeFollower(member.id);
      else await blockUser(member.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(action === "remove" ? t.memberLists.removed : t.moderation.blockSuccess);
      onGone(member.id);
      close();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : action === "remove" ? t.memberLists.removeError : t.moderation.blockError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={member !== null} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={t.moderation.cancel} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {step === "confirm" ? (
          <>
            <Text style={styles.confirmText}>{member ? t.memberLists.removeConfirm(member.displayName) : ""}</Text>
            {publicAccount ? <Text style={styles.note}>{t.memberLists.removeNotePublic}</Text> : null}
            <Pressable
              style={[styles.item, publicAccount ? styles.itemBorder : null, busy ? styles.busy : null]}
              onPress={() => void run("remove")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={member ? t.memberLists.removeLabel(member.displayName) : t.memberLists.remove}
              accessibilityState={{ disabled: busy }}
              testID="confirmer-retrait"
            >
              <Text style={[styles.itemLabel, styles.itemLabelDestructive]}>{t.memberLists.remove}</Text>
            </Pressable>
            {publicAccount ? (
              <Pressable style={styles.item} onPress={() => setStep("confirmBlock")} disabled={busy} accessibilityRole="button" accessibilityLabel={t.moderation.block}>
                <Text style={styles.itemLabel}>{t.moderation.block}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <Text style={styles.confirmText}>{t.moderation.blockConfirm}</Text>
            <Pressable
              style={[styles.item, busy ? styles.busy : null]}
              onPress={() => void run("block")}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.moderation.blockConfirmCta}
              accessibilityState={{ disabled: busy }}
            >
              <Text style={[styles.itemLabel, styles.itemLabelDestructive]}>{t.moderation.blockConfirmCta}</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.cancel} onPress={close} accessibilityRole="button" accessibilityLabel={t.moderation.cancel}>
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
  confirmText: { fontSize: font.body, color: color.encre, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.sm, lineHeight: 22 },
  note: { fontSize: font.secondary, color: color.acier, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.md, lineHeight: 19 },
  item: { minHeight: 44, paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center" },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: color.filet },
  itemLabel: { fontSize: font.body, color: color.encre, fontWeight: "500" },
  itemLabelDestructive: { color: color.danger },
  busy: { opacity: 0.6 },
  cancel: { marginTop: space.sm, marginHorizontal: space.lg, minHeight: 44, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
