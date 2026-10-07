import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";

// Lot 4 ter (décision 5) : une session refusée par le serveur de Spotto ne
// déconnecte la personne que si Supabase le confirme. Incident du
// 2026-10-07 : une coupure de quelques millisecondes entre le serveur et
// Supabase avait suffi à déconnecter l'app.
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getUser } } }));

import { sessionRejected, sessionRejectedBySupabase } from "../src/lib/session-check";

beforeEach(() => vi.clearAllMocks());

describe("session refusée : seulement sur une réponse explicite de Supabase", () => {
  it("jeton invalide ou expiré, compte supprimé, session fermée : refusée", () => {
    expect(sessionRejected(new AuthApiError("invalid JWT", 401, "bad_jwt"))).toBe(true);
    expect(sessionRejected(new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found"))).toBe(true);
    expect(sessionRejected(new AuthSessionMissingError())).toBe(true);
  });

  it("coupure, réponse illisible, Supabase en panne : jamais refusée", () => {
    expect(sessionRejected(new AuthRetryableFetchError("fetch failed", 0))).toBe(false);
    expect(sessionRejected(new AuthRetryableFetchError("Bad Gateway", 502))).toBe(false);
    expect(sessionRejected(new AuthApiError("Internal Server Error", 500, undefined))).toBe(false);
    expect(sessionRejected(new AuthUnknownError("Unexpected token <", null))).toBe(false);
    expect(sessionRejected(null)).toBe(false);
  });

  it("incident rejoué : le serveur a refusé, mais Supabase répond que la session est valable → pas de déconnexion", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect(await sessionRejectedBySupabase()).toBe(false);
  });

  it("Supabase injoignable à son tour → pas de déconnexion", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthRetryableFetchError("fetch failed", 0) });
    expect(await sessionRejectedBySupabase()).toBe(false);
    getUser.mockRejectedValue(new TypeError("Network request failed"));
    expect(await sessionRejectedBySupabase()).toBe(false);
  });

  it("Supabase confirme (compte supprimé) → déconnexion", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found") });
    expect(await sessionRejectedBySupabase()).toBe(true);
  });
});
