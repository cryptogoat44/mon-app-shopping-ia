import { useEffect, useState } from "react";
import type { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";

// Image d'une proposition : l'originale du marchand (haute définition) en
// priorité, et la petite vignette de Google si elle ne se charge pas —
// certains marchands bloquent l'affichage de leurs images hors de leur site
// (constaté : refus 403). « Contenue » par défaut (jamais rognée ni
// déformée) ; « cover » pour les grilles carrées (Vault, Envies, récentes).
// Pendant le chargement, le fond du cadre (plinthe) suffit : une vignette
// d'attente restait superposée à l'image finale sur le web.
export function SpotImage({
  hdUri,
  fallbackUri,
  style,
  accessibilityLabel,
  fit = "contain",
  recyclingKey,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  fit?: "contain" | "cover";
  /** Dans une liste : évite d'afficher un instant l'image d'une autre
   * ligne quand la liste réutilise ses éléments. */
  recyclingKey?: string;
}) {
  const [useFallback, setUseFallback] = useState(!hdUri);

  useEffect(() => {
    setUseFallback(!hdUri);
  }, [hdUri]);

  return (
    <Image
      source={{ uri: useFallback || !hdUri ? fallbackUri : hdUri }}
      style={style}
      contentFit={fit}
      // Garde les images déjà vues en mémoire et sur le disque : revenir en
      // arrière dans le fil ne les recharge pas.
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey}
      onError={() => setUseFallback(true)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
