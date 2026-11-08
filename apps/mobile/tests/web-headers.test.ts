import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPO_INLINE_SCRIPT, EXPO_INLINE_SCRIPT_SHA256, PRODUCTION_SERVICES, TURNSTILE, contentSecurityPolicy, webSecurityHeaders } from "../web-headers";
import { TURNSTILE_ORIGIN } from "../src/lib/robot-check";

// En-têtes de sécurité du site (lot garde-fous, point 19) : à coller dans
// Render. La page EN-TETES-SITE.md doit dire exactement la même chose.
describe("en-têtes de sécurité du site", () => {
  it("l'empreinte autorise exactement le script écrit par Expo dans chaque page", () => {
    expect(createHash("sha256").update(EXPO_INLINE_SCRIPT).digest("base64")).toBe(EXPO_INLINE_SCRIPT_SHA256);
  });

  it("le code ne vient que du site (et du widget anti-robots) : ni script écrit dans la page, ni eval, ni cadre étranger", () => {
    const csp = contentSecurityPolicy(PRODUCTION_SERVICES);
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));
    expect(directive("script-src")).toBe(`script-src 'self' 'sha256-${EXPO_INLINE_SCRIPT_SHA256}' https://challenges.cloudflare.com`);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    // Affiché seulement dans son propre cadre (page du widget anti-robots), jamais dans celui d'un autre site.
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'self'");
    expect(webSecurityHeaders(PRODUCTION_SERVICES).find((h) => h.name === "X-Frame-Options")?.value).toBe("SAMEORIGIN");
  });

  it("anti-robots (point 17) : Cloudflare Turnstile pour le script et le cadre seulement, à l'adresse exacte", () => {
    const csp = contentSecurityPolicy(PRODUCTION_SERVICES);
    expect(TURNSTILE).toBe(TURNSTILE_ORIGIN);
    expect(csp.split("; ").find((d) => d.startsWith("frame-src "))).toBe("frame-src 'self' https://challenges.cloudflare.com");
    expect(csp.match(/challenges\.cloudflare\.com/g)).toHaveLength(2);
    expect(csp).not.toMatch(/\*\.cloudflare|cloudflare\.com\/?\*/);
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
