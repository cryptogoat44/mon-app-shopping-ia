import { Text, View } from "react-native";
import type { MessageWishCard as WishCard } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { getActiveLocale, t } from "@/i18n";
import { wishCardPrice } from "@/lib/conversations";
import { MerchantLinkButton } from "@/components/merchant-link-button";
import { SpotImage } from "@/components/spot-image";
import { themedStyles } from "@/theme/themed-styles";

// Envie jointe à un message (lot messages) : la copie de son image faite par
// Spotto (jamais l'image du marchand), son titre, son prix et le lien vers la
// boutique (mention « lien affilié » quand c'est le cas).
export function MessageWishCard({ card, mine }: { card: WishCard; mine: boolean }) {
  const price = wishCardPrice(card, getActiveLocale());
  const meta = [card.merchantName, price].filter(Boolean).join(" · ");
  return (
    <View style={styles.card} testID="carte-envie">
      <View style={styles.image}>
        <SpotImage hdUri={null} fallbackUri={card.imageThumbUrl} style={styles.fill} fit="cover" accessibilityLabel={t.messages.wishLabel(card.title)} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {card.merchantUrl ? (
          <>
            <MerchantLinkButton
              url={card.merchantUrl}
              merchantName={card.merchantName}
              matchId={card.productMatchId}
              context={mine ? "wishlist" : "received"}
              isAffiliate={card.isAffiliate}
              compact
            />
            {card.isAffiliate ? <Text style={styles.disclosure}>{t.result.affiliateDisclosure}</Text> : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: { width: 220, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.filet, overflow: "hidden" },
  image: { width: "100%", aspectRatio: 1, backgroundColor: color.plinthe },
  fill: { width: "100%", height: "100%" },
  body: { padding: space.sm, gap: 4 },
  title: { fontSize: font.secondary, fontWeight: "600", color: color.encre },
  meta: { fontSize: font.caption, color: color.acier },
  disclosure: { fontSize: 11.5, color: color.acier },
}));
