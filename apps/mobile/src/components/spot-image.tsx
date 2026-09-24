import { useEffect, useState } from "react";
import type { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";

// Image d'une proposition : l'originale du marchand (haute définition) en
// priorité, et la petite vignette de Google si elle ne se charge pas —
// certains marchands bloquent l'affichage de leurs images hors de leur site
// (constaté : refus 403). Toujours « contenue » : jamais rognée ni déformée.
export function SpotImage({
  hdUri,
  fallbackUri,
  style,
  accessibilityLabel,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const [useFallback, setUseFallback] = useState(!hdUri);

  useEffect(() => {
    setUseFallback(!hdUri);
  }, [hdUri]);

  return (
    <Image
      source={{ uri: useFallback || !hdUri ? fallbackUri : hdUri }}
      placeholder={{ uri: fallbackUri }}
      style={style}
      contentFit="contain"
      transition={180}
      onError={() => setUseFallback(true)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
