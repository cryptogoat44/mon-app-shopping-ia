// Site : la recherche d'image d'iOS n'ouvre jamais un navigateur, rien à
// recevoir. Version app iPhone : visual-search-intake.ts.
export function useVisualSearchIntake(): void {}

/** Site : aucune capture de la recherche d'image, l'image reste où elle est. */
export async function moveIntoCaptureCache(uri: string): Promise<string> {
  return uri;
}
