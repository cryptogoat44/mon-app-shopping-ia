import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// Lot notifications : l'interrupteur PUSH_ENABLED, lu de bout en bout
// (variables d'environnement → src/env.ts → lib/push.ts), comme ceux de la
// voie C (aiSwitches.test.ts). Le fichier .env n'est pas lu ici (dotenv
// remplacé). Variables factices, aucune clé réelle.
vi.mock("dotenv/config", () => ({}));

const NAMES = ["PUSH_ENABLED", "EXPO_ACCESS_TOKEN"] as const;
const REQUIRED = { SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "faux", SERPAPI_KEY: "faux" };
const saved: Record<string, string | undefined> = {};

async function load(vars: Partial<Record<(typeof NAMES)[number], string>>) {
  for (const name of NAMES) delete process.env[name];
  Object.assign(process.env, REQUIRED, vars);
  vi.resetModules();
  const [push, { env }] = await Promise.all([import("../src/lib/push.js"), import("../src/env.js")]);
  return { push, env };
}

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

describe("interrupteur des notifications (PUSH_ENABLED)", () => {
  it("« true » exact : allumé", async () => {
    expect((await load({ PUSH_ENABLED: "true" })).push.pushEnabled()).toBe(true);
  });

  it("absent, « false », « TRUE », « 1 », « true » avec une espace, « yes », vide : coupé, sans jamais arrêter le serveur", async () => {
    expect((await load({})).push.pushEnabled()).toBe(false);
    for (const value of ["false", "TRUE", "1", " true", "true ", "yes", ""]) {
      expect((await load({ PUSH_ENABLED: value })).push.pushEnabled(), JSON.stringify(value)).toBe(false);
    }
    expect(exit).not.toHaveBeenCalled();
  });

  it("jeton d'accès d'Expo facultatif : vide ou fait d'espaces, il vaut « absent », sans arrêter le serveur", async () => {
    expect((await load({})).env.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect((await load({ EXPO_ACCESS_TOKEN: "" })).env.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect((await load({ EXPO_ACCESS_TOKEN: "   " })).env.EXPO_ACCESS_TOKEN).toBeUndefined();
    expect((await load({ EXPO_ACCESS_TOKEN: "jeton-factice" })).env.EXPO_ACCESS_TOKEN).toBe("jeton-factice");
    expect(exit).not.toHaveBeenCalled();
  });
});
