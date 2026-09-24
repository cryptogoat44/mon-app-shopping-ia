// Pastille de l'onglet « Activité » (Lot F) : l'écran Activité prévient la
// barre de navigation dès qu'il a tout marqué comme lu.
const listeners = new Set<() => void>();

export function onUnreadChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function unreadChanged(): void {
  for (const listener of listeners) listener();
}
