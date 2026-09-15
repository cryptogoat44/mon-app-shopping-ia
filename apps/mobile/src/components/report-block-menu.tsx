import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { ReportReason } from "@monapp/shared-types";
import { ApiError, blockUser, reportContent } from "@/lib/api";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { useToast } from "@/lib/toast-context";

const REASONS: ReportReason[] = ["spam", "inappropriate", "harassment", "other"];

const REASON_LABELS: Record<ReportReason, string> = {
  spam: fr.moderation.reasonSpam,
  inappropriate: fr.moderation.reasonInappropriate,
  harassment: fr.moderation.reasonHarassment,
  other: fr.moderation.reasonOther,
};

type Step = "root" | "report" | "confirmBlock";

interface ReportBlockMenuProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  postId?: string;
  onBlocked?: (userId: string) => void;
}

export function ReportBlockMenu({ visible, onClose, userId, postId, onBlocked }: ReportBlockMenuProps) {
  const [step, setStep] = useState<Step>("root");
  const { showToast } = useToast();

  function close() {
    onClose();
    setTimeout(() => setStep("root"), 300);
  }

  async function handleReport(reason: ReportReason) {
    close();
    try {
      await reportContent({ targetType: postId ? "post" : "user", targetId: postId ?? userId, reason });
      showToast(fr.moderation.reportSuccess);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.moderation.reportError);
    }
  }

  async function handleBlock() {
    close();
    try {
      await blockUser(userId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(fr.moderation.blockSuccess);
      onBlocked?.(userId);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : fr.moderation.blockError);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel={fr.moderation.cancel} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {step === "root" ? (
          <>
            <Pressable
              style={[styles.item, styles.itemBorder]}
              onPress={() => setStep("report")}
              accessibilityRole="button"
              accessibilityLabel={postId ? fr.moderation.reportPost : fr.moderation.reportUser}
            >
              <Text style={styles.itemLabel}>{postId ? fr.moderation.reportPost : fr.moderation.reportUser}</Text>
            </Pressable>
            <Pressable
              style={styles.item}
              onPress={() => setStep("confirmBlock")}
              accessibilityRole="button"
              accessibilityLabel={fr.moderation.block}
            >
              <Text style={[styles.itemLabel, styles.itemLabelDestructive]}>{fr.moderation.block}</Text>
            </Pressable>
          </>
        ) : step === "report" ? (
          REASONS.map((reason, index) => (
            <Pressable
              key={reason}
              style={[styles.item, index < REASONS.length - 1 ? styles.itemBorder : null]}
              onPress={() => handleReport(reason)}
              accessibilityRole="button"
              accessibilityLabel={REASON_LABELS[reason]}
            >
              <Text style={styles.itemLabel}>{REASON_LABELS[reason]}</Text>
            </Pressable>
          ))
        ) : (
          <>
            <Text style={styles.confirmText}>{fr.moderation.blockConfirm}</Text>
            <Pressable
              style={[styles.item, styles.itemBorder]}
              onPress={handleBlock}
              accessibilityRole="button"
              accessibilityLabel={fr.moderation.blockConfirmCta}
            >
              <Text style={[styles.itemLabel, styles.itemLabelDestructive]}>{fr.moderation.blockConfirmCta}</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.cancel} onPress={close} accessibilityRole="button" accessibilityLabel={fr.moderation.cancel}>
          <Text style={styles.cancelLabel}>{fr.moderation.cancel}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  item: { paddingVertical: space.md, paddingHorizontal: space.lg, alignItems: "center" },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: color.filet },
  itemLabel: { fontSize: font.body, color: color.encre, fontWeight: "500" },
  itemLabelDestructive: { color: color.danger },
  confirmText: { fontSize: font.secondary, color: color.acier, textAlign: "center", paddingHorizontal: space.lg, paddingBottom: space.md, lineHeight: 19 },
  cancel: {
    marginTop: space.sm,
    marginHorizontal: space.lg,
    paddingVertical: space.md,
    alignItems: "center",
    backgroundColor: color.plinthe,
    borderRadius: radius.md,
  },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
});
