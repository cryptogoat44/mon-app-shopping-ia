import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { settingsGroupValues } from "@/components/settings-group";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { updateFriendShelves } from "@/lib/api";
import { friendShelvesNoticeLines, needsFriendShelvesNotice, noticeAnnouncement, noticeAnswer, noticeAnswerProfilePatch } from "@/lib/friend-shelves";
import { useToast } from "@/lib/toast-context";
import { ErrorMessage } from "@/components/error-message";
import { themedStyles } from "@/theme/themed-styles";

// Étagères des amis, refonte (décision 3 du fondateur) : « un membre est
// prévenu avant d'être vu ». Les deux réglages sont allumés par défaut, mais
// le serveur n'ouvre les étagères d'un membre à ses amis qu'après sa réponse
// à cette information (la date est notée par ce seul geste). Montrée en tête
// de son propre profil (iPhone et site) et dans Réglages, tant qu'il n'a pas
// répondu ; jamais une fois répondu. Ce n'est pas un consentement (aucune
// case à cocher) : une information, avec le moyen de refuser tout de suite.
// - « Compris » : les étagères s'ouvrent (réglages inchangés).
// - « Éteindre » : les deux réglages sont éteints, puis la date est notée.
// Elle ne bloque rien : sans réponse, l'app marche et les étagères restent
// fermées. VoiceOver l'annonce une fois à son apparition (pas à chaque
// montage : le profil la remonte à chaque onglet, Réglages en ajoute une).
// Raccord avec la nouvelle interface : une carte comme celles de Réglages
// (fond `surface`, coins doux, filet très fin en thème clair seulement), les
// boutons de toujours (« Éteindre » encadré, « Compris » plein).
// `announcedFor` (partagé par toutes les cartes montées : profil, Réglages
// par-dessus) : l'id du membre à qui l'information a déjà été lue à VoiceOver.
let announcedFor: string | null = null;

/** `style` : la marge autour de la carte, seulement quand elle est montrée
 * (cachée, elle ne prend aucune place). */
export function FriendShelvesNotice({ style }: { style?: StyleProp<ViewStyle> } = {}) {
  const { profile, refreshProfile, patchProfile } = useAuth();
  const { showToast } = useToast();
  const [saving, setSaving] = useState<"ok" | "off" | null>(null);
  const [error, setError] = useState(false);
  const shown = needsFriendShelvesNotice(profile);
  const memberId = profile?.id ?? null;
  const lines = friendShelvesNoticeLines(profile);

  useEffect(() => {
    const next = noticeAnnouncement(announcedFor, shown, memberId);
    announcedFor = next.announcedFor;
    // iOS n'annonce pas le rôle « alert » : on lit l'information à VoiceOver.
    if (next.announce && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility([t.friendShelves.noticeTitle, ...lines].join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, memberId]);

  if (!shown) return null;

  async function answer(choice: "ok" | "off") {
    if (saving) return;
    setSaving(choice);
    setError(false);
    try {
      await updateFriendShelves(noticeAnswer(choice));
      // Réponse enregistrée : appliquée tout de suite au profil affiché (la
      // carte se cache, les phrases « privé » restent vraies), même si le
      // rechargement qui suit échoue.
      if (memberId) patchProfile(memberId, noticeAnswerProfilePatch(choice));
      await refreshProfile();
      showToast(choice === "ok" ? t.friendShelves.noticeOkDone : t.friendShelves.noticeOffDone);
    } catch {
      setError(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <View style={style}>
      <View style={styles.card} testID="information-etageres-amis">
        <Text style={styles.title} accessibilityRole="alert">
          {t.friendShelves.noticeTitle}
        </Text>
        {lines.map((line) => (
          <Text key={line} style={styles.text}>
            {line}
          </Text>
        ))}
        {error ? <ErrorMessage>{t.friendShelves.settingError}</ErrorMessage> : null}
        <View style={styles.buttons}>
          <Pressable
            style={[styles.button, styles.secondary]}
            onPress={() => void answer("off")}
            disabled={saving !== null}
            accessibilityRole="button"
            accessibilityState={{ busy: saving === "off", disabled: saving !== null }}
            testID="information-etageres-eteindre"
          >
            <Text style={styles.secondaryLabel}>{t.friendShelves.noticeOff}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primary]}
            onPress={() => void answer("ok")}
            disabled={saving !== null}
            accessibilityRole="button"
            accessibilityState={{ busy: saving === "ok", disabled: saving !== null }}
            testID="information-etageres-compris"
          >
            <Text style={styles.primaryLabel}>{t.friendShelves.noticeOk}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// La marge autour de la carte vient de `style` (profil, Réglages) : la carte elle-même n'en a pas.
const styles = themedStyles(() => ({
  card: { ...settingsGroupValues().card, paddingVertical: space.md, gap: space.sm, width: "100%", maxWidth: 640, alignSelf: "center" },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre },
  text: { fontSize: font.secondary, color: color.acier, lineHeight: 19 },
  buttons: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.sm, marginTop: space.xs },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.md, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
  secondary: { borderWidth: 1, borderColor: color.filet },
  primary: { backgroundColor: color.vert },
  secondaryLabel: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  primaryLabel: { fontSize: font.secondary, color: color.blanc, fontWeight: "600" },
}));
