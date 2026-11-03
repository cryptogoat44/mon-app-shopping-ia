import { useState } from "react";
import { Pressable, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MerchantLinkContext } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { openMerchantLink } from "@/lib/merchant-links";
import { themedStyles } from "@/theme/themed-styles";

// « Voir chez le marchand » pour une pièce déjà gardée (Vault, Envies).
// Toujours via openMerchantLink (point de passage unique, contexte suivi).
// L'appelant n'affiche rien quand la pièce n'a pas de lien marchand (pièce
// ajoutée à la main). Le lien de secours (ouverture bloquée par le
// navigateur) est celui qu'openMerchantLink renvoie, donc déjà vérifié.
export function MerchantLinkButton({
  url,
  merchantName,
  matchId,
  context,
  isAffiliate,
  compact = false,
  primary = false,
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
}) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const label = t.merchant.viewAt(merchantName);

  async function handlePress() {
    setBlockedUrl(null);
    const outcome = await openMerchantLink({ matchId, url, context });
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
      </Pressable>
      {!compact && isAffiliate ? <Text style={styles.disclosure}>{t.result.affiliateDisclosure}</Text> : null}
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
  primary: { backgroundColor: color.vert, borderColor: color.vert },
  primaryLabel: { color: color.blanc },
  compact: { minHeight: 32, justifyContent: "center" },
  compactLabel: { fontSize: 11.5, color: color.vert, fontWeight: "600" },
  disclosure: { textAlign: "center", fontSize: 11.5, color: color.acier, marginTop: 6 },
  blocked: { fontSize: font.caption, color: color.vert, marginTop: 6 },
}));
