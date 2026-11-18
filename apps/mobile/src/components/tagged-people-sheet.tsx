import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import type { PostAuthor } from "@monapp/shared-types";
import { ApiError, removePeopleTag } from "@/lib/api";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/lib/toast-context";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// Personnes identifiées sur une publication (lot « vie sociale », migration
// 0047). Le serveur ne donne que celles que ce lecteur peut voir (ni compte
// en blocage, ni suspendu, ni compte privé qu'il ne suit pas). Chaque ligne
// ouvre le profil ; la sienne propose « Retirer mon identification » (le
// serveur le permet toujours, même sans voir la publication).

interface TaggedPeopleSheetProps {
  postId: string;
  people: PostAuthor[];
  visible: boolean;
  viewerId: string | null;
  onClose: () => void;
  /** Son identification est retirée : sa ligne quitte la liste. */
  onRemoved: (userId: string) => void;
}

export function TaggedPeopleSheet({ postId, people, visible, viewerId, onClose, onRemoved }: TaggedPeopleSheetProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function removeMine() {
    if (!viewerId || busy) return;
    setBusy(true);
    try {
      await removePeopleTag(postId, viewerId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(t.carousel.tagRemoved);
      onRemoved(viewerId);
      onClose();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t.carousel.tagRemoveError);
    } finally {
      setBusy(false);
    }
  }

  function openProfile(person: PostAuthor) {
    onClose();
    router.push({ pathname: "/profil", params: { id: person.id } });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.carousel.peopleTitle}
        </Text>
        <ScrollView style={styles.list}>
          {people.map((person) => (
            <View key={person.id} style={styles.row}>
              <Pressable style={styles.person} onPress={() => openProfile(person)} accessibilityRole="link" accessibilityLabel={t.common.viewProfile(person.displayName)}>
                <Avatar uri={person.avatarUrl} userId={person.id} displayName={person.displayName} username={person.username} size={36} />
                <View style={styles.names}>
                  <Text style={styles.displayName} numberOfLines={1}>
                    {person.displayName}
                  </Text>
                  <Text style={styles.username} numberOfLines={1}>
                    @{person.username}
                  </Text>
                </View>
              </Pressable>
              {person.id === viewerId ? (
                <Pressable
                  style={[styles.remove, busy ? styles.busy : null]}
                  onPress={() => void removeMine()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy }}
                  testID="retirer-mon-identification"
                >
                  <Text style={styles.removeLabel}>{t.carousel.removeMyTag}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
        <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button">
          <Text style={styles.cancelLabel}>{t.common.close}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: { backgroundColor: color.porcelaine, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: space.xl, maxHeight: "70%" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center", paddingBottom: space.sm },
  list: { paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 56, borderBottomWidth: 1, borderBottomColor: color.filet },
  person: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 },
  names: { flexShrink: 1 },
  displayName: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  username: { fontSize: font.caption, color: color.acier },
  remove: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.xs },
  removeLabel: { fontSize: font.caption, fontWeight: "600", color: color.danger },
  busy: { opacity: 0.6 },
  cancel: { marginTop: space.md, marginHorizontal: space.lg, minHeight: 44, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
