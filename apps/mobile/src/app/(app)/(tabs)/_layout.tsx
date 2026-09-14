import { View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { color, radius } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { BookmarkIcon, FeedIcon, PersonIcon, PlusIcon, SearchIcon } from "@/components/icons";

export default function TabsLayout() {
  const router = useRouter();

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
        name="publish"
        options={{
          title: fr.profile.publish,
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: fr.profile.publish,
          tabBarIcon: () => (
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: radius.full,
                backgroundColor: color.vert,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: -6,
              }}
            >
              <PlusIcon size={18} tint={color.blanc} />
            </View>
          ),
        }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            router.push("/post-item/new");
          },
        }}
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
