import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import reportsRoutes from "../src/routes/reports.js";
import { fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Signaler seulement ce qu'on voit (lot « corrections en ligne », fiche E2),
// SANS base : la vraie route POST /api/reports sur la fausse base
// (tests/fakeSupabase.ts). Avant, une publication, un commentaire ou un
// compte se signalait avec n'importe quel identifiant : trois comptes
// connaissant l'identifiant d'une publication « Moi seul » pouvaient la faire
// masquer (lib/autoHide.ts) sans jamais l'avoir vue. Refusé désormais avec
// la réponse d'un contenu inexistant, sans rien enregistrer ni masquer.
// Messages et collections : inchangés (messagerie*.test.ts, moderationCollections.test.ts).

const AUTHOR = "a0000000-0000-4000-8000-000000000001";
const REPORTER = "b0000000-0000-4000-8000-000000000002";
const FOLLOWER = "c0000000-0000-4000-8000-000000000003"; // suit l'autrice
const BLOCKER = "d0000000-0000-4000-8000-000000000004"; // a bloqué REPORTER
const BLOCKED = "d1000000-0000-4000-8000-000000000005"; // bloqué par REPORTER
const NO_NAME = "e0000000-0000-4000-8000-000000000006"; // profil pas encore complété
const THIRD = "f0000000-0000-4000-8000-000000000007";
const FOURTH = "f1000000-0000-4000-8000-000000000008";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const id = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POST = {
  public: id("1", 1),
  followers: id("1", 2),
  private: id("1", 3),
  hidden: id("1", 4),
  own: id("1", 5),
  byBlocker: id("1", 6),
};
const COMMENT = {
  visible: id("2", 1),
  hidden: id("2", 2),
  onPrivatePost: id("2", 3),
  byBlocker: id("2", 4),
  byBlocked: id("2", 5),
  own: id("2", 6),
};

function profile(userId: string, username: string | null): Row {
  return { id: userId, username, display_name: username ?? "Sans nom", avatar_url: null, bio: null };
}
function post(postId: string, userId: string, privacy: string, hidden = false): Row {
  return { id: postId, user_id: userId, type: "lifestyle", privacy, hidden_at: hidden ? "2026-11-02T12:00:00Z" : null, created_at: "2026-11-01T12:00:00Z" };
}
function comment(commentId: string, postId: string, userId: string, hidden = false): Row {
  return { id: commentId, post_id: postId, user_id: userId, body: "Un commentaire", hidden_at: hidden ? "2026-11-02T12:00:00Z" : null, created_at: "2026-11-01T12:00:00Z" };
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
  fake.table("profiles").push(
    profile(AUTHOR, "autrice"),
    profile(REPORTER, "temoin"),
    profile(FOLLOWER, "abonnee"),
    profile(BLOCKER, "bloqueur"),
    profile(BLOCKED, "bloque"),
    profile(NO_NAME, null),
    profile(THIRD, "troisieme"),
    profile(FOURTH, "quatrieme")
  );
  fake.table("follows").push({ follower_id: FOLLOWER, followee_id: AUTHOR, created_at: "2026-10-01T12:00:00Z" });
  fake.table("blocks").push({ blocker_id: BLOCKER, blocked_id: REPORTER }, { blocker_id: REPORTER, blocked_id: BLOCKED });
  fake.table("posts").push(
    post(POST.public, AUTHOR, "public"),
    post(POST.followers, AUTHOR, "followers"),
    post(POST.private, AUTHOR, "private"),
    post(POST.hidden, AUTHOR, "public", true),
    post(POST.own, REPORTER, "public"),
    post(POST.byBlocker, BLOCKER, "public")
  );
  fake.table("comments").push(
    comment(COMMENT.visible, POST.public, FOLLOWER),
    comment(COMMENT.hidden, POST.public, FOLLOWER, true),
    comment(COMMENT.onPrivatePost, POST.private, AUTHOR),
    comment(COMMENT.byBlocker, POST.public, BLOCKER),
    comment(COMMENT.byBlocked, POST.public, BLOCKED),
    comment(COMMENT.own, POST.public, REPORTER)
  );
  return { ...fake, rpcCalls };
}
type Fake = ReturnType<typeof seeded>;

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function reportsApp(fake: Fake): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
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

const report = (target: FastifyInstance, userId: string, targetType: "post" | "comment" | "user", targetId: string) =>
  target.inject({ method: "POST", url: "/api/reports", headers: { "x-test-user": userId }, payload: { targetType, targetId, reason: "harassment" } });

/** Refusé exactement comme un identifiant inconnu, sans rien enregistrer ni masquer. */
async function expectRefused(fake: Fake, target: FastifyInstance, userId: string, targetType: "post" | "comment" | "user", targetId: string) {
  const unknown = await report(target, userId, targetType, UNKNOWN);
  const refused = await report(target, userId, targetType, targetId);
  expect(unknown.statusCode).toBe(404);
  expect([refused.statusCode, refused.json()], `${targetType} ${targetId}`).toEqual([unknown.statusCode, unknown.json()]);
  expect(refused.json()).toEqual({ error: "target_not_found", message: "Contenu introuvable." });
  expect(fake.table("reports")).toEqual([]);
  expect(fake.rpcCalls).toEqual([]);
}

async function expectAccepted(fake: Fake, target: FastifyInstance, userId: string, targetType: "post" | "comment" | "user", targetId: string) {
  const res = await report(target, userId, targetType, targetId);
  expect(res.statusCode, `${targetType} ${targetId} : ${res.body}`).toBe(204);
  expect(fake.table("reports").some((row) => row.reporter_id === userId && row.target_type === targetType && row.target_id === targetId)).toBe(true);
}

describe("signaler une publication", () => {
  it("refusée si on ne la voit pas : « Moi seul », « Abonnés » sans être abonné, masquée, d'un compte qui vous a bloqué, ou la sienne", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    for (const postId of [POST.private, POST.followers, POST.hidden, POST.byBlocker, POST.own]) await expectRefused(fake, target, REPORTER, "post", postId);
  });

  it("trois comptes qui connaissent l'identifiant d'une publication « Moi seul » ne peuvent plus la faire masquer", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    for (const userId of [REPORTER, THIRD, FOURTH]) expect((await report(target, userId, "post", POST.private)).statusCode).toBe(404);
    expect(fake.table("reports")).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.table("posts").find((row) => row.id === POST.private)?.hidden_at).toBeNull();
  });

  it("permise quand on la voit : publique ; « Abonnés » pour une abonnée (le masquage automatique est alors consulté)", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    await expectAccepted(fake, target, REPORTER, "post", POST.public);
    await expectAccepted(fake, target, FOLLOWER, "post", POST.followers);
    expect(fake.rpcCalls.map((call) => call.args.p_target_id)).toEqual([POST.public, POST.followers]);
  });
});

describe("signaler un commentaire", () => {
  it("refusé s'il est masqué, sous une publication qu'on ne voit pas, d'un compte en blocage avec vous (dans un sens ou dans l'autre), ou le sien", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    for (const commentId of [COMMENT.hidden, COMMENT.onPrivatePost, COMMENT.byBlocker, COMMENT.byBlocked, COMMENT.own]) {
      await expectRefused(fake, target, REPORTER, "comment", commentId);
    }
  });

  it("permis quand on le lit sous la publication, y compris par l'autrice de la publication", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    await expectAccepted(fake, target, REPORTER, "comment", COMMENT.visible);
    await expectAccepted(fake, target, AUTHOR, "comment", COMMENT.visible);
  });

  it("lecture impossible : une erreur, rien d'enregistré (jamais « introuvable » à tort)", async () => {
    const fake = seeded({ missing: ["comments"] });
    const target = await reportsApp(fake);
    expect((await report(target, REPORTER, "comment", COMMENT.visible)).statusCode).toBe(500);
    expect(fake.table("reports")).toEqual([]);
  });
});

describe("signaler un compte", () => {
  it("refusé si le profil n'existe pas ou n'a pas encore de page (sans nom d'utilisateur)", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    await expectRefused(fake, target, REPORTER, "user", NO_NAME);
  });

  it("permis pour un compte existant, même en blocage : bloquer puis signaler reste possible, et l'on peut signaler qui vous a bloqué", async () => {
    const fake = seeded();
    const target = await reportsApp(fake);
    await expectAccepted(fake, target, REPORTER, "user", AUTHOR);
    await expectAccepted(fake, target, REPORTER, "user", BLOCKED);
    await expectAccepted(fake, target, REPORTER, "user", BLOCKER);
    // Un profil ne se masque jamais automatiquement.
    expect(fake.rpcCalls).toEqual([]);
  });
});
