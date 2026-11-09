import { Pressable, Text, type StyleProp, type ViewStyle } from "react-native";
import { color, font, size } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// « Envoyer à un ami » (écran Résultat, lib/send-to-friend.ts) : un lien
// discret, en gris, sous les boutons d'une carte. Zone séparée de la carte
// (jamais dans la zone qui la met en grand) : le toucher n'envoie que sa
// pièce, sans rien changer à l'écran. Le nom de la pièce est lu par
// VoiceOver : parmi les cartes, « Envoyer à un ami » seul serait ambigu.
export function SendToFriendLink({ pieceName, onPress, style }: { pieceName: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.link, style]}
      accessibilityRole="button"
      accessibilityLabel={t.messages.sendToFriendLabel(pieceName)}
      testID="envoyer-a-un-ami"
    >
      <Text style={styles.label} numberOfLines={1}>
        {t.messages.sendToFriend}
      </Text>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  link: { minHeight: size.touchTarget, justifyContent: "center", alignSelf: "flex-start" },
  label: { fontSize: font.caption, color: color.acier, fontWeight: "600", lineHeight: 17 },
}));
