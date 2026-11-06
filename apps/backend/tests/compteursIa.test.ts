import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiQuota, AiQuotaError, resetAiQuotaForTests, type AiQuotaRpc } from "../src/lib/aiQuota.js";
import { resetAlertsForTests } from "../src/lib/alerts.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";

// Compteurs de l'IA dans la base (lot garde-fous, point 9 ; migration 0029,
// fonction ai_quota). La base est simulée ici (aucun réseau) ; la fonction
// réelle est testée avec la base dans compteursIaBase.test.ts.

const originalNodeEnv = process.env.NODE_ENV;
let sequence = 0;
const someone = () => `00000000-0000-4000-8000-${String((sequence += 1)).padStart(12, "0")}`;

type Answer = { data: unknown; error: { code?: string } | null };
function fakeDb(answer: (params: Parameters<AiQuotaRpc["rpc"]>[1]) => Answer) {
  const calls: Parameters<AiQuotaRpc["rpc"]>[1][] = [];
  const db: AiQuotaRpc = {
    rpc: (_name, params) => {
      calls.push(params);
      return Promise.resolve(answer(params));
    },
  };
  return { db, calls };
}
const row = (allowed: boolean, refusedBy: "user" | "global" | null, day = 3, user = 1) => ({
  data: [{ allowed, refused_by: refusedBy, day_count: day, user_day_count: user }],
  error: null,
});
function fakeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeAll(() => {
  // Sous Vitest, les limites sont coupées ; on les rallume pour ces tests.
  process.env.NODE_ENV = "development";
});
afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});
beforeEach(() => {
  resetAiQuotaForTests();
  resetAlertsForTests();
});

describe("compteurs de l'IA dans la base", () => {
  it("analyse vidéo : la part de la personne et le plafond commun sont envoyés à la base, avec la réservation", async () => {
    const { db, calls } = fakeDb(() => row(true, null));
    const userId = someone();
    expect(await aiQuota(db, fakeLog(), { kind: "video", userId, reserve: true })).toEqual({ allowed: true });
    expect(calls).toEqual([
      { p_kind: "video", p_user_id: userId, p_user_daily_cap: RATE_LIMITS.videoAiUser.max, p_daily_cap: RATE_LIMITS.videoAiGlobal.max, p_reserve: true },
    ]);
  });

  it("IA de la voie C : plafond commun seulement, jamais de compte envoyé", async () => {
    const { db, calls } = fakeDb(() => row(true, null));
    await aiQuota(db, fakeLog(), { kind: "shopping_query", userId: someone(), reserve: true });
    expect(calls[0]).toEqual({ p_kind: "shopping_query", p_user_id: null, p_user_daily_cap: null, p_daily_cap: RATE_LIMITS.shoppingQueryAiGlobal.max, p_reserve: true });
  });

  it("refus : la part de la personne, ou tout le service ; le plafond commun envoie une alerte, une fois par jour", async () => {
    const log = fakeLog();
    expect(await aiQuota(fakeDb(() => row(false, "user")).db, log, { kind: "video", userId: someone(), reserve: false })).toEqual({ allowed: false, refusedBy: "user" });
    expect(log.warn).not.toHaveBeenCalled();
    const global = fakeDb(() => row(false, "global", 300, 0)).db;
    expect(await aiQuota(global, log, { kind: "video", userId: someone(), reserve: false })).toEqual({ allowed: false, refusedBy: "global" });
    expect(await aiQuota(global, log, { kind: "video", userId: someone(), reserve: true })).toEqual({ allowed: false, refusedBy: "global" });
    expect(log.warn.mock.calls.map(([fields, message]) => [fields, message])).toEqual([[{ alerte: "plafond_ia", ia: "video" }, "Alerte"]]);
  });

  it("base injoignable ou réponse illisible : erreur, donc aucun appel payant", async () => {
    await expect(aiQuota(fakeDb(() => ({ data: null, error: { code: "08006" } })).db, fakeLog(), { kind: "video", userId: someone(), reserve: true })).rejects.toBeInstanceOf(AiQuotaError);
    await expect(aiQuota(fakeDb(() => ({ data: [{ allowed: "oui" }], error: null })).db, fakeLog(), { kind: "video", userId: someone(), reserve: true })).rejects.toBeInstanceOf(AiQuotaError);
    await expect(aiQuota(fakeDb(() => ({ data: [], error: null })).db, fakeLog(), { kind: "shopping_query", userId: null, reserve: true })).rejects.toBeInstanceOf(AiQuotaError);
  });

  it("sans la migration 0029 : les compteurs en mémoire d'avant, et la base est réinterrogée au bout de 5 minutes", async () => {
    let now = Date.UTC(2026, 10, 6, 9, 0);
    const missing = fakeDb(() => ({ data: null, error: { code: "PGRST202" } }));
    const log = fakeLog();
    const userId = someone();
    for (let call = 0; call < RATE_LIMITS.videoAiUser.max; call += 1) {
      expect(await aiQuota(missing.db, log, { kind: "video", userId, reserve: true }, () => now)).toEqual({ allowed: true });
    }
    // La 11e de la même personne : refusée par le compteur en mémoire.
    expect(await aiQuota(missing.db, log, { kind: "video", userId, reserve: false }, () => now)).toEqual({ allowed: false, refusedBy: "user" });
    // Une seule interrogation de la base, une seule ligne de journal.
    expect(missing.calls).toHaveLength(1);
    expect(log.warn.mock.calls.filter(([, message]) => message === "Compteurs IA en mémoire : migration 0029 absente")).toHaveLength(1);
    now += 5 * 60_000 + 1;
    const migrated = fakeDb(() => row(true, null));
    expect(await aiQuota(migrated.db, log, { kind: "video", userId, reserve: false }, () => now)).toEqual({ allowed: true });
    expect(migrated.calls).toHaveLength(1);
  });

  it("sous Vitest (NODE_ENV « test »), toujours permis sans interroger la base, comme les autres limites", async () => {
    process.env.NODE_ENV = "test";
    try {
      const { db, calls } = fakeDb(() => row(false, "global"));
      expect(await aiQuota(db, fakeLog(), { kind: "video", userId: someone(), reserve: true })).toEqual({ allowed: true });
      expect(calls).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = "development";
    }
  });
});
