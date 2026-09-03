import { Tabs } from "expo-router";
import { theme } from "@/lib/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.ink,
        tabBarInactiveTintColor: theme.color.muted,
        tabBarStyle: {
          backgroundColor: theme.color.ground,
          borderTopColor: theme.color.line,
        },
        tabBarLabelStyle: { fontSize: theme.font.small, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Rechercher" }} />
      <Tabs.Screen name="feed" options={{ title: "Fil" }} />
      <Tabs.Screen name="vault" options={{ title: "Vault" }} />
      <Tabs.Screen name="account" options={{ title: "Compte" }} />
    </Tabs>
  );
}
