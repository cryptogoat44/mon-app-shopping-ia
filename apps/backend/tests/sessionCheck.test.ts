import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot 4 ter (décision 5) : une coupure entre le serveur et Supabase n'est
// JAMAIS une session refusée. Avant le correctif, elle répondait 401 (« jeton
// invalide ») et l'app déconnectait la personne — incident du 2026-10-07 sur
// le simulateur : refus en 2 ms, sans réponse de Supabase.
describe("vérification de la session par le serveur", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "ses");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  const coupure = () => ({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
  const profil = () => app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });

  it("coupure persistante vers Supabase : 503 « momentanément injoignable », jamais 401", async () => {
    const espion = vi.spyOn(app.supabaseAdmin.auth, "getUser").mockResolvedValue(coupure());
    try {
      const res = await profil();
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: "auth_unavailable", message: "Spotto est momentanément injoignable. Réessayez dans un instant." });
      expect(espion).toHaveBeenCalledTimes(2);
    } finally {
      espion.mockRestore();
    }
  });

  it("coupure d'un instant : second essai aussitôt, la requête aboutit", async () => {
    const espion = vi.spyOn(app.supabaseAdmin.auth, "getUser").mockResolvedValueOnce(coupure());
    try {
      const res = await profil();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: user.id });
      expect(espion).toHaveBeenCalledTimes(2);
    } finally {
      espion.mockRestore();
    }
  });

  it("Supabase en erreur (500) : 503, jamais 401", async () => {
    const espion = vi.spyOn(app.supabaseAdmin.auth, "getUser").mockResolvedValue({ data: { user: null }, error: new AuthApiError("Internal Server Error", 500, undefined) });
    try {
      expect((await profil()).statusCode).toBe(503);
    } finally {
      espion.mockRestore();
    }
  });

  it("session fermée (réponse explicite de Supabase) : 401, sans second essai", async () => {
    const espion = vi.spyOn(app.supabaseAdmin.auth, "getUser").mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    try {
      expect((await profil()).statusCode).toBe(401);
      expect(espion).toHaveBeenCalledTimes(1);
    } finally {
      espion.mockRestore();
    }
  });

  it("jeton refusé par Supabase (vraie réponse) : 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders("abc.def.ghi") });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("compte supprimé (vraie réponse de Supabase) : 401", async () => {
    const supprime = await createTestUser(app, "sesx");
    await deleteTestUser(app, supprime.id);
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(supprime.token) });
    expect(res.statusCode).toBe(401);
  });
});
