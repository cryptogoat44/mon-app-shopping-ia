import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSearchCapacity, parseSearchMonthlyQuota, SEARCH_CAPACITY_ERRORS, SEARCH_MONTHLY_QUOTA_ERROR, type SearchCapacityStatus, type SearchMonthlyQuota } from "@monapp/shared-types";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { setActiveLocale } from "../src/i18n";
import { blocksLaunch, capacityCopy, isQuietNotice, limitsNotice, nextBoundary, noticeText, type LocalClock } from "../src/lib/search-limits";
import { capacityFailure, capacityMonthTip, monthlyQuotaCopy } from "../src/lib/spot-capacity";
import { failureCorrections } from "../src/lib/spot-corrections";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import * as siteExtra from "../src/legal-extra/confidentialite-extra.web";

// Lot quotas (migration 0053) : la part du mois d'un compte gratuit, dite
// AVANT l'effort (« Il vous reste 12 recherches ce mois-ci » à 20 ou moins,
// pas en permanence) et à 0 avec le mois et la date du retour, dans la langue
// de l'app. Un serveur plus ancien n'envoie rien : rien ne change.

afterEach(() => setActiveLocale("fr"));

// 19 novembre 2026, 13 h à Paris ; minuit : 23 h UTC ; 1er décembre à Paris : 30 novembre, 23 h UTC.
const NOW = Date.parse("2026-11-19T12:00:00Z");
const MIDNIGHT = "2026-11-19T23:00:00.000Z";
const FIRST = "2026-11-30T23:00:00.000Z";
const PARIS: LocalClock = (ms) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value])
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
};

function quota(remaining: number, limit = 100, resetsOn = "2026-12-01", resetsAt = FIRST): SearchMonthlyQuota {
  return { limit, used: limit - remaining, remaining, resetsOn, resetsAt };
}

function status(options: { today?: number; userRemaining?: number; monthly?: SearchMonthlyQuota | null; service?: SearchCapacityStatus["service"] } = {}): SearchCapacityStatus {
  const userRemaining = options.userRemaining ?? 8;
  const base: SearchCapacityStatus = {
    user: { used: 8 - userRemaining, limit: 8, remaining: userRemaining, resetsAt: MIDNIGHT },
    service: options.service ?? { status: "open" },
    remainingToday: options.today ?? userRemaining,
  };
  return options.monthly === undefined ? base : { ...base, monthlyQuota: options.monthly };
}

describe("compteur reçu du serveur : la part du mois, lue sans lui faire confiance", () => {
  const body = { user: { used: 1, limit: 8, remaining: 7, resetsAt: MIDNIGHT }, service: { status: "open" }, remainingToday: 7 };

  it("présente : gardée ; null (abonné) : null ; absente (serveur plus ancien) : rien de plus", () => {
    expect(parseSearchCapacity({ ...body, monthlyQuota: quota(37) })).toEqual({ ...body, monthlyQuota: quota(37) });
    expect(parseSearchCapacity({ ...body, monthlyQuota: null })).toEqual({ ...body, monthlyQuota: null });
    expect(parseSearchCapacity(body)).toEqual(body);
  });

  it("illisible : null (rien n'est annoncé pour le mois), le reste du compteur gardé", () => {
    for (const bad of [{ ...quota(3), limit: 0 }, { ...quota(3), used: -1 }, { ...quota(3), resetsOn: "1er décembre" }, { ...quota(3), resetsAt: "demain" }, "100", 100]) {
      expect(parseSearchMonthlyQuota(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseSearchCapacity({ ...body, monthlyQuota: { limit: "100" } })).toEqual({ ...body, monthlyQuota: null });
  });
});

describe("ce qui est annoncé avant de chercher", () => {
  it("à 20 ou moins : une ligne discrète, « Il vous reste 12 recherches ce mois-ci. » ; à 21, rien", () => {
    const low = limitsNotice(status({ monthly: quota(12), today: 8 }), NOW);
    expect(low).toEqual({ kind: "month_low", remaining: 12 });
    expect(isQuietNotice(low)).toBe(true);
    expect(blocksLaunch(low)).toBe(false);
    expect(noticeText(low!, NOW, "fr")).toEqual({ title: "Il vous reste 12 recherches ce mois-ci.", body: null });
    expect(limitsNotice(status({ monthly: quota(20) }), NOW)).toEqual({ kind: "month_low", remaining: 20 });
    expect(limitsNotice(status({ monthly: quota(21) }), NOW)).toBeNull();
    expect(noticeText({ kind: "month_low", remaining: 1 }, NOW, "fr").title).toBe("Il vous reste 1 recherche ce mois-ci.");
    setActiveLocale("en");
    expect(noticeText({ kind: "month_low", remaining: 12 }, NOW, "en").title).toBe("You have 12 searches left this month.");
  });

  it("à 0 : « Vous avez utilisé vos 100 recherches de novembre. Elles reviennent le 1er décembre. », et « Lancer » est bloqué", () => {
    const usedUp = limitsNotice(status({ monthly: quota(0), today: 0 }), NOW);
    expect(usedUp).toEqual({ kind: "month_used_up", limit: 100, resetsOn: "2026-12-01" });
    expect(blocksLaunch(usedUp)).toBe(true);
    expect(isQuietNotice(usedUp)).toBe(false);
    expect(noticeText(usedUp!, NOW, "fr", PARIS)).toEqual({ title: "Vous avez utilisé vos 100 recherches de novembre.", body: "Elles reviennent le 1er décembre." });
    setActiveLocale("en");
    expect(noticeText(usedUp!, NOW, "en", PARIS)).toEqual({ title: "You've used your 100 searches for November.", body: "They'll be back on December 1." });
  });

  it("le mois dans la langue de l'app, avec l'élision du français (« d'avril », « d'août », « d'octobre »)", () => {
    expect(monthlyQuotaCopy(100, "2027-05-01", "fr")[0]).toBe("Vous avez utilisé vos 100 recherches d'avril.");
    expect(monthlyQuotaCopy(100, "2027-09-01", "fr")[0]).toBe("Vous avez utilisé vos 100 recherches d'août.");
    expect(monthlyQuotaCopy(100, "2026-11-01", "fr")[0]).toBe("Vous avez utilisé vos 100 recherches d'octobre.");
    expect(monthlyQuotaCopy(100, "2027-01-01", "fr")).toEqual(["Vous avez utilisé vos 100 recherches de décembre.", "Elles reviennent le 1er janvier."]);
    // Limite ou date inconnues : sans elles, jamais un chiffre inventé.
    expect(monthlyQuotaCopy(null, null, "fr")).toEqual(["Vous avez utilisé toutes vos recherches de ce mois-ci.", "Elles reviennent au début du mois prochain."]);
  });

  it("la part du mois épuisée passe avant tout, sauf la pause du service ; elle bloque encore après minuit, jusqu'au 1er", () => {
    expect(limitsNotice(status({ monthly: quota(0), userRemaining: 0, today: 0 }), NOW)).toMatchObject({ kind: "month_used_up" });
    expect(limitsNotice(status({ monthly: quota(0), service: { status: "paused", reason: "day", reopensAt: MIDNIGHT } }), NOW)).toMatchObject({ kind: "paused" });
    const afterMidnight = Date.parse("2026-11-20T08:00:00Z");
    expect(limitsNotice(status({ monthly: quota(0), today: 0 }), afterMidnight)).toMatchObject({ kind: "month_used_up" });
    // Le 1er décembre passé : la lecture est périmée, rien n'est bloqué.
    expect(limitsNotice(status({ monthly: quota(0), today: 0 }), Date.parse("2026-12-01T08:00:00Z"))).toBeNull();
  });

  it("la part du jour, plus petite, est dite d'abord ; égales, la part du mois", () => {
    expect(limitsNotice(status({ monthly: quota(15), userRemaining: 2, today: 2 }), NOW)).toEqual({ kind: "low", remaining: 2 });
    expect(limitsNotice(status({ monthly: quota(3), today: 3 }), NOW)).toEqual({ kind: "month_low", remaining: 3 });
  });

  it("abonné (part du mois null) ou serveur sans quotas : exactement comme avant", () => {
    expect(limitsNotice(status({ monthly: null }), NOW)).toBeNull();
    expect(limitsNotice(status({ monthly: null, today: 2, userRemaining: 2 }), NOW)).toEqual({ kind: "low", remaining: 2 });
    expect(limitsNotice(status(), NOW)).toBeNull();
  });

  it("le 1er du mois est une échéance : l'annonce tombe d'elle-même", () => {
    // Avant minuit : minuit d'abord (la part du jour) ; après, le 1er du mois.
    expect(nextBoundary(status({ monthly: quota(0) }), NOW)).toBe(Date.parse(MIDNIGHT));
    expect(nextBoundary(status({ monthly: quota(0) }), Date.parse("2026-11-20T08:00:00Z"))).toBe(Date.parse(FIRST));
  });
});

describe("refus du serveur : part du mois atteinte", () => {
  it("son code, son motif et la date du retour ; les autres plafonds gardent les leurs", () => {
    expect(capacityFailure({ error: SEARCH_MONTHLY_QUOTA_ERROR, message: "…", resumesOn: "2026-12-01" })).toEqual({ reason: "capacity_user_month", resumesOn: "2026-12-01" });
    expect(capacityFailure({ error: SEARCH_MONTHLY_QUOTA_ERROR, resumesOn: "le 1er" })).toEqual({ reason: "capacity_user_month", resumesOn: null });
    expect(capacityFailure({ error: SEARCH_CAPACITY_ERRORS.user })).toEqual({ reason: "capacity_user", resumesOn: null });
  });

  it("le message de l'écran Résultat : la limite du dernier compteur lu, sinon sans chiffre", () => {
    expect(capacityCopy("capacity_user_month", "2026-12-01", status({ monthly: quota(0) }), NOW, "fr")).toEqual([
      "Vous avez utilisé vos 100 recherches de novembre.",
      "Elles reviennent le 1er décembre.",
    ]);
    expect(capacityCopy("capacity_user_month", "2026-12-01", null, NOW, "fr")).toEqual(["Vous avez utilisé toutes vos recherches de ce mois-ci.", "Elles reviennent le 1er décembre."]);
  });

  it("aucune correction proposée : un nouvel essai serait refusé", () => {
    expect(failureCorrections("capacity_user_month", { hasDraft: true, hasVideo: true, fromLink: false, remainingMoments: 2 })).toEqual([]);
  });

  it("une app d'avant ce lot (sans v=2) reçoit le plafond du mois, qu'elle connaît : la bonne date, jamais « par heure »", () => {
    // Le corps que le serveur envoie à une app qui ne dit pas comprendre la part du mois.
    const older = capacityFailure({ error: SEARCH_CAPACITY_ERRORS.month, message: "Vous avez utilisé toutes vos recherches de ce mois-ci.", resumesOn: "2026-12-01" });
    expect(older).toEqual({ reason: "capacity_month", resumesOn: "2026-12-01" });
    expect(capacityMonthTip(older!.resumesOn, "fr")).toBe("Réessayez à partir du 1er décembre.");
    expect(failureCorrections(older!.reason, { hasDraft: true, hasVideo: true, fromLink: false, remainingMoments: 2 })).toEqual([]);
  });
});

describe("l'app dit au serveur qu'elle comprend la part du mois (v=2)", () => {
  const api = readFileSync(join(__dirname, "../src/lib/api.ts"), "utf8");

  it("sur les lancements (photo, vos mots, vidéo, lien) et sur le compteur", () => {
    expect(api).toContain("authorizedFetch(`/api/searches/${searchId}/run?${SPEAKS}`, { method: \"POST\", body: formData, signal })");
    expect(api).toContain("authorizedFetch(`/api/searches/${searchId}/text?${SPEAKS}`, { method: \"POST\", body: JSON.stringify(payload), signal })");
    expect(api).toContain("authorizedFetch(`/api/video-moments?${SPEAKS}`, { method: \"POST\", body: formData, signal })");
    expect(api).toContain("authorizedFetch(`/api/video-links/analyze?${SPEAKS}`, { method: \"POST\", body: JSON.stringify(request), signal })");
    expect(api).toContain("authorizedFetch(`/api/searches/capacity?${SPEAKS}`)");
    // Aucune autre forme de ces adresses, sans le paramètre.
    expect(api).not.toMatch(/authorizedFetch\((["'`])\/api\/(searches\/capacity|video-moments|video-links\/analyze)\1/);
  });
});

describe("textes FR et EN", () => {
  it("la section est ajoutée à la fin des deux catalogues, après celle du lot précédent, avec les mêmes clés, au vouvoiement", () => {
    // Juste après celle du lot précédent (« messages, plus de confort »), dans les deux catalogues ;
    // les sections des lots fusionnés après elle (vie sociale, découverte) viennent à sa suite.
    for (const catalog of [fr, en]) {
      const keys = Object.keys(catalog);
      expect(keys.indexOf("monthlyQuota")).toBe(keys.indexOf("messageActions") + 1);
    }
    expect(Object.keys(en)).toEqual(Object.keys(fr));
    expect(Object.keys(en.monthlyQuota).sort()).toEqual(Object.keys(fr.monthlyQuota).sort());
    const texts = [fr.monthlyQuota.remaining(3), fr.monthlyQuota.usedUp(100, "novembre"), fr.monthlyQuota.usedUpUnknown, fr.monthlyQuota.backOn("1er décembre"), fr.monthlyQuota.backSoon];
    for (const text of texts) expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
  });

  it("aucun prix, aucune mention d'abonnement dans ce lot", () => {
    const all = JSON.stringify([fr.monthlyQuota, en.monthlyQuota, fr.monthlyQuota.usedUp(100, "mai"), en.monthlyQuota.usedUp(100, "May")]);
    expect(all).not.toMatch(/abonn|subscri|€|\$|prix|price|premium|Vidéo|Miroir/i);
  });
});

describe("textes juridiques (sans nouvelle version)", () => {
  const text = (document: { sections: readonly { blocks: readonly unknown[] }[] }) => JSON.stringify(document.sections);

  it("conditions d'utilisation : 100 recherches par mois pour un compte gratuit, 8 par jour pour tous, en français et en anglais", () => {
    expect(text(termsOfUse)).toContain("un compte gratuit peut lancer 100 recherches par mois civil, du 1er à 0 h (heure de Paris) au 1er du mois suivant, et chaque compte 8 recherches par jour");
    expect(text(termsOfUseEn)).toContain("a free account can run 100 searches per calendar month, from 12 am (Paris time) on the 1st to the 1st of the following month, and every account 8 searches per day");
    // Le cache ne compte pas, une panne non plus.
    expect(text(termsOfUse)).toContain("une recherche servie par notre mémoire des recherches récentes, ou qui échoue pour une raison technique, n'est pas comptée");
  });

  it("politique : le compteur du mois, le statut d'abonnement conservé (sans nommer de prestataire), l'export et la suppression", () => {
    for (const policy of [text(privacyPolicy), text(privacyPolicyEn)]) {
      expect(policy).not.toMatch(/revenuecat|revenue cat/i);
    }
    expect(text(privacyPolicy)).toContain("compte vos recherches du jour et du mois civil à partir de l'historique de vos recherches ; aucun compteur de plus n'est enregistré");
    expect(text(privacyPolicy)).toContain("Si vous avez un abonnement, Spotto conserve son type, sa date de fin, d'où vient l'information et la date de sa dernière mise à jour");
    expect(text(privacyPolicy)).toContain("Votre statut d'abonnement : gardé tant que votre compte existe, mis à jour à chaque changement, et effacé avec votre compte.");
    expect(text(privacyPolicyEn)).toContain("If you have a subscription, Spotto keeps its type, its end date, where the information came from and the date it was last updated");
  });

  it("site seulement : 5 essais par mois pour un compte gratuit (jamais dans les textes de l'app iPhone)", () => {
    expect(JSON.stringify(siteExtra.privacyExtraFr.sections)).toContain("un compte gratuit a 5 essais par mois civil, remis à zéro le 1er de chaque mois à 0 h (heure de Paris)");
    expect(JSON.stringify(siteExtra.privacyExtraEn.sections)).toContain("a free account has 5 try-ons per calendar month, reset on the 1st of each month at 12 am (Paris time)");
    for (const document of [termsOfUse, termsOfUseEn, privacyPolicy, privacyPolicyEn]) expect(text(document)).not.toMatch(/essayage|5 essais|try-on/i);
  });
});
