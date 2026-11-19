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
// (deviceRegistration, push-state.ts), sinon il est oublié. Le serveur sait,
// pour chaque appareil, s'il reçoit les messages et s'il reçoit les alertes.
// Lot « durcissement des alertes » : un appareil dont la session se termine
// (déconnexion forcée, oubli échoué hors réseau) est oublié par son seul
// jeton, à la prochaine occasion (push-forget.ts).
// Lot « découverte » (migration 0051) : quatre réponses de plus, une par
// sorte d'activité (« j'aime », commentaires, abonnés, mentions), dites au
// serveur à chaque enregistrement ; l'appareil reste aussi enregistré tant
// que l'une d'elles est allumée et que le serveur propose l'activité.
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import { ACTIVITY_PUSH_KINDS, isExpoPushToken, type ActivityPushKind } from "@monapp/shared-types";
import { deletePushToken, forgetPushTokenWithoutSession, registerPushToken } from "./api";
import { messagesStatus } from "./conversations";
import { clearForget, createSerialQueue, flushForget, rememberForget } from "./push-forget";
import { withTimeout } from "./retry";
import {
  PUSH_TOKEN_KEY,
  activityRegistration,
  deviceRegistration,
  firstTimeHandled,
  notificationTarget,
  parsePushDecision,
  permissionFrom,
  pushDecisionKey,
  readProjectId,
  selectionKinds,
  shouldShowBanner,
  type ActivityDecisions,
  type NotificationTarget,
  type PushDecision,
  type PushKind,
  type PushPermission,
  type PushSelection,
} from "./push-state";
import { alertsKeepDevice, wishAlertsStatus } from "./wish-alerts";

type NotificationsModule = typeof import("expo-notifications");

/** La déconnexion n'attend jamais le serveur plus longtemps. */
const FORGET_TIMEOUT_MS = 4_000;

/** Oublis et enregistrements de l'appareil, l'un après l'autre (push-forget.ts). */
const serial = createSerialQueue();

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

/** `kind` : une sorte, ou « activity » pour les quatre de l'activité à la fois. */
export async function savePushDecision(userId: string, decision: PushDecision, kind: PushSelection = "messages"): Promise<void> {
  await Promise.all(selectionKinds(kind).map((one) => AsyncStorage.setItem(pushDecisionKey(userId, one), decision)));
}

/** Les réponses de cet appareil pour les quatre sortes d'activité (lot « découverte »). */
export async function loadActivityDecisions(userId: string): Promise<ActivityDecisions> {
  const [likes, comments, follows, mentions] = await Promise.all(ACTIVITY_PUSH_KINDS.map((kind) => loadPushDecision(userId, kind)));
  return { likes: likes ?? null, comments: comments ?? null, follows: follows ?? null, mentions: mentions ?? null };
}

/** Les réponses de cet appareil (messages, alertes, activité) et ce que le
 * serveur doit en garder : l'appareil tant que l'une est allumée (les alertes
 * avec leur interrupteur, l'activité quand le serveur la propose). */
async function currentRegistration(userId: string): Promise<DeviceKinds & { keep: boolean }> {
  const [messages, alerts, activity] = await Promise.all([loadPushDecision(userId, "messages"), loadPushDecision(userId, "alerts"), loadActivityDecisions(userId)]);
  const base = deviceRegistration({ messages, alerts }, alertsKeepDevice(wishAlertsStatus()));
  const extra = activityRegistration(activity, messagesStatus().activityPush === true);
  return { ...base, ...extra.kinds, keep: base.keep || extra.keep };
}

/** Ce que reçoit cet appareil, dit au serveur à chaque enregistrement. */
type DeviceKinds = { messages: boolean; alerts: boolean } & Record<ActivityPushKind, boolean>;

/** Jeton d'Expo de cet appareil, enregistré sur le serveur, avec ce qu'il
 * reçoit : les messages, les alertes prix et stock, et chaque sorte
 * d'activité (chacune selon la réponse donnée pour elle sur cet appareil). */
async function registerThisDevice(notifications: NotificationsModule, kinds: DeviceKinds): Promise<void> {
  const id = projectId();
  if (!id) throw new Error("push_unavailable");
  const { data } = await notifications.getExpoPushTokenAsync({ projectId: id });
  if (!isExpoPushToken(data)) throw new Error("push_token_invalid");
  const activity = { likes: kinds.likes, comments: kinds.comments, follows: kinds.follows, mentions: kinds.mentions };
  await serial(async () => {
    // Un oubli en attente passe AVANT le nouvel enregistrement (jamais après : il l'effacerait).
    await flushPendingForgetNow();
    await registerPushToken(data, "ios", kinds.messages, kinds.alerts, activity);
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
    // Ce même jeton vient d'être enregistré : plus rien à oublier pour lui.
    await clearForget(AsyncStorage, data);
  });
}

/** La personne a touché « Activer » : la SEULE fonction qui demande
 * l'autorisation à iOS (une fois ; ensuite, iOS ne la redemande plus).
 * `kind` : la sorte de notifications acceptée (messages par défaut), ou
 * « activity » pour les quatre de l'activité (leur feuille d'explication). */
export async function enablePush(userId: string, kind: PushSelection = "messages"): Promise<PushPermission> {
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
  // Accepter une sorte ne rallume jamais une autre si elle est coupée.
  const accepted = selectionKinds(kind);
  const [messagesDecision, alertsDecision, activity] = await Promise.all([loadPushDecision(userId, "messages"), loadPushDecision(userId, "alerts"), loadActivityDecisions(userId)]);
  const activityOn = (one: ActivityPushKind) => accepted.includes(one) || activity[one] === "on";
  await registerThisDevice(notifications, {
    messages: kind === "messages" || messagesDecision === "on",
    alerts: kind === "alerts" || alertsDecision === "on",
    likes: activityOn("likes"),
    comments: activityOn("comments"),
    follows: activityOn("follows"),
    mentions: activityOn("mentions"),
  });
  await savePushDecision(userId, "on", kind);
  return permission;
}

/** « Plus tard » ou interrupteur coupé, pour une sorte (ou les quatre de
 * l'activité) : l'appareil est oublié sur le serveur, sauf si une autre sorte
 * est allumée — il y reste alors, pour elle seule (réenregistré avec
 * `messages: false`, `alerts: false`, `likes: false`…). Si ce
 * réenregistrement échoue, l'appareil est oublié plutôt que de garder des
 * notifications coupées ; il revient à la prochaine ouverture de l'app
 * (refreshPushToken). */
export async function disablePush(userId: string, kind: PushSelection = "messages"): Promise<void> {
  await savePushDecision(userId, "off", kind);
  const registration = await currentRegistration(userId);
  if (!registration.keep) return forgetPushToken();
  try {
    await registerAgain(registration);
  } catch {
    await forgetPushToken();
  }
}

/** Réenregistre l'appareil (iOS doit déjà le permettre ; ne demande rien). */
async function registerAgain(kinds: DeviceKinds): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || !projectId()) throw new Error("push_unavailable");
  if (permissionFrom(await notifications.getPermissionsAsync()) !== "granted") throw new Error("push_not_allowed");
  await registerThisDevice(notifications, kinds);
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
 * Échec (hors réseau, serveur qui se réveille) : le jeton est noté « à
 * oublier » et l'oubli sera refait sans session (flushPendingForget), à la
 * prochaine ouverture ou au prochain retour au premier plan ; l'erreur est
 * rendue à l'appelant. */
export async function forgetPushToken(): Promise<void> {
  const token = await readNotedToken();
  if (!token) return;
  try {
    await serial(() => withTimeout(FORGET_TIMEOUT_MS, (signal) => deletePushToken(token, signal)));
  } catch (error) {
    await rememberForget(AsyncStorage, token);
    await forgetNotedToken();
    throw error;
  }
  await forgetNotedToken();
}

/** La session de cet appareil vient de se terminer sans qu'il ait pu être
 * oublié (session fermée ailleurs, refusée par Supabase) : son jeton est noté
 * « à oublier », et l'oubli sans session est tenté tout de suite. */
export async function queueForgetPushToken(): Promise<void> {
  const token = await readNotedToken();
  if (!token) return;
  await rememberForget(AsyncStorage, token);
  await forgetNotedToken();
  await flushPendingForget();
}

/** Un oubli en attente ? Il est demandé au serveur (sans session, 4 s au
 * plus) ; sans réponse, il reste noté pour la fois suivante. À l'ouverture,
 * à chaque retour au premier plan et à chaque connexion. */
export async function flushPendingForget(): Promise<void> {
  await serial(flushPendingForgetNow);
}

async function flushPendingForgetNow(): Promise<void> {
  await flushForget(AsyncStorage, (token) => withTimeout(FORGET_TIMEOUT_MS, (signal) => forgetPushTokenWithoutSession(token, signal)));
}

/** Le jeton noté pour cet appareil (null : rien, ou rangement illisible). */
async function readNotedToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function forgetNotedToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // Rien à faire : la note « à oublier » suffit.
  }
}

/** À l'ouverture (connecté, notifications allumées sur le serveur) : le jeton
 * est rafraîchi si la personne a dit oui (messages, alertes avec
 * l'interrupteur allumé, ou une sorte d'activité proposée par le serveur) et
 * que iOS le permet déjà. Ne demande jamais rien. */
export async function refreshPushToken(userId: string): Promise<void> {
  const notifications = await loadNotifications();
  if (!notifications || !projectId()) return;
  const registration = await currentRegistration(userId);
  if (!registration.keep) return;
  if (permissionFrom(await notifications.getPermissionsAsync()) !== "granted") return;
  await registerThisDevice(notifications, registration);
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
