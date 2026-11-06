import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { WebTitle } from "@/components/web-title";
import { ContactEntry } from "@/components/contact-entry";
import { APP_NAME_DISPLAY } from "@/constants/brand";
import { CONTACT_EMAIL } from "@/lib/contact";
import { helpContactText } from "@/lib/help";
import { splitPlaceholders } from "@/lib/legal";
import { getActiveLocale, t } from "@/i18n";
import { color, font, radius, serifFont, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// « Aide et contact » (chantier 3, point 6 de la feuille de route V1) :
// lisible connecté ou non (hors des groupes protégés du layout racine),
// adresse publique « /aide ». Sert d'adresse d'assistance pour l'App Store.
// L'adresse de contact est celle de l'éditeur (lib/contact.ts) ; tant
// qu'elle n'est pas fournie, l'emplacement « [À compléter : …] » s'affiche,
// comme dans les documents juridiques, et aucun lien n'est proposé.

/** L'adresse, ou son « [À compléter : …] » mis en évidence. */
function ContactAddress({ text }: { text: string }) {
  return (
    <Text selectable style={styles.body}>
      {splitPlaceholders(text).map((part, index) =>
        part.placeholder ? (
          <Text key={index} style={styles.placeholder}>
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </Text>
  );
}

export default function HelpScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.screen}>
      <WebTitle title={`${t.help.title} — ${APP_NAME_DISPLAY}`} />
      <View style={styles.nav}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          {t.help.title}
        </Text>
        <Text style={styles.intro}>{t.help.intro}</Text>

        <View style={styles.card}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {t.help.contactTitle}
          </Text>
          <Text style={styles.body}>{t.help.contactBody}</Text>
          {CONTACT_EMAIL ? (
            <ContactEntry email={CONTACT_EMAIL} linkStyle={styles.link} textStyle={styles.body} />
          ) : (
            <ContactAddress text={helpContactText(getActiveLocale())} />
          )}
        </View>

        <Text style={[styles.sectionTitle, styles.spaced]} accessibilityRole="header">
          {t.help.faqTitle}
        </Text>
        {t.help.faq.map((item) => (
          <View key={item.q} style={styles.question}>
            <Text style={styles.questionTitle}>{item.q}</Text>
            <Text style={styles.body}>{item.a}</Text>
          </View>
        ))}

        <Text style={[styles.sectionTitle, styles.spaced]} accessibilityRole="header">
          {t.help.documentsTitle}
        </Text>
        <Pressable accessibilityRole="link" onPress={() => router.push("/conditions")} hitSlop={12} style={styles.docLink}>
          <Text style={styles.link}>{t.settings.terms}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.push("/confidentialite")} hitSlop={12} style={styles.docLink}>
          <Text style={styles.link}>{t.settings.privacyPolicy}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  nav: { height: 47, justifyContent: "center", paddingHorizontal: 12 },
  back: { fontSize: 26, color: color.encre },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxl, maxWidth: 640, alignSelf: "center", width: "100%" },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre },
  intro: { fontSize: font.secondary, color: color.acier, marginTop: space.xs, lineHeight: 20 },
  card: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, padding: space.md, marginTop: space.lg },
  sectionTitle: { fontFamily: serifFont, fontWeight: "500", fontSize: font.body, color: color.encre, marginBottom: space.sm },
  spaced: { marginTop: space.xl },
  question: { marginBottom: space.md },
  questionTitle: { fontSize: font.secondary, fontWeight: "600", color: color.encre, marginBottom: space.xs },
  body: { fontSize: font.secondary, color: color.encre, lineHeight: 22, marginBottom: space.xs },
  placeholder: { fontWeight: "700", textDecorationLine: "underline" },
  link: { fontSize: font.secondary, color: color.vert, fontWeight: "600" },
  docLink: { paddingVertical: space.xs },
}));
