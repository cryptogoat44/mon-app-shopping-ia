import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Parcours 3 (branche lot-achat-alerte) : « Vous l'avez achetée ? » au retour
// de la boutique, et l'alerte de baisse de prix allumée par « Garder »
// (décisions du fondateur du 21 novembre 2026 : A1, B1, C1). Logique pure et
// lecture des sources, comme les autres tests de l'app (pas de rendu de
// composants, vitest.config.ts). api.ts et les statistiques sont remplacés :
// rien ne part.
const { track, updateWishAlert, fetchWishAlertsStatus } = vi.hoisted(() => ({
  track: vi.fn(),
  updateWishAlert: vi.fn(),
  fetchWishAlertsStatus: vi.fn(),
}));
vi.mock("../src/lib/api", () => ({ updateWishAlert, fetchWishAlertsStatus }));
vi.mock("../src/lib/analytics", () => ({ track }));

import { LEGAL_DOCUMENT_VERSIONS, type WishAlertState, type WishAlertsStatus } from "@monapp/shared-types";
import type { Piece } from "../src/api/types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import type { LegalDocument } from "../src/legal/types";
import { afterSheetClose, SHEET_CLOSE_FALLBACK_MS } from "../src/lib/after-sheet-close";
import { ANALYTICS_EVENTS, DURATION_MAX_MS, sanitizeProps } from "../src/lib/analytics-events";
import { ApiError } from "../src/lib/api-error";
import { keepAlertAllowed, keepAlertOffRequest, keepAlertOnRequest, keepAlertPossible, keptNoticeAlert, turnOffKeepAlert, turnOnKeepAlert } from "../src/lib/keep-alert";
import {
  addToVaultFromQuestion,
  claimPurchaseQuestion,
  createShopWatcher,
  deviceDay,
  MIN_AWAY_MS,
  noStepFor,
  PURCHASE_CONTEXTS,
  purchaseContextOf,
  purchaseQuestionKey,
  QUESTIONS_PER_DAY,
  questionDue,
  readQuestionMemory,
  SAME_PIECE_DEBOUNCE_MS,
  targetOfPiece,
  targetOfWish,
  vaultItemRoute,
  WEB_HIDE_WINDOW_MS,
  type ShopReturn,
} from "../src/lib/purchase-question";
import { ALERTS_UNAVAILABLE, priceDropNow, priceDropPrices, resetPriceDropsShownForTests, setWishAlertsStatus, trackPriceDropsShown } from "../src/lib/wish-alerts";

const SRC = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");
/** Code sans ses commentaires. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const body = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = files(SRC).map((path) => ({ name: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));

const WISH = "a0000000-0000-4000-8000-000000000001";
const AVAILABLE_SWITCH_OFF: WishAlertsStatus = { available: true, enabled: false, helpOthers: true, push: false };

/** Une proposition réelle, suivable, en euros (recherche en France). */
const piece = (overrides: Partial<Piece> = {}): Piece => ({
  id: "m-1",
  name: "Veste en daim",
  reference: null,
  material: null,
  imageUrl: "https://images.example/veste.jpg",
  imageHdUrl: null,
  priceFrom: 129,
  currency: "€",
  merchantName: "Boutique",
  merchantUrl: "https://boutique.example/veste",
  affiliateUrl: null,
  real: true,
  alertTrackable: true,
  ...overrides,
});

const state = (overrides: Partial<WishAlertState> = {}): WishAlertState => ({
  wishlistItemId: WISH,
  trackable: true,
  bought: false,
  priceDrop: true,
  restock: false,
  soldOut: false,
  stock: "unknown",
  targetPrice: 129,
  targetCurrency: "EUR",
  lastPrice: 89,
  lastCurrency: "EUR",
  ...overrides,
});

const FR_CONTEXT = { country: "fr", bought: false };

beforeEach(() => {
  track.mockReset();
  updateWishAlert.mockReset();
  fetchWishAlertsStatus.mockReset();
  setWishAlertsStatus(AVAILABLE_SWITCH_OFF);
});

afterEach(() => {
  setWishAlertsStatus(ALERTS_UNAVAILABLE);
  vi.useRealTimers();
});

describe("1. « Garder » allume l'alerte de baisse de prix", () => {
  it("permis : pièce suivable, alertes disponibles → PUT { priceDrop: true, restock: false }, sans seuil ni interrupteur", async () => {
    updateWishAlert.mockResolvedValueOnce(state({ priceDrop: true }));
    const saved = await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save");
    expect(saved?.priceDrop).toBe(true);
    expect(updateWishAlert.mock.calls).toEqual([[WISH, { priceDrop: true, restock: false }]]);
    const sent = updateWishAlert.mock.calls[0]![1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("targetPrice");
    expect(sent).not.toHaveProperty("enableAlerts");
    expect(keepAlertOnRequest()).toEqual({ priceDrop: true, restock: false });
    // Sans prix : le serveur fixera le premier prix vu.
    expect(keepAlertPossible(piece({ priceFrom: null, currency: null }), FR_CONTEXT)).toBe(true);
  });

  it("refusé : clé absente, alertes indisponibles, pièce de démonstration, « Boutique à l'étranger » → aucun appel", async () => {
    for (const refused of [piece({ alertTrackable: undefined }), piece({ alertTrackable: false }), piece({ real: false }), piece({ priceFrom: 140, currency: "USD" }), piece({ priceFrom: 140, currency: null })]) {
      expect(await turnOnKeepAlert(WISH, refused, FR_CONTEXT, "save")).toBeNull();
    }
    // Déjà au Vault, ou pays que les alertes ne suivent pas.
    expect(await turnOnKeepAlert(WISH, piece(), { country: "fr", bought: true }, "save")).toBeNull();
    expect(await turnOnKeepAlert(WISH, piece({ priceFrom: null, currency: null }), { country: "au", bought: false }, "save")).toBeNull();
    // Alertes indisponibles : l'état relu sur le serveur le confirme, ou ne répond pas.
    setWishAlertsStatus(ALERTS_UNAVAILABLE);
    fetchWishAlertsStatus.mockResolvedValueOnce(ALERTS_UNAVAILABLE);
    expect(await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).toBeNull();
    fetchWishAlertsStatus.mockRejectedValueOnce(new TypeError("réseau"));
    expect(await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).toBeNull();
    expect(updateWishAlert).not.toHaveBeenCalled();
    expect(keepAlertAllowed(ALERTS_UNAVAILABLE, piece(), FR_CONTEXT)).toBe(false);
    expect(track).not.toHaveBeenCalled();
  });

  it("l'écran garde l'Envie et l'état de son alerte, par proposition ; « Garder » passe toujours par addToWishlist", () => {
    const screen = code("app/(app)/spot/result.tsx");
    const keep = body(screen, "async function handleKeep()", "function openCategory()");
    expect(keep).toContain("await addToWishlist(piece);");
    expect(keep).toContain('if (!(await keepPiece(piece, "save"))) setActionError(t.result.keepError);');
    expect(keep).toContain("turnOnKeepAlert(wish.id, piece, { country: keepAlertCountry, bought: bought.has(piece.id) }, origin).catch(() => null)");
    expect(keep).toContain("setKeptWishes((prev) => new Map(prev).set(piece.id, saved));");
    expect(screen).toContain("onPress={handleKeep} disabled={kept.has(piece.id)}");
    expect(code("api/client.ts")).toContain("return await addWishlistItem({");
  });
});

describe("2. L'interrupteur « Alertes prix et stock » (décision A1)", () => {
  it("permis : interrupteur coupé → l'alerte de la pièce est enregistrée quand même", async () => {
    setWishAlertsStatus({ ...AVAILABLE_SWITCH_OFF, enabled: false });
    updateWishAlert.mockResolvedValueOnce(state());
    expect(await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).not.toBeNull();
    expect(updateWishAlert).toHaveBeenCalledTimes(1);
    expect(fetchWishAlertsStatus).not.toHaveBeenCalled();
  });

  it("refusé : jamais de PUT /api/alerts/settings, d'enableAlerts, de syncPushDevice ni de lecture de toutes les cloches depuis ce lot", () => {
    const lot = [
      "lib/keep-alert.ts",
      "lib/purchase-question.ts",
      "lib/use-purchase-question.ts",
      "components/purchase-question-sheet.tsx",
      "components/kept-notice.tsx",
      "app/(app)/spot/result.tsx",
      "app/(app)/envie.tsx",
    ];
    for (const path of lot) {
      const text = code(path);
      for (const forbidden of ["updateWishAlertsSettings", "enableAlerts", "syncPushDevice", "fetchWishAlertStates", "/api/alerts/settings"]) {
        expect(text, `${path} : ${forbidden}`).not.toContain(forbidden);
      }
    }
    expect(keepAlertOnRequest()).not.toHaveProperty("enableAlerts");
    // La cloche (et son explication des notifications) ne change pas.
    expect(read("components/wish-alert-sheet.tsx")).not.toContain("Parcours 3");
  });
});

describe("3. Un refus de l'alerte ne défait jamais « Garder »", () => {
  it("permis : alerte enregistrée → le message dit la baisse, avec « Couper l'alerte »", async () => {
    updateWishAlert.mockResolvedValueOnce(state());
    expect(await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).not.toBeNull();
    const notice = code("components/kept-notice.tsx");
    expect(notice).toContain('const text = alert === "on" ? t.firstTry.keptWithAlert : alert === "off" ? t.firstTry.alertTurnedOff : t.firstTry.kept;');
    expect(notice).toContain('{alert === "on" && onTurnOff ? (');
    expect(notice).toContain("{t.firstTry.turnOffAlert}");
    expect(fr.firstTry.keptWithAlert).toBe("Ajoutée à vos Envies. Si son prix baisse, vous le verrez dans vos Envies.");
  });

  it("refusé : 422, 404, 429 ou réseau → pièce gardée, message simple, aucune erreur", async () => {
    for (const failure of [
      new ApiError(422, { error: "alert_not_trackable", message: "x" }),
      new ApiError(422, { error: "alert_wish_bought", message: "x" }),
      new ApiError(404, { error: "wishlist_item_not_found", message: "x" }),
      new ApiError(404, { error: "alerts_unavailable", message: "x" }),
      new ApiError(429, { error: "rate_limited", message: "x" }),
      new TypeError("réseau"),
    ]) {
      updateWishAlert.mockRejectedValueOnce(failure);
      await expect(turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).resolves.toBeNull();
    }
    // Une réponse illisible ne compte pas comme allumée.
    updateWishAlert.mockResolvedValueOnce(null);
    expect(await turnOnKeepAlert(WISH, piece(), FR_CONTEXT, "save")).toBeNull();
    expect(track).not.toHaveBeenCalled();
    // L'Envie reste gardée : « none », le message d'avant, sans erreur.
    const keep = body(code("app/(app)/spot/result.tsx"), "async function keepPiece(", "function openCategory()");
    expect(keep).toContain('const saved: KeptWish = { wishId: wish?.id ?? null, alert: alert ? "on" : "none" };');
    expect(keep.indexOf("setKeptSaved")).toBeLessThan(keep.indexOf("} catch {"));
    expect(fr.firstTry.kept).toBe("Ajoutée à vos Envies");
  });
});

describe("4. « Couper l'alerte »", () => {
  it("permis : PUT { priceDrop: false, restock: false }, puis « Alerte coupée. »", async () => {
    updateWishAlert.mockResolvedValueOnce(state({ priceDrop: false }));
    expect(await turnOffKeepAlert(WISH)).toBe(true);
    expect(updateWishAlert.mock.calls).toEqual([[WISH, { priceDrop: false, restock: false }]]);
    expect(keepAlertOffRequest()).toEqual({ priceDrop: false, restock: false });
    expect(track.mock.calls).toEqual([["price_watch_changed", { origin: "undo" }]]);
    expect(fr.firstTry.alertTurnedOff).toBe("Alerte coupée.");
    expect(en.firstTry.alertTurnedOff).toBe("Alert turned off.");
    expect(code("app/(app)/spot/result.tsx")).toContain('if (off) setKeptWishes((prev) => new Map(prev).set(target.id, { wishId, alert: "off" }));');
  });

  it("refusé : en échec, t.wishAlerts.saveError, et la ligne reste", async () => {
    updateWishAlert.mockRejectedValueOnce(new TypeError("réseau"));
    expect(await turnOffKeepAlert(WISH)).toBe(false);
    expect(track).not.toHaveBeenCalled();
    const notice = code("components/kept-notice.tsx");
    expect(notice).toContain('{failed && alert === "on" ? <ErrorMessage style={styles.error}>{t.wishAlerts.saveError}</ErrorMessage> : null}');
    // L'écran ne passe à « off » qu'une fois l'alerte coupée.
    const off = body(code("app/(app)/spot/result.tsx"), "async function turnOffAlertFor(", "function questionActionsFor(");
    expect(off).toContain("const off = await turnOffKeepAlert(wishId);\n    if (off) setKeptWishes(");
  });
});

describe("5. « Baisse de prix » dans l'app", () => {
  const wish = { priceFrom: 129, currency: "€" };
  const opts = { country: "fr" };

  it("permis : tous les critères réunis, interrupteur coupé compris, Envie gardée en « € » (ou « EUR »)", () => {
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state(), wish, opts)).toBe(true);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state(), { priceFrom: 129, currency: "EUR" }, opts)).toBe(true);
    // Prix au moment de garder inconnu, ou dans une autre devise : le seuil seul.
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state(), { priceFrom: null, currency: null }, opts)).toBe(true);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state(), { priceFrom: 50, currency: "$" }, opts)).toBe(true);
    const drops = priceDropPrices([{ id: WISH, ...wish }], new Map([[WISH, state()]]), AVAILABLE_SWITCH_OFF, "fr", "fr");
    expect([...drops.keys()]).toEqual([WISH]);
    expect(fr.wishAlerts.priceDropAt(drops.get(WISH)!)).toMatch(/^Baisse de prix · 89\s€$/);
    expect(en.wishAlerts.priceDropAt("€89")).toBe("Price drop · €89");
  });

  it("refusé, un critère à la fois : autre devise, prix au seuil ou au-dessus, au-dessus du prix gardé, épuisée, achetée, cloche éteinte, alertes indisponibles", () => {
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ lastCurrency: "GBP" }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ targetCurrency: null }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ lastPrice: 129 }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ lastPrice: 140 }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ lastPrice: null }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ targetPrice: null }), wish, opts)).toBe(false);
    // Seuil remonté au-dessus du prix gardé : pas de fausse baisse.
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ targetPrice: 200, lastPrice: 150 }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ stock: "sold_out" }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ bought: true }), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state(), wish, { country: "fr", inVault: true })).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, state({ priceDrop: false, restock: true }), wish, opts)).toBe(false);
    expect(priceDropNow(ALERTS_UNAVAILABLE, state(), wish, opts)).toBe(false);
    expect(priceDropNow(AVAILABLE_SWITCH_OFF, null, wish, opts)).toBe(false);
  });

  it("affichée sous le prix de la vignette (lue par VoiceOver) et au-dessus du dernier prix vu sur la fiche, sans requête de plus", () => {
    const panel = code("components/wishlist-panel.tsx");
    expect(panel).toContain("{displayPrice(item) ? <Text style={styles.price}>{displayPrice(item)}</Text> : null}\n                    {dropLabel(item.id) ? <Text style={styles.priceDrop}>{dropLabel(item.id)}</Text> : null}");
    expect(panel).toContain('accessibilityLabel={[item.name, dropLabel(item.id)].filter(Boolean).join(", ")}');
    expect(panel).toContain("const drops = priceDropPrices(view.visible, alertStates, alerts, searchCountryFrom(acceptLanguage()), getActiveLocale());");
    const wishScreen = code("app/(app)/envie.tsx");
    expect(wishScreen.indexOf('testID="baisse-de-prix"')).toBeLessThan(wishScreen.indexOf('testID="dernier-prix-vu"'));
    expect(wishScreen).toContain("const drop = priceDropNow(alerts, alertState, { priceFrom: item.priceMin, currency: item.currency }, { country, inVault: item.inVault === true });");
    // Les cloches sont déjà lues : aucune requête de plus.
    expect(panel.match(/fetchWishAlertStates\(/g)?.length).toBe(1);
  });
});

describe("6. Le retour sur l'iPhone", () => {
  const target = targetOfPiece(piece())!;

  it("permis : fenêtre fermée après 30 s, feuille ouverte 700 ms après", async () => {
    let clock = 0;
    const returns: ShopReturn[] = [];
    const watcher = createShopWatcher("ios", () => clock, (back) => returns.push(back));
    await watcher.open(target, "result", async () => {
      clock += 30_000;
      return { blocked: false };
    });
    expect(returns).toEqual([{ target, context: "result", awayMs: 30_000 }]);
    expect(questionDue({ awayMs: 30_000, userId: "u-1", owned: false, sheetOpen: false })).toBe(true);
    // 700 ms après la fin signalée (lib/after-sheet-close.ts) ; sur le site, tout de suite.
    vi.useFakeTimers();
    const run = vi.fn();
    afterSheetClose(false).schedule(run);
    vi.advanceTimersByTime(SHEET_CLOSE_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(SHEET_CLOSE_FALLBACK_MS).toBe(700);
    expect(code("lib/use-purchase-question.ts")).toContain('const afterBrowser = afterSheetClose(Platform.OS !== "ios");');
  });

  it("refusé : fermée après 29 s ; retour immédiat (« locked », double toucher) ; Android", async () => {
    let clock = 0;
    const returns: ShopReturn[] = [];
    const watcher = createShopWatcher("ios", () => clock, (back) => returns.push(back));
    await watcher.open(target, "result", async () => {
      clock += 29_000;
      return { blocked: false };
    });
    expect(questionDue({ awayMs: returns[0]!.awayMs, userId: "u-1", owned: false, sheetOpen: false })).toBe(false);
    // Double toucher, ou fenêtre déjà ouverte : le second appel rend la main tout de suite, ce n'est pas un retour.
    returns.length = 0;
    let close!: () => void;
    const first = watcher.open(target, "result", () => new Promise((resolve) => (close = () => resolve({ blocked: false }))));
    await watcher.open(target, "result", async () => ({ blocked: false }));
    expect(returns).toEqual([]);
    clock += 45_000;
    close();
    await first;
    expect(returns.map((back) => back.awayMs)).toEqual([45_000]);
    // Fenêtre refermée aussitôt, puis la même pièce retouchée dans les 2 s :
    // openMerchantLink n'ouvre rien (même délai, lib/merchant-links.ts), ce n'est pas un retour.
    let quickClock = 0;
    const quick: ShopReturn[] = [];
    const quickWatcher = createShopWatcher("ios", () => quickClock, (back) => quick.push(back));
    await quickWatcher.open(target, "result", async () => {
      quickClock += 800;
      return { blocked: false };
    });
    quickClock += 500;
    await quickWatcher.open(target, "result", async () => ({ blocked: false }));
    expect(quick.map((back) => back.awayMs)).toEqual([800]);
    expect(SAME_PIECE_DEBOUNCE_MS).toBe(2_000);
    expect(read("lib/merchant-links.ts")).toContain("const DEBOUNCE_MS = 2000;");
    // Android : la fenêtre rend la main tout de suite, rien n'est guetté.
    const android: ShopReturn[] = [];
    const other = createShopWatcher("other", () => clock, (back) => android.push(back));
    const opened = vi.fn(async () => ({ blocked: false as const }));
    await other.open(target, "result", opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(android).toEqual([]);
  });
});

describe("7. Le retour sur le site", () => {
  const target = targetOfPiece(piece())!;
  const opened = async () => ({ blocked: false as const });

  it("permis : page cachée moins de 10 s après le clic, revenue après 30 s", async () => {
    let clock = 0;
    const returns: ShopReturn[] = [];
    const watcher = createShopWatcher("web", () => clock, (back) => returns.push(back));
    await watcher.open(target, "similar", opened);
    clock = 2_000;
    watcher.appStateChanged("background");
    clock = 40_000;
    watcher.appStateChanged("active");
    expect(returns).toEqual([{ target, context: "similar", awayMs: 40_000 }]);
    expect(questionDue({ awayMs: 40_000, userId: "u-1", owned: false, sheetOpen: false })).toBe(true);
  });

  it("refusé : page jamais cachée ; cachée plus de 10 s après ; ouverture bloquée ; lien de secours", async () => {
    let clock = 0;
    const returns: ShopReturn[] = [];
    const watcher = createShopWatcher("web", () => clock, (back) => returns.push(back));
    // Jamais cachée (fenêtre à part, onglet en arrière-plan).
    await watcher.open(target, "result", opened);
    clock = 60_000;
    watcher.appStateChanged("active");
    // Cachée trop tard.
    clock = 100_000;
    await watcher.open(target, "result", opened);
    clock += WEB_HIDE_WINDOW_MS + 1;
    watcher.appStateChanged("background");
    clock += 60_000;
    watcher.appStateChanged("active");
    // Ouverture bloquée par le navigateur.
    await watcher.open(target, "result", async () => ({ blocked: true as const, url: "https://boutique.example/veste" }));
    clock += 1_000;
    watcher.appStateChanged("background");
    clock += 60_000;
    watcher.appStateChanged("active");
    expect(returns).toEqual([]);
    // Le lien de secours « Votre navigateur a bloqué l'ouverture… » n'est jamais guetté.
    for (const path of ["app/(app)/spot/result.tsx", "components/proposal-card.tsx", "components/merchant-link-button.tsx"]) {
      expect(code(path), path).toMatch(/WebBrowser\.openBrowserAsync\((blockedMerchantUrl|blockedUrl)\)\.catch\(\(\) => \{\}\);/);
    }
  });
});

/** Stockage factice (AsyncStorage, localStorage) : une table en mémoire, qui peut tomber en panne. */
function memoryStore(failure: { read?: boolean; write?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(key: string) {
      if (failure.read) throw new Error("illisible");
      return data.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      if (failure.write) throw new Error("plein");
      data.set(key, value);
    },
  };
}
const TODAY = new Date(2026, 10, 21, 10, 0);
const LATER_TODAY = new Date(2026, 10, 21, 22, 30);
const TOMORROW = new Date(2026, 10, 22, 9, 0);

describe("8. Une fois par pièce et par jour", () => {
  it("permis : la première fois ; la même pièce le lendemain ; un autre compte sur le même appareil", async () => {
    const store = memoryStore();
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", TODAY)).toBe(true);
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", TOMORROW)).toBe(true);
    expect(await claimPurchaseQuestion(store, "u-2", "m-1", TOMORROW)).toBe(true);
  });

  it("refusé : le même matchId le même jour, même après « Plus tard » (la question compte dès qu'elle s'affiche)", async () => {
    const store = memoryStore();
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", TODAY)).toBe(true);
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", LATER_TODAY)).toBe(false);
    // Réservée avant l'affichage, quelle que soit la réponse : rien n'efface la mémoire à « Plus tard ».
    const hook = code("lib/use-purchase-question.ts");
    expect(hook.indexOf("claimPurchaseQuestion(")).toBeLessThan(hook.indexOf("setQuestion(shown.current);"));
    expect(code("components/purchase-question-sheet.tsx")).not.toMatch(/AsyncStorage|purchaseQuestionKey|claimPurchaseQuestion/);
  });
});

describe("9. Deux questions par jour au plus", () => {
  it("permis : la 2e question du jour, et une question le lendemain", async () => {
    const store = memoryStore();
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", TODAY)).toBe(true);
    expect(await claimPurchaseQuestion(store, "u-1", "m-2", LATER_TODAY)).toBe(true);
    expect(await claimPurchaseQuestion(store, "u-1", "m-3", TOMORROW)).toBe(true);
    expect(QUESTIONS_PER_DAY).toBe(2);
  });

  it("refusé : la 3e du jour", async () => {
    const store = memoryStore();
    await claimPurchaseQuestion(store, "u-1", "m-1", TODAY);
    await claimPurchaseQuestion(store, "u-1", "m-2", TODAY);
    expect(await claimPurchaseQuestion(store, "u-1", "m-3", LATER_TODAY)).toBe(false);
  });
});

describe("10. Jamais pour une pièce déjà au Vault", () => {
  it("permis : pièce hors du Vault", () => {
    expect(questionDue({ awayMs: MIN_AWAY_MS, userId: "u-1", owned: false, sheetOpen: false })).toBe(true);
  });

  it("refusé : « Ajoutée au Vault » (rouvert compris), inVault, ou cloche « achetée »", () => {
    expect(questionDue({ awayMs: 5 * 60_000, userId: "u-1", owned: true, sheetOpen: false })).toBe(false);
    const screen = code("app/(app)/spot/result.tsx");
    expect(screen).toContain("owned: (target) => bought.has(target.matchId),");
    // Résultat rouvert : owned.bought rejoint l'ensemble `bought`.
    expect(screen).toContain("setBought((previous) => withIds(previous, owned.bought));");
    expect(code("app/(app)/envie.tsx")).toContain("owned: () => item?.inVault === true || alertState?.bought === true,");
  });
});

describe("11. Où la question peut être posée", () => {
  it("permis : grande carte, cartes (sections, complément, « Sans prix », lignes triées), fiche d'une Envie avec productMatchId", () => {
    expect(targetOfPiece(piece())).toMatchObject({ matchId: "m-1", title: "Veste en daim" });
    expect(targetOfWish({ productMatchId: "m-9", title: "Veste", imageUrl: "https://images.example/v.jpg", imageHdUrl: null })).toMatchObject({ matchId: "m-9", piece: null });
    expect(PURCHASE_CONTEXTS.map(purchaseContextOf)).toEqual(["result", "similar", "wishlist", "price_alert"]);
    const call = "() => openMerchantLink({ matchId: piece.real ? piece.id : null, url, context: merchantContextFor(piece), placement, mark: merchantMarkFor(piece) }),\n      piece\n    );";
    expect(code("app/(app)/spot/result.tsx")).toContain(`const outcome = await purchase.watch.open(\n      merchantContextFor(piece),\n      ${call}`);
    expect(code("components/proposal-card.tsx")).toContain(`const outcome = await shop.open(\n      merchantContextFor(piece),\n      ${call}`);
    // Toutes ces cartes sont des ProposalCard (lien « Voir chez … » : ShopLink).
    for (const path of ["components/price-sorted-list.tsx", "components/result-complement.tsx", "components/no-price-section.tsx"]) expect(code(path), path).toContain("<ProposalCard");
    expect(code("components/merchant-link-button.tsx")).toContain("const outcome = await shop.open(context, () => openMerchantLink({ matchId, url, context }));");
  });

  it("refusé : Envie sans productMatchId ; pièce de démonstration ; autres contextes ; MerchantLinkButton sans contexte ; seuls result.tsx et envie.tsx fournissent le contexte", async () => {
    expect(targetOfWish({ productMatchId: null, title: "Veste", imageUrl: "https://images.example/v.jpg", imageHdUrl: null })).toBeNull();
    expect(targetOfPiece(piece({ real: false }))).toBeNull();
    for (const context of ["vault", "post", "received"] as const) expect(purchaseContextOf(context)).toBeNull();
    // Sans écran qui guette : la boutique s'ouvre, rien de plus.
    const hook = code("lib/use-purchase-question.ts");
    expect(hook).toContain("const DIRECT: ShopWatch = { open: (_context, open) => open() };");
    expect(hook).toContain("return useContext(ShopWatchContext) ?? DIRECT;");
    const providers = sources.filter((file) => file.text.includes("<ShopWatchContext.Provider")).map((file) => file.name).sort();
    expect(providers).toEqual(["app/(app)/envie.tsx", "app/(app)/spot/result.tsx"]);
    // Le guetteur, sans pièce ou hors des contextes admis : l'ouverture seule.
    const returns: ShopReturn[] = [];
    const watcher = createShopWatcher("ios", () => 0, (back) => returns.push(back));
    await watcher.open(null, "result", async () => ({ blocked: false }));
    await watcher.open(targetOfPiece(piece()), null, async () => ({ blocked: false }));
    expect(returns).toEqual([]);
  });
});

describe("12. Stockage et compte", () => {
  it("permis : stockage lisible, compte connecté ; la mémoire ne garde que le jour, le nombre et les pièces (2 au plus)", async () => {
    const store = memoryStore();
    expect(await claimPurchaseQuestion(store, "u-1", "m-1", TODAY)).toBe(true);
    await claimPurchaseQuestion(store, "u-1", "m-2", TODAY);
    const saved = JSON.parse(store.data.get(purchaseQuestionKey("u-1"))!);
    expect(saved).toEqual({ day: deviceDay(TODAY), count: 2, asked: ["m-1", "m-2"] });
    expect(purchaseQuestionKey("u-1")).toBe("spotto.achat-question.u-1");
    expect(questionDue({ awayMs: MIN_AWAY_MS, userId: "u-1", owned: false, sheetOpen: false })).toBe(true);
  });

  it("refusé : stockage illisible ou aucun compte → pas de question ; un autre jour, la mémoire repart de zéro", async () => {
    expect(await claimPurchaseQuestion(memoryStore({ read: true }), "u-1", "m-1", TODAY)).toBe(false);
    expect(await claimPurchaseQuestion(memoryStore({ write: true }), "u-1", "m-1", TODAY)).toBe(false);
    expect(questionDue({ awayMs: MIN_AWAY_MS, userId: null, owned: false, sheetOpen: false })).toBe(false);
    expect(questionDue({ awayMs: MIN_AWAY_MS, userId: "u-1", owned: false, sheetOpen: true })).toBe(false);
    // La veille : oubliée. Une mémoire du jour mal formée : plus de question aujourd'hui.
    const yesterday = JSON.stringify({ day: "2026-11-20", count: 2, asked: ["m-1", "m-2"] });
    expect(readQuestionMemory(yesterday, "2026-11-21")).toEqual({ day: "2026-11-21", count: 0, asked: [] });
    expect(readQuestionMemory(JSON.stringify({ day: "2026-11-21", count: "deux" }), "2026-11-21").count).toBe(QUESTIONS_PER_DAY);
    expect(readQuestionMemory("{pas du json", "2026-11-21")).toEqual({ day: "2026-11-21", count: 0, asked: [] });
  });
});

describe("13. « Oui, je l'ai achetée »", () => {
  const target = { matchId: "m-1", title: "Veste en daim", imageUrl: "https://images.example/veste.jpg" };

  it("permis : catégorie → la pièce au Vault → « Ajoutée à votre Vault » → « Partager… » ferme la feuille puis ouvre la fiche, et le Vault est prévenu", async () => {
    const add = vi.fn(async () => ({ id: "v-1" }));
    const changed = vi.fn();
    expect(await addToVaultFromQuestion(target, "clothing", { add, changed })).toEqual({ kind: "added", vaultItemId: "v-1", alreadyInVault: false });
    expect(add.mock.calls).toEqual([[{ title: "Veste en daim", imageUrl: "https://images.example/veste.jpg", category: "clothing", productMatchId: "m-1" }]]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await addToVaultFromQuestion(target, "shoes", { add: async () => ({ id: "v-1", alreadyInVault: true }), changed })).toEqual({ kind: "added", vaultItemId: "v-1", alreadyInVault: true });
    expect(vaultItemRoute("v-1")).toEqual({ pathname: "/vault-item/[id]", params: { id: "v-1" } });
    const sheet = code("components/purchase-question-sheet.tsx");
    expect(sheet).toContain("{step.alreadyInVault ? t.retrouverPieces.alreadyInVault : t.result.boughtToast}");
    expect(body(sheet, "function share(", "async function keep(")).toContain("afterClose.schedule(() => router.push(vaultItemRoute(vaultItemId)));\n    onClose();");
    expect(sheet).toContain("onDismiss={() => afterClose.flush()}");
    // Écran Résultat : « Ajoutée au Vault » sur la pièce ; fiche : inVault.
    expect(body(code("app/(app)/spot/result.tsx"), "function questionActionsFor(", "function openReport()")).toContain("setBought((prev) => new Set(prev).add(touched.id));");
    expect(code("app/(app)/envie.tsx")).toContain("setItem((current) => (current ? { ...current, inVault: true } : current));");
  });

  it("refusé : échec réseau → « L'ajout au Vault a échoué. », sans seconde question ; aucune publication sans « Partager dans mon fil »", async () => {
    const changed = vi.fn();
    expect(await addToVaultFromQuestion(target, "clothing", { add: async () => Promise.reject(new TypeError("réseau")), changed })).toEqual({ kind: "failed" });
    expect(changed).not.toHaveBeenCalled();
    expect(fr.result.boughtError).toBe("L'ajout au Vault a échoué.");
    const failed = body(code("components/purchase-question-sheet.tsx"), '{step.kind === "addFailed" ? (', '{step.kind === "added" ? (');
    expect(failed).toContain("{t.result.boughtError}");
    expect(failed).not.toContain("shareTitle");
    for (const path of ["components/purchase-question-sheet.tsx", "lib/use-purchase-question.ts", "lib/purchase-question.ts"]) {
      expect(code(path), path).not.toMatch(/sharePurchasePost|\/api\/posts|post_published/);
    }
  });

  it("correction au passage : « Je l'ai achetée » de l'écran Résultat dit « Déjà dans votre Vault » et prévient le Vault", () => {
    const bought = body(code("app/(app)/spot/result.tsx"), "async function handleBought(", "async function turnOnAlertFor(");
    expect(bought).toContain("await addVaultItemFromMatch(");
    expect(bought).toContain("showToast(added.alreadyInVault === true ? t.retrouverPieces.alreadyInVault : t.result.boughtToast);");
    expect(bought).toContain("vaultChanged();");
  });
});

describe("14. « Non, pas encore »", () => {
  it("permis : pièce pas gardée → « Garder », puis la règle 1, sans changer la grande carte ; Envie connue, cloche éteinte → « Activer l'alerte »", () => {
    expect(noStepFor({ kept: false, wishKnown: false, alertPossible: true, alertOn: false })).toBe("keep_follow");
    expect(noStepFor({ kept: true, wishKnown: true, alertPossible: true, alertOn: false })).toBe("follow");
    const actions = body(code("app/(app)/spot/result.tsx"), "function questionActionsFor(", "function openReport()");
    expect(actions).toContain('const saved = await keepPiece(touched, "question");');
    for (const forbidden of ["handleKeep", "holdPiece", "updateChoice", "selectPiece"]) expect(actions, forbidden).not.toContain(forbidden);
    expect(code("app/(app)/envie.tsx")).toContain('const saved = await turnOnKeepAlert(wish.id, piece, context, "question");');
    expect(fr.result.purchaseQuestion.keepAndFollow).toBe("Garder la pièce et suivre son prix ?");
    expect(fr.result.purchaseQuestion.follow).toBe("Suivre son prix ? Une baisse s'affichera dans vos Envies.");
  });

  it("refusé : cloche déjà allumée ou Envie inconnue → la feuille se ferme ; sans alerte possible → « Garder la pièce ? », sans parler de prix", () => {
    expect(noStepFor({ kept: true, wishKnown: true, alertPossible: true, alertOn: true })).toBe("close");
    expect(noStepFor({ kept: true, wishKnown: false, alertPossible: true, alertOn: false })).toBe("close");
    expect(noStepFor({ kept: true, wishKnown: true, alertPossible: false, alertOn: false })).toBe("close");
    expect(noStepFor({ kept: false, wishKnown: false, alertPossible: false, alertOn: false })).toBe("keep");
    expect(fr.result.purchaseQuestion.keepOnly).toBe("Garder la pièce ?");
    expect(fr.result.purchaseQuestion.keepOnly).not.toMatch(/prix/);
    expect(en.result.purchaseQuestion.keepOnly).not.toMatch(/price/i);
    expect(code("components/purchase-question-sheet.tsx")).toContain('if (next === "close") onClose();');
  });
});

describe("15. La pièce visée", () => {
  it("permis : la carte touchée, gardée du clic au retour", async () => {
    let clock = 0;
    const returns: ShopReturn[] = [];
    const touched = targetOfPiece(piece({ id: "m-touchee", name: "Carte touchée" }))!;
    const watcher = createShopWatcher("web", () => clock, (back) => returns.push(back));
    await watcher.open(touched, "result", async () => ({ blocked: false }));
    clock = 1_000;
    watcher.appStateChanged("background");
    clock = 50_000;
    watcher.appStateChanged("active");
    expect(returns[0]!.target).toBe(touched);
  });

  it("refusé : jamais la grande carte affichée au retour", () => {
    const actions = body(code("app/(app)/spot/result.tsx"), "function questionActionsFor(", "function openReport()");
    expect(actions).toContain("const touched = target.piece;");
    expect(actions.replace(/target\.piece/g, "")).not.toMatch(/\bpiece\b/);
    // Le contexte reçoit la proposition de la carte, pas celle de l'écran.
    expect(code("lib/use-purchase-question.ts")).toContain("const target = piece ? targetOfPiece(piece) : (latest.current.screenTarget ?? null);");
  });
});

describe("16. Statistiques (catalogue fermé, ajout seulement)", () => {
  it("permis : shop_returned à chaque retour (sous 30 s aussi), les autres événements une fois, avec seulement les propriétés admises", () => {
    expect(ANALYTICS_EVENTS.shop_returned).toEqual({ context: { kind: "enum", values: PURCHASE_CONTEXTS }, away_ms: { kind: "duration" } });
    expect(sanitizeProps("shop_returned", { context: "result", away_ms: 12_345 })).toEqual({ context: "result", away_ms: 12_300 });
    expect(sanitizeProps("shop_returned", { context: "wishlist", away_ms: 3_600_000 })).toEqual({ context: "wishlist", away_ms: DURATION_MAX_MS });
    for (const action of ["shown", "yes", "no", "later"]) expect(sanitizeProps("purchase_question", { action, context: "price_alert" })).toEqual({ action, context: "price_alert" });
    for (const origin of ["save", "undo", "question"]) expect(sanitizeProps("price_watch_changed", { origin })).toEqual({ origin });
    expect(sanitizeProps("price_drop_shown", { count: 3 })).toEqual({ count: 3 });
    // Chaque retour repéré est compté avant de décider de la question.
    const hook = code("lib/use-purchase-question.ts");
    expect(hook.indexOf('track("shop_returned", { context: back.context, away_ms: back.awayMs });')).toBeLessThan(hook.indexOf("if (questionDue(facts(back)))"));
    expect(hook.match(/track\("purchase_question", \{ action: "shown"/g)).toHaveLength(1);
    // Une seule réponse par question.
    expect(body(code("components/purchase-question-sheet.tsx"), "function answer(", "function dismiss()")).toContain("if (answered.current || !question) return;\n    answered.current = true;");
    // « Baisse de prix » : une fois au plus tant que l'app reste ouverte.
    resetPriceDropsShownForTests();
    trackPriceDropsShown(0);
    trackPriceDropsShown(2);
    trackPriceDropsShown(5);
    expect(track.mock.calls).toEqual([["price_drop_shown", { count: 2 }]]);
    // Les quatre événements sont à la fin du catalogue (ajout seulement).
    expect(Object.keys(ANALYTICS_EVENTS).slice(-4)).toEqual(["shop_returned", "purchase_question", "price_watch_changed", "price_drop_shown"]);
  });

  it("refusé : rien sans consentement ; jamais de propriété platform, ni pièce, ni boutique, ni prix", async () => {
    const real = await vi.importActual<typeof import("../src/lib/analytics")>("../src/lib/analytics");
    const sent: string[] = [];
    real.__setAnalyticsTestHooks({ apiKey: "phc_test", platform: "ios", sender: (_url, payload) => sent.push(payload) });
    real.setAnalyticsUser("u-1", false);
    real.track("shop_returned", { context: "result", away_ms: 40_000 });
    real.track("purchase_question", { action: "shown", context: "result" });
    expect(sent).toEqual([]);
    real.setAnalyticsUser("u-1", true);
    real.track("purchase_question", { action: "yes", context: "result", matchId: "m-1", title: "Veste", merchant: "Boutique", price: 89 });
    expect(JSON.parse(sent[0]!).properties).toEqual({ action: "yes", context: "result", environment: "development", platform: "ios", $geoip_disable: true, $process_person_profile: false });
    real.setAnalyticsUser(null, false);
    for (const event of ["shop_returned", "purchase_question", "price_watch_changed", "price_drop_shown"] as const) {
      expect(Object.keys(ANALYTICS_EVENTS[event]), event).not.toContain("platform");
      for (const forbidden of ["matchId", "match_id", "url", "merchant", "price", "title", "wishlist_item_id"]) expect(Object.keys(ANALYTICS_EVENTS[event]), event).not.toContain(forbidden);
    }
    expect(sanitizeProps("shop_returned", { context: "vault", away_ms: "longtemps", platform: "tiktok" })).toEqual({});
    // Même règle que les tests du serveur (alertesPrixChemins) : aucun événement qui porte une envie, un membre, une alerte ou un signalement.
    expect(read("lib/analytics-events.ts")).not.toMatch(/wishlistItemId|wishlist_item_id|user_id|userId|stock_report|wish_alert|alert_/);
  });
});

describe("17. Textes (FR avec « vous », EN), juridiques compris", () => {
  const section = (doc: LegalDocument, title: string) => doc.sections.find((s) => s.title === title)!.blocks.flat().join("\n");

  it("permis : les textes de la fiche, en français et en anglais, mêmes clés", () => {
    expect(fr.result.purchaseQuestion).toMatchObject({
      title: "Vous l'avez achetée ?",
      yes: "Oui, je l'ai achetée",
      no: "Non, pas encore",
      later: "Plus tard",
      shareTitle: "La partager dans votre fil ?",
      share: "Partager…",
      noThanks: "Non merci",
      turnOnAlert: "Activer l'alerte",
    });
    expect(en.result.purchaseQuestion).toMatchObject({
      title: "Did you buy it?",
      yes: "Yes, I bought it",
      no: "Not yet",
      later: "Later",
      shareTitle: "Share it in your feed?",
      share: "Share…",
      keepAndFollow: "Save it and follow its price?",
      keepOnly: "Save it?",
      noThanks: "No thanks",
      follow: "Follow its price? A drop will show in your Wishlist.",
      turnOnAlert: "Turn on alert",
    });
    expect(Object.keys(en.result.purchaseQuestion)).toEqual(Object.keys(fr.result.purchaseQuestion));
    expect(en.firstTry.keptWithAlert).toBe("Added to your Wishlist. If its price drops, you'll see it in your Wishlist.");
    expect([fr.firstTry.turnOffAlert, en.firstTry.turnOffAlert]).toEqual(["Couper l'alerte", "Turn off alert"]);
    expect([fr.wishAlerts.priceDrop, en.wishAlerts.priceDrop]).toEqual(["Baisse de prix", "Price drop"]);
    // Vouvoiement.
    for (const text of [fr.firstTry.keptWithAlert, fr.result.purchaseQuestion.title, fr.result.purchaseQuestion.shareTitle, fr.result.purchaseQuestion.follow]) expect(text).toMatch(/\b(vous|votre|vos)\b|Vous/);
    const frTexts = [fr.firstTry.keptWithAlert, fr.firstTry.turnOffAlert, fr.firstTry.alertTurnedOff, ...(Object.values(fr.result.purchaseQuestion) as unknown[]).filter((value): value is string => typeof value === "string")];
    for (const text of frTexts) expect(text).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
  });

  it("permis : la politique (FR et EN) dit l'alerte allumée par « Garder », la baisse dans l'app, la mémoire de la question et ses statistiques, sans nouvelle version", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(section(privacyPolicy, "En bref")).toContain("Quand vous gardez une pièce depuis vos résultats, son alerte de baisse de prix s'allume, si la pièce peut être suivie ; vous pouvez l'éteindre à tout moment.");
    expect(section(privacyPolicyEn, "In short")).toContain("When you save a piece from your results, its price-drop alert turns on, if the piece can be followed; you can turn it off at any time.");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("[À vérifier : alerte allumée d'office quand une pièce est gardée.]");
    expect(section(privacyPolicyEn, "Why, and on what basis")).toContain("[To be verified: alert turned on by default when a piece is saved.]");
    const alertsFr = section(privacyPolicy, "Alertes prix et stock");
    expect(alertsFr).toContain("avec pour seuil le dernier prix vu, ou à défaut le premier prix vu ensuite");
    expect(alertsFr).toContain("il ne commande que l'envoi des alertes, et même coupé, une pièce passée sous son seuil est marquée « Baisse de prix » dans l'app");
    expect(alertsFr).toContain("est marquée « Baisse de prix » dans vos Envies et sur sa fiche");
    expect(section(privacyPolicyEn, "Price and stock alerts")).toContain("even when it is off, a piece that goes below its threshold is marked “Price drop” in the app");
    expect(section(privacyPolicy, "Sur votre téléphone ou dans votre navigateur")).toContain("le jour de la dernière question, le nombre de questions posées ce jour-là et les pièces concernées (deux au plus)");
    expect(section(privacyPolicyEn, "On your phone or in your browser")).toContain("the day of the last question, the number of questions asked that day and the pieces concerned (two at most)");
    // Juste après la phrase des statistiques du Parcours 1, dans la même liste.
    const dataFr = privacyPolicy.sections.find((s) => s.title === "Les données que nous utilisons")!.blocks as string[];
    const stats = dataFr.findIndex((block) => block.startsWith("Des statistiques d'usage, SEULEMENT si vous l'acceptez"));
    expect(dataFr[stats + 1]).toBe("Si vous les acceptez, les statistiques d'usage comptent aussi vos réponses à « Vous l'avez achetée ? », le temps passé dans la boutique avant de revenir et le nombre de « Baisse de prix » affichées dans vos Envies.");
    const dataEn = privacyPolicyEn.sections.find((s) => s.title === "The data we use")!.blocks as string[];
    expect(dataEn[dataEn.findIndex((block) => block.startsWith("Usage statistics, ONLY if you agree")) + 1]).toContain("your answers to “Did you buy it?”, the time spent in the shop before coming back");
  });

  it("refusé : aucun texte en dur dans les fichiers du lot ; plus rien qui dise « Garder » allumer l'interrupteur ; un achat n'est toujours montré que publié", () => {
    const FRENCH = /[àâçéèêëîïôûùüÿœÉÈÀ]|\b(le|la|les|de|des|du|un|une|et|est|sur|vous|votre|vos|pour|avec|aux|Garder|Envies|Partager)\b|[dlnqs]'[a-zà-ÿ]/;
    for (const path of ["components/purchase-question-sheet.tsx", "components/kept-notice.tsx", "lib/use-purchase-question.ts", "lib/purchase-question.ts", "lib/keep-alert.ts"]) {
      const literals = [...code(path).matchAll(/"([^"\n]*)"|>([^<>{}\n]+)</g)].map((match) => match[1] ?? match[2] ?? "");
      expect(literals.filter((text) => FRENCH.test(text) && !/^[\w./@\-[\]]+$/.test(text)), path).toEqual([]);
    }
    const alertsFr = section(privacyPolicy, "Alertes prix et stock");
    expect(alertsFr).toContain("l'interrupteur « Alertes prix et stock » des Réglages est coupé par défaut");
    expect(alertsFr).not.toMatch(/Garder[^.]*allume[^.]*interrupteur/);
    expect(alertsFr).toContain("un achat n'est montré aux autres que si vous choisissez de le publier");
  });
});

describe("18. Relecture : le message sous la grande carte", () => {
  it("permis : pièce gardée, pas achetée → le message garde l'état de son alerte (allumée, coupée)", () => {
    expect(keptNoticeAlert({ wishId: WISH, alert: "on" }, false)).toBe("on");
    expect(keptNoticeAlert({ wishId: WISH, alert: "off" }, false)).toBe("off");
    expect(keptNoticeAlert(undefined, false)).toBe("none");
  });

  it("refusé : pièce achetée (« Je l'ai achetée » ou « Oui ») → plus de promesse de baisse ni de « Couper l'alerte »", () => {
    expect(keptNoticeAlert({ wishId: WISH, alert: "on" }, true)).toBe("none");
    expect(keptNoticeAlert({ wishId: WISH, alert: "off" }, true)).toBe("none");
    // L'écran passe par cette décision, avec les pièces achetées pendant la visite (les deux chemins remplissent `bought`).
    const screen = code("app/(app)/spot/result.tsx");
    expect(screen).toContain("alert={keptNoticeAlert(keptWishes.get(piece.id), bought.has(piece.id))}");
    expect(screen).not.toContain('alert={keptWishes.get(piece.id)?.alert ?? "none"}');
    expect(body(screen, "async function handleBought(", "async function turnOnAlertFor(")).toContain("setBought((prev) => new Set(prev).add(target.id));");
    expect(body(screen, "addToVault: async (category) => {", "noStep: () =>")).toContain('if (outcome.kind === "added") {\n          setBought((prev) => new Set(prev).add(touched.id));');
  });
});

describe("19. Relecture : l'état de « Couper l'alerte » reste à sa pièce", () => {
  /** Les rendus de KeptNotice sans clé : React y garderait l'état (en cours, en échec) d'une autre pièce. */
  const withoutKey = (source: string) => (source.match(/<KeptNotice\b[\s\S]*?\/>/g) ?? []).filter((tag) => !/\bkey=\{piece\.id\}/.test(tag));

  it("permis : le message sous la grande carte a une clé par pièce", () => {
    const screen = code("app/(app)/spot/result.tsx");
    expect(screen).toContain("<KeptNotice key={piece.id} ");
    expect(withoutKey(screen)).toEqual([]);
    // L'état « en cours » et « en échec » est propre à chaque instance du message.
    const notice = code("components/kept-notice.tsx");
    expect(notice).toContain("const [busy, setBusy] = useState(false);");
    expect(notice).toContain("const [failed, setFailed] = useState(false);");
  });

  it("refusé : un message sans clé (l'erreur de la pièce A s'afficherait sous la pièce B) est repéré", () => {
    expect(withoutKey("<KeptNotice onOpen={open} alert={alert} onTurnOff={off} />")).toHaveLength(1);
    expect(withoutKey("<KeptNotice key={other.id} onOpen={open} />")).toHaveLength(1);
    for (const { name, text } of sources) if (text.includes("<KeptNotice")) expect(withoutKey(text), name).toEqual([]);
  });
});

describe("20. Relecture : « Vous l'avez achetée ? » défile sur un petit écran", () => {
  /** La feuille est plafonnée et toutes ses étapes (pièce, question, catégories…) sont dans une zone qui défile. */
  const scrolls = (source: string) => {
    const open = source.indexOf("<ScrollView");
    const close = source.indexOf("</ScrollView>");
    const sheetStyle = body(source, "  sheet: {", "},");
    return (
      /maxHeight: "\d+%"/.test(sheetStyle) &&
      open !== -1 &&
      open > source.indexOf("<View style={styles.grab} />") &&
      ['{target ? (', '{step.kind === "ask" ? (', '{step.kind === "category" ? (', '{step.kind === "done" ? ('].every((part) => {
        const at = source.indexOf(part);
        return at > open && at < close;
      })
    );
  };

  it("permis : feuille à 90 % de l'écran au plus, et les étapes sous la poignée défilent, sans rebond", () => {
    const sheet = code("components/purchase-question-sheet.tsx");
    expect(scrolls(sheet)).toBe(true);
    expect(body(sheet, "  sheet: {", "},")).toContain('maxHeight: "90%",');
    expect(sheet).toContain('<ScrollView style={styles.scroll} bounces={false} testID="vous-l-avez-achetee-defilement">');
    expect(sheet).toContain("scroll: { flexGrow: 0, flexShrink: 1 },");
  });

  it("refusé : sans plafond, ou la catégorie hors de la zone qui défile (les dernières catégories hors de l'écran)", () => {
    const sheet = code("components/purchase-question-sheet.tsx");
    expect(scrolls(sheet.replace('maxHeight: "90%",', ""))).toBe(false);
    expect(scrolls(sheet.replace("<ScrollView", "<View").replace("</ScrollView>", "</View>"))).toBe(false);
    const categoryOutside = sheet.replace('{step.kind === "category" ? (', "").replace("</ScrollView>", '</ScrollView>{step.kind === "category" ? (');
    expect(scrolls(categoryOutside)).toBe(false);
  });
});

describe("Mode d'emploi et fiche Apple", () => {
  it("STATISTIQUES.md : les entonnoirs « Retour de boutique » et « Alerte », et la lecture de away_ms, avec des événements du catalogue", () => {
    const guide = readFileSync(join(__dirname, "../STATISTIQUES.md"), "utf8");
    const part = guide.slice(guide.indexOf("## Après la boutique"), guide.indexOf("## Les limites"));
    for (const step of ["merchant_link_opened", "shop_returned", "purchase_question", "vault_item_added", "post_published", "wishlist_item_added", "price_watch_changed", "price_drop_shown"]) {
      expect(part, step).toContain(`\`${step}\``);
      expect(Object.keys(ANALYTICS_EVENTS)).toContain(step);
    }
    expect(part).toContain("### Entonnoir « Retour de boutique »");
    expect(part).toContain("### Entonnoir « Alerte »");
    expect(part).toContain("### Lire `away_ms` (pour régler les 30 secondes)");
    expect(part).toContain("`away_ms` **less than**\n   `30000`");
  });

  it("CONFIDENTIALITE-APPLE.md : les nouveaux événements en « Interaction avec le produit », rien de nouveau à cocher", () => {
    const apple = readFileSync(join(__dirname, "../app-store/CONFIDENTIALITE-APPLE.md"), "utf8");
    const interaction = apple.split("\n").find((line) => line.startsWith("| **Interaction avec le produit**"))!;
    for (const event of ["shop_returned", "purchase_question", "price_watch_changed", "price_drop_shown"]) expect(interaction, event).toContain(`\`${event}\``);
    const review = apple.slice(apple.indexOf("## 6. Quand revoir ces réponses"), apple.indexOf("## 7. BROUILLON"));
    expect(review).toContain("le **Parcours 3**");
    expect(review).toContain("Aucun type de donnée nouveau, rien en « Suivi »");
  });
});

