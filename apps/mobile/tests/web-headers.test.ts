import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPO_INLINE_SCRIPT, EXPO_INLINE_SCRIPT_SHA256, PRODUCTION_SERVICES, contentSecurityPolicy, webSecurityHeaders } from "../web-headers";

// En-têtes de sécurité du site (lot garde-fous, point 19) : à coller dans
// Render. La page EN-TETES-SITE.md doit dire exactement la même chose.
describe("en-têtes de sécurité du site", () => {
  it("l'empreinte autorise exactement le script écrit par Expo dans chaque page", () => {
    expect(createHash("sha256").update(EXPO_INLINE_SCRIPT).digest("base64")).toBe(EXPO_INLINE_SCRIPT_SHA256);
  });

  it("le code ne vient que du site : ni script écrit dans la page, ni eval, ni cadre étranger", () => {
    const csp = contentSecurityPolicy(PRODUCTION_SERVICES);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src "));
    expect(scriptSrc).toBe(`script-src 'self' 'sha256-${EXPO_INLINE_SCRIPT_SHA256}'`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("autorise les services que le site appelle, et seulement eux", () => {
    const connect = contentSecurityPolicy({ apiUrl: "https://api.exemple.test/", supabaseUrl: "https://projet.supabase.co" })
      .split("; ")
      .find((d) => d.startsWith("connect-src "));
    expect(connect?.split(" ").slice(1)).toEqual([
      "'self'",
      "https://api.exemple.test",
      "https://projet.supabase.co",
      "wss://projet.supabase.co",
      "https://*.ingest.de.sentry.io",
      "https://eu.i.posthog.com",
      "blob:",
      "data:",
    ]);
  });

  it("EN-TETES-SITE.md donne exactement les valeurs de production", () => {
    const page = readFileSync(join(__dirname, "../EN-TETES-SITE.md"), "utf8");
    const rows = [...page.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|$/gm)].map((m) => ({ name: m[1], value: m[2] }));
    expect(rows).toEqual(webSecurityHeaders(PRODUCTION_SERVICES));
  });
});
