import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { affiliateMentionForm } from "@/lib/affiliate-link";
import { themedStyles } from "@/theme/themed-styles";

// « Lien affilié », la mention VISIBLE (lot « mention Lien affilié ») : le
// seul composant qui l'écrit à l'écran, sous chaque lien vers une boutique.
// Il ne décide rien : `isAffiliate` vient toujours de la règle unique
// (lib/affiliate-link.ts dans l'app, ou `isAffiliate` calculé de la même
// façon par le serveur quand il ne renvoie que le lien à ouvrir).
// Aujourd'hui aucun lien n'est affilié : rien ne s'affiche nulle part.
//
// Trois formes :
// - seule (par défaut) : le texte, là où la place manque (carte d'une
//   proposition, vignette d'une envie) ;
// - `explain` : touchée, elle déplie « Comment Spotto se rémunère » et ce
//   que signifie « lien affilié » ;
// - `inline` : à la suite d'un libellé, dans son <Text> (pastille d'une
//   pièce taguée).
export function AffiliateMention({
  isAffiliate,
  explain = false,
  centered = false,
  inline = false,
}: {
  /** Absent d'une réponse d'un ancien serveur : pas de mention. */
  isAffiliate: boolean | undefined;
  explain?: boolean;
  /** Sous un bouton pleine largeur (grande carte, fiche d'une envie ou d'une pièce). */
  centered?: boolean;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const form = affiliateMentionForm(isAffiliate, { explain, inline });
  if (form === "none") return null;

  if (form === "inline") return <Text style={styles.mention}> · {t.result.affiliateDisclosure}</Text>;

  if (form === "plain") {
    return (
      <Text style={centered ? [styles.mention, styles.centeredText] : styles.mention} testID="mention-lien-affilie">
        {t.result.affiliateDisclosure}
      </Text>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        // 32 points + 12 : la zone tactile minimale (44), sans mordre sur le lien juste au-dessus.
        hitSlop={{ top: 2, bottom: 10, left: 10, right: 10 }}
        style={centered ? [styles.toggle, styles.centered] : styles.toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint={t.result.affiliateHint}
        testID="mention-lien-affilie"
      >
        <Text style={styles.mention}>
          {t.result.affiliateDisclosure} <Text style={styles.more}>{open ? "–" : "ⓘ"}</Text>
        </Text>
      </Pressable>
      {open ? (
        <View style={centered ? [styles.explanation, styles.explanationCentered] : styles.explanation}>
          <Text style={centered ? [styles.explanationTitle, styles.centeredText] : styles.explanationTitle}>{t.settings.howWeEarn}</Text>
          <Text style={centered ? [styles.explanationText, styles.centeredText] : styles.explanationText}>{t.result.affiliateExplanation}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  mention: { fontSize: 11.5, color: color.acier },
  more: { fontSize: 12 },
  toggle: { minHeight: 32, justifyContent: "center", alignSelf: "flex-start" },
  centered: { alignSelf: "center" },
  centeredText: { textAlign: "center" },
  explanation: { gap: 2, marginBottom: space.xs },
  explanationCentered: { paddingHorizontal: space.md },
  explanationTitle: { fontSize: font.caption, color: color.encre, fontWeight: "600" },
  explanationText: { fontSize: font.caption, color: color.acier, lineHeight: 18 },
}));
