import { Stack } from "expo-router";
import { AppNotices } from "@/components/app-notices";

export default function AppLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="post-item/new" options={{ presentation: "modal" }} />
      </Stack>
      {/* Messages discrets (information de mise à jour, demande « statistiques ») et réglage de la collecte. */}
      <AppNotices />
    </>
  );
}
