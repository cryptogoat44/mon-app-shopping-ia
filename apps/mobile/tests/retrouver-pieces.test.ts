import { afterEach, describe, expect, it } from "vitest";
import { setActiveLocale } from "../src/i18n";
import { RECENT_SEARCHES_LIMIT, recentDayLabel } from "../src/lib/recent-searches";
import { ownedMarks, withIds } from "../src/lib/owned-marks";
import { rememberLaunchExtras, withLaunchExtras } from "../src/api/spotSession";
import type { SpotResult } from "../src/api/types";

// Lot « Retrouver ses pièces » : les 20 dernières recherches avec leur jour
// (« Tout voir »), et « Gardée » / « Ajoutée au Vault » sur un résultat rouvert.

afterEach(() => setActiveLocale("fr"));

/** Une date à l'heure de l'appareil, en texte ISO comme celles du serveur. */
const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
// Mardi 3 novembre 2026, 9 h 30.
const NOW = new Date(2026, 10, 3, 9, 30);

describe("« Récemment spottées » : 20 recherches, chacune avec son jour", () => {
  it("demande le maximum du serveur (GET /api/searches : 6 par défaut, 20 au plus)", () => {
    expect(RECENT_SEARCHES_LIMIT).toBe(20);
  });

  it("aujourd'hui, hier, puis le jour de la semaine et la date", () => {
    expect(recentDayLabel(at(2026, 11, 3, 0, 5), "fr", NOW)).toBe("Aujourd'hui");
    expect(recentDayLabel(at(2026, 11, 2, 23, 50), "fr", NOW)).toBe("Hier");
    expect(recentDayLabel(at(2026, 11, 2, 0, 1), "fr", NOW)).toBe("Hier");
    expect(recentDayLabel(at(2026, 10, 27, 18), "fr", NOW)).toBe("mardi 27 octobre");
  });

  it("le 1er du mois, et l'année quand ce n'est plus l'année en cours", () => {
    expect(recentDayLabel(at(2026, 11, 1), "fr", NOW)).toBe("dimanche 1er novembre");
    expect(recentDayLabel(at(2025, 12, 30), "fr", NOW)).toBe("mardi 30 décembre 2025");
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(recentDayLabel(at(2026, 11, 3, 8), "en", NOW)).toBe("Today");
    expect(recentDayLabel(at(2026, 11, 2, 8), "en", NOW)).toBe("Yesterday");
    expect(recentDayLabel(at(2026, 10, 27), "en", NOW)).toBe("Tuesday, October 27");
    expect(recentDayLabel(at(2026, 11, 1), "en", NOW)).toBe("Sunday, November 1");
  });

  it("une date un peu en avance (horloge de l'appareil) reste « Aujourd'hui »", () => {
    expect(recentDayLabel(at(2026, 11, 4, 1), "fr", NOW)).toBe("Aujourd'hui");
  });

  it("aux changements d'heure (journées de 23 et 25 heures à Paris) : la veille reste « Hier »", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Europe/Paris";
    try {
      // Heure d'été le dimanche 29 mars 2026 : la veille ne dure que 23 heures.
      expect(recentDayLabel(at(2026, 3, 29, 9), "fr", new Date(2026, 2, 30, 9))).toBe("Hier");
      expect(recentDayLabel(at(2026, 3, 28, 23, 30), "fr", new Date(2026, 2, 30, 9))).toBe("samedi 28 mars");
      // Heure d'hiver le dimanche 25 octobre 2026 : 25 heures.
      expect(recentDayLabel(at(2026, 10, 25, 9), "fr", new Date(2026, 9, 26, 9))).toBe("Hier");
      expect(recentDayLabel(at(2026, 10, 24, 23, 30), "fr", new Date(2026, 9, 26, 9))).toBe("samedi 24 octobre");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});

describe("résultat rouvert : « Gardée » et « Ajoutée au Vault » d'après le serveur", () => {
  it("reprend les propositions gardées et achetées ; un ancien serveur n'en dit rien", () => {
    expect(ownedMarks({ wishlistMatchIds: ["a"], vaultMatchIds: ["b", "c"] })).toEqual({ kept: ["a"], bought: ["b", "c"] });
    expect(ownedMarks({})).toEqual({ kept: [], bought: [] });
  });

  it("ajoute aux repères de l'écran sans en retirer ; le même ensemble s'il ne manque rien", () => {
    const current = new Set(["a"]);
    expect(withIds(current, [])).toBe(current);
    expect(withIds(current, ["a"])).toBe(current);
    const next = withIds(current, ["b", "a"]);
    expect([...next].sort()).toEqual(["a", "b"]);
    expect(current.has("b")).toBe(false);
  });

  it("les mentions du lancement ajoutées à un résultat relu gardent ses repères", () => {
    const relu: SpotResult = { searchId: "s1", status: "success", pieces: [], similarPieces: [], owned: { kept: ["a"], bought: ["b"] } };
    rememberLaunchExtras({ ...relu, sortedByWords: true });
    expect(withLaunchExtras(relu)).toMatchObject({ sortedByWords: true, owned: { kept: ["a"], bought: ["b"] } });
  });
});
