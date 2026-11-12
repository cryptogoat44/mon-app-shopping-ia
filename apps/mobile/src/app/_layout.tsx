import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, type Theme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { PreferencesProvider } from "@/lib/preferences-context";
import { AnalyticsSession } from "@/components/analytics-session";
import { WebTitle } from "@/components/web-title";
import { NewVersionBanner } from "@/components/new-version-banner";
import { resolveRootRoute, rootContent } from "@/lib/root-route";
import { StartupWaiting } from "@/components/connecting";
import { useShareIntake } from "@/lib/share-intake";
import { useVisualSearchIntake } from "@/lib/visual-search-intake";
import { useSharedItemWaitingNotice } from "@/lib/use-shared-item";
import { useAppFonts } from "@/theme/fonts";
import { useMinimumVersionCheck, useUpdateRequired } from "@/lib/use-app-update";
import { UpdateRequiredScreen } from "@/components/update-required";
import { color, getActiveScheme } from "@/theme/tokens";
import { APP_NAME_DISPLAY } from "@/constants/brand";
// Capture l'adresse d'arrivée (jetons du lien « mot de passe oublié ») avant
// que la navigation ne la réécrive.
import "@/lib/initial-url";
import { initErrorTracking } from "@/lib/error-tracking";
import { EmailConfirmationLanding } from "@/components/email-confirmation-landing";

// Suivi des erreurs (site : lot 2 ; iPhone : lot 3bis) : actif seulement avec une adresse Sentry UE.
initErrorTracking();

SplashScreen.preventAutoHideAsync();

// Couleurs de la navigation (fond des transitions entre écrans) selon le
// thème actif — lot 3.
function navigationTheme(): Theme {
  const base = getActiveScheme() === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: { ...base.colors, background: color.porcelaine, card: color.porcelaine, text: color.encre, border: color.filet, primary: color.vert },
  };
}

function RootNavigator() {
  const { session, profile, profileStatus } = useAuth();
  const pathname = usePathname();
  // La police éditoriale (Newsreader) n'était jamais chargée : tous les
  // titres tombaient dans une police par défaut (audit Lot Q, UX-01). On
  // garde l'écran de démarrage tant qu'elle n'est pas prête — sauf en cas
  // d'échec de chargement, où l'app démarre quand même avec la police de
  // secours plutôt que de rester bloquée.
  const [fontsLoaded, fontError] = useAppFonts();
  const fontsReady = fontsLoaded || fontError !== null;
  const route = fontsReady ? resolveRootRoute({ session, profileStatus, profile }) : "splash";
  // Partage reçu sans être connecté : il s'ouvrira après la connexion, on le dit.
  useSharedItemWaitingNotice(route === "welcome");
  // App iPhone sous le build minimal réglé sur le serveur (lot « app iPhone
  // prête ») : « Mettez à jour Spotto » remplace toute l'app, connecté ou non.
  useMinimumVersionCheck();
  const updateRequired = useUpdateRequired();
  const showUpdate = updateRequired !== null && fontsReady;

  useEffect(() => {
    if (route !== "splash" || showUpdate) SplashScreen.hideAsync();
  }, [route, showUpdate]);

  if (showUpdate) return <UpdateRequiredScreen storeUrl={updateRequired.storeUrl} />;

  // Site : un écran d'attente pendant le démarrage, jamais une page vide ;
  // iPhone : l'écran de démarrage du système reste affiché.
  const content = rootContent(route, pathname, fontsReady, Platform.OS);
  if (content === "native-splash") return null;
  if (content === "waiting") return <StartupWaiting />;

  return (
    <ThemeProvider value={navigationTheme()}>
      {/* Site : « Nouvelle version disponible » en haut, sans rien masquer (lot 4 ter). */}
      <View style={styles.fill}>
        <NewVersionBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={route === "app"}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>

          <Stack.Protected guard={route === "complete-profile"}>
            <Stack.Screen name="complete-profile" />
          </Stack.Protected>

          <Stack.Protected guard={route === "unavailable"}>
            <Stack.Screen name="connexion" />
          </Stack.Protected>

          <Stack.Protected guard={route === "welcome"}>
            <Stack.Screen name="bienvenue" />
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="sign-up" />
            <Stack.Screen name="mot-de-passe-oublie" />
          </Stack.Protected>

          {/* Ouvert depuis l'e-mail de réinitialisation, avec ou sans session. */}
          <Stack.Screen name="nouveau-mot-de-passe" />

          {/* Documents juridiques : lisibles par tous, connecté ou non (bloc 5). */}
          <Stack.Screen name="conditions" />
          <Stack.Screen name="confidentialite" />
          {/* Aide et contact (chantier 3) : lisible par tous, adresse d'assistance de l'App Store. */}
          <Stack.Screen name="aide" />
        </Stack>
      </View>
    </ThemeProvider>
  );
}

/** Feuille de partage d'iOS (lot « partager vers Spotto ») : reçue ici, connecté
 * ou non. Composant à part : ses changements ne redessinent pas toute l'app. */
function ShareIntake() {
  useShareIntake();
  // Recherche d'image d'iOS (mission « liens vidéo ») : la capture attend le Spotter comme une image partagée.
  useVisualSearchIntake();
  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ShareIntake />
      <WebTitle title={APP_NAME_DISPLAY} />
      <AnalyticsSession />
      <PreferencesProvider>
        <ToastProvider>
          {/* Chantier 3 : lien de confirmation d'un e-mail ouvert sur le site (flux PKCE). */}
          <EmailConfirmationLanding />
          <RootNavigator />
        </ToastProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
