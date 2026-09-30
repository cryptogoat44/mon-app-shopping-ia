import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_OLD_SERVER, assertDeployId, assertEditableVariable, resolveService } from "../scripts/lib/render-guard.js";

// Script render-bride : deux services, trois actions, rien d'autre
// (décision du fondateur, 2026-09-29).
describe("garde-fou de l'accès à l'API de Render", () => {
  it("n'accepte que spotto-api et le site, par nom ou par identifiant", () => {
    expect(resolveService("spotto-api").id).toBe("srv-darcqk3tqb8s73f082f0");
    expect(resolveService("srv-darcqk3tqb8s73f082f0").name).toBe("spotto-api");
    expect(resolveService("site").id).toBe("srv-dagsaamk1f9s73do3isg");
    expect(resolveService("srv-dagsaamk1f9s73do3isg").name).toBe("site");
  });

  it("refuse l'ancien serveur (Oregon) et tout autre service", () => {
    for (const refused of [FORBIDDEN_OLD_SERVER, "mon-app-shopping-ia", "mon-app-shopping-ia-web", "srv-autre123456", "", undefined]) {
      expect(() => resolveService(refused)).toThrow();
    }
  });

  it("n'accepte que l'adresse du serveur de Francfort pour EXPO_PUBLIC_API_URL", () => {
    expect(assertEditableVariable("site", "EXPO_PUBLIC_API_URL", "https://spotto-api.onrender.com").value).toBe("https://spotto-api.onrender.com");
    for (const refused of [
      "https://spotto-api.onrender.com/",
      "https://mon-app-shopping-ia.onrender.com",
      "http://spotto-api.onrender.com",
      "https://spotto-api.onrender.com.exemple.com",
      "",
      undefined,
    ]) {
      expect(() => assertEditableVariable("site", "EXPO_PUBLIC_API_URL", refused)).toThrow();
    }
  });

  it("variables du lot 2 : liste fermée par service, valeurs contrôlées, jamais de secret", () => {
    const dsn = "https://0123abcdef@o4500000000000000.ingest.de.sentry.io/4500000000000001";
    expect(assertEditableVariable("site", "EXPO_PUBLIC_SENTRY_DSN", dsn).mustExist).toBe(false);
    expect(assertEditableVariable("spotto-api", "SENTRY_DSN", dsn).key).toBe("SENTRY_DSN");
    expect(assertEditableVariable("site", "EXPO_PUBLIC_POSTHOG_KEY", "phc_abcdefghijklmnopqrstuvwxyz0123").key).toBe("EXPO_PUBLIC_POSTHOG_KEY");
    expect(assertEditableVariable("site", "EXPO_PUBLIC_ENVIRONMENT", "production").value).toBe("production");
    expect(assertEditableVariable("spotto-api", "SENTRY_ENVIRONMENT", "production").value).toBe("production");
    const refused: [string, string, string][] = [
      ["site", "EXPO_PUBLIC_SENTRY_DSN", dsn.replace(".de.", ".us.")], // hors UE
      ["site", "EXPO_PUBLIC_POSTHOG_KEY", "sk_secret_abcdefghijklmnopqrstuvwxyz"],
      ["site", "EXPO_PUBLIC_ENVIRONMENT", "development"],
      ["site", "SENTRY_AUTH_TOKEN", "sntrys_quelquechose"], // secret : saisi par le fondateur
      ["site", "EXPO_PUBLIC_PUBLISHER_EMAIL", "x@example.com"], // coordonnées : jamais
      ["site", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_x"],
      ["spotto-api", "SUPABASE_SERVICE_ROLE_KEY", "sb_secret_x"],
      ["spotto-api", "EXPO_PUBLIC_API_URL", "https://spotto-api.onrender.com"], // mauvais service
      ["site", "SENTRY_DSN", dsn], // variable du serveur, pas du site
    ];
    for (const [service, key, value] of refused) {
      expect(() => assertEditableVariable(service as "site" | "spotto-api", key, value), `${service} ${key}`).toThrow();
    }
  });

  it("vérifie la forme d'un identifiant de déploiement", () => {
    expect(assertDeployId("dep-darcb4c9v7es73e3070g")).toBe("dep-darcb4c9v7es73e3070g");
    for (const refused of ["srv-darcqk3tqb8s73f082f0", "dep-", "dep-../../x", undefined]) expect(() => assertDeployId(refused)).toThrow();
  });

  it("le script n'utilise jamais les points d'accès qui remplacent ou suppriment des variables", () => {
    const source = readFileSync(fileURLToPath(new URL("../scripts/render-bride.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/"DELETE"/);
    expect(source).not.toMatch(/env-groups/);
    // Seul point d'accès de variable : celui d'UNE variable (clé dans l'adresse).
    expect(source).not.toMatch(/\/env-vars`/);
    expect(source).toMatch(/\/env-vars\/\$\{variable\.key\}/);
  });
});
