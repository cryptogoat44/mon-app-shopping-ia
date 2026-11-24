import { View } from "react-native";
import { SpotImage } from "@/components/spot-image";
import { EnlargeableImage } from "@/components/image-viewer";
import { color, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Cadre de l'image d'une pièce (décision du fondateur, lot 5 : « image
// entière, cadre 4:5 ») : l'image entière, « contenue » (jamais rognée ni
// déformée), centrée sur le fond plinthe, 360 px de large au plus. Partagé
// par l'écran d'une envie et les publications qui montrent une pièce (envie
// republiée, « achat » venu du Spotter : lib/post-media.ts), pour qu'ils
// restent identiques. `enlargeable` (fiche d'une envie seulement, retours du
// build 2) : toucher l'image l'ouvre en plein écran (components/image-viewer.tsx) ;
// jamais dans le fil.
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
  const image = (
    <SpotImage hdUri={hdUri} fallbackUri={fallbackUri} style={styles.fill} fit="contain" accessibilityLabel={accessibilityLabel} recyclingKey={recyclingKey} />
  );
  return (
    <View style={styles.frame}>
      {enlargeable ? (
        <EnlargeableImage hdUri={hdUri} fallbackUri={fallbackUri} label={accessibilityLabel ?? ""} style={styles.fill}>
          {image}
        </EnlargeableImage>
      ) : (
        image
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { width: "100%", maxWidth: 360, aspectRatio: 4 / 5, alignSelf: "center", borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
}));
