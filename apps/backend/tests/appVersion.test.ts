import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { buildApp } from "../src/app.js";
import { buildFromHeader, isBelowMinimum, isVersionGuardExempt, parseMinimumBuild, parseStoreUrl } from "../src/lib/appVersion.js";

// Lot « app iPhone prête » (chantier 4, point 11) : mise à jour obligatoire de
// l'app iPhone, sans base de données. Coupée par défaut ; un build sous le
// minimum réglé chez Render reçoit 426 sur tout appel ; le site, jamais.

const STORE = "https://apps.apple.com/fr/app/spotto/id1234567890";

describe("réglages lus avec indulgence (jamais un arrêt du serveur)", () => {
  it("APP_MIN_IOS_BUILD : un entier positif, sinon aucun minimum", () => {
    expect(parseMinimumBuild(undefined)).toBeNull();
    expect(parseMinimumBuild("")).toBeNull();
    expect(parseMinimumBuild(" 12 ")).toBe(12);
    for (const faute of ["0", "-3", "12a", "1.5", "douze", "99999999"]) expect(parseMinimumBuild(faute)).toBeNull();
  });

  it("APP_STORE_URL : seulement une adresse https de l'App Store", () => {
    expect(parseStoreUrl(STORE)).toBe(STORE);
    expect(parseStoreUrl(undefined)).toBeNull();
    expect(parseStoreUrl("http://apps.apple.com/app/id1")).toBeNull();
    expect(parseStoreUrl("https://exemple.com/spotto")).toBeNull();
    expect(parseStoreUrl("apps.apple.com/app/id1")).toBeNull();
  });

  it("en-tête de build : une seule valeur lisible ; sans build ou sans minimum, jamais bloqué", () => {
    expect(buildFromHeader("7")).toBe(7);
    expect(buildFromHeader(["7", "8"])).toBeNull();
    expect(buildFromHeader(undefined)).toBeNull();
    expect(isBelowMinimum(7, 8)).toBe(true);
    expect(isBelowMinimum(8, 8)).toBe(false);
    expect(isBelowMinimum(null, 8)).toBe(false);
    expect(isBelowMinimum(7, null)).toBe(false);
  });

  it("la lecture du minimum et la sonde de santé ne sont jamais bloquées", () => {
    expect(isVersionGuardExempt("/api/app/version")).toBe(true);
    expect(isVersionGuardExempt("/api/app/version?x=1")).toBe(true);
    expect(isVersionGuardExempt("/health")).toBe(true);
    expect(isVersionGuardExempt("/api/me")).toBe(false);
  });
});

describe("serveur : GET /api/app/version et réponse 426", () => {
  let app: FastifyInstance;
  const saved = { APP_MIN_IOS_BUILD: env.APP_MIN_IOS_BUILD, APP_STORE_URL: env.APP_STORE_URL };

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterEach(() => Object.assign(env, saved));
  afterAll(async () => {
    await app.close();
  });

  const me = (build?: string, language?: string) =>
    app.inject({ method: "GET", url: "/api/me", headers: { ...(build ? { "x-spotto-build": build } : {}), ...(language ? { "accept-language": language } : {}) } });

  it("par défaut : aucun minimum, aucune adresse, et rien n'est bloqué", async () => {
    env.APP_MIN_IOS_BUILD = null;
    env.APP_STORE_URL = null;
    const version = await app.inject({ method: "GET", url: "/api/app/version" });
    expect(version.statusCode).toBe(200);
    expect(version.headers["cache-control"]).toBe("no-store");
    expect(version.json()).toEqual({ ios: { minimumBuild: null, storeUrl: null } });
    // Sans compte : la vérification de compte répond, pas la garde de version.
    expect((await me("1")).statusCode).toBe(401);
  });

  it("minimum réglé : 426 pour un build plus ancien, avant toute vérification de compte", async () => {
    env.APP_MIN_IOS_BUILD = 12;
    env.APP_STORE_URL = STORE;
    expect((await app.inject({ method: "GET", url: "/api/app/version" })).json()).toEqual({ ios: { minimumBuild: 12, storeUrl: STORE } });

    const old = await me("11");
    expect(old.statusCode).toBe(426);
    expect(old.json()).toEqual({
      error: "update_required",
      message: "Cette version de Spotto n'est plus prise en charge. Mettez à jour l'app depuis l'App Store.",
      storeUrl: STORE,
    });
    expect((await me("11", "en")).json().message).toBe("This version of Spotto is no longer supported. Please update the app from the App Store.");

    // Build à jour, site (sans en-tête) ou en-tête illisible : la route répond normalement.
    expect((await me("12")).statusCode).toBe(401);
    expect((await me()).statusCode).toBe(401);
    expect((await me("abc")).statusCode).toBe(401);
    // La lecture du minimum et la sonde restent ouvertes à un build ancien.
    expect((await app.inject({ method: "GET", url: "/api/app/version", headers: { "x-spotto-build": "1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health", headers: { "x-spotto-build": "1" } })).statusCode).toBe(200);
  });
});
