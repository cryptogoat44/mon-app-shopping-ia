import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, type Theme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { PreferencesProvider } from "@/lib/preferences-context";
import { AnalyticsSession } from "@/components/analytics-session";
import { WebTitle } from "@/components/web-title";
import { resolveRootRoute, showsNavigator } from "@/lib/root-route";
import { useAppFonts } from "@/theme/fonts";
import { color, getActiveScheme } from "@/theme/tokens";
import { APP_NAME_DISPLAY } from "@/constants/brand";
// Capture l'adresse d'arrivée (jetons du lien « mot de passe oublié ») avant
// que la navigation ne la réécrive.
import "@/lib/initial-url";
import { initErrorTracking } from "@/lib/error-tracking";

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

  useEffect(() => {
    if (route !== "splash") SplashScreen.hideAsync();
  }, [route]);

  if (!showsNavigator(route, pathname, fontsReady)) return null;

  return (
    <ThemeProvider value={navigationTheme()}>
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
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <WebTitle title={APP_NAME_DISPLAY} />
      <AnalyticsSession />
      <PreferencesProvider>
        <ToastProvider>
          <RootNavigator />
        </ToastProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
