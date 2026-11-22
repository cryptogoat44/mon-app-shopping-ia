// Parcours 3 : l'état du message sous la grande carte (components/kept-notice.tsx),
// propre à chaque pièce sans remonter le message quand la grande carte passe
// d'une pièce gardée à une autre (une remontée le faisait relire par
// VoiceOver). Logique pure (tests/achat-et-alerte.test.ts).

/** « Couper l'alerte » : en cours ou en échec, pour la pièce `pieceId` seulement. */
export interface TurnOffState {
  pieceId: string | null;
  busy: boolean;
  failed: boolean;
}

export const TURN_OFF_IDLE: TurnOffState = { pieceId: null, busy: false, failed: false };

/** Ce que voit la pièce affichée : l'état d'une autre pièce ne la suit jamais. */
export function turnOffStateFor(state: TurnOffState, pieceId: string): { busy: boolean; failed: boolean } {
  return state.pieceId === pieceId ? { busy: state.busy, failed: state.failed } : { busy: false, failed: false };
}

/** Toucher « Couper l'alerte » sous la pièce `pieceId`. */
export function turnOffStarted(pieceId: string): TurnOffState {
  return { pieceId, busy: true, failed: false };
}

/** La réponse pour la pièce `pieceId` : ignorée si une autre pièce a lancé
 * la sienne entre-temps (son état n'est pas écrasé). */
export function turnOffFinished(state: TurnOffState, pieceId: string, off: boolean): TurnOffState {
  return state.pieceId === pieceId ? { pieceId, busy: false, failed: !off } : state;
}

/** Ce qui a déjà été annoncé : la pièce et le texte. */
export interface AnnouncedNotice {
  pieceId: string;
  text: string;
}

/** Annonce sur iPhone : à l'apparition du message (pièce gardée), puis quand
 * le texte change pour la même pièce (alerte coupée). Jamais quand la grande
 * carte passe à une autre pièce gardée : le message reste le même message. */
export function keptNoticeAnnounces(previous: AnnouncedNotice | null, next: AnnouncedNotice): boolean {
  if (!previous) return true;
  return previous.pieceId === next.pieceId && previous.text !== next.text;
}
