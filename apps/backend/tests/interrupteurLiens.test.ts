import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { EDITABLE_VARIABLES, SECRET_VARIABLE, assertEditableVariable } from "../scripts/lib/render-guard.js";

// Lot « nettoyage avant le premier build » : l'interrupteur des liens TikTok
// et Instagram (LINK_PREVIEW_ENABLED), lu de bout en bout (variables
// d'environnement → src/env.ts → lib/linkPreview.ts), comme ceux de la voie C
// (aiSwitches.test.ts) et des notifications (interrupteurNotifications.test.ts).
// Le fichier .env n'est pas lu ici (dotenv remplacé). Variables factices,
// aucune clé réelle. Ce que l'interrupteur coupe dans les routes :
// liensCoupes.test.ts ; dans le service oEmbed : oembedPreview.test.ts.
vi.mock("dotenv/config", () => ({}));

const NAME = "LINK_PREVIEW_ENABLED";
const REQUIRED = { SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "faux", SERPAPI_KEY: "faux" };
const saved: Record<string, string | undefined> = {};

/** Recharge env.ts et linkPreview.ts avec cette valeur seulement (undefined : variable absente). */
async function load(value?: string) {
  delete process.env[NAME];
  Object.assign(process.env, REQUIRED, value === undefined ? {} : { [NAME]: value });
  vi.resetModules();
  return import("../src/lib/linkPreview.js");
}

let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  for (const name of [NAME, ...Object.keys(REQUIRED)]) saved[name] = process.env[name];
  // Un interrupteur mal écrit ne doit JAMAIS arrêter le serveur.
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

describe("interrupteur des liens TikTok et Instagram (LINK_PREVIEW_ENABLED)", () => {
  it("absent : coupé (la valeur par défaut)", async () => {
    expect((await load()).linkPreviewEnabled()).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it("« true » exact : allumé", async () => {
    expect((await load("true")).linkPreviewEnabled()).toBe(true);
  });

  it("« false », « TRUE », « 1 », « true » avec une espace, « yes », vide : coupé, sans jamais arrêter le serveur", async () => {
    for (const value of ["false", "TRUE", "True", "1", " true", "true ", "yes", "on", ""]) {
      expect((await load(value)).linkPreviewEnabled(), JSON.stringify(value)).toBe(false);
    }
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("LINK_PREVIEW_ENABLED n'est pas une variable que les outils peuvent changer (render-guard)", () => {
  it("absent de la liste fermée de chaque service, et jamais le secret que les outils peuvent écrire", () => {
    for (const variables of Object.values(EDITABLE_VARIABLES)) expect(Object.keys(variables)).not.toContain(NAME);
    expect(SECRET_VARIABLE.key).not.toBe(NAME);
  });

  it("render-bride refuse de l'écrire, sur le serveur comme sur le site, quelle que soit la valeur", () => {
    for (const service of ["spotto-api", "site"] as const) {
      for (const value of ["true", "false"]) expect(() => assertEditableVariable(service, NAME, value), `${service} ${value}`).toThrow(/refusée/);
    }
  });
});
