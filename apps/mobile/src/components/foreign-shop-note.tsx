import { Text } from "react-native";
import type { Piece } from "@/api/types";
import { acceptLanguage, t } from "@/i18n";
import { isForeignPrice, searchCountryFrom } from "@/lib/foreign-shop";
import { color, font } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

/** « Boutique à l'étranger », sous un prix dans une autre devise que celle du
 * pays de la recherche (lot « premier essai ») ; rien sinon. `compact` : sous
 * le prix d'une petite carte. */
export function ForeignShopNote({ piece, compact = false }: { piece: Pick<Piece, "priceFrom" | "currency">; compact?: boolean }) {
  if (!isForeignPrice(piece.priceFrom, piece.currency, searchCountryFrom(acceptLanguage()))) return null;
  return (
    <Text style={compact ? styles.compact : styles.note} numberOfLines={1}>
      {t.firstTry.foreignShop}
    </Text>
  );
}

const styles = themedStyles(() => ({
  note: { fontSize: font.caption, color: color.acier, marginTop: 2 },
  compact: { fontSize: 12, color: color.acier, marginTop: 1 },
}));
