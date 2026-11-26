import { PieceTile } from "@/components/piece-tile";
import { size } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Cadre de l'image d'une pièce (décision du fondateur, lot 5 : « image
// entière, cadre 4:5 ») : depuis les retours du build 3 (« Écrin »), une
// simple grande tuile de pièce (components/piece-tile.tsx : coins doux,
// photo entière sur une copie floue d'elle-même, plus aucune bande), aussi
// large que le texte (size.contentMaxWidth). Partagé par l'écran d'une envie
// et les publications qui montrent une pièce (envie republiée, « achat »
// venu du Spotter : lib/post-media.ts), pour qu'ils restent identiques.
// `enlargeable` (fiche d'une envie seulement, retours du build 2) : toucher
// l'image l'ouvre en plein écran (components/image-viewer.tsx) ; jamais dans
// le fil.
export function ProductFrame({
  hdUri,
  fallbackUri,
  accessibilityLabel,
  recyclingKey,
  enlargeable = false,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  accessibilityLabel?: string;
  /** Dans une liste (fil) : voir SpotImage. */
  recyclingKey?: string;
  enlargeable?: boolean;
}) {
  return (
    <PieceTile
      variant="hero"
      hdUri={hdUri}
      fallbackUri={fallbackUri}
      accessibilityLabel={accessibilityLabel}
      recyclingKey={recyclingKey}
      enlargeable={enlargeable}
      style={styles.frame}
    />
  );
}

const styles = themedStyles(() => ({
  frame: { maxWidth: size.contentMaxWidth, alignSelf: "center" },
}));
