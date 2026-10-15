import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { EXPORT_APPENDIX_ID } from "../src/lib/exportHtml.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import { EXPORT_COLUMNS, EXPORT_SECTIONS, EXPORT_TEXT, type ExportColumn } from "../src/lib/exportText.js";
import { decodeHtml, visibleText } from "./exportFixture.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Chaque section de données personnelles que l'export doit contenir — et
// qu'on remplit ci-dessous avant d'exporter. Une section ajoutée à l'export
// sans être ajoutée ici (ou l'inverse) fait échouer le test.
const NON_EMPTY_SECTIONS = [
  "productSearches",
  "productMatches",
  "vaultItems",
  "wishlistItems",
  "posts",
  "postTaggedPieces",
  "reactionsGiven",
  "followers",
  "following",
  "blockedAccounts",
  "reportsSubmitted",
  "comments",
  "notifications",
  "affiliateClicks",
  "affiliateConversions",
  "consents",
  "dataExportRequests",
  // Lot 5 : pièces envoyées et reçues, modération.
  "piecesSent",
  "piecesReceived",
  "moderationDecisionsAboutMe",
  "moderationDecisionsTaken",
  // Fiabilité des résultats : bouton « Résultat incohérent » (migration 0025).
  "resultFeedback",
] as const;

// Sections qui sont un objet (ou null), pas une liste.
const OBJECT_SECTIONS = ["account", "profile", "adminRole", "suspension"] as const;

// Clés du JSON, dans l'ordre : celles d'avant (anciennes versions de l'app
// iPhone, qui lisent ce JSON) et `account`, la seule ajoutée.
const JSON_KEYS = [
  "exportedAt",
  "account",
  "profile",
  "productSearches",
  "productMatches",
  "vaultItems",
  "wishlistItems",
  "posts",
  "postTaggedPieces",
  "reactionsGiven",
  "followers",
  "following",
  "blockedAccounts",
  "reportsSubmitted",
  "comments",
  "notifications",
  "affiliateClicks",
  "affiliateConversions",
  "consents",
  "dataExportRequests",
  "piecesSent",
  "piecesReceived",
  "adminRole",
  "suspension",
  "moderationDecisionsAboutMe",
  "moderationDecisionsTaken",
  "resultFeedback",
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// Audit Lot Q, SEC-01 : l'export oubliait Envies, blocages, signalements,
// notifications, j'aime, demandes d'export, et le contexte des clics.
describe("export RGPD complet", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let friend: TestUser;
  let stranger: TestUser;
  let admin: TestUser;
  let postId = "";

  const exportOf = (who: TestUser, query = "", headers: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: `/api/me/export${query}`, headers: { ...authHeaders(who.token), ...headers } });
  const exportRequests = async (who: TestUser): Promise<number> => {
    const { count, error } = await app.supabaseAdmin.from("data_export_requests").select("id", { count: "exact", head: true }).eq("user_id", who.id);
    if (error) throw error;
    return count ?? 0;
  };

  beforeAll(async () => {
    app = await buildTestApp();
    [user, friend, stranger, admin] = await Promise.all([
      createTestUser(app, "exa"),
      createTestUser(app, "exb"),
      createTestUser(app, "exc"),
      createTestUser(app, "exd"),
    ]);

    // Abonnements dans les deux sens (+ notification "follow" reçue).
    await app.inject({ method: "POST", url: `/api/follows/${user.id}`, headers: authHeaders(friend.token) });
    await app.inject({ method: "POST", url: `/api/follows/${friend.id}`, headers: authHeaders(user.token) });

    // Recherche + résultat (insérés directement : aucun appel SerpApi).
    const { data: search } = await app.supabaseAdmin
      .from("product_searches")
      .insert({ user_id: user.id, source_url: "https://www.tiktok.com/@x/video/1", source_platform: "tiktok", method: "oembed", status: "completed" })
      .select("id")
      .single();
    const { data: match } = await app.supabaseAdmin
      .from("product_matches")
      .insert({ search_id: search!.id, rank: 1, product_name: "Sac", image_url: "https://example.com/a.jpg", merchant_url: "https://example.com/p" })
      .select("id")
      .single();
    await app.supabaseAdmin.from("affiliate_links").insert({ product_match_id: match!.id, network: "direct", affiliate_url: "https://example.com/p" });
    // Bouton « Résultat incohérent » : la proposition signalée.
    const { error: feedbackError } = await app.supabaseAdmin.from("match_feedback").insert({ user_id: user.id, match_id: match!.id, reason: "wrong_item" });
    if (feedbackError) throw feedbackError;

    // Clic marchand avec contexte, puis un achat suivi rattaché à ce clic.
    await app.inject({
      method: "POST",
      url: `/api/product-matches/${match!.id}/click`,
      headers: { ...authHeaders(user.token), "user-agent": "test-agent" },
      payload: { context: "result" },
    });
    const { data: click } = await app.supabaseAdmin.from("affiliate_clicks").select("id").eq("user_id", user.id).single();
    const { error: conversionError } = await app.supabaseAdmin.from("affiliate_conversions").insert({
      affiliate_click_id: click!.id,
      external_conversion_id: `test-${user.id}`,
      amount: 49.99,
      currency: "EUR",
      commission: 2.5,
    });
    if (conversionError) throw conversionError;

    // Publication avec la pièce taguée.
    const post = buildMultipart(
      { type: "lifestyle", privacy: "public", taggedPieces: JSON.stringify([{ productMatchId: match!.id }]) },
      { fieldname: "file", filename: "a.png", contentType: "image/png", data: PNG }
    );
    postId = (await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...post.headers }, payload: post.payload })).json().id;

    // J'aime donné sur la publication d'un ami.
    const friendPost = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "b.png", contentType: "image/png", data: PNG });
    const friendPostId = (
      await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(friend.token), ...friendPost.headers }, payload: friendPost.payload })
    ).json().id;
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/react`, headers: authHeaders(user.token) });
    // Commentaire sur la publication de l'ami (Lot F).
    await app.inject({ method: "POST", url: `/api/posts/${friendPostId}/comments`, headers: authHeaders(user.token), payload: { body: "Superbe" } });

    // Vault, Envie, blocage, signalement, consentement.
    await app.supabaseAdmin.from("vault_items").insert({ user_id: user.id, title: "Montre", image_url: "https://example.com/m.jpg", category: "watches" });
    await app.inject({ method: "POST", url: "/api/wishlist", headers: authHeaders(user.token), payload: { title: "Envie", imageUrl: "https://example.com/e.jpg" } });
    await app.inject({ method: "POST", url: `/api/blocks/${stranger.id}`, headers: authHeaders(user.token) });
    await app.inject({ method: "POST", url: "/api/reports", headers: authHeaders(user.token), payload: { targetType: "user", targetId: stranger.id, reason: "spam" } });
    await app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(user.token), payload: { consents: [{ type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms }] } });

    // Pièces envoyée et reçue (lot 5), insérées directement : aucune copie d'image ici.
    const piece = { title: "Sac", image_url: "https://example.com/copie.jpg", image_thumb_url: "https://example.com/copie-mini.jpg" };
    const { error: piecesError } = await app.supabaseAdmin.from("piece_sends").insert([
      { ...piece, sender_id: user.id, recipient_id: friend.id },
      { ...piece, sender_id: friend.id, recipient_id: user.id },
    ]);
    if (piecesError) throw piecesError;

    // Modération (lot 5) : la personne est aussi administratrice (décision
    // qu'elle a prise, insérée directement) ; une autre administratrice
    // masque sa publication puis suspend son compte (en dernier : un compte
    // suspendu peut toujours exporter ses données).
    const { error: adminsError } = await app.supabaseAdmin.from("admins").insert([{ user_id: admin.id }, { user_id: user.id }]);
    if (adminsError) throw adminsError;
    const { error: takenError } = await app.supabaseAdmin
      .from("moderation_actions")
      .insert({ admin_id: user.id, action: "dismiss", target_type: "user", target_id: stranger.id, target_user_id: stranger.id });
    if (takenError) throw takenError;
    const decide = (payload: object) => app.inject({ method: "POST", url: "/api/admin/moderation/actions", headers: authHeaders(admin.token), payload });
    expect((await decide({ targetType: "post", targetId: postId, action: "hide", reason: "spam" })).statusCode).toBe(200);
    expect((await decide({ targetType: "user", targetId: user.id, action: "suspend", reason: "spam", note: "Essai d'export" })).statusCode).toBe(200);

    // Un premier export, pour que le second contienne cette demande.
    await exportOf(user);
    // Beaucoup d'écritures réelles vers spotto-dev : plus que le délai par défaut.
  }, 60_000);

  afterAll(async () => {
    // L'achat suivi survit à son clic (« on delete set null ») : retiré ici.
    await app.supabaseAdmin.from("affiliate_conversions").delete().eq("external_conversion_id", `test-${user.id}`);
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, friend.id);
    await deleteTestUser(app, stranger.id);
    await deleteTestUser(app, admin.id);
    await app.close();
  });

  it("contient chaque catégorie de données personnelles (compte suspendu compris)", async () => {
    const res = await exportOf(user);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.profile.id).toBe(user.id);
    for (const section of NON_EMPTY_SECTIONS) {
      expect(Array.isArray(body[section]), section).toBe(true);
      expect(body[section].length, section).toBeGreaterThan(0);
    }
    expect(body.adminRole).toEqual({ created_at: expect.any(String) });
    expect(body.suspension).toMatchObject({ moderation_action_id: expect.any(String) });
  });

  it("sans format : le même JSON qu'avant (mêmes clés), plus l'adresse e-mail du compte, jamais mis en cache", async () => {
    const res = await exportOf(user);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(Object.keys(body)).toEqual(JSON_KEYS);
    expect(body.account).toEqual({ email: user.email });
    expect((await exportOf(user, "?format=json")).json().account).toEqual({ email: user.email });
    expect((await exportOf(user, "?format=pdf")).statusCode).toBe(400);
  }, 60_000);

  it("inclut le contexte et le navigateur des clics marchands", async () => {
    const body = (await exportOf(user)).json();
    expect(body.affiliateClicks[0].context).toBe("result");
    expect(body.affiliateClicks[0].user_agent).toBe("test-agent");
  });

  it("inclut la version des documents acceptés", async () => {
    const body = (await exportOf(user)).json();
    expect(body.consents[0].document_version).toBe(LEGAL_DOCUMENT_VERSIONS.terms);
  });

  it("ne contient que les données de l'utilisateur lui-même", async () => {
    const body = (await exportOf(user)).json();
    for (const n of body.notifications) expect(n.user_id).toBe(user.id);
    for (const r of body.reportsSubmitted) expect(r.reporter_id).toBe(user.id);
    for (const w of body.wishlistItems) expect(w.user_id).toBe(user.id);
    for (const p of body.posts) expect(p.user_id).toBe(user.id);
    for (const s of body.piecesSent) expect(s.sender_id).toBe(user.id);
    for (const r of body.piecesReceived) expect(r.recipient_id).toBe(user.id);
    for (const decision of body.moderationDecisionsAboutMe) expect(decision).not.toHaveProperty("admin_id");
  });

  it("chaque section et chaque colonne a sa place et son libellé FR et EN dans le fichier lisible", async () => {
    const body = (await exportOf(user)).json() as Record<string, unknown>;
    const sectionKeys = Object.values(EXPORT_SECTIONS).flatMap((section) => [...section.keys] as string[]);
    const problems: string[] = [];
    for (const key of Object.keys(body).filter((k) => k !== "exportedAt")) {
      if (sectionKeys.filter((k) => k === key).length !== 1) problems.push(`${key} : dans aucune section du fichier, ou dans plusieurs`);
      const columns = (EXPORT_COLUMNS as Record<string, Record<string, ExportColumn>>)[key];
      if (!columns) {
        problems.push(`${key} : aucune colonne décrite`);
        continue;
      }
      const value = body[key];
      const rows = (Array.isArray(value) ? value : value ? [value] : []) as Record<string, unknown>[];
      for (const column of new Set(rows.flatMap((row) => Object.keys(row)))) {
        const entry = columns[column];
        if (!entry) problems.push(`${key}.${column} : colonne sans libellé (ni affichée, ni technique)`);
        else if (!entry.label.fr.trim() || !entry.label.en.trim()) problems.push(`${key}.${column} : libellé vide`);
      }
    }
    expect(problems).toEqual([]);
    for (const key of sectionKeys) expect(Object.keys(body)).toContain(key);
    for (const key of OBJECT_SECTIONS) expect(body[key], key).not.toBeNull();
  });

  it("fichier lisible en français : en-têtes, sécurité, titres, une demande d'export de plus", async () => {
    const before = await exportRequests(user);
    const res = await exportOf(user, "?format=html", { "accept-language": "fr", "x-time-zone": "Asia/Tokyo" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="spotto-mes-donnees-\d{4}-\d{2}-\d{2}\.html"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(res.headers["content-security-policy"])).toMatch(/^sandbox; default-src 'none'; img-src https:\/\/[^;]+; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'$/);
    const page = res.body;
    expect(page).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src [^"]+; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
    expect(page).toContain('<html lang="fr">');
    const text = visibleText(page);
    for (const section of Object.values(EXPORT_SECTIONS)) expect(text, section.title.fr).toContain(section.title.fr);
    expect(text).toContain("Asia/Tokyo");
    expect(text).toContain(`@${friend.username}`);
    expect(await exportRequests(user)).toBe(before + 1);
  }, 60_000);

  it("fichier lisible en anglais ; « Aucune donnée » / « No data » pour une section vide ; fuseau invalide remplacé", async () => {
    const res = await exportOf(user, "?format=html", { "accept-language": "en-GB", "x-time-zone": "Mars/Olympus" });
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="spotto-my-data-\d{4}-\d{2}-\d{2}\.html"$/);
    const text = visibleText(res.body);
    for (const section of Object.values(EXPORT_SECTIONS)) expect(text, section.title.en).toContain(section.title.en);
    expect(text).toContain("time zone: UTC");

    // Le compte bloqué par la personne n'a presque rien : sections vides.
    const empty = await exportOf(stranger, "?format=html", { "accept-language": "fr" });
    expect(visibleText(empty.body)).toContain(EXPORT_TEXT.noData.fr);
    const emptyEn = await exportOf(stranger, "?format=html", { "accept-language": "en" });
    expect(visibleText(emptyEn.body)).toContain(EXPORT_TEXT.noData.en);
  }, 60_000);

  it("neutralise ce que la personne a écrit (légende, bio, commentaire, lien marchand)", async () => {
    const db = app.supabaseAdmin;
    const updates = await Promise.all([
      db.from("posts").update({ caption: "<script>alert(1)</script>" }).eq("id", postId),
      db.from("profiles").update({ bio: '"><img src=x onerror=alert(1)>' }).eq("id", user.id),
      db.from("comments").update({ body: "</pre><script>alert(1)</script>" }).eq("user_id", user.id),
      db.from("wishlist_items").update({ merchant_url: "javascript:alert(1)" }).eq("user_id", user.id),
    ]);
    for (const { error } of updates) expect(error).toBeNull();

    const page = (await exportOf(user, "?format=html", { "accept-language": "fr" })).body;
    expect(page.toLowerCase()).not.toContain("<script");
    expect(page).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect(page).not.toMatch(/href="\s*javascript:/i);
    expect(page).not.toMatch(/<img src=x/i);
    const appendix = page.slice(page.indexOf(`<section id="${EXPORT_APPENDIX_ID}"`));
    expect(appendix).toContain("&lt;/pre&gt;&lt;script&gt;");
    const pre = appendix.slice(appendix.indexOf("<pre>") + 5, appendix.indexOf("</pre>"));
    expect(JSON.parse(decodeHtml(pre)).profile.bio).toBe('"><img src=x onerror=alert(1)>');
  }, 60_000);

  it("aucun identifiant interne dans le texte visible ; l'administratrice n'est jamais nommée", async () => {
    const page = (await exportOf(user, "?format=html", { "accept-language": "fr" })).body;
    const text = visibleText(page);
    expect(text).not.toContain(user.id);
    expect(text).not.toMatch(UUID);
    // Décision et suspension racontées (quoi, pourquoi), jamais qui.
    expect(text).toContain("Contenu masqué");
    expect(text).toContain("Essai d'export");
    expect(page).not.toContain(admin.id);
    expect(page).not.toContain(admin.username);
  });

  // En dernier : les exports suivants de ce compte seraient refusés.
  it("limite : 10 exports par heure et par compte (les deux formats), puis 429 avec un message clair", async () => {
    // Limites désactivées sous Vitest (NODE_ENV=test) : réactivées le temps
    // de la vérification, comme dans rateLimit.test.ts.
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const statuses: number[] = [];
      for (let i = 0; i < RATE_LIMITS.dataExport.max; i++) statuses.push((await exportOf(stranger, i % 2 === 0 ? "" : "?format=html")).statusCode);
      expect(RATE_LIMITS.dataExport.max).toBe(10);
      expect(statuses).toEqual(Array(10).fill(200));
      const limited = await exportOf(stranger, "?format=html", { "accept-language": "en" });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: "export_limit", message: "You've requested several exports in a short time. Please try again in an hour." });
      expect((await exportOf(stranger)).json()).toEqual({ error: "export_limit", message: RATE_LIMITS.dataExport.message });
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    // 11 exports réels vers spotto-dev : plus long que le délai par défaut.
  }, 120_000);
});
