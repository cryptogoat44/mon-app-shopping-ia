import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="post-item/new" options={{ presentation: "modal" }} />
    </Stack>
  );
}
