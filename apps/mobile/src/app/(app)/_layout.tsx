import { Stack } from "expo-router";
import { PolicyUpdateNotice } from "@/components/policy-update-notice";

export default function AppLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="post-item/new" options={{ presentation: "modal" }} />
      </Stack>
      {/* Information unique après une mise à jour de la politique (bloc Francfort). */}
      <PolicyUpdateNotice />
    </>
  );
}
