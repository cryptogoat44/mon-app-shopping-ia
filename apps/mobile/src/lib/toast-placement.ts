// Place du message flottant (toast-context.tsx). Logique pure, testée.

/** Hauteur habituelle : au-dessus de la barre d'onglets. */
export const TOAST_BOTTOM = 110;
// Écart laissé au-dessus du clavier.
const ABOVE_KEYBOARD = 16;

/** Clavier ouvert (iPhone) : le message passe juste au-dessus, sinon le clavier
 * le cacherait. Une simple barre (clavier physique branché) ne change rien. */
export function toastBottom(keyboardHeight: number): number {
  if (!(keyboardHeight > 0)) return TOAST_BOTTOM;
  return Math.max(TOAST_BOTTOM, keyboardHeight + ABOVE_KEYBOARD);
}
