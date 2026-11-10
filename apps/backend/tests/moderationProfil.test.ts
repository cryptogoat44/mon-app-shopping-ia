import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODERATION_ACTION_TYPES, REPORT_REASONS, type AppNotification, type ConversationsPage, type ModerationItem, type ModerationPage, type UserProfile } from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import moderationRoutes from "../src/routes/moderation.js";
import notificationsRoutes from "../src/routes/notifications.js";
import usersRoutes from "../src/routes/users.js";
import blocksRoutes from "../src/routes/blocks.js";
import conversationsRoutes from "../src/routes/conversations.js";
import { resetMessagesProbe } from "../src/lib/messaging.js";
import { AVATAR_BUCKET, profileModerationReady, resetProfileModerationProbe, withoutSuspendedFaces } from "../src/lib/profileModeration.js";
import { STORAGE_ATTEMPTS } from "../src/lib/storage.js";
import { MODERATION_ACTION_LABELS } from "../src/lib/exportText.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Modération des profils (lot « conformité Apple », migration 0037 ; règle
// 1.2 d'Apple), SANS base ni réseau : les vraies routes sur une fausse base
// en mémoire (tests/fakeSupabase.ts). La fonction de la base
// (moderation_remove_profile_part) est imitée ici, au plus près du SQL de
// 0037 ; le vrai SQL est essayé par moderationProfilBase.test.ts (sur le Mac,
// une fois 0037 appliquée sur spotto-dev-2). Aussi : la bio et la photo d'un
// compte suspendu, cachées aux autres membres (sans migration).

const ALICE = "a0000000-0000-4000-8000-000000000001"; // profil signalé
const BOB = "b0000000-0000-4000-8000-000000000002"; // signale Alice
const CHLOE = "c0000000-0000-4000-8000-000000000003"; // signale aussi
const ADMIN = "ad000000-0000-4000-8000-000000000006";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const BIO = "Bio qui ne respecte pas les règles";
const AVATAR_PATH = `${ALICE}/avatar-1234.jpg`;
const AVATAR_URL = `${STORAGE_ORIGIN}/storage/v1/object/public/${AVATAR_BUCKET}/${AVATAR_PATH}`;
const ROUTE = "/api/admin/moderation/remove-profile-part";

function profile(id: string, username: string, extra: Row = {}): Row {
  return { id, username, display_name: username[0]!.toUpperCase() + username.slice(1), avatar_url: null, bio: null, messages_from: "everyone", piece_sends_from: "following", ...extra };
}

let tick = 0;
function stamp(): string {
  tick += 1;
  return new Date(Date.now() + tick * 1000).toISOString();
}

type Fake = ReturnType<typeof fakeSupabase>;
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

/** La file et la fonction de 0037, imitées sur la fausse base : mêmes refus
 * et même ordre que le SQL (rôle, entrées, profil, rien à retirer, journal,
 * profil vidé, personne prévenue, signalements classés). `with0037` faux :
 * la fonction est absente, comme sur une base sans la migration. */
function moderationRpc(getFake: () => Fake, calls: { fn: string; args: Record<string, unknown> }[], with0037: boolean) {
  const t = (name: string) => getFake().table(name);
  const refuse = (outcome: string): RpcResult => ({ data: [{ outcome, action_id: null }], error: null });
  const notify = (userId: unknown, type: "moderation" | "report_handled", actionId: string) =>
    t("notifications").push({ id: randomUUID(), user_id: userId, actor_id: null, type, post_id: null, moderation_action_id: actionId, read_at: null, hidden_at: null, created_at: stamp() });
  return async (fn: string, args: Record<string, unknown>): Promise<RpcResult> => {
    calls.push({ fn, args });
    if (fn === "moderation_queue") {
      const handled = args.p_handled === true;
      const groups = new Map<string, Row[]>();
      for (const report of t("reports")) {
        if ((report.handled_at !== null) !== handled) continue;
        const key = `${report.target_type}:${report.target_id}`;
        groups.set(key, [...(groups.get(key) ?? []), report]);
      }
      const rows = [...groups.values()].map((reports) => {
        const dates = reports.map((r) => String(r.created_at)).sort();
        const reasons: Record<string, number> = {};
        for (const r of reports) reasons[String(r.reason)] = (reasons[String(r.reason)] ?? 0) + 1;
        return { target_type: reports[0]!.target_type, target_id: reports[0]!.target_id, report_count: reports.length, reasons, notes: [], first_at: dates[0], last_at: dates.at(-1) };
      });
      return { data: rows, error: null };
    }
    if (fn === "moderation_remove_profile_part" && with0037) {
      const { p_admin_id: admin, p_user_id: user, p_part: part, p_reason: reason } = args;
      if (admin === null || !t("admins").some((row) => row.user_id === admin)) return refuse("not_admin");
      if (!["bio", "avatar"].includes(String(part)) || !(REPORT_REASONS as readonly string[]).includes(String(reason))) return refuse("invalid");
      const row = t("profiles").find((p) => p.id === user);
      if (!row) return refuse("target_not_found");
      const bio = typeof row.bio === "string" ? row.bio.trim() : "";
      if ((part === "bio" && bio === "") || (part === "avatar" && (row.avatar_url ?? null) === null)) return refuse("nothing_to_remove");
      const actionId = randomUUID();
      const note = typeof args.p_note === "string" && args.p_note.trim() ? args.p_note.trim() : null;
      t("moderation_actions").push({
        id: actionId,
        admin_id: admin,
        action: part === "bio" ? "remove_bio" : "remove_avatar",
        target_type: "user",
        target_id: user,
        target_user_id: user,
        reason,
        note,
        undoes_action_id: null,
        automatic: false,
        created_at: stamp(),
      });
      if (part === "bio") row.bio = null;
      else row.avatar_url = null;
      notify(user, "moderation", actionId);
      const reporters = new Set<unknown>();
      for (const report of t("reports")) {
        if (report.target_type !== "user" || report.target_id !== user || report.handled_at !== null) continue;
        Object.assign(report, { handled_at: stamp(), moderation_action_id: actionId });
        reporters.add(report.reporter_id);
      }
      for (const reporter of reporters) notify(reporter, "report_handled", actionId);
      return { data: [{ outcome: "ok", action_id: actionId }], error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "absente" } };
  };
}

interface World {
  fake: Fake;
  app: FastifyInstance;
  calls: { fn: string; args: Record<string, unknown> }[];
  lines: string[];
}

let current: FastifyInstance | null = null;

/** Alice a une bio et une photo (un fichier dans son dossier du stockage) ;
 * Bob et Chloé ont signalé son profil ; un administrateur. Les vraies
 * routes, un compte par en-tête, le vrai journal du serveur. */
async function world({ with0037 = true, ...options }: FakeDbOptions & { with0037?: boolean } = {}): Promise<World> {
  const calls: World["calls"] = [];
  const lines: string[] = [];
  let fake: Fake | null = null;
  fake = fakeSupabase({ rpc: moderationRpc(() => fake!, calls, with0037), ...options });
  fake.table("profiles").push(profile(ALICE, "alice", { bio: BIO, avatar_url: AVATAR_URL }), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(ADMIN, "admin"));
  fake.table("admins").push({ user_id: ADMIN });
  fake.files.set(`${AVATAR_BUCKET}/${AVATAR_PATH}`, Buffer.from("photo"));
  for (const reporter of [BOB, CHLOE]) {
    fake.table("reports").push({ id: randomUUID(), reporter_id: reporter, target_type: "user", target_id: ALICE, reason: "inappropriate", note: null, handled_at: null, moderation_action_id: null, created_at: stamp() });
  }
  const app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => void lines.push(line) },
      serializers: { req: requestLogFields },
      formatters: { log: withoutErrorDetails },
      hooks: { streamWrite: scrubLogLine },
    },
  });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const id = request.headers["x-test-user"];
    if (typeof id !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton d'authentification manquant." });
    request.user = { id, email: `${id.slice(0, 4)}@example.com` };
  });
  await app.register(rateLimitPlugin);
  await app.register(moderationPlugin);
  await app.register(moderationRoutes);
  await app.register(notificationsRoutes);
  await app.register(usersRoutes);
  await app.register(blocksRoutes);
  await app.register(conversationsRoutes);
  await app.ready();
  current = app;
  return { fake, app, calls, lines };
}

function as(app: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => app.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
  };
}

async function queueItem(app: FastifyInstance, status: "open" | "handled" = "open"): Promise<ModerationItem | undefined> {
  const res = await as(app, ADMIN).get(`/api/admin/moderation?status=${status}`);
  expect(res.statusCode).toBe(200);
  return (res.json() as ModerationPage).items.find((item) => item.targetType === "user" && item.targetId === ALICE);
}

const removalCalls = (calls: World["calls"]) => calls.filter((call) => call.fn === "moderation_remove_profile_part" && call.args.p_admin_id === ADMIN);

beforeEach(() => {
  resetProfileModerationProbe();
  resetMessagesProbe();
});

afterEach(async () => {
  await current?.close();
  current = null;
});

describe("sans la migration 0037 : rien n'est proposé, rien n'est touché", () => {
  it("la file ne propose ni « Retirer la bio » ni « Retirer la photo de profil », et le reste de la file marche comme avant", async () => {
    const { app } = await world({ with0037: false });
    const item = await queueItem(app);
    expect(item).toMatchObject({ reportCount: 2, canRemoveBio: false, canRemoveAvatar: false, canRemoveImage: false });
    expect(item!.preview).toMatchObject({ kind: "user", bio: BIO, author: { avatarUrl: AVATAR_URL } });
  });

  it("la route répond « indisponible » sans effacer le fichier ni changer le profil", async () => {
    const { fake, app } = await world({ with0037: false });
    for (const part of ["bio", "avatar"]) {
      const res = await as(app, ADMIN).post(ROUTE, { userId: ALICE, part, reason: "inappropriate" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "profile_moderation_unavailable", message: "Le retrait d'une bio ou d'une photo de profil n'est pas encore disponible." });
    }
    expect(fake.removed).toEqual([]);
    expect(fake.files.has(`${AVATAR_BUCKET}/${AVATAR_PATH}`)).toBe(true);
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ bio: BIO, avatar_url: AVATAR_URL });
    expect(fake.table("moderation_actions")).toEqual([]);
  });

  it("la sonde : absente, un seul appel puis rien pendant 5 minutes ; présente, mémorisée ; elle n'écrit rien", async () => {
    const missing = await world({ with0037: false });
    let now = 1_000_000;
    expect(await profileModerationReady(missing.app, () => now)).toBe(false);
    expect(await profileModerationReady(missing.app, () => now)).toBe(false);
    expect(missing.calls.filter((call) => call.fn === "moderation_remove_profile_part")).toHaveLength(1);
    now += 5 * 60_000;
    expect(await profileModerationReady(missing.app, () => now)).toBe(false);
    expect(missing.calls.filter((call) => call.fn === "moderation_remove_profile_part")).toHaveLength(2);
    expect(missing.lines.join("\n")).toContain("migration 0037 absente");

    resetProfileModerationProbe();
    const ready = await world();
    expect(await profileModerationReady(ready.app)).toBe(true);
    expect(await profileModerationReady(ready.app)).toBe(true);
    const probes = ready.calls.filter((call) => call.fn === "moderation_remove_profile_part");
    expect(probes).toHaveLength(1);
    // Appelée sans administrateur : la fonction refuse avant toute écriture.
    expect(probes[0]!.args).toMatchObject({ p_admin_id: "00000000-0000-0000-0000-000000000000", p_reason: null });
    expect(ready.fake.table("moderation_actions")).toEqual([]);
    expect(ready.fake.table("notifications")).toEqual([]);
  });
});

describe("retirer la bio d'un profil (0037)", () => {
  it("la file le propose pour un profil signalé qui a une bio", async () => {
    const { fake, app } = await world();
    expect(await queueItem(app)).toMatchObject({ canRemoveBio: true, canRemoveAvatar: true });
    Object.assign(fake.table("profiles").find((p) => p.id === ALICE)!, { bio: "   ", avatar_url: null });
    expect(await queueItem(app)).toMatchObject({ canRemoveBio: false, canRemoveAvatar: false });
  });

  it("la bio est vidée, la décision est au journal avec son motif, la personne est prévenue, les signalements sont classés", async () => {
    const { fake, app } = await world();
    const res = await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "bio", reason: "harassment", note: "  Propos visant une personne.  " });
    expect(res.statusCode).toBe(200);
    const { actionId } = res.json() as { actionId: string };
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ bio: null, avatar_url: AVATAR_URL });
    expect(fake.table("moderation_actions")).toEqual([
      expect.objectContaining({ id: actionId, admin_id: ADMIN, action: "remove_bio", target_type: "user", target_id: ALICE, target_user_id: ALICE, reason: "harassment", note: "Propos visant une personne." }),
    ]);
    // La photo n'est pas touchée : aucun fichier effacé.
    expect(fake.removed).toEqual([]);
    expect(fake.table("reports").every((report) => report.handled_at !== null && report.moderation_action_id === actionId)).toBe(true);

    // Alice apprend la décision, son motif et la précision ; jamais qui l'a prise.
    const mine: AppNotification[] = (await as(app, ALICE).get("/api/notifications")).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: "moderation", actor: null, moderation: { action: "remove_bio", targetType: "user", reason: "harassment", note: "Propos visant une personne." } });
    expect(JSON.stringify(mine)).not.toContain(ADMIN);
    // Bob apprend seulement que son signalement est traité.
    const bobs: AppNotification[] = (await as(app, BOB).get("/api/notifications")).json();
    expect(bobs).toEqual([expect.objectContaining({ type: "report_handled", reportedType: "user", moderation: null })]);

    // Dans la file « traités » : la décision et son auteur, plus rien à retirer.
    const handled = await queueItem(app, "handled");
    expect(handled).toMatchObject({ canRemoveBio: false, canRemoveAvatar: true, preview: { kind: "user", bio: null } });
    expect(handled!.history).toEqual([expect.objectContaining({ id: actionId, action: "remove_bio", reason: "harassment", adminUsername: "admin", automatic: false })]);
  });

  it("une seconde fois : « rien à retirer », sans nouvelle décision ni nouvelle notification", async () => {
    const { fake, app } = await world();
    expect((await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "bio", reason: "spam" })).statusCode).toBe(200);
    const again = await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "bio", reason: "spam" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: "nothing_to_remove" });
    expect(fake.table("moderation_actions")).toHaveLength(1);
    expect(fake.table("notifications").filter((n) => n.user_id === ALICE)).toHaveLength(1);
  });

  it("refus : sans motif, partie inconnue, profil inconnu, et la route n'existe pas pour un autre compte", async () => {
    const { fake, app, calls } = await world();
    for (const payload of [{ userId: ALICE, part: "bio" }, { userId: ALICE, part: "username", reason: "spam" }, { userId: "pas-un-identifiant", part: "bio", reason: "spam" }, { userId: ALICE, part: "bio", reason: "image_rights" }]) {
      const res = await as(app, ADMIN).post(ROUTE, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "invalid_body" });
    }
    const unknown = await as(app, ADMIN).post(ROUTE, { userId: UNKNOWN, part: "bio", reason: "spam" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: "target_not_found" });
    const stranger = await as(app, BOB).post(ROUTE, { userId: ALICE, part: "bio", reason: "spam" });
    expect(stranger.statusCode).toBe(404);
    expect(stranger.json()).toEqual({ error: "not_found", message: "Page introuvable." });
    expect((await app.inject({ method: "POST", url: ROUTE, payload: { userId: ALICE, part: "bio", reason: "spam" } })).statusCode).toBe(401);
    expect(removalCalls(calls).filter((call) => call.args.p_user_id === ALICE)).toEqual([]);
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ bio: BIO });
  });

  it("le journal du serveur ne contient ni la bio, ni la précision, ni l'adresse de la photo", async () => {
    const { app, lines } = await world();
    expect((await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "bio", reason: "other", note: "Précision confidentielle" })).statusCode).toBe(200);
    expect((await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "avatar", reason: "other" })).statusCode).toBe(200);
    const journal = lines.join("\n");
    expect(journal).toContain("Retrait d'une bio");
    expect(journal).toContain("Retrait d'une photo de profil");
    for (const secret of [BIO, "Précision confidentielle", AVATAR_PATH, AVATAR_URL]) expect(journal).not.toContain(secret);
  });
});

describe("retirer la photo d'un profil (0037)", () => {
  it("le fichier est effacé du stockage AVANT la décision, puis l'adresse est vidée et la personne prévenue", async () => {
    const { fake, app, calls } = await world();
    // Un ancien fichier resté dans son dossier part aussi (comme « Supprimer ma photo »).
    fake.files.set(`${AVATAR_BUCKET}/${ALICE}/avatar.jpg`, Buffer.from("ancienne"));
    fake.files.set(`${AVATAR_BUCKET}/${BOB}/avatar-9.jpg`, Buffer.from("celle de Bob"));
    const res = await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "avatar", reason: "inappropriate" });
    expect(res.statusCode).toBe(200);
    expect([...fake.removed].sort()).toEqual([`${AVATAR_BUCKET}/${AVATAR_PATH}`, `${AVATAR_BUCKET}/${ALICE}/avatar.jpg`].sort());
    expect(fake.files.has(`${AVATAR_BUCKET}/${BOB}/avatar-9.jpg`)).toBe(true);
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ avatar_url: null, bio: BIO });
    expect(fake.table("moderation_actions")).toEqual([expect.objectContaining({ action: "remove_avatar", target_type: "user", target_id: ALICE, reason: "inappropriate", note: null })]);
    expect(removalCalls(calls)).toHaveLength(1);
    const mine: AppNotification[] = (await as(app, ALICE).get("/api/notifications")).json();
    expect(mine[0]).toMatchObject({ type: "moderation", moderation: { action: "remove_avatar", targetType: "user", reason: "inappropriate", note: null } });
    expect(await queueItem(app, "handled")).toMatchObject({ canRemoveBio: true, canRemoveAvatar: false, preview: { author: { avatarUrl: null } } });
  });

  it("le stockage refuse : 3 essais, refus expliqué, et rien n'est changé (profil, journal, personne prévenue, signalements)", async () => {
    let attempts = 0;
    const { fake, app, calls } = await world({ failStorageRemove: () => (attempts += 1) > 0 });
    const res = await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "avatar", reason: "inappropriate" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "storage_failed", message: expect.stringContaining("rien n'a été changé") });
    expect(attempts).toBe(STORAGE_ATTEMPTS);
    expect(removalCalls(calls)).toEqual([]);
    expect(fake.files.has(`${AVATAR_BUCKET}/${AVATAR_PATH}`)).toBe(true);
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ avatar_url: AVATAR_URL });
    expect(fake.table("moderation_actions")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
    expect(fake.table("reports").every((report) => report.handled_at === null)).toBe(true);
  });

  it("un retrait ne s'annule pas : la décision n'est ni un masquage ni une suspension", async () => {
    const { app } = await world();
    const { actionId } = (await as(app, ADMIN).post(ROUTE, { userId: ALICE, part: "avatar", reason: "spam" })).json() as { actionId: string };
    // moderation_undo (0026) n'est pas imitée ici : absente, la route répond 500 ;
    // le vrai SQL (« target_not_found ») est essayé par moderationProfilBase.test.ts.
    expect((await as(app, ADMIN).post(`/api/admin/moderation/actions/${actionId}/undo`, {})).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("compte suspendu : sa bio et sa photo ne sont plus montrées aux autres membres (sans migration)", () => {
  const suspend = (fake: Fake, userId: string) => fake.table("suspensions").push({ user_id: userId, moderation_action_id: randomUUID(), created_at: stamp() });

  it("sa page de profil : ni bio ni photo pour les autres, tout pour lui-même ; la suspension levée, elles reviennent", async () => {
    const { fake, app } = await world({ with0037: false });
    const seenBy = async (viewer: string): Promise<UserProfile> => (await as(app, viewer).get(`/api/users/${ALICE}`)).json();
    expect(await seenBy(BOB)).toMatchObject({ username: "alice", bio: BIO, avatarUrl: AVATAR_URL });
    suspend(fake, ALICE);
    expect(await seenBy(BOB)).toMatchObject({ username: "alice", displayName: "Alice", bio: null, avatarUrl: null, isMe: false });
    expect(await seenBy(ALICE)).toMatchObject({ bio: BIO, avatarUrl: AVATAR_URL, isMe: true });
    // Rien n'est effacé : ni le profil, ni le fichier.
    expect(fake.table("profiles").find((p) => p.id === ALICE)).toMatchObject({ bio: BIO, avatar_url: AVATAR_URL });
    expect(fake.removed).toEqual([]);
    fake.tables.set("suspensions", []);
    expect(await seenBy(BOB)).toMatchObject({ bio: BIO, avatarUrl: AVATAR_URL });
  });

  it("l'administrateur voit toujours la bio et la photo dans la file, pour décider", async () => {
    const { fake, app } = await world();
    suspend(fake, ALICE);
    const item = await queueItem(app);
    expect(item!.preview).toMatchObject({ kind: "user", bio: BIO, author: { avatarUrl: AVATAR_URL, suspended: true } });
    expect(item).toMatchObject({ canRemoveBio: true, canRemoveAvatar: true });
  });

  it("ailleurs aussi : liste des conversations et comptes bloqués, sans sa photo", async () => {
    const { fake, app } = await world({ with0037: false });
    const conversationId = randomUUID();
    const [low, high] = [ALICE, BOB].sort() as [string, string];
    fake.table("conversations").push({ id: conversationId, user_low: low, user_high: high, last_message_id: null, last_sender_id: null, last_message_at: stamp(), created_at: stamp() });
    for (const [user, other] of [[ALICE, BOB], [BOB, ALICE]] as const) {
      fake.table("conversation_participants").push({ conversation_id: conversationId, user_id: user, other_user_id: other, invitation: "none", invitation_at: null, unread: false, last_read_at: null, cleared_at: null, last_message_at: stamp(), created_at: stamp() });
    }
    fake.table("blocks").push({ blocker_id: CHLOE, blocked_id: ALICE, created_at: stamp() });
    const other = async () => ((await as(app, BOB).get("/api/conversations")).json() as ConversationsPage).conversations[0]?.other;
    expect(await other()).toMatchObject({ id: ALICE, avatarUrl: AVATAR_URL });
    expect((await as(app, CHLOE).get("/api/blocks")).json()).toEqual([expect.objectContaining({ id: ALICE, avatarUrl: AVATAR_URL })]);
    suspend(fake, ALICE);
    expect(await other()).toMatchObject({ id: ALICE, username: "alice", avatarUrl: null });
    expect((await as(app, CHLOE).get("/api/blocks")).json()).toEqual([expect.objectContaining({ id: ALICE, username: "alice", avatarUrl: null })]);
  });

  it("withoutSuspendedFaces : jamais pour la personne elle-même, sans lire les suspensions quand il n'y a rien à cacher, et jamais « non suspendu » par défaut", async () => {
    const { fake, app } = await world({ with0037: false });
    suspend(fake, ALICE);
    const rows = [
      { id: ALICE, avatar_url: AVATAR_URL, bio: BIO },
      { id: BOB, avatar_url: "https://exemple.test/bob.jpg", bio: "Bio de Bob" },
    ];
    expect(await withoutSuspendedFaces(app, rows, BOB)).toEqual([{ id: ALICE, avatar_url: null, bio: null }, rows[1]]);
    expect(await withoutSuspendedFaces(app, rows, ALICE)).toEqual(rows);
    // Sans colonne « bio » lue, aucune n'est ajoutée à la réponse.
    expect(await withoutSuspendedFaces(app, [{ id: ALICE, avatar_url: AVATAR_URL }], BOB)).toEqual([{ id: ALICE, avatar_url: null }]);

    let reads = 0;
    const counting = { ...app, supabaseAdmin: { from: () => ((reads += 1), { select: () => ({ in: async () => ({ data: null, error: { message: "panne" } }) }) }) } } as unknown as FastifyInstance;
    const bare = [{ id: ALICE, avatar_url: null, bio: null }];
    expect(await withoutSuspendedFaces(counting, bare, BOB)).toBe(bare);
    expect(reads).toBe(0);
    await expect(withoutSuspendedFaces(counting, rows, BOB)).rejects.toThrow("Lecture des suspensions impossible");
  });
});

describe("le fichier de la migration 0037, son contrôle et le registre", () => {
  const SQL = readFileSync(join(__dirname, "../supabase/migrations/0037_moderation_profil.sql"), "utf8");
  const VERIFICATION = readFileSync(join(__dirname, "../supabase/verifications/0037-verification.sql"), "utf8");
  const REGISTRE = readFileSync(join(__dirname, "../supabase/REGISTRE-MIGRATIONS.md"), "utf8");
  const statements = SQL.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");

  it("le journal accepte exactement les décisions connues du serveur et de l'app", () => {
    const check = /moderation_actions_action_check\s+check \(action in \(([^)]+)\)\)/.exec(statements);
    expect(check).not.toBeNull();
    expect(check![1]!.split(",").map((value) => value.trim().replace(/'/g, ""))).toEqual([...MODERATION_ACTION_TYPES]);
    // Chaque décision a son libellé dans l'export des données de la personne.
    for (const action of MODERATION_ACTION_TYPES) expect(MODERATION_ACTION_LABELS[action].fr).not.toBe("");
  });

  it("le retour en arrière est en tête, remet l'ancienne liste et retire la fonction ; la migration est rejouable et ne détruit rien", () => {
    const rollback = SQL.slice(SQL.indexOf("-- Retour en arrière"), SQL.indexOf("-- Ce qu'elle ajoute :"));
    expect(SQL.indexOf("-- Retour en arrière")).toBeLessThan(SQL.indexOf("do $$"));
    expect(rollback).toContain("--   drop function if exists moderation_remove_profile_part(uuid, uuid, text, text, text);");
    expect(rollback).toContain("check (action in ('dismiss', 'hide', 'suspend', 'restore', 'unsuspend', 'remove_image'));");
    expect(statements).toContain("drop constraint if exists moderation_actions_action_check");
    expect(statements).toContain("create or replace function moderation_remove_profile_part(");
    expect(statements).not.toMatch(/\b(drop table|drop column|truncate|delete from)\b/);
    // Elle refuse de s'appliquer sans 0026, avant de modifier quoi que ce soit.
    expect(statements.trimStart()).toMatch(/^do \$\$\s*begin\s*if not exists \(select 1 from pg_proc/);
    expect(statements).toContain("Appliquez d''abord la migration 0026");
  });

  it("la fonction vérifie le rôle avant tout verrou (la sonde ne bloque personne), et reste réservée au serveur", () => {
    const body = statements.slice(statements.indexOf("create or replace function moderation_remove_profile_part("), statements.indexOf("$$;", statements.indexOf("as $$", statements.indexOf("create or replace function moderation_remove_profile_part("))));
    expect(body.indexOf("'not_admin'")).toBeGreaterThan(0);
    expect(body.indexOf("'not_admin'")).toBeLessThan(body.indexOf("pg_advisory_xact_lock"));
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("insert into moderation_actions"));
    expect(body).toContain("for update");
    expect(body).toContain("'report_handled'");
    expect(statements).toContain("revoke all on function moderation_remove_profile_part(uuid, uuid, text, text, text) from public, anon, authenticated;");
    expect(statements).toContain("grant execute on function moderation_remove_profile_part(uuid, uuid, text, text, text) to service_role;");
    expect(statements).not.toMatch(/create policy|enable row level security|create table/);
  });

  it("le contrôle est en lecture seule, et le registre annonce 0037 « à appliquer »", () => {
    // Une seule instruction, un « select » (les mots « update » ou « insert » n'y sont que des textes cherchés).
    const query = VERIFICATION.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n").trim();
    expect(query.startsWith("select")).toBe(true);
    expect(query.indexOf(";")).toBe(query.length - 1);
    for (const column of ["decisions_profil", "retrait_profil", "reservee_au_serveur"]) expect(VERIFICATION).toContain(`as ${column}`);
    expect(REGISTRE).toMatch(/\| 0037 \| Modération des profils[^|]*\| \*\*à appliquer\*\*/);
    expect(REGISTRE).toContain("`supabase/verifications/0037-verification.sql`");
  });
});
