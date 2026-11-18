import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, InjectOptions } from "fastify";
import { createClient } from "@supabase/supabase-js";
import type { AppNotification, FeedPage, MemberPage, Profile, UserProfile } from "@monapp/shared-types";
import { env } from "../src/env.js";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

// Compte privé et demandes d'abonnement (lot « vie sociale », migration
// 0045), sur la vraie base de développement (spotto-dev-2, sur le Mac du
// fondateur) : le vrai SQL de 0045 (colonne, table, clé d'une demande,
// cascade, types de notification acceptés) derrière les vraies routes.
// Sauté tant que 0045 n'est pas appliquée sur la base des tests. Les règles
// elles-mêmes, cas par cas : comptePrive.test.ts (hors base).

const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false } });
const [column, table] = await Promise.all([service.from("profiles").select("is_private").limit(0), service.from("follow_requests").select("requester_id").limit(0)]);
const migrated = !column.error && !table.error;

describe.skipIf(!migrated)("compte privé, sur la base de développement (0045)", () => {
  let app: FastifyInstance;
  let alice: TestUser; // compte privé
  let bruno: TestUser; // abonné d'avant
  let chloe: TestUser; // demande, acceptée
  let dan: TestUser; // demande, refusée, puis bloqué
  let eve: TestUser; // demande, puis son compte est supprimé
  let postId = "";

  const request = (user: TestUser, method: InjectOptions["method"], url: string, payload?: object) =>
    app.inject({ method, url, headers: authHeaders(user.token), ...(payload ? { payload } : {}) });
  const requestsTo = async (target: TestUser): Promise<string[]> => {
    const { data, error } = await app.supabaseAdmin.from("follow_requests").select("requester_id").eq("target_id", target.id);
    if (error) throw error;
    return (data ?? []).map((row) => row.requester_id as string).sort();
  };
  const followersOf = async (target: TestUser): Promise<string[]> => {
    const { data, error } = await app.supabaseAdmin.from("follows").select("follower_id").eq("followee_id", target.id);
    if (error) throw error;
    return (data ?? []).map((row) => row.follower_id as string).sort();
  };
  const notifications = async (user: TestUser): Promise<AppNotification[]> => (await request(user, "GET", "/api/notifications?v=2")).json();
  const profileSeenBy = async (viewer: TestUser): Promise<UserProfile> => (await request(viewer, "GET", `/api/users/${alice.id}`)).json();

  beforeAll(async () => {
    app = await buildTestApp();
    const users = await Promise.all(["cpa", "cpb", "cpc", "cpd", "cpe"].map((label) => createTestUser(app, label)));
    [alice, bruno, chloe, dan, eve] = users as [TestUser, TestUser, TestUser, TestUser, TestUser];
    // Une publication « Public » d'Alice, écrite directement (aucune image).
    const { data, error } = await app.supabaseAdmin.from("posts").insert({ user_id: alice.id, type: "lifestyle", caption: "Compte privé", privacy: "public" }).select("id").single();
    if (error || !data) throw error ?? new Error("Publication de test non créée.");
    postId = data.id as string;
    expect((await request(bruno, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "following" });
  }, 120_000);

  afterAll(async () => {
    for (const user of [alice, bruno, chloe, dan, eve]) if (user) await deleteTestUser(app, user.id);
    await app?.close();
  }, 120_000);

  it("un nouveau compte est public ; passer en privé garde les abonnés et ferme les publications aux inconnus", async () => {
    expect(((await request(alice, "GET", "/api/me")).json() as Profile).isPrivate).toBe(false);
    expect((await request(chloe, "GET", `/api/posts/${postId}`)).statusCode).toBe(200);

    expect((await request(alice, "PUT", "/api/me/private-account", { isPrivate: true })).statusCode).toBe(204);
    expect((await request(alice, "GET", "/api/me")).json()).toMatchObject({ isPrivate: true, followRequestsCount: 0, followersCount: 1 });
    expect(await followersOf(alice)).toEqual([bruno.id]);
    expect((await request(chloe, "GET", `/api/posts/${postId}`)).statusCode).toBe(404);
    expect((await request(bruno, "GET", `/api/posts/${postId}`)).statusCode).toBe(200);
    expect(await profileSeenBy(chloe)).toMatchObject({ isPrivate: true, postsCount: 0, followState: "none", followersCount: 1 });
    expect(((await request(chloe, "GET", `/api/users/${alice.id}/posts`)).json() as FeedPage).posts).toEqual([]);
  });

  it("demande → aucun accès → acceptée → accès, avec les notifications des deux côtés", async () => {
    expect((await request(chloe, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    // La même demande deux fois : une seule ligne (clé primaire), une seule notification.
    expect((await request(chloe, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    expect(await requestsTo(alice)).toEqual([chloe.id]);
    expect((await notifications(alice)).filter((n) => n.type === "follow_request").map((n) => n.actor?.id)).toEqual([chloe.id]);
    expect((await request(chloe, "GET", `/api/posts/${postId}`)).statusCode).toBe(404);
    expect(await profileSeenBy(chloe)).toMatchObject({ followState: "requested", isFollowing: false, postsCount: 0 });

    const page: MemberPage = (await request(alice, "GET", "/api/follow-requests")).json();
    expect(page.members.map((member) => member.id)).toEqual([chloe.id]);
    expect((await request(alice, "POST", `/api/follow-requests/${chloe.id}/accept`)).statusCode).toBe(204);
    expect(await requestsTo(alice)).toEqual([]);
    expect(await followersOf(alice)).toEqual([bruno.id, chloe.id].sort());
    expect((await request(chloe, "GET", `/api/posts/${postId}`)).statusCode).toBe(200);
    expect((await notifications(chloe)).map((n) => [n.type, n.actor?.id])).toEqual([["follow_accepted", alice.id]]);
    expect((await notifications(alice)).some((n) => n.type === "follow_request")).toBe(false);
    // Une app d'avant ne reçoit pas le nouveau type.
    expect((await request(chloe, "GET", "/api/notifications")).json()).toEqual([]);
  });

  it("une ancienne app (sans « v=2 ») ne peut pas demander : 403, rien d'écrit", async () => {
    const res = await request(dan, "POST", `/api/follows/${alice.id}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("private_account_update_required");
    expect(await requestsTo(alice)).toEqual([]);
  });

  it("refuser efface la ligne et la notification ; la personne n'apprend rien", async () => {
    expect((await request(dan, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    expect((await request(alice, "DELETE", `/api/follow-requests/${dan.id}`)).statusCode).toBe(204);
    expect(await requestsTo(alice)).toEqual([]);
    expect((await notifications(alice)).some((n) => n.type === "follow_request")).toBe(false);
    expect(await notifications(dan)).toEqual([]);
    expect(await profileSeenBy(dan)).toMatchObject({ followState: "none", postsCount: 0 });
    expect(await followersOf(alice)).not.toContain(dan.id);
  });

  it("bloquer efface les demandes entre les deux comptes ; un compte bloqué ne peut plus demander", async () => {
    expect((await request(dan, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    expect((await request(alice, "POST", `/api/blocks/${dan.id}`)).statusCode).toBe(204);
    expect(await requestsTo(alice)).toEqual([]);
    expect((await request(dan, "POST", `/api/follows/${alice.id}?v=2`)).statusCode).toBe(403);
    expect((await request(alice, "DELETE", `/api/blocks/${dan.id}`)).statusCode).toBe(204);
  });

  it("la base refuse une demande à soi-même et un type de notification inconnu", async () => {
    const self = await app.supabaseAdmin.from("follow_requests").insert({ requester_id: alice.id, target_id: alice.id });
    expect(self.error?.code).toBe("23514");
    const unknown = await app.supabaseAdmin.from("notifications").insert({ user_id: alice.id, actor_id: bruno.id, type: "type_inconnu" });
    expect(unknown.error?.code).toBe("23514");
    // Les types réservés aux lots suivants (0046, 0047) sont déjà acceptés.
    for (const type of ["reply", "mention", "tag"]) {
      const inserted = await app.supabaseAdmin.from("notifications").insert({ user_id: alice.id, actor_id: bruno.id, type }).select("id").single();
      expect(inserted.error, type).toBeNull();
      await app.supabaseAdmin.from("notifications").delete().eq("id", inserted.data!.id as string);
    }
  });

  it("les demandes sont fermées au public : ni un visiteur ni un compte connecté ne les lit par l'API de la base", async () => {
    expect((await request(eve, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    const asVisitor = await anon.from("follow_requests").select("requester_id");
    expect(asVisitor.data ?? []).toEqual([]);
    const asMember = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${alice.token}` } } });
    const read = await asMember.from("follow_requests").select("requester_id");
    expect(read.data ?? []).toEqual([]);
  });

  it("supprimer le compte du demandeur efface sa demande et sa notification (cascade)", async () => {
    expect(await requestsTo(alice)).toEqual([eve.id]);
    await deleteTestUser(app, eve.id);
    expect(await requestsTo(alice)).toEqual([]);
    expect((await notifications(alice)).some((n) => n.type === "follow_request")).toBe(false);
    expect(((await request(alice, "GET", "/api/me")).json() as Profile).followRequestsCount).toBe(0);
  });

  it("repasser en public efface les demandes en attente et ne crée aucun abonnement", async () => {
    expect((await request(dan, "POST", `/api/follows/${alice.id}?v=2`)).json()).toEqual({ state: "requested" });
    const before = await followersOf(alice);
    expect((await request(alice, "PUT", "/api/me/private-account", { isPrivate: false })).statusCode).toBe(204);
    expect(await requestsTo(alice)).toEqual([]);
    expect(await followersOf(alice)).toEqual(before);
    expect((await notifications(alice)).some((n) => n.type === "follow_request")).toBe(false);
    expect(await profileSeenBy(dan)).toMatchObject({ isPrivate: false, followState: "none", postsCount: 1 });
    expect((await request(dan, "GET", `/api/posts/${postId}`)).statusCode).toBe(200);
  });
});
