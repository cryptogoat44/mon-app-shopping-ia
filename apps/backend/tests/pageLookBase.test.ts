import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { env } from "../src/env.js";
import { newLookToken, resetLookPagesProbe } from "../src/lib/lookPages.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// La page look (migration 0057) sur la VRAIE base de développement
// (spotto-dev-2, sur le Mac du fondateur) : ce que seule une vraie base
// prouve. Sans la table shared_looks (0057 absente), chaque test est passé
// (« skip »). Aucun appel payant : la page est créée par la route depuis une
// recherche insérée directement (aucune image téléchargée : la page est créée
// sans image). Décision du fondateur n° 4 : AUCUNE porte de la base n'est
// ouverte au public ; la page est lue par la route du serveur.
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return { env: { ...original.env, LOOK_PAGES_ENABLED: true, VOIE_C_ENABLED: false, VOIE_C_AI_ENABLED: false } };
});

const probeTable = async (app: FastifyInstance) => !(await app.supabaseAdmin.from("shared_looks").select("id").limit(0)).error;

describe("page look sur la base (0057)", () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let other: TestUser;
  let has0057 = false;

  /** Une recherche terminée d'il y a une heure, avec une proposition. */
  async function seedSearch(user: TestUser, createdAt = new Date(Date.now() - 3_600_000).toISOString()) {
    const { data: search, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_platform: "photo", method: "manual_screenshot", status: "completed", created_at: createdAt })
      .select("id")
      .single();
    if (error) throw error;
    const { data: match, error: matchError } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Veste page look", image_url: "https://127.0.0.1:9/indisponible.jpg", merchant_url: "https://marchand.example/veste", price_min: 89, currency: "EUR" })
      .select("id")
      .single();
    if (matchError) throw matchError;
    return { searchId: search!.id as string, matchId: match!.id as string };
  }

  async function share(user: TestUser, matchId: string) {
    const res = await app.inject({ method: "POST", url: "/api/looks", headers: authHeaders(user.token), payload: { matchId } });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; url: string };
    return { ...body, token: new URL(body.url).searchParams.get("l")! };
  }

  const visit = (token: string) => app.inject({ method: "GET", url: `/api/looks/public/${token}` });

  beforeAll(async () => {
    app = await buildTestApp();
    resetLookPagesProbe();
    has0057 = await probeTable(app);
    if (!has0057) return;
    [owner, other] = await Promise.all([createTestUser(app, "lko"), createTestUser(app, "lkx")]);
  });

  afterAll(async () => {
    if (has0057) {
      for (const user of [owner, other]) if (user) await deleteTestUser(app, user.id).catch(() => undefined);
    }
    await app.close();
  });

  it("refusé : la clé publique (visiteur ou membre connecté) ne lit ni n'écrit la table ; permis : la route du serveur lit la page", async (context) => {
    if (!has0057) return context.skip();
    const { matchId } = await seedSearch(owner);
    const look = await share(owner, matchId);
    const visitor = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const member = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${owner.token}` } } });
    for (const client of [visitor, member]) {
      const read = await client.from("shared_looks").select("*");
      expect(read.data ?? []).toEqual([]);
      expect((await client.from("shared_looks").insert({ user_id: owner.id, token: newLookToken(), content: {}, expires_at: new Date().toISOString() })).error).not.toBeNull();
      // Aucune fonction ouverte : l'ancienne idée look_public n'existe pas.
      expect((await client.rpc("look_public", { p_token: look.token })).error).not.toBeNull();
    }
    const page = await visit(look.token);
    expect(page.statusCode).toBe(200);
    expect(page.json().piece).toEqual({ name: "Veste page look", brand: null, image: null });
  });

  it("refusé : jeton faux, mal formé, page expirée ou arrêtée → la même réponse ; permis : la page active", async (context) => {
    if (!has0057) return context.skip();
    const { matchId } = await seedSearch(owner);
    const look = await share(owner, matchId);
    const unknown = await visit(newLookToken());
    expect(unknown.statusCode).toBe(404);
    expect((await visit("mal-forme")).body).toBe(unknown.body);
    expect((await visit(look.token)).statusCode).toBe(200);
    // Expirée : la règle de la base exige expires_at > created_at, on recule les deux.
    const { error } = await app.supabaseAdmin
      .from("shared_looks")
      .update({ created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", look.id);
    expect(error).toBeNull();
    expect((await visit(look.token)).body).toBe(unknown.body);
    // Arrêtée par un autre membre : refusé ; par son auteur : permis.
    const second = await share(owner, (await seedSearch(owner)).matchId);
    expect((await app.inject({ method: "DELETE", url: `/api/looks/${second.id}`, headers: authHeaders(other.token) })).statusCode).toBe(404);
    expect((await visit(second.token)).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/looks/${second.id}`, headers: authHeaders(owner.token) })).statusCode).toBe(204);
    expect((await visit(second.token)).body).toBe(unknown.body);
  });

  it("compte suspendu : la page disparaît aussitôt (refusé), puis revient à la levée de la suspension (permis)", async (context) => {
    if (!has0057) return context.skip();
    const look = await share(owner, (await seedSearch(owner)).matchId);
    // Suspension par la vraie route de la modération (l'autre compte devient administrateur).
    expect((await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(other.token), payload: { targetType: "user", targetId: owner.id, reason: "spam" } })).statusCode).toBe(204);
    await app.supabaseAdmin.from("admins").insert({ user_id: other.id });
    const decided = await app.inject({ method: "POST", url: "/api/admin/moderation/actions", headers: authHeaders(other.token), payload: { targetType: "user", targetId: owner.id, action: "suspend", reason: "spam" } });
    expect(decided.statusCode).toBe(200);
    expect((await visit(look.token)).statusCode).toBe(404);
    const undone = await app.inject({ method: "POST", url: `/api/admin/moderation/actions/${decided.json().actionId}/undo`, headers: authHeaders(other.token), payload: {} });
    expect(undone.statusCode).toBe(200);
    expect((await visit(look.token)).statusCode).toBe(200);
  });

  it("la page part avec la recherche (purge) et avec le compte (cascade)", async (context) => {
    if (!has0057) return context.skip();
    const { searchId, matchId } = await seedSearch(owner);
    const look = await share(owner, matchId);
    await app.supabaseAdmin.from("product_searches").delete().eq("id", searchId);
    expect((await app.supabaseAdmin.from("shared_looks").select("id").eq("id", look.id)).data).toEqual([]);
    expect((await visit(look.token)).statusCode).toBe(404);

    const leaving = await createTestUser(app, "lkd");
    const kept = await share(leaving, (await seedSearch(leaving)).matchId);
    await deleteTestUser(app, leaving.id);
    expect((await app.supabaseAdmin.from("shared_looks").select("id").eq("id", kept.id)).data).toEqual([]);
    expect((await visit(kept.token)).statusCode).toBe(404);
  });
});
