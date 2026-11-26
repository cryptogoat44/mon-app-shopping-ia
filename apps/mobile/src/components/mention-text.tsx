import { Text, type StyleProp, type TextStyle } from "react-native";
import type { CommentMention } from "@monapp/shared-types";
import { splitMentions } from "@/lib/comment-threads";
import { color } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// Texte d'un commentaire (lot « vie sociale », migration 0046) : un
// « @pseudo » devient un lien vers le profil seulement pour les mentions que
// le serveur a renvoyées. Tout autre « @mot » reste un simple texte.
// À placer DANS un <Text> (le nom de l'auteur le précède sur la même ligne).
export function MentionText({
  body,
  mentions,
  onOpenProfile,
  linkStyle,
}: {
  body: string;
  mentions: readonly CommentMention[] | undefined;
  onOpenProfile?: (userId: string) => void;
  linkStyle?: StyleProp<TextStyle>;
}) {
  return (
    <>
      {splitMentions(body, mentions).map((part, index) => {
        const userId = part.userId;
        return userId && onOpenProfile ? (
          <Text
            key={index}
            style={[styles.link, linkStyle]}
            onPress={() => onOpenProfile(userId)}
            accessibilityRole="link"
            accessibilityLabel={t.common.viewProfile(part.text)}
          >
            {part.text}
          </Text>
        ) : (
          <Text key={index}>{part.text}</Text>
        );
      })}
    </>
  );
}

const styles = themedStyles(() => ({
  link: { ...lienSouligne, color: color.vert, fontWeight: "600" },
}));
