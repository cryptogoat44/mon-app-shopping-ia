import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSearchCapacityStatus, type SearchCapacityStatus } from "@monapp/shared-types";
import { setActiveLocale } from "../src/i18n";
import {
  blocksLaunch,
  capacityCopy,
  createLimitsStore,
  deviceClock,
  formatHour,
  limitsNotice,
  nextBoundary,
  noticeText,
  onSearchLaunched,
  reopenWhen,
  searchLaunched,
  type LimitsNotice,
  type LocalClock,
} from "../src/lib/search-limits";

// Lot limites annoncées : les limites dites AVANT l'effort, à partir du
// compteur lu sans rien réserver. Lecture échouée : rien n'est annoncé ni
// bloqué. Heures à l'heure de l'appareil : la reprise est à minuit, à Paris.

afterEach(() => setActiveLocale("fr"));

/** Horloge d'un appareil réglé sur ce fuseau (l'appareil, lui, lit la sienne). */
function zoneClock(timeZone: string): LocalClock {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (ms) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
  };
}

const PARIS = zoneClock("Europe/Paris");
const NEW_YORK = zoneClock("America/New_York");
const TOKYO = zoneClock("Asia/Tokyo");

// 13 h à Paris le 3 novembre 2026 ; minuit à Paris : 23 h UTC.
const NOW = Date.parse("2026-11-03T12:00:00Z");
const MIDNIGHT = "2026-11-03T23:00:00.000Z";
const RENEWAL = "2026-12-02T23:00:00.000Z";

function status(overrides: { used?: number; limit?: number; remainingToday?: number; service?: SearchCapacityStatus["service"]; resetsAt?: string } = {}): SearchCapacityStatus {
  const limit = overrides.limit ?? 8;
  const used = overrides.used ?? 0;
  const remaining = Math.max(0, limit - used);
  return {
    user: { used, limit, remaining, resetsAt: overrides.resetsAt ?? MIDNIGHT },
    service: overrides.service ?? { status: "open" },
    remainingToday: overrides.remainingToday ?? remaining,
  };
}

describe("compteur reçu du serveur, lu sans lui faire confiance", () => {
  it("garde un compteur bien formé, ouvert ou en pause", () => {
    const open = { user: { used: 2, limit: 8, remaining: 6, resetsAt: MIDNIGHT }, service: { status: "open" }, remainingToday: 6 };
    expect(parseSearchCapacityStatus(open)).toEqual(open);
    const paused = { ...open, service: { status: "paused", reason: "month", reopensAt: RENEWAL }, remainingToday: 0 };
    expect(parseSearchCapacityStatus(paused)).toEqual(paused);
  });

  it("refuse tout le reste (l'app n'affiche alors rien)", () => {
    const user = { used: 2, limit: 8, remaining: 6, resetsAt: MIDNIGHT };
    for (const bad of [
      null,
      "ouvert",
      { user, service: { status: "open" } },
      { user: { ...user, used: -1 }, service: { status: "open" }, remainingToday: 6 },
      { user: { ...user, remaining: 1.5 }, service: { status: "open" }, remainingToday: 1 },
      { user: { ...user, resetsAt: "minuit" }, service: { status: "open" }, remainingToday: 6 },
      { user, service: { status: "paused", reason: "user", reopensAt: MIDNIGHT }, remainingToday: 0 },
      { user, service: { status: "paused", reason: "day" }, remainingToday: 0 },
      { user, service: { status: "fermé" }, remainingToday: 0 },
    ]) {
      expect(parseSearchCapacityStatus(bad)).toBeNull();
    }
  });
});

describe("ce qui est annoncé, et quand « Lancer » est désactivé", () => {
  it("compteur inconnu (lecture échouée) : rien du tout, rien de bloqué", () => {
    expect(limitsNotice(null, NOW)).toBeNull();
    expect(blocksLaunch(null)).toBe(false);
  });

  it("service en pause : la raison et la reprise ; « Lancer » désactivé — jusqu'à la reprise seulement", () => {
    const paused = status({ remainingToday: 0, service: { status: "paused", reason: "day", reopensAt: MIDNIGHT } });
    expect(limitsNotice(paused, NOW)).toEqual({ kind: "paused", reason: "day", reopensAt: MIDNIGHT });
    expect(blocksLaunch(limitsNotice(paused, NOW))).toBe(true);
    expect(limitsNotice(paused, Date.parse(MIDNIGHT))).toBeNull();
  });

  it("part du jour épuisée, service ouvert : annoncée, « Lancer » désactivé ; minuit passé : plus rien", () => {
    const usedUp = status({ used: 8 });
    expect(limitsNotice(usedUp, NOW)).toEqual({ kind: "used_up", limit: 8, resetsAt: MIDNIGHT });
    expect(blocksLaunch(limitsNotice(usedUp, NOW))).toBe(true);
    expect(limitsNotice(usedUp, Date.parse(MIDNIGHT) + 1)).toBeNull();
  });

  it("le reste n'est dit qu'à 3 ou moins, sans rien bloquer ; il suit le plus petit des deux restes", () => {
    expect(limitsNotice(status({ used: 4 }), NOW)).toBeNull();
    expect(limitsNotice(status({ used: 5 }), NOW)).toEqual({ kind: "low", remaining: 3 });
    expect(limitsNotice(status({ used: 7 }), NOW)).toEqual({ kind: "low", remaining: 1 });
    // Le service n'a plus que 2 recherches pour aujourd'hui, la personne n'a rien utilisé.
    const tight: LimitsNotice | null = limitsNotice(status({ used: 0, remainingToday: 2 }), NOW);
    expect(tight).toEqual({ kind: "low", remaining: 2 });
    expect(blocksLaunch(tight)).toBe(false);
  });

  it("prochain changement d'annonce : minuit, ou la fin d'une pause du mois", () => {
    expect(nextBoundary(null, NOW)).toBeNull();
    expect(nextBoundary(status(), NOW)).toBe(Date.parse(MIDNIGHT));
    expect(nextBoundary(status({ service: { status: "paused", reason: "month", reopensAt: RENEWAL } }), Date.parse(MIDNIGHT) + 1)).toBe(Date.parse(RENEWAL));
    expect(nextBoundary(status(), Date.parse(MIDNIGHT))).toBeNull();
  });
});

describe("heure de reprise, à l'heure de l'appareil", () => {
  it("heures lisibles dans chaque langue", () => {
    expect([formatHour(0, 0, "fr"), formatHour(18, 0, "fr"), formatHour(8, 30, "fr")]).toEqual(["0 h", "18 h", "8 h 30"]);
    expect([formatHour(0, 0, "en"), formatHour(12, 0, "en"), formatHour(18, 0, "en"), formatHour(8, 30, "en")]).toEqual(["12 AM", "12 PM", "6 PM", "8:30 AM"]);
  });

  it("en France : « minuit » cette nuit, sinon le jour qui commence", () => {
    expect(reopenWhen(MIDNIGHT, NOW, "fr", PARIS)).toEqual({ kind: "midnight" });
    expect(reopenWhen(RENEWAL, NOW, "fr", PARIS)).toEqual({ kind: "date", date: "3 décembre" });
    expect(reopenWhen("2026-11-30T23:00:00.000Z", NOW, "fr", PARIS)).toEqual({ kind: "date", date: "1er décembre" });
    // Peu après minuit : le prochain minuit reste « minuit ».
    expect(reopenWhen("2026-11-04T23:00:00.000Z", Date.parse("2026-11-03T23:30:00Z"), "fr", PARIS)).toEqual({ kind: "midnight" });
  });

  it("ailleurs : minuit à Paris devient une heure locale, aujourd'hui, demain ou un autre jour", () => {
    expect(reopenWhen(MIDNIGHT, NOW, "fr", NEW_YORK)).toEqual({ kind: "time", time: "18 h" });
    expect(reopenWhen(MIDNIGHT, NOW, "en", NEW_YORK)).toEqual({ kind: "time", time: "6 PM" });
    expect(reopenWhen(MIDNIGHT, NOW, "fr", TOKYO)).toEqual({ kind: "tomorrow", time: "8 h" });
    expect(reopenWhen(RENEWAL, NOW, "fr", NEW_YORK)).toEqual({ kind: "dateTime", date: "2 décembre", time: "18 h" });
  });

  it("l'horloge par défaut est celle de l'appareil", () => {
    const at = Date.parse("2026-07-14T09:45:00Z");
    const local = new Date(at);
    expect(deviceClock(at)).toEqual({ year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate(), hour: local.getHours(), minute: local.getMinutes() });
  });
});

describe("textes des annonces (accueil, cadrage)", () => {
  it("pause du jour : « Spotter fait une pause jusqu'à minuit. », avec les mots du fondateur", () => {
    expect(noticeText({ kind: "paused", reason: "day", reopensAt: MIDNIGHT }, NOW, "fr", PARIS)).toEqual({
      title: "Spotter fait une pause jusqu'à minuit.",
      body: "Le service de recherche est très sollicité aujourd'hui.",
    });
    expect(noticeText({ kind: "paused", reason: "day", reopensAt: MIDNIGHT }, NOW, "fr", NEW_YORK).title).toBe("Spotter fait une pause jusqu'à 18 h.");
    expect(noticeText({ kind: "paused", reason: "day", reopensAt: MIDNIGHT }, NOW, "fr", TOKYO).title).toBe("Spotter fait une pause jusqu'à demain, 8 h.");
  });

  it("pause du mois : la date, et le jour exact de la reprise", () => {
    expect(noticeText({ kind: "paused", reason: "month", reopensAt: RENEWAL }, NOW, "fr", PARIS)).toEqual({
      title: "Spotter fait une pause jusqu'au 3 décembre.",
      body: "Le service de recherche a atteint sa limite mensuelle. Réessayez à partir du 3 décembre.",
    });
    expect(noticeText({ kind: "paused", reason: "month", reopensAt: RENEWAL }, NOW, "fr", NEW_YORK).title).toBe("Spotter fait une pause jusqu'au 2 décembre, 18 h.");
  });

  it("part épuisée : le chiffre, et quand revenir ; dernières recherches : une ligne", () => {
    expect(noticeText({ kind: "used_up", limit: 8, resetsAt: MIDNIGHT }, NOW, "fr", PARIS)).toEqual({
      title: "Vous avez utilisé vos 8 recherches du jour.",
      body: "Réessayez à partir de minuit.",
    });
    expect(noticeText({ kind: "used_up", limit: 1, resetsAt: MIDNIGHT }, NOW, "fr", PARIS).title).toBe("Vous avez utilisé votre recherche du jour.");
    expect(noticeText({ kind: "low", remaining: 1 }, NOW, "fr")).toEqual({ title: "Il vous reste 1 recherche aujourd'hui.", body: null });
    expect(noticeText({ kind: "low", remaining: 3 }, NOW, "fr").title).toBe("Il vous reste 3 recherches aujourd'hui.");
  });

  it("en anglais", () => {
    setActiveLocale("en");
    expect(noticeText({ kind: "paused", reason: "day", reopensAt: MIDNIGHT }, NOW, "en", PARIS)).toEqual({
      title: "Spotter is taking a break until midnight.",
      body: "The search service is in very high demand today.",
    });
    expect(noticeText({ kind: "paused", reason: "month", reopensAt: RENEWAL }, NOW, "en", PARIS)).toEqual({
      title: "Spotter is taking a break until December 3.",
      body: "The search service has reached its monthly limit. Please try again from December 3.",
    });
    expect(noticeText({ kind: "used_up", limit: 8, resetsAt: MIDNIGHT }, NOW, "en", PARIS)).toEqual({
      title: "You've used your 8 searches for today.",
      body: "Please try again after midnight.",
    });
    expect(noticeText({ kind: "low", remaining: 2 }, NOW, "en").title).toBe("You have 2 searches left today.");
  });
});

describe("messages de limite après « Lancer » : le chiffre et l'heure de reprise quand on les connaît", () => {
  it("part de la personne : « vos 8 recherches du jour », « à partir de minuit »", () => {
    expect(capacityCopy("capacity_user", null, status({ used: 8 }), NOW, "fr", PARIS)).toEqual(["Vous avez utilisé vos 8 recherches du jour.", "Réessayez à partir de minuit."]);
    setActiveLocale("en");
    expect(capacityCopy("capacity_user", null, status({ used: 8 }), NOW, "en", PARIS)).toEqual(["You've used your 8 searches for today.", "Please try again after midnight."]);
  });

  it("plafond du jour : l'heure de reprise ; le mois garde sa date", () => {
    expect(capacityCopy("capacity_day", null, status(), NOW, "fr", PARIS)).toEqual(["Le service de recherche est très sollicité aujourd'hui.", "Réessayez à partir de minuit."]);
    expect(capacityCopy("capacity_month", "2026-12-03", status(), NOW, "fr", PARIS)).toEqual([
      "Le service de recherche a atteint sa limite mensuelle.",
      "Réessayez à partir du 3 décembre.",
    ]);
  });

  it("compteur inconnu, ou lu avant minuit : les textes d'avant", () => {
    expect(capacityCopy("capacity_user", null, null, NOW, "fr", PARIS)).toEqual(["Vous avez atteint votre limite de recherches pour aujourd'hui.", "Réessayez demain."]);
    expect(capacityCopy("capacity_day", null, null, NOW, "fr", PARIS)).toEqual(["Le service de recherche est très sollicité aujourd'hui.", "Réessayez demain."]);
    expect(capacityCopy("capacity_month", null, null, NOW, "fr", PARIS)[1]).toBe("Réessayez dans quelques jours.");
    expect(capacityCopy("capacity_user", null, status(), Date.parse(MIDNIGHT) + 1, "fr", PARIS)).toEqual(["Vous avez utilisé vos 8 recherches du jour.", "Réessayez demain."]);
  });
});

describe("compteur partagé : relu sans appel superflu", () => {
  function setup(answer: () => Promise<SearchCapacityStatus | null> = async () => status()) {
    let time = NOW;
    const read = vi.fn(answer);
    const store = createLimitsStore(read, () => time);
    return { store, read, advance: (ms: number) => (time += ms), at: (ms: number) => (time = ms) };
  }

  it("une lecture par visite au plus toutes les 20 s ; deux visites en même temps : une seule lecture", async () => {
    const { store, read, advance } = setup();
    await Promise.all([store.refresh("moi"), store.refresh("moi")]);
    expect(read).toHaveBeenCalledOnce();
    expect(store.current("moi")).toEqual(status());
    advance(10_000);
    await store.refresh("moi");
    expect(read).toHaveBeenCalledOnce();
    advance(10_000);
    await store.refresh("moi");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("une recherche part : la visite suivante relit, même dans les 20 s", async () => {
    const { store, read } = setup();
    const unsubscribe = onSearchLaunched(store.markStale);
    await store.refresh("moi");
    searchLaunched();
    await store.refresh("moi");
    expect(read).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("minuit passé depuis la lecture : relu aussitôt ; « Tirer pour actualiser » : relu", async () => {
    const { store, read, at, advance } = setup();
    await store.refresh("moi");
    at(Date.parse(MIDNIGHT) + 1);
    await store.refresh("moi");
    expect(read).toHaveBeenCalledTimes(2);
    advance(1_000);
    await store.refresh("moi", true);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("lecture échouée ou illisible : rien (jamais l'ancien compteur), et pas de nouvel essai avant 20 s", async () => {
    let fail = false;
    const { store, read, advance } = setup(async () => {
      if (fail) throw new Error("hors ligne");
      return status({ remainingToday: 0, service: { status: "paused", reason: "day", reopensAt: MIDNIGHT } });
    });
    await store.refresh("moi");
    expect(store.current("moi")?.service.status).toBe("paused");
    fail = true;
    advance(20_000);
    await store.refresh("moi");
    expect(store.current("moi")).toBeNull();
    await store.refresh("moi");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("autre compte : rien de l'ancien n'est montré, et une lecture partie pour l'ancien est ignorée", async () => {
    let resolveFirst: (value: SearchCapacityStatus) => void = () => undefined;
    const first = new Promise<SearchCapacityStatus>((resolve) => (resolveFirst = resolve));
    const answers = [() => first, async () => status({ used: 1 })];
    const { store, read } = setup(() => answers.shift()!());
    const listener = vi.fn();
    store.subscribe(listener);
    const pending = store.refresh("ancien");
    await store.refresh("nouveau");
    resolveFirst(status({ used: 8 }));
    await pending;
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.current("ancien")).toBeNull();
    expect(store.current("nouveau")).toEqual(status({ used: 1 }));
    expect(store.latest()).toEqual(status({ used: 1 }));
    expect(listener).toHaveBeenCalled();
  });

  it("aucune personne connectée : aucune lecture", async () => {
    const { store, read } = setup();
    await store.refresh(null);
    expect(read).not.toHaveBeenCalled();
    expect(store.current(null)).toBeNull();
  });
});
