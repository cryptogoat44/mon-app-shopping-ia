import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

// Sondes de santé (lot garde-fous, point 15). Hors base : l'adresse de la
// base est factice (SUPABASE_URL, voir la vérification du lot), donc la base
// « ne répond pas ».
describe("sondes de santé", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("/health dit seulement « le serveur répond » : une panne de la base ne la fait jamais échouer (mises en ligne de Render)", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("/health/deep vérifie aussi la base : injoignable, 503 et « degraded », sans détail", async () => {
    const response = await app.inject({ method: "GET", url: "/health/deep" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "degraded", database: "unreachable" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
