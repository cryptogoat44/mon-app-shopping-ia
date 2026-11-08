// Lecteur officiel TikTok ou Instagram dans une vue web (lot « lecteur
// intégré », app iPhone). Réglages vérifiés dans react-native-webview 13.16.1
// (notes R1 §5, R2 §3.3, R4 §1.2). Seul fichier de l'app qui importe la vue
// web ; version site : embedded-player.web.tsx (rien).
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { color } from "@/theme/tokens";
import { instagramHostPage, tiktokEmbedHostPage, tiktokHostPage } from "@/lib/player-host-page";
import { PLAYER_NETWORK, isAllowedNavigation, sameDocument, shortLinkHop, type PlayerEmbed, type PlayerPlatform } from "@/lib/player-link";
import { parseHostMessage, type HostMessage } from "@/lib/player-state";
import { themedStyles } from "@/theme/themed-styles";

export interface EmbeddedPlayerProps {
  embed: PlayerEmbed;
  /** Titre du cadre, lu par VoiceOver (« Vidéo TikTok »). */
  title: string;
  /** Origine de la page hôte (lib/player-link.ts, playerBaseUrl). */
  baseUrl: string;
  width: number;
  height: number;
  /** Code d'intégration plus haut que la place : on le laisse défiler. */
  scrollable: boolean;
  webRef: RefObject<WebView | null>;
  /** Conteneur natif retrouvé par le module de capture (findNodeHandle). */
  frameRef: RefObject<View | null>;
  onMessage: (message: HostMessage) => void;
  /** Un lien du lecteur voulait quitter la page : rien ne s'ouvre, l'écran propose d'ouvrir l'app. */
  onLeave: () => void;
  /** La page hôte n'a pas pu se charger (la page d'erreur anglaise de la vue web n'est jamais montrée). */
  onLoadFailure: () => void;
  onCrash: () => void;
  /** Encarts posés sur le lecteur, ancrés en bas (contre-expertise n° 1). */
  children?: ReactNode;
}

/** Page hôte écrite par l'app seule, depuis l'identifiant ou l'adresse vérifiés (jamais le html d'un oEmbed). */
function hostPage(embed: PlayerEmbed, title: string): string {
  if (embed.platform === "instagram") return instagramHostPage(embed.canonical, title);
  return embed.variant === "player" ? tiktokHostPage(embed.playerUrl, title) : tiktokEmbedHostPage(embed.id, title);
}

export function EmbeddedPlayer(p: EmbeddedPlayerProps) {
  const html = hostPage(p.embed, p.title);

  function handleMessage(event: WebViewMessageEvent) {
    // Seule la page hôte parle à l'app : le pont n'existe que dans le cadre
    // principal (RNCWebViewImpl.m l.1774-1790) ; un cadre tiers qui appellerait
    // window.webkit.messageHandlers est écarté par son adresse
    // (nativeEvent.url = cadre émetteur, RNCWebViewImpl.m l.784-792).
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
        source={{ html, baseUrl: p.baseUrl }}
        style={styles.web}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={handleRequest}
        onOpenWindow={p.onLeave}
        javaScriptCanOpenWindowsAutomatically={false}
        onMessage={handleMessage}
        onError={(event) => {
          // Sans preventDefault, la vue web remplace la page par « Error loading page » (WebViewShared.tsx l.165-178).
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
      {p.children ? (
        <View style={styles.overlay} pointerEvents="box-none">
          {p.children}
        </View>
      ) : null}
    </View>
  );
}

/** Second suivi d'un lien court (contre-expertise n° 4b) : vue web cachée,
 * sans cookie gardé ; la première navigation principale vers une vidéo de la
 * plateforme attendue est lue puis arrêtée (l'autre plateforme est refusée).
 * Rien ne s'affiche ; 6 s au plus. */
export function ShortLinkResolver({
  url,
  platform,
  onResolved,
  onFailed,
}: {
  url: string;
  platform: PlayerPlatform;
  onResolved: (url: string) => void;
  onFailed: () => void;
}) {
  const done = useRef(false);
  const finish = useRef({ onResolved, onFailed });
  finish.current = { onResolved, onFailed };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (done.current) return;
      done.current = true;
      finish.current.onFailed();
    }, PLAYER_NETWORK.resolveTimeoutMs);
    return () => clearTimeout(timer);
  }, []);

  function handleRequest(request: ShouldStartLoadRequest): boolean {
    if (!request.isTopFrame) return false;
    const hop = shortLinkHop(request.url, platform);
    if (hop === "resolved" && !done.current) {
      done.current = true;
      finish.current.onResolved(request.url);
    }
    return hop === "follow" && !done.current;
  }

  return (
    <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <WebView
        source={{ uri: url }}
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={handleRequest}
        onOpenWindow={() => {}}
        javaScriptCanOpenWindowsAutomatically={false}
        onError={(event) => event.preventDefault()}
        mediaPlaybackRequiresUserAction
        allowsLinkPreview={false}
        incognito
        sharedCookiesEnabled={false}
        dataDetectorTypes="none"
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  frame: { backgroundColor: color.nuit, overflow: "hidden" },
  web: { flex: 1, backgroundColor: color.nuit },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end", padding: 8 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, top: 0 },
}));
