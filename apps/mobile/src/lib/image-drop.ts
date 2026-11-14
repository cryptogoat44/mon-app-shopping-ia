// Image glissée-déposée ou collée (mission « liens vidéo ») : sur le site
// seulement (image-drop.web.ts). Sur l'app iPhone, rien : la photo arrive par
// le sélecteur, la feuille de partage ou la recherche d'image d'iOS.
import type { ImportResult } from "./image-import";

export function useImageDrop(_onImage: (result: ImportResult) => void, _onRefused: () => void): void {}
