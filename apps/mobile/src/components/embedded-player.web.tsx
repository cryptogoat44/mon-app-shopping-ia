// Site : aucun lecteur intégré (le site garde son comportement). Ce fichier
// n'importe jamais react-native-webview : sur le site, la 13.16.1 n'affiche
// qu'un texte d'erreur (src/WebView.tsx, note R4 §1.4).
import type { EmbeddedPlayerProps, ShortLinkResolver as NativeResolver } from "./embedded-player";

export function EmbeddedPlayer(_props: EmbeddedPlayerProps) {
  return null;
}

export function ShortLinkResolver(_props: Parameters<typeof NativeResolver>[0]) {
  return null;
}
