// Actions supplémentaires d'une fiche de pièce (proposition du Spotter, envie,
// pièce du Vault). Version iPhone : aucune — ce composant ne rend rien et
// n'importe rien d'autre. La version du site (même nom, suffixe .web) n'est
// prise que par la compilation du site.
import type { StyleProp, ViewStyle } from "react-native";

export interface PieceExtraActionsProps {
  /** Identifiant de la proposition d'origine (product_match), null sans proposition. */
  matchId: string | null;
  /** Images de la pièce, la meilleure d'abord. */
  imageUrls: readonly (string | null | undefined)[];
  /** Lien d'achat de la pièce (affilié ou boutique), null sans lien. */
  buyUrl: string | null;
  /** Nom de la pièce, pour les lecteurs d'écran. */
  title: string;
  style?: StyleProp<ViewStyle>;
}

export function PieceExtraActions(_props: PieceExtraActionsProps) {
  return null;
}
