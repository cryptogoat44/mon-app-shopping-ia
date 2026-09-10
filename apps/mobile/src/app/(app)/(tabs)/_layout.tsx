import { Tabs } from "expo-router";
import { color } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { BookmarkIcon, FeedIcon, PersonIcon, SearchIcon } from "@/components/icons";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.encre,
        tabBarInactiveTintColor: color.acier,
        tabBarStyle: {
          backgroundColor: color.porcelaine,
          borderTopColor: color.filet,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: fr.spotter.title, tabBarIcon: ({ color: tint }) => <SearchIcon tint={String(tint)} /> }}
      />
      <Tabs.Screen
        name="feed"
        options={{ title: "Fil", tabBarIcon: ({ color: tint }) => <FeedIcon tint={String(tint)} /> }}
      />
      <Tabs.Screen
        name="wishlist"
        options={{ title: fr.wishlist.title, tabBarIcon: ({ color: tint }) => <BookmarkIcon tint={String(tint)} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profil", tabBarIcon: ({ color: tint }) => <PersonIcon tint={String(tint)} /> }}
      />
    </Tabs>
  );
}
