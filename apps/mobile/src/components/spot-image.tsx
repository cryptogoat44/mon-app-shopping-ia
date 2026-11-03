import { useState } from "react";
import type { StyleProp, ImageStyle } from "react-native";
import { Image } from "expo-image";
import { imageAfterErrors, imageSources, type PieceImageSize } from "@/lib/piece-image";

// Image d'une proposition. Grande carte et fiches (« large », par défaut) :
// l'originale du marchand (haute définition) en priorité, et la petite
// vignette de Google si elle ne se charge pas — certains marchands bloquent
// l'affichage de leurs images hors de leur site (constaté : refus 403).
// Petite case (« small ») : la vignette légère d'abord, l'originale seulement
// en repli (lot résultats lisibles, lib/piece-image.ts). « Contenue » par
// défaut (jamais rognée ni déformée) ; « cover » pour les grilles carrées
// (Vault, Envies, récentes). Pendant le chargement, le fond du cadre
// (plinthe) suffit : une vignette d'attente restait superposée à l'image
// finale sur le web.
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
