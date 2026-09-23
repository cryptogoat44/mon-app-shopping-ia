import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { ToastProvider } from "@/lib/toast-context";
import { resolveRootRoute } from "@/lib/root-route";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, profile, profileStatus } = useAuth();
  const route = resolveRootRoute({ session, profileStatus, profile });

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
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </ToastProvider>
    </AuthProvider>
  );
}
