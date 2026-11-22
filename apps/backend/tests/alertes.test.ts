import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_LOG_MESSAGE, noteFailure, raiseAlert, REPEATED_FAILURES, resetAlertsForTests } from "../src/lib/alerts.js";
import {
  alertIfNearCap,
  alertIfServiceClosed,
  DEFAULT_SEARCH_WARN_PERCENT,
  logSearchWarnSettings,
  readSearchWarnPercent,
  searchWarnPercent,
  warnThreshold,
  type QuotaRow,
} from "../src/lib/searchCapacity.js";

// Alertes du serveur (lot garde-fous, points 6 et 15) : une ligne « Alerte »
// dans le journal et un avertissement Sentry, jamais de donnée personnelle ;
// une même alerte n'est pas répétée. Sentry est simulé (aucun envoi).

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 10, 6, 9, 0);

function fakeLog() {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  return { lines, warn: (fields: Record<string, unknown>, message: string) => lines.push({ fields, message }) };
}

beforeEach(() => resetAlertsForTests());

describe("alertes", () => {
  it("une alerte : la ligne « Alerte » et l'envoi à Sentry, avec le tag « alerte »", () => {
    const log = fakeLog();
    const send = vi.fn();
    expect(raiseAlert(log, { kind: "disjoncteur", message: "Recherche en pause", tags: { motif: "pannes" } }, NOW, send)).toBe(true);
    expect(log.lines).toEqual([{ fields: { alerte: "disjoncteur", motif: "pannes" }, message: ALERT_LOG_MESSAGE }]);
    expect(send).toHaveBeenCalledOnce();
    const [message, tags, fingerprint] = send.mock.calls[0]!;
    expect(message).toBe("Recherche en pause");
    expect(tags).toEqual({ alerte: "disjoncteur", motif: "pannes" });
    // Sans clé : chaque appel est un nouveau problème dans Sentry, donc une notification.
    expect(fingerprint[0]).toBe("disjoncteur");
    raiseAlert(log, { kind: "disjoncteur", message: "Recherche en pause" }, NOW, send);
    expect(send.mock.calls[1]![2][1]).not.toBe(fingerprint[1]);
  });

  it("une même clé n'alerte qu'une fois pendant sa durée, puis de nouveau", () => {
    const send = vi.fn();
    const alert = { kind: "plafond_ia" as const, message: "Plafond", onceKey: "plafond_ia:video:jour", onceMs: 60 * MINUTE };
    expect(raiseAlert(fakeLog(), alert, NOW, send)).toBe(true);
    expect(raiseAlert(fakeLog(), alert, NOW + 59 * MINUTE, send)).toBe(false);
    expect(raiseAlert(fakeLog(), alert, NOW + 61 * MINUTE, send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("échecs répétés : alerte au 5e échec en 15 minutes, une fois par heure au plus", () => {
    const send = vi.fn();
    const log = fakeLog();
    // 4 échecs étalés sur plus de 15 minutes : rien.
    for (const minute of [0, 6, 12, 18]) expect(noteFailure(log, "ia_video", NOW + minute * MINUTE, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    // 5 en 15 minutes : une alerte, puis plus rien dans l'heure.
    const start = NOW + 30 * MINUTE;
    const raised = Array.from({ length: REPEATED_FAILURES.count + 3 }, (_, index) => noteFailure(log, "ia_video", start + index * MINUTE, send));
    expect(raised.filter(Boolean)).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![1]).toEqual({ alerte: "echecs_repetes", source: "ia_video" });
    // Un autre fournisseur a son propre compte.
    expect(noteFailure(log, "google_shopping", start, send)).toBe(false);
  });

  it("plafond des recherches : le jour et le mois alertent (une fois), jamais la part d'une personne", () => {
    const send = vi.fn();
    const caps = { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 };
    const row = (refused: "day" | "month" | "user" | null): QuotaRow =>
      refused === null
        ? { allowed: true, refused_by: null, reservation_id: 1, day_count: 1, month_count: 1, user_day_count: 1, next_renewal: "2026-12-03" }
        : { allowed: false, refused_by: refused, reservation_id: null, day_count: 25, month_count: 100, user_day_count: 8, next_renewal: "2026-12-03" };
    const log = { warn: vi.fn() };
    const now = new Date(NOW);
    alertIfServiceClosed(log, row(null), caps, now);
    alertIfServiceClosed(log, row("user"), caps, now);
    expect(log.warn).not.toHaveBeenCalled();
    alertIfServiceClosed(log, row("day"), caps, now);
    alertIfServiceClosed(log, row("day"), caps, new Date(NOW + 3 * 60 * MINUTE));
    alertIfServiceClosed(log, row("month"), caps, now);
    expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([
      { alerte: "plafond_recherches", plafond: "day" },
      { alerte: "plafond_recherches", plafond: "month" },
    ]);
    // Le lendemain (jour de Paris), le plafond du jour alerte de nouveau.
    alertIfServiceClosed(log, row("day"), caps, new Date(NOW + 24 * 60 * MINUTE));
    expect(log.warn).toHaveBeenCalledTimes(3);
  });

  // Lot « compteurs quota » : prévenu à 80 % des plafonds, avant que Spotter ne ferme.
  describe("seuil des recherches (SERPAPI_WARN_PERCENT)", () => {
    const caps = { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 };
    const allowed = (month: number, day = 1): QuotaRow => ({
      allowed: true,
      refused_by: null,
      reservation_id: 1,
      day_count: day,
      month_count: month,
      user_day_count: 1,
      next_renewal: "2026-12-03",
    });
    const refused = (by: "day" | "month" | "user", month: number, day: number): QuotaRow => ({
      allowed: false,
      refused_by: by,
      reservation_id: null,
      day_count: day,
      month_count: month,
      user_day_count: 8,
      next_renewal: "2026-12-03",
    });
    const now = new Date(NOW);

    it("le seuil par défaut : 180 sur 225 pour le mois, 20 sur 25 pour le jour", () => {
      expect(DEFAULT_SEARCH_WARN_PERCENT).toBe(80);
      expect(warnThreshold(225, 80)).toBe(180);
      expect(warnThreshold(25, 80)).toBe(20);
    });

    it("sous le seuil : aucune alerte (179 sur 225, 19 sur 25)", () => {
      const log = { warn: vi.fn() };
      alertIfNearCap(log, allowed(179, 19), caps, 80, now);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it("au seuil du mois : une alerte, envoyée par le canal d'alerte (journal et Sentry)", () => {
      const log = fakeLog();
      alertIfNearCap(log, allowed(180), caps, 80, now);
      expect(log.lines).toEqual([{ fields: { alerte: "seuil_recherches", plafond: "month" }, message: ALERT_LOG_MESSAGE }]);
    });

    it("le texte envoyé : le compteur, le plafond, le seuil et la date du renouvellement, rien d'autre", () => {
      const send = vi.fn();
      alertIfNearCap(fakeLog(), allowed(181), caps, 80, now, send);
      expect(send).toHaveBeenCalledOnce();
      const [message, tags, fingerprint] = send.mock.calls[0]!;
      expect(message).toBe("Recherches du mois : 181 sur 225 déjà utilisées (seuil de 80 %) ; à 225, Spotter sera fermé à tous jusqu'au 2026-12-03");
      expect(tags).toEqual({ alerte: "seuil_recherches", plafond: "month" });
      // Une clé par cycle : un nouveau problème dans Sentry à chaque cycle, donc une notification.
      expect(fingerprint).toEqual(["seuil_recherches", "seuil_recherches:month:2026-12-03"]);
    });

    it("jamais deux fois dans un cycle ; de nouveau au cycle suivant", () => {
      const log = { warn: vi.fn() };
      alertIfNearCap(log, allowed(180), caps, 80, now);
      alertIfNearCap(log, allowed(190), caps, 80, new Date(NOW + 5 * 24 * 60 * MINUTE));
      alertIfNearCap(log, refused("user", 200, 3), caps, 80, new Date(NOW + 10 * 24 * 60 * MINUTE));
      expect(log.warn).toHaveBeenCalledOnce();
      // Cycle suivant (renouvellement du 3 janvier) : une nouvelle alerte.
      alertIfNearCap(log, { ...allowed(180), next_renewal: "2027-01-03" }, caps, 80, new Date(NOW + 30 * 24 * 60 * MINUTE));
      expect(log.warn).toHaveBeenCalledTimes(2);
    });

    it("le jour : une alerte au seuil, une seule par jour de Paris, de nouveau le lendemain", () => {
      const log = { warn: vi.fn() };
      alertIfNearCap(log, allowed(10, 20), caps, 80, now);
      alertIfNearCap(log, allowed(11, 22), caps, 80, new Date(NOW + 3 * 60 * MINUTE));
      expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([{ alerte: "seuil_recherches", plafond: "day" }]);
      alertIfNearCap(log, allowed(12, 20), caps, 80, new Date(NOW + 24 * 60 * MINUTE));
      expect(log.warn).toHaveBeenCalledTimes(2);
    });

    it("un plafond qui vient de refuser n'a pas d'avertissement en plus (l'alerte « plafond_recherches » suffit)", () => {
      const log = { warn: vi.fn() };
      alertIfNearCap(log, refused("month", 225, 24), caps, 80, now);
      alertIfNearCap(log, refused("day", 100, 25), caps, 80, now);
      expect(log.warn).not.toHaveBeenCalled();
      // Refus de la part d'une personne : le service est ouvert, le seuil compte.
      alertIfNearCap(log, refused("user", 180, 3), caps, 80, now);
      expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([{ alerte: "seuil_recherches", plafond: "month" }]);
    });

    it("le seuil réglé est suivi : 90 % prévient à 203 sur 225, pas à 202", () => {
      const log = { warn: vi.fn() };
      alertIfNearCap(log, allowed(202), caps, 90, now);
      expect(log.warn).not.toHaveBeenCalled();
      alertIfNearCap(log, allowed(203), caps, 90, now);
      expect(log.warn).toHaveBeenCalledOnce();
    });

    it("réglage : une valeur de 50 à 99 est retenue ; absente ou vide, 80", () => {
      const problems: string[] = [];
      expect(readSearchWarnPercent({ SERPAPI_WARN_PERCENT: "50" }, problems)).toBe(50);
      expect(readSearchWarnPercent({ SERPAPI_WARN_PERCENT: " 99 " }, problems)).toBe(99);
      expect(readSearchWarnPercent({ SERPAPI_WARN_PERCENT: undefined }, problems)).toBe(80);
      expect(readSearchWarnPercent({ SERPAPI_WARN_PERCENT: "" }, problems)).toBe(80);
      expect(problems).toEqual([]);
      expect(searchWarnPercent({ SERPAPI_WARN_PERCENT: "85" })).toBe(85);
    });

    it("réglage invalide : ignoré (80), dit au journal sans sa valeur, jamais d'arrêt", () => {
      for (const bad of ["49", "100", "7", "8O", "80%", "80.5", "-80", "1e2", "080"]) {
        const problems: string[] = [];
        expect(readSearchWarnPercent({ SERPAPI_WARN_PERCENT: bad }, problems)).toBe(80);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("SERPAPI_WARN_PERCENT");
        expect(problems[0]).not.toContain(bad);
      }
      const log = { warn: vi.fn() };
      logSearchWarnSettings(log, { SERPAPI_WARN_PERCENT: "120" });
      expect(log.warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.warn.mock.calls[0])).not.toContain("120");
      const quiet = { warn: vi.fn() };
      logSearchWarnSettings(quiet, { SERPAPI_WARN_PERCENT: "80" });
      expect(quiet.warn).not.toHaveBeenCalled();
    });
  });
});
