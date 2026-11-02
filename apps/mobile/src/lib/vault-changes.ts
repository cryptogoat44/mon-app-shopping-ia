// Lot 2 (Vault) : une pièce ajoutée ou modifiée prévient le profil dès que
// l'envoi aboutit. Utile quand le profil a déjà repris la main avant la fin
// de l'envoi (retour du navigateur pendant « Ajout en cours… », « ‹ Vault »
// pendant « Enregistrement… ») : il a relu son Vault trop tôt et le relit.
const listeners = new Set<() => void>();

export function onVaultChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function vaultChanged(): void {
  for (const listener of listeners) listener();
}
