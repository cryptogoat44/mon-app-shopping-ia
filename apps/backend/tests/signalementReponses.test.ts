import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import reportsRoutes from "../src/routes/reports.js";
import { resetPrivateAccountsProbe } from "../src/lib/audience.js";
import { resetCommentThreadsProbe } from "../src/lib/comments.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Signaler une réponse à un commentaire (migration 0046), SANS base : la
// vraie route POST /api/reports sur la fausse base (tests/fakeSupabase.ts).
// Une réponse dont le commentaire d'origine n'est pas montré à la personne
// (masqué par la modération, ou écrit par un compte en blocage avec elle,
// dans un sens ou dans l'autre) n'apparaît pas dans son fil (findShownComment,
// lib/comments.ts). La signaler répondait 204 : cela trahissait qu'elle
// existe (fiche E2 : aucune fuite d'existence), et quelques signalements la
// faisaient masquer (lib/autoHide.ts) sans qu'aucun signaleur l'ait vue.
// Désormais 404 « Contenu introuvable », sans rien enregistrer ni masquer.
// Le commentaire lui-même (masqué, sous une publication invisible, d'un compte
// en blocage, le sien) : signalementVisible.test.ts, lot « corrections en ligne ».

const AUTHOR = "a0000000-0000-4000-8000-000000000001"; // autrice de la publication (compte public)
const REPORTER = "b0000000-0000-4000-8000-000000000002";
const ROOT_AUTHOR = "c0000000-0000-4000-8000-000000000003";
const REPLIER = "c1000000-0000-4000-8000-000000000004"; // écrit les réponses, sans blocage avec personne
const BLOCKER = "d0000000-0000-4000-8000-000000000005"; // a bloqué REPORTER
const BLOCKED = "d1000000-0000-4000-8000-000000000006"; // bloqué par REPORTER
const THIRD = "f0000000-0000-4000-8000-000000000007";
const FOURTH = "f1000000-0000-4000-8000-000000000008";

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST = id("1", 1);
const OTHER_POST = id("1", 2);
/** Commentaires d'origine, tous sous POST sauf `otherPost`. */
const ROOT = { shown: id("2", 1), hidden: id("2", 2), byBlocker: id("2", 3), byBlocked: id("2", 4), otherPost: id("2", 5) };
/** Réponses de REPLIER sous POST, ni masquées ni en blocage : seul leur commentaire d'origine diffère. */
const REPLY = { underShown: id("3", 1), underHidden: id("3", 2), underBlocker: id("3", 3), underBlocked: id("3", 4), crossPost: id("3", 5) };

const TARGET_NOT_FOUND = { error: "target_not_found", message: "Contenu introuvable." };
/** Base sans la migration 0046 : ni la colonne des réponses, ni les deux tables, ni le réglage. */
const WITHOUT_0046: FakeDbOptions = { missing: ["comment_reactions", "comment_mentions"], missingColumns: { comments: ["parent_id"], profiles: ["mentions_from"] } };

function profile(userId: string): Row {
  return { id: userId, username: `membre${userId.slice(0, 2)}`, display_name: "Membre", avatar_url: null, bio: null };
}
function post(postId: string): Row {
  return { id: postId, user_id: AUTHOR, type: "lifestyle", privacy: "public", hidden_at: null, created_at: "2026-11-01T12:00:00Z" };
}
function comment(commentId: string, postId: string, userId: string, parentId: string | null, hidden = false): Row {
  return { id: commentId, post_id: postId, user_id: userId, body: "Un commentaire", parent_id: parentId, hidden_at: hidden ? "2026-11-02T12:00:00Z" : null, created_at: "2026-11-01T12:00:00Z" };
}

function seeded(options: FakeDbOptions = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const fake = fakeSupabase({
    ...options,
    rpc: async (fn, args) => {
      rpcCalls.push({ fn, args });
      return { data: [{ outcome: "below_threshold", action_id: null }], error: null };
    },
  });
  fake.table("profiles").push(...[AUTHOR, REPORTER, ROOT_AUTHOR, REPLIER, BLOCKER, BLOCKED, THIRD, FOURTH].map(profile));
  fake.table("blocks").push({ blocker_id: BLOCKER, blocked_id: REPORTER }, { blocker_id: REPORTER, blocked_id: BLOCKED });
  fake.table("posts").push(post(POST), post(OTHER_POST));
  const rows = [
    comment(ROOT.shown, POST, ROOT_AUTHOR, null),
    comment(ROOT.hidden, POST, ROOT_AUTHOR, null, true),
    comment(ROOT.byBlocker, POST, BLOCKER, null),
    comment(ROOT.byBlocked, POST, BLOCKED, null),
    comment(ROOT.otherPost, OTHER_POST, ROOT_AUTHOR, null),
    comment(REPLY.underShown, POST, REPLIER, ROOT.shown),
    comment(REPLY.underHidden, POST, REPLIER, ROOT.hidden),
    comment(REPLY.underBlocker, POST, REPLIER, ROOT.byBlocker),
    comment(REPLY.underBlocked, POST, REPLIER, ROOT.byBlocked),
    // Impossible dans la vraie base (une réponse reste sous la publication de
    // son commentaire d'origine) ; le fil la cache quand même.
    comment(REPLY.crossPost, POST, REPLIER, ROOT.otherPost),
  ];
  // Base sans 0046 : la colonne des réponses n'existe pas, tout est à plat.
  if ((options.missingColumns?.comments ?? []).includes("parent_id")) for (const row of rows) delete row.parent_id;
  fake.table("comments").push(...rows);
  return { ...fake, rpcCalls };
}
type Fake = ReturnType<typeof seeded>;

let app: FastifyInstance | null = null;
beforeEach(() => {
  resetCommentThreadsProbe();
  resetPrivateAccountsProbe();
});
afterEach(async () => {
  await app?.close();
  app = null;
});

async function reportsApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.headers["x-test-user"];
    if (typeof userId !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id: userId, email: `${userId.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(reportsRoutes);
  await app.ready();
  return app;
}

const report = (target: FastifyInstance, userId: string, commentId: string) =>
  target.inject({ method: "POST", url: "/api/reports", headers: { "x-test-user": userId }, payload: { targetType: "comment", targetId: commentId, reason: "harassment" } });

async function expectRefused(target: FastifyInstance, userId: string, commentId: string) {
  const res = await report(target, userId, commentId);
  expect([res.statusCode, res.body === "" ? "" : res.json()], commentId).toEqual([404, TARGET_NOT_FOUND]);
}

async function expectAccepted(fake: Fake, target: FastifyInstance, userId: string, commentId: string) {
  const res = await report(target, userId, commentId);
  expect(res.statusCode, `${commentId} : ${res.body}`).toBe(204);
  expect(fake.table("reports").some((row) => row.reporter_id === userId && row.target_type === "comment" && row.target_id === commentId)).toBe(true);
}

describe("signaler une réponse à un commentaire", () => {
  it("refusée si son commentaire d'origine est masqué, ou écrit par un compte en blocage avec vous (dans un sens ou dans l'autre) : rien d'enregistré ni de masqué", async () => {
    const fake = seeded();
    const target = await reportsApp(fake.db);
    for (const replyId of [REPLY.underHidden, REPLY.underBlocker, REPLY.underBlocked]) await expectRefused(target, REPORTER, replyId);
    expect(fake.table("reports")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refusée si elle est rattachée au commentaire d'une autre publication", async () => {
    const fake = seeded();
    const target = await reportsApp(fake.db);
    await expectRefused(target, REPORTER, REPLY.crossPost);
    expect(fake.table("reports")).toEqual([]);
  });

  it("trois comptes qui connaissent l'identifiant d'une réponse sous un commentaire masqué ne peuvent pas la faire masquer", async () => {
    const fake = seeded();
    const target = await reportsApp(fake.db);
    for (const userId of [REPORTER, THIRD, FOURTH]) await expectRefused(target, userId, REPLY.underHidden);
    expect(fake.table("reports")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.table("comments").find((row) => row.id === REPLY.underHidden)?.hidden_at).toBeNull();
  });

  it("permise quand son commentaire d'origine est montré (le masquage automatique est alors consulté) ; un blocage ne compte que pour les deux comptes en blocage", async () => {
    const fake = seeded();
    const target = await reportsApp(fake.db);
    await expectAccepted(fake, target, REPORTER, REPLY.underShown);
    await expectAccepted(fake, target, THIRD, REPLY.underBlocker);
    await expectAccepted(fake, target, THIRD, REPLY.underBlocked);
    expect(fake.rpcCalls.map((call) => call.args.p_target_id)).toEqual([REPLY.underShown, REPLY.underBlocker, REPLY.underBlocked]);
  });

  it("un commentaire d'origine se signale comme avant ; signaler deux fois, ou une réponse après son commentaire d'origine, reste permis", async () => {
    const fake = seeded();
    const target = await reportsApp(fake.db);
    await expectAccepted(fake, target, REPORTER, ROOT.shown);
    await expectAccepted(fake, target, REPORTER, REPLY.underShown);
    await expectAccepted(fake, target, REPORTER, REPLY.underShown);
    expect(fake.table("reports").map((row) => row.target_id)).toEqual([ROOT.shown, REPLY.underShown, REPLY.underShown]);
  });

  it("base sans la migration 0046 : tout est à plat, un commentaire se signale comme avant", async () => {
    const fake = seeded(WITHOUT_0046);
    const target = await reportsApp(fake.db);
    // Sans la colonne des réponses, ces lignes sont de simples commentaires visibles.
    await expectAccepted(fake, target, REPORTER, REPLY.underHidden);
    await expectAccepted(fake, target, REPORTER, ROOT.shown);
  });

  it("schéma des réponses illisible : une erreur, rien d'enregistré (jamais « à plat » par défaut)", async () => {
    const fake = seeded();
    const broken = Promise.resolve({ data: null, error: { code: "57014", message: "délai dépassé" } });
    const real = fake.db as { from: (name: string) => unknown };
    const db = { ...real, from: (name: string) => (name === "comment_reactions" ? { select: () => ({ limit: () => broken }) } : real.from(name)) };
    const target = await reportsApp(db);
    expect((await report(target, REPORTER, REPLY.underHidden)).statusCode).toBe(500);
    expect(fake.table("reports")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("lecture des blocages impossible : une erreur, rien d'enregistré (jamais « montré » par défaut)", async () => {
    const fake = seeded({ missing: ["blocks"] });
    const target = await reportsApp(fake.db);
    expect((await report(target, REPORTER, REPLY.underShown)).statusCode).toBe(500);
    expect(fake.table("reports")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });
});
