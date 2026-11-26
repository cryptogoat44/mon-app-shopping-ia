import { afterEach, describe, expect, it, vi } from "vitest";

// MERCHANT_IMAGE_UPGRADE_ENABLED (grande image lue sur la page de la
// boutique) : ÉTEINT par défaut ; seule la valeur exacte "true" l'allume, et
// une faute de frappe n'arrête jamais le serveur.
async function readSwitch(value: string | undefined): Promise<boolean> {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("MERCHANT_IMAGE_UPGRADE_ENABLED", undefined as unknown as string);
  else vi.stubEnv("MERCHANT_IMAGE_UPGRADE_ENABLED", value);
  const { merchantImageUpgradeEnabled } = await import("../src/lib/merchantImage.js");
  return merchantImageUpgradeEnabled();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("interrupteur de la grande image de la boutique", () => {
  it("permis : la valeur exacte « true »", async () => {
    expect(await readSwitch("true")).toBe(true);
  });

  it.each(["1", "TRUE", "True", "true ", "yes", "false", ""])("refusé : « %s » le laisse éteint", async (value) => {
    expect(await readSwitch(value)).toBe(false);
  });

  it("absent : éteint", async () => {
    expect(await readSwitch(undefined)).toBe(false);
  });
});

// MERCHANT_IMAGE_RESULTS_ENABLED (retours du build 3 : la même lecture pour
// les RÉSULTATS d'une recherche) : interrupteur à part, ÉTEINT par défaut,
// même règle, et indépendant de MERCHANT_IMAGE_UPGRADE_ENABLED.
async function readResultsSwitch(value: string | undefined, upgrade?: string): Promise<{ results: boolean; upgrade: boolean }> {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("MERCHANT_IMAGE_RESULTS_ENABLED", undefined as unknown as string);
  else vi.stubEnv("MERCHANT_IMAGE_RESULTS_ENABLED", value);
  vi.stubEnv("MERCHANT_IMAGE_UPGRADE_ENABLED", upgrade ?? (undefined as unknown as string));
  const { merchantImageResultsEnabled, merchantImageUpgradeEnabled } = await import("../src/lib/merchantImage.js");
  return { results: merchantImageResultsEnabled(), upgrade: merchantImageUpgradeEnabled() };
}

describe("interrupteur de la grande image des résultats", () => {
  it("permis : la valeur exacte « true », sans allumer celui des pièces gardées", async () => {
    expect(await readResultsSwitch("true")).toEqual({ results: true, upgrade: false });
  });

  it.each(["1", "TRUE", "True", "true ", "yes", "false", ""])("refusé : « %s » le laisse éteint", async (value) => {
    expect((await readResultsSwitch(value)).results).toBe(false);
  });

  it("refusé : absent, il reste éteint même quand celui des pièces gardées est allumé", async () => {
    expect(await readResultsSwitch(undefined, "true")).toEqual({ results: false, upgrade: true });
  });
});
