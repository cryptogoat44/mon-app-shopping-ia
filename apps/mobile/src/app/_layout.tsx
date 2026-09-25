import { Stack } from "expo-router";
import Head from "expo-router/head";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { resolveRootRoute } from "@/lib/root-route";
import { useAppFonts } from "@/theme/fonts";
import { APP_NAME_DISPLAY } from "@/constants/brand";
// Capture l'adresse d'arrivée (jetons du lien « mot de passe oublié ») avant
// que la navigation ne la réécrive.
import "@/lib/initial-url";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, profile, profileStatus } = useAuth();
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

  if (route === "splash") return null;

  return (
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
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      {/* Titre de l'onglet sur le web (sans effet sur iPhone). */}
      <Head>
        <title>{APP_NAME_DISPLAY}</title>
      </Head>
      <ToastProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </ToastProvider>
    </AuthProvider>
  );
}
