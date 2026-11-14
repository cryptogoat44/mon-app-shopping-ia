import { afterEach, describe, expect, it } from "vitest";
import type { TryonErrorCode, TryonStatus } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import { TRYON_CONSENT_TEXT_VERSION, tryonFr } from "../src/i18n/tryon-fr.web";
import { tryonEn } from "../src/i18n/tryon-en.web";
import { ApiError } from "../src/lib/api-error";
import {
  LOADING,
  birthDateIssueMessage,
  canWithdrawConsent,
  entryItemId,
  failureNeedsCounter,
  failureNeedsStatus,
  failureOf,
  failureView,
  hasTriesLeft,
  parisDay,
  photoRefusalMessage,
  quotaMessage,
  remainingText,
  reportFailureMessage,
  resetDay,
  stepForStatus,
  tryonFlow,
  withdrawFailureMessage,
  type TryonFailure,
  type TryonStep,
} from "../src/lib/tryon-flow.web";
import {
  OLDEST_BIRTH_DATE,
  REPORT_COMMENT_MAX_LENGTH,
  REPORT_REASONS,
  TRYON_OFF,
  buildReport,
  checkBirthDate,
  isGuid,
  isJpegDataUri,
  readAgeGateResponse,
  readConsentReadResponse,
  readConsentResponse,
  readRunResponse,
  readTryonStatus,
  tryonItemId,
} from "../src/lib/tryon-read.web";

// Essayage virtuel photo (site) : lecture stricte des réponses du serveur,
// pièce essayable, porte d'âge, étapes du parcours et messages (FR et EN).
// Logique pure, sans écran ni réseau.

const ITEM = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const REMAINING = { free: 3, bonus: 5, nextReset: "2026-11-30T23:00:00.000Z" };
const ON: TryonStatus = { enabled: true, ageGate: "adult", consent: { required: false, version: "2026-11-v1" }, remaining: REMAINING };
const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U";

const server = (code: string, message: string | null = null): TryonFailure => ({ kind: "server", code, message });

afterEach(() => setActiveLocale("fr"));

describe("statut du serveur : seul enabled: true, lisible en entier, ouvre l'essayage", () => {
  it("statut complet : lu tel quel", () => {
    expect(readTryonStatus(ON)).toEqual(ON);
    expect(readTryonStatus({ ...ON, ageGate: "unknown", consent: { required: true, version: "2026-11-v1" } })).toEqual({ ...ON, ageGate: "unknown", consent: { required: true, version: "2026-11-v1" } });
    // Un jour seul (ISO 8601) est aussi accepté pour la remise à zéro.
    expect(readTryonStatus({ ...ON, remaining: { ...REMAINING, nextReset: "2026-12-01" } }).enabled).toBe(true);
  });

  it("éteint, illisible ou incomplet : toujours « éteint », rien ne s'affiche", () => {
    for (const body of [
      null,
      undefined,
      "enabled",
      [],
      { enabled: false },
      { enabled: false, ageGate: "adult", consent: ON.consent, remaining: REMAINING },
      { ...ON, enabled: "true" },
      { ...ON, enabled: 1 },
      { ...ON, ageGate: "majeur" },
      { ...ON, ageGate: undefined },
      { ...ON, consent: { required: "false", version: "2026-11-v1" } },
      { ...ON, consent: { required: false, version: "" } },
      { ...ON, consent: { required: false, version: "<script>" } },
      { ...ON, consent: null },
      { ...ON, remaining: { ...REMAINING, free: -1 } },
      { ...ON, remaining: { ...REMAINING, bonus: 1.5 } },
      { ...ON, remaining: { ...REMAINING, free: "3" } },
      { ...ON, remaining: { ...REMAINING, free: 1e9 } },
      { ...ON, remaining: { ...REMAINING, nextReset: "bientôt" } },
      { ...ON, remaining: { ...REMAINING, nextReset: "2026-13-45" } },
      { ...ON, remaining: undefined },
    ]) {
      expect(readTryonStatus(body), JSON.stringify(body)).toEqual(TRYON_OFF);
    }
  });
});

describe("autres réponses du serveur", () => {
  it("porte d'âge : « adult » ou « minor » seulement", () => {
    expect(readAgeGateResponse({ ageGate: "adult" })).toBe("adult");
    expect(readAgeGateResponse({ ageGate: "minor" })).toBe("minor");
    for (const body of [null, {}, { ageGate: "unknown" }, { ageGate: "ADULT" }, { ageGate: true }]) expect(readAgeGateResponse(body)).toBeNull();
  });

  it("consentement : { consent: { required, version } }", () => {
    expect(readConsentResponse({ consent: { required: false, version: "2026-11-v1" } })).toEqual({ required: false, version: "2026-11-v1" });
    expect(readConsentResponse({ consent: { required: true, version: "2026-11-v1" } })).toEqual({ required: true, version: "2026-11-v1" });
    for (const body of [null, {}, { required: false, version: "2026-11-v1" }, { consent: { required: 0, version: "v" } }]) expect(readConsentResponse(body)).toBeNull();
  });

  it("lecture du consentement (Réglages) : { consent: { given, version } }, rien d'autre", () => {
    expect(readConsentReadResponse({ consent: { given: true, version: "2026-11-v1" } })).toEqual({ given: true, version: "2026-11-v1" });
    expect(readConsentReadResponse({ consent: { given: false, version: "2026-11-v1" } })).toEqual({ given: false, version: "2026-11-v1" });
    for (const body of [null, {}, { given: true, version: "2026-11-v1" }, { consent: { given: "true", version: "2026-11-v1" } }, { consent: { given: true, version: "<b>" } }, { consent: { given: true } }]) {
      expect(readConsentReadResponse(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("essai : une image JPEG en base64 et les essais restants, rien d'autre", () => {
    expect(readRunResponse({ image: IMAGE, remaining: REMAINING })).toEqual({ image: IMAGE, remaining: REMAINING });
    for (const image of [
      "data:image/png;base64,iVBORw0KGgo=",
      "data:text/html;base64,PHNjcmlwdD4=",
      "javascript:alert(1)",
      "https://cdn.exemple.test/output_0.jpg",
      "data:image/jpeg;base64,",
      "data:image/jpeg;base64,abc",
      "data:image/jpeg;base64,ab$d",
      42,
    ]) {
      expect(isJpegDataUri(image), String(image)).toBe(false);
      expect(readRunResponse({ image, remaining: REMAINING })).toBeNull();
    }
    expect(readRunResponse({ image: IMAGE })).toBeNull();
    expect(readRunResponse({ image: IMAGE, remaining: { free: 1 } })).toBeNull();
  });

  it("identifiants : le motif de z.guid() du serveur", () => {
    expect(isGuid(ITEM)).toBe(true);
    expect(isGuid(ITEM.toUpperCase())).toBe(true);
    for (const value of ["", "demo-1", `${ITEM} `, ITEM.replace(/-/g, ""), `${ITEM}0`, null, 12]) expect(isGuid(value), String(value)).toBe(false);
  });
});

describe("pièce essayable : une proposition du Spotter, une image en https, un lien d'achat", () => {
  const piece = { matchId: ITEM, imageUrls: ["https://boutique.exemple.test/hd.jpg", "https://encrypted-tbn0.gstatic.com/x"], buyUrl: "https://boutique.exemple.test/p/1" };

  it("tout y est : l'identifiant de la proposition part, rien d'autre", () => {
    expect(tryonItemId(piece)).toBe(ITEM);
    // La vignette suffit quand l'image originale manque ou n'est pas en https.
    expect(tryonItemId({ ...piece, imageUrls: [null, "https://encrypted-tbn0.gstatic.com/x"] })).toBe(ITEM);
    expect(tryonItemId({ ...piece, imageUrls: ["http://boutique.exemple.test/hd.jpg", "https://encrypted-tbn0.gstatic.com/x"] })).toBe(ITEM);
    // Lien d'achat en http : accepté (le serveur décide en dernier).
    expect(tryonItemId({ ...piece, buyUrl: "http://boutique.exemple.test/p/1" })).toBe(ITEM);
  });

  it("pièce de démonstration, envie d'un ami, photo personnelle, sans image ou sans lien : pas de bouton", () => {
    expect(tryonItemId({ ...piece, matchId: null })).toBeNull();
    expect(tryonItemId({ ...piece, matchId: "demo-veste" })).toBeNull();
    expect(tryonItemId({ ...piece, imageUrls: [] })).toBeNull();
    expect(tryonItemId({ ...piece, imageUrls: [null, undefined, ""] })).toBeNull();
    expect(tryonItemId({ ...piece, imageUrls: ["http://boutique.exemple.test/hd.jpg"] })).toBeNull();
    expect(tryonItemId({ ...piece, imageUrls: ["file:///var/mobile/photo.jpg", "blob:https://site/1"] })).toBeNull();
    expect(tryonItemId({ ...piece, buyUrl: null })).toBeNull();
    expect(tryonItemId({ ...piece, buyUrl: "" })).toBeNull();
    expect(tryonItemId({ ...piece, buyUrl: "javascript:alert(1)" })).toBeNull();
    expect(tryonItemId({ ...piece, buyUrl: "boutique.exemple.test" })).toBeNull();
  });

  it("fonction éteinte : jamais de bouton, même pour une pièce essayable", () => {
    expect(entryItemId(ON, piece)).toBe(ITEM);
    expect(entryItemId(TRYON_OFF, piece)).toBeNull();
  });
});

describe("porte d'âge : contrôle immédiat avant l'envoi (le serveur décide de l'âge)", () => {
  const today = "2026-11-13";

  it("date complète et réelle, entre 1900 et aujourd'hui", () => {
    expect(checkBirthDate("1990-06-15", today)).toBeNull();
    expect(checkBirthDate("2024-02-29", today)).toBeNull();
    expect(checkBirthDate(OLDEST_BIRTH_DATE, today)).toBeNull();
    expect(checkBirthDate(today, today)).toBeNull();
  });

  it("vide ou partielle, inexistante, trop ancienne, dans le futur : refusée avec son motif", () => {
    for (const value of ["", "1990", "1990-6-15", "15/06/1990", "1990-06-15T00:00", " 1990-06-15"]) expect(checkBirthDate(value, today), value).toBe("incomplete");
    for (const value of ["2023-02-29", "1990-13-01", "1990-04-31", "1990-00-10"]) expect(checkBirthDate(value, today), value).toBe("invalid");
    expect(checkBirthDate("1899-12-31", today)).toBe("too_old");
    expect(checkBirthDate("2026-11-14", today)).toBe("future");
  });

  it("un message par motif, dans la langue de l'app", () => {
    expect(birthDateIssueMessage("incomplete")).toBe("Indiquez une date de naissance complète.");
    expect(birthDateIssueMessage("invalid")).toBe("Cette date n'existe pas. Vérifiez-la, puis réessayez.");
    expect(birthDateIssueMessage("future")).toBe("Cette date est dans le futur.");
    expect(birthDateIssueMessage("too_old")).toBe("Indiquez une date à partir du 1er janvier 1900.");
    setActiveLocale("en");
    expect(birthDateIssueMessage("too_old")).toBe("Enter a date from 1 January 1900 onwards.");
  });

  it("le jour de référence est celui de Paris", () => {
    // Le jour change à minuit à Paris (UTC+1 l'hiver, UTC+2 l'été), pas à minuit UTC.
    expect(parisDay(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
    expect(parisDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(parisDay(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
    expect(parisDay(new Date("2026-07-14T22:00:00Z"))).toBe("2026-07-15");
  });
});

describe("étapes du parcours", () => {
  it("décidées par le statut : éteint, mineur, âge inconnu, consentement à donner, photo", () => {
    expect(stepForStatus(TRYON_OFF)).toEqual({ step: "unavailable" });
    expect(stepForStatus({ ...ON, ageGate: "minor", consent: { required: true, version: "2026-11-v1" } })).toEqual({ step: "minor" });
    expect(stepForStatus({ ...ON, ageGate: "unknown", consent: { required: true, version: "2026-11-v1" } })).toEqual({ step: "age", failure: null });
    expect(stepForStatus({ ...ON, consent: { required: true, version: "2026-11-v1" } })).toEqual({ step: "consent", version: "2026-11-v1", renewed: false, failure: null });
    expect(stepForStatus(ON)).toEqual({ step: "photo", failure: null });
  });

  it("consentement redemandé après un changement de version (le texte de ce site est le bon) : l'écran le dit", () => {
    const status: TryonStatus = { ...ON, consent: { required: true, version: TRYON_CONSENT_TEXT_VERSION } };
    expect(stepForStatus(status, server("tryon_consent_outdated"))).toEqual({ step: "consent", version: TRYON_CONSENT_TEXT_VERSION, renewed: true, failure: null });
    expect(stepForStatus(status, server("tryon_consent_required"))).toMatchObject({ step: "consent", renewed: false });
  });

  it("« J'accepte » envoie la version du texte AFFICHÉ par ce site, jamais celle annoncée par le serveur", () => {
    expect(TRYON_CONSENT_TEXT_VERSION).toBe("2026-11-v1");
    const step = stepForStatus({ ...ON, consent: { required: true, version: "2026-11-v1" } });
    expect(step).toEqual({ step: "consent", version: TRYON_CONSENT_TEXT_VERSION, renewed: false, failure: null });
  });

  it("le serveur demande une autre version que le texte de cette page : « rechargez la page », rien à accepter", () => {
    for (const version of ["2026-12-v2", "2025-01-v0"]) {
      const status: TryonStatus = { ...ON, consent: { required: true, version } };
      expect(stepForStatus(status)).toEqual({ step: "consent_reload" });
      // Même après un refus « texte changé » (409 du serveur, le dernier mot) : toujours à recharger.
      expect(tryonFlow({ step: "consent", version: TRYON_CONSENT_TEXT_VERSION, renewed: false, failure: null }, { type: "status", status, cause: server("tryon_consent_outdated") })).toEqual({ step: "consent_reload" });
      // Aucun refus ne la fait revenir à un écran avec « J'accepte ».
      expect(tryonFlow({ step: "consent_reload" }, { type: "failed", failure: server("tryon_busy") })).toEqual({ step: "consent_reload" });
    }
    // Consentement déjà donné pour la version du serveur : rien à relire, la photo.
    expect(stepForStatus({ ...ON, consent: { required: false, version: "2026-12-v2" } })).toEqual({ step: "photo", failure: null });
  });

  it("essai : photo → en cours → résultat ; « Essayer une autre photo » revient à la photo", () => {
    let state: TryonStep = tryonFlow(LOADING, { type: "status", status: ON });
    state = tryonFlow(state, { type: "run" });
    expect(state).toEqual({ step: "running" });
    state = tryonFlow(state, { type: "succeeded", remaining: { ...REMAINING, free: 2 } });
    expect(state).toEqual({ step: "result", remaining: { ...REMAINING, free: 2 } });
    expect(tryonFlow(state, { type: "again" })).toEqual({ step: "photo", failure: null });
  });

  it("refus pendant l'essai : retour à la photo avec le message ; une nouvelle photo l'efface", () => {
    const failure = server("tryon_pose_not_detected");
    const state = tryonFlow({ step: "running" }, { type: "failed", failure });
    expect(state).toEqual({ step: "photo", failure });
    expect(tryonFlow(state, { type: "dismiss" })).toEqual({ step: "photo", failure: null });
  });

  it("les événements hors de leur étape ne changent rien", () => {
    expect(tryonFlow(LOADING, { type: "run" })).toBe(LOADING);
    expect(tryonFlow({ step: "photo", failure: null }, { type: "succeeded", remaining: REMAINING })).toEqual({ step: "photo", failure: null });
    expect(tryonFlow({ step: "minor" }, { type: "failed", failure: server("tryon_busy") })).toEqual({ step: "minor" });
    expect(tryonFlow({ step: "photo", failure: null }, { type: "again" })).toEqual({ step: "photo", failure: null });
    expect(tryonFlow({ step: "result", remaining: REMAINING }, { type: "reload" })).toBe(LOADING);
  });

  it("seuls les refus qui changent l'état font relire le statut", () => {
    for (const code of ["feature_disabled", "tryon_age_required", "tryon_minor", "tryon_age_already_set", "tryon_consent_required", "tryon_consent_outdated"]) expect(failureNeedsStatus(server(code)), code).toBe(true);
    for (const code of ["tryon_pose_not_detected", "tryon_quota_exhausted", "tryon_busy", "unknown"]) expect(failureNeedsStatus(server(code)), code).toBe(false);
    expect(failureNeedsStatus({ kind: "offline" })).toBe(false);
  });

  it("Réglages : la ligne de retrait dès qu'un consentement est donné, fonction ouverte ou éteinte", () => {
    // Lu sur le serveur (GET /api/tryon/consent) : fonction éteinte comprise.
    expect(canWithdrawConsent(true, TRYON_OFF)).toBe(true);
    expect(canWithdrawConsent(true, { ...ON, consent: { required: true, version: "2026-11-v1" } })).toBe(true);
    expect(canWithdrawConsent(false, TRYON_OFF)).toBe(false);
    expect(canWithdrawConsent(null, TRYON_OFF)).toBe(false);
    // Pas encore lu (ou illisible) : le statut, quand il dit le consentement donné…
    expect(canWithdrawConsent(null, ON)).toBe(true);
    expect(canWithdrawConsent(null, { ...ON, consent: { required: true, version: "2026-11-v1" } })).toBe(false);
    // … ou accepté depuis, dans la fenêtre de l'essayage.
    expect(canWithdrawConsent(false, ON)).toBe(true);
  });

  it("essais restants relus quand l'issue est incertaine (abandon du site, connexion perdue, réponse illisible) ou le quota épuisé", () => {
    for (const failure of [{ kind: "no_answer" }, { kind: "offline" }, { kind: "unexpected" }, server("tryon_quota_exhausted")] as TryonFailure[]) {
      expect(failureNeedsCounter(failure), JSON.stringify(failure)).toBe(true);
    }
    for (const code of ["tryon_pose_not_detected", "tryon_timeout", "tryon_busy", "tryon_consent_required"]) expect(failureNeedsCounter(server(code)), code).toBe(false);
  });
});

describe("erreurs : chaque code du serveur a son message, en français et en anglais", () => {
  // Tous les codes du contrat (packages/shared-types) : le type refuse un oubli.
  const CODES: Record<TryonErrorCode, true> = {
    feature_disabled: true,
    tryon_age_required: true,
    tryon_minor: true,
    tryon_age_already_set: true,
    tryon_birth_date_invalid: true,
    tryon_consent_required: true,
    tryon_consent_outdated: true,
    tryon_attest_required: true,
    tryon_item_not_found: true,
    tryon_item_not_eligible: true,
    tryon_photo_invalid: true,
    tryon_in_progress: true,
    tryon_quota_exhausted: true,
    tryon_budget_reached: true,
    tryon_busy: true,
    tryon_pose_not_detected: true,
    tryon_moderation_blocked: true,
    tryon_image_unreadable: true,
    tryon_provider_unavailable: true,
    tryon_timeout: true,
    tryon_rate_limited: true,
  };
  const codes = [...Object.keys(CODES), "file_too_large"];

  it("un message propre à chaque code, jamais le message général, dans les deux langues", () => {
    // Le refus « trop de demandes » reprend le message du serveur quand il y en a un (test suivant).
    const fixed = codes.filter((code) => code !== "tryon_rate_limited");
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      const generic = locale === "fr" ? tryonFr.fallback.generic : tryonEn.fallback.generic;
      for (const code of fixed) {
        const message = failureView(server(code, "Message du serveur."), ON, locale).message;
        expect(message, code).not.toBe(generic);
        expect(message, code).not.toBe("Message du serveur.");
        expect(message.length, code).toBeGreaterThan(10);
      }
      const fallback = failureView(server("tryon_rate_limited"), ON, locale).message;
      expect(fallback).toBe(locale === "fr" ? tryonFr.errors.tryon_rate_limited : tryonEn.errors.tryon_rate_limited);
    }
  });

  it("trop de demandes : le message du serveur (la limite atteinte, déjà dans la langue de l'app), sinon celui du catalogue", () => {
    const daily = server("tryon_rate_limited", "Vous avez lancé beaucoup d'essais aujourd'hui. Réessayez demain.");
    const global = server("tryon_rate_limited", "Les essais sont très demandés en ce moment. Réessayez dans un moment.");
    expect(failureView(daily, ON, "fr")).toEqual({ message: "Vous avez lancé beaucoup d'essais aujourd'hui. Réessayez demain.", tips: false });
    expect(failureView(global, ON, "fr").message).toBe("Les essais sont très demandés en ce moment. Réessayez dans un moment.");
    // Signalement ou consentement : le message de leur propre limite.
    const report = server("tryon_rate_limited", "Vous avez envoyé beaucoup de signalements en peu de temps. Réessayez dans une heure.");
    expect(reportFailureMessage(report, ON, "fr")).toBe("Vous avez envoyé beaucoup de signalements en peu de temps. Réessayez dans une heure.");
    setActiveLocale("en");
    expect(failureView(server("tryon_rate_limited", "Try-ons are in high demand right now. Please try again shortly."), ON, "en").message).toBe(
      "Try-ons are in high demand right now. Please try again shortly."
    );
    expect(failureView(server("tryon_rate_limited", null), ON, "en").message).toBe(tryonEn.errors.tryon_rate_limited);
  });

  it("image illisible : une autre photo OU une autre pièce ; modération : une autre pièce ou une autre photo (FR et EN)", () => {
    expect(tryonFr.errors.tryon_image_unreadable).toContain("une autre photo ou une autre pièce");
    expect(tryonEn.errors.tryon_image_unreadable).toContain("another photo or another piece");
    expect(tryonFr.errors.tryon_moderation_blocked).toContain("une autre pièce ou une autre photo");
    expect(tryonEn.errors.tryon_moderation_blocked).toContain("another piece or another photo");
    for (const text of [tryonFr.errors.tryon_image_unreadable, tryonFr.errors.tryon_moderation_blocked]) expect(text).toContain("n'a pas été décompté");
  });

  it("pas de réponse dans le délai du site : le message dit qu'un essai interrompu peut avoir été décompté", () => {
    expect(failureView({ kind: "no_answer" }, ON, "fr").message).toBe(tryonFr.fallback.noAnswer);
    expect(tryonFr.fallback.noAnswer).toContain("peut tout de même être décompté");
    expect(tryonEn.fallback.noAnswer).toContain("may still be counted");
  });

  it("textes clés du lot", () => {
    expect(failureView(server("tryon_budget_reached"), ON, "fr").message).toBe("Les essais sont momentanément indisponibles.");
    setActiveLocale("en");
    expect(failureView(server("tryon_budget_reached"), ON, "en").message).toBe("Try-ons are temporarily unavailable.");
  });

  it("silhouette non reconnue : les conseils pour la photo suivent le message", () => {
    expect(failureView(server("tryon_pose_not_detected"), ON, "fr")).toEqual({ message: tryonFr.errors.tryon_pose_not_detected, tips: true });
    expect(failureView(server("tryon_moderation_blocked"), ON, "fr").tips).toBe(false);
  });

  it("quota épuisé : la date des prochains essais, à Paris (« 1er décembre »)", () => {
    expect(failureView(server("tryon_quota_exhausted"), ON, "fr").message).toBe("Vous avez utilisé tous vos essais de ce mois-ci. Les prochains seront disponibles le 1er décembre.");
    setActiveLocale("en");
    expect(failureView(server("tryon_quota_exhausted"), ON, "en").message).toBe("You've used all your try-ons for this month. New ones will be available on December 1.");
    setActiveLocale("fr");
    expect(quotaMessage(TRYON_OFF, "fr")).toBe("Vous avez utilisé tous vos essais de ce mois-ci.");
    expect(resetDay("2026-12-31T23:00:00Z", "fr")).toBe("1er janvier");
    expect(resetDay("2027-01-01", "en")).toBe("January 1");
    expect(resetDay("n'importe quoi", "fr")).toBeNull();
  });

  it("code inconnu : le message du serveur (déjà traduit), sinon le message général", () => {
    expect(failureView(server("account_suspended", "Votre compte est suspendu."), ON, "fr").message).toBe("Votre compte est suspendu.");
    expect(failureView(server("internal_error", null), ON, "fr").message).toBe(tryonFr.fallback.generic);
    expect(failureView({ kind: "offline" }, ON, "fr").message).toBe(tryonFr.fallback.offline);
    expect(failureView({ kind: "no_answer" }, ON, "fr").message).toBe(tryonFr.fallback.noAnswer);
    expect(failureView({ kind: "unexpected" }, ON, "fr").message).toBe(tryonFr.fallback.generic);
  });

  it("lecture d'une erreur : corps du serveur jamais cru sur sa forme", () => {
    expect(failureOf(new ApiError(429, { error: "tryon_quota_exhausted", message: "Plus d'essais." }))).toEqual(server("tryon_quota_exhausted", "Plus d'essais."));
    // Corps JSON qui n'est pas un objet (une page d'erreur d'un intermédiaire, un nombre…).
    expect(failureOf(new ApiError(502, "Bad Gateway" as unknown as { error: string; message: string }))).toEqual(server("", null));
    expect(failureOf(new ApiError(500, [1, 2] as unknown as { error: string; message: string }))).toEqual(server("", null));
    expect(failureOf(new ApiError(500, { error: 42, message: { html: "<b>" } } as unknown as { error: string; message: string }))).toEqual(server("", null));
    expect(failureOf(new ApiError(503, { error: "x", message: "a".repeat(301) }))).toEqual(server("x", null));
    expect(failureOf(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
    expect(failureOf(new Error("Aucune session active — impossible d'appeler le backend."))).toEqual({ kind: "unexpected" });
  });

  it("signalement et retrait du consentement : messages propres, code connu gardé", () => {
    expect(reportFailureMessage(server("tryon_rate_limited"), ON, "fr")).toBe(tryonFr.errors.tryon_rate_limited);
    expect(reportFailureMessage(server("invalid_request", "Requête invalide."), ON, "fr")).toBe(tryonFr.report.error);
    expect(reportFailureMessage({ kind: "offline" }, ON, "fr")).toBe(tryonFr.fallback.offline);
    expect(withdrawFailureMessage({ kind: "offline" })).toBe(tryonFr.fallback.offline);
    expect(withdrawFailureMessage(server("internal_error"))).toBe(tryonFr.settings.error);
  });

  it("photo refusée sur l'appareil : un message par motif", () => {
    expect(photoRefusalMessage("format")).toBe("Format non accepté : choisissez une photo JPEG, PNG, WebP ou HEIC.");
    expect(photoRefusalMessage("too_large")).toBe("Cette photo est trop lourde (30 Mo maximum). Choisissez-en une autre.");
    expect(photoRefusalMessage("upload_too_large")).toBe("Cette photo est trop lourde (10 Mo maximum). Choisissez-en une autre.");
    expect(photoRefusalMessage("heic_browser")).toContain("HEIC");
    expect(photoRefusalMessage("unreadable")).toBe("Cette photo n'a pas pu être ouverte. Choisissez-en une autre.");
  });
});

describe("essais restants", () => {
  it("compteur : singulier et pluriel, essais offerts seulement s'il y en a", () => {
    expect(remainingText({ ...REMAINING, free: 3, bonus: 5 })).toBe("Il vous reste 3 essais ce mois-ci (+5 offerts)");
    expect(remainingText({ ...REMAINING, free: 1, bonus: 1 })).toBe("Il vous reste 1 essai ce mois-ci (+1 offert)");
    expect(remainingText({ ...REMAINING, free: 0, bonus: 0 })).toBe("Il vous reste 0 essai ce mois-ci");
    setActiveLocale("en");
    expect(remainingText({ ...REMAINING, free: 3, bonus: 5 })).toBe("You have 3 try-ons left this month (+5 bonus)");
    expect(remainingText({ ...REMAINING, free: 1, bonus: 0 })).toBe("You have 1 try-on left this month");
    expect(remainingText({ ...REMAINING, free: 0, bonus: 0 })).toBe("You have 0 try-ons left this month");
  });

  it("essais offerts seuls : on peut encore essayer", () => {
    expect(hasTriesLeft({ ...REMAINING, free: 0, bonus: 2 })).toBe(true);
    expect(hasTriesLeft({ ...REMAINING, free: 0, bonus: 0 })).toBe(false);
  });
});

describe("signalement : aucune image, un motif, un commentaire facultatif borné", () => {
  it("motif obligatoire ; commentaire vide non envoyé, espaces retirés", () => {
    expect(REPORT_REASONS).toEqual(["inappropriate", "wrong_piece", "poor_quality", "other"]);
    expect(buildReport(ITEM, null, "")).toBeNull();
    expect(buildReport(ITEM, "wrong_piece", "   ")).toEqual({ itemId: ITEM, reason: "wrong_piece" });
    expect(buildReport(ITEM, "other", "  Le col est faux.  ")).toEqual({ itemId: ITEM, reason: "other", comment: "Le col est faux." });
  });

  it("500 caractères au plus ; pièce illisible ou motif inconnu : rien ne part", () => {
    expect(buildReport(ITEM, "other", "a".repeat(REPORT_COMMENT_MAX_LENGTH))).not.toBeNull();
    expect(buildReport(ITEM, "other", "a".repeat(REPORT_COMMENT_MAX_LENGTH + 1))).toBeNull();
    expect(buildReport("demo", "other", "")).toBeNull();
    expect(buildReport(ITEM, "spam" as never, "")).toBeNull();
  });
});
