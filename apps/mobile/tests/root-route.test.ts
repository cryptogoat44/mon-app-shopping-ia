import { describe, expect, it, vi } from "vitest";
import type { Profile } from "@monapp/shared-types";
import { resolveRootRoute, rootContent, showsNavigator } from "../src/lib/root-route";
import { AttemptTimeoutError, RetryCancelledError, retryWithDelays, withTimeout } from "../src/lib/retry";

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
    postsCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    isAdmin: false,
    pieceSendsFrom: "following",
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

describe("navigation pendant l'écran de démarrage (lot 3bis)", () => {
  it("retirée au démarrage et pendant le chargement du profil, affichée ensuite", () => {
    expect(showsNavigator("splash", "/", true)).toBe(false);
    expect(showsNavigator("splash", "/sign-in", true)).toBe(false);
    expect(showsNavigator("app", "/", true)).toBe(true);
  });

  it("gardée sur le nouveau mot de passe : la session du lien de l'e-mail recharge le profil sans fermer le formulaire", () => {
    // Constaté sur iPhone : lien ouvert app déconnectée → accueil de l'app, sans formulaire.
    expect(showsNavigator("splash", "/nouveau-mot-de-passe", true)).toBe(true);
  });

  it("police éditoriale pas encore prête : rien n'est affiché, nouveau mot de passe compris", () => {
    expect(showsNavigator("splash", "/nouveau-mot-de-passe", false)).toBe(false);
    expect(showsNavigator("splash", "/", false)).toBe(false);
  });
});

describe("démarrage du site : jamais une page vide (défaut repéré le 2026-10-16)", () => {
  it("site : l'écran d'attente pendant le démarrage, police prête ou non", () => {
    expect(rootContent("splash", "/", true, "web")).toBe("waiting");
    expect(rootContent("splash", "/", false, "web")).toBe("waiting");
    expect(rootContent("app", "/", false, "web")).toBe("waiting");
  });

  it("iPhone : l'écran de démarrage du système reste affiché", () => {
    expect(rootContent("splash", "/", true, "ios")).toBe("native-splash");
  });

  it("navigation affichée dès que la route est connue, sur le site comme sur iPhone", () => {
    expect(rootContent("app", "/", true, "web")).toBe("navigator");
    expect(rootContent("unavailable", "/", true, "ios")).toBe("navigator");
    expect(rootContent("splash", "/nouveau-mot-de-passe", true, "web")).toBe("navigator");
  });
});

describe("essai de chargement du profil limité dans le temps", () => {
  it("un appel qui répond à temps passe tel quel", async () => {
    await expect(withTimeout(1_000, async () => "profil")).resolves.toBe("profil");
  });

  it("un appel sans réponse est abandonné : signal déclenché, AttemptTimeoutError", async () => {
    let received: AbortSignal | null = null;
    const neverAnswers = (signal: AbortSignal) => {
      received = signal;
      return new Promise<string>(() => {});
    };
    await expect(withTimeout(20, neverAnswers)).rejects.toBeInstanceOf(AttemptTimeoutError);
    expect(received!.aborted).toBe(true);
  });

  it("une autre erreur remonte telle quelle", async () => {
    await expect(withTimeout(1_000, async () => Promise.reject(new Error("401")))).rejects.toThrow("401");
  });

  it("avec les relances : le premier essai reste sans réponse, le second réussit", async () => {
    let calls = 0;
    const task = (signal: AbortSignal) => {
      calls += 1;
      if (calls === 1) return new Promise<string>((_, reject) => signal.addEventListener("abort", () => reject(new Error("abandonné"))));
      return Promise.resolve("profil");
    };
    const onRetry = vi.fn();
    const result = retryWithDelays(() => withTimeout(20, task), { delaysMs: [1], sleep: async () => {}, onRetry });
    await expect(result).resolves.toBe("profil");
    expect(calls).toBe(2);
    expect(onRetry.mock.calls[0]![1]).toBeInstanceOf(AttemptTimeoutError);
  });
});
