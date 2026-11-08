import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_LOG_MESSAGE, noteFailure, raiseAlert, REPEATED_FAILURES, resetAlertsForTests } from "../src/lib/alerts.js";
import { alertIfServiceClosed, type QuotaRow } from "../src/lib/searchCapacity.js";

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
});
