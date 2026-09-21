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
import { openMerchantLink, openMerchantLinkWeb, resolveTrackedUrl } from "../src/lib/merchant-links";

const trackMock = vi.mocked(trackProductMatchClick);
const openBrowserMock = vi.mocked(WebBrowser.openBrowserAsync);

interface FakeWindow {
  open: ReturnType<typeof vi.fn>;
}

function createFakeTab() {
  return {
    opener: {} as unknown,
    document: { write: vi.fn(), close: vi.fn() },
    location: { href: "" },
  };
}

beforeEach(() => {
  Platform.OS = "web";
  trackMock.mockReset();
  openBrowserMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("resolveTrackedUrl", () => {
  it("returns the tracked URL when tracking succeeds in time", async () => {
    trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });
    const url = await resolveTrackedUrl("match-1", "result", "https://marchand.example/brut");
    expect(url).toBe("https://marchand.example/affilie");
  });

  it("falls back to fallbackUrl when tracking rejects (not logged in, network error...)", async () => {
    trackMock.mockRejectedValue(new Error("Aucune session active"));
    const url = await resolveTrackedUrl("match-1", "result", "https://marchand.example/brut");
    expect(url).toBe("https://marchand.example/brut");
  });

  it("falls back to fallbackUrl when tracking takes longer than the timeout", async () => {
    vi.useFakeTimers();
    trackMock.mockImplementation(() => new Promise(() => {})); // ne se résout jamais
    const promise = resolveTrackedUrl("match-1", "result", "https://marchand.example/brut");
    await vi.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toBe("https://marchand.example/brut");
  });
});

describe("openMerchantLinkWeb", () => {
  it("opens a blank tab synchronously, strips the opener, then redirects to the tracked URL", async () => {
    const tab = createFakeTab();
    const openFn = vi.fn(() => tab);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);
    trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });

    const result = await openMerchantLinkWeb({
      matchId: "match-1",
      fallbackUrl: "https://marchand.example/brut",
      context: "result",
    });

    expect(openFn).toHaveBeenCalledWith("about:blank", "_blank", "noopener");
    expect(tab.opener).toBeNull();
    expect(tab.document.write).toHaveBeenCalledOnce();
    expect(tab.document.write.mock.calls[0][0]).toContain("Redirection");
    expect(tab.document.close).toHaveBeenCalledOnce();
    expect(tab.location.href).toBe("https://marchand.example/affilie");
    expect(result).toEqual({ blocked: false });
  });

  it("redirects straight to fallbackUrl without tracking when there is no matchId", async () => {
    const tab = createFakeTab();
    vi.stubGlobal("window", { open: vi.fn(() => tab) } satisfies FakeWindow);

    await openMerchantLinkWeb({ matchId: null, fallbackUrl: "https://marchand.example/mock", context: "result" });

    expect(trackMock).not.toHaveBeenCalled();
    expect(tab.location.href).toBe("https://marchand.example/mock");
  });

  it("redirects to fallbackUrl when tracking errors (e.g. not logged in)", async () => {
    const tab = createFakeTab();
    vi.stubGlobal("window", { open: vi.fn(() => tab) } satisfies FakeWindow);
    trackMock.mockRejectedValue(new Error("Aucune session active"));

    await openMerchantLinkWeb({
      matchId: "match-1",
      fallbackUrl: "https://marchand.example/brut",
      context: "result",
    });

    expect(tab.location.href).toBe("https://marchand.example/brut");
  });

  it("reports blocked instead of throwing when window.open returns null", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) } satisfies FakeWindow);
    trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });

    const result = await openMerchantLinkWeb({
      matchId: "match-1",
      fallbackUrl: "https://marchand.example/brut",
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
    trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });

    const options = { matchId: "match-debounce", fallbackUrl: "https://marchand.example/brut", context: "result" as const };
    await openMerchantLink(options);
    await openMerchantLink(options);

    expect(openFn).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledOnce();
  });

  it("uses the native browser view on mobile, unaffected by the web fix", async () => {
    Platform.OS = "ios";
    trackMock.mockResolvedValue({ url: "https://marchand.example/affilie" });

    const result = await openMerchantLink({
      matchId: "match-native",
      fallbackUrl: "https://marchand.example/brut",
      context: "result",
    });

    expect(openBrowserMock).toHaveBeenCalledWith("https://marchand.example/affilie");
    expect(result).toEqual({ blocked: false });
  });
});
