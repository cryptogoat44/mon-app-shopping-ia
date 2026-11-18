import { Text, type StyleProp, type TextStyle } from "react-native";
import { color, font } from "@/theme/tokens";
import { t } from "@/i18n";
import { useAuth } from "@/lib/auth-context";
import { themedStyles } from "@/theme/themed-styles";

/** Sous les choix de visibilité d'une publication, quand le compte est privé
 * (lot « vie sociale ») : « Public » ne veut alors dire que « mes abonnés ».
 * Rien pour un compte public, ni tant que le serveur n'a pas le compte privé. */
export function PrivateAccountNote({ style }: { style?: StyleProp<TextStyle> }) {
  const { profile } = useAuth();
  if (profile?.isPrivate !== true) return null;
  return <Text style={[styles.note, style]}>{t.privateAccount.postNote}</Text>;
}

const styles = themedStyles(() => ({
  note: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
}));
