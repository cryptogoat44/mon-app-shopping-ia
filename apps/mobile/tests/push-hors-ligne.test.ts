import { beforeEach, describe, expect, it, vi } from "vitest";

// Lot « découverte », relecture 13-02 : couper une notification d'activité
// hors réseau. lib/push.ts avec ses modules simulés (iPhone, rangement de
// l'appareil, module natif, appels au serveur) : disablePush échoue, mais
// « off » est déjà gardé sur l'iPhone et l'oubli de l'appareil est noté ; au
// retour du réseau, le serveur l'apprend. Relu par le réglage, l'interrupteur
// reste donc coupé : pas de message « n'a pas pu être enregistré »
// (components/activity-push-setting.tsx, switchRolledBack de push-state.ts).
const { store, api, failWrites, TOKEN } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  api: { registerPushToken: vi.fn(), deletePushToken: vi.fn(), forgetPushTokenWithoutSession: vi.fn() },
  failWrites: { on: false },
  TOKEN: "ExponentPushToken[abcdefghijklmnop01]",
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (failWrites.on) throw new Error("rangement plein");
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
  },
}));
vi.mock("expo-constants", () => ({ default: { easConfig: { projectId: "0f8f7c2e-1234-4abc-9def-0123456789ab" } } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => ({}) }));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ granted: true, status: "granted" }),
  getExpoPushTokenAsync: async () => ({ data: TOKEN }),
}));
vi.mock("../src/lib/api", () => api);

import { setMessagesStatus } from "../src/lib/conversations";
import { disablePush, enablePush, flushPendingForget, loadActivityDecisions, refreshPushToken } from "../src/lib/push";
import { PENDING_FORGET_KEY } from "../src/lib/push-forget";
import { PUSH_TOKEN_KEY, pushDecisionKey, switchRolledBack } from "../src/lib/push-state";

const USER = "a0000000-0000-4000-8000-000000000001";
const offline = () => new TypeError("Network request failed");

/** L'interrupteur d'une sorte, relu sur l'iPhone comme le fait le réglage : revient-il en arrière ? */
async function rolledBack(wanted: boolean): Promise<boolean> {
  return switchRolledBack(wanted, { decision: (await loadActivityDecisions(USER)).likes, permission: "granted" });
}

beforeEach(() => {
  vi.resetAllMocks();
  store.clear();
  failWrites.on = false;
  // Le serveur propose l'activité ; cet iPhone est enregistré.
  setMessagesStatus({ enabled: true, unreadCount: 0, push: true, actions: false, activityPush: true });
  store.set(PUSH_TOKEN_KEY, TOKEN);
  store.set(pushDecisionKey(USER, "likes"), "on");
});

describe("couper les « j'aime » hors réseau", () => {
  it("la dernière sorte allumée : l'oubli échoue, mais « off » est gardé et l'oubli noté ; l'interrupteur reste coupé, sans message", async () => {
    api.deletePushToken.mockRejectedValue(offline());
    await expect(disablePush(USER, "likes")).rejects.toThrow("Network request failed");
    expect(store.get(pushDecisionKey(USER, "likes"))).toBe("off");
    expect(store.get(PENDING_FORGET_KEY)).toBe(TOKEN);
    expect(await rolledBack(false)).toBe(false);
    // Retour du réseau (ouverture, premier plan) : l'appareil est oublié.
    await flushPendingForget();
    expect(api.forgetPushTokenWithoutSession).toHaveBeenCalledWith(TOKEN, expect.anything());
    expect(store.has(PENDING_FORGET_KEY)).toBe(false);
  });

  it("une autre sorte reste allumée : réenregistrement puis oubli échouent ; au retour du réseau, l'appareil revient sans les « j'aime »", async () => {
    store.set(pushDecisionKey(USER, "comments"), "on");
    api.registerPushToken.mockRejectedValue(offline());
    api.deletePushToken.mockRejectedValue(offline());
    await expect(disablePush(USER, "likes")).rejects.toThrow("Network request failed");
    expect(store.get(pushDecisionKey(USER, "likes"))).toBe("off");
    expect(store.get(pushDecisionKey(USER, "comments"))).toBe("on");
    expect(store.get(PENDING_FORGET_KEY)).toBe(TOKEN);
    expect(await rolledBack(false)).toBe(false);
    // Retour du réseau : l'oubli noté passe d'abord, puis l'appareil revient pour les commentaires seulement.
    api.registerPushToken.mockResolvedValue(undefined);
    await refreshPushToken(USER);
    expect(api.forgetPushTokenWithoutSession).toHaveBeenCalledWith(TOKEN, expect.anything());
    expect(api.registerPushToken).toHaveBeenLastCalledWith(TOKEN, "ios", false, false, { likes: false, comments: true, follows: false, mentions: false });
    expect(api.forgetPushTokenWithoutSession.mock.invocationCallOrder[0]).toBeLessThan(api.registerPushToken.mock.invocationCallOrder.at(-1)!);
  });

  it("rien n'a pu être gardé sur l'iPhone : l'interrupteur se rallume, avec le message", async () => {
    failWrites.on = true;
    await expect(disablePush(USER, "likes")).rejects.toThrow("rangement plein");
    expect(store.get(pushDecisionKey(USER, "likes"))).toBe("on");
    expect(await rolledBack(false)).toBe(true);
  });
});

describe("allumer les « j'aime » hors réseau", () => {
  it("rien n'est gardé : l'interrupteur se recoupe, avec le message", async () => {
    store.delete(pushDecisionKey(USER, "likes"));
    api.registerPushToken.mockRejectedValue(offline());
    await expect(enablePush(USER, "likes")).rejects.toThrow("Network request failed");
    expect(store.has(pushDecisionKey(USER, "likes"))).toBe(false);
    expect(await rolledBack(true)).toBe(true);
  });
});
