// Réseau absent : reconnu sur le site (TypeError du navigateur) comme sur
// iPhone, où Expo remplace fetch et lève une simple Error « fetch failed: … ».
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/api-error";
import { isNetworkError } from "../src/lib/network-error";

describe("réseau absent ou coupé", () => {
  it("sur le site : la TypeError du navigateur (Chrome, Safari, Firefox) ou du fetch de React Native", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
  });

  it("sur iPhone : l'erreur d'expo/fetch, quelle que soit la langue de l'appareil", () => {
    expect(isNetworkError(new Error("fetch failed: The Internet connection appears to be offline."))).toBe(true);
    expect(isNetworkError(new Error("fetch failed: La connexion Internet semble être hors ligne."))).toBe(true);
    expect(isNetworkError(new Error("fetch failed: The request timed out."))).toBe(true);
  });

  it("le reste n'est pas une coupure du réseau", () => {
    expect(isNetworkError(new ApiError(503, { error: "unknown", message: "Service indisponible" }))).toBe(false);
    expect(isNetworkError(new Error("Aucune session active — impossible d'appeler le backend."))).toBe(false);
    expect(isNetworkError(new SyntaxError("Unexpected token < in JSON at position 0"))).toBe(false);
    expect(isNetworkError(new DOMException("The operation was aborted.", "AbortError"))).toBe(false);
    expect(isNetworkError("fetch failed")).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it("le message d'expo/fetch sur iPhone commence toujours par « fetch failed: » (à revoir si Expo le change)", () => {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("expo/src/winter/fetch/FetchErrors.ts"), "utf8");
    expect(source).toContain("export class FetchError extends Error");
    expect(source).toContain("super(`fetch failed: ${message}`)");
  });
});
