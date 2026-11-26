import { useEffect, useState } from "react";
import { AccessibilityInfo, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { SearchVerdict } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { verdictSentence } from "@/lib/verdict";
import { useReduceMotion } from "@/lib/use-hero-reveal";
import { themedStyles } from "@/theme/themed-styles";

// Le verdict (lot « verdict ») : une phrase en tête de l'écran Résultat,
// au-dessus de la grande carte, décidée par le serveur d'après les titres des
// boutiques (apps/backend/src/lib/verdict.ts). Elle ne déplace, ne masque et
// ne range rien. Annoncée aux lecteurs d'écran quand elle apparaît ou change
// (boutiques arrivées ensuite) : VoiceOver ignore les zones annoncées
// (Android seulement), la phrase est donc dite explicitement sur iPhone, à la
// suite de ce qu'il lit. Touchée, une courte feuille dit comment Spotto
// décide, ce qu'il ne fait pas, et « vérifiez toujours avant d'acheter » (même
// forme que les feuilles des mentions, components/offer-mark.tsx). Sans
// verdict (ancien serveur, base sans 0055, boutiques attendues ou en échec) :
// rien.

/** La phrase est-elle montrée ? (Lot « finitions de l'œil » : elle seule sous les pastilles ; le résumé
 * « N offres · à partir de X € » n'est alors plus affiché, il reste lu par VoiceOver.) */
export function verdictLineShown(verdict: SearchVerdict | undefined): boolean {
  return Boolean(verdict && verdictSentence(verdict, t.result.verdict, getActiveLocale()));
}

export function VerdictLine({ verdict }: { verdict: SearchVerdict | undefined }) {
  const [open, setOpen] = useState(false);
  const sentence = verdict ? verdictSentence(verdict, t.result.verdict, getActiveLocale()) : null;
  useEffect(() => {
    if (sentence && Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(sentence, { queue: true });
  }, [sentence]);
  if (!verdict || !sentence) return null;
  // La zone annoncée (site et Android) est celle, toujours là, de la ligne d'information (components/result-sort-bar.tsx).
  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.box}
        // Deux lignes (36 points) : la zone touchable garde ses 44 points sur l'iPhone, sans espace vide à l'œil.
        hitSlop={{ top: 4, bottom: 4 }}
        accessibilityRole="button"
        accessibilityLabel={sentence}
        accessibilityHint={t.result.verdict.hint}
        testID="verdict"
      >
        <Text style={styles.sentence}>
          {/* Espace insécable : le « ⓘ » ne se retrouve jamais seul sur une ligne (lot « finitions de l'œil »). */}
          {sentence}{"\u00A0"}<Text style={styles.more}>ⓘ</Text>
        </Text>
      </Pressable>
      {open ? <VerdictSheet onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** La feuille : comment Spotto décide, ce qu'il ne fait pas, « J'ai compris ». */
function VerdictSheet({ onClose }: { onClose: () => void }) {
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t.common.close} />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title} accessibilityRole="header">
          {t.result.verdict.sheetTitle}
        </Text>
        {/* Grand texte sur un petit écran : les deux paragraphes défilent, « J'ai compris » reste visible. */}
        <ScrollView style={styles.scroll}>
          <Text style={styles.body}>{t.result.verdict.how}</Text>
          <Text style={styles.body}>{t.result.verdict.limits}</Text>
        </ScrollView>
        <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" testID="verdict-fermer">
          <Text style={styles.closeLabel}>{t.result.verdict.closeButton}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// Mêmes mesures et mêmes couleurs que l'avis « aucun prix » et les feuilles des mentions (contrastes déjà vérifiés).
// Aucune hauteur ni nombre de lignes imposés : la phrase passe à la ligne sur 320 points et en grand texte.
const styles = themedStyles(() => ({
  // Lot « fidélité aux maquettes » : la même phrase, mot pour mot, sans encadré, en 13 pt acier.
  // Lot « finitions de l'œil » : sous les pastilles (barre de tri), à la place du résumé ; aucune marge propre.
  box: { minHeight: 36, justifyContent: "center" },
  sentence: { fontSize: font.caption, lineHeight: 18, color: color.acier, flexShrink: 1 },
  more: { fontSize: font.caption, color: color.acier },
  backdrop: { flex: 1, backgroundColor: color.voile },
  sheet: {
    backgroundColor: color.porcelaine,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    width: "100%",
    maxWidth: 560,
    maxHeight: "85%",
    alignSelf: "center",
  },
  scroll: { flexGrow: 0 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.filet, alignSelf: "center", marginTop: 9, marginBottom: space.sm },
  title: { fontSize: font.body, fontWeight: "600", color: color.encre, textAlign: "center" },
  body: { fontSize: font.secondary, color: color.acier, lineHeight: 21, marginTop: space.sm, textAlign: "center" },
  close: { marginTop: space.lg, minHeight: 48, borderRadius: radius.md, backgroundColor: color.vert, alignItems: "center", justifyContent: "center" },
  closeLabel: { fontSize: font.body, fontWeight: "600", color: color.blanc },
}));
