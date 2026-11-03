import { useState } from "react";
import { Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import * as Linking from "expo-linking";
import { t } from "@/i18n";
import { contactMailto } from "@/lib/contact";
import { ErrorMessage } from "@/components/error-message";

/** « Nous contacter » (Réglages, écran d'accueil). Le lien ouvre la
 * messagerie : sur iPhone, l'app de messagerie ; sur le site, comme un lien
 * « mailto: » ordinaire, dans le même onglet. L'adresse reste affichée en
 * texte sélectionnable, pour qui n'a pas d'app de messagerie. Aucun
 * événement de statistiques. Les écrans ne l'affichent qu'avec une adresse
 * réelle (CONTACT_EMAIL, lib/contact.ts) ; styles fournis par l'écran, dans
 * son thème. */
export function ContactEntry({
  email,
  style,
  linkStyle,
  textStyle,
}: {
  email: string;
  style?: StyleProp<ViewStyle>;
  linkStyle: StyleProp<TextStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  const [openFailed, setOpenFailed] = useState(false);

  async function openMail() {
    setOpenFailed(false);
    try {
      await Linking.openURL(contactMailto(email));
    } catch {
      // iPhone : aucune app ne sait ouvrir le lien. Le site, lui, n'en sait
      // rien : le navigateur ne dit pas si la messagerie s'est ouverte.
      setOpenFailed(true);
    }
  }

  return (
    <View style={style}>
      <Pressable accessibilityRole="link" accessibilityHint={t.contact.linkHint} onPress={() => void openMail()} hitSlop={12}>
        <Text style={linkStyle}>{t.contact.link}</Text>
      </Pressable>
      <Text selectable style={textStyle}>
        {email}
      </Text>
      {openFailed ? <ErrorMessage style={textStyle}>{t.contact.openFailed}</ErrorMessage> : null}
    </View>
  );
}
