import sharp from "sharp";
import { describe, expect, it } from "vitest";

// Lot « sécurité des images » : la liste blanche des lecteurs d'images doit
// être posée par le démarrage du serveur lui-même. Ce fichier n'importe donc
// aucun module du serveur avant le test (chaque fichier de tests tourne dans
// son propre processus : rien n'est bloqué au départ).

// SVG inoffensif, seulement pour vérifier que sharp lit les SVG au départ.
const HARMLESS_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#004225"/></svg>');

describe("démarrage du serveur : liste blanche des lecteurs d'images", () => {
  it("avant le chargement de l'app, sharp lit un SVG ; après buildApp, plus jamais, et /health répond", async () => {
    expect((await sharp(HARMLESS_SVG).metadata()).format).toBe("svg");

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp({ logger: false });
    try {
      await app.ready();
      await expect(sharp(HARMLESS_SVG).metadata()).rejects.toThrow(/unsupported image format/);
      const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#806040" } }).jpeg().toBuffer();
      expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });
});
