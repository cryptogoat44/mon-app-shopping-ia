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

// Statistiques d'usage : seul l'appel (« lien marchand ouvert ») est observé.
vi.mock("../src/lib/analytics", () => ({ track: vi.fn() }));

import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { track } from "../src/lib/analytics";
import { trackProductMatchClick } from "../src/lib/api";
import { openMerchantLink, openMerchantLinkWeb } from "../src/lib/merchant-links";

const trackMock = vi.mocked(trackProductMatchClick);
const openBrowserMock = vi.mocked(WebBrowser.openBrowserAsync);
const analyticsMock = vi.mocked(track);

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
  analyticsMock.mockClear();
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

// Un lien qui n'est pas une adresse web ordinaire (javascript:, data:…), par
// exemple venu de l'envie d'une autre personne : refusé avant tout le reste,
// sur le site comme sur iPhone. Aucun message : le bouton ne fait rien.
describe("lien qui n'est pas une adresse web : rien ne s'ouvre, rien n'est compté", () => {
  const SCRIPT_LINK = "javascript:alert(document.cookie)";

  it("openMerchantLinkWeb : ni window.open, ni suivi, ni lien de secours (même si le navigateur bloquerait)", () => {
    const openFn = vi.fn(() => null);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);

    const result = openMerchantLinkWeb({ matchId: "match-web-refused", url: SCRIPT_LINK, context: "wishlist" });

    expect(openFn).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(result).toEqual({ blocked: false });
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/x",
  ])("openMerchantLink sur le site : %j n'ouvre rien et ne compte rien", async (link) => {
    const openFn = vi.fn(() => createFakeTab());
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);

    const result = await openMerchantLink({ matchId: `match-refused-${link}`, url: link, context: "post" });

    expect(openFn).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(analyticsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ blocked: false });
  });

  it("openMerchantLink sur iPhone : jamais le navigateur intégré, aucun suivi", async () => {
    Platform.OS = "ios";

    const result = await openMerchantLink({ matchId: "match-native-refused", url: SCRIPT_LINK, context: "received" });

    expect(openBrowserMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
    expect(analyticsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ blocked: false });
  });

  it("le lien https de la même pièce, juste après un lien refusé, s'ouvre comme avant (aucun anti-double-clic consommé)", async () => {
    const tab = createFakeTab();
    const openFn = vi.fn(() => tab);
    vi.stubGlobal("window", { open: openFn } satisfies FakeWindow);

    await openMerchantLink({ matchId: "match-after-refused", url: SCRIPT_LINK, context: "post" });
    const result = await openMerchantLink({ matchId: "match-after-refused", url: "https://marchand.example/affilie", context: "post" });

    expect(openFn).toHaveBeenCalledOnce();
    expect(openFn).toHaveBeenCalledWith("https://marchand.example/affilie", "_blank");
    expect(tab.opener).toBeNull();
    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith("match-after-refused", "post");
    expect(analyticsMock).toHaveBeenCalledOnce();
    expect(analyticsMock).toHaveBeenCalledWith("merchant_link_opened", { context: "post" });
    expect(result).toEqual({ blocked: false });
  });

  it("une ouverture https bloquée par le navigateur rend toujours le lien de secours vérifié", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => null) } satisfies FakeWindow);

    const result = await openMerchantLink({ matchId: "match-blocked-https", url: "https://marchand.example/affilie", context: "wishlist" });

    expect(result).toEqual({ blocked: true, url: "https://marchand.example/affilie" });
  });
});

// Prix d'abord (2026-11-03) : depuis l'écran Résultat, la statistique du clic
// dit aussi le rang d'origine et la place affichée ; le clic enregistré par
// le serveur, lui, ne change pas (la proposition, donc son rang d'origine).
describe("prix d'abord : place de la proposition dans la statistique du clic", () => {
  it("écran Résultat : rang d'origine, place affichée et section « Sans prix » ajoutés", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => createFakeTab()) } satisfies FakeWindow);

    await openMerchantLink({
      matchId: "match-prix-d-abord",
      url: "https://marchand.example/sans-prix",
      context: "result",
      placement: { rank: 3, displayed_position: 9, in_no_price_section: true },
    });

    expect(analyticsMock).toHaveBeenCalledOnce();
    expect(analyticsMock).toHaveBeenCalledWith("merchant_link_opened", { context: "result", rank: 3, displayed_position: 9, in_no_price_section: true });
    expect(trackMock).toHaveBeenCalledWith("match-prix-d-abord", "result");
  });

  it("sans place (Envies, Vault, publication…) : le même événement qu'avant, le contexte seul", async () => {
    vi.stubGlobal("window", { open: vi.fn(() => createFakeTab()) } satisfies FakeWindow);

    await openMerchantLink({ matchId: "match-envie", url: "https://marchand.example/envie", context: "wishlist" });

    expect(analyticsMock).toHaveBeenCalledWith("merchant_link_opened", { context: "wishlist" });
  });
});
