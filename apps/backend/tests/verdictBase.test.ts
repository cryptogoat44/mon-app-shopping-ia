import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetVerdictColumnProbe } from "../src/lib/verdictColumn.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Le verdict (migration 0055) sur la VRAIE base de développement (spotto-dev-2,
// sur le Mac du fondateur) : ce que seule une vraie base prouve — la colonne
// accepte 0, 1, 2 ou rien, refuse tout autre nombre, reste vide par défaut,
// et la relecture (GET /api/searches/:id) en tire la phrase. Sans la colonne
// (0055 absente), chaque test est passé (« skip »). Aucun appel réel : la
// recherche et ses propositions sont écrites directement dans la base, comme
// le serveur les aurait rangées. Un seul compte, effacé à la fin avec ses
// recherches. Les règles, cas par cas, sans base : verdict.test.ts ; les trois
// chemins (lancement, boutiques ensuite, relecture) : boutiquesEnsuiteRoute.test.ts.

const probeColumn = async (app: FastifyInstance) => !(await app.supabaseAdmin.from("product_matches").select("title_tier").limit(0)).error;

describe("verdict : le palier rangé avec la proposition, la phrase à la relecture, sur la base (0055)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let has0055 = false;

  beforeAll(async () => {
    app = await buildTestApp();
    has0055 = await probeColumn(app);
    if (!has0055) return;
    user = await createTestUser(app, "vdt");
  });

  afterAll(async () => {
    if (user) {
      await app.supabaseAdmin.from("product_searches").delete().eq("user_id", user.id);
      await deleteTestUser(app, user.id);
    }
    await app.close();
  });

  beforeEach(() => resetVerdictColumnProbe());

  /** Une recherche terminée, ses boutiques trouvées, avec ses propositions (palier : `undefined` = colonne non nommée). */
  async function savedSearch(offers: { url: string; tier?: number | null; price: number; origin?: "lens" | "shopping" }[]): Promise<string> {
    const { data: search, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_platform: "photo", method: "manual_screenshot", status: "completed", complement_status: "shown" })
      .select("id")
      .single();
    if (error) throw error;
    const id = (search as { id: string }).id;
    const { error: matchError } = await app.supabaseAdmin.from("product_matches").insert(
      offers.map((offer, index) => ({
        search_id: id,
        rank: index + 1,
        product_name: `Veste essai ${index + 1}`,
        image_url: `https://images.example/verdict-${index + 1}.jpg`,
        merchant_url: offer.url,
        merchant_name: "Boutique Essai",
        price_min: offer.price,
        price_max: offer.price,
        currency: "€",
        origin: offer.origin ?? "shopping",
        ...(offer.tier === undefined ? {} : { title_tier: offer.tier }),
      }))
    );
    if (matchError) throw matchError;
    return id;
  }

  const reread = async (id: string) => (await app.inject({ method: "GET", url: `/api/searches/${id}`, headers: authHeaders(user.token) })).json();

  it("permis : 0, 1 et 2 rangés tels quels, vide sur une proposition Lens ; la relecture dit « identified » avec deux enseignes connues, leur nombre et leur fourchette", async (context) => {
    if (!has0055) context.skip();
    const id = await savedSearch([
      { url: "https://lens.example/1", price: 70, origin: "lens" },
      { url: "https://www.zalando.fr/verdict", tier: 0, price: 89 },
      { url: "https://www.asos.com/verdict", tier: 0, price: 59 },
      { url: "https://boutique-essai.example/verdict", tier: 1, price: 60 },
      { url: "https://autre-essai.example/verdict", tier: 2, price: 65 },
    ]);
    const { data, error } = await app.supabaseAdmin.from("product_matches").select("rank, title_tier").eq("search_id", id).order("rank");
    expect(error).toBeNull();
    expect((data as { title_tier: number | null }[]).map((row) => row.title_tier)).toEqual([null, 0, 0, 1, 2]);
    expect((await reread(id)).verdict).toEqual({ level: "identified", shopCount: 2, priceRange: { min: 59, max: 89, currency: "EUR" } });
  });

  it("refusé : la base refuse tout autre palier (3, -1) ; une recherche dont les boutiques n'ont pas de palier (d'avant 0055) n'a aucun verdict", async (context) => {
    if (!has0055) context.skip();
    for (const tier of [3, -1]) await expect(savedSearch([{ url: "https://www.zalando.fr/refus", tier, price: 50 }])).rejects.toMatchObject({ code: "23514" });
    const before = await savedSearch([
      { url: "https://www.zalando.fr/avant", price: 89 },
      { url: "https://www.asos.com/avant", price: 59 },
    ]);
    expect("verdict" in (await reread(before))).toBe(false);
  });
});
