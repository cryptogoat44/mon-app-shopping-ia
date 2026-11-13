import { describe, expect, it, vi } from "vitest";
import { ageStatusFor, parseBirthDate } from "../src/lib/tryon/ageGate.js";
import { budgetSummary, budgetThresholdsReached, reservationFitsBudget, spendUsd } from "../src/lib/tryon/budget.js";
import { dayIn, dayKeyAt, monthKeyAt, nextMonthStart, zonedMidnight } from "../src/lib/tryon/calendar.js";
import { DEFAULT_FASHN_API_BASE_URL, type TryonConfig } from "../src/lib/tryon/config.js";
import { accessRefusal, ageGateOf, consentStateOf, type TryonProfileRow } from "../src/lib/tryon/consent.js";
import { buyLinkOf, garmentImageCandidates, tryonGarmentUrls } from "../src/lib/tryon/eligibility.js";
import { bonusRemaining, bonusToConsume, freeRemaining, quotaSourceFor, type BonusGrant } from "../src/lib/tryon/quota.js";
import { activeTryonConfig } from "../src/lib/tryon/switch.js";
import { TRYON_FAILURE_CODES } from "../src/lib/tryon/failures.js";
import type { OwnMatchLinks } from "../src/lib/ownMatches.js";

// Essayage virtuel : les règles, en fonctions pures (aucune base, aucun
// réseau). La base applique les mêmes (migration 0042 : vérifiée sur une base
// Postgres jetable, puis par essayageBase.test.ts).

const PARIS = "Europe/Paris";
const day = (year: number, month: number, dayOfMonth: number) => ({ year, month, day: dayOfMonth });

describe("mois civil de Paris", () => {
  it("le 31 janvier à 23 h 30 à Paris est en janvier ; à 23 h 30 UTC, c'est déjà février à Paris", () => {
    expect(monthKeyAt(new Date("2030-01-31T22:30:00Z"), PARIS)).toBe("2030-01");
    expect(monthKeyAt(new Date("2030-01-31T23:30:00Z"), PARIS)).toBe("2030-02");
    expect(dayKeyAt(new Date("2030-01-31T23:30:00Z"), PARIS)).toBe("2030-02-01");
  });

  it("heure d'été : le 30 juin à 23 h 59 à Paris (21 h 59 UTC) est en juin, 22 h 01 UTC en juillet", () => {
    expect(monthKeyAt(new Date("2030-06-30T21:59:00Z"), PARIS)).toBe("2030-06");
    expect(monthKeyAt(new Date("2030-06-30T22:01:00Z"), PARIS)).toBe("2030-07");
  });

  it("les essais gratuits repartent au premier jour du mois suivant, à minuit à Paris", () => {
    expect(nextMonthStart(new Date("2026-11-13T12:00:00Z"), PARIS).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(nextMonthStart(new Date("2026-12-31T22:59:59Z"), PARIS).toISOString()).toBe("2026-12-31T23:00:00.000Z");
    // Le passage à l'heure d'été (fin mars) : minuit du 1er avril est à 22 h UTC.
    expect(nextMonthStart(new Date("2026-03-29T12:00:00Z"), PARIS).toISOString()).toBe("2026-03-31T22:00:00.000Z");
    expect(zonedMidnight(day(2026, 10, 25), PARIS).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(nextMonthStart(new Date("2026-11-13T12:00:00Z"), "UTC").toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("le jour à Paris", () => {
    expect(dayIn(new Date("2026-11-13T23:30:00Z"), PARIS)).toEqual(day(2026, 11, 14));
  });
});

describe("quota : gratuit d'abord, puis l'offert qui expire le plus tôt ; un offert expiré ne compte jamais", () => {
  const grant = (id: string, remaining: number, expiresAt: string, createdAt = "2030-01-01T00:00:00Z"): BonusGrant => ({ id, remaining, expiresAt: new Date(expiresAt), createdAt: new Date(createdAt) });
  const at = new Date("2030-04-15T10:00:00Z");
  const grants = [grant("tard", 3, "2030-09-01T00:00:00Z"), grant("tot", 2, "2030-05-01T00:00:00Z"), grant("expire", 5, "2030-04-01T00:00:00Z"), grant("vide", 0, "2030-04-20T00:00:00Z")];

  it("gratuits restants : jamais moins de zéro", () => {
    expect(freeRemaining(0, 5)).toBe(5);
    expect(freeRemaining(4, 5)).toBe(1);
    expect(freeRemaining(7, 5)).toBe(0);
  });

  it("offerts restants : seulement ceux encore valables", () => {
    expect(bonusRemaining(grants, at)).toBe(5);
    expect(bonusRemaining(grants, new Date("2030-05-02T00:00:00Z"))).toBe(3);
    expect(bonusRemaining(grants, new Date("2030-09-01T00:00:00Z"))).toBe(0);
  });

  it("l'offert à décompter : celui qui expire le plus tôt, puis le plus ancien", () => {
    expect(bonusToConsume(grants, at)?.id).toBe("tot");
    const twins = [grant("b", 1, "2030-06-01T00:00:00Z", "2030-02-01T00:00:00Z"), grant("a", 1, "2030-06-01T00:00:00Z", "2030-01-01T00:00:00Z")];
    expect(bonusToConsume(twins, at)?.id).toBe("a");
    expect(bonusToConsume([grant("expire", 5, "2030-04-01T00:00:00Z")], at)).toBeNull();
  });

  it("source du quota : gratuit tant qu'il en reste, puis offert ; ni l'un ni l'autre : compté sur le mois", () => {
    expect(quotaSourceFor(4, 5, grants, at)).toEqual({ source: "free", grant: null });
    expect(quotaSourceFor(5, 5, grants, at)).toMatchObject({ source: "bonus", grant: { id: "tot" } });
    expect(quotaSourceFor(5, 5, [], at)).toEqual({ source: "free", grant: null });
  });
});

describe("budget du mois : 80 % puis 100 %", () => {
  const rule = { budgetUsd: 1, pricePerCreditUsd: 0.075, alertThreshold: 0.8 };

  it("dépense exacte, sans erreur d'arrondi", () => {
    expect(spendUsd(13, 0.075)).toBe(0.975);
    expect(spendUsd(1333, 0.075)).toBe(99.975);
  });

  it("réservation : la dépense, plus les essais en cours et celui-ci, doit tenir dans le budget", () => {
    expect(reservationFitsBudget(rule, 12, 0, 1)).toBe(true); // 0,975 $
    expect(reservationFitsBudget(rule, 12, 1, 1)).toBe(false); // 1,05 $
    expect(reservationFitsBudget(rule, 13, 0, 1)).toBe(false);
    expect(reservationFitsBudget({ ...rule, budgetUsd: 0.075 }, 0, 0, 1)).toBe(true); // pile le budget
  });

  it("seuils : rien à 0,75 $, 80 % à 0,825 $, puis « budget épuisé » quand un essai de plus ne passerait plus", () => {
    expect(budgetThresholdsReached(rule, 10, 1)).toEqual([]);
    expect(budgetThresholdsReached(rule, 11, 1)).toEqual(["budget_80"]);
    expect(budgetThresholdsReached(rule, 12, 1)).toEqual(["budget_80"]);
    expect(budgetThresholdsReached(rule, 13, 1)).toEqual(["budget_80", "budget_100"]);
    // 80 % pile : l'alerte part.
    expect(budgetThresholdsReached({ budgetUsd: 100, pricePerCreditUsd: 0.08, alertThreshold: 0.8 }, 1000, 1)).toEqual(["budget_80"]);
  });

  it("résumé du mois (rapport du fondateur)", () => {
    expect(budgetSummary({ budgetUsd: 100, pricePerCreditUsd: 0.075, alertThreshold: 0.8 }, 400)).toEqual({ spentUsd: 30, remainingUsd: 70, usedShare: 0.3 });
    expect(budgetSummary(rule, 20)).toMatchObject({ remainingUsd: 0 });
  });
});

describe("porte d'âge (18 ans), calculée au jour près à Paris", () => {
  const today = day(2026, 11, 13);

  it("17 ans et 364 jours : mineur ; 18 ans pile : majeur", () => {
    expect(ageStatusFor("2008-11-14", today)).toBe("minor");
    expect(ageStatusFor("2008-11-13", today)).toBe("adult");
    expect(ageStatusFor("1970-01-01", today)).toBe("adult");
    expect(ageStatusFor("2026-11-13", today)).toBe("minor");
  });

  it("né un 29 février : majeur le 1er mars (le 18e anniversaire ne tombe jamais une année bissextile)", () => {
    expect(ageStatusFor("2008-02-29", day(2026, 2, 28))).toBe("minor");
    expect(ageStatusFor("2008-02-29", day(2026, 3, 1))).toBe("adult");
    expect(ageStatusFor("2004-02-29", day(2022, 2, 28))).toBe("minor");
    expect(ageStatusFor("2004-02-29", day(2022, 3, 1))).toBe("adult");
  });

  it("dates refusées : pas une vraie date, mauvais format, dans le futur, avant 1900", () => {
    for (const text of ["2001-02-29", "2008-13-01", "2008-04-31", "2008-00-10", "08-11-13", "2008/11/13", "2008-11-13T00:00", "", "1899-12-31", "2026-11-14"]) {
      expect(ageStatusFor(text, today), text).toBeNull();
    }
    expect(parseBirthDate("2004-02-29")).toEqual(day(2004, 2, 29));
    expect(parseBirthDate("1900-01-01")).toEqual(day(1900, 1, 1));
  });
});

describe("consentement versionné et accès à un essai", () => {
  const VERSION = "2026-11-v1";
  const profile = (fields: Partial<TryonProfileRow>): TryonProfileRow => ({
    age_status: "adult",
    age_checked_at: "2026-11-01T10:00:00Z",
    consent_version: VERSION,
    consent_accepted_at: "2026-11-01T10:01:00Z",
    consent_withdrawn_at: null,
    ...fields,
  });

  it("à demander tant que la version en vigueur n'est pas acceptée (ou après un retrait)", () => {
    expect(consentStateOf(null, VERSION)).toEqual({ required: true, version: VERSION });
    expect(consentStateOf(profile({}), VERSION)).toEqual({ required: false, version: VERSION });
    expect(consentStateOf(profile({ consent_version: "2025-01-v0" }), VERSION)).toEqual({ required: true, version: VERSION });
    expect(consentStateOf(profile({ consent_withdrawn_at: "2026-11-02T10:00:00Z" }), VERSION)).toEqual({ required: true, version: VERSION });
    // Une nouvelle version du texte : redemandé à tous.
    expect(consentStateOf(profile({}), "2027-01-v2")).toEqual({ required: true, version: "2027-01-v2" });
  });

  it("refus d'un essai, dans l'ordre : âge inconnu, mineur, consentement absent ou retiré, ancienne version", () => {
    expect(accessRefusal(null, VERSION)).toBe("tryon_age_required");
    expect(accessRefusal(profile({ age_status: null, age_checked_at: null }), VERSION)).toBe("tryon_age_required");
    expect(accessRefusal(profile({ age_status: "minor" }), VERSION)).toBe("tryon_minor");
    expect(accessRefusal(profile({ consent_version: null, consent_accepted_at: null }), VERSION)).toBe("tryon_consent_required");
    expect(accessRefusal(profile({ consent_withdrawn_at: "2026-11-02T10:00:00Z" }), VERSION)).toBe("tryon_consent_required");
    expect(accessRefusal(profile({ consent_version: "2025-01-v0" }), VERSION)).toBe("tryon_consent_outdated");
    expect(accessRefusal(profile({}), VERSION)).toBeNull();
    expect(ageGateOf(null)).toBe("unknown");
  });
});

describe("interrupteur double : TRYON_ENABLED (réglages prêts) ET drapeau de la base", () => {
  const config = { provider: "fake", timeZone: PARIS, apiBaseUrl: DEFAULT_FASHN_API_BASE_URL } as TryonConfig;

  it("les deux allumés : actif ; un seul : éteint ; réglages coupés ou invalides : le drapeau n'est même pas lu", async () => {
    const on = { isOn: vi.fn(async () => true) };
    const off = { isOn: vi.fn(async () => false) };
    expect(await activeTryonConfig({ state: "ready", config }, on)).toBe(config);
    expect(await activeTryonConfig({ state: "ready", config }, off)).toBeNull();
    const unread = { isOn: vi.fn(async () => true) };
    expect(await activeTryonConfig({ state: "off" }, unread)).toBeNull();
    expect(await activeTryonConfig({ state: "invalid", problems: ["TRYON_TIMEZONE : fuseau horaire inconnu"] }, unread)).toBeNull();
    expect(unread.isOn).not.toHaveBeenCalled();
  });
});

describe("pièces éligibles : image en https, lien d'achat valide", () => {
  const match = (fields: Partial<OwnMatchLinks>): OwnMatchLinks => ({
    id: "11000000-0000-4000-8000-000000000001",
    imageUrl: "https://encrypted-tbn0.gstatic.com/images?q=tbn:x",
    imageHdUrl: "https://boutique.example/hd.jpg",
    merchantUrl: "https://boutique.example/veste",
    affiliateUrl: null,
    ...fields,
  });

  it("l'image originale d'abord, puis la vignette ; https seulement ; sans doublon", () => {
    expect(garmentImageCandidates(match({}))).toEqual(["https://boutique.example/hd.jpg", "https://encrypted-tbn0.gstatic.com/images?q=tbn:x"]);
    expect(garmentImageCandidates(match({ imageHdUrl: "http://boutique.example/hd.jpg" }))).toEqual(["https://encrypted-tbn0.gstatic.com/images?q=tbn:x"]);
    expect(garmentImageCandidates(match({ imageHdUrl: "https://a.example/x.jpg", imageUrl: "https://a.example/x.jpg" }))).toEqual(["https://a.example/x.jpg"]);
    expect(garmentImageCandidates(match({ imageHdUrl: null, imageUrl: "javascript:alert(1)" }))).toEqual([]);
  });

  it("lien d'achat : l'affilié s'il existe, sinon celui du marchand ; exigé seulement si TRYON_REQUIRE_BUY_LINK", () => {
    expect(buyLinkOf(match({ affiliateUrl: "https://partenaire.example/r?p=1" }))).toBe("https://partenaire.example/r?p=1");
    expect(buyLinkOf(match({}))).toBe("https://boutique.example/veste");
    expect(tryonGarmentUrls(match({ merchantUrl: "pas un lien" }), true)).toBeNull();
    expect(tryonGarmentUrls(match({ merchantUrl: "pas un lien" }), false)).toHaveLength(2);
    expect(tryonGarmentUrls(match({ imageHdUrl: null, imageUrl: "http://x.example/a.jpg" }), false)).toBeNull();
  });
});

describe("codes d'échec : courts, d'une liste fermée, acceptés par la base", () => {
  it("chacun respecte la forme exigée par tryon_events.error_code", () => {
    for (const code of TRYON_FAILURE_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(new Set(TRYON_FAILURE_CODES).size).toBe(TRYON_FAILURE_CODES.length);
  });
});
