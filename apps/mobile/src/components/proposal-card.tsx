import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { Piece } from "@/api/types";
import { color, font, radius, size, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { formatPrice } from "@/lib/format";
import { openMerchantLink } from "@/lib/merchant-links";
import { merchantContextFor, opensOfferPage } from "@/lib/result-sections";
import type { ClickPlacement } from "@/lib/price-first";
import { SpotImage } from "@/components/spot-image";
import { ForeignShopNote } from "@/components/foreign-shop-note";
import { isAffiliateLink } from "@/lib/affiliate-link";
import { themedStyles } from "@/theme/themed-styles";

// Carte d'une proposition dans les grilles de l'écran Résultat (« Autres
// propositions » et sections du complément de la voie C). Lot résultats
// lisibles : vignette légère d'abord (la case est petite), et « Voir
// chez … » sur chaque carte, pour aller à la boutique sans remonter. Deux
// zones séparées, jamais l'une dans l'autre : VoiceOver les lit l'une après
// l'autre, et le site garde des éléments cliquables valides.

/** Toucher l'image ou le nom montre la proposition en grand ; le lien, juste
 * dessous, ouvre la boutique. `placement` : sa place à l'écran, pour les
 * statistiques du clic (prix d'abord, lib/price-first.ts). */
export function ProposalCard({ piece, onSelect, placement }: { piece: Piece; onSelect: () => void; placement?: ClickPlacement }) {
  const price = piece.priceFrom !== null ? formatPrice(piece.priceFrom, piece.currency, getActiveLocale()) : null;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityLabel={[piece.name, piece.merchantName, price].filter(Boolean).join(", ")}
        accessibilityHint={t.result.showLargeHint}
      >
        <View style={styles.cardImage}>
          <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} size="small" />
        </View>
        <Text style={styles.cardName} numberOfLines={2}>
          {piece.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {[piece.merchantName, price].filter(Boolean).join(" · ")}
        </Text>
        {/* Lot premier essai : prix dans la devise d'un autre pays que celui de la recherche. */}
        <ForeignShopNote piece={piece} compact />
      </Pressable>
      {piece.merchantUrl ? <ShopLink piece={piece} placement={placement} /> : null}
    </View>
  );
}

/** Même lien et même libellé que le bouton de la grande carte, par le point
 * de passage unique (openMerchantLink : adresses web seulement, clic suivi).
 * Le lien de secours, si le navigateur bloque l'ouverture, est celui
 * qu'openMerchantLink renvoie, donc déjà vérifié. */
function ShopLink({ piece, placement }: { piece: Piece; placement?: ClickPlacement }) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const label = opensOfferPage(piece) ? t.result.viewOffer : t.result.viewAt(piece.merchantName ?? "");
  const isAffiliate = isAffiliateLink(piece);

  async function handlePress() {
    const url = piece.affiliateUrl ?? piece.merchantUrl;
    if (!url) return;
    setBlockedUrl(null);
    const outcome = await openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: merchantContextFor(piece), placement });
    if (outcome.blocked) setBlockedUrl(outcome.url);
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={styles.shopLink}
        accessibilityRole="link"
        // Le nom de la pièce : parmi les liens de la page (rotor de VoiceOver), « Voir chez … » seul serait ambigu.
        accessibilityLabel={[label, piece.name, isAffiliate ? t.result.affiliateDisclosure : null].filter(Boolean).join(", ")}
      >
        <Text style={styles.shopLinkLabel} numberOfLines={2}>
          {label} ›
        </Text>
      </Pressable>
      {blockedUrl ? (
        <Pressable
          onPress={() => {
            WebBrowser.openBrowserAsync(blockedUrl).catch(() => {});
            setBlockedUrl(null);
          }}
          accessibilityRole="link"
        >
          <Text style={styles.blockedLink}>{t.result.merchantLinkBlocked}</Text>
        </Pressable>
      ) : null}
    </>
  );
}

// Mêmes mesures que l'ancienne carte de la grille ; le lien a la zone
// tactile minimale (44 points).
const styles = themedStyles(() => ({
  card: { width: "48%" },
  cardImage: { width: "100%", aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
  cardName: { fontSize: font.caption, color: color.encre, marginTop: 8, lineHeight: 17 },
  cardMeta: { fontSize: 12, color: color.acier, marginTop: 2 },
  shopLink: { minHeight: size.touchTarget, justifyContent: "center" },
  shopLinkLabel: { fontSize: font.caption, color: color.vert, fontWeight: "600", lineHeight: 17 },
  blockedLink: { fontSize: font.caption, color: color.vert, fontWeight: "600", textDecorationLine: "underline", marginBottom: space.xs },
}));
