import { useEffect, useRef, useState } from "react";
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
  fullResolution = false,
  onImageSize,
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
  /** Plein écran avec zoom seulement : l'image est décodée en entier, sans
   * être réduite à la taille du cadre (iPhone, allowDownscaling d'expo-image),
   * pour que le zoom montre les vrais détails. Les fiches et grilles gardent
   * la réduction (mémoire). */
  fullResolution?: boolean;
  /** Taille naturelle (pixels) de l'image réellement affichée : la vignette,
   * puis l'originale si elle la remplace (tuile de pièce, piece-tile.tsx). */
  onImageSize?: (size: ImageNaturalSize) => void;
}) {
  const twoStep = twoStepSources(size, hdUri, fallbackUri);
  if (twoStep) return <TwoStepImage {...twoStep} style={style} fit={fit} accessibilityLabel={accessibilityLabel} recyclingKey={recyclingKey} fullResolution={fullResolution} onImageSize={onImageSize} />;
  return <OneImage hdUri={hdUri} fallbackUri={fallbackUri} style={style} fit={fit} accessibilityLabel={accessibilityLabel} recyclingKey={recyclingKey} size={size} fullResolution={fullResolution} onImageSize={onImageSize} />;
}

export type ImageNaturalSize = { width: number; height: number };

/** Taille naturelle lue dans l'événement onLoad d'expo-image (null si absente). */
function naturalSize(source: { width?: number; height?: number } | undefined): ImageNaturalSize | null {
  return source && source.width && source.height ? { width: source.width, height: source.height } : null;
}

/** Appelle `onImageSize` quand la taille affichée change (une fois par taille). */
function useReportSize(displayed: ImageNaturalSize | null, onImageSize: ((size: ImageNaturalSize) => void) | undefined) {
  const report = useRef(onImageSize);
  report.current = onImageSize;
  const width = displayed?.width ?? 0;
  const height = displayed?.height ?? 0;
  useEffect(() => {
    if (width > 0 && height > 0) report.current?.({ width, height });
  }, [width, height]);
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
  fullResolution,
  onImageSize,
}: {
  thumb: string;
  hd: string;
  style?: StyleProp<ImageStyle>;
  fit: "contain" | "cover";
  accessibilityLabel?: string;
  recyclingKey?: string;
  fullResolution: boolean;
  onImageSize?: (size: ImageNaturalSize) => void;
}) {
  const key = `${thumb}\n${hd}`;
  type Local = TwoStepState & { key: string; hdSize: ImageNaturalSize | null; thumbSize: ImageNaturalSize | null };
  const fresh: Local = { key, hd: "loading", hdWidth: null, thumbLoaded: false, thumbWidth: null, thumbFailed: false, hdSize: null, thumbSize: null };
  const [state, setState] = useState(fresh);
  // Une autre carte (liste qui réutilise ses éléments) repart de zéro.
  const current = state.key === key ? state : fresh;
  const update = (patch: Partial<Local>) => setState((previous) => ({ ...(previous.key === key ? previous : fresh), ...patch }));
  const { showThumb, showHd } = twoStepLayers(current);
  // L'image du dessus : l'originale arrivée et gardée, sinon la vignette.
  useReportSize(showHd && current.hd === "loaded" ? current.hdSize : showThumb ? current.thumbSize : null, onImageSize);
  return (
    <View style={style as StyleProp<ViewStyle>} accessible={Boolean(accessibilityLabel)} accessibilityRole={accessibilityLabel ? "image" : undefined} accessibilityLabel={accessibilityLabel}>
      {showThumb ? (
        <Image
          source={{ uri: thumb }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory-disk"
          recyclingKey={recyclingKey}
          allowDownscaling={!fullResolution}
          onLoad={(event) => update({ thumbLoaded: true, thumbWidth: event.source?.width ?? null, thumbSize: naturalSize(event.source) })}
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
          allowDownscaling={!fullResolution}
          onLoad={(event) => update({ hd: "loaded", hdWidth: event.source?.width ?? null, hdSize: naturalSize(event.source) })}
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
  fullResolution,
  onImageSize,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  fit: "contain" | "cover";
  recyclingKey?: string;
  size: PieceImageSize;
  fullResolution: boolean;
  onImageSize?: (size: ImageNaturalSize) => void;
}) {
  const sources = imageSources(size, hdUri, fallbackUri);
  const key = sources.join("\n");
  // Échecs comptés pour ces adresses-là : une autre image repart de la
  // première dès son premier affichage, sans repasser par l'ancien repli.
  const [errors, setErrors] = useState({ key, count: 0 });
  const uri = imageAfterErrors(sources, errors.key === key ? errors.count : 0);
  const [loaded, setLoaded] = useState<{ uri: string | null; size: ImageNaturalSize | null }>({ uri: null, size: null });
  useReportSize(loaded.uri === uri ? loaded.size : null, onImageSize);

  return (
    <Image
      source={uri ? { uri } : null}
      style={style}
      contentFit={fit}
      // Garde les images déjà vues en mémoire et sur le disque : revenir en
      // arrière dans le fil ne les recharge pas.
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey}
      allowDownscaling={!fullResolution}
      // Seulement quand on demande la taille : les autres cases ne se redessinent pas.
      onLoad={onImageSize ? (event) => setLoaded({ uri, size: naturalSize(event.source) }) : undefined}
      onError={() => setErrors((previous) => ({ key, count: (previous.key === key ? previous.count : 0) + 1 }))}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
