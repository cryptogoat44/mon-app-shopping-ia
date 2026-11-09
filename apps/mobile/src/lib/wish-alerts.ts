// Alertes prix et stock (lot 2, migration 0036) : la logique sans écran,
// testée à part (tests/alertes-prix.test.ts). Imports relatifs : fichier
// testé par vitest.
//
// Règles :
// - tout est caché (cloche, interrupteur des Réglages, « Plus disponible »)
//   tant que le serveur ne dit pas exactement `available: true` (migration
//   0036 absente, ancien serveur, réponse illisible) ;
// - la cloche d'une envie n'apparaît que si le serveur la dit suivable
//   (`trackable` : même boutique, même produit reconnus) ;
// - « Épuisé » est construit côté serveur mais caché ici
//   (SOLD_OUT_ALERTS_VISIBLE, décision du fondateur) ;
// - la première cloche allume aussi l'interrupteur général, après la feuille
//   d'explication des notifications (composants wish-alert-sheet.tsx) ;
// - sur le site : les cloches se règlent, aucune notification n'y arrive.
import {
  SOLD_OUT_ALERTS_VISIBLE,
  STOCK_STATES,
  WISH_ALERT_ERRORS,
  type StockReportRequest,
  type StockState,
  type UpdateWishAlertRequest,
  type WishAlertKind,
  type WishAlertState,
  type WishAlertsStatus,
} from "@monapp/shared-types";
import type { Piece } from "../api/types";
import { t } from "../i18n";
import { ApiError } from "./api-error";

/** Alertes indisponibles : tout est caché. */
export const ALERTS_UNAVAILABLE: WishAlertsStatus = { available: false, enabled: false, push: false };

/** Réponse de GET /api/alerts/status (ou du `status` d'une cloche
 * enregistrée). Seul `available: true` montre les alertes ; sans elles,
 * l'interrupteur et les notifications valent « non ». */
export function readWishAlertsStatus(body: unknown): WishAlertsStatus {
  if (typeof body !== "object" || body === null) return ALERTS_UNAVAILABLE;
  const { available, enabled, push } = body as Record<string, unknown>;
  if (available !== true) return ALERTS_UNAVAILABLE;
  return { available: true, enabled: enabled === true, push: push === true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isStockState(value: unknown): value is StockState {
  return typeof value === "string" && (STOCK_STATES as readonly string[]).includes(value);
}

/** La cloche d'une envie telle que le serveur la renvoie, ou null si elle est
 * illisible (aucune cloche n'est alors montrée). */
export function readWishAlertState(body: unknown): WishAlertState | null {
  if (typeof body !== "object" || body === null) return null;
  const fields = body as Record<string, unknown>;
  if (typeof fields.wishlistItemId !== "string" || !UUID.test(fields.wishlistItemId)) return null;
  return {
    wishlistItemId: fields.wishlistItemId,
    trackable: fields.trackable === true,
    priceDrop: fields.priceDrop === true,
    restock: fields.restock === true,
    soldOut: fields.soldOut === true,
    stock: isStockState(fields.stock) ? fields.stock : "unknown",
  };
}

/** GET /api/alerts/wishes : les cloches par envie. Une envie absente n'a
 * pas encore d'état (sa fiche le crée) : pas de cloche dans la liste. */
export function readWishAlertStates(body: unknown): Map<string, WishAlertState> {
  const states = new Map<string, WishAlertState>();
  const items = typeof body === "object" && body !== null ? (body as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return states;
  for (const item of items) {
    const state = readWishAlertState(item);
    if (state) states.set(state.wishlistItemId, state);
  }
  return states;
}

/** Le serveur dit les alertes indisponibles (404 « alerts_unavailable ») :
 * l'app cache tout, comme sans 0036. */
export function isAlertsUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.body.error === WISH_ALERT_ERRORS.unavailable;
}

// ---- La cloche ----

/** Les choix montrés dans la feuille de la cloche, dans l'ordre. « Épuisé »
 * seulement si la constante du fondateur le permet (faux aujourd'hui). */
export function visibleAlertKinds(soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): WishAlertKind[] {
  return soldOutVisible ? ["price_drop", "restock", "sold_out"] : ["price_drop", "restock"];
}

/** Ce que la personne a coché, sorte par sorte. */
export type AlertChoice = Record<WishAlertKind, boolean>;

export function choiceOf(state: Pick<WishAlertState, "priceDrop" | "restock" | "soldOut"> | null): AlertChoice {
  return { price_drop: state?.priceDrop === true, restock: state?.restock === true, sold_out: state?.soldOut === true };
}

/** Les sortes cochées parmi celles montrées. */
export function activeKinds(choice: AlertChoice, soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): WishAlertKind[] {
  return visibleAlertKinds(soldOutVisible).filter((kind) => choice[kind]);
}

/** La cloche est « allumée » : au moins une sorte montrée est cochée. */
export function bellOn(state: Pick<WishAlertState, "priceDrop" | "restock" | "soldOut"> | null, soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): boolean {
  return activeKinds(choiceOf(state), soldOutVisible).length > 0;
}

/** La cloche s'affiche : alertes disponibles et pièce suivable. */
export function bellVisible(status: Pick<WishAlertsStatus, "available">, state: Pick<WishAlertState, "trackable"> | null | undefined): boolean {
  return status.available && state?.trackable === true;
}

/** Le corps de PUT /api/wishlist/:id/alerts. « Épuisé », caché, n'est jamais
 * envoyé (absent : non). `enableAlerts` : la cloche allume aussi
 * l'interrupteur général (seulement s'il est coupé et qu'une sorte est cochée). */
export function watchRequest(choice: AlertChoice, status: Pick<WishAlertsStatus, "enabled">, soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): UpdateWishAlertRequest {
  const request: UpdateWishAlertRequest = { priceDrop: choice.price_drop, restock: choice.restock };
  if (soldOutVisible) request.soldOut = choice.sold_out;
  if (switchTurnsOn(choice, status, soldOutVisible)) request.enableAlerts = true;
  return request;
}

/** Enregistrer ce choix allume l'interrupteur général : une sorte cochée,
 * interrupteur coupé (première cloche, ou interrupteur coupé depuis). */
export function switchTurnsOn(choice: AlertChoice, status: Pick<WishAlertsStatus, "enabled">, soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): boolean {
  return !status.enabled && activeKinds(choice, soldOutVisible).length > 0;
}

/** Le choix a changé depuis l'ouverture de la feuille. */
export function choiceChanged(before: AlertChoice, after: AlertChoice, soldOutVisible: boolean = SOLD_OUT_ALERTS_VISIBLE): boolean {
  return visibleAlertKinds(soldOutVisible).some((kind) => before[kind] !== after[kind]);
}

/** Nom d'une sorte, dans la langue de l'app. */
export function alertKindLabel(kind: WishAlertKind): string {
  return t.wishAlerts.kinds[kind];
}

/** « baisse de prix et retour en stock » : les sortes cochées, en minuscules. */
export function alertKindsText(kinds: readonly WishAlertKind[]): string {
  const names = kinds.map((kind) => t.wishAlerts.kindsInline[kind]);
  if (names.length <= 1) return names[0] ?? "";
  return t.wishAlerts.lastJoin(names.slice(0, -1).join(", "), names[names.length - 1]!);
}

/** Libellé de la cloche, lu par VoiceOver (liste et fiche). */
export function bellLabel(title: string, state: Pick<WishAlertState, "priceDrop" | "restock" | "soldOut"> | null): string {
  const kinds = activeKinds(choiceOf(state));
  return kinds.length > 0 ? t.wishAlerts.bellOnLabel(title, alertKindsText(kinds)) : t.wishAlerts.bellOffLabel(title);
}

/** Texte du bouton de la cloche sur la fiche d'une envie. */
export function bellButtonText(state: Pick<WishAlertState, "priceDrop" | "restock" | "soldOut"> | null): string {
  const kinds = activeKinds(choiceOf(state));
  return kinds.length > 0 ? t.wishAlerts.bellOn(alertKindsText(kinds)) : t.wishAlerts.bellOff;
}

/** La phrase sur les notifications, sous les choix de la cloche et sous
 * l'interrupteur des Réglages : notifications pas encore allumées sur le
 * serveur, ou site (elles n'arrivent que sur l'app iPhone). null : rien à dire. */
export function pushNote(status: Pick<WishAlertsStatus, "available" | "push">, platform: string): "push_soon" | "iphone_only" | null {
  if (!status.available) return null;
  if (!status.push) return "push_soon";
  return platform === "ios" ? null : "iphone_only";
}

export function pushNoteText(note: "push_soon" | "iphone_only" | null): string | null {
  if (note === "push_soon") return t.wishAlerts.pushSoon;
  if (note === "iphone_only") return t.wishAlerts.iphoneOnly;
  return null;
}

/** Message d'une cloche non enregistrée. */
export function watchErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body.error === WISH_ALERT_ERRORS.notTrackable) return t.wishAlerts.notTrackable;
  if (error instanceof ApiError && error.status === 429) return t.wishAlerts.tooManyChanges;
  return t.wishAlerts.saveError;
}

// ---- « Plus disponible » ----

/** Ce que « Plus disponible » signale : une proposition d'une de vos
 * recherches, ou une de vos envies. */
export type StockReportTarget = { kind: "match"; id: string; title: string } | { kind: "wish"; id: string; title: string };

/** L'action « Plus disponible ? » d'une carte de l'écran Résultat, ou rien. */
export type StockAction = (piece: Piece) => (() => void) | undefined;

/** Le corps de POST /api/alerts/stock-reports (exactement un des deux identifiants). */
export function stockReportRequest(target: StockReportTarget): StockReportRequest {
  return target.kind === "match" ? { productMatchId: target.id } : { wishlistItemId: target.id };
}

/** « Plus disponible ? » sur une proposition : alertes disponibles, vraie
 * proposition d'une recherche (jamais une pièce de démonstration), avec un
 * lien de boutique. Le serveur seul sait si la pièce a une clé : sans clé, il
 * répond 422 et l'app le dit (notTrackable). */
export function canReportResult(status: Pick<WishAlertsStatus, "available">, piece: { real?: boolean; merchantUrl: string | null }): boolean {
  return status.available && piece.real === true && typeof piece.merchantUrl === "string" && piece.merchantUrl.length > 0;
}

/** « Plus disponible ? » sur une envie : seulement si le serveur la dit suivable. */
export function canReportWish(status: Pick<WishAlertsStatus, "available">, state: Pick<WishAlertState, "trackable"> | null | undefined): boolean {
  return bellVisible(status, state);
}

/** Message d'un signalement refusé. */
export function stockReportErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return t.wishAlerts.reportLimit;
  if (error instanceof ApiError && error.body.error === WISH_ALERT_ERRORS.notTrackable) return t.wishAlerts.reportNotTrackable;
  if (error instanceof ApiError && error.status === 404 && !isAlertsUnavailable(error)) return t.wishAlerts.reportNotFound;
  return t.wishAlerts.reportError;
}

// ---- Disponibilité, partagée entre les écrans ----

let current: WishAlertsStatus = ALERTS_UNAVAILABLE;
const listeners = new Set<(status: WishAlertsStatus) => void>();

export function wishAlertsStatus(): WishAlertsStatus {
  return current;
}

/** Nouvel état lu sur le serveur : les écrans abonnés sont prévenus s'il change. */
export function setWishAlertsStatus(next: WishAlertsStatus): void {
  if (next.available === current.available && next.enabled === current.enabled && next.push === current.push) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onWishAlertsStatus(listener: (status: WishAlertsStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Les alertes gardent cet appareil sur le serveur : disponibles et
 * interrupteur allumé (le choix de l'appareil est vu dans push-state.ts). */
export function alertsKeepDevice(status: WishAlertsStatus): boolean {
  return status.available && status.enabled;
}
