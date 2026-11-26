import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { Piece } from "@/api/types";
import { color, font, radius, size, space } from "@/theme/tokens";
import { lienSouligne } from "@/theme/accent";
import { getActiveLocale, t } from "@/i18n";
import { formatPrice } from "@/lib/format";
import { openMerchantLink } from "@/lib/merchant-links";
import { useShopWatch } from "@/lib/use-purchase-question";
import { hasMarks, merchantContextFor, merchantMarkFor, opensOfferPage } from "@/lib/result-sections";
import type { ClickPlacement } from "@/lib/price-first";
import { SpotImage } from "@/components/spot-image";
import { PieceTile } from "@/components/piece-tile";
import { ForeignShopNote } from "@/components/foreign-shop-note";
import { OfferMarkNote } from "@/components/offer-mark";
import { StockNote } from "@/components/stock-note";
import { isAffiliateLink } from "@/lib/affiliate-link";
import { AffiliateMention } from "@/components/affiliate-mention";
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
 * boutique arrive au-dessus). Retours du build 2 (24 novembre 2026) :
 * « Envoyer à un ami » et « Plus disponible ? » ne sont plus sur les lignes ni
 * sur les cartes (elles prenaient trop de place) ; ils restent seulement sur
 * la grande carte de la pièce choisie (spot/result.tsx). */
export function ProposalCard({
  piece,
  onSelect,
  placement,
  cheapest = false,
  variant = "grid",
  column,
  rowHasMarks,
}: {
  piece: Piece;
  onSelect: () => void;
  placement?: ClickPlacement;
  cheapest?: boolean;
  variant?: "grid" | "row";
  /** Grille de deux colonnes à 8 pt (lot « fidélité aux maquettes ») : la moitié de la largeur, l'écart porté par la carte. Absent : 48 %, comme avant. */
  column?: "left" | "right";
  /** Grille : la carte voisine de la même rangée a une mention (rowHasMarks) ; la rangée des mentions est alors
   * réservée, même vide, pour que « Voir chez … » soit à la même hauteur dans les deux cartes. Absent : cette carte seule. */
  rowHasMarks?: boolean;
}) {
  const price = piece.priceFrom !== null ? formatPrice(piece.priceFrom, piece.currency, getActiveLocale()) : null;
  // Ligne de la liste triée : « Prix à vérifier chez le marchand » s'affiche aussi sans prix, et se lit.
  const shownPrice = price ?? (variant === "row" ? t.result.priceOnSite : null);
  const label = [piece.name, piece.merchantName, shownPrice, cheapest ? t.result.cheapestBadge : null].filter(Boolean).join(", ");
  const marksRow = hasMarks(piece) || rowHasMarks === true;

  if (variant === "row") {
    return (
      <View style={styles.row} testID="price-row">
        <Pressable onPress={onSelect} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t.result.showLargeHint}>
          <View style={styles.rowImage}>
            <SpotImage hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} style={styles.fill} size="card" />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={2}>
              {piece.name}
            </Text>
            {piece.merchantName ? (
              <Text style={styles.rowMeta} numberOfLines={1}>
                {piece.merchantName}
              </Text>
            ) : null}
            <Text style={price ? styles.rowPrice : styles.rowNoPrice}>{shownPrice}</Text>
            {cheapest ? <CheapestBadge /> : null}
            <ForeignShopNote piece={piece} compact />
          </View>
        </Pressable>
        {piece.merchantUrl || piece.offerMark || typeof piece.inStock === "boolean" ? (
          <View style={styles.rowLink}>
            {/* Boutiques douteuses : « Boutique connue » ou « Prix inhabituellement bas », touchable à part. */}
            <OfferMarkNote piece={piece} />
            {/* Stock affiché : « En stock » ou « Épuisée » d'après Google, touchable à part (components/stock-note.tsx). */}
            <StockNote piece={piece} />
            {piece.merchantUrl ? <ShopLink piece={piece} placement={placement} /> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={column === undefined ? styles.card : [styles.cardColumn, column === "left" ? styles.cardLeft : styles.cardRight]}>
      <Pressable onPress={onSelect} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={t.result.showLargeHint}>
        {/* La tuile « Écrin » des grilles (components/piece-tile.tsx) ; le libellé est celui du bouton. */}
        <View>
          <PieceTile variant="grid" size="card" hdUri={piece.imageHdUrl} fallbackUri={piece.imageUrl} edgeColor={piece.edgeColor} />
          {/* Lot « finitions de l'œil » : « Le moins cher » posé sur le coin de la photo, pour que les lignes de la
              carte restent alignées sur celles de sa voisine (lu avec la carte : son libellé le contient). */}
          {cheapest ? <CheapestBadge onTile /> : null}
        </View>
        <Text style={styles.cardName} numberOfLines={2}>
          {piece.name}
        </Text>
        {/* Le prix n'est jamais coupé : c'est le nom de la boutique qui se raccourcit (lot « finitions de l'œil »). */}
        <ShopAndPrice shop={piece.merchantName} price={price} />
        {/* Lot premier essai : prix dans la devise d'un autre pays que celui de la recherche. */}
        <ForeignShopNote piece={piece} compact />
      </Pressable>
      {/* Côte à côte quand elles tiennent (« Boutique connue · En stock »), sinon l'une sous l'autre (retours du build 3).
          Rien à dire dans la rangée (ni ici ni chez la voisine) : pas de rangée (ses marges négatives, rythme de la
          maquette 5, ne tirent rien sur le prix). La voisine en a une : rangée vide de même hauteur (cartes alignées). */}
      {marksRow ? (
        <View style={styles.marks}>
          {/* Boutiques douteuses : « Boutique connue » ou « Prix inhabituellement bas », touchable à part. */}
          <OfferMarkNote piece={piece} />
          {piece.offerMark && typeof piece.inStock === "boolean" ? (
            <Text style={styles.markDot} accessible={false}>
              ·
            </Text>
          ) : null}
          {/* Stock affiché : « En stock » ou « Épuisée » d'après Google, touchable à part (components/stock-note.tsx). */}
          <StockNote piece={piece} />
        </View>
      ) : null}
      {/* Sous une rangée de mentions, le lien ne remonte pas : sa zone de 44 points s'arrête sous leur texte
          (correctif du lot « finitions de l'œil » : toucher « En stock » n'ouvre jamais la boutique). */}
      {piece.merchantUrl ? <ShopLink piece={piece} placement={placement} tight={!marksRow} /> : null}
    </View>
  );
}

/** « <boutique> · <prix> » sur une ligne : le nom de la boutique se raccourcit
 * (points de suspension), le prix reste entier, à toutes les largeurs et en
 * grand texte (lot « finitions de l'œil »). Lu avec la carte (son libellé). */
export function ShopAndPrice({ shop, price }: { shop: string | null | undefined; price: string | null }) {
  if (!shop && !price) return null;
  return (
    <View style={styles.cardMetaRow}>
      {shop ? (
        <Text style={[styles.cardMeta, styles.cardShop]} numberOfLines={1}>
          {shop}
        </Text>
      ) : null}
      {price ? (
        <Text style={[styles.cardMeta, styles.cardPrice]} numberOfLines={1}>
          {shop ? `\u00a0· ${price}` : price}
        </Text>
      ) : null}
    </View>
  );
}

/** Pastille « Le moins cher » (lib/result-sort.ts, cheapestIndex) : sur une
 * carte, une ligne de la liste triée ou la grande carte. Lue avec la carte
 * par VoiceOver (son libellé la contient). `onTile` : posée sur le coin de la
 * photo d'une carte de grille (elle ne décale plus les lignes de la carte). */
export function CheapestBadge({ onTile = false, inline = false }: { onTile?: boolean; inline?: boolean } = {}) {
  const badge = (
    <View style={onTile ? [styles.badge, styles.badgeOnTile] : inline ? [styles.badge, styles.badgeInline] : styles.badge} testID="cheapest-badge">
      <Text style={styles.badgeLabel} numberOfLines={1}>
        {t.result.cheapestBadge}
      </Text>
    </View>
  );
  // Sur la photo : une zone posée à 8 points des bords gauche ET droit de la tuile ; la pastille y garde sa largeur
  // de contenu, bornée par la zone (au grand texte, son texte se raccourcit dans la tuile, jamais au-delà).
  return onTile ? (
    <View style={styles.badgeOnTileZone} pointerEvents="none">
      {badge}
    </View>
  ) : (
    badge
  );
}

/** Même lien et même libellé que le bouton de la grande carte, par le point
 * de passage unique (openMerchantLink : adresses web seulement, clic suivi).
 * Le lien de secours, si le navigateur bloque l'ouverture, est celui
 * qu'openMerchantLink renvoie, donc déjà vérifié. La mention « Lien
 * affilié » est écrite sous le lien (et lue avec lui par VoiceOver) ; ce
 * qu'elle signifie se lit sur la grande carte, en touchant la pièce.
 * Parcours 3 : l'écran Résultat guette le retour de la boutique pour CETTE
 * pièce (« Vous l'avez achetée ? », lib/use-purchase-question.ts) ; l'appel
 * openMerchantLink lui est confié tel quel. Sans écran qui guette, rien ne
 * change. */
function ShopLink({ piece, placement, tight = false }: { piece: Piece; placement?: ClickPlacement; tight?: boolean }) {
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  const shop = useShopWatch();
  const label = opensOfferPage(piece) ? t.result.viewOffer : t.result.viewAt(piece.merchantName ?? "");
  const isAffiliate = isAffiliateLink(piece);

  async function handlePress() {
    const url = piece.affiliateUrl ?? piece.merchantUrl;
    if (!url) return;
    setBlockedUrl(null);
    const outcome = await shop.open(
      merchantContextFor(piece),
      () => openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: merchantContextFor(piece), placement, mark: merchantMarkFor(piece) }),
      piece
    );
    if (outcome.blocked) setBlockedUrl(outcome.url);
  }

  return (
    <>
      <Pressable
        onPress={handlePress}
        style={tight ? [styles.shopLink, styles.shopLinkTight] : styles.shopLink}
        accessibilityRole="link"
        // Le nom de la pièce : parmi les liens de la page (rotor de VoiceOver), « Voir chez … » seul serait ambigu.
        accessibilityLabel={[label, piece.name, isAffiliate ? t.result.affiliateDisclosure : null].filter(Boolean).join(", ")}
      >
        {/* Une seule ligne (lot « finitions de l'œil ») : le libellé souligné se raccourcit (points de suspension),
            le « › », hors du soulignement et du texte raccourci, reste toujours visible. */}
        <View style={styles.shopLinkLine}>
          <Text style={styles.shopLinkLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.shopLinkChevron}>{"\u00a0›"}</Text>
        </View>
      </Pressable>
      <AffiliateMention isAffiliate={isAffiliate} />
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
  cardColumn: { width: "50%" },
  cardLeft: { paddingRight: 4 },
  cardRight: { paddingLeft: 4 },
  // Rythme de la maquette 5 (lot « finitions de l'œil ») : environ 21 points d'axe à axe entre le prix et la
  // mention, 24 entre la mention et « Voir chez … » ; les zones touchables (32 et 44 points) débordent sur
  // l'espace vide de leurs voisines, sans les recouvrir.
  // Sous les mentions (32 points, texte de 12 centré : 8 points vides en bas), le lien commence où finit leur texte :
  // marginBottom -8 seul, jamais de marge négative du lien en plus (shopLinkTight). minHeight : rangée vide réservée.
  marks: { flexDirection: "row", flexWrap: "wrap", columnGap: space.sm, marginTop: -5, marginBottom: -8, alignItems: "center", minHeight: 32 },
  markDot: { fontSize: 12, color: color.acier },
  fill: { width: "100%", height: "100%" },
  // Deux lignes réservées : les rangées restent alignées (minHeight, jamais height).
  cardName: { fontSize: font.secondary, lineHeight: 20, fontWeight: "500", color: color.encre, marginTop: 8, minHeight: 40 },
  cardMetaRow: { flexDirection: "row", marginTop: 2 },
  cardMeta: { fontSize: font.caption, lineHeight: 18, color: color.acier },
  cardShop: { flexShrink: 1 },
  cardPrice: { flexShrink: 0 },
  // Ligne de la liste triée par prix : inchangée (aucune maquette).
  rowName: { fontSize: font.caption, color: color.encre, marginTop: 8, lineHeight: 17 },
  rowMeta: { fontSize: 12, color: color.acier, marginTop: 2 },
  shopLink: { minHeight: size.touchTarget, justifyContent: "center" },
  // Carte de grille : la zone de 44 points remonte sur l'espace vide de la ligne d'au-dessus.
  shopLinkTight: { marginTop: -6 },
  shopLinkLine: { flexDirection: "row", alignItems: "center" },
  shopLinkLabel: { ...lienSouligne, fontSize: font.caption, lineHeight: 17, color: color.vert, fontWeight: "400", flexShrink: 1 },
  shopLinkChevron: { fontSize: font.caption, lineHeight: 17, color: color.encre, flexShrink: 0 },
  blockedLink: { ...lienSouligne, fontSize: font.caption, color: color.vert, fontWeight: "600", marginBottom: space.xs },
  // Ligne de la liste triée par prix : vignette à gauche, texte et prix à droite, le lien sous le texte.
  row: { width: "100%", paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.filet },
  rowMain: { flexDirection: "row", gap: 12 },
  // Vignette de moins de 100 points : contenue sur la plinthe, coins doux (retours du build 3).
  rowImage: { width: ROW_IMAGE_WIDTH, aspectRatio: 4 / 5, backgroundColor: color.plinthe, borderRadius: radius.pieceThumb, borderCurve: "continuous", overflow: "hidden" },
  rowText: { flex: 1, minWidth: 0 },
  rowPrice: { fontSize: font.secondary, color: color.encre, fontWeight: "600", marginTop: 4 },
  rowNoPrice: { fontSize: 12, color: color.acier, marginTop: 4 },
  rowLink: { marginLeft: ROW_IMAGE_WIDTH + 12 },
  // Pastille pleine : blanc sur vert (contraste AA vérifié, tests/contrast.test.ts).
  badge: { alignSelf: "flex-start", backgroundColor: color.vert, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2, marginTop: 4 },
  badgeLabel: { fontSize: 12, color: color.blanc, fontWeight: "600" },
  badgeOnTileZone: { position: "absolute", top: space.sm, left: space.sm, right: space.sm, alignItems: "flex-start" },
  badgeOnTile: { marginTop: 0, maxWidth: "100%" },
  // Sur la rangée des mentions de la grande carte : centrée sur la ligne, sans marge.
  badgeInline: { marginTop: 0, alignSelf: "center" },
}));
