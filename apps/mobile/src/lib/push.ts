// Notifications des nouveaux messages (app iPhone, lot notifications) — règles :
// push-state.ts. Le module natif expo-notifications n'est chargé qu'à la
// demande, et seulement s'il est dans ce build : un build plus ancien qui
// recevrait ce code par une mise à jour à distance n'a simplement pas les
// notifications (rien ne plante, rien n'est proposé).
// L'autorisation d'iOS n'est demandée que par enablePush, appelée après un
// « Activer » de la personne (feuille d'explication ou Réglages), jamais au
// lancement. Version site : push.web.ts (aucune notification, aucun appel).
// Lot alertes prix (0036) : une réponse par sorte (messages, alertes) ;
// l'appareil reste enregistré tant que l'une des deux est allumée
// (deviceRegistration, push-state.ts), sinon il est oublié.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { isExpoPushToken } from "@monapp/shared-types";
import { deletePushToken, registerPushToken } from "./api";
import { withTimeout } from "./retry";
import {
  PUSH_TOKEN_KEY,
  deviceRegistration,
  firstTimeHandled,
  notificationTarget,
  parsePushDecision,
  permissionFrom,
  pushDecisionKey,
  readProjectId,
  shouldShowBanner,
  type NotificationTarget,
  type PushDecision,
  type PushKind,
  type PushPermission,
} from "./push-state";
import { alertsKeepDevice, wishAlertsStatus } from "./wish-alerts";

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

export async function loadPushDecision(userId: string, kind: PushKind = "messages"): Promise<PushDecision | null> {
  return parsePushDecision(await AsyncStorage.getItem(pushDecisionKey(userId, kind)));
}

export async function savePushDecision(userId: string, decision: PushDecision, kind: PushKind = "messages"): Promise<void> {
  await AsyncStorage.setItem(pushDecisionKey(userId, kind), decision);
}

/** Les réponses de cet appareil (messages, alertes) et ce que le serveur doit
 * en garder : l'appareil tant que l'une des deux est allumée. */
async function currentRegistration(userId: string): Promise<{ keep: boolean; messages: boolean }> {
  const [messages, alerts] = await Promise.all([loadPushDecision(userId, "messages"), loadPushDecision(userId, "alerts")]);
  return deviceRegistration({ messages, alerts }, alertsKeepDevice(wishAlertsStatus()));
}

/** Jeton d'Expo de cet appareil, enregistré sur le serveur. `messages` : le
 * serveur lui envoie aussi les notifications des messages (false : les
 * seules alertes prix et stock). */
async function registerThisDevice(notifications: NotificationsModule, messages: boolean): Promise<void> {
  const id = projectId();
  if (!id) throw new Error("push_unavailable");
  const { data } = await notifications.getExpoPushTokenAsync({ projectId: id });
  if (!isExpoPushToken(data)) throw new Error("push_token_invalid");
  await registerPushToken(data, "ios", messages);
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
}

/** La personne a touché « Activer » : la SEULE fonction qui demande
 * l'autorisation à iOS (une fois ; ensuite, iOS ne la redemande plus).
 * `kind` : la sorte de notifications acceptée (messages par défaut). */
export async function enablePush(userId: string, kind: PushKind = "messages"): Promise<PushPermission> {
  const notifications = await loadNotifications();
  if (!notifications) throw new Error("push_unavailable");
  let permission = permissionFrom(await notifications.getPermissionsAsync());
  if (permission === "undetermined") {
    permission = permissionFrom(await notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } }));
  }
  if (permission !== "granted") {
    await savePushDecision(userId, "off", kind);
    return permission;
  }
  const messages = kind === "messages" || (await loadPushDecision(userId, "messages")) === "on";
  await registerThisDevice(notifications, messages);
  await savePushDecision(userId, "on", kind);
  return permission;
}

/** « Plus tard » ou interrupteur coupé, pour une sorte : l'appareil est
 * oublié sur le serveur, sauf si l'autre sorte est allumée — il y reste
 * alors, pour elle seule (messages coupés, alertes allumées : réenregistré
 * avec `messages: false`). Si ce réenregistrement échoue, l'appareil est
 * oublié plutôt que de garder des notifications de messages coupées ; il
 * revient à la prochaine ouverture de l'app (refreshPushToken). */
export async function disablePush(userId: string, kind: PushKind = "messages"): Promise<void> {
  await savePushDecision(userId, "off", kind);
  const registration = await currentRegistration(userId);
  if (!registration.keep) return forgetPushToken();
  if (kind === "alerts") return;
  try {
    await registerAgain(registration.messages);
  } catch {
    await forgetPushToken();
  }
}

/** Réenregistre l'appareil (iOS doit déjà le permettre ; ne demande rien). */
async function registerAgain(messages: boolean): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || !projectId()) throw new Error("push_unavailable");
  if (permissionFrom(await notifications.getPermissionsAsync()) !== "granted") throw new Error("push_not_allowed");
  await registerThisDevice(notifications, messages);
}

/** L'interrupteur des alertes vient de changer (Réglages ou première
 * cloche) : l'appareil est enregistré si les messages ou les alertes le
 * demandent, sinon oublié. Ne demande jamais rien à iOS. */
export async function syncPushDevice(userId: string): Promise<void> {
  const registration = await currentRegistration(userId);
  if (!registration.keep) return forgetPushToken();
  await refreshPushToken(userId);
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
 * est rafraîchi si la personne a dit oui (messages, ou alertes avec
 * l'interrupteur allumé) et que iOS le permet déjà. Ne demande jamais rien. */
export async function refreshPushToken(userId: string): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || !projectId()) return;
  const registration = await currentRegistration(userId);
  if (!registration.keep) return;
  if (permissionFrom(await notifications.getPermissionsAsync()) !== "granted") return;
  await registerThisDevice(notifications, registration.messages);
}

/** Notifications reçues app ouverte (bannière, sauf pour la conversation à
 * l'écran) et notification touchée → `open(cible)` : la conversation d'un
 * message, l'envie d'une alerte (ou vos Envies), y compris celle qui a lancé
 * l'app. Renvoie de quoi arrêter d'écouter. */
export async function listenToNotifications(open: (target: NotificationTarget) => void): Promise<() => void> {
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
    const target = notificationTarget(response.notification.request.content.data);
    if (target && firstTimeHandled(response.notification.request.identifier)) open(target);
  };
  const last = notifications.getLastNotificationResponse();
  if (last) {
    handle(last);
    notifications.clearLastNotificationResponse();
  }
  const subscription = notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
