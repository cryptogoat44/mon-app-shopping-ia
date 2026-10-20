import { Text, View } from "react-native";
import { t } from "@/i18n";
import { ImageOffIcon } from "@/components/icons";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Image retirée par la modération (lot 5, partie B, décision du fondateur) :
// la place de l'image reste, sur le fond des pièces, avec « Image
// indisponible » ; le reste du contenu (titre, lien du marchand) s'affiche
// normalement. Trois tailles :
// - « frame » : le cadre 4:5 d'une pièce (publication, détail, lien partagé) ;
// - « tile » : une case de grille (profils) ;
// - « thumb » : une petite vignette (pièces reçues, modération) — icône seule,
//   le texte restant lu par les lecteurs d'écran.
export function ImageUnavailable({ variant, accessible = true }: { variant: "frame" | "tile" | "thumb"; accessible?: boolean }) {
  return (
    <View
      style={[styles.base, styles[variant]]}
      accessible={accessible}
      accessibilityRole={accessible ? "image" : undefined}
      accessibilityLabel={accessible ? t.common.imageUnavailable : undefined}
      testID="image-indisponible"
    >
      <ImageOffIcon size={variant === "frame" ? 32 : 22} tint={color.acierSurPlinthe} />
      {variant === "thumb" ? null : (
        <Text style={[styles.label, variant === "tile" ? styles.labelTile : null]} numberOfLines={2}>
          {t.common.imageUnavailable}
        </Text>
      )}
    </View>
  );
}

const styles = themedStyles(() => ({
  base: { backgroundColor: color.plinthe, alignItems: "center", justifyContent: "center", gap: space.sm, overflow: "hidden" },
  // Mêmes dimensions que le cadre d'une pièce (components/product-frame.tsx).
  frame: { width: "100%", maxWidth: 360, aspectRatio: 4 / 5, alignSelf: "center", borderRadius: radius.sm },
  tile: { width: "100%", height: "100%", padding: space.xs, gap: space.xs },
  thumb: { width: "100%", height: "100%" },
  // Texte exceptionnel sur le fond des pièces : la teinte prévue pour lui (AA).
  label: { fontSize: font.secondary, color: color.acierSurPlinthe, textAlign: "center", paddingHorizontal: space.sm },
  labelTile: { fontSize: font.caption, paddingHorizontal: 0 },
}));
