import { useState } from "react";
import { StyleSheet, View, type ImageStyle, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { SpotImage, type ImageNaturalSize } from "@/components/spot-image";
import { EnlargeableImage, type ZoomState } from "@/components/image-viewer";
import { edgeBackground, fillsTile, honestSize, type PieceImageSize, type PieceTileVariant } from "@/lib/piece-image";
import { color, getActiveScheme, radius } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

export type { PieceTileVariant } from "@/lib/piece-image";

// La tuile de pièce de toute l'app, direction « Écrin » (retours du build 3,
// 26 novembre 2026 : « des arrondis très légers mais qui font la
// différence », « partout où on affiche les pièces »). Une seule forme :
// 4:5, coins doux en courbe continue, plus aucune bande. La photo entière
// est posée sur une copie floue et agrandie d'elle-même (la vignette légère,
// déjà en cache), pour que toute bande prenne le fond de la photo ; une
// photo presque 4:5 remplit simplement la tuile (lib/piece-image.ts,
// fillsTile). Grande image (« hero ») : une petite image n'est jamais
// étirée au-delà d'un point par pixel ; grille (« grid ») : la pièce remplit
// toujours sa tuile. Thème clair seulement : un filet très fin, pour qu'une
// photo sur fond blanc ne se fonde pas dans la page. `edgeColor` (lot
// « couleur des bords », plus tard ; rien ne le fournit encore) : une
// couleur unie « #RRGGBB » à la place de la copie floue.
//
// Plan B si le flou est trop lent dans une longue grille (essai sur
// l'iPhone) : remplacer le fond flou par un fond uni — une ligne.
export function PieceTile({
  hdUri,
  fallbackUri,
  variant,
  size,
  accessibilityLabel,
  recyclingKey,
  enlargeable = false,
  onZoomStateChange,
  fullResolution = false,
  edgeColor,
  style,
  onLayout,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  /** « hero » : grandes images (rayon 14) ; « grid » : grilles (rayon 10). */
  variant: PieceTileVariant;
  /** Passé à SpotImage (« card » dans les grilles). */
  size?: PieceImageSize;
  /** Absent : l'image n'est pas lue séparément (cases qui portent déjà leur libellé). */
  accessibilityLabel?: string;
  recyclingKey?: string;
  /** Grandes images des fiches : zoom à deux doigts sur place (iPhone), plein écran au clic (site) ou par VoiceOver
   * (EnlargeableImage, qui enveloppe alors la tuile entière). */
  enlargeable?: boolean;
  /** Agrandissable seulement : l'écran bloque son défilement pendant « zooming ». */
  onZoomStateChange?: (state: ZoomState) => void;
  /** L'unique grande image zoomable de l'écran seulement (envie, Vault, grande carte) : décodée en entier, nette au zoom.
   * Jamais dans les grilles (mémoire). */
  fullResolution?: boolean;
  /** Couleur des bords mesurée par le serveur, « #RRGGBB » ; rien ne la fournit encore. */
  edgeColor?: string | null;
  /** Largeur, maxWidth, marges propres à l'écran. */
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ uri: string; size: ImageNaturalSize } | null>(null);
  const imageKey = `${fallbackUri}\n${hdUri ?? ""}`;
  // Une autre pièce (liste qui réutilise ses éléments) repart de zéro.
  const naturalSize = natural?.uri === imageKey ? natural.size : null;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    onLayout?.(event);
  };
  // Agrandissable : la mesure de l'écran (onLayout) est celle de l'enveloppe, posée dans la page.
  const handleTileLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
  };

  const background = edgeBackground(edgeColor);
  // Taille inconnue : contenue sur toute la tuile ; sinon remplie, ou une
  // boîte centrée à la taille honnête.
  let foreground: { style: StyleProp<ImageStyle>; fit: "contain" | "cover" } = { style: StyleSheet.absoluteFill, fit: "contain" };
  if (naturalSize && frame.width > 0 && frame.height > 0) {
    if (fillsTile(naturalSize, frame, variant)) foreground = { style: StyleSheet.absoluteFill, fit: "cover" };
    else {
      const shown = honestSize(naturalSize, frame, variant);
      foreground = {
        style: { position: "absolute", width: shown.width, height: shown.height, left: (frame.width - shown.width) / 2, top: (frame.height - shown.height) / 2 },
        fit: "contain",
      };
    }
  }

  const image = (
    <SpotImage
      hdUri={hdUri}
      fallbackUri={fallbackUri}
      size={size}
      fullResolution={fullResolution}
      fit={foreground.fit}
      style={foreground.style}
      // Agrandissable : le libellé est porté par le bouton qui l'entoure (lu une seule fois).
      accessibilityLabel={enlargeable ? undefined : accessibilityLabel}
      recyclingKey={recyclingKey}
      onImageSize={(measured) => setNatural({ uri: imageKey, size: measured })}
    />
  );

  const tileView = (
    <View
      style={[variant === "hero" ? styles.hero : styles.grid, enlargeable ? null : style]}
      onLayout={enlargeable ? handleTileLayout : handleLayout}
    >
      {background ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} accessible={false} importantForAccessibility="no-hide-descendants" />
      ) : (
        <Image
          source={{ uri: fallbackUri }}
          contentFit="cover"
          blurRadius={24}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          accessible={false}
          style={styles.blur}
        />
      )}
      {image}
    </View>
  );

  if (!enlargeable) return tileView;
  // Retours du build 3 (zoom à deux doigts sur place) : l'enveloppe de zoom
  // entoure la tuile ENTIÈRE (fond, coins et coupe compris) : toute la carte
  // arrondie grandit sous les doigts. Le style de l'écran et sa mesure vont
  // à l'enveloppe, qui est le cadre posé dans la page.
  return (
    <EnlargeableImage
      hdUri={hdUri}
      fallbackUri={fallbackUri}
      label={accessibilityLabel ?? ""}
      style={[styles.zoomFrame, style]}
      onLayout={onLayout}
      onZoomStateChange={onZoomStateChange}
    >
      {tileView}
    </EnlargeableImage>
  );
}

const tile = (rounded: number): ViewStyle => ({
  width: "100%",
  aspectRatio: 4 / 5,
  overflow: "hidden",
  borderRadius: rounded,
  borderCurve: "continuous",
  // Pendant le chargement, et si le fond flou échoue : la plinthe.
  backgroundColor: color.plinthe,
  padding: 0,
  // Thème clair seulement : un filet très fin (aucun en sombre).
  borderWidth: getActiveScheme() === "light" ? StyleSheet.hairlineWidth : 0,
  borderColor: color.filet,
});

const styles = themedStyles(() => ({
  hero: tile(radius.piece),
  grid: tile(radius.pieceGrid),
  // Enveloppe de zoom (agrandissable) : aussi large que la tuile le serait seule.
  zoomFrame: { width: "100%" },
  // Agrandie pour cacher les bords transparents du flou.
  blur: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, transform: [{ scale: 1.2 }] },
}));
