import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, type MessagesStatus, type NotificationType } from "@monapp/shared-types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { readMessagesStatus } from "../src/lib/conversations";
import {
  ACTIVITY_NOTIFICATION_TYPES,
  activityPushPossible,
  activityRegistration,
  conversationHref,
  conversationIdFromNotification,
  notificationHref,
  notificationTarget,
  firstTimeHandled,
  parsePushDecision,
  permissionFrom,
  pushDecisionKey,
  pushPossible,
  pushSwitchValue,
  pushSwitchVisible,
  readProjectId,
  selectionKinds,
  setOpenConversation,
  shouldOfferActivityPush,
  shouldOfferPush,
  shouldRefreshToken,
  shouldShowBanner,
  showsActivity,
  type ActivityDecisions,
  type ActivityPushContext,
  type PushContext,
} from "../src/lib/push-state";
import { PENDING_FORGET_KEY, clearForget, createSerialQueue, flushForget, pendingForget, rememberForget } from "../src/lib/push-forget";
import { SIGN_OUT_SCOPES } from "@supabase/supabase-js";

// Lot notifications : être prévenu des nouveaux messages sur l'iPhone. La
// logique sans écran ni module natif (push-state.ts), puis les écrans lus
// comme du texte (pas de rendu de composants ici, vitest.config.ts) : jamais
// d'autorisation demandée au lancement, l'explication d'abord, rien sur le
// site, la conversation ouverte par une notification touchée, et les textes.

const ROOT = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CONVERSATION = "c0000000-0000-4000-8000-000000000001";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = files(ROOT).map((path) => ({ name: relative(ROOT, path), text: readFileSync(path, "utf8") }));
const using = (pattern: RegExp) => sources.filter((file) => pattern.test(file.text)).map((file) => file.name).sort();

const on: MessagesStatus = { enabled: true, unreadCount: 0, push: true };
const context = (overrides: Partial<PushContext> = {}): PushContext => ({ platform: "ios", status: on, supported: true, ...overrides });

afterEach(() => {
  setOpenConversation(null);
});

describe("quand proposer les notifications", () => {
  it("seulement sur l'iPhone, build prêt, messagerie et notifications allumées sur le serveur", () => {
    expect(pushPossible(context())).toBe(true);
    expect(pushPossible(context({ platform: "web" }))).toBe(false);
    expect(pushPossible(context({ platform: "android" }))).toBe(false);
    expect(pushPossible(context({ supported: false }))).toBe(false);
    expect(pushPossible(context({ status: { ...on, push: false } }))).toBe(false);
    expect(pushPossible(context({ status: { enabled: true, unreadCount: 0 } }))).toBe(false);
    expect(pushPossible(context({ status: { ...on, enabled: false } }))).toBe(false);
  });

  it("l'interrupteur des Réglages : caché sur le site et quand le serveur ne les propose pas", () => {
    expect(pushSwitchVisible(context())).toBe(true);
    expect(pushSwitchVisible(context({ platform: "web" }))).toBe(false);
    expect(pushSwitchVisible(context({ status: { ...on, push: false } }))).toBe(false);
    // Un serveur plus ancien (sans « push ») ou une réponse illisible : jamais proposé.
    expect(readMessagesStatus({ enabled: true, unreadCount: 2 }).push).toBe(false);
    expect(readMessagesStatus({ enabled: true, unreadCount: 2, push: "true" }).push).toBe(false);
    expect(readMessagesStatus({ enabled: false, unreadCount: 0, push: true }).push).toBe(false);
    expect(readMessagesStatus({ enabled: true, unreadCount: 2, push: true })).toEqual({ enabled: true, unreadCount: 2, push: true, actions: false, activityPush: false });
  });

  it("la feuille d'explication : une seule fois (aucune réponse encore), et pas si iOS les a déjà refusées", () => {
    expect(shouldOfferPush(context(), null, "undetermined")).toBe(true);
    expect(shouldOfferPush(context(), null, "granted")).toBe(true);
    expect(shouldOfferPush(context(), "off", "undetermined")).toBe(false);
    expect(shouldOfferPush(context(), "on", "granted")).toBe(false);
    expect(shouldOfferPush(context(), null, "denied")).toBe(false);
    expect(shouldOfferPush(context({ platform: "web" }), null, "undetermined")).toBe(false);
    expect(shouldOfferPush(context({ status: { ...on, push: false } }), null, "undetermined")).toBe(false);
  });

  it("l'interrupteur est allumé seulement si la personne a dit oui et que iOS le permet ; le jeton n'est rafraîchi qu'alors", () => {
    expect(pushSwitchValue("on", "granted")).toBe(true);
    expect(pushSwitchValue("on", "denied")).toBe(false);
    expect(pushSwitchValue("off", "granted")).toBe(false);
    expect(pushSwitchValue(null, "granted")).toBe(false);
    expect(shouldRefreshToken(context(), "on", "granted")).toBe(true);
    expect(shouldRefreshToken(context(), "on", "undetermined")).toBe(false);
    expect(shouldRefreshToken(context({ status: { ...on, push: false } }), "on", "granted")).toBe(false);
  });

  it("réponse d'iOS, choix gardé par compte, identifiant du projet chez Expo", () => {
    expect(permissionFrom({ granted: true, status: "granted" })).toBe("granted");
    expect(permissionFrom({ granted: false, status: "undetermined" })).toBe("undetermined");
    expect(permissionFrom({ granted: false, status: "denied" })).toBe("denied");
    // Autorisation « provisoire » d'iOS : les notifications arrivent (sans bannière).
    expect(permissionFrom({ granted: false, status: "undetermined", ios: { status: 3 } })).toBe("granted");
    expect(pushDecisionKey("u1")).toBe("spotto.push-decision.u1");
    expect(parsePushDecision("on")).toBe("on");
    expect(parsePushDecision("oui")).toBeNull();
    expect(readProjectId({ easConfig: { projectId: "0f8f7c2e-1234-4abc-9def-0123456789ab" } })).toBe("0f8f7c2e-1234-4abc-9def-0123456789ab");
    expect(readProjectId({ expoConfig: { extra: { eas: { projectId: "0f8f7c2e-1234-4abc-9def-0123456789ab" } } } })).toBe("0f8f7c2e-1234-4abc-9def-0123456789ab");
    // `eas init` pas encore fait : pas d'identifiant, rien n'est proposé.
    expect(readProjectId({ expoConfig: { extra: {} } })).toBeNull();
    expect(readProjectId({ easConfig: { projectId: "pas-un-identifiant" } })).toBeNull();
  });
});

describe("jamais d'autorisation demandée au lancement", () => {
  it("la fenêtre d'iOS n'est demandée que par enablePush (lib/push.ts)", () => {
    // (L'accès aux photos, lui, est demandé par lib/latest-video.ts, avec son propre module.)
    expect(using(/otifications\.requestPermissionsAsync/)).toEqual(["lib/push.ts"]);
    const push = read("lib/push.ts");
    const enable = push.slice(push.indexOf("export async function enablePush"), push.indexOf("export async function disablePush"));
    expect(enable).toContain("requestPermissionsAsync");
    expect(push.split("requestPermissionsAsync").length - 1).toBe(1);
  });

  it("enablePush n'est appelée que par un geste de la personne : « Activer » (feuille) ou l'interrupteur des Réglages", () => {
    // lib/push.ts et lib/push.web.ts la définissent ; seuls trois composants l'appellent (la feuille, et
    // les interrupteurs des messages et de l'activité, lot « découverte »).
    expect(using(/\benablePush\(/)).toEqual([
      "components/activity-push-setting.tsx",
      "components/message-push-setting.tsx",
      "components/push-offer-sheet.tsx",
      "lib/push.ts",
      "lib/push.web.ts",
    ]);
    const sheet = read("components/push-offer-sheet.tsx");
    const accept = sheet.slice(sheet.indexOf("async function accept()"), sheet.indexOf("function later()"));
    // Lot alertes prix : la sorte acceptée (messages ou alertes) part avec la demande.
    expect(accept).toContain("await enablePush(userId, kind)");
    expect(sheet).toContain('onPress={() => void accept()}');
    expect(sheet).toContain('testID="notifications-activer"');
  });

  it("au lancement et à l'ouverture : seulement l'écoute des notifications touchées et le jeton déjà accepté", () => {
    for (const layout of ["app/_layout.tsx", "app/(app)/_layout.tsx", "app/(app)/(tabs)/_layout.tsx", "lib/use-push-notifications.ts", "lib/auth-context.tsx"]) {
      const text = read(layout);
      expect(text, layout).not.toMatch(/enablePush|requestPermissionsAsync|usePushOffer|PushOfferSheet/);
    }
    expect(read("app/(app)/_layout.tsx")).toContain("usePushNotifications();");
    const hook = read("lib/use-push-notifications.ts");
    expect(hook).toContain("listenToNotifications(");
    expect(hook).toContain("refreshPushToken(userId)");
    // Le jeton n'est rafraîchi que si la personne a dit oui (messages, ou
    // alertes avec l'interrupteur allumé) et que iOS le permet déjà.
    const refresh = read("lib/push.ts").slice(read("lib/push.ts").indexOf("export async function refreshPushToken"));
    expect(refresh).toContain("const registration = await currentRegistration(userId);");
    expect(refresh).toContain("if (!registration.keep) return;");
    expect(refresh).toContain('!== "granted") return;');
  });

  it("la feuille est proposée après un message envoyé ou reçu, dans l'écran d'une conversation", () => {
    // Lot « découverte » : celle de l'activité, dans l'onglet Activité (voir « notifications d'activité », plus bas).
    expect(using(/usePushOffer\(/)).toEqual(["app/(app)/(tabs)/activite.tsx", "app/(app)/conversation.tsx", "components/push-offer-sheet.tsx"]);
    const screen = read("app/(app)/conversation.tsx");
    expect(screen).toContain("if (data.messages.some((message) => !message.mine)) offerPush();");
    expect(screen.match(/offerPush\(\);/g)?.length).toBe(3);
    expect(screen).toContain("{pushOffer.sheet}");
  });
});

describe("l'explication d'abord", () => {
  const sheet = read("components/push-offer-sheet.tsx");
  const setting = read("components/message-push-setting.tsx");

  it("la feuille dit à quoi elles servent et ce qu'elles montrent, avec « Activer » et « Plus tard »", () => {
    for (const key of ["offerTitle", "offerBody", "offerSettingsHint", "offerAccept", "offerLater"]) expect(sheet).toContain(`t.push.${key}`);
    // « Plus tard » ne demande rien à iOS, et la feuille ne revient pas.
    const later = sheet.slice(sheet.indexOf("function later()"), sheet.indexOf("const denied"));
    expect(later).toContain("disablePush(userId, kind)");
    expect(later).not.toContain("enablePush");
    // Déjà refusées par iOS : on dit où les autoriser.
    expect(sheet).toContain("Linking.openSettings()");
  });

  it("l'interrupteur des Réglages montre d'abord la feuille si iOS n'a encore rien demandé", () => {
    expect(setting).toContain('if (on && settings.permission === "undetermined") {\n      setExplaining(true);');
    expect(setting).toContain("<PushOfferSheet");
    expect(setting).toContain("pushSwitchVisible({ platform: Platform.OS, status, supported: settings?.supported ?? false })");
    expect(setting).toContain("accessibilityLabel={t.push.settingSwitchLabel}");
    // Couper : l'appareil est oublié sur le serveur.
    expect(setting).toContain("else await disablePush(userId);");
  });

  // Lot « messages vus » : « Confirmations de lecture » s'est glissé entre les
  // deux ; les réglages des messages se suivent toujours, sans rien d'autre.
  it("dans les Réglages, juste sous « Qui peut m'écrire » et « Confirmations de lecture »", () => {
    const settings = read("app/(app)/settings.tsx");
    const from = settings.indexOf("<MessagesFromSetting />");
    const receipts = settings.indexOf("<ReadReceiptsSetting />");
    const push = settings.indexOf("<MessagePushSetting />");
    expect(from).toBeGreaterThan(-1);
    expect(receipts).toBeGreaterThan(from);
    expect(push).toBeGreaterThan(receipts);
    const between = settings.slice(from + "<MessagesFromSetting />".length, push);
    expect(between.match(/<[A-Z]\w+ /g)).toEqual(["<ReadReceiptsSetting "]);
  });
});

describe("le site : jamais de notification", () => {
  it("expo-notifications n'est chargé que par l'app iPhone (lib/push.ts), jamais par sa version site", () => {
    expect(using(/expo-notifications/)).toEqual(["lib/push.ts"]);
    expect(read("lib/push.ts")).toContain('if (Platform.OS !== "ios") return Promise.resolve(null);');
  });

  it("la version site a les mêmes fonctions, n'appelle jamais le serveur et ne propose rien", () => {
    const native = [...read("lib/push.ts").matchAll(/^export async function (\w+)|^export function (\w+)/gm)].map((m) => m[1] ?? m[2]).sort();
    const web = read("lib/push.web.ts");
    const webNames = [...web.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]).sort();
    expect(webNames).toEqual(native);
    expect(web).not.toMatch(/from "\.\/api"|fetch\(|expo-notifications/);
    expect(web).toContain('export async function pushSupported(): Promise<boolean> {\n  return false;');
  });

  it("les écrans vérifient aussi qu'ils sont sur l'iPhone", () => {
    expect(read("lib/use-push-notifications.ts").match(/Platform\.OS !== "ios"/g)?.length).toBe(2);
    expect(read("components/push-offer-sheet.tsx")).toContain('Platform.OS !== "ios"');
    expect(read("components/message-push-setting.tsx")).toContain('if (Platform.OS !== "ios" || !userId) return;');
  });
});

describe("une notification touchée ouvre la conversation", () => {
  it("lit seulement l'identifiant de la conversation dans les données", () => {
    expect(conversationIdFromNotification({ conversationId: CONVERSATION })).toBe(CONVERSATION);
    for (const data of [null, undefined, "texte", {}, { conversationId: 12 }, { conversationId: "../../reglages" }, { conversationId: `${CONVERSATION}?x=1` }]) {
      expect(conversationIdFromNotification(data)).toBeNull();
    }
  });

  it("le lien de l'écran de la conversation, celui qu'il lit (`id`)", () => {
    expect(conversationHref(CONVERSATION)).toEqual({ pathname: "/conversation", params: { id: CONVERSATION } });
    expect(read("app/(app)/conversation.tsx")).toContain("const { id, userId, wishId, collectionItemId, matchId } = useLocalSearchParams<{");
    expect(read("lib/use-push-notifications.ts")).toContain("listenToNotifications((target) => router.push(notificationHref(target)))");
    expect(notificationHref({ kind: "conversation", id: CONVERSATION })).toEqual(conversationHref(CONVERSATION));
  });

  it("la notification qui a lancé l'app aussi, une seule fois ; seulement un appui sur la notification elle-même", () => {
    const push = read("lib/push.ts");
    expect(push).toContain("notifications.getLastNotificationResponse()");
    expect(push).toContain("notifications.clearLastNotificationResponse()");
    expect(push).toContain("response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER");
    expect(firstTimeHandled("n1")).toBe(true);
    expect(firstTimeHandled("n1")).toBe(false);
    expect(firstTimeHandled("n2")).toBe(true);
  });

  it("app ouverte : pas de bannière pour la conversation déjà à l'écran", () => {
    expect(shouldShowBanner({ conversationId: CONVERSATION })).toBe(true);
    setOpenConversation(CONVERSATION);
    expect(shouldShowBanner({ conversationId: CONVERSATION })).toBe(false);
    expect(shouldShowBanner({ conversationId: "c0000000-0000-4000-8000-000000000002" })).toBe(true);
    expect(shouldShowBanner(null)).toBe(true);
  });
});

describe("déconnexion", () => {
  it("l'appareil est oublié sur le serveur avant de fermer la session, sans jamais l'empêcher", () => {
    const auth = read("lib/auth-context.tsx");
    const signOut = auth.slice(auth.indexOf("const signOut = useCallback"));
    expect(signOut.indexOf("await forgetPushToken().catch(() => {});")).toBeGreaterThan(-1);
    expect(signOut.indexOf("await forgetPushToken()")).toBeLessThan(signOut.indexOf("await supabase.auth.signOut("));
    // Au plus 4 s d'attente.
    expect(read("lib/push.ts")).toContain("withTimeout(FORGET_TIMEOUT_MS, (signal) => deletePushToken(token, signal))");
  });

  // Lot « durcissement des alertes » (revue de sécurité app-06, alertes-03).
  it("« Se déconnecter » ferme la session de CET appareil seulement (« local », accepté par la bibliothèque installée), jamais celles des autres", () => {
    expect(SIGN_OUT_SCOPES).toContain("local");
    const auth = read("lib/auth-context.tsx");
    const calls = auth.match(/supabase\.auth\.signOut\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) expect(call).toBe('supabase.auth.signOut({ scope: "local" })');
    expect(using(/auth\.signOut\(/)).toEqual(["lib/auth-context.tsx"]);
  });

  it("session fermée ailleurs (refusée par Supabase, ou terminée) : l'appareil est noté « à oublier » AVANT la déconnexion locale", () => {
    const auth = read("lib/auth-context.tsx");
    const forced = auth.slice(auth.indexOf("if (rejected) {"));
    expect(forced.indexOf("await queueForgetPushToken().catch(() => {});")).toBeGreaterThan(-1);
    expect(forced.indexOf("await queueForgetPushToken()")).toBeLessThan(forced.indexOf("await supabase.auth.signOut("));
    expect(auth).toContain('if (event === "SIGNED_OUT") queueForgetPushToken().catch(() => {});');
  });

  it("un oubli en attente est refait à l'ouverture, à chaque retour au premier plan et à chaque connexion ; avant tout nouvel enregistrement de l'appareil", () => {
    const auth = read("lib/auth-context.tsx");
    expect(auth.match(/flushPendingForget\(\)\.catch\(\(\) => \{\}\)/g)).toHaveLength(3);
    expect(auth).toMatch(/if \(state === "active"\) \{\s*supabase\.auth\.startAutoRefresh\(\);\s*flushPendingForget\(\)/);
    expect(auth).toContain("if (userId) flushPendingForget().catch(() => {});");
    const push = read("lib/push.ts");
    const register = push.slice(push.indexOf("async function registerThisDevice"), push.indexOf("export async function enablePush"));
    expect(register.indexOf("await flushPendingForgetNow();")).toBeGreaterThan(-1);
    expect(register.indexOf("await flushPendingForgetNow();")).toBeLessThan(register.indexOf("await registerPushToken("));
    expect(register).toContain("await serial(async () => {");
    // L'oubli normal qui échoue laisse l'appareil « à oublier ».
    const forget = push.slice(push.indexOf("export async function forgetPushToken"), push.indexOf("export async function queueForgetPushToken"));
    expect(forget).toMatch(/catch \(error\) \{\s*await rememberForget\(AsyncStorage, token\);/);
    // Sans session : seulement le jeton, vers la route qui ne demande pas de compte.
    const api = read("lib/api.ts");
    const anonymous = api.slice(api.indexOf("export async function forgetPushTokenWithoutSession"), api.indexOf("// ---- Alertes prix et stock"));
    expect(anonymous).toContain("fetch(`${apiUrl}/api/push-token/forget`");
    expect(anonymous).not.toMatch(/authorizedFetch|Authorization/);
  });
});

describe("oubli en attente (push-forget.ts)", () => {
  const TOKEN = "ExponentPushToken[abcdefghijklmnop01]";
  const OTHER = "ExponentPushToken[abcdefghijklmnop02]";
  function memoryStore(broken = false) {
    const values = new Map<string, string>();
    const fail = () => {
      if (broken) throw new Error("rangement indisponible");
    };
    return {
      values,
      getItem: async (key: string) => (fail(), values.get(key) ?? null),
      setItem: async (key: string, value: string) => void (fail(), values.set(key, value)),
      removeItem: async (key: string) => void (fail(), values.delete(key)),
    };
  }

  it("noté, puis oublié par le serveur : plus rien en attente ; sans réponse : la note reste pour la fois suivante", async () => {
    const store = memoryStore();
    expect(await rememberForget(store, TOKEN)).toBe(true);
    expect(await pendingForget(store)).toBe(TOKEN);
    const sent: string[] = [];
    expect(await flushForget(store, async () => Promise.reject(new Error("hors réseau")))).toBe(false);
    expect(await pendingForget(store)).toBe(TOKEN);
    expect(await flushForget(store, async (token) => void sent.push(token))).toBe(true);
    expect(sent).toEqual([TOKEN]);
    expect(await pendingForget(store)).toBeNull();
    // Rien en attente : aucun appel.
    expect(await flushForget(store, async (token) => void sent.push(token))).toBe(true);
    expect(sent).toEqual([TOKEN]);
  });

  it("jamais autre chose qu'un jeton d'Expo ; rangement en panne : rien ne plante", async () => {
    const store = memoryStore();
    expect(await rememberForget(store, "pas-un-jeton")).toBe(false);
    store.values.set(PENDING_FORGET_KEY, "https://ailleurs.example");
    expect(await pendingForget(store)).toBeNull();
    const broken = memoryStore(true);
    expect(await rememberForget(broken, TOKEN)).toBe(false);
    expect(await pendingForget(broken)).toBeNull();
    await clearForget(broken);
    expect(await flushForget(broken, async () => {})).toBe(true);
  });

  it("le même jeton enregistré de nouveau efface la note ; un autre jeton ne l'efface pas", async () => {
    const store = memoryStore();
    await rememberForget(store, TOKEN);
    await clearForget(store, OTHER);
    expect(await pendingForget(store)).toBe(TOKEN);
    await clearForget(store, TOKEN);
    expect(await pendingForget(store)).toBeNull();
  });

  it("file d'une seule place : un oubli lancé avant un enregistrement arrive toujours avant lui, même lent ou en échec", async () => {
    const serial = createSerialQueue();
    const order: string[] = [];
    const slowForget = serial(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("oubli");
      throw new Error("hors réseau");
    });
    const register = serial(async () => void order.push("enregistrement"));
    await expect(slowForget).rejects.toThrow("hors réseau");
    await register;
    expect(order).toEqual(["oubli", "enregistrement"]);
  });
});

describe("textes en français et en anglais", () => {
  it("la feuille et le réglage, en vouvoyant", () => {
    expect(fr.push.offerTitle).toBe("Être prévenu de vos nouveaux messages ?");
    expect(fr.push.offerBody).toBe(
      "Spotto peut vous envoyer une notification quand quelqu'un vous écrit ou vous invite à discuter. Elle dit seulement qui vous écrit, jamais ce qu'il vous écrit."
    );
    expect(fr.push.offerAccept).toBe("Activer les notifications");
    expect(fr.push.offerLater).toBe("Plus tard");
    expect(fr.push.settingTitle).toBe("Notifications de messages");
    expect(en.push.offerTitle).toBe("Get notified of new messages?");
    expect(en.push.offerAccept).toBe("Turn on notifications");
    expect(en.push.offerLater).toBe("Not now");
    expect(en.push.settingTitle).toBe("Message notifications");
    const french = Object.values(fr.push).join("\n");
    expect(french).toContain("vous");
    expect(french).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi|te)(?!\p{L})/iu);
    // Ce que montre une notification : qui écrit, jamais le contenu.
    expect(fr.push.settingOn).toContain("jamais le contenu");
    expect(en.push.settingOn).toContain("never the content");
  });

  it("la politique de confidentialité parle d'Expo et d'Apple, sans le texte des messages", () => {
    const policy = (path: string) => read(path);
    expect(policy("legal/confidentialite.ts")).toContain("Expo (650 Industries, Inc., États-Unis)");
    expect(policy("legal/confidentialite.ts")).toContain("jamais le texte du message ni l'envie jointe");
    expect(policy("legal/confidentialite.ts")).toContain("[À vérifier : rôle d'Expo (sous-traitant)");
    expect(policy("legal/confidentialite.en.ts")).toContain("Expo (650 Industries, Inc., United States)");
    expect(policy("legal/confidentialite.en.ts")).toContain("never the text of the message or the attached wish");
  });
});

// ---- Lot « découverte » (migration 0051) : notifications d'activité ----

describe("notifications d'activité : quand les proposer", () => {
  const none: ActivityDecisions = { likes: null, comments: null, follows: null, mentions: null };
  const activity = (overrides: Partial<ActivityPushContext> = {}): ActivityPushContext => ({ platform: "ios", status: { activityPush: true }, supported: true, ...overrides });

  it("seulement sur l'iPhone, build prêt, quand le serveur les propose (activityPush) ; la messagerie n'y est pour rien", () => {
    expect(activityPushPossible(activity())).toBe(true);
    expect(activityPushPossible(activity({ platform: "web" }))).toBe(false);
    expect(activityPushPossible(activity({ platform: "android" }))).toBe(false);
    expect(activityPushPossible(activity({ supported: false }))).toBe(false);
    expect(activityPushPossible(activity({ status: { activityPush: false } }))).toBe(false);
    expect(activityPushPossible(activity({ status: {} }))).toBe(false);
    // Un serveur plus ancien (sans « activityPush ») ou une réponse illisible : jamais proposé ;
    // la messagerie absente ne cache pas l'activité.
    expect(readMessagesStatus({ enabled: true, unreadCount: 0, push: true }).activityPush).toBe(false);
    expect(readMessagesStatus({ enabled: true, unreadCount: 0, activityPush: "true" }).activityPush).toBe(false);
    expect(readMessagesStatus({ enabled: false, unreadCount: 0, activityPush: true })).toEqual({ enabled: false, unreadCount: 0, push: false, actions: false, activityPush: true });
    expect(readMessagesStatus(null).activityPush).toBe(false);
  });

  it("la feuille : une seule fois (aucune réponse pour aucune des quatre sortes), jamais si iOS les a refusées", () => {
    expect(shouldOfferActivityPush(activity(), none, "undetermined")).toBe(true);
    expect(shouldOfferActivityPush(activity(), none, "granted")).toBe(true);
    // « Plus tard » est gardé pour les quatre : plus jamais proposée.
    expect(shouldOfferActivityPush(activity(), { likes: "off", comments: "off", follows: "off", mentions: "off" }, "undetermined")).toBe(false);
    // Une seule sorte réglée dans les Réglages suffit : la personne a déjà choisi.
    expect(shouldOfferActivityPush(activity(), { ...none, mentions: "on" }, "granted")).toBe(false);
    expect(shouldOfferActivityPush(activity(), none, "denied")).toBe(false);
    expect(shouldOfferActivityPush(activity({ platform: "web" }), none, "undetermined")).toBe(false);
    expect(shouldOfferActivityPush(activity({ status: { activityPush: false } }), none, "undetermined")).toBe(false);
  });

  it("ouverte la première fois que l'onglet Activité montre un « j'aime », un commentaire, un abonné ou une mention ; jamais pour la modération ni une pièce reçue", () => {
    expect([...ACTIVITY_NOTIFICATION_TYPES].sort()).toEqual(["comment", "follow", "follow_accepted", "follow_request", "like", "mention", "reply", "tag"]);
    for (const type of ACTIVITY_NOTIFICATION_TYPES) expect(showsActivity([{ type }]), type).toBe(true);
    const others = NOTIFICATION_TYPES.filter((type) => !ACTIVITY_NOTIFICATION_TYPES.includes(type));
    expect(others.sort()).toEqual(["moderation", "piece_received", "report_handled"]);
    expect(showsActivity(others.map((type: NotificationType) => ({ type })))).toBe(false);
    expect(showsActivity([])).toBe(false);
    const screen = read("app/(app)/(tabs)/activite.tsx");
    expect(screen).toContain('const activityPushOffer = usePushOffer("activity");');
    expect(screen).toContain("if (notifications && showsActivity(notifications)) offerActivityPush();");
    expect(screen).toContain("{activityPushOffer.sheet}");
    const sheet = read("components/push-offer-sheet.tsx");
    const offer = sheet.slice(sheet.indexOf("export function usePushOffer("));
    expect(offer).toContain("if (offered.current || !userId || Platform.OS !== \"ios\") return;");
    expect(offer).toContain("if (current.activityPush !== true) return;");
    expect(offer).toContain("shouldOfferActivityPush({ platform: Platform.OS, status: statusRef.current, supported }, decisions, permission)");
  });

  it("« Activer » allume les quatre sortes ; « Plus tard » est gardé pour les quatre ; aucune autre sorte n'est rallumée", () => {
    expect(selectionKinds("activity")).toEqual(["likes", "comments", "follows", "mentions"]);
    expect(selectionKinds("likes")).toEqual(["likes"]);
    expect(selectionKinds("messages")).toEqual(["messages"]);
    const push = read("lib/push.ts");
    const save = push.slice(push.indexOf("export async function savePushDecision"), push.indexOf("/** Les réponses de cet appareil pour les quatre"));
    expect(save).toContain("selectionKinds(kind).map((one) => AsyncStorage.setItem(pushDecisionKey(userId, one), decision))");
    const enable = push.slice(push.indexOf("export async function enablePush"), push.indexOf("export async function disablePush"));
    expect(enable).toContain("const accepted = selectionKinds(kind);");
    expect(enable).toContain('const activityOn = (one: ActivityPushKind) => accepted.includes(one) || activity[one] === "on";');
    for (const kind of ["likes", "comments", "follows", "mentions"]) expect(enable).toContain(`${kind}: activityOn("${kind}"),`);
    expect(enable).toContain('messages: kind === "messages" || messagesDecision === "on",');
    // La feuille passe sa sorte telle quelle : « activity » pour l'activité.
    const sheet = read("components/push-offer-sheet.tsx");
    expect(sheet).toContain('if (kind === "activity") return { title: t.activityPush.offerTitle, body: t.activityPush.offerBody, hint: null, accept: t.activityPush.enable, later: t.activityPush.later };');
    expect(sheet).toContain("{texts.later}");
    expect(sheet).toContain("{busy ? t.push.enabling : texts.accept}");
  });

  it("une réponse par sorte et par compte ; celles des messages et des alertes gardent leurs clés", () => {
    expect(pushDecisionKey("u1")).toBe("spotto.push-decision.u1");
    expect(pushDecisionKey("u1", "alerts")).toBe("spotto.alerts-push-decision.u1");
    const keys = (["likes", "comments", "follows", "mentions"] as const).map((kind) => pushDecisionKey("u1", kind));
    expect(keys).toEqual([
      "spotto.activity-push-decision.likes.u1",
      "spotto.activity-push-decision.comments.u1",
      "spotto.activity-push-decision.follows.u1",
      "spotto.activity-push-decision.mentions.u1",
    ]);
    expect(pushDecisionKey("u2", "likes")).not.toBe(keys[0]);
  });

  it("l'appareil reste enregistré pour l'activité tant qu'une sorte est allumée ET que le serveur la propose ; chaque réponse part au serveur", () => {
    expect(activityRegistration({ likes: "on", comments: null, follows: "off", mentions: null }, true)).toEqual({
      keep: true,
      kinds: { likes: true, comments: false, follows: false, mentions: false },
    });
    expect(activityRegistration({ likes: "on", comments: null, follows: null, mentions: null }, false).keep).toBe(false);
    expect(activityRegistration({ likes: "off", comments: "off", follows: "off", mentions: "off" }, true).keep).toBe(false);
    const push = read("lib/push.ts");
    const current = push.slice(push.indexOf("async function currentRegistration"), push.indexOf("/** Ce que reçoit cet appareil"));
    expect(current).toContain("const extra = activityRegistration(activity, messagesStatus().activityPush === true);");
    expect(current).toContain("keep: base.keep || extra.keep");
    const register = push.slice(push.indexOf("async function registerThisDevice"), push.indexOf("export async function enablePush"));
    expect(register).toContain("const activity = { likes: kinds.likes, comments: kinds.comments, follows: kinds.follows, mentions: kinds.mentions };");
    // À l'ouverture : le jeton est aussi rafraîchi pour l'activité.
    const hook = read("lib/use-push-notifications.ts");
    expect(hook).toContain("const activityOn = activityPush === true;");
    expect(hook).toContain("}, [userId, messagesPush, alertsPush, activityOn]);");
    // Le site : aucune réponse, aucun appel.
    expect(read("lib/push.web.ts")).toContain("return { likes: null, comments: null, follows: null, mentions: null };");
  });
});

describe("notifications d'activité : une notification touchée", () => {
  const POST = "b1000000-0000-4000-8000-000000000001";
  const MEMBER = "a0000000-0000-4000-8000-000000000001";

  it("ouvre la publication, le profil ou la liste des demandes, comme depuis l'onglet Activité", () => {
    expect(notificationTarget({ postId: POST })).toEqual({ kind: "post", id: POST });
    expect(notificationTarget({ userId: MEMBER })).toEqual({ kind: "profile", id: MEMBER });
    expect(notificationTarget({ screen: "requests" })).toEqual({ kind: "requests" });
    expect(notificationHref({ kind: "post", id: POST })).toEqual({ pathname: "/publication", params: { id: POST } });
    expect(notificationHref({ kind: "profile", id: MEMBER })).toEqual({ pathname: "/profil", params: { id: MEMBER } });
    expect(notificationHref({ kind: "requests" })).toEqual({ pathname: "/membres", params: { kind: "requests" } });
    // Les écrans lisent bien ces paramètres.
    expect(read("app/(app)/publication.tsx")).toContain("const { id } = useLocalSearchParams<{ id: string }>();");
    expect(read("app/(app)/profil.tsx")).toContain("const { id } = useLocalSearchParams<{ id: string }>();");
    expect(read("app/(app)/membres.tsx")).toContain("const params = useLocalSearchParams<{ kind?: string; id?: string; count?: string }>();");
    // Une notification de message reste une notification de message.
    expect(notificationTarget({ conversationId: CONVERSATION })).toEqual({ kind: "conversation", id: CONVERSATION });
  });

  it("des données illisibles n'ouvrent rien : jamais une adresse, un identifiant mal formé, deux clés ou un autre écran", () => {
    for (const data of [
      { postId: "../reglages" },
      { postId: `${POST}?x=1` },
      { postId: 12 },
      { userId: "pas-un-identifiant" },
      { screen: "settings" },
      { screen: "requests", postId: POST },
      { postId: POST, userId: MEMBER },
      { postId: POST, extra: "1" },
      { href: "https://ailleurs.example" },
      ["postId", POST],
      "texte",
      12,
    ]) {
      expect(notificationTarget(data), JSON.stringify(data)).toBeNull();
    }
  });

  it("app ouverte : la bannière d'une activité s'affiche (aucune conversation n'est concernée)", () => {
    setOpenConversation(CONVERSATION);
    expect(shouldShowBanner({ postId: POST })).toBe(true);
    expect(shouldShowBanner({ screen: "requests" })).toBe(true);
  });
});

describe("notifications d'activité : le réglage", () => {
  const settings = read("app/(app)/settings.tsx");
  const setting = read("components/activity-push-setting.tsx");

  it("dans les Réglages, juste après « Alertes prix et stock », sans rien entre les deux ; une seule fois", () => {
    const alerts = settings.indexOf("<WishAlertsSetting />");
    const activity = settings.indexOf("<ActivityPushSetting />");
    expect(alerts).toBeGreaterThan(-1);
    expect(activity).toBeGreaterThan(alerts);
    expect(settings.slice(alerts + "<WishAlertsSetting />".length, activity).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim()).toBe("");
    expect(settings.match(/<ActivityPushSetting \/>/g)).toHaveLength(1);
    // Les réglages des messages se suivent toujours, avant (tests « l'explication d'abord » ci-dessus).
    expect(activity).toBeGreaterThan(settings.indexOf("<MessagePushSetting />"));
  });

  it("caché sur le site, sans le module natif, et tant que le serveur ne les propose pas", () => {
    expect(setting).toContain("if (!activityPushPossible({ platform: Platform.OS, status, supported: device?.supported ?? false })) return null;");
    expect(setting).toContain('if (Platform.OS !== "ios" || !userId) return;');
  });

  it("un titre, une ligne d'explication, quatre interrupteurs nommés (VoiceOver), éteints tant que rien n'est accepté", () => {
    expect(setting).toContain("{t.activityPush.title}");
    expect(setting).toContain("<Text style={styles.body}>{t.activityPush.help}</Text>");
    expect(setting).toContain("{ACTIVITY_PUSH_KINDS.map((kind) => {");
    expect(setting).toContain("accessibilityLabel={t.activityPush[kind]}");
    expect(setting).toContain("<Switch");
    expect(setting).toContain("pushSwitchValue(device.decisions[kind], device.permission)");
    expect(pushSwitchValue(null, "granted")).toBe(false);
    expect(pushSwitchValue("on", "denied")).toBe(false);
  });

  it("allumer demande à iOS seulement à ce geste ; couper fait oublier la sorte ; un échec revient en arrière, avec un message", () => {
    const toggle = setting.slice(setting.indexOf("async function toggle("), setting.indexOf("if (!activityPushPossible("));
    expect(toggle).toContain("if (!on) await disablePush(userId, kind);");
    expect(toggle).toContain('else if ((await enablePush(userId, kind)) !== "granted") showToast(t.activityPush.denied);');
    expect(toggle).toContain("showToast(t.push.settingFailed);");
    expect(toggle).toContain("setPending(null);");
    expect(toggle).toContain("await reload();");
    // iOS les refuse : on dit où les autoriser.
    expect(setting).toContain("{t.activityPush.denied}");
    expect(setting).toContain("Linking.openSettings()");
  });
});

describe("notifications d'activité : textes en français et en anglais", () => {
  it("les mots de la fiche, en vouvoyant", () => {
    const expected: [keyof typeof fr.activityPush, string, string][] = [
      ["title", "Notifications d'activité", "Activity notifications"],
      ["help", "Sur cet iPhone. Elles disent seulement qui a fait quoi, jamais le contenu.", "On this iPhone. They only say who did what, never the content."],
      ["likes", "J'aime", "Likes"],
      ["comments", "Commentaires et réponses", "Comments and replies"],
      ["follows", "Abonnés et demandes d'abonnement", "Followers and follow requests"],
      ["mentions", "Mentions et identifications", "Mentions and tags"],
      ["offerTitle", "Être prévenu(e) sur votre iPhone ?", "Get notified on your iPhone?"],
      [
        "offerBody",
        "Recevez une notification quand quelqu'un aime, commente, s'abonne ou vous mentionne. Vous pourrez choisir dans les Réglages.",
        "Get a notification when someone likes, comments, follows or mentions you. You can choose in Settings.",
      ],
      ["enable", "Activer", "Turn on"],
      ["later", "Plus tard", "Later"],
      ["denied", "Les notifications sont refusées pour Spotto dans les Réglages de l'iPhone.", "Notifications are turned off for Spotto in iPhone Settings."],
    ];
    expect(Object.keys(en.activityPush)).toEqual(Object.keys(fr.activityPush));
    expect(expected.map(([key]) => key)).toEqual(Object.keys(fr.activityPush));
    for (const [key, french, english] of expected) {
      expect(fr.activityPush[key], key).toBe(french);
      expect(en.activityPush[key], key).toBe(english);
    }
    const french = Object.values(fr.activityPush).join("\n");
    expect(french).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi|te)(?!\p{L})/iu);
  });

  it("la politique de confidentialité le dit, en français et en anglais : qui a fait quoi, jamais un commentaire ni une image", () => {
    const frPolicy = read("legal/confidentialite.ts");
    expect(frPolicy).toContain("Notifications d'activité : si vous les activez, ${BRAND} envoie sur votre iPhone une notification quand un membre aime ou commente votre publication");
    expect(frPolicy).toContain("Chaque type a son interrupteur dans les Réglages, éteint au départ");
    expect(frPolicy).toContain("La notification passe par le service d'Expo puis par Apple ; elle contient le nom d'utilisateur du membre et une phrase fixe, jamais le texte d'un commentaire ni une image.");
    expect(frPolicy).toContain("Une notification d'activité contient seulement « ${BRAND} », le nom d'utilisateur du membre et une phrase fixe");
    const enPolicy = read("legal/confidentialite.en.ts");
    expect(enPolicy).toContain("Activity notifications: if you turn them on, ${BRAND} sends a notification to your iPhone when a member likes or comments on your post");
    expect(enPolicy).toContain("The notification goes through Expo's service and then Apple; it contains the member's username and a fixed sentence, never the text of a comment or an image.");
    expect(enPolicy).toContain("An activity notification only contains “${BRAND}”, the member's username and a fixed sentence");
  });
});
