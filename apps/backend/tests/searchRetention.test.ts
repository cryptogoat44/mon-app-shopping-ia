import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";
import { purgeExpiredSearches, retentionCutoff } from "../src/lib/searchRetention.js";

// Conservation de l'historique des recherches : 12 mois (décision du
// fondateur, 2026-09-25), nettoyé à chaque nouvelle recherche.

const MONTH_MS = 30.5 * 24 * 3600 * 1000;
const monthsAgo = (months: number) => new Date(Date.now() - months * MONTH_MS).toISOString();

describe("conservation de l'historique des recherches", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  // Une recherche datée, avec une proposition, son lien marchand et un clic.
  async function seedSearch(owner: TestUser, createdAt: string) {
    const db = app.supabaseAdmin;
    const { data: search } = await db
      .from("product_searches")
      .insert({ user_id: owner.id, source_platform: "photo", method: "manual_screenshot", status: "completed", created_at: createdAt })
      .select("id")
      .single();
    const { data: match } = await db
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Veste", image_url: "https://example.com/v.jpg", merchant_url: "https://example.com/v" })
      .select("id")
      .single();
    const { data: link } = await db
      .from("affiliate_links")
      .insert({ product_match_id: match!.id, network: "direct", affiliate_url: "https://example.com/v" })
      .select("id")
      .single();
    const { data: click } = await db
      .from("affiliate_clicks")
      .insert({ affiliate_link_id: link!.id, user_id: owner.id, context: "result" })
      .select("id")
      .single();
    return { searchId: search!.id as string, matchId: match!.id as string, linkId: link!.id as string, clickId: click!.id as string };
  }

  async function exists(table: string, id: string): Promise<boolean> {
    const { data } = await app.supabaseAdmin.from(table).select("id").eq("id", id).maybeSingle();
    return data !== null;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "reta");
    other = await createTestUser(app, "retb");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("calcule la date limite à 12 mois", () => {
    expect(retentionCutoff(new Date("2026-09-25T10:00:00Z")).toISOString()).toBe("2025-09-25T10:00:00.000Z");
  });

  it("une nouvelle recherche supprime les recherches de plus de 12 mois, avec propositions, liens et clics", async () => {
    const expired = await seedSearch(user, monthsAgo(13));
    const recent = await seedSearch(user, monthsAgo(11));
    const othersExpired = await seedSearch(other, monthsAgo(13));

    const res = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    expect(res.statusCode).toBe(200);

    expect(await exists("product_searches", expired.searchId)).toBe(false);
    expect(await exists("product_matches", expired.matchId)).toBe(false);
    expect(await exists("affiliate_links", expired.linkId)).toBe(false);
    expect(await exists("affiliate_clicks", expired.clickId)).toBe(false);

    // Moins de 12 mois : conservée ; un autre utilisateur : jamais touché.
    expect(await exists("product_searches", recent.searchId)).toBe(true);
    expect(await exists("affiliate_clicks", recent.clickId)).toBe(true);
    expect(await exists("product_searches", othersExpired.searchId)).toBe(true);
    // La nouvelle recherche existe bien.
    expect(await exists("product_searches", res.json().id)).toBe(true);
  });

  it("garde une recherche ancienne dont une pièce est dans le Vault, les Envies ou une publication", async () => {
    const db = app.supabaseAdmin;
    const inVault = await seedSearch(user, monthsAgo(14));
    const inWishlist = await seedSearch(user, monthsAgo(14));
    const tagged = await seedSearch(user, monthsAgo(14));
    const plain = await seedSearch(user, monthsAgo(14));

    const { data: vaultItem } = await db
      .from("vault_items")
      .insert({ user_id: user.id, title: "Veste", image_url: "https://example.com/v.jpg", category: "clothing", product_match_id: inVault.matchId })
      .select("id")
      .single();
    await db.from("wishlist_items").insert({ user_id: user.id, title: "Veste", image_url: "https://example.com/v.jpg", product_match_id: inWishlist.matchId });
    const { data: post } = await db
      .from("posts")
      .insert({ user_id: user.id, type: "lifestyle", media_kind: "photo", media_url: "https://example.com/p.jpg", privacy: "private" })
      .select("id")
      .single();
    await db.from("post_tagged_pieces").insert({ post_id: post!.id, product_match_id: tagged.matchId });

    const deleted = await purgeExpiredSearches(app, user.id);
    expect(deleted).toBe(1);

    expect(await exists("product_searches", plain.searchId)).toBe(false);
    for (const kept of [inVault, inWishlist, tagged]) {
      expect(await exists("product_searches", kept.searchId)).toBe(true);
      expect(await exists("product_matches", kept.matchId)).toBe(true);
    }
    const { data: vaultAfter } = await db.from("vault_items").select("product_match_id").eq("id", vaultItem!.id).single();
    expect(vaultAfter!.product_match_id).toBe(inVault.matchId);
    const { count } = await db.from("post_tagged_pieces").select("id", { count: "exact", head: true }).eq("post_id", post!.id);
    expect(count).toBe(1);
  });

  it("ne fait rien quand aucune recherche n'a plus de 12 mois", async () => {
    expect(await purgeExpiredSearches(app, other.id, new Date(Date.now() - 24 * MONTH_MS))).toBe(0);
  });
});
