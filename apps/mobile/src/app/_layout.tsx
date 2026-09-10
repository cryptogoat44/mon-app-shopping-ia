import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { isProfileComplete } from "@monapp/shared-types";

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, profile, loading } = useAuth();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  const authenticated = !!session;
  const profileReady = authenticated && profile !== null && isProfileComplete(profile);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={profileReady}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={authenticated && !profileReady}>
        <Stack.Screen name="complete-profile" />
      </Stack.Protected>

      <Stack.Protected guard={!authenticated}>
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
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}
