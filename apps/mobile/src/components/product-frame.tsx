import { PieceTile } from "@/components/piece-tile";
import type { ZoomState } from "@/components/image-viewer";
import { size } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Cadre de l'image d'une pièce (décision du fondateur, lot 5 : « image
// entière, cadre 4:5 ») : depuis les retours du build 3 (« Écrin »), une
// simple grande tuile de pièce (components/piece-tile.tsx : coins doux,
// photo entière entourée de ses bords prolongés, plus aucune bande), aussi
// large que le texte (size.contentMaxWidth). Partagé par l'écran d'une envie
// et les publications qui montrent une pièce (envie republiée, « achat »
// venu du Spotter : lib/post-media.ts), pour qu'ils restent identiques.
// `enlargeable` (fiche d'une envie seulement) : depuis les retours du
// build 3, on pince l'image sur place à deux doigts sur iPhone, elle revient
// au relâché ; plein écran au clic sur le site et par VoiceOver
// (components/image-viewer.tsx) ; jamais dans le fil. `onZoomStateChange` et
// `fullResolution` sont seulement transmis à la tuile.
export function ProductFrame({
  hdUri,
  fallbackUri,
  accessibilityLabel,
  recyclingKey,
  enlargeable = false,
  onZoomStateChange,
  fullResolution = false,
  edgeColor,
}: {
  hdUri?: string | null;
  fallbackUri: string;
  accessibilityLabel?: string;
  /** Dans une liste (fil) : voir SpotImage. */
  recyclingKey?: string;
  enlargeable?: boolean;
  /** Agrandissable seulement : l'écran bloque son défilement pendant « zooming ». */
  onZoomStateChange?: (state: ZoomState) => void;
  /** La grande image de la fiche d'une envie seulement : décodée en entier, nette au zoom. */
  fullResolution?: boolean;
  /** Couleur des bords mesurée par le serveur (lot « couleur des bords ») : voir PieceTile. */
  edgeColor?: string | null;
}) {
  return (
    <PieceTile
      variant="hero"
      hdUri={hdUri}
      fallbackUri={fallbackUri}
      accessibilityLabel={accessibilityLabel}
      recyclingKey={recyclingKey}
      enlargeable={enlargeable}
      onZoomStateChange={onZoomStateChange}
      fullResolution={fullResolution}
      edgeColor={edgeColor}
      style={styles.frame}
    />
  );
}

const styles = themedStyles(() => ({
  frame: { maxWidth: size.contentMaxWidth, alignSelf: "center" },
}));
