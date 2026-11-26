import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MerchantLinkContext } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { t } from "@/i18n";
import { openMerchantLink } from "@/lib/merchant-links";
import { useShopWatch } from "@/lib/use-purchase-question";
import { AffiliateMention } from "@/components/affiliate-mention";
import { ExternalLinkIcon } from "@/components/icons";
import { themedStyles } from "@/theme/themed-styles";

// « Voir chez le marchand » pour une pièce déjà gardée (Vault, Envies).
// Toujours via openMerchantLink (point de passage unique, contexte suivi).
// L'appelant n'affiche rien quand la pièce n'a pas de lien marchand (pièce
// ajoutée à la main). Le lien de secours (ouverture bloquée par le
// navigateur) est celui qu'openMerchantLink renvoie, donc déjà vérifié.
// La mention « Lien affilié » est affichée ici, sous le bouton, dans ses deux
// formes (plein et compact) : aucun appelant n'a à y penser, ni à la répéter.
export function MerchantLinkButton({
  url,
  merchantName,
  matchId,
  context,
  isAffiliate,
  compact = false,
  primary = false,
  externalIcon = false,
  explain = true,
}: {
  url: string;
  merchantName: string | null;
  matchId: string | null;
  context: MerchantLinkContext;
  isAffiliate: boolean;
  compact?: boolean;
  /** Bouton principal de l'écran (plein, vert) : la fiche d'une envie, où
   * acheter est le geste attendu (lot « Retrouver ses pièces »). */
  primary?: boolean;
  /** Variante pleine seulement : la flèche « s'ouvre hors de l'app » après le libellé (lot « fidélité aux maquettes »). */
  externalIcon?: boolean;
  /** false là où la place manque pour déplier l'explication (vignette de la
   * grille des envies) : la mention reste visible, seule. */
  explain?: boolean;
}) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  // Parcours 3 : la fiche d'une Envie guette le retour de la boutique
  // (« Vous l'avez achetée ? », lib/use-purchase-question.ts) ; ailleurs
  // (grille des Envies, Vault, publications…), aucun écran ne guette : rien
  // ne change.
  const shop = useShopWatch();
  const label = t.merchant.viewAt(merchantName);

  async function handlePress() {
    setBlockedUrl(null);
    const outcome = await shop.open(context, () => openMerchantLink({ matchId, url, context }));
    if (outcome.blocked) setBlockedUrl(outcome.url);
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        hitSlop={compact ? 10 : 0}
        style={compact ? styles.compact : primary ? [styles.button, styles.primary] : styles.button}
        accessibilityRole="link"
        accessibilityLabel={isAffiliate ? `${label}, ${t.result.affiliateDisclosure}` : label}
      >
        <Text style={compact ? styles.compactLabel : primary ? [styles.buttonLabel, styles.primaryLabel] : styles.buttonLabel} numberOfLines={compact ? 2 : 1}>
          {label}
          {compact ? " ›" : ""}
        </Text>
        {primary && externalIcon && !compact ? (
          <View accessible={false}>
            <ExternalLinkIcon size={18} tint={color.blanc} />
          </View>
        ) : null}
      </Pressable>
      <AffiliateMention isAffiliate={isAffiliate} explain={explain} centered={!compact} />
      {blockedUrl ? (
        <Pressable
          onPress={() => {
            WebBrowser.openBrowserAsync(blockedUrl).catch(() => {});
            setBlockedUrl(null);
          }}
          accessibilityRole="link"
        >
          <Text style={styles.blocked}>{t.result.merchantLinkBlocked}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = themedStyles(() => ({
  button: {
    borderWidth: 1,
    borderColor: color.encre,
    borderRadius: radius.md,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.md,
  },
  buttonLabel: { fontSize: font.secondary, color: color.encre, fontWeight: "600" },
  // Variante pleine (maquette « Écrin » 6) : 52 pt, la flèche à côté du libellé.
  primary: { backgroundColor: color.vert, borderColor: color.vert, minHeight: 52, flexDirection: "row", gap: 8 },
  primaryLabel: { color: color.blanc, flexShrink: 1 },
  compact: { minHeight: 32, justifyContent: "center" },
  compactLabel: { ...lienSouligne, fontSize: 11.5, color: color.vert, fontWeight: "600" },
  blocked: { ...lienSouligne, fontSize: font.caption, color: color.vert, marginTop: 6 },
}));
