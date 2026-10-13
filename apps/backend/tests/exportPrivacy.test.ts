import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { MODERATION_ACTION_TYPES } from "@monapp/shared-types";
import { EXPORT_COLUMNS, EXPORT_TEXT, MODERATION_ACTION_LABELS, REPORT_HANDLED_LABELS } from "../src/lib/exportText.js";
import { sectionHtml, visibleText } from "./exportFixture.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Fichier lisible de l'export (lot 5) : ce qu'il montre des autres comptes.
// - Règle 8 : un compte en relation de blocage avec la personne, dans un sens
//   comme dans l'autre, n'est jamais nommé, même là où le blocage n'efface
//   rien (« j'aime », commentaires, pièces reçues, signalements) ; les comptes
//   qu'elle a bloqués gardent leur nom dans « Comptes bloqués », et seulement là.
// - L'auteur d'un signalement apprend qu'il a été traité, jamais la décision :
//   ni dans « Vos signalements », ni par l'état « masqué » d'une pièce reçue ou
//   d'une notification ; l'administrateur n'est jamais nommé, ni à lui ni à
//   la personne concernée.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

describe("export lisible : autres comptes, blocages et modération", () => {
  let app: FastifyInstance;
  let me: TestUser; // A : exporte ses données
  let blocker: TestUser; // B : bloque A
  let blocked: TestUser; // C : bloqué par A
  let author: TestUser; // auteur d'une publication, d'un commentaire et d'une pièce signalés par A
  let admin: TestUser;
  const BLOCKER_NAME = "Nom Que A Ne Doit Pas Lire";

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), payload });
  const readable = async (user: TestUser, language = "fr"): Promise<string> => {
    const res = await app.inject({ method: "GET", url: "/api/me/export?format=html", headers: { ...authHeaders(user.token), "accept-language": language } });
    expect(res.statusCode).toBe(200);
    return res.body;
  };
  async function publish(user: TestUser): Promise<string> {
    const mp = buildMultipart({ type: "lifestyle", privacy: "public" }, { fieldname: "file", filename: "p.png", contentType: "image/png", data: PNG });
    const res = await app.inject({ method: "POST", url: "/api/posts", headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    return res.json().id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    [me, blocker, blocked, author, admin] = await Promise.all([
      createTestUser(app, "xpa"),
      createTestUser(app, "xpb"),
      createTestUser(app, "xpc"),
      createTestUser(app, "xpu"),
      createTestUser(app, "xpm"),
    ]);
    const { error: nameError } = await app.supabaseAdmin.from("profiles").update({ display_name: BLOCKER_NAME }).eq("id", blocker.id);
    if (nameError) throw nameError;
    const { error: adminError } = await app.supabaseAdmin.from("admins").insert({ user_id: admin.id });
    if (adminError) throw adminError;

    // A aime et commente une publication de B, B lui envoie une pièce (insérée
    // directement), puis B bloque A : rien de tout cela n'est effacé.
    const blockerPost = await publish(blocker);
    expect((await request(me, "POST", `/api/posts/${blockerPost}/react`)).statusCode).toBe(200);
    expect((await request(me, "POST", `/api/posts/${blockerPost}/comments`, { body: "Jolie pièce" })).statusCode).toBe(200);
    const { error: pieceError } = await app.supabaseAdmin.from("piece_sends").insert({
      sender_id: blocker.id,
      recipient_id: me.id,
      title: "Sac envoyé",
      image_url: "https://example.com/copie.jpg",
      image_thumb_url: "https://example.com/copie-mini.jpg",
    });
    if (pieceError) throw pieceError;
    // C envoie aussi une pièce à A, puis A bloque C et le signale.
    const { error: blockedPieceError } = await app.supabaseAdmin.from("piece_sends").insert({
      sender_id: blocked.id,
      recipient_id: me.id,
      title: "Sac de C",
      image_url: "https://example.com/c.jpg",
      image_thumb_url: "https://example.com/c-mini.jpg",
    });
    if (blockedPieceError) throw blockedPieceError;
    expect((await request(blocker, "POST", `/api/blocks/${me.id}`)).statusCode).toBe(204);
    expect((await request(me, "POST", `/api/blocks/${blocked.id}`)).statusCode).toBe(204);
    expect((await request(me, "POST", "/api/reports", { targetType: "user", targetId: blocked.id, reason: "spam" })).statusCode).toBe(204);

    // A signale une publication ; l'administratrice la masque.
    const reportedPost = await publish(author);
    expect((await request(me, "POST", "/api/reports", { targetType: "post", targetId: reportedPost, reason: "harassment" })).statusCode).toBe(204);
    const decide = (payload: object) => request(admin, "POST", "/api/admin/moderation/actions", payload);
    expect((await decide({ targetType: "post", targetId: reportedPost, action: "hide", reason: "harassment" })).statusCode).toBe(200);

    // L'auteur commente une publication de A (notification à A) et lui envoie
    // une pièce (insérée directement, avec sa notification, comme
    // POST /api/pieces) ; A signale les deux ; l'administratrice les masque,
    // notifications comprises (moderation_set_hidden).
    const myPost = await publish(me);
    const comment = await request(author, "POST", `/api/posts/${myPost}/comments`, { body: "Commentaire signalé" });
    expect(comment.statusCode).toBe(200);
    const { data: piece, error: reportedPieceError } = await app.supabaseAdmin
      .from("piece_sends")
      .insert({
        sender_id: author.id,
        recipient_id: me.id,
        title: "Sac signalé",
        image_url: "https://example.com/s.jpg",
        image_thumb_url: "https://example.com/s-mini.jpg",
      })
      .select("id")
      .single();
    if (reportedPieceError || !piece) throw reportedPieceError ?? new Error("Pièce non créée");
    const { error: notifyError } = await app.supabaseAdmin
      .from("notifications")
      .insert({ user_id: me.id, actor_id: author.id, type: "piece_received", piece_send_id: piece.id });
    if (notifyError) throw notifyError;
    expect((await request(me, "POST", "/api/reports", { targetType: "comment", targetId: comment.json().id, reason: "harassment" })).statusCode).toBe(204);
    expect((await request(me, "POST", "/api/reports", { targetType: "piece", targetId: piece.id, reason: "inappropriate" })).statusCode).toBe(204);
    expect((await decide({ targetType: "comment", targetId: comment.json().id, action: "hide", reason: "harassment" })).statusCode).toBe(200);
    expect((await decide({ targetType: "piece", targetId: piece.id, action: "hide", reason: "inappropriate" })).statusCode).toBe(200);
  }, 60_000);

  afterAll(async () => {
    for (const user of [me, blocker, blocked, author, admin]) await deleteTestUser(app, user.id);
    await app.close();
  });

  it("un compte qui m'a bloqué n'est jamais nommé ; ceux que j'ai bloqués le sont, dans « Comptes bloqués »", async () => {
    const page = await readable(me);
    const text = visibleText(page);
    expect(text).not.toContain(blocker.username);
    expect(text).not.toContain(BLOCKER_NAME);
    // Les données restent toutes là, sans nom : « j'aime », commentaire, pièce reçue.
    expect(text).toContain(EXPORT_TEXT.postBySomeone.fr);
    expect(text).toContain("Jolie pièce");
    expect(text).toContain("Sac envoyé");
    expect(text).toContain(`${EXPORT_COLUMNS.piecesReceived.sender_id.label.fr} ${EXPORT_TEXT.someone.fr}`);
    expect(visibleText(sectionHtml(page, "blocked"))).toContain(`@${blocked.username}`);
    // C, bloqué par A : nommé dans « Comptes bloqués » seulement ; sa pièce et
    // le signalement de son compte restent là, sans son nom.
    expect(visibleText(page.replace(sectionHtml(page, "blocked"), ""))).not.toContain(blocked.username);
    expect(text).toContain("Sac de C");
    expect(visibleText(sectionHtml(page, "reports"))).toContain(`${EXPORT_COLUMNS.reportsSubmitted.target_id.label.fr} ${EXPORT_TEXT.someone.fr}`);

    const englishPage = await readable(me, "en");
    const english = visibleText(englishPage);
    expect(english).not.toContain(blocker.username);
    expect(english).toContain(EXPORT_TEXT.postBySomeone.en);
    expect(visibleText(englishPage.replace(sectionHtml(englishPage, "blocked"), ""))).not.toContain(blocked.username);
  }, 60_000);

  it("une pièce reçue ou le commentaire d'un autre, masqués après mon signalement : jamais « masqué » dans mon fichier", async () => {
    for (const language of ["fr", "en"] as const) {
      const page = await readable(me, language);
      const text = visibleText(page);
      // Les données restent là, et le signalement est dit traité.
      expect(text).toContain("Sac signalé");
      expect(text).toContain(REPORT_HANDLED_LABELS.piece[language]);
      expect(text).toContain(REPORT_HANDLED_LABELS.comment[language]);
      // Jamais l'état « masqué » qui trahirait la décision.
      expect(text).not.toContain(EXPORT_COLUMNS.piecesSent.hidden_at.label[language]);
      expect(text).not.toContain(EXPORT_COLUMNS.notifications.hidden_at.label[language]);
      expect(text).not.toContain(EXPORT_TEXT.hiddenWithContent[language]);
      for (const id of ["piecesReceived", "notifications"]) expect(visibleText(sectionHtml(page, id)), id).not.toMatch(/masqu|hidden/i);
      for (const action of MODERATION_ACTION_TYPES) expect(text).not.toContain(MODERATION_ACTION_LABELS[action][language]);
      // Images des pièces reçues : de simples liens, masquées ou non.
      expect(sectionHtml(page, "piecesReceived")).not.toContain("<img");
    }
  }, 60_000);

  it("l'auteur d'un signalement apprend qu'il a été traité, jamais la décision ni l'administratrice", async () => {
    const page = await readable(me);
    const text = visibleText(page);
    expect(text).toContain(REPORT_HANDLED_LABELS.post.fr);
    expect(text).toMatch(/Traité le \d/);
    for (const action of MODERATION_ACTION_TYPES) expect(text).not.toContain(MODERATION_ACTION_LABELS[action].fr);
    expect(page).not.toContain(admin.id);
    expect(page).not.toContain(admin.username);

    const english = visibleText(await readable(me, "en"));
    expect(english).toContain(REPORT_HANDLED_LABELS.post.en);
    for (const action of MODERATION_ACTION_TYPES) expect(english).not.toContain(MODERATION_ACTION_LABELS[action].en);
  }, 60_000);

  it("la personne concernée lit la décision et son motif, jamais qui l'a prise", async () => {
    const page = await readable(author);
    const text = visibleText(page);
    expect(text).toContain(MODERATION_ACTION_LABELS.hide.fr);
    expect(text).toContain("Harcèlement");
    expect(page).not.toContain(admin.id);
    expect(page).not.toContain(admin.username);
  }, 60_000);
});
