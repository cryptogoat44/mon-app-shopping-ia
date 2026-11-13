import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { FastifyInstance } from "fastify";
import { DEFAULT_FASHN_API_BASE_URL, logTryonConfigState, readTryonConfig, type TryonEnvSource } from "../src/lib/tryon/config.js";
import { FEATURE_FLAG_TTL_MS, featureFlagReader } from "../src/lib/tryon/featureFlag.js";
import { fakeSupabase, type FakeDbOptions } from "./fakeSupabase.js";

// Essayage virtuel : réglages vérifiés au démarrage (lib/tryon/config.ts) et
// drapeau de la base (lib/tryon/featureFlag.ts). Éteint par défaut, éteint
// au moindre doute, jamais un arrêt du serveur, jamais la clé dans le
// journal. Valeurs factices : aucune vraie clé, aucune base, aucun réseau.
// Le fichier .env n'est pas lu ici (dotenv remplacé).
vi.mock("dotenv/config", () => ({}));

const FAKE_KEY = "fa-cle-factice-0123456789";

/** Les variables de l'essayage, allumé, avec des valeurs par défaut. */
function source(vars: Partial<TryonEnvSource> = {}): TryonEnvSource {
  return {
    TRYON_ENABLED: true,
    TRYON_PROVIDER: undefined,
    FASHN_API_KEY: undefined,
    FASHN_API_BASE_URL: undefined,
    TRYON_FREE_PER_MONTH: undefined,
    TRYON_BONUS_PER_PURCHASE: undefined,
    TRYON_BONUS_VALIDITY_DAYS: undefined,
    TRYON_REQUIRE_BUY_LINK: undefined,
    TRYON_MONTHLY_BUDGET_USD: undefined,
    TRYON_ALERT_THRESHOLD: undefined,
    TRYON_PRICE_PER_CREDIT_USD: undefined,
    TRYON_MIN_FASHN_CREDITS: undefined,
    TRYON_TIMEZONE: undefined,
    ...vars,
  };
}

const problemsOf = (vars: Partial<TryonEnvSource>, nodeEnv = "development") => {
  const state = readTryonConfig(source(vars), nodeEnv);
  return state.state === "invalid" ? state.problems : [];
};

describe("réglages de l'essayage : éteint par défaut, éteint au moindre doute", () => {
  it("interrupteur coupé : éteint, et la clé FASHN n'est même pas lue", () => {
    const read = vi.fn(() => FAKE_KEY);
    const off = { ...source({ TRYON_ENABLED: false, TRYON_PROVIDER: "fashn" }) };
    Object.defineProperty(off, "FASHN_API_KEY", { get: read, enumerable: true });
    expect(readTryonConfig(off, "production")).toEqual({ state: "off" });
    expect(read).not.toHaveBeenCalled();
  });

  it("allumé sans autre réglage : le faux fournisseur et les valeurs de la mission (hors production)", () => {
    expect(readTryonConfig(source(), "development")).toEqual({
      state: "ready",
      config: {
        provider: "fake",
        apiKey: null,
        apiBaseUrl: DEFAULT_FASHN_API_BASE_URL,
        freePerMonth: 5,
        bonusPerPurchase: 5,
        bonusValidityDays: 365,
        requireBuyLink: true,
        monthlyBudgetUsd: 100,
        alertThreshold: 0.8,
        pricePerCreditUsd: 0.075,
        minProviderCredits: 20,
        timeZone: "Europe/Paris",
      },
    });
  });

  it("le faux fournisseur est refusé en production", () => {
    expect(problemsOf({}, "production")).toEqual(["TRYON_PROVIDER : le faux fournisseur est refusé en production"]);
    expect(problemsOf({ TRYON_PROVIDER: "fake" }, "production")).toHaveLength(1);
  });

  it("FASHN sans clé : éteint ; avec une clé, prêt (la clé n'est lue qu'avec FASHN)", () => {
    expect(problemsOf({ TRYON_PROVIDER: "fashn" })).toEqual(["FASHN_API_KEY : absente (obligatoire avec TRYON_PROVIDER=fashn)"]);
    expect(problemsOf({ TRYON_PROVIDER: "fashn", FASHN_API_KEY: "avec espace dedans" })).toEqual(["FASHN_API_KEY : forme invalide"]);
    const ready = readTryonConfig(source({ TRYON_PROVIDER: "fashn", FASHN_API_KEY: FAKE_KEY }), "production");
    expect(ready).toMatchObject({ state: "ready", config: { provider: "fashn", apiKey: FAKE_KEY } });
    const read = vi.fn(() => FAKE_KEY);
    const fake = source();
    Object.defineProperty(fake, "FASHN_API_KEY", { get: read, enumerable: true });
    readTryonConfig(fake, "development");
    expect(read).not.toHaveBeenCalled();
  });

  it("valeurs invalides : chaque variable fautive est nommée, avec une raison fixe, jamais sa valeur", () => {
    const problems = problemsOf({
      TRYON_PROVIDER: "openai",
      FASHN_API_BASE_URL: "http://api.fashn.ai/v1",
      TRYON_FREE_PER_MONTH: "-1",
      TRYON_BONUS_PER_PURCHASE: "1e3",
      TRYON_BONUS_VALIDITY_DAYS: "0",
      TRYON_REQUIRE_BUY_LINK: "oui",
      TRYON_MONTHLY_BUDGET_USD: "cent",
      TRYON_ALERT_THRESHOLD: "0,8",
      TRYON_PRICE_PER_CREDIT_USD: "0x10",
      TRYON_MIN_FASHN_CREDITS: "20.5",
      TRYON_TIMEZONE: "Mars/Olympus",
    });
    expect(problems.map((problem) => problem.split(" : ")[0])).toEqual([
      "TRYON_PROVIDER",
      "FASHN_API_BASE_URL",
      "TRYON_FREE_PER_MONTH",
      "TRYON_BONUS_PER_PURCHASE",
      "TRYON_BONUS_VALIDITY_DAYS",
      "TRYON_REQUIRE_BUY_LINK",
      "TRYON_MONTHLY_BUDGET_USD",
      "TRYON_ALERT_THRESHOLD",
      "TRYON_PRICE_PER_CREDIT_USD",
      "TRYON_MIN_FASHN_CREDITS",
      "TRYON_TIMEZONE",
    ]);
    for (const value of ["openai", "http://", "1e3", "oui", "cent", "0,8", "0x10", "20.5", "Mars/Olympus"]) {
      expect(problems.join("\n"), value).not.toContain(value);
    }
  });

  it("bornes : seuil d'alerte jusqu'à 1, budget au-dessus de 0, quota gratuit jusqu'à 100", () => {
    expect(problemsOf({ TRYON_ALERT_THRESHOLD: "1" })).toEqual([]);
    expect(problemsOf({ TRYON_ALERT_THRESHOLD: "1.01" })).toHaveLength(1);
    expect(problemsOf({ TRYON_MONTHLY_BUDGET_USD: "0" })).toHaveLength(1);
    expect(problemsOf({ TRYON_FREE_PER_MONTH: "0" })).toEqual([]);
    expect(problemsOf({ TRYON_FREE_PER_MONTH: "101" })).toHaveLength(1);
    expect(problemsOf({ TRYON_FREE_PER_MONTH: " 7 " })).toEqual([]);
  });

  it("adresse de l'API : https seulement, sans identifiants ni paramètres ; « / » final retiré", () => {
    for (const url of ["ftp://api.fashn.ai/v1", "https://cle:secret@api.fashn.ai/v1", "https://api.fashn.ai/v1?debug=1", "pas une adresse"]) {
      expect(problemsOf({ FASHN_API_BASE_URL: url }), url).toEqual(["FASHN_API_BASE_URL : adresse https attendue, sans identifiants ni paramètres"]);
    }
    expect(readTryonConfig(source({ FASHN_API_BASE_URL: "https://api.fashn.ai/v1/" }), "development")).toMatchObject({ config: { apiBaseUrl: "https://api.fashn.ai/v1" } });
  });

  it("lien d'achat exigé par défaut ; « false » exact le lève", () => {
    expect(readTryonConfig(source({ TRYON_REQUIRE_BUY_LINK: "false" }), "development")).toMatchObject({ config: { requireBuyLink: false } });
    expect(readTryonConfig(source({ TRYON_REQUIRE_BUY_LINK: "" }), "development")).toMatchObject({ config: { requireBuyLink: true } });
  });

  it("le journal dit une seule fois quelles variables corriger, sans aucune valeur", () => {
    const warn = vi.fn();
    logTryonConfigState(readTryonConfig(source({ TRYON_PROVIDER: "fashn", FASHN_API_KEY: "x y" }), "development"), { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("x y");
    logTryonConfigState({ state: "off" }, { warn });
    logTryonConfigState(readTryonConfig(source(), "development"), { warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("réglages lus de bout en bout (variables d'environnement → src/env.ts → lib/tryon/config.ts)", () => {
  const NAMES = ["TRYON_ENABLED", "TRYON_PROVIDER", "FASHN_API_KEY", "TRYON_FREE_PER_MONTH", "TRYON_TIMEZONE"] as const;
  const REQUIRED = { SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "faux", SERPAPI_KEY: "faux" };
  const saved: Record<string, string | undefined> = {};
  let exit: MockInstance<typeof process.exit>;

  beforeEach(() => {
    for (const name of [...NAMES, ...Object.keys(REQUIRED)]) saved[name] = process.env[name];
    exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit appelé");
    }) as never);
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    exit.mockRestore();
    vi.resetModules();
  });

  async function load(vars: Partial<Record<(typeof NAMES)[number], string>>) {
    for (const name of NAMES) delete process.env[name];
    Object.assign(process.env, REQUIRED, vars);
    vi.resetModules();
    const [{ env }, config] = await Promise.all([import("../src/env.js"), import("../src/lib/tryon/config.js")]);
    return config.readTryonConfig(env, "development");
  }

  it("absent, « TRUE », « 1 », « true » avec une espace : éteint ; « true » exact : allumé", async () => {
    expect(await load({})).toEqual({ state: "off" });
    for (const value of ["TRUE", "1", " true", "true ", "yes", "", "false"]) expect(await load({ TRYON_ENABLED: value }), JSON.stringify(value)).toEqual({ state: "off" });
    expect((await load({ TRYON_ENABLED: "true" })).state).toBe("ready");
  });

  it("des valeurs absurdes n'arrêtent jamais le serveur : l'essayage reste éteint", async () => {
    const state = await load({ TRYON_ENABLED: "true", TRYON_PROVIDER: "n'importe quoi", TRYON_FREE_PER_MONTH: "beaucoup", TRYON_TIMEZONE: "ici" });
    expect(state.state).toBe("invalid");
    expect(exit).not.toHaveBeenCalled();
  });

  it("une clé vide vaut « absente »", async () => {
    expect(await load({ TRYON_ENABLED: "true", TRYON_PROVIDER: "fashn", FASHN_API_KEY: "   " })).toEqual({
      state: "invalid",
      problems: ["FASHN_API_KEY : absente (obligatoire avec TRYON_PROVIDER=fashn)"],
    });
  });
});

describe("drapeau de la base (feature_flags.tryon) : relu au plus toutes les 15 s, éteint au moindre doute", () => {
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

  function reader(options: FakeDbOptions = {}, enabled: boolean | null = true) {
    const fake = fakeSupabase(options);
    if (enabled !== null) fake.table("feature_flags").push({ key: "tryon", enabled, updated_at: "2026-11-13T10:00:00+00:00" });
    let clock = 1_000_000;
    const now = () => clock;
    const flag = featureFlagReader({ supabaseAdmin: fake.db, log } as unknown as Pick<FastifyInstance, "supabaseAdmin" | "log">, "tryon", now);
    return { fake, flag, advance: (ms: number) => (clock += ms) };
  }

  it("allumé dans la base : allumé ; éteint : éteint", async () => {
    expect(await reader({}, true).flag.isOn()).toBe(true);
    expect(await reader({}, false).flag.isOn()).toBe(false);
  });

  it("ligne absente, table absente (base sans 0042), écriture refusée ou panne : éteint", async () => {
    expect(await reader({}, null).flag.isOn()).toBe(false);
    expect(await reader({ missing: ["feature_flags"] }).flag.isOn()).toBe(false);
    const broken = fakeSupabase();
    const failing = { ...broken.db, from: () => { throw new Error("base injoignable"); } };
    const flag = featureFlagReader({ supabaseAdmin: failing, log } as unknown as Pick<FastifyInstance, "supabaseAdmin" | "log">, "tryon");
    expect(await flag.isOn()).toBe(false);
  });

  it("relu au bout de 15 secondes : l'éteindre dans la base coupe l'essayage sans mise en ligne", async () => {
    const { fake, flag, advance } = reader({}, true);
    expect(await flag.isOn()).toBe(true);
    fake.table("feature_flags")[0]!.enabled = false;
    advance(FEATURE_FLAG_TTL_MS - 1);
    expect(await flag.isOn()).toBe(true);
    advance(1);
    expect(await flag.isOn()).toBe(false);
  });
});
