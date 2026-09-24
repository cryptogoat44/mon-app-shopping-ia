import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MerchantLinkContext } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { openMerchantLink } from "@/lib/merchant-links";

// « Voir chez le marchand » pour une pièce déjà gardée (Vault, Envies).
// Toujours via openMerchantLink (point de passage unique, contexte suivi).
// L'appelant n'affiche rien quand la pièce n'a pas de lien marchand (pièce
// ajoutée à la main).
export function MerchantLinkButton({
  url,
  merchantName,
  matchId,
  context,
  isAffiliate,
  compact = false,
}: {
  url: string;
  merchantName: string | null;
  matchId: string | null;
  context: MerchantLinkContext;
  isAffiliate: boolean;
  compact?: boolean;
}) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const label = fr.merchant.viewAt(merchantName);

  async function handlePress() {
    setBlockedUrl(null);
    const outcome = await openMerchantLink({ matchId, url, context });
    if (outcome.blocked) setBlockedUrl(outcome.url ?? url);
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        hitSlop={compact ? 10 : 0}
        style={compact ? styles.compact : styles.button}
        accessibilityRole="link"
        accessibilityLabel={isAffiliate ? `${label}, ${fr.result.affiliateDisclosure}` : label}
      >
        <Text style={compact ? styles.compactLabel : styles.buttonLabel} numberOfLines={compact ? 2 : 1}>
          {label}
          {compact ? " ›" : ""}
        </Text>
      </Pressable>
      {!compact && isAffiliate ? <Text style={styles.disclosure}>{fr.result.affiliateDisclosure}</Text> : null}
      {blockedUrl ? (
        <Pressable
          onPress={() => {
            WebBrowser.openBrowserAsync(blockedUrl).catch(() => {});
            setBlockedUrl(null);
          }}
          accessibilityRole="link"
        >
          <Text style={styles.blocked}>{fr.result.merchantLinkBlocked}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
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
  compact: { minHeight: 32, justifyContent: "center" },
  compactLabel: { fontSize: 11.5, color: color.vert, fontWeight: "600" },
  disclosure: { textAlign: "center", fontSize: 11.5, color: color.acier, marginTop: 6 },
  blocked: { fontSize: font.caption, color: color.vert, marginTop: 6 },
});
