// Notifications des nouveaux messages (app iPhone, lot notifications) — règles :
// push-state.ts. Le module natif expo-notifications n'est chargé qu'à la
// demande, et seulement s'il est dans ce build : un build plus ancien qui
// recevrait ce code par une mise à jour à distance n'a simplement pas les
// notifications (rien ne plante, rien n'est proposé).
// L'autorisation d'iOS n'est demandée que par enablePush, appelée après un
// « Activer » de la personne (feuille d'explication ou Réglages), jamais au
// lancement. Version site : push.web.ts (aucune notification, aucun appel).
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { isExpoPushToken } from "@monapp/shared-types";
import { deletePushToken, registerPushToken } from "./api";
import { withTimeout } from "./retry";
import {
  PUSH_TOKEN_KEY,
  conversationIdFromNotification,
  firstTimeHandled,
  parsePushDecision,
  permissionFrom,
  pushDecisionKey,
  readProjectId,
  shouldShowBanner,
  type PushDecision,
  type PushPermission,
} from "./push-state";

type NotificationsModule = typeof import("expo-notifications");

/** La déconnexion n'attend jamais le serveur plus longtemps. */
const FORGET_TIMEOUT_MS = 4_000;

let loading: Promise<NotificationsModule | null> | null = null;

function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS !== "ios") return Promise.resolve(null);
  loading ??= (async () => {
    // Build sans le module natif : pas de notifications, sans erreur.
    if (!requireOptionalNativeModule("ExpoPushTokenManager")) return null;
    try {
      return await import("expo-notifications");
    } catch {
      return null;
    }
  })();
  return loading;
}

function projectId(): string | null {
  return readProjectId(Constants);
}

/** Ce build peut recevoir des notifications (iPhone, module natif, projet chez Expo). */
export async function pushSupported(): Promise<boolean> {
  return projectId() !== null && (await loadNotifications()) !== null;
}

/** L'autorisation d'iOS, sans rien demander. */
export async function pushPermission(): Promise<PushPermission> {
  const notifications = await loadNotifications();
  if (!notifications) return "denied";
  return permissionFrom(await notifications.getPermissionsAsync());
}

export async function loadPushDecision(userId: string): Promise<PushDecision | null> {
  return parsePushDecision(await AsyncStorage.getItem(pushDecisionKey(userId)));
}

export async function savePushDecision(userId: string, decision: PushDecision): Promise<void> {
  await AsyncStorage.setItem(pushDecisionKey(userId), decision);
}

/** Jeton d'Expo de cet appareil, enregistré sur le serveur. */
async function registerThisDevice(notifications: NotificationsModule): Promise<void> {
  const id = projectId();
  if (!id) throw new Error("push_unavailable");
  const { data } = await notifications.getExpoPushTokenAsync({ projectId: id });
  if (!isExpoPushToken(data)) throw new Error("push_token_invalid");
  await registerPushToken(data, "ios");
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
}

/** La personne a touché « Activer » : la SEULE fonction qui demande
 * l'autorisation à iOS (une fois ; ensuite, iOS ne la redemande plus). */
export async function enablePush(userId: string): Promise<PushPermission> {
  const notifications = await loadNotifications();
  if (!notifications) throw new Error("push_unavailable");
  let permission = permissionFrom(await notifications.getPermissionsAsync());
  if (permission === "undetermined") {
    permission = permissionFrom(await notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  }
  if (permission !== "granted") {
    await savePushDecision(userId, "off");
    return permission;
  }
  await registerThisDevice(notifications);
  await savePushDecision(userId, "on");
  return permission;
}

/** « Plus tard » ou interrupteur coupé : plus rien sur cet appareil pour ce compte. */
export async function disablePush(userId: string): Promise<void> {
  await savePushDecision(userId, "off");
  await forgetPushToken();
}

/** Oublie cet appareil sur le serveur (notifications coupées, déconnexion).
 * Échec : le jeton reste noté, pour réessayer la fois suivante. */
export async function forgetPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  await withTimeout(FORGET_TIMEOUT_MS, (signal) => deletePushToken(token, signal));
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
}

/** À l'ouverture (connecté, notifications allumées sur le serveur) : le jeton
 * est rafraîchi si la personne a dit oui et que iOS le permet déjà. Ne
 * demande jamais rien. */
export async function refreshPushToken(userId: string): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || !projectId()) return;
  if ((await loadPushDecision(userId)) !== "on") return;
  if (permissionFrom(await notifications.getPermissionsAsync()) !== "granted") return;
  await registerThisDevice(notifications);
}

/** Notifications reçues app ouverte (bannière, sauf pour la conversation à
 * l'écran) et notification touchée → `open(conversationId)`, y compris celle
 * qui a lancé l'app. Renvoie de quoi arrêter d'écouter. */
export async function listenToNotifications(open: (conversationId: string) => void): Promise<() => void> {
  const notifications = await loadNotifications();
  if (!notifications) return () => {};
  notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show = shouldShowBanner(notification.request.content.data);
      return { shouldShowBanner: show, shouldShowList: true, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
  const handle = (response: import("expo-notifications").NotificationResponse) => {
    if (response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = conversationIdFromNotification(response.notification.request.content.data);
    if (id && firstTimeHandled(response.notification.request.identifier)) open(id);
  };
  const last = notifications.getLastNotificationResponse();
  if (last) {
    handle(last);
    notifications.clearLastNotificationResponse();
  }
  const subscription = notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
