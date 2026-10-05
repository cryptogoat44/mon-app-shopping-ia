import { Stack } from "expo-router";
import { AppNotices } from "@/components/app-notices";

export default function AppLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="post-item/new" options={{ presentation: "modal" }} />
        {/* iPhone : glisser vers la droite fait revenir en arrière (iOS 26 : n'importe
            où sur l'écran). Ce geste du système coupait le curseur de la frise et le
            recadrage dès qu'on allait vers la droite (lot 4). Retour par « ‹ ». */}
        <Stack.Screen name="spot/video" options={{ gestureEnabled: false }} />
        <Stack.Screen name="spot/ciblage" options={{ gestureEnabled: false }} />
      </Stack>
      {/* Messages discrets (information de mise à jour, demande « statistiques ») et réglage de la collecte. */}
      <AppNotices />
    </>
  );
}
