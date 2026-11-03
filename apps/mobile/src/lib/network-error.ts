// Réseau absent ou coupé pendant un appel au serveur. Sur le site, fetch
// échoue avec une TypeError ; sur iPhone, Expo remplace fetch (expo/fetch)
// et l'échec arrive en simple Error dont le message commence par « fetch
// failed » (« fetch failed: The Internet connection appears to be
// offline. », dans la langue de l'appareil). Un abandon volontaire (signal)
// passe aussi par là sur iPhone : pour un appel qu'on peut abandonner, le
// vérifier avant. Le format d'expo/fetch est épinglé par
// tests/network-error.test.ts. Imports relatifs : fichier testé par vitest.
const EXPO_FETCH_FAILED = "fetch failed";

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return error instanceof Error && error.message.startsWith(EXPO_FETCH_FAILED);
}
