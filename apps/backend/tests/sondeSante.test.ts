import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { env } from "../src/env.js";
import { parseServedCommit } from "../src/lib/serverVersion.js";

// Sondes de santé (lot garde-fous, point 15). Hors base (test:hors-base),
// l'adresse de la base est factice (http://127.0.0.1:9), donc la base « ne
// répond pas ». Avec la base (test:ci, spotto-dev-2), elle répond.
const offlineDatabase = new URL(env.SUPABASE_URL).hostname === "127.0.0.1";

describe("sondes de santé", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("/health dit seulement « le serveur répond » et sa version : une panne de la base ne la fait jamais échouer (mises en ligne de Render)", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    // Hors de Render, aucun commit fourni : version null. Rien d'autre dans la réponse.
    expect(response.json()).toEqual({ status: "ok", version: null });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.runIf(offlineDatabase)("/health/deep vérifie aussi la base : injoignable, 503 et « degraded », sans détail", async () => {
    const response = await app.inject({ method: "GET", url: "/health/deep" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "degraded", database: "unreachable" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.skipIf(offlineDatabase)("/health/deep vérifie aussi la base : joignable, 200 et « ok », sans détail", async () => {
    const response = await app.inject({ method: "GET", url: "/health/deep" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});

// Version servie (lot « filets de sécurité ») : le commit fourni par Render,
// en 7 caractères ; toute autre valeur est ignorée, jamais recopiée.
describe("version servie par /health", () => {
  it("un commit complet ou court donne ses 7 premiers caractères, en minuscules", () => {
    expect(parseServedCommit("a0212c1f3b9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c")).toBe("a0212c1");
    expect(parseServedCommit("A0212C1")).toBe("a0212c1");
    expect(parseServedCommit(" a0212c1f \n")).toBe("a0212c1");
  });

  it("absente, vide ou autre chose qu'un commit : null (jamais un texte recopié, jamais un arrêt)", () => {
    for (const value of [undefined, "", "main", "a0212c", "a0212c1-dirty", "sk-ant-api03-abcdef", "https://spotto-api.onrender.com", "a".repeat(41)]) {
      expect(parseServedCommit(value), String(value)).toBeNull();
    }
  });
});
