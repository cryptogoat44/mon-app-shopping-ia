import { describe, expect, it, vi } from "vitest";
import type { Profile } from "@monapp/shared-types";
import { resolveRootRoute } from "../src/lib/root-route";
import { RetryCancelledError, retryWithDelays } from "../src/lib/retry";

function profile(username: string | null): Profile {
  return {
    id: "u1",
    username,
    displayName: "Camille",
    avatarUrl: null,
    bio: null,
    locale: "fr",
    defaultPrivacy: "followers",
    followersCount: 0,
    followingCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const session = { user: { id: "u1" } };

describe("resolveRootRoute (audit Lot Q, ROB-01)", () => {
  it("attend la session avant toute décision", () => {
    expect(resolveRootRoute({ session: undefined, profileStatus: "idle", profile: null })).toBe("splash");
  });

  it("envoie vers l'accueil sans session", () => {
    expect(resolveRootRoute({ session: null, profileStatus: "idle", profile: null })).toBe("welcome");
  });

  it("garde l'écran de démarrage pendant le premier chargement du profil", () => {
    expect(resolveRootRoute({ session, profileStatus: "loading", profile: null })).toBe("splash");
  });

  it("n'envoie JAMAIS vers 'Dernière étape' quand le profil n'a pas pu être chargé", () => {
    expect(resolveRootRoute({ session, profileStatus: "retrying", profile: null })).toBe("unavailable");
    expect(resolveRootRoute({ session, profileStatus: "failed", profile: null })).toBe("unavailable");
  });

  it("envoie vers 'Dernière étape' uniquement pour un profil chargé et incomplet", () => {
    expect(resolveRootRoute({ session, profileStatus: "ready", profile: profile(null) })).toBe("complete-profile");
  });

  it("ouvre l'app pour un profil chargé et complet", () => {
    expect(resolveRootRoute({ session, profileStatus: "ready", profile: profile("camille") })).toBe("app");
  });
});

describe("retryWithDelays", () => {
  const noSleep = vi.fn(async () => {});

  it("réussit dès que la fonction réussit, après des échecs", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("réseau"))
      .mockRejectedValueOnce(new Error("réseau"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(retryWithDelays(fn, { delaysMs: [1, 2, 3], sleep: noSleep, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("abandonne après le dernier délai en relevant la dernière erreur", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("toujours en panne"));
    await expect(retryWithDelays(fn, { delaysMs: [1, 2], sleep: noSleep })).rejects.toThrow("toujours en panne");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("ne réessaie pas une erreur déclarée définitive", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("401"));
    await expect(
      retryWithDelays(fn, { delaysMs: [1, 2], sleep: noSleep, shouldRetry: () => false })
    ).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("s'arrête dès que l'appelant annule", async () => {
    let cancelled = false;
    const fn = vi.fn<() => Promise<string>>().mockImplementation(async () => {
      cancelled = true;
      throw new Error("réseau");
    });
    await expect(
      retryWithDelays(fn, { delaysMs: [1, 2, 3], sleep: noSleep, isCancelled: () => cancelled })
    ).rejects.toBeInstanceOf(RetryCancelledError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
