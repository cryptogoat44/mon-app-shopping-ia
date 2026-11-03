import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { yourPieceView, type YourPieceImage } from "@/lib/your-piece";
import { themedStyles } from "@/theme/themed-styles";

// Taille maximale de la vignette : assez pour reconnaître couleur et forme,
// sans repousser la grande image (lot résultats lisibles).
const THUMB_MAX = { width: 56, height: 70 };

/** « Votre pièce » : la zone montrée à Spotto, juste au-dessus de la grande
 * image, pour comparer d'un coup d'œil. L'image reste sur l'appareil (rien
 * n'est envoyé) ; illisible (fichier effacé entre-temps), rien ne s'affiche.
 * Un seul élément pour VoiceOver, lu avant la meilleure proposition. */
export function YourPiece({ image }: { image: YourPieceImage }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const view = yourPieceView(image, THUMB_MAX.width, THUMB_MAX.height);
  const picture = (
    <Image
      source={{ uri: image.uri }}
      style={styles.fill}
      contentFit={view.image ? "fill" : "contain"}
      // En mémoire seulement : aucune copie de plus de la photo sur le disque.
      cachePolicy="memory"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );

  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel={t.result.yourPiece} testID="votre-piece">
      <View style={[styles.frame, view.frame]}>
        {/* Le décalage est porté par une View : sur le web, expo-image ignore
            un décalage négatif posé sur l'image (comme l'écran d'attente). */}
        {view.image ? <View style={[styles.absolute, view.image]}>{picture}</View> : picture}
      </View>
      <Text style={styles.label}>{t.result.yourPiece}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: space.md },
  frame: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: color.plinthe },
  absolute: { position: "absolute" },
  fill: { width: "100%", height: "100%" },
  // Même style que « Meilleure proposition », sous la grande image.
  label: { fontSize: font.caption, color: color.acier, fontWeight: "600" },
}));
