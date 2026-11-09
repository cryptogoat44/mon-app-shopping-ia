import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { Tabs, usePathname, useRouter } from "expo-router";
import { color, radius } from "@/theme/tokens";
import { t } from "@/i18n";
import { BellIcon, FeedIcon, PersonIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { fetchCollectionsStatus, fetchMessagesStatus, fetchUnreadNotificationCount } from "@/lib/api";
import { collectionsStatus } from "@/lib/collections";
import { activityUnread } from "@/lib/conversations";
import { useMessagesStatus } from "@/lib/use-messages-status";
import { spotterTab } from "@/lib/shared-item";
import { onUnreadChanged } from "@/lib/unread-notifications";
import { usePendingSharedItem } from "@/lib/use-shared-item";

// Pastille ronde, sans chiffre (Activité, partage qui attend le Spotter) ;
// couleur lue à l'affichage, selon le thème en cours.
const dot = () => ({ minWidth: 9, maxHeight: 9, borderRadius: 5, backgroundColor: color.vert, top: 2 });

// Barre de navigation (Lot F, proposition A validée par le fondateur) :
// Spotter · Fil · + · Activité · Profil. Les Envies sont devenues un onglet
// du Profil ; les notifications, l'onglet « Activité », avec une pastille
// quand il y a du nouveau.
export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  // Lot messages : les conversations non lues comptent aussi pour la pastille.
  const messages = useMessagesStatus();
  const unread = activityUnread(notificationsUnread, messages);
  // Lot « partager vers Spotto » : un partage reçu pendant une recherche ou une
  // saisie attend le Spotter ; une pastille le rappelle jusqu'à son ouverture.
  const spotter = spotterTab(usePendingSharedItem());

  // Relu à chaque changement d'écran : l'écran Activité marque tout comme
  // lu, la pastille disparaît au changement suivant.
  // Les messages non lus sont relus en même temps que les notifications.
  useEffect(() => {
    fetchUnreadNotificationCount()
      .then(setNotificationsUnread)
      .catch(() => {});
    fetchMessagesStatus().catch(() => {});
    // Lot collections : lue jusqu'à ce qu'elles soient disponibles (puis plus rien à relire).
    if (!collectionsStatus().enabled) fetchCollectionsStatus().catch(() => {});
  }, [pathname]);
  // … et tout de suite quand l'écran Activité a tout marqué comme lu.
  useEffect(
    () =>
      onUnreadChanged(() => {
        fetchUnreadNotificationCount()
          .then(setNotificationsUnread)
          .catch(() => {});
        fetchMessagesStatus().catch(() => {});
      }),
    []
  );

  return (
    // Libellés d'accessibilité donnés à chaque onglet : sinon la barre d'onglets
    // ajoute « tab, 1 of 5 » en anglais pour VoiceOver, même en français
    // (constaté sur simulateur, lot 3bis) ; le rôle « onglet » est déjà
    // annoncé par iOS dans la langue de l'appareil.
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
        options={{
          title: t.spotter.title,
          tabBarIcon: ({ color: tint }) => <SearchIcon tint={String(tint)} />,
          tabBarBadge: spotter.badge,
          tabBarBadgeStyle: dot(),
          tabBarAccessibilityLabel: spotter.accessibilityLabel,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{ title: t.tabs.feed, tabBarAccessibilityLabel: t.tabs.feed, tabBarIcon: ({ color: tint }) => <FeedIcon tint={String(tint)} /> }}
      />
      <Tabs.Screen
        name="publish"
        options={{
          title: t.profile.publish,
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: t.profile.publish,
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
          title: t.notifications.title,
          tabBarIcon: ({ color: tint }) => <BellIcon tint={String(tint)} />,
          tabBarBadge: unread > 0 ? "" : undefined,
          tabBarBadgeStyle: dot(),
          tabBarAccessibilityLabel: unread > 0 ? t.tabs.unread(t.notifications.title, unread) : t.notifications.title,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t.tabs.profile, tabBarAccessibilityLabel: t.tabs.profile, tabBarIcon: ({ color: tint }) => <PersonIcon tint={String(tint)} /> }}
      />
    </Tabs>
  );
}
