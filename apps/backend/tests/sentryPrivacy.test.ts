import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/node";
import { NO_PERSONAL_DATA, SENTRY_EU_DSN_PATTERN, captureServerError, captureServerFailure, scrubEvent } from "../src/lib/sentry.js";
import * as Sentry from "@sentry/node";

// Suivi des erreurs (lot 2) : aucune donnée personnelle ne part vers Sentry,
// et seule la région UE est acceptée.
describe("Sentry côté serveur : protection des données", () => {
  it("ne garde de la requête que la méthode et l'adresse sans paramètres, et de l'utilisateur que son identifiant", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        method: "POST",
        url: "https://spotto-api.onrender.com/api/users/search?q=camille",
        headers: { authorization: "Bearer secret", cookie: "c=1" },
        cookies: { c: "1" },
        data: { body: "Mon commentaire" },
        query_string: "q=camille",
      },
      user: { id: "u-1", email: "camille@example.com", ip_address: "1.2.3.4", username: "camille" },
      breadcrumbs: [{ category: "http", data: { url: "https://api.exemple.com/x?email=camille@example.com", method: "GET" } }],
    } as ErrorEvent);
    expect(event.request).toEqual({ method: "POST", url: "https://spotto-api.onrender.com/api/users/search" });
    expect(event.user).toEqual({ id: "u-1" });
    expect(event.breadcrumbs![0]!.data).toEqual({ url: "https://api.exemple.com/x", method: "GET" });
    expect(JSON.stringify(event)).not.toMatch(/camille|Bearer|1\.2\.3\.4|commentaire/);
  });

  it("sans identifiant, aucun utilisateur n'est joint", () => {
    expect(scrubEvent({ type: undefined, user: { email: "x@example.com" } } as ErrorEvent).user).toBeUndefined();
  });

  it("toutes les collectes automatiques sont coupées", () => {
    expect(NO_PERSONAL_DATA).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false });
  });

  it("n'accepte qu'une adresse Sentry de la région UE (règle utilisée par env.ts)", () => {
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.de.sentry.io/4500000000000001")).toBe(true);
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.us.sentry.io/4500000000000001")).toBe(false);
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.sentry.io/4500000000000001")).toBe(false);
  });

  it("aucun envoi pendant les tests : Sentry n'est jamais initialisé hors du vrai serveur", () => {
    // initSentry n'est appelé que par instrument.ts (server.ts), jamais par buildApp.
    expect(Sentry.getClient()).toBeUndefined();
    expect(() => captureServerError(new Error("test"), "u-1")).not.toThrow();
    expect(() => captureServerFailure("GET", "/api/x", 500, undefined)).not.toThrow();
  });
});
