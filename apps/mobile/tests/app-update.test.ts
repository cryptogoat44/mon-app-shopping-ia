import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « app iPhone prête » (chantier 4, point 11) : mise à jour obligatoire.
// Le serveur fixe un build minimal ; l'app iPhone donne son build à chaque
// appel et affiche « Mettez à jour Spotto » sous ce minimum. Le site n'envoie
// jamais de build : il n'est jamais concerné. `fetch` est simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { fetchAppVersionInfo, fetchMyProfile } from "../src/lib/api";
import {
  __resetUpdateRequired,
  appBuildHeaders,
  isBelowMinimum,
  isUpdateRequiredResponse,
  markUpdateRequired,
  parseBuildNumber,
  peekUpdateRequired,
  readAppVersionInfo,
  setAppBuild,
  shouldCheckVersion,
  subscribeUpdateRequired,
  VERSION_CHECK_INTERVAL_MS,
} from "../src/lib/app-update";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

const STORE = "https://apps.apple.com/fr/app/spotto/id1234567890";

beforeEach(() => {
  __resetUpdateRequired();
  setAppBuild(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("logique de la version minimale", () => {
  it("numéro de build : entier positif seulement", () => {
    expect(parseBuildNumber("12")).toBe(12);
    expect(parseBuildNumber(" 3 ")).toBe(3);
    expect(parseBuildNumber(7)).toBe(7);
    for (const valeur of [null, undefined, "", "0", "1.0.3", "abc", -2, 1.5]) expect(parseBuildNumber(valeur)).toBeNull();
  });

  it("réponse du serveur lue prudemment ; seule une adresse de l'App Store est gardée", () => {
    expect(readAppVersionInfo({ ios: { minimumBuild: 12, storeUrl: STORE } })).toEqual({ minimumBuild: 12, storeUrl: STORE });
    expect(readAppVersionInfo({ ios: { minimumBuild: null, storeUrl: null } })).toEqual({ minimumBuild: null, storeUrl: null });
    expect(readAppVersionInfo({ ios: { minimumBuild: "x", storeUrl: "https://piege.example/spotto" } })).toEqual({ minimumBuild: null, storeUrl: null });
    expect(readAppVersionInfo(null)).toBeNull();
    expect(readAppVersionInfo({})).toBeNull();
  });

  it("sans build connu (site) ou sans minimum : jamais bloqué", () => {
    expect(isBelowMinimum(11, 12)).toBe(true);
    expect(isBelowMinimum(12, 12)).toBe(false);
    expect(isBelowMinimum(null, 12)).toBe(false);
    expect(isBelowMinimum(11, null)).toBe(false);
  });

  it("réponse 426 « update_required » reconnue, rien d'autre", () => {
    expect(isUpdateRequiredResponse(426, { error: "update_required", message: "…" })).toBe(true);
    expect(isUpdateRequiredResponse(426, { error: "autre" })).toBe(false);
    expect(isUpdateRequiredResponse(400, { error: "update_required" })).toBe(false);
    expect(isUpdateRequiredResponse(426, null)).toBe(false);
  });

  it("une fois exigée, la mise à jour le reste ; une adresse connue n'est pas effacée", () => {
    const listener = vi.fn();
    const stop = subscribeUpdateRequired(listener);
    expect(peekUpdateRequired()).toBeNull();
    markUpdateRequired(STORE);
    markUpdateRequired(null);
    expect(peekUpdateRequired()).toEqual({ storeUrl: STORE });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("lecture du minimum au plus toutes les 5 minutes", () => {
    expect(shouldCheckVersion(null, 1_000)).toBe(true);
    expect(shouldCheckVersion(1_000, 1_000 + VERSION_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheckVersion(1_000, 1_000 + VERSION_CHECK_INTERVAL_MS)).toBe(true);
  });

  it("en-tête de build : seulement quand le build est connu (app iPhone)", () => {
    expect(appBuildHeaders()).toEqual({});
    setAppBuild(17);
    expect(appBuildHeaders()).toEqual({ "x-spotto-build": "17" });
  });
});

describe("appels du serveur (api.ts)", () => {
  it("chaque appel porte le build de l'app iPhone ; une réponse 426 affiche l'écran de mise à jour", async () => {
    setAppBuild(11);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "update_required", message: "…", storeUrl: STORE }), { status: 426 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMyProfile()).rejects.toMatchObject({ status: 426 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ "x-spotto-build": "11", Authorization: "Bearer jeton-factice" });
    expect(peekUpdateRequired()).toEqual({ storeUrl: STORE });
  });

  it("site : aucun en-tête de build ; une autre erreur ne touche à rien", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "internal_error", message: "…" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchMyProfile()).rejects.toMatchObject({ status: 500 });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty("x-spotto-build");
    expect(peekUpdateRequired()).toBeNull();
  });

  it("lecture du minimum sans compte ; réponse en erreur : rien n'est bloqué", async () => {
    setAppBuild(11);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ios: { minimumBuild: 12, storeUrl: STORE } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAppVersionInfo()).toEqual({ minimumBuild: 12, storeUrl: STORE });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/app\/version$/);
    expect(init.headers).not.toHaveProperty("Authorization");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await fetchAppVersionInfo()).toBeNull();
  });
});

describe("écran « Mettez à jour Spotto » : textes FR/EN", () => {
  it("titre clair, et marche à suivre sans adresse", () => {
    expect(fr.appUpdate.title).toBe("Mettez à jour Spotto");
    expect(en.appUpdate.title).toBe("Update Spotto");
    expect(fr.appUpdate.searchStore).toContain("App Store");
    expect(en.appUpdate.searchStore).toContain("App Store");
  });
});
