import { useEffect } from "react";
import { WebView } from "react-native-webview";
import { PUBLIC_WEB_URL } from "@/constants/brand";
import { httpsOrigin, isRobotPageUrl, parseRobotMessage, robotCheckNavigationAllowed, robotCheckPageUrl, type RobotMessage } from "@/lib/robot-check";

// iPhone : la page hôte du widget, chargée depuis le site (https uniquement)
// dans une vue web. Garde-fous :
// - toute navigation passe par robotCheckNavigationAllowed : la page hôte en
//   haut, le widget de Cloudflare dans son cadre, rien d'autre. La liste
//   d'origines vaut « * » exprès : avec une liste plus courte,
//   react-native-webview confierait les autres adresses à iOS, qui les
//   ouvrirait hors de l'app ; ici elles sont simplement refusées ;
// - seuls comptent les messages envoyés par la page hôte elle-même (adresse
//   du cadre émetteur), et de la forme exacte attendue.
const SITE_ORIGIN = httpsOrigin(PUBLIC_WEB_URL);

export function RobotCheckFrame({ siteKey, locale, title, onMessage }: { siteKey: string; locale: string; title: string; onMessage: (message: RobotMessage) => void }) {
  // Adresse du site absente ou pas en https : vérification impossible, dite à l'écran.
  useEffect(() => {
    if (SITE_ORIGIN === null) onMessage({ type: "error" });
  }, [onMessage]);
  if (SITE_ORIGIN === null) return null;
  const siteOrigin = SITE_ORIGIN;
  return (
    <WebView
      source={{ uri: robotCheckPageUrl(siteOrigin, siteKey, locale) }}
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={(request) => robotCheckNavigationAllowed(request, siteOrigin)}
      onMessage={(event) => {
        if (!isRobotPageUrl(event.nativeEvent.url, siteOrigin)) return;
        const message = parseRobotMessage(event.nativeEvent.data);
        if (message) onMessage(message);
      }}
      onError={() => onMessage({ type: "error" })}
      onHttpError={() => onMessage({ type: "error" })}
      accessibilityLabel={title}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      allowsBackForwardNavigationGestures={false}
      dataDetectorTypes="none"
      allowFileAccess={false}
      mixedContentMode="never"
      scrollEnabled={false}
      bounces={false}
      style={{ width: 300, height: 65, backgroundColor: "transparent" }}
      containerStyle={{ flexGrow: 0, flexShrink: 0, width: 300, height: 65 }}
    />
  );
}
