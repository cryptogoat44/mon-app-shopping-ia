import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
import { SendToFriendLink } from "@/components/send-to-friend-link";
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
 * statistiques du clic (prix d'abord, lib/price-first.ts). `cheapest` : la
 * moins chère de la devise dominante (lib/result-sort.ts). `variant` :
 * « row », une ligne pleine largeur de la liste triée par prix (prix en
 * évidence, une ligne par proposition : la page ne saute pas quand une
 * boutique arrive au-dessus). `onSend` : « Envoyer à un ami » pour CETTE
 * pièce (lib/send-to-friend.ts), sous le lien ; absent, rien ne s'affiche
 * (messagerie indisponible, pièce de démonstration). */
export function ProposalCard({
  piece,
  onSelect,
  placement,
  cheapest = false,
  variant = "grid",
  onSend,
}: {
  piece: Piece;
  onSelect: () => void;
  placement?: ClickPlacement;
  cheapest?: boolean;
  variant?: "grid" | "row";
  onSend?: () => void;
}) {
  const price = piece.priceFrom !== null ? formatPrice(piece.priceFrom, piece.currency, getActiveLocale()) : null;
  // Ligne de la liste triée : « Prix à vérifier chez le marchand » s'affiche aussi sans prix, et se lit.
  const shownPrice = price ?? (variant === "row" ? t.result.priceOnSite : null);
  const label = [piece.name, piece.merchantName, shownPrice, cheapest ? t.result.cheapestBadge : null].filter(Boolean).join(", ");

  if (variant === "row") {
    return (
      <View style={styles.row} testID="price-row">
        <Pressable onPress={onSelect} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t.result.showLargeHint}>
          <View style={styles.rowImage}>
            <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} size="small" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.cardName} numberOfLines={2}>
              {piece.name}
            </Text>
            {piece.merchantName ? (
              <Text style={styles.cardMeta} numberOfLines={1}>
                {piece.merchantName}
              </Text>
            ) : null}
            <Text style={price ? styles.rowPrice : styles.rowNoPrice}>{shownPrice}</Text>
            {cheapest ? <CheapestBadge /> : null}
            <ForeignShopNote piece={piece} compact />
          </View>
        </Pressable>
        {piece.merchantUrl || onSend ? (
          <View style={styles.rowLink}>
            {piece.merchantUrl ? <ShopLink piece={piece} placement={placement} /> : null}
            {onSend ? <SendToFriendLink pieceName={piece.name} onPress={onSend} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Pressable onPress={onSelect} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t.result.showLargeHint}>
        <View style={styles.cardImage}>
          <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} size="small" />
        </View>
        <Text style={styles.cardName} numberOfLines={2}>
          {piece.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {[piece.merchantName, price].filter(Boolean).join(" · ")}
        </Text>
        {cheapest ? <CheapestBadge /> : null}
        {/* Lot premier essai : prix dans la devise d'un autre pays que celui de la recherche. */}
        <ForeignShopNote piece={piece} compact />
      </Pressable>
      {piece.merchantUrl ? <ShopLink piece={piece} placement={placement} /> : null}
      {onSend ? <SendToFriendLink pieceName={piece.name} onPress={onSend} /> : null}
    </View>
  );
}

/** Pastille « Le moins cher » (lib/result-sort.ts, cheapestIndex) : sur une
 * carte, une ligne de la liste triée ou la grande carte. Lue avec la carte
 * par VoiceOver (son libellé la contient). */
export function CheapestBadge() {
  return (
    <View style={styles.badge} testID="cheapest-badge">
      <Text style={styles.badgeLabel} numberOfLines={1}>
        {t.result.cheapestBadge}
      </Text>
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

const ROW_IMAGE_WIDTH = 76;

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
  // Ligne de la liste triée par prix : vignette à gauche, texte et prix à droite, le lien sous le texte.
  row: { width: "100%", paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  rowMain: { flexDirection: "row", gap: 12 },
  rowImage: { width: ROW_IMAGE_WIDTH, aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.sm, overflow: "hidden" },
  rowText: { flex: 1, minWidth: 0 },
  rowPrice: { fontSize: font.secondary, color: color.encre, fontWeight: "600", marginTop: 4 },
  rowNoPrice: { fontSize: 12, color: color.acier, marginTop: 4 },
  rowLink: { marginLeft: ROW_IMAGE_WIDTH + 12 },
  // Pastille pleine : blanc sur vert (contraste AA vérifié, tests/contrast.test.ts).
  badge: { alignSelf: "flex-start", backgroundColor: color.vert, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2, marginTop: 4 },
  badgeLabel: { fontSize: 12, color: color.blanc, fontWeight: "600" },
}));
