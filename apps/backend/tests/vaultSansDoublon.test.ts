import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Lot « Retrouver ses pièces » : une même proposition du Spotter ne se range
// qu'une fois dans le Vault d'une personne (un second « Je l'ai achetée »
// renvoie la pièce déjà là, avec alreadyInVault) ; un résultat rouvert et la
// fiche d'une envie disent ce qui est déjà gardé ou acheté. Partie sans base :
// vaultSansDoublonHorsBase.test.ts.
describe("Vault sans doublon, et repères « Gardée » / « Ajoutée au Vault »", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;
  let photo: Buffer;

  /** Une recherche réussie de `owner` avec une proposition par nom ; renvoie leurs identifiants. */
  async function createSearch(owner: TestUser, names: string[]): Promise<{ searchId: string; matchIds: string[] }> {
    const { data: search, error } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: owner.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed" })
      .select("id")
      .single();
    if (error || !search) throw error ?? new Error("Recherche non créée");
    const matchIds: string[] = [];
    for (const [index, name] of names.entries()) {
      const { data: match, error: matchError } = await app.supabaseAdmin
        .from("product_matches")
        .insert({
          search_id: search.id,
          rank: index + 1,
          product_name: name,
          image_url: `https://encrypted-tbn.example/${index}.jpg`,
          merchant_url: `https://marchand.example/${index}`,
          merchant_name: "Marchand",
        })
        .select("id")
        .single();
      if (matchError || !match) throw matchError ?? new Error("Proposition non créée");
      matchIds.push(match.id as string);
    }
    return { searchId: search.id as string, matchIds };
  }

  /** « Je l'ai achetée » : ajout au Vault depuis une proposition, avec ou sans photo. */
  function buy(who: TestUser, matchId: string, options: { title?: string; withPhoto?: boolean } = {}) {
    const mp = buildMultipart(
      { title: options.title ?? "Veste", category: "clothing", productMatchId: matchId },
      options.withPhoto ? { fieldname: "file", filename: "v.jpg", contentType: "image/jpeg", data: photo } : undefined
    );
    return app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(who.token), ...mp.headers }, payload: mp.payload });
  }

  /** Les pièces du Vault de `user` liées à cette proposition, lues en base. */
  async function vaultRows(matchId: string): Promise<{ id: string }[]> {
    const { data, error } = await app.supabaseAdmin.from("vault_items").select("id").eq("user_id", user.id).eq("product_match_id", matchId);
    expect(error).toBeNull();
    return (data as { id: string }[] | null) ?? [];
  }

  async function ownPhotos(): Promise<string[]> {
    const { data } = await app.supabaseAdmin.storage.from("vault-media").list(user.id, { limit: 1000 });
    return (data ?? []).map((file) => file.name).sort();
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [user, other] = await Promise.all([createTestUser(app, "vsd"), createTestUser(app, "vso")]);
    photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#456" } }).jpeg().toBuffer();
  });

  afterAll(async () => {
    // Photos du dossier de chaque compte, puis les comptes (pièces, envies, recherches : cascade).
    for (const account of [user, other].filter(Boolean)) {
      const files = ((await app.supabaseAdmin.storage.from("vault-media").list(account.id, { limit: 1000 })).data ?? []).map((f) => `${account.id}/${f.name}`);
      if (files.length > 0) await app.supabaseAdmin.storage.from("vault-media").remove(files);
      await deleteTestUser(app, account.id);
    }
    await app.close();
  });

  it("un second « Je l'ai achetée » sur la même proposition renvoie la pièce déjà rangée, sans en créer une seconde", async () => {
    const { matchIds } = await createSearch(user, ["Veste en daim"]);
    const first = await buy(user, matchIds[0]!);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ productMatchId: matchIds[0], title: "Veste", alreadyInVault: false });

    // Autre titre : rien ne change, la pièce déjà là est renvoyée telle quelle.
    const second = await buy(user, matchIds[0]!, { title: "Veste, encore" });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: first.json().id, title: "Veste", alreadyInVault: true });
    expect(await vaultRows(matchIds[0]!)).toHaveLength(1);
  });

  it("avec une photo : la même pièce est renvoyée et aucune photo n'est rangée", async () => {
    const { matchIds } = await createSearch(user, ["Sac"]);
    const first = await buy(user, matchIds[0]!);
    const photosBefore = await ownPhotos();

    const again = await buy(user, matchIds[0]!, { withPhoto: true });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: first.json().id, alreadyInVault: true });
    expect(await vaultRows(matchIds[0]!)).toHaveLength(1);
    expect(await ownPhotos()).toEqual(photosBefore);
  });

  it("une autre proposition de la même recherche : une seconde pièce ; retirée du Vault, une pièce peut y revenir", async () => {
    const { matchIds } = await createSearch(user, ["Montre", "Montre, autre boutique"]);
    const first = await buy(user, matchIds[0]!);
    const otherProposal = await buy(user, matchIds[1]!);
    expect(otherProposal.json()).toMatchObject({ alreadyInVault: false });
    expect(otherProposal.json().id).not.toBe(first.json().id);

    const removed = await app.inject({ method: "DELETE", url: `/api/vault/${first.json().id}`, headers: authHeaders(user.token) });
    expect(removed.statusCode).toBe(204);
    const back = await buy(user, matchIds[0]!);
    expect(back.json()).toMatchObject({ alreadyInVault: false });
    expect(back.json().id).not.toBe(first.json().id);
    expect(await vaultRows(matchIds[0]!)).toHaveLength(1);
  });

  it("des doublons rangés avant cette vérification : la pièce la plus ancienne est renvoyée, rien de plus n'est créé", async () => {
    const { matchIds } = await createSearch(user, ["Chemise"]);
    const insert = async (createdAt: string) => {
      const { data, error } = await app.supabaseAdmin
        .from("vault_items")
        .insert({ user_id: user.id, title: "Chemise", image_url: "https://encrypted-tbn.example/0.jpg", category: "clothing", product_match_id: matchIds[0], created_at: createdAt })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Pièce non créée");
      return data.id as string;
    };
    const newer = await insert("2026-10-02T10:00:00Z");
    const older = await insert("2026-10-01T10:00:00Z");

    const res = await buy(user, matchIds[0]!);
    expect(res.json()).toMatchObject({ id: older, alreadyInVault: true });
    expect(res.json().id).not.toBe(newer);
    expect(await vaultRows(matchIds[0]!)).toHaveLength(2);
  });

  it("ajouts à la main (sans proposition du Spotter) : jamais regroupés, même avec le même titre", async () => {
    const add = () => {
      const mp = buildMultipart({ title: "Bague", category: "accessories" }, { fieldname: "file", filename: "b.jpg", contentType: "image/jpeg", data: photo });
      return app.inject({ method: "POST", url: "/api/vault", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    };
    const first = (await add()).json();
    const second = (await add()).json();
    expect(first).toMatchObject({ productMatchId: null, alreadyInVault: false });
    expect(second).toMatchObject({ productMatchId: null, alreadyInVault: false });
    expect(second.id).not.toBe(first.id);
  });

  it("la proposition d'une autre personne reste refusée (404), même déjà dans le Vault de celle-ci : rien ne se devine", async () => {
    const { matchIds } = await createSearch(user, ["Ceinture"]);
    expect((await buy(user, matchIds[0]!)).statusCode).toBe(200);
    const refused = await buy(other, matchIds[0]!);
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ error: "product_match_not_found" });
    expect(refused.json()).not.toHaveProperty("alreadyInVault");
  });

  it("résultat rouvert : les propositions gardées et achetées par la personne, jamais ce qu'une autre a rangé", async () => {
    const { searchId, matchIds } = await createSearch(user, ["Gardée", "Achetée", "Ni l'une ni l'autre"]);
    const [kept, bought, untouched] = matchIds as [string, string, string];
    const keep = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Gardée", imageUrl: "https://encrypted-tbn.example/0.jpg", productMatchId: kept },
    });
    expect(keep.statusCode).toBe(200);
    expect((await buy(user, bought)).statusCode).toBe(200);
    // Impossible par l'app (proposition d'une autre recherche) : posé en base pour vérifier le filtre sur la personne.
    const strangerVault = await app.supabaseAdmin.from("vault_items").insert({ user_id: other.id, title: "Pas à vous", image_url: "https://encrypted-tbn.example/2.jpg", category: "other", product_match_id: untouched });
    const strangerWish = await app.supabaseAdmin.from("wishlist_items").insert({ user_id: other.id, title: "Pas à vous", image_url: "https://encrypted-tbn.example/2.jpg", product_match_id: untouched });
    expect(strangerVault.error).toBeNull();
    expect(strangerWish.error).toBeNull();

    const res = await app.inject({ method: "GET", url: `/api/searches/${searchId}`, headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().wishlistMatchIds).toEqual([kept]);
    expect(res.json().vaultMatchIds).toEqual([bought]);
    expect(res.json().matches).toHaveLength(3);

    // L'historique (GET /api/searches) ne change pas de forme.
    const list = await app.inject({ method: "GET", url: "/api/searches?limit=20", headers: authHeaders(user.token) });
    const entry = (list.json() as { id: string }[]).find((search) => search.id === searchId);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("wishlistMatchIds");
  });

  it("fiche d'une envie : « inVault » faux, puis vrai après « Je l'ai achetée » ; une envie sans proposition d'origine : faux", async () => {
    const { matchIds } = await createSearch(user, ["Écharpe"]);
    const wish = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Écharpe", imageUrl: "https://encrypted-tbn.example/0.jpg", productMatchId: matchIds[0] },
    });
    const wishId = wish.json().id as string;
    const detail = () => app.inject({ method: "GET", url: `/api/wishlist/${wishId}`, headers: authHeaders(user.token) });
    expect((await detail()).json()).toMatchObject({ productMatchId: matchIds[0], inVault: false });

    // Depuis la fiche : le titre de l'envie et sa proposition d'origine, sans photo.
    const bought = await buy(user, matchIds[0]!, { title: "Écharpe" });
    expect(bought.json()).toMatchObject({ alreadyInVault: false, imageUrl: "https://encrypted-tbn.example/0.jpg" });
    expect((await detail()).json()).toMatchObject({ inVault: true });
    expect((await buy(user, matchIds[0]!, { title: "Écharpe" })).json()).toMatchObject({ id: bought.json().id, alreadyInVault: true });

    const plain = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: authHeaders(user.token),
      payload: { title: "Sans origine", imageUrl: "https://encrypted-tbn.example/autre.jpg" },
    });
    const plainDetail = await app.inject({ method: "GET", url: `/api/wishlist/${plain.json().id}`, headers: authHeaders(user.token) });
    expect(plainDetail.json()).toMatchObject({ productMatchId: null, inVault: false });
  });
});
