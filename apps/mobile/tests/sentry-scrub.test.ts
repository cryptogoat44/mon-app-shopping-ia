import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";
import { scrubWebBreadcrumb, scrubWebEvent } from "../src/lib/sentry-scrub";

describe("Sentry côté site : protection des données", () => {
  it("adresse de page sans paramètres, utilisateur réduit à son identifiant", () => {
    const event = scrubWebEvent({
      type: undefined,
      request: { url: "https://mon-app-shopping-ia-web.onrender.com/profil?id=abc#x", headers: { "User-Agent": "x" } },
      user: { id: "u-1", email: "camille@example.com", ip_address: "{{auto}}" },
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://mon-app-shopping-ia-web.onrender.com/profil" });
    expect(event.user).toEqual({ id: "u-1" });
  });

  it("écarte la console et les clics, retire les paramètres des adresses", () => {
    expect(scrubWebBreadcrumb({ category: "console", message: "commentaire de Camille" })).toBeNull();
    expect(scrubWebBreadcrumb({ category: "ui.click", message: "button[aria-label=Camille]" })).toBeNull();
    expect(scrubWebBreadcrumb({ category: "fetch", data: { url: "https://spotto-api.onrender.com/api/users/search?q=camille", method: "GET" } })!.data).toEqual({
      url: "https://spotto-api.onrender.com/api/users/search",
      method: "GET",
    });
    expect(scrubWebBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/profil?id=abc" } })!.data).toEqual({ from: "/a", to: "/profil" });
  });

  it("n'accepte qu'une adresse Sentry de la région UE", () => {
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.de.sentry.io/4500000000000001")).toBe(true);
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.us.sentry.io/4500000000000001")).toBe(false);
  });
});
