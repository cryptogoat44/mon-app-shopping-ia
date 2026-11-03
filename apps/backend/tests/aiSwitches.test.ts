import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

// Lot c, voie C : les trois interrupteurs, lus de bout en bout (variables
// d'environnement → src/env.ts → lib/aiSwitches.ts). Le fichier .env n'est
// pas lu ici (dotenv remplacé) : sur le Mac, un .env qui allumerait la voie C
// ne doit pas changer ces tests. Variables factices, aucune clé réelle.
vi.mock("dotenv/config", () => ({}));

const SWITCHES = ["VOIE_C_ENABLED", "VOIE_C_AI_ENABLED", "ANTHROPIC_PHOTO_ENABLED", "ANTHROPIC_API_KEY"] as const;
const REQUIRED = { SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "faux", SERPAPI_KEY: "faux" };
const saved: Record<string, string | undefined> = {};

type Vars = Partial<Record<(typeof SWITCHES)[number], string>>;

/** Recharge env.ts et aiSwitches.ts avec ces variables seulement. */
async function load(vars: Vars) {
  for (const name of SWITCHES) delete process.env[name];
  Object.assign(process.env, REQUIRED, vars);
  vi.resetModules();
  return import("../src/lib/aiSwitches.js");
}

let exit: MockInstance<typeof process.exit>;

beforeEach(() => {
  for (const name of [...SWITCHES, ...Object.keys(REQUIRED)]) saved[name] = process.env[name];
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

describe("interrupteurs de la voie C", () => {
  it("« true » exact : allumé", async () => {
    const switches = await load({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "cle-factice", ANTHROPIC_PHOTO_ENABLED: "true" });
    expect(switches.voieCEnabled()).toBe(true);
    expect(switches.voieCAiEnabled()).toBe(true);
    expect(switches.userPhotoToAnthropicAllowed()).toBe(true);
  });

  it("absent, « false », « TRUE », « 1 », « true » avec une espace, « yes » : coupé, sans jamais arrêter le serveur", async () => {
    const absent = await load({});
    expect([absent.voieCEnabled(), absent.voieCAiEnabled(), absent.userPhotoToAnthropicAllowed()]).toEqual([false, false, false]);
    for (const value of ["false", "TRUE", "1", " true", "true ", "yes", ""]) {
      const switches = await load({ VOIE_C_ENABLED: value, VOIE_C_AI_ENABLED: value, ANTHROPIC_PHOTO_ENABLED: value, ANTHROPIC_API_KEY: "cle-factice" });
      expect([switches.voieCEnabled(), switches.voieCAiEnabled(), switches.userPhotoToAnthropicAllowed()], JSON.stringify(value)).toEqual([false, false, false]);
    }
    expect(exit).not.toHaveBeenCalled();
  });

  it("l'IA de la voie C demande aussi la clé d'Anthropic", async () => {
    const withoutKey = await load({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true" });
    expect(withoutKey.voieCEnabled()).toBe(true);
    expect(withoutKey.voieCAiEnabled()).toBe(false);
  });

  it("photo coupée : un bloc image est refusé avant tout appel, où qu'il soit ; du texte seul passe", async () => {
    const switches = await load({ VOIE_C_ENABLED: "true", VOIE_C_AI_ENABLED: "true", ANTHROPIC_API_KEY: "cle-factice" });
    const text = { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "<resultats_lens>…</resultats_lens>" }] }] };
    expect(() => switches.assertNoUserImage(text)).not.toThrow();
    const image = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } };
    expect(() => switches.assertNoUserImage({ messages: [{ role: "user", content: [image] }] })).toThrow(switches.UserImageRefusedError);
    // Cachée plus loin (résultat d'outil), ou seulement sa source : refusée aussi.
    expect(() => switches.assertNoUserImage({ messages: [{ role: "user", content: [{ type: "tool_result", content: [image] }] }] })).toThrow("user_image_refused");
    expect(() => switches.assertNoUserImage({ messages: [{ role: "user", content: [{ type: "document", source: { media_type: "image/png", data: "AAAA" } }] }] })).toThrow("user_image_refused");
  });

  it("photo allumée (décision future du fondateur) : la garde laisse passer", async () => {
    const switches = await load({ ANTHROPIC_PHOTO_ENABLED: "true" });
    expect(() => switches.assertNoUserImage({ messages: [{ role: "user", content: [{ type: "image" }] }] })).not.toThrow();
  });
});
