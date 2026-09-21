import { describe, expect, it } from "vitest";
import { detectPlatform } from "../src/services/oembed.js";

describe("detectPlatform", () => {
  it("recognizes tiktok.com and its subdomains", () => {
    expect(detectPlatform("https://www.tiktok.com/@user/video/123")).toBe("tiktok");
    expect(detectPlatform("https://tiktok.com/@user/video/123")).toBe("tiktok");
    expect(detectPlatform("https://vm.tiktok.com/abc")).toBe("tiktok");
  });

  it("recognizes instagram.com and its subdomains", () => {
    expect(detectPlatform("https://www.instagram.com/p/abc")).toBe("instagram");
  });

  it("does not treat a look-alike domain as tiktok.com", () => {
    // Contient "tiktok.com" comme sous-chaîne, mais n'est pas TikTok — une
    // simple recherche de texte s'y ferait piéger, une vraie comparaison
    // de nom d'hôte non.
    expect(detectPlatform("https://not-tiktok.com.evil.example/video")).toBe("other");
    expect(detectPlatform("https://tiktok.com.evil.example/video")).toBe("other");
  });

  it("falls back to other for an unrelated or malformed URL", () => {
    expect(detectPlatform("https://example.com/video")).toBe("other");
    expect(detectPlatform("not a url")).toBe("other");
  });
});
