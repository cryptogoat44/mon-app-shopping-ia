import { View } from "react-native";
import { SpotImage } from "@/components/spot-image";
import { color, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Cadre de l'image d'une pièce (décision du fondateur, lot 5 : « image
// entière, cadre 4:5 ») : l'image entière, « contenue » (jamais rognée ni
// déformée), centrée sur le fond plinthe, 360 px de large au plus. Partagé
// par l'écran d'une envie et les publications qui montrent une pièce (envie
// republiée, « achat » venu du Spotter : lib/post-media.ts), pour qu'ils
// restent identiques.
export function ProductFrame({
  hdUri,
  fallbackUri,
  accessibilityLabel,
  recyclingKey,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  accessibilityLabel?: string;
  /** Dans une liste (fil) : voir SpotImage. */
  recyclingKey?: string;
}) {
  return (
    <View style={styles.frame}>
      <SpotImage
        hdUri={hdUri}
        fallbackUri={fallbackUri}
        style={styles.fill}
        fit="contain"
        accessibilityLabel={accessibilityLabel}
        recyclingKey={recyclingKey}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { width: "100%", maxWidth: 360, aspectRatio: 4 / 5, alignSelf: "center", borderRadius: radius.sm, backgroundColor: color.plinthe, overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
}));
