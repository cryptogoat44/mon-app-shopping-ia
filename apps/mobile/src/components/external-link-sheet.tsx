import { Linking, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { httpsParts } from "@/lib/bio-link";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { themedStyles } from "@/theme/themed-styles";

// « Vous allez quitter Spotto » (lot « vie sociale », migration 0049) : avant
// d'ouvrir un lien ajouté par un membre (le lien en bio, et plus tard
// d'autres), toujours cette feuille, avec l'adresse complète (le nom du site
// seul sur sa ligne, en gras, puis le reste). Rien ne s'ouvre sans « Ouvrir le
// lien ». L'app ne fait confiance ni à sa propre vérification ni à celle du
// serveur : l'adresse est relue ici, et rien ne s'ouvre si ce n'est pas une
// adresse « https: ». Aucun clic n'est enregistré, aucune adresse réécrite
// (pas d'affiliation). Sur le site, la feuille est une fenêtre modale : le
// clavier reste dedans tant qu'elle est ouverte (Modal de react-native-web).
// Tout ce qui suit la poignée défile : une adresse longue, un grand texte
// (réglage de l'iPhone) ou une fenêtre basse dépassent les 80 % de hauteur de
// la feuille, et « Ouvrir le lien » doit rester atteignable, toujours APRÈS
// l'adresse complète (jamais un bouton qu'on touche sans l'avoir vue).

/** Ouvre l'adresse hors de l'app, seulement si c'est une adresse « https: ».
 * Sur le site : un nouvel onglet, sans lien vers la page d'origine
 * (noopener, noreferrer). Vrai si quelque chose a été ouvert. */
export function openExternalLink(url: string): boolean {
  const parts = httpsParts(url);
  if (!parts) return false;
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return false;
    window.open(parts.href, "_blank", "noopener,noreferrer");
  } else {
    void Linking.openURL(parts.href).catch(() => {});
  }
  return true;
}

interface ExternalLinkSheetProps {
  /** L'adresse à ouvrir ; null : feuille fermée. */
  url: string | null;
  onClose: () => void;
}

export function ExternalLinkSheet({ url, onClose }: ExternalLinkSheetProps) {
  const parts = url === null ? null : httpsParts(url);

  function open() {
    if (parts && openExternalLink(parts.href)) onClose();
  }

  return (
    <Modal visible={parts !== null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.profilePins.cancel} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false} testID="feuille-lien-defilement">
          <Text style={styles.title} accessibilityRole="header">
            {t.profilePins.leaveTitle}
          </Text>
          <Text style={styles.body}>{t.profilePins.leaveBody}</Text>
          {parts ? (
            <View style={styles.address}>
              <Text style={styles.addressLabel}>{t.profilePins.leaveAddress}</Text>
              <Text style={styles.host} selectable testID="adresse-site">
                {parts.host}
              </Text>
              {parts.rest !== "" ? (
                <Text style={styles.rest} selectable testID="adresse-suite">
                  {parts.rest}
                </Text>
              ) : null}
            </View>
          ) : null}
          <Pressable style={styles.open} onPress={open} accessibilityRole="link" testID="ouvrir-le-lien">
            <Text style={styles.openLabel}>{t.profilePins.open}</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={onClose} accessibilityRole="button" testID="annuler-le-lien">
            <Text style={styles.cancelLabel}>{t.profilePins.cancel}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    maxHeight: "80%",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  // Rétrécit dans les 80 % de la feuille (la feuille garde sa hauteur naturelle quand tout tient).
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingBottom: space.xl },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginTop: space.sm },
  address: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.plinthe },
  addressLabel: { fontSize: font.caption, color: color.acier, marginBottom: space.xs },
  host: { fontSize: font.body, fontWeight: "700", color: color.encre },
  rest: { fontSize: font.secondary, color: color.encre, marginTop: 2, lineHeight: 20 },
  open: { marginTop: space.lg, minHeight: 44, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  openLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc },
  cancel: { marginTop: space.sm, minHeight: 44, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  cancelLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
