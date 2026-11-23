import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { LuxuryResale } from "@monapp/shared-types";
import { color, font, radius, size, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { track } from "@/lib/analytics";
import { openResaleSite, resaleHost } from "@/lib/luxury-resale";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { openExternalLink } from "@/components/external-link-sheet";
import { themedStyles } from "@/theme/themed-styles";

// Seconde main de luxe (lot « seconde main de luxe », lib/luxury-resale.ts) :
// un lien discret, du même style que « Envoyer à un ami », sous la grande
// carte (ou sous « Ce n'est pas la bonne pièce ? » sans grande carte), sur
// iPhone et sur le site. Il vaut pour la recherche, comme le verdict : il ne
// change ni la grande carte, ni l'ordre de quoi que ce soit. Touché, une
// courte feuille (même forme que celle du verdict et que
// external-link-sheet.tsx) : le titre, la maison, les mots déjà remplis,
// un bouton par site avec son nom en clair dessous (jamais un bouton qu'on
// touche sans voir où il mène), les limites, « Vous allez quitter … »
// (aucun lien affilié), « Fermer ». Un bouton ouvre l'adresse par
// openExternalLink (https seulement, relue là ; noopener sur le site) :
// jamais openMerchantLink, aucun clic enregistré sur le serveur. Si un jour
// un lien de cette liste devient affilié, la phrase « leave » devient
// fausse : la changer, ajouter la mention « Lien affilié »
// (components/affiliate-mention.tsx) et la phrase des conditions.

export function LuxuryResaleEntry({ resale, style }: { resale: LuxuryResale | undefined; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  if (!resale) return null;
  const sitesCount = resale.sites.length;
  return (
    <>
      <Pressable
        onPress={() => {
          track("luxury_resale_opened", { sites_count: sitesCount });
          setOpen(true);
        }}
        style={[styles.link, style]}
        accessibilityRole="button"
        accessibilityLabel={t.result.luxuryResale.entryLabel(resale.house)}
        accessibilityHint={t.result.luxuryResale.entryHint}
        testID="seconde-main-luxe"
      >
        <Text style={styles.linkLabel}>{t.result.luxuryResale.entry}</Text>
      </Pressable>
      {open ? <LuxuryResaleSheet resale={resale} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function LuxuryResaleSheet({ resale, onClose }: { resale: LuxuryResale; onClose: () => void }) {
  const reduceMotion = useReduceMotion();
  const texts = t.result.luxuryResale;
  const sitesCount = resale.sites.length;

  function openSite(url: string, position: number) {
    // L'adresse est relue par openExternalLink (https seulement) ; refusée : rien ne s'ouvre, rien n'est compté.
    if (openResaleSite(url, position, sitesCount, { open: openExternalLink, track })) onClose();
  }

  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={texts.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        {/* Tout défile : grand texte, petit écran ou fenêtre basse, les boutons et « Fermer » restent atteignables. */}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} bounces={false} testID="seconde-main-luxe-feuille">
          <Text style={styles.title} accessibilityRole="header">
            {texts.sheetTitle}
          </Text>
          <Text style={styles.body}>{texts.intro(resale.house)}</Text>
          <Text style={styles.words} selectable testID="seconde-main-luxe-mots">
            {texts.words(resale.words)}
          </Text>
          {resale.sites.map((site, index) => {
            const host = resaleHost(site.url);
            if (host === null) return null;
            return (
              <Pressable
                key={site.url}
                style={styles.site}
                onPress={() => openSite(site.url, index + 1)}
                accessibilityRole="link"
                accessibilityLabel={texts.siteLabel(site.name, host)}
                testID="seconde-main-luxe-site"
              >
                <Text style={styles.siteLabel}>{texts.site(site.name)}</Text>
                <Text style={styles.siteHost}>{host}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.body}>{texts.limits}</Text>
          <Text style={styles.body}>{texts.leave}</Text>
          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" testID="seconde-main-luxe-fermer">
            <Text style={styles.closeLabel}>{texts.close}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

// Mêmes mesures et mêmes couleurs que « Envoyer à un ami », la feuille du verdict et external-link-sheet.tsx
// (contrastes déjà vérifiés). Aucune hauteur imposée ni nombre de lignes : tout passe à la ligne (320 points, grand texte).
const styles = themedStyles(() => ({
  link: { minHeight: size.touchTarget, justifyContent: "center", alignSelf: "center", marginTop: 4 },
  linkLabel: { fontSize: font.caption, color: color.acier, fontWeight: "600", lineHeight: 17, textAlign: "center" },
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
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingBottom: space.xl },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 20, marginTop: space.sm },
  words: { fontSize: font.secondary, color: color.encre, lineHeight: 20, marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: color.plinthe },
  site: { marginTop: space.md, minHeight: 52, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center", paddingVertical: space.sm, paddingHorizontal: space.md },
  siteLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc, textAlign: "center" },
  siteHost: { fontSize: font.caption, color: color.blanc, marginTop: 2, textAlign: "center" },
  close: { marginTop: space.lg, minHeight: 44, paddingVertical: space.md, alignItems: "center", backgroundColor: color.plinthe, borderRadius: radius.md },
  closeLabel: { fontSize: font.body, color: color.encre, fontWeight: "600" },
}));
