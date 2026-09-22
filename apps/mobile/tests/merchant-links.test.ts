import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// api.ts importe le client Supabase réel (variables d'environnement,
// session...) — on le remplace entièrement pour ne tester que la logique
// de merchant-links.ts, jamais un vrai appel réseau.
vi.mock("../src/lib/api", () => ({
  trackProductMatchClick: vi.fn(),
}));

// react-native n'a pas besoin d'être chargé pour de vrai : seul Platform.OS
// est lu par le code testé, et Metro le fixe normalement au moment du
// bundle (une notion qui n'existe pas sous Node/Vitest). On le simule ici,
// mutable d'un test à l'autre.
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

vi.mock("expo-web-browser", () => ({
  openBrowserAsync: vi.fn(async () => ({ type: "opened" })),
}));

import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { trackProductMatchClick } from "../src/lib/api";
import { openMerchantLink, openMerchantLinkWeb } from "../src/lib/merchant-links";

const trackMock = vi.mocked(trackProductMatchClick);
const openBrowserMock = vi.mocked(WebBrowser.openBrowserAsync);

interface FakeWindow {
  open: ReturnType<typeof vi.fn>;
}

function createFakeTab() {
  return { opener: {} as unknown };
}

beforeEach(() => {
  Platform.OS = "web";
  trackMock.mockReset();
  trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });
  openBrowserMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openMerchantLinkWeb", () => {
  it("opens the given URL synchronously (no noopener flag) and nulls out win.opener", () => {
    const tab = createFakeTab();
    const openFn = vi.fn(() => tab);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);

    const result = openMerchantLinkWeb({
      matchId: "match-1",
      url: "https://marchand.example/affilie",
      context: "result",
    });

    // Pas de "noopener" : c'est justement ce qui empêchait de récupérer une
    // référence utilisable (voir merchant-links.ts) et cassait le premier
    // correctif — window.open() renvoie null dès que "noopener" est passé,
    // que l'ouverture soit bloquée ou non.
    expect(openFn).toHaveBeenCalledWith("https://marchand.example/affilie", "_blank");
    expect(tab.opener).toBeNull();
    expect(result).toEqual({ blocked: false });
  });

  it("opens the URL immediately without waiting for the click-tracking call to resolve", () => {
    const tab = createFakeTab();
    const openFn = vi.fn(() => tab);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);
    // Le suivi ne se résout jamais — s'il était attendu, ce test resterait bloqué.
    trackMock.mockImplementation(() => new Promise(() => {}));

    const result = openMerchantLinkWeb({ matchId: "match-1", url: "https://marchand.example/affilie", context: "result" });

    expect(result).toEqual({ blocked: false });
    expect(openFn).toHaveBeenCalledOnce();
  });

  it("tracks the click in the background when matchId is present", () => {
    vi.stubGlobal("window", { open: vi.fn(() => createFakeTab()) } satisfies FakeWindow);

    openMerchantLinkWeb({ matchId: "match-1", url: "https://marchand.example/affilie", context: "result" });

    expect(trackMock).toHaveBeenCalledWith("match-1", "result");
  });

  it("does not track when there is no matchId (demo/mock piece)", () => {
    vi.stubGlobal("window", { open: vi.fn(() => createFakeTab()) } satisfies FakeWindow);

    openMerchantLinkWeb({ matchId: null, url: "https://marchand.example/mock", context: "result" });

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("does not throw when the background tracking call rejects (e.g. not logged in)", () => {
    vi.stubGlobal("window", { open: vi.fn(() => createFakeTab()) } satisfies FakeWindow);
    trackMock.mockRejectedValue(new Error("Aucune session active"));

    expect(() =>
      openMerchantLinkWeb({ matchId: "match-1", url: "https://marchand.example/affilie", context: "result" })
    ).not.toThrow();
  });

  it("reports blocked (without throwing) when window.open returns null — a genuine popup block", () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) } satisfies FakeWindow);

    const result = openMerchantLinkWeb({
      matchId: "match-1",
      url: "https://marchand.example/affilie",
      context: "result",
    });

    expect(result).toEqual({ blocked: true, url: "https://marchand.example/affilie" });
  });
});

describe("openMerchantLink (dispatch + anti-double-clic)", () => {
  it("ignores a second call for the same link within the debounce window", async () => {
    const tab = createFakeTab();
    const openFn = vi.fn(() => tab);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);

    const options = { matchId: "match-debounce", url: "https://marchand.example/affilie", context: "result" as const };
    await openMerchantLink(options);
    await openMerchantLink(options);

    expect(openFn).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledOnce();
  });

  it("uses the native in-app browser on mobile, opened immediately, tracked in background", async () => {
    Platform.OS = "ios";
    trackMock.mockImplementation(() => new Promise(() => {})); // ne se résout jamais

    const result = await openMerchantLink({
      matchId: "match-native",
      url: "https://marchand.example/affilie",
      context: "result",
    });

    expect(openBrowserMock).toHaveBeenCalledWith("https://marchand.example/affilie");
    expect(trackMock).toHaveBeenCalledWith("match-native", "result");
    expect(result).toEqual({ blocked: false });
  });
});
