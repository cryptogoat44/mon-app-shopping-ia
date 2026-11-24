import { useState } from "react";
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { imageAfterErrors, imageSources, twoStepLayers, twoStepSources, type PieceImageSize, type TwoStepState } from "@/lib/piece-image";

// Image d'une proposition. Grande carte et fiches (« large », par défaut) :
// l'originale du marchand (haute définition) en priorité, et la petite
// vignette de Google si elle ne se charge pas — certains marchands bloquent
// l'affichage de leurs images hors de leur site (constaté : refus 403).
// Depuis les retours du build 2, « large » charge en deux temps comme
// « card » quand les deux images existent (TwoStepImage) ; avec une seule
// image, rien ne change.
// Petite case (« small ») : la vignette légère d'abord, l'originale seulement
// en repli (lot résultats lisibles, lib/piece-image.ts). « Contenue » par
// défaut (jamais rognée ni déformée) ; « cover » pour les grilles carrées
// (Vault, Envies, récentes). Pendant le chargement, le fond du cadre
// (plinthe) suffit : une vignette d'attente restait superposée à l'image
// finale sur le web. Carte des résultats (« card ») : deux temps, voir
// TwoStepImage (« large » aussi, et les grilles des Envies et du Vault).
export function SpotImage({
  hdUri,
  fallbackUri,
  style,
  accessibilityLabel,
  fit = "contain",
  recyclingKey,
  size = "large",
}: {
  hdUri?: string | null;
  /** Vignette légère (Google, ou image déjà réduite) : en premier dans une
   * petite case, en repli ailleurs. */
  fallbackUri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  fit?: "contain" | "cover";
  /** Dans une liste : évite d'afficher un instant l'image d'une autre
   * ligne quand la liste réutilise ses éléments. */
  recyclingKey?: string;
  size?: PieceImageSize;
}) {
  const twoStep = twoStepSources(size, hdUri, fallbackUri);
  if (twoStep) return <TwoStepImage {...twoStep} style={style} fit={fit} accessibilityLabel={accessibilityLabel} recyclingKey={recyclingKey} />;
  return <OneImage hdUri={hdUri} fallbackUri={fallbackUri} style={style} fit={fit} accessibilityLabel={accessibilityLabel} recyclingKey={recyclingKey} size={size} />;
}

/** Deux temps : la vignette tout de suite, l'originale par-dessus, en fondu,
 * dès qu'elle est arrivée (la vignette est alors retirée) ; originale bloquée
 * par le marchand, ou plus étroite que la vignette (retours du build 2) : la
 * vignette reste (lib/piece-image.ts, twoStepLayers). Deux images empilées
 * plutôt que la « placeholder » d'expo-image, restée superposée à l'image
 * finale sur le web. Les largeurs viennent d'onLoad (source.width, aussi sur
 * le site : largeur naturelle de l'image). */
function TwoStepImage({
  thumb,
  hd,
  style,
  fit,
  accessibilityLabel,
  recyclingKey,
}: {
  thumb: string;
  hd: string;
  style?: StyleProp<ImageStyle>;
  fit: "contain" | "cover";
  accessibilityLabel?: string;
  recyclingKey?: string;
}) {
  const key = `${thumb}\n${hd}`;
  const fresh: TwoStepState & { key: string } = { key, hd: "loading", hdWidth: null, thumbLoaded: false, thumbWidth: null, thumbFailed: false };
  const [state, setState] = useState(fresh);
  // Une autre carte (liste qui réutilise ses éléments) repart de zéro.
  const current = state.key === key ? state : fresh;
  const update = (patch: Partial<TwoStepState>) => setState((previous) => ({ ...(previous.key === key ? previous : fresh), ...patch }));
  const { showThumb, showHd } = twoStepLayers(current);
  return (
    <View style={style as StyleProp<ViewStyle>} accessible={Boolean(accessibilityLabel)} accessibilityRole={accessibilityLabel ? "image" : undefined} accessibilityLabel={accessibilityLabel}>
      {showThumb ? (
        <Image
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          onLoad={(event) => update({ thumbLoaded: true, thumbWidth: event.source?.width ?? null })}
          onError={() => update({ thumbFailed: true })}
        />
      ) : null}
      {showHd ? (
        <Image
          source={{ uri: hd }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          transition={180}
          onLoad={(event) => update({ hd: "loaded", hdWidth: event.source?.width ?? null })}
          onError={() => update({ hd: "failed" })}
        />
      ) : null}
    </View>
  );
}

/** Une seule image à la fois : la première adresse, la suivante en cas d'erreur. */
function OneImage({
  hdUri,
  fallbackUri,
  style,
  accessibilityLabel,
  fit,
  recyclingKey,
  size,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  fit: "contain" | "cover";
  recyclingKey?: string;
  size: PieceImageSize;
}) {
  const sources = imageSources(size, hdUri, fallbackUri);
  const key = sources.join("\n");
  // Échecs comptés pour ces adresses-là : une autre image repart de la
  // première dès son premier affichage, sans repasser par l'ancien repli.
  const [errors, setErrors] = useState({ key, count: 0 });
  const uri = imageAfterErrors(sources, errors.key === key ? errors.count : 0);

  return (
    <Image
      source={uri ? { uri } : null}
      style={style}
      contentFit={fit}
      // Garde les images déjà vues en mémoire et sur le disque : revenir en
      // arrière dans le fil ne les recharge pas.
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey}
      onError={() => setErrors((previous) => ({ key, count: (previous.key === key ? previous.count : 0) + 1 }))}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
