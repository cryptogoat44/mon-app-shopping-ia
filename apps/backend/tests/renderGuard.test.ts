import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FORBIDDEN_OLD_SERVER, assertApiUrl, assertDeployId, resolveService } from "../scripts/lib/render-guard.js";

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
    expect(assertApiUrl("https://spotto-api.onrender.com")).toBe("https://spotto-api.onrender.com");
    for (const refused of [
      "https://spotto-api.onrender.com/",
      "https://mon-app-shopping-ia.onrender.com",
      "http://spotto-api.onrender.com",
      "https://spotto-api.onrender.com.exemple.com",
      "",
      undefined,
    ]) {
      expect(() => assertApiUrl(refused)).toThrow();
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
    expect(source).toMatch(/\/env-vars\/\$\{EDITABLE_VARIABLE\.key\}/);
  });
});
