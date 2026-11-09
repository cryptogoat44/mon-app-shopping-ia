import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MessagesStatus } from "@monapp/shared-types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { readMessagesStatus } from "../src/lib/conversations";
import {
  conversationHref,
  conversationIdFromNotification,
  firstTimeHandled,
  parsePushDecision,
  permissionFrom,
  pushDecisionKey,
  pushPossible,
  pushSwitchValue,
  pushSwitchVisible,
  readProjectId,
  setOpenConversation,
  shouldOfferPush,
  shouldRefreshToken,
  shouldShowBanner,
  type PushContext,
} from "../src/lib/push-state";

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
    expect(readMessagesStatus({ enabled: true, unreadCount: 2, push: true })).toEqual({ enabled: true, unreadCount: 2, push: true });
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
    // lib/push.ts et lib/push.web.ts la définissent ; seuls deux composants l'appellent.
    expect(using(/\benablePush\(/)).toEqual(["components/message-push-setting.tsx", "components/push-offer-sheet.tsx", "lib/push.ts", "lib/push.web.ts"]);
    const sheet = read("components/push-offer-sheet.tsx");
    const accept = sheet.slice(sheet.indexOf("async function accept()"), sheet.indexOf("function later()"));
    expect(accept).toContain("await enablePush(userId)");
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
    // Le jeton n'est rafraîchi que si la personne a dit oui et que iOS le permet déjà.
    const refresh = read("lib/push.ts").slice(read("lib/push.ts").indexOf("export async function refreshPushToken"));
    expect(refresh).toContain('(await loadPushDecision(userId)) !== "on"');
    expect(refresh).toContain('!== "granted") return;');
  });

  it("la feuille est proposée après un message envoyé ou reçu, dans l'écran d'une conversation", () => {
    expect(using(/usePushOffer\(/)).toEqual(["app/(app)/conversation.tsx", "components/push-offer-sheet.tsx"]);
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
    expect(later).toContain("disablePush(userId)");
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

  it("dans les Réglages, juste sous « Qui peut m'écrire »", () => {
    const settings = read("app/(app)/settings.tsx");
    const from = settings.indexOf("<MessagesFromSetting />");
    const push = settings.indexOf("<MessagePushSetting />");
    expect(from).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(from);
    expect(settings.slice(from + "<MessagesFromSetting />".length, push)).not.toMatch(/<[A-Z]\w+ /);
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
    expect(read("lib/use-push-notifications.ts")).toContain("listenToNotifications((id) => router.push(conversationHref(id)))");
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
    expect(signOut.indexOf("await forgetPushToken()")).toBeLessThan(signOut.indexOf("await supabase.auth.signOut()"));
    // Au plus 4 s d'attente.
    expect(read("lib/push.ts")).toContain("withTimeout(FORGET_TIMEOUT_MS, (signal) => deletePushToken(token, signal))");
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
