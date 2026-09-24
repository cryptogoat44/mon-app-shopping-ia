import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Tabs, usePathname, useRouter } from "expo-router";
import { color, radius } from "@/theme/tokens";
import { fr } from "@/i18n/fr";
import { BellIcon, FeedIcon, PersonIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { fetchUnreadNotificationCount } from "@/lib/api";
import { onUnreadChanged } from "@/lib/unread-notifications";

// Barre de navigation (Lot F, proposition A validée par le fondateur) :
// Spotter · Fil · + · Activité · Profil. Les Envies sont devenues un onglet
// du Profil ; les notifications, l'onglet « Activité », avec une pastille
// quand il y a du nouveau.
export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Relu à chaque changement d'écran : l'écran Activité marque tout comme
  // lu, la pastille disparaît au changement suivant.
  useEffect(() => {
    fetchUnreadNotificationCount()
      .then(setUnread)
      .catch(() => {});
  }, [pathname]);
  // … et tout de suite quand l'écran Activité a tout marqué comme lu.
  useEffect(
    () =>
      onUnreadChanged(() => {
        fetchUnreadNotificationCount()
          .then(setUnread)
          .catch(() => {});
      }),
    []
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.encre,
        tabBarInactiveTintColor: color.acier,
        tabBarStyle: {
          backgroundColor: color.porcelaine,
          borderTopColor: color.filet,
          // Sur le site, les libellés étaient légèrement coupés en bas
          // (constaté sur les captures du Lot F).
          ...(Platform.OS === "web" ? { height: 62, paddingBottom: 8 } : null),
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
        name="activite"
        options={{
          title: fr.notifications.title,
          tabBarIcon: ({ color: tint }) => <BellIcon tint={String(tint)} />,
          tabBarBadge: unread > 0 ? "" : undefined,
          tabBarBadgeStyle: { minWidth: 9, maxHeight: 9, borderRadius: 5, backgroundColor: color.vert, top: 2 },
          tabBarAccessibilityLabel: unread > 0 ? `${fr.notifications.title}, ${unread} non lues` : fr.notifications.title,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profil", tabBarIcon: ({ color: tint }) => <PersonIcon tint={String(tint)} /> }}
      />
    </Tabs>
  );
}
