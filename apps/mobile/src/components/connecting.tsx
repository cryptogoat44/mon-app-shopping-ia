import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "@/i18n";
import { WAKING_NOTICE_AFTER_MS } from "@/lib/root-route";
import { color, font, serifFont, size, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";

// Attente d'une réponse du serveur : démarrage du site, relances du
// chargement du profil (écran « connexion »). Jamais une page vide (charte,
// règle 1). Au-delà de quelques secondes, un message honnête : le serveur
// gratuit se met en veille sans visite (demande du fondateur, 2026-10-16).

export function ConnectingScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>{children}</View>
    </SafeAreaView>
  );
}

/** « connecting » : les premières secondes ; « waking » : le serveur se
 * réveille ; « failed » : tous les essais ont échoué. */
export function ConnectingNotice({ state }: { state: "connecting" | "waking" | "failed" }) {
  const title = state === "failed" ? t.connection.failedTitle : state === "waking" ? t.connection.wakingTitle : t.connection.connectingTitle;
  const body = state === "failed" ? t.connection.failedBody : state === "waking" ? t.connection.wakingBody : null;
  return (
    <View accessibilityLiveRegion="polite">
      {state === "failed" ? null : <ActivityIndicator color={color.encre} style={styles.spinner} />}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

/** Site, pendant le démarrage (session et profil en cours de lecture). */
export function StartupWaiting() {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaking(true), WAKING_NOTICE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <ConnectingScreen>
      <ConnectingNotice state={waking ? "waking" : "connecting"} />
    </ConnectingScreen>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: color.porcelaine },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl, maxWidth: size.contentMaxWidth, alignSelf: "center", width: "100%" },
  spinner: { alignSelf: "flex-start", marginBottom: space.lg },
  title: { fontFamily: serifFont, fontWeight: "500", fontSize: font.title, color: color.encre, lineHeight: 30 },
  body: { fontSize: font.secondary, color: color.acier, marginTop: space.sm, lineHeight: 21 },
}));
