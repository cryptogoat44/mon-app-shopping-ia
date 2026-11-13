import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_VERSIONS, MERCHANT_LINK_CONTEXTS, SOLD_OUT_ALERTS_VISIBLE, type WishAlertState } from "@monapp/shared-types";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { setActiveLocale } from "../src/i18n";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { ApiError } from "../src/lib/api-error";
import {
  ALERTS_UNAVAILABLE,
  activeKinds,
  alertKindsText,
  alertsKeepDevice,
  bellButtonText,
  bellLabel,
  bellOn,
  bellVisible,
  canReportResult,
  canReportWish,
  choiceChanged,
  choiceOf,
  isAlertsUnavailable,
  onWishAlertsStatus,
  pushNote,
  pushNoteText,
  readWishAlertState,
  readWishAlertStates,
  readWishAlertsStatus,
  setWishAlertsStatus,
  stockReportErrorMessage,
  stockReportRequest,
  switchTurnsOn,
  visibleAlertKinds,
  watchErrorMessage,
  watchRequest,
  wishAlertsStatus,
} from "../src/lib/wish-alerts";
import {
  FROM_ALERT,
  alertsPushOn,
  alertsPushPossible,
  alertsPushStep,
  conversationHref,
  deviceRegistration,
  notificationHref,
  notificationTarget,
  pushDecisionKey,
  shouldShowBanner,
  type AlertsPushContext,
} from "../src/lib/push-state";
import { WISHLIST_SEGMENT } from "../src/lib/wishlist-link";

// Lot 2 — alertes prix et stock, côté app. La logique sans écran
// (lib/wish-alerts.ts, lib/push-state.ts), puis les écrans lus comme du texte
// (pas de rendu de composants ici, vitest.config.ts) : la cloche et sa
// feuille, la première cloche qui allume l'interrupteur après l'explication
// des notifications, « Épuisé » caché, « Plus disponible » avec
// confirmation, la notification touchée qui ouvre l'envie, l'appareil gardé
// tant que les messages OU les alertes sont allumés, tout caché sans les
// alertes sur le serveur, les textes FR/EN et la politique de confidentialité.

const ROOT = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const body = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const sources = files(ROOT).map((path) => ({ name: relative(ROOT, path), text: readFileSync(path, "utf8") }));
const using = (pattern: RegExp) => sources.filter((file) => pattern.test(file.text)).map((file) => file.name).sort();

const WISH = "a0000000-0000-4000-8000-000000000001";
const ON = { available: true, enabled: true, push: true };
const state = (overrides: Partial<WishAlertState> = {}): WishAlertState => ({
  wishlistItemId: WISH,
  trackable: true,
  bought: false,
  priceDrop: false,
  restock: false,
  soldOut: false,
  stock: "unknown",
  ...overrides,
});
const apiError = (status: number, error: string) => new ApiError(status, { error, message: "Message du serveur" });

const sheet = read("components/wish-alert-sheet.tsx");
const stockSheet = read("components/stock-report-sheet.tsx");
const setting = read("components/wish-alerts-setting.tsx");
const offer = read("components/push-offer-sheet.tsx");
const envie = read("app/(app)/envie.tsx");
const panel = read("components/wishlist-panel.tsx");
const result = read("app/(app)/spot/result.tsx");
const card = read("components/proposal-card.tsx");
const push = read("lib/push.ts");
const api = read("lib/api.ts");

afterEach(() => {
  setActiveLocale("fr");
  setWishAlertsStatus(ALERTS_UNAVAILABLE);
});

describe("tout est caché sans les alertes sur le serveur (migration 0036 absente)", () => {
  it("seul `available: true` montre les alertes ; sinon interrupteur et notifications valent « non »", () => {
    expect(readWishAlertsStatus({ available: true, enabled: true, push: true })).toEqual(ON);
    expect(readWishAlertsStatus({ available: true })).toEqual({ available: true, enabled: false, push: false });
    for (const body of [null, undefined, "oui", {}, { available: "true", enabled: true, push: true }, { available: false, enabled: true, push: true }]) {
      expect(readWishAlertsStatus(body)).toEqual(ALERTS_UNAVAILABLE);
    }
  });

  it("ni cloche ni « Plus disponible » sans les alertes, même pour une pièce reconnue", () => {
    const real = { real: true, merchantUrl: "https://boutique.example/veste", alertTrackable: true };
    expect(bellVisible(ALERTS_UNAVAILABLE, state())).toBe(false);
    expect(canReportWish(ALERTS_UNAVAILABLE, state())).toBe(false);
    expect(canReportResult(ALERTS_UNAVAILABLE, real)).toBe(false);
    expect(bellVisible(ON, state())).toBe(true);
    expect(canReportResult(ON, real)).toBe(true);
  });

  it("le serveur répond « alerts_unavailable » : l'état partagé passe à « indisponible »", () => {
    expect(isAlertsUnavailable(apiError(404, "alerts_unavailable"))).toBe(true);
    expect(isAlertsUnavailable(apiError(404, "wishlist_item_not_found"))).toBe(false);
    expect(isAlertsUnavailable(new TypeError("réseau"))).toBe(false);
    const forget = body(api, "function forgetAlertsOn(", "/** L'interrupteur");
    expect(forget).toContain("if (isAlertsUnavailable(e)) setWishAlertsStatus(ALERTS_UNAVAILABLE);");
    // Chaque route des alertes (sauf l'état, toujours 200) passe par là.
    expect(api.match(/return forgetAlertsOn\(e\);/g)?.length).toBe(4);
    expect(api).toContain("    forgetAlertsOn(e);\n");
  });

  it("l'état est partagé entre les écrans, qui ne sont prévenus que s'il change", () => {
    const seen: boolean[] = [];
    const stop = onWishAlertsStatus((status) => seen.push(status.enabled));
    setWishAlertsStatus(ON);
    setWishAlertsStatus({ ...ON });
    setWishAlertsStatus({ ...ON, enabled: false });
    stop();
    setWishAlertsStatus(ON);
    expect(seen).toEqual([true, false]);
    expect(wishAlertsStatus()).toEqual(ON);
  });

  it("les écrans ne montrent rien sans `available` (cloche, feuilles, interrupteur, « Plus disponible »)", () => {
    expect(envie).toContain("{bellVisible(alerts, alertState, item.inVault) ? <WishAlertButton");
    expect(envie).toContain("{canReportWish(alerts, alertState) ? (");
    expect(envie).toContain("{alerts.available ? (");
    expect(envie).toContain("setAlertState(status.available ? await fetchWishAlert(id) : null);");
    expect(panel).toContain("{bellVisible(alerts, alertStates.get(item.id)) ? (");
    expect(panel).toContain("{alerts.available ? (\n        <WishAlertSheet");
    expect(panel).toContain("(status.available ? fetchWishAlertStates() : new Map<string, WishAlertState>())");
    expect(result).toContain("{canReportResult(alerts, piece) ? <StockReportLink");
    expect(result).toContain("canReportResult(alerts, target) ? () => setStockReport(");
    expect(result).toContain("{alerts.available ? <StockReportSheet");
    expect(setting).toContain("if (!status.available) return null;");
  });
});

describe("la cloche et sa feuille", () => {
  it("une cloche seulement sur une envie que le serveur reconnaît ; liste : pas de cloche sans état", () => {
    expect(bellVisible(ON, state({ trackable: false }))).toBe(false);
    expect(bellVisible(ON, undefined)).toBe(false);
    expect(bellVisible(ON, null)).toBe(false);
    const states = readWishAlertStates({ items: [state({ priceDrop: true }), { wishlistItemId: "pas-un-id" }, null] });
    expect([...states.keys()]).toEqual([WISH]);
    expect(states.get(WISH)?.priceDrop).toBe(true);
    expect(readWishAlertStates({ items: "rien" }).size).toBe(0);
    expect(readWishAlertState({ wishlistItemId: WISH, trackable: "oui", stock: "vendu" })).toEqual(state({ trackable: false }));
  });

  it("l'état de stock en direct (décision du fondateur) : lu tel quel s'il est connu, « unknown » sinon ; rien d'autre n'est gardé", () => {
    expect(readWishAlertState({ ...state(), stock: "sold_out", lastPrice: 79 })).toEqual(state({ stock: "sold_out" }));
    expect(readWishAlertState({ ...state(), stock: "in_stock" })?.stock).toBe("in_stock");
    expect(Object.keys(readWishAlertState({ ...state(), searcher: "x" })!).sort()).toEqual(["bought", "priceDrop", "restock", "soldOut", "stock", "trackable", "wishlistItemId"]);
  });

  it("pièce déjà achetée (dans votre Vault) : pas de cloche — aucune alerte ne partirait ; « Plus disponible ? » reste possible", () => {
    expect(bellVisible(ON, state({ bought: true }))).toBe(false);
    expect(bellVisible(ON, state(), true)).toBe(false);
    expect(bellVisible(ON, state(), false)).toBe(true);
    expect(canReportWish(ON, state({ bought: true }))).toBe(true);
    expect(readWishAlertState({ ...state(), bought: true })?.bought).toBe(true);
    expect(readWishAlertState({ ...state(), bought: "oui" })?.bought).toBe(false);
    // La fiche le sait tout de suite après « Je l'ai achetée » (inVault), la liste par le serveur (bought).
    expect(envie).toContain("bellVisible(alerts, alertState, item.inVault)");
    expect(panel).toContain("{bellVisible(alerts, alertStates.get(item.id)) ? (");
    expect(watchErrorMessage(apiError(422, "alert_wish_bought"))).toBe(fr.wishAlerts.bought);
  });

  it("« Baisse de prix » et « Retour en stock » ; « Épuisé » reste caché (décision du fondateur)", () => {
    expect(SOLD_OUT_ALERTS_VISIBLE).toBe(false);
    expect(visibleAlertKinds()).toEqual(["price_drop", "restock"]);
    expect(visibleAlertKinds(true)).toEqual(["price_drop", "restock", "sold_out"]);
    // Un « Épuisé » coché (impossible depuis l'app) n'allume pas la cloche, et n'est jamais envoyé.
    expect(bellOn(state({ soldOut: true }))).toBe(false);
    expect(bellOn(state({ soldOut: true }), true)).toBe(true);
    expect(watchRequest(choiceOf(state({ priceDrop: true, soldOut: true })), ON)).toEqual({ priceDrop: true, restock: false });
    expect(watchRequest(choiceOf(state({ priceDrop: true, soldOut: true })), ON, true)).toEqual({ priceDrop: true, restock: false, soldOut: true });
    expect(activeKinds(choiceOf(state({ restock: true, soldOut: true })))).toEqual(["restock"]);
    // La feuille ne montre que les sortes permises, jamais « Épuisé » en dur.
    expect(sheet).toContain("{visibleAlertKinds().map((kind) => (");
    expect(sheet).not.toMatch(/sold_out|soldOut|t\.wishAlerts\.kinds\.sold/);
  });

  it("chaque choix a son interrupteur nommé (VoiceOver), la cloche dit ce qu'elle suit", () => {
    expect(sheet).toContain("accessibilityLabel={alertKindLabel(kind)}");
    expect(sheet).toContain("accessibilityHint={t.wishAlerts.kindHints[kind]}");
    expect(sheet.match(/accessibilityLabel=\{bellLabel\(title, state\)\}/g)?.length).toBe(2);
    expect(sheet).toContain('accessibilityRole="header"');
    expect(bellLabel("Veste en daim", null)).toBe("Créer une alerte pour Veste en daim");
    expect(bellLabel("Veste en daim", state({ priceDrop: true, restock: true }))).toBe(
      "Alerte activée pour Veste en daim : baisse de prix et retour en stock. Toucher pour la modifier"
    );
    expect(bellButtonText(state({ restock: true }))).toBe("Alerte : retour en stock");
    expect(bellButtonText(null)).toBe("Créer une alerte");
  });

  it("une cloche sur la fiche et sur chaque envie des listes (Envies et vos collections), zone à part", () => {
    expect(envie).toContain('<WishAlertButton title={item.title} state={alertState} onPress={() => setAlertSheet(true)} />');
    expect(envie).toContain("<WishAlertSheet wish={{ id: item.id, title: item.title }} state={alertState} visible={alertSheet}");
    // Liste : la même grille sert à « Toutes » et aux collections (getCollectionWishlist).
    expect(panel).toContain("selectedKey ? getCollectionWishlist(selectedKey, cursor) : getWishlist(cursor)");
    const cardJsx = panel.slice(panel.indexOf("<View key={item.id} style={styles.card}>"), panel.indexOf("<MerchantLinkButton", panel.indexOf("<View key={item.id} style={styles.card}>")));
    expect(cardJsx.indexOf("<WishAlertBell")).toBeGreaterThan(cardJsx.indexOf("</Pressable>"));
    expect(panel).toContain("onSaved={(saved) => setAlertStates((current) => new Map(current).set(saved.wishlistItemId, saved))}");
  });

  it("« Enregistrer » seulement si le choix change (ou si l'enregistrer allume l'interrupteur)", () => {
    const off = choiceOf(null);
    expect(choiceChanged(off, { ...off, price_drop: true })).toBe(true);
    expect(choiceChanged(off, { ...off, sold_out: true })).toBe(false);
    expect(sheet).toContain("const canSave = !saving && (choiceChanged(initial.current, choice) || turnsOn);");
  });

  it("erreurs : pièce non reconnue, trop de changements, ou réseau", () => {
    expect(watchErrorMessage(apiError(422, "alert_not_trackable"))).toBe(fr.wishAlerts.notTrackable);
    expect(watchErrorMessage(apiError(429, "wish_alert_write_limit"))).toBe(fr.wishAlerts.tooManyChanges);
    expect(watchErrorMessage(new TypeError("réseau"))).toBe(fr.wishAlerts.saveError);
  });
});

describe("la première cloche allume l'interrupteur, après l'explication des notifications", () => {
  const context = (overrides: Partial<AlertsPushContext> = {}): AlertsPushContext => ({ platform: "ios", status: ON, supported: true, ...overrides });

  it("une sorte cochée, interrupteur coupé : la cloche allume aussi l'interrupteur (enableAlerts)", () => {
    const priceDrop = { ...choiceOf(null), price_drop: true };
    expect(switchTurnsOn(priceDrop, { enabled: false })).toBe(true);
    expect(watchRequest(priceDrop, { enabled: false })).toEqual({ priceDrop: true, restock: false, enableAlerts: true });
    // Interrupteur déjà allumé, ou cloche retirée : l'interrupteur ne bouge pas.
    expect(watchRequest(priceDrop, { enabled: true })).toEqual({ priceDrop: true, restock: false });
    expect(watchRequest(choiceOf(null), { enabled: false })).toEqual({ priceDrop: false, restock: false });
    expect(switchTurnsOn({ ...choiceOf(null), sold_out: true }, { enabled: false })).toBe(false);
  });

  it("sur l'iPhone : l'explication si la personne n'a encore rien répondu pour les alertes", () => {
    expect(alertsPushStep(context(), { messages: null, alerts: null }, "undetermined")).toBe("offer");
    expect(alertsPushStep(context(), { messages: "off", alerts: null }, "granted")).toBe("offer");
    // Déjà d'accord POUR LES ALERTES : rien à demander, l'appareil les reçoit.
    expect(alertsPushStep(context(), { messages: null, alerts: "on" }, "granted")).toBe("adopt");
    // Messages acceptés : leur accord ne vaut pas pour les alertes, l'explication des alertes d'abord.
    expect(alertsPushStep(context(), { messages: "on", alerts: null }, "granted")).toBe("offer");
    // « Plus tard » déjà répondu, iOS les refuse, site, notifications coupées sur le serveur, build sans module.
    expect(alertsPushStep(context(), { messages: null, alerts: "off" }, "undetermined")).toBe("none");
    expect(alertsPushStep(context(), { messages: null, alerts: null }, "denied")).toBe("none");
    expect(alertsPushStep(context({ platform: "web" }), { messages: null, alerts: null }, "undetermined")).toBe("none");
    expect(alertsPushStep(context({ status: { ...ON, push: false } }), { messages: null, alerts: null }, "undetermined")).toBe("none");
    expect(alertsPushStep(context({ supported: false }), { messages: null, alerts: null }, "undetermined")).toBe("none");
    expect(alertsPushPossible(context({ status: { available: false, push: true } }))).toBe(false);
  });

  it("un seul enregistrement à la fois : pendant qu'il part, ni « Plus tard », ni « Activer », ni fermeture (l'accord donné n'est jamais défait)", () => {
    const send = body(sheet, "async function send()", "const dismiss");
    expect(send).toContain("if (!wish || sending.current) return;\n    sending.current = true;");
    expect(send).toContain("sending.current = false;\n      setSaving(false);");
    // Fermer (fond, geste de retour) pendant l'enregistrement : ignoré, même sur l'explication.
    expect(sheet).toContain('const dismiss = () => (saving ? undefined : step === "push" ? offer.dismiss() : onClose());');
    expect(sheet).toContain('<PushOfferPanel kind="alerts" offer={offer} saving={saving} />');
    // Les boutons de l'explication restent désactivés tant que la cloche s'enregistre.
    expect(offer).toContain("const busy = offer.busy || saving;");
    expect(body(offer, "export function PushOfferPanel(", "const styles")).toContain("onPress={later} disabled={busy}");
  });

  it("la feuille de la cloche : l'explication d'abord (seconde étape), puis l'alerte est enregistrée quelle que soit la réponse", () => {
    const save = body(sheet, "async function save()", "async function send()");
    expect(save).toContain("if (switchTurnsOn(choice, status) && userId) {");
    expect(save).toContain('if (next === "offer") {\n        setStep("push");\n        return;');
    expect(save).toContain('if (next === "adopt") await savePushDecision(userId, "on", "alerts")');
    expect(save.indexOf('setStep("push")')).toBeLessThan(save.indexOf("await send();"));
    // « Activer » ou « Plus tard » de la seconde étape : l'alerte part ensuite, interrupteur compris.
    expect(sheet).toContain('const offer = usePushOfferAnswer("alerts", () => void send(), step === "push");');
    expect(sheet).toContain('<PushOfferPanel kind="alerts" offer={offer} saving={saving} />');
    const send = body(sheet, "async function send()", "const dismiss");
    expect(send).toContain("const request = watchRequest(choice, status);");
    expect(send).toContain("await updateWishAlert(wish.id, request);");
    expect(send).toContain("if (request.enableAlerts && userId) syncPushDevice(userId).catch(() => {});");
  });

  it("la même explication que pour les messages, avec ses textes à elle ; seul « Activer » demande à iOS", () => {
    expect(offer).toContain('{kind === "alerts" ? t.wishAlerts.pushOfferTitle : t.push.offerTitle}');
    expect(offer).toContain("{kind === \"alerts\" ? t.wishAlerts.pushOfferBody : t.push.offerBody}");
    // enablePush n'est appelée que par la feuille (et l'interrupteur des messages), jamais par la cloche ni les Réglages des alertes.
    expect(using(/\benablePush\(/)).toEqual(["components/message-push-setting.tsx", "components/push-offer-sheet.tsx", "lib/push.ts", "lib/push.web.ts"]);
    expect(sheet).not.toContain("requestPermissionsAsync");
    expect(setting).not.toContain("requestPermissionsAsync");
  });

  it("dans les Réglages : allumer passe aussi par l'explication, l'interrupteur s'allume après la réponse", () => {
    const toggle = body(setting, "async function toggle(", "if (!status.available) return null;");
    expect(toggle).toContain('if (next === "offer") {\n        setExplaining("enable");\n        return;');
    expect(toggle).toContain("await apply(on);");
    expect(setting).toContain('if (reason === "enable") void apply(true);');
    expect(setting).toContain('<PushOfferSheet\n        kind="alerts"');
    expect(setting).toContain("accessibilityLabel={t.wishAlerts.settingSwitchLabel}");
    const apply = body(setting, "async function apply(", "async function toggle(");
    expect(apply).toContain("await updateWishAlertsSettings(enabled);");
    expect(apply).toContain("await syncPushDevice(userId)");
  });

  it("« Alertes prix et stock » dans les Réglages, sous les notifications de messages", () => {
    const settings = read("app/(app)/settings.tsx");
    expect(settings.indexOf("<WishAlertsSetting />")).toBeGreaterThan(settings.indexOf("<MessagePushSetting />"));
  });
});

describe("notifications coupées sur le serveur, et le site", () => {
  it("on explique : « Les alertes sont enregistrées ; les notifications seront bientôt disponibles »", () => {
    expect(pushNote({ available: true, push: false }, "ios")).toBe("push_soon");
    expect(pushNote({ available: true, push: false }, "web")).toBe("push_soon");
    expect(pushNoteText("push_soon")).toBe("Les alertes sont enregistrées ; les notifications seront bientôt disponibles.");
    expect(pushNote({ available: true, push: true }, "ios")).toBeNull();
    expect(pushNote({ available: false, push: false }, "ios")).toBeNull();
    expect(sheet).toContain("const note = pushNoteText(pushNote(status, Platform.OS));");
    expect(setting).toContain("const note = pushNoteText(pushNote(status, Platform.OS));");
  });

  it("le site : les cloches et l'interrupteur se règlent, les notifications n'arrivent que sur l'iPhone", () => {
    expect(pushNote({ available: true, push: true }, "web")).toBe("iphone_only");
    expect(pushNoteText("iphone_only")).toBe(fr.wishAlerts.iphoneOnly);
    // Aucune explication des notifications ni appel à iOS hors de l'iPhone.
    expect(body(sheet, "async function pushStepNow()", "async function save()")).toContain('if (!userId || Platform.OS !== "ios") return "none";');
    expect(read("lib/push.web.ts")).toContain("export async function syncPushDevice(): Promise<void> {}");
    // La cloche n'est jamais cachée sur le site.
    expect(sheet).not.toMatch(/Platform\.OS === "web"/);
    expect(panel).not.toMatch(/Platform\.OS/);
  });
});

describe("« Plus disponible », avec une confirmation", () => {
  it("le lien n'envoie rien : il ouvre la confirmation ; seul « Oui, plus disponible » signale", () => {
    expect(using(/\breportStockGone\(/)).toEqual(["components/stock-report-sheet.tsx", "lib/api.ts"]);
    const confirm = body(stockSheet, "async function confirm()", "const dismiss");
    expect(confirm).toContain("await reportStockGone(stockReportRequest(target));");
    expect(stockSheet).toContain('onPress={() => void confirm()}');
    expect(stockSheet).toContain('testID="confirmer-plus-disponible"');
    expect(stockSheet).toContain("{t.wishAlerts.reportCancel}");
    expect(stockSheet).toContain("accessibilityLabel={t.wishAlerts.reportLinkLabel(pieceName)}");
    // Les écrans retiennent seulement la pièce visée.
    expect(body(result, "function handleStockReport()", "const stockFrom")).toContain('setStockReport({ kind: "match", id: piece.id, title: pieceTitle(piece.name) });');
    expect(envie).toContain('setStockReport({ kind: "wish", id: item.id, title: item.title })');
  });

  it("exactement un identifiant part : la proposition, ou l'envie", () => {
    expect(stockReportRequest({ kind: "match", id: "m1", title: "Veste" })).toEqual({ productMatchId: "m1" });
    expect(stockReportRequest({ kind: "wish", id: WISH, title: "Veste" })).toEqual({ wishlistItemId: WISH });
  });

  it("seulement sur une pièce qui a une clé selon le serveur (décision 8) : jamais une place de marché, une page de liste ou de Google sans identifiant", () => {
    // Le serveur le dit pour chaque proposition (alertTrackable) ; absent (ancien serveur, Amazon…) : pas de lien.
    expect(canReportResult(ON, { real: true, merchantUrl: "https://www.amazon.fr/dp/B000123" })).toBe(false);
    expect(canReportResult(ON, { real: true, merchantUrl: "https://boutique.example/veste", alertTrackable: false })).toBe(false);
    expect(canReportResult(ON, { real: true, merchantUrl: "https://boutique.example/veste", alertTrackable: true })).toBe(true);
    expect(read("lib/spot-result.ts")).toContain("...(match.alertTrackable === true ? { alertTrackable: true } : {}),");
  });

  it("sur la grande carte, les sections et la liste triée — seulement de vraies propositions avec un lien", () => {
    expect(canReportResult(ON, { real: false, merchantUrl: "https://boutique.example/veste", alertTrackable: true })).toBe(false);
    expect(canReportResult(ON, { merchantUrl: "https://boutique.example/veste", alertTrackable: true })).toBe(false);
    expect(canReportResult(ON, { real: true, merchantUrl: null, alertTrackable: true })).toBe(false);
    expect(canReportResult(ON, { real: true, merchantUrl: "", alertTrackable: true })).toBe(false);
    expect(result).toContain("onReportGone={stockFrom(p)} />");
    expect(result.match(/stockAction=\{stockFrom\}/g)?.length).toBe(4);
    for (const path of ["components/result-complement.tsx", "components/no-price-section.tsx", "components/price-sorted-list.tsx"]) {
      expect(read(path), path).toContain("onReportGone={stockAction?.(piece)} />");
    }
    // Depuis une section : rien ne change à l'écran (ni grande carte ni défilement).
    const fromSection = body(result, "const stockFrom", "/** Voie B (lot c)");
    for (const forbidden of ["updateChoice", "holdPiece", "selectPiece", "scrollTo", "reveal"]) expect(fromSection, forbidden).not.toContain(forbidden);
  });

  it("le lien est une zone à part sur la carte, jamais dans celle qui la met en grand", () => {
    const row = card.slice(card.indexOf('if (variant === "row")'), card.indexOf("return (\n    <View style={styles.card}>"));
    const grid = card.slice(card.indexOf("return (\n    <View style={styles.card}>"), card.indexOf("export function CheapestBadge"));
    for (const variant of [row, grid]) {
      expect(variant.indexOf("<StockReportLink")).toBeGreaterThan(variant.indexOf("</Pressable>"));
    }
  });

  it("sur la fiche d'une envie : seulement si le serveur la reconnaît", () => {
    expect(canReportWish(ON, state({ trackable: false }))).toBe(false);
    expect(canReportWish(ON, state())).toBe(true);
    expect(envie).toContain("<StockReportSheet target={stockReport} onClose={() => setStockReport(null)} onReported={() => void loadAlert()} />");
  });

  it("refus : limite du jour, pièce non reconnue, introuvable, ou réseau", () => {
    expect(stockReportErrorMessage(apiError(429, "stock_report_limit"))).toBe(fr.wishAlerts.reportLimit);
    expect(stockReportErrorMessage(apiError(429, "rate_limited"))).toBe(fr.wishAlerts.reportLimit);
    expect(stockReportErrorMessage(apiError(422, "alert_not_trackable"))).toBe(fr.wishAlerts.reportNotTrackable);
    expect(stockReportErrorMessage(apiError(404, "product_match_not_found"))).toBe(fr.wishAlerts.reportNotFound);
    expect(stockReportErrorMessage(new TypeError("réseau"))).toBe(fr.wishAlerts.reportError);
  });
});

describe("une alerte touchée ouvre l'envie", () => {
  it("lit seulement `kind` et l'envie dans les données ; une alerte groupée ouvre vos Envies", () => {
    expect(notificationTarget({ kind: "wish_alert", wishlistItemId: WISH })).toEqual({ kind: "wish", id: WISH });
    expect(notificationTarget({ kind: "wish_alert" })).toEqual({ kind: "wishes" });
    for (const data of [{ kind: "wish_alert", wishlistItemId: "../reglages" }, { kind: "wish_alert", wishlistItemId: 12 }, { kind: "autre" }, null, "texte"]) {
      expect(notificationTarget(data)).toBeNull();
    }
    // Les messages : inchangés.
    const conversation = "c0000000-0000-4000-8000-000000000001";
    expect(notificationTarget({ conversationId: conversation })).toEqual({ kind: "conversation", id: conversation });
    expect(notificationHref({ kind: "conversation", id: conversation })).toEqual(conversationHref(conversation));
  });

  it("la fiche de l'envie (clic vers la boutique compté « price_alert »), ou l'onglet Envies du Profil", () => {
    expect(notificationHref({ kind: "wish", id: WISH })).toEqual({ pathname: "/envie", params: { id: WISH, from: FROM_ALERT } });
    expect(notificationHref({ kind: "wishes" })).toEqual({ pathname: "/profile", params: { segment: WISHLIST_SEGMENT } });
    expect(MERCHANT_LINK_CONTEXTS).toContain("price_alert");
    expect(envie).toContain("const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();");
    expect(envie).toContain('context={from === FROM_ALERT ? "price_alert" : "wishlist"}');
  });

  it("branché là où les notifications touchées sont déjà routées ; bannière app ouverte pour une alerte", () => {
    expect(read("lib/use-push-notifications.ts")).toContain("listenToNotifications((target) => router.push(notificationHref(target)))");
    expect(push).toContain("const target = notificationTarget(response.notification.request.content.data);");
    expect(push).toContain("if (target && firstTimeHandled(response.notification.request.identifier)) open(target);");
    expect(shouldShowBanner({ kind: "wish_alert", wishlistItemId: WISH })).toBe(true);
  });
});

describe("l'appareil reste enregistré tant que les messages OU les alertes sont allumés", () => {
  it("messages allumés : gardé, avec les messages ; seulement les alertes : gardé, sans les messages", () => {
    expect(deviceRegistration({ messages: "on", alerts: null }, false)).toEqual({ keep: true, messages: true, alerts: false });
    expect(deviceRegistration({ messages: "on", alerts: "on" }, true)).toEqual({ keep: true, messages: true, alerts: true });
    expect(deviceRegistration({ messages: "off", alerts: "on" }, true)).toEqual({ keep: true, messages: false, alerts: true });
    // « Plus tard » pour les alertes, messages acceptés : gardé pour les messages, JAMAIS pour les alertes.
    expect(deviceRegistration({ messages: "on", alerts: "off" }, true)).toEqual({ keep: true, messages: true, alerts: false });
    // Alertes acceptées mais interrupteur coupé (ou alertes indisponibles) : oublié.
    expect(deviceRegistration({ messages: "off", alerts: "on" }, false)).toEqual({ keep: false, messages: false, alerts: true });
    expect(deviceRegistration({ messages: null, alerts: null }, true)).toEqual({ keep: false, messages: false, alerts: false });
    expect(alertsKeepDevice(ON)).toBe(true);
    expect(alertsKeepDevice({ ...ON, enabled: false })).toBe(false);
    expect(alertsKeepDevice({ available: false, enabled: true, push: true })).toBe(false);
  });

  it("une réponse par sorte et par compte ; celle des messages garde sa clé d'avant", () => {
    expect(pushDecisionKey("u1")).toBe("spotto.push-decision.u1");
    expect(pushDecisionKey("u1", "messages")).toBe("spotto.push-decision.u1");
    expect(pushDecisionKey("u1", "alerts")).toBe("spotto.alerts-push-decision.u1");
    expect(alertsPushOn({ messages: null, alerts: "on" }, "granted")).toBe(true);
    // Les messages acceptés ne font jamais recevoir les alertes (« Plus tard » respecté).
    expect(alertsPushOn({ messages: "on", alerts: null }, "granted")).toBe(false);
    expect(alertsPushOn({ messages: "on", alerts: "off" }, "granted")).toBe(false);
    expect(alertsPushOn({ messages: null, alerts: "on" }, "denied")).toBe(false);
    expect(alertsPushOn({ messages: "off", alerts: "off" }, "granted")).toBe(false);
  });

  it("couper les messages, alertes allumées : réenregistré avec `messages: false` (oublié si ça échoue) ; sinon oublié", () => {
    const disable = body(push, "export async function disablePush(", "/** Réenregistre l'appareil");
    expect(disable).toContain('await savePushDecision(userId, "off", kind);');
    expect(disable).toContain("if (!registration.keep) return forgetPushToken();");
    expect(disable).toContain("await registerAgain(registration);");
    expect(disable).toContain("} catch {\n    await forgetPushToken();");
    // Le jeton part toujours avec `messages` ET `alerts` (contrat du serveur, migration 0036).
    expect(push).toContain('await registerPushToken(data, "ios", kinds.messages, kinds.alerts);');
    expect(api).toContain("const payload: RegisterPushTokenRequest = { token, platform, messages, alerts };");
    // Accepter une sorte ne rallume jamais l'autre si elle est coupée.
    const enable = body(push, "export async function enablePush(", "/** « Plus tard »");
    expect(enable).toContain('messages: kind === "messages" || messagesDecision === "on",');
    expect(enable).toContain('alerts: kind === "alerts" || alertsDecision === "on",');
  });

  it("l'interrupteur des alertes change : l'appareil suit, sans jamais rien demander à iOS", () => {
    const sync = body(push, "export async function syncPushDevice(", "/** À l'ouverture");
    expect(sync).toContain("if (!registration.keep) return forgetPushToken();");
    expect(sync).toContain("await refreshPushToken(userId);");
    expect(sync).not.toContain("requestPermissionsAsync");
    // À l'ouverture : rafraîchi pour les messages OU les alertes.
    const hook = read("lib/use-push-notifications.ts");
    expect(hook).toContain("const alertsPush = alerts.available && alerts.enabled && alerts.push;");
    expect(hook).toContain("(!messagesPush && !alertsPush)) return;");
    // La déconnexion oublie toujours l'appareil (inchangé).
    expect(read("lib/auth-context.tsx")).toContain("await forgetPushToken().catch(() => {});");
  });
});

describe("textes en français et en anglais", () => {
  it("les mots du fondateur, en vouvoyant", () => {
    expect(fr.wishAlerts.kinds.price_drop).toBe("Baisse de prix");
    expect(fr.wishAlerts.kinds.restock).toBe("Retour en stock");
    expect(fr.wishAlerts.settingTitle).toBe("Alertes prix et stock");
    expect(fr.wishAlerts.reportLink).toBe("Plus disponible ?");
    expect(fr.wishAlerts.pushSoon).toBe("Les alertes sont enregistrées ; les notifications seront bientôt disponibles.");
    expect(en.wishAlerts.kinds.price_drop).toBe("Price drop");
    expect(en.wishAlerts.kinds.restock).toBe("Back in stock");
    expect(en.wishAlerts.settingTitle).toBe("Price and stock alerts");
    expect(en.wishAlerts.reportLink).toBe("No longer available?");
    expect(en.wishAlerts.pushSoon).toBe("Your alerts are saved; notifications will be available soon.");
    const french = JSON.stringify(fr.wishAlerts);
    expect(french).toContain("vous");
    expect(french).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi|te)(?!\p{L})/iu);
    // Jamais qui a cherché ni qui suit la pièce.
    expect(fr.wishAlerts.sheetIntro).toContain("Personne ne sait qui l'a cherchée, ni qui la suit.");
    expect(fr.wishAlerts.reportBody).toContain("Personne ne saura que c'est vous.");
    // Lot « durcissement des alertes » (0040) : un signalement seul ne change que vos envies ;
    // il ne promet plus de prévenir les autres membres d'un retour en stock.
    expect(fr.wishAlerts.reportBody).toContain("dès qu'un autre membre la signale aussi");
    expect(en.wishAlerts.reportBody).toContain("once another member reports it too");
    for (const text of [fr.wishAlerts.reportBody, en.wishAlerts.reportBody]) expect(text).not.toMatch(/reviendra|comes back/);
  });

  it("les libellés composés suivent la langue de l'app", () => {
    expect(alertKindsText(["price_drop", "restock"])).toBe("baisse de prix et retour en stock");
    setActiveLocale("en");
    expect(alertKindsText(["price_drop", "restock"])).toBe("price drop and back in stock");
    expect(alertKindsText(["restock"])).toBe("back in stock");
    expect(bellLabel("Suede jacket", state({ priceDrop: true }))).toBe("Alert on for Suede jacket: price drop. Tap to change it");
    expect(bellButtonText(null)).toBe("Create an alert");
  });

  it("aucun texte en dur : écrans et composants passent par t.wishAlerts", () => {
    for (const [name, source] of [
      ["wish-alert-sheet", sheet],
      ["stock-report-sheet", stockSheet],
      ["wish-alerts-setting", setting],
    ] as const) {
      expect(source, name).toMatch(/t\.wishAlerts\./);
    }
  });
});

describe("politique de confidentialité et App Privacy (brouillons « à vérifier »)", () => {
  const all = (doc: typeof privacyPolicy) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");

  it("un paragraphe « [À vérifier] » : la comparaison avec les Envies des autres, personne n'est identifié, ce qui est gardé, Expo et Apple", () => {
    const frText = all(privacyPolicy);
    const enText = all(privacyPolicyEn);
    const paragraph = frText.slice(frText.indexOf("Vos alertes prix et stock :"), frText.indexOf("Vos clics vers les marchands"));
    for (const sentence of [
      "les résultats des recherches et des achats faits dans Spotto, et les signalements « Plus disponible » des membres, sont comparés avec les Envies gardées par les autres membres",
      "Personne n'est identifié à personne",
      "le prix de référence et le dernier prix vu",
      "l'état du stock et leurs dates au jour près",
      "Une alerte est envoyée tout de suite, dès que la baisse ou le retour en stock est constaté",
      "aucun membre ne peut savoir qui c'était",
      "Votre Vault reste visible par vous seul",
      "Les alertes sont effacées au bout de 30 jours",
      "Expo (650 Industries, Inc., États-Unis)",
      "Apple (Apple Inc., États-Unis)",
      "[À vérifier : base légale retenue",
    ]) {
      expect(paragraph).toContain(sentence);
    }
    const english = enText.slice(enText.indexOf("Your price and stock alerts:"), enText.indexOf("Your clicks to retailers"));
    // Plus aucun délai ni décalage d'un jour : envoyée tout de suite.
    expect(paragraph).not.toMatch(/2 à 8|la veille|le lendemain|ne vous montre ni le stock/);
    for (const sentence of ["are compared with the wishes saved by other members", "An alert is sent right away", "no member can find out who it was", "Nobody is identified to anyone", "Alerts are deleted after 30 days", "Expo (650 Industries, Inc., United States)", "[To be verified: legal basis chosen"]) {
      expect(english).toContain(sentence);
    }
  });

  it("Expo et Apple (sous-traitants) : les notifications des messages ET des alertes, ce qu'une alerte contient, et l'adresse de l'appareil gardée tant que l'une des deux est activée", () => {
    const frExpo = all(privacyPolicy).split("\n").find((line) => line.startsWith("Expo (650 Industries, Inc., États-Unis) :"))!;
    for (const sentence of [
      "les notifications de messages ou celles des alertes prix et stock",
      "Une notification de message contient seulement « Spotto »",
      "Une notification d'alerte contient « Spotto », le titre de la pièce, la boutique et le prix",
      "jamais qui a cherché, acheté ou signalé la pièce",
      "tant que les notifications de messages ou celles des alertes y sont activées",
      "elle est effacée quand vous coupez les deux",
      "[À vérifier :",
    ]) {
      expect(frExpo).toContain(sentence);
    }
    expect(frExpo).not.toContain("si vous activez les notifications de messages sur votre iPhone");
    const enExpo = all(privacyPolicyEn).split("\n").find((line) => line.startsWith("Expo (650 Industries, Inc., United States):"))!;
    for (const sentence of ["message notifications or price and stock alert notifications", "An alert notification contains", "it is deleted when you turn both off", "[To be verified:"]) {
      expect(enExpo).toContain(sentence);
    }
  });

  it("la version de la politique n'a pas changé (à dater après relecture, avant la mise en ligne)", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
  });

  it("le brouillon App Privacy est clairement marqué, catégories « à vérifier »", () => {
    const apple = readFileSync(join(__dirname, "../app-store/CONFIDENTIALITE-APPLE.md"), "utf8");
    const draft = apple.slice(apple.indexOf("## 7. BROUILLON — alertes prix et stock"));
    expect(draft.length).toBeGreaterThan(100);
    for (const category of ["Purchase History", "Product Interaction", "Search History", "Device ID"]) expect(draft).toContain(category);
    expect(draft.match(/à vérifier/g)!.length).toBeGreaterThanOrEqual(5);
    expect(draft).toContain("Suivi (*Tracking*) | Non");
  });
});
