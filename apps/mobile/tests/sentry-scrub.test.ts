import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import type { ErrorEvent as NativeErrorEvent } from "@sentry/react-native";
import { SENTRY_EU_DSN_PATTERN } from "@monapp/shared-types";
import { scrubBreadcrumb, scrubErrorEvent } from "../src/lib/sentry-scrub";

describe("Sentry (site et iPhone) : protection des données", () => {
  it("adresse de page sans paramètres, utilisateur réduit à son identifiant", () => {
    const event = scrubErrorEvent({
      type: undefined,
      request: { url: "https://mon-app-shopping-ia-web.onrender.com/profil?id=abc#x", headers: { "User-Agent": "x" } },
      user: { id: "u-1", email: "camille@example.com", ip_address: "{{auto}}" },
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://mon-app-shopping-ia-web.onrender.com/profil" });
    expect(event.user).toEqual({ id: "u-1" });
  });

  it("écarte la console et les clics, retire les paramètres des adresses", () => {
    expect(scrubBreadcrumb({ category: "console", message: "commentaire de Camille" })).toBeNull();
    expect(scrubBreadcrumb({ category: "ui.click", message: "button[aria-label=Camille]" })).toBeNull();
    expect(scrubBreadcrumb({ category: "fetch", data: { url: "https://spotto-api.onrender.com/api/users/search?q=camille", method: "GET" } })!.data).toEqual({
      url: "https://spotto-api.onrender.com/api/users/search",
      method: "GET",
    });
    expect(scrubBreadcrumb({ category: "navigation", data: { from: "/a?x=1", to: "/profil?id=abc" } })!.data).toEqual({ from: "/a", to: "/profil" });
  });

  it("iPhone : mêmes règles — utilisateur réduit à son identifiant, touchers écartés (lot 3bis)", () => {
    const event = scrubErrorEvent({
      type: undefined,
      user: { id: "u-2", username: "camille", email: "camille@example.com", ip_address: "{{auto}}" },
      contexts: { device: { family: "iOS" } },
    } as NativeErrorEvent);
    expect(event.user).toEqual({ id: "u-2" });
    expect(event.contexts).toEqual({ device: { family: "iOS" } });
    expect(scrubBreadcrumb({ category: "touch", message: "Touched: Camille (test)" })).toBeNull();
    expect(scrubBreadcrumb({ category: "xhr", data: { url: "https://spotto-api.onrender.com/api/posts?cursor=x", status_code: 200 } })!.data).toEqual({
      url: "https://spotto-api.onrender.com/api/posts",
      status_code: 200,
    });
  });

  it("iPhone : traces natives filtrées dans le rapport, code d'appareil retiré (lot 3bis)", () => {
    // Constaté sur le simulateur : traces « ui.lifecycle » et appels réseau
    // ajoutés par la partie native, sans passer par beforeBreadcrumb.
    const event = scrubErrorEvent({
      type: undefined,
      breadcrumbs: [
        { type: "navigation", category: "ui.lifecycle", data: { screen: "RNSScreen", title: "settings" } },
        { type: "http", category: "http", data: { method: "GET", url: "http://localhost:3000/api/feed?cursor=abc", status_code: "200" } },
        { category: "sentry.event", message: "Error: essai" },
      ],
      contexts: { app: { app_name: "Spotto", app_build: "1", device_app_hash: "9e4488b1" }, device: { family: "iOS" } },
    } as NativeErrorEvent);
    expect(event.breadcrumbs).toEqual([
      { type: "http", category: "http", data: { method: "GET", url: "http://localhost:3000/api/feed", status_code: "200" } },
      { category: "sentry.event", message: "Error: essai" },
    ]);
    expect(event.contexts).toEqual({ app: { app_name: "Spotto", app_build: "1" }, device: { family: "iOS" } });
  });

  it("n'accepte qu'une adresse Sentry de la région UE", () => {
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.de.sentry.io/4500000000000001")).toBe(true);
    expect(SENTRY_EU_DSN_PATTERN.test("https://0123abcd@o4500000000000000.ingest.us.sentry.io/4500000000000001")).toBe(false);
  });
});
