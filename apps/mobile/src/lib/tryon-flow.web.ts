// Essayage virtuel photo (site) : les étapes du parcours et leurs messages,
// sans écran. Ordre : statut relu à l'ouverture → porte d'âge (statut
// inconnu) → message neutre (mineur) → consentement (le texte affiché par ce
// site, dans sa version ; une autre version demandée par le serveur : page à
// recharger) → photo → essai en cours → résultat. Un refus du serveur qui
// change l'état (fonction coupée, âge, consentement) fait relire le statut,
// qui décide de l'étape ; les autres refus restent sur l'étape, avec un
// message clair.
// Les messages sont calculés à l'affichage (langue de l'app), jamais gardés.
// Fichier .web : jamais dans l'app iPhone. Logique pure, testée
// (tests/tryon-flow.test.ts). Imports relatifs : fichier testé par vitest.
import type { TryonRemaining, TryonStatus } from "@monapp/shared-types";
import { tryonText } from "../i18n/tryon.web";
import { TRYON_CONSENT_TEXT_VERSION, type TryonServerCode } from "../i18n/tryon-fr.web";
import { ApiError } from "./api-error";
import { formatDayMonth } from "./format";
import { isNetworkError } from "./network-error";
import type { Locale } from "./preferences";
import { PHOTO_SOURCE_MAX_BYTES, PHOTO_UPLOAD_MAX_BYTES, type PhotoRefusal } from "./tryon-photo.web";
import { tryonItemId, type BirthDateIssue, type PieceForTryon } from "./tryon-read.web";

/** Fuseau des quotas (mois civil) et de la porte d'âge, comme le serveur. */
const PARIS_TIME_ZONE = "Europe/Paris";
/** Message du serveur repris tel quel quand le code est inconnu : borné. */
const MAX_SERVER_MESSAGE_LENGTH = 300;

/** Pourquoi une action n'a pas abouti. `server` : réponse d'erreur du serveur
 * ({ error, message }) ; `no_answer` : pas de réponse dans le délai. */
export type TryonFailure =
  | { kind: "server"; code: string; message: string | null }
  | { kind: "offline" }
  | { kind: "no_answer" }
  | { kind: "unexpected" };

export type TryonStep =
  | { step: "loading" }
  | { step: "load_failed"; failure: TryonFailure }
  | { step: "unavailable" }
  | { step: "age"; failure: TryonFailure | null }
  | { step: "minor" }
  /** `version` : celle du texte affiché par ce site (TRYON_CONSENT_TEXT_VERSION),
   * envoyée telle quelle par « J'accepte ». */
  | { step: "consent"; version: string; renewed: boolean; failure: TryonFailure | null }
  /** Le serveur demande une autre version que celle des textes de ce site
   * (page ouverte avant une mise à jour) : rien à accepter, page à recharger. */
  | { step: "consent_reload" }
  | { step: "photo"; failure: TryonFailure | null }
  | { step: "running" }
  | { step: "result"; remaining: TryonRemaining };

export type TryonEvent =
  /** Relecture du statut lancée (ouverture, « Réessayer »). */
  | { type: "reload" }
  /** Statut frais ; `cause` : le refus qui l'a fait relire. */
  | { type: "status"; status: TryonStatus; cause?: TryonFailure | null }
  | { type: "load_failed"; failure: TryonFailure }
  | { type: "run" }
  | { type: "succeeded"; remaining: TryonRemaining }
  | { type: "failed"; failure: TryonFailure }
  /** Nouvelle photo choisie : l'ancien refus du serveur ne la concerne plus. */
  | { type: "dismiss" }
  | { type: "again" };

export const LOADING: TryonStep = { step: "loading" };

/** Codes qui changent l'état : le statut est relu, il décide de l'étape. */
const STATUS_CODES: ReadonlySet<string> = new Set(["feature_disabled", "tryon_age_required", "tryon_minor", "tryon_age_already_set", "tryon_consent_required", "tryon_consent_outdated"]);

function isServerCode(code: string): code is TryonServerCode {
  return Object.prototype.hasOwnProperty.call(tryonText.errors, code);
}

function hasCode(failure: TryonFailure | null | undefined, code: string): boolean {
  return failure?.kind === "server" && failure.code === code;
}

/** Après ce refus, le nombre d'essais restants affiché peut être faux : il est
 * relu. Pas de réponse dans le délai du site, connexion perdue en route ou
 * réponse illisible : l'essai a pu aboutir sur le serveur, et y être
 * décompté ; quota épuisé : les compteurs suivent. */
export function failureNeedsCounter(failure: TryonFailure): boolean {
  return failure.kind === "no_answer" || failure.kind === "offline" || failure.kind === "unexpected" || (failure.kind === "server" && failure.code === "tryon_quota_exhausted");
}

/** Lit une erreur levée par un appel (lib/tryon-api.web.ts). Le corps d'une
 * réponse d'erreur n'est jamais cru sur sa forme. */
export function failureOf(error: unknown): TryonFailure {
  if (error instanceof ApiError) {
    const body: unknown = error.body;
    const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const code = typeof fields.error === "string" ? fields.error : "";
    const text = typeof fields.message === "string" ? fields.message.trim() : "";
    return { kind: "server", code, message: text && text.length <= MAX_SERVER_MESSAGE_LENGTH ? text : null };
  }
  if (isNetworkError(error)) return { kind: "offline" };
  return { kind: "unexpected" };
}

/** Ce refus demande-t-il de relire le statut avant de choisir l'étape ? */
export function failureNeedsStatus(failure: TryonFailure): boolean {
  return failure.kind === "server" && STATUS_CODES.has(failure.code);
}

/** Étape décidée par le statut du serveur. */
export function stepForStatus(status: TryonStatus, cause: TryonFailure | null = null): TryonStep {
  if (!status.enabled) return { step: "unavailable" };
  if (status.ageGate === "minor") return { step: "minor" };
  if (status.ageGate === "unknown") return { step: "age", failure: null };
  if (status.consent.required) {
    // Jamais d'accord donné à un texte qui n'est pas celui affiché : si le
    // serveur en demande une autre version, la page est à recharger (le
    // serveur garde le dernier mot : une autre version reçue, 409).
    if (status.consent.version !== TRYON_CONSENT_TEXT_VERSION) return { step: "consent_reload" };
    // Version acceptée devenue ancienne : l'écran dit que le texte a changé.
    return { step: "consent", version: TRYON_CONSENT_TEXT_VERSION, renewed: hasCode(cause, "tryon_consent_outdated"), failure: null };
  }
  return { step: "photo", failure: null };
}

function withFailure(state: TryonStep, failure: TryonFailure | null): TryonStep {
  switch (state.step) {
    case "age":
    case "consent":
    case "photo":
      return { ...state, failure };
    case "running":
      return { step: "photo", failure };
    default:
      return state;
  }
}

export function tryonFlow(state: TryonStep, event: TryonEvent): TryonStep {
  switch (event.type) {
    case "reload":
      return LOADING;
    case "status":
      return stepForStatus(event.status, event.cause ?? null);
    case "load_failed":
      return { step: "load_failed", failure: event.failure };
    case "run":
      return state.step === "photo" ? { step: "running" } : state;
    case "succeeded":
      return state.step === "running" ? { step: "result", remaining: event.remaining } : state;
    case "failed":
      return withFailure(state, event.failure);
    case "dismiss":
      return state.step === "photo" ? { step: "photo", failure: null } : state;
    case "again":
      return state.step === "result" ? { step: "photo", failure: null } : state;
  }
}

// ---- Ce que montrent les fiches et les Réglages ----

/** Identifiant à essayer quand l'essayage est ouvert et la pièce s'y prête. */
export function entryItemId(status: TryonStatus, piece: PieceForTryon): string | null {
  return status.enabled ? tryonItemId(piece) : null;
}

/** La ligne « retirer mon consentement » des Réglages : dès qu'un
 * consentement est donné, fonction ouverte ou non (le droit de retrait
 * prime). `given` : la réponse de GET /api/tryon/consent (null tant qu'elle
 * n'est pas lue) ; le statut suit en plus un consentement accepté depuis,
 * dans la fenêtre de l'essayage. */
export function canWithdrawConsent(given: boolean | null, status: TryonStatus): boolean {
  return given === true || (status.enabled && !status.consent.required);
}

// ---- Dates (fuseau Europe/Paris) ----

/** Le jour à Paris, « AAAA-MM-JJ ». Fuseau inconnu du navigateur : jour UTC. */
export function parisDay(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: PARIS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Jour de la remise à zéro des essais gratuits (« 1er décembre ») ; null si illisible. */
export function resetDay(nextReset: string, locale: Locale): string | null {
  const date = new Date(nextReset);
  if (Number.isNaN(date.getTime())) return null;
  return formatDayMonth(parisDay(date), locale);
}

// ---- Essais restants ----

export function hasTriesLeft(remaining: TryonRemaining): boolean {
  return remaining.free + remaining.bonus > 0;
}

/** « Il vous reste X essais ce mois-ci (+Y offerts) ». */
export function remainingText(remaining: TryonRemaining): string {
  return tryonText.remaining.count(remaining.free, remaining.bonus);
}

/** Plus aucun essai : la date des prochains, quand le statut la donne. */
export function quotaMessage(status: TryonStatus, locale: Locale): string {
  const day = status.enabled ? resetDay(status.remaining.nextReset, locale) : null;
  return day ? tryonText.remaining.none(day) : tryonText.remaining.noneUndated;
}

// ---- Messages ----

export interface FailureView {
  message: string;
  /** Silhouette non reconnue : les conseils pour la photo suivent le message. */
  tips: boolean;
}

/** Message d'un refus, dans la langue de l'app. Code inconnu : le message du
 * serveur (déjà dans la langue de l'app), sinon un message général. */
export function failureView(failure: TryonFailure, status: TryonStatus, locale: Locale): FailureView {
  switch (failure.kind) {
    case "offline":
      return { message: tryonText.fallback.offline, tips: false };
    case "no_answer":
      return { message: tryonText.fallback.noAnswer, tips: false };
    case "unexpected":
      return { message: tryonText.fallback.generic, tips: false };
    case "server":
      if (failure.code === "tryon_quota_exhausted") return { message: quotaMessage(status, locale), tips: false };
      // Plusieurs limites partagent ce code (essais par heure, par jour, pour
      // tout le service, consentement, signalements) : le message du serveur,
      // déjà dans la langue de l'app, dit laquelle ; sinon celui du catalogue.
      if (failure.code === "tryon_rate_limited") return { message: failure.message ?? tryonText.errors.tryon_rate_limited, tips: false };
      if (isServerCode(failure.code)) return { message: tryonText.errors[failure.code], tips: failure.code === "tryon_pose_not_detected" };
      return { message: failure.message ?? tryonText.fallback.generic, tips: false };
  }
}

/** Signalement non envoyé : un code connu garde son message ; sinon le message du signalement. */
export function reportFailureMessage(failure: TryonFailure, status: TryonStatus, locale: Locale): string {
  if (failure.kind === "offline") return tryonText.fallback.offline;
  if (failure.kind === "server" && (failure.code === "tryon_quota_exhausted" || isServerCode(failure.code))) return failureView(failure, status, locale).message;
  return tryonText.report.error;
}

/** Retrait du consentement non enregistré. */
export function withdrawFailureMessage(failure: TryonFailure): string {
  return failure.kind === "offline" ? tryonText.fallback.offline : tryonText.settings.error;
}

/** Date de naissance refusée avant l'envoi (lib/tryon-read.web.ts, checkBirthDate). */
export function birthDateIssueMessage(issue: BirthDateIssue): string {
  switch (issue) {
    case "incomplete":
      return tryonText.age.incomplete;
    case "invalid":
      return tryonText.age.invalid;
    case "future":
      return tryonText.age.future;
    case "too_old":
      return tryonText.age.tooOld;
  }
}

const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** Photo refusée sur l'appareil, avant tout envoi. */
export function photoRefusalMessage(reason: PhotoRefusal): string {
  switch (reason) {
    case "format":
      return tryonText.photo.refusedFormat;
    case "too_large":
      return tryonText.photo.refusedTooLarge(megabytes(PHOTO_SOURCE_MAX_BYTES));
    case "upload_too_large":
      return tryonText.photo.refusedTooLarge(megabytes(PHOTO_UPLOAD_MAX_BYTES));
    case "heic_browser":
      return tryonText.photo.refusedHeicBrowser;
    case "unreadable":
      return tryonText.photo.refusedUnreadable;
  }
}
