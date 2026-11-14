// Lecteur officiel TikTok ou Instagram dans une vue web (mission « liens
// vidéo », app iPhone). La page hôte est écrite par l'app
// (lib/player-host-page.ts) ; rien n'est posé sur le lecteur, masqué ni
// modifié. Réglages vérifiés dans react-native-webview 13.16.1. Seul fichier
// de l'app qui importe la vue web ; version site : embedded-player.web.tsx
// (rien : jamais de lecteur sur le site).
import type { RefObject } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { color } from "@/theme/tokens";
import { isAllowedNavigation, sameDocument } from "@/lib/player-link";
import { parseHostMessage, type HostMessage } from "@/lib/player-state";
import { themedStyles } from "@/theme/themed-styles";

export interface EmbeddedPlayerProps {
  /** Page hôte complète (lib/player-host-page.ts). */
  html: string;
  /** Origine de la page hôte (lib/player-link.ts, playerBaseUrl). */
  baseUrl: string;
  width: number;
  height: number;
  /** Code d'intégration plus haut que la place : on le laisse défiler. */
  scrollable: boolean;
  webRef: RefObject<WebView | null>;
  /** Conteneur natif de la vue web : son numéro sert à l'instantané (lib/player-snapshot.ts). */
  frameRef: RefObject<View | null>;
  onMessage: (message: HostMessage) => void;
  /** Un lien du lecteur voulait quitter la page : rien ne s'ouvre, l'écran propose d'ouvrir l'app. */
  onLeave: () => void;
  /** La page hôte n'a pas pu se charger (la page d'erreur anglaise de la vue web n'est jamais montrée). */
  onLoadFailure: () => void;
  onCrash: () => void;
}

export function EmbeddedPlayer(p: EmbeddedPlayerProps) {
  function handleMessage(event: WebViewMessageEvent) {
    // Seule la page hôte parle à l'app : le pont n'existe que dans le cadre
    // principal ; un cadre tiers qui appellerait window.webkit.messageHandlers
    // est écarté par son adresse (nativeEvent.url = cadre émetteur).
    if (!sameDocument(event.nativeEvent.url, p.baseUrl)) return;
    const message = parseHostMessage(event.nativeEvent.data);
    if (message) p.onMessage(message);
  }

  function handleRequest(request: ShouldStartLoadRequest): boolean {
    const allowed = isAllowedNavigation(request, [p.baseUrl]);
    if (!allowed && request.isTopFrame && request.navigationType === "click") p.onLeave();
    if (!allowed && __DEV__) console.info("[player] navigation refused", request.url);
    return allowed;
  }

  return (
    <View ref={p.frameRef} collapsable={false} style={[styles.frame, { width: p.width, height: p.height }]}>
      <WebView
        ref={p.webRef}
        source={{ html: p.html, baseUrl: p.baseUrl }}
        style={styles.web}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={handleRequest}
        onOpenWindow={p.onLeave}
        javaScriptCanOpenWindowsAutomatically={false}
        onMessage={handleMessage}
        onError={(event) => {
          // Sans preventDefault, la vue web remplace la page par « Error loading page ».
          event.preventDefault();
          p.onLoadFailure();
        }}
        onContentProcessDidTerminate={p.onCrash}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsPictureInPictureMediaPlayback={false}
        allowsAirPlayForMediaPlayback={false}
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        incognito
        sharedCookiesEnabled={false}
        scrollEnabled={p.scrollable}
        bounces={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        dataDetectorTypes="none"
        textInteractionEnabled={false}
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { backgroundColor: color.nuit, overflow: "hidden" },
  web: { flex: 1, backgroundColor: color.nuit },
}));
