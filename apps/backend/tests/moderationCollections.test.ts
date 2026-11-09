import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MODERATION_COLLECTION_PREVIEW_ITEMS,
  type AppNotification,
  type CollectionSummary,
  type ModerationItem,
  type ModerationPage,
  type SharedCollectionPage,
  type SharedCollectionsList,
} from "@monapp/shared-types";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import collectionsRoutes from "../src/routes/collections.js";
import reportsRoutes from "../src/routes/reports.js";
import moderationRoutes from "../src/routes/moderation.js";
import notificationsRoutes from "../src/routes/notifications.js";
import accountRoutes from "../src/routes/account.js";
import { resetCollectionsProbe } from "../src/lib/collections.js";
import { collectionModerationReady, resetCollectionModerationProbe } from "../src/lib/collectionModeration.js";
import { AUTO_HIDE_TARGET_TYPES, resetAutoHideProbe } from "../src/lib/autoHide.js";
import { STORAGE_ATTEMPTS } from "../src/lib/storage.js";
import { EXPORT_TEXT, REPORT_HANDLED_LABELS, REPORT_TARGET_LABELS } from "../src/lib/exportText.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Modération des collections (lot modération des collections, migration
// 0034 ; règle 1.2 d'Apple), SANS base ni réseau : les vraies routes sur une
// fausse base en mémoire (tests/fakeSupabase.ts). Les fonctions de la base
// (moderation_apply, moderation_undo, moderation_auto_hide,
// moderation_remove_collection_image, moderation_queue) sont imitées ici, au
// plus près du SQL de 0034 ; le vrai SQL est essayé par
// moderationCollectionsBase.test.ts (sur le Mac, une fois 0034 appliquée sur
// spotto-dev-2).

const downloads = vi.hoisted(() => ({ images: new Map<string, Buffer>() }));
vi.mock("../src/lib/publicImage.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/publicImage.js")>();
  return {
    ...original,
    downloadPublicImage: async (url: string) => {
      const image = downloads.images.get(url);
      if (!image) throw new original.PublicImageError("Image refusée", 403);
      return image;
    },
  };
});

const ALICE = "a0000000-0000-4000-8000-000000000001"; // montre ses collections à ses amis
const BOB = "b0000000-0000-4000-8000-000000000002"; // ami d'Alice
const CHLOE = "c0000000-0000-4000-8000-000000000003"; // amie d'Alice
const DAN = "d0000000-0000-4000-8000-000000000004"; // ami d'Alice
const EVE = "e0000000-0000-4000-8000-000000000005"; // suit Alice, sans retour
const ADMIN = "ad000000-0000-4000-8000-000000000006";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const SECRET_NAME = "Cadeaux secrets pour Léa";
const OWN_FOLDER = (user: string) => `${STORAGE_ORIGIN}/storage/v1/object/public/post-media/${user}/`;
const WISHES = 7;
const wishId = (i: number) => `f0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const imageOf = (i: number) => `https://boutique.example/images/envie-${i}.jpg`;
const WITHOUT_0034: FakeDbOptions["missingColumns"] = { collections: ["hidden_at"], collection_image_copies: ["image_removed_at"] };

function profile(id: string, username: string): Row {
  return { id, username, display_name: username[0]!.toUpperCase() + username.slice(1), avatar_url: null, bio: null, messages_from: "everyone", piece_sends_from: "following" };
}

let tick = 0;
/** Dates des fonctions imitées : croissantes, au format de Postgres. */
function stamp(): string {
  tick += 1;
  return new Date(Date.now() + tick * 1000).toISOString();
}

type Fake = ReturnType<typeof fakeSupabase>;
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

/** Les fonctions de la modération de la base, imitées sur la fausse base
 * (collections et comptes : ce que ces tests demandent). Même ordre et mêmes
 * refus que le SQL des migrations 0023, 0026, 0030, 0032 et 0034. */
function moderationRpc(getFake: () => Fake, calls: { fn: string; args: Record<string, unknown> }[]) {
  const t = (name: string) => getFake().table(name);
  const ok = (actionId: string): RpcResult => ({ data: [{ outcome: "ok", action_id: actionId }], error: null });
  const refuse = (outcome: string): RpcResult => ({ data: [{ outcome, action_id: null }], error: null });
  const isAdmin = (id: unknown) => t("admins").some((row) => row.user_id === id);
  const ownerOf = (type: unknown, id: unknown): string | undefined =>
    type === "collection" ? (t("collections").find((row) => row.id === id)?.user_id as string | undefined) : type === "user" ? (t("profiles").find((row) => row.id === id)?.id as string | undefined) : undefined;
  const isHidden = (type: unknown, id: unknown) => type === "collection" && t("collections").some((row) => row.id === id && (row.hidden_at ?? null) !== null);
  const setHidden = (type: unknown, id: unknown, at: string | null) => {
    if (type === "collection") for (const row of t("collections")) if (row.id === id) row.hidden_at = at;
  };
  const undone = (id: unknown) => t("moderation_actions").some((row) => row.undoes_action_id === id);
  const insertAction = (row: Row): string => {
    const id = randomUUID();
    t("moderation_actions").push({ id, admin_id: null, reason: null, note: null, undoes_action_id: null, automatic: false, created_at: stamp(), ...row });
    return id;
  };
  const notify = (userId: unknown, type: "moderation" | "report_handled", actionId: string) =>
    t("notifications").push({ id: randomUUID(), user_id: userId, actor_id: null, type, post_id: null, moderation_action_id: actionId, read_at: null, hidden_at: null, created_at: stamp() });
  const handleReports = (type: unknown, id: unknown, actionId: string) => {
    const reporters = new Set<unknown>();
    for (const report of t("reports")) {
      if (report.target_type !== type || report.target_id !== id || report.handled_at !== null) continue;
      Object.assign(report, { handled_at: stamp(), moderation_action_id: actionId });
      reporters.add(report.reporter_id);
    }
    for (const reporter of reporters) notify(reporter, "report_handled", actionId);
  };
  const note = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

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
      const rows = [...groups.values()]
        .map((reports) => {
          const dates = reports.map((r) => String(r.created_at)).sort();
          const reasons: Record<string, number> = {};
          for (const r of reports) reasons[String(r.reason)] = (reasons[String(r.reason)] ?? 0) + 1;
          const notes = [...reports].sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)).flatMap((r) => (r.note ? [String(r.note)] : [])).slice(0, 5);
          return { target_type: reports[0]!.target_type, target_id: reports[0]!.target_id, report_count: reports.length, reasons, notes, first_at: dates[0], last_at: dates.at(-1) };
        })
        .filter((row) => typeof args.p_before !== "string" || String(row.last_at) < args.p_before)
        .sort((a, b) => (String(a.last_at) < String(b.last_at) ? 1 : -1));
      return { data: rows.slice(0, Math.min(Math.max(Number(args.p_limit ?? 20), 1), 50)), error: null };
    }
    if (fn === "moderation_apply") {
      const { p_admin_id: admin, p_action: action, p_target_type: type, p_target_id: id, p_reason: reason } = args;
      if (!isAdmin(admin)) return refuse("not_admin");
      if (!["dismiss", "hide", "suspend"].includes(String(action)) || !["user", "collection"].includes(String(type)) || (action === "hide" && type === "user") || (action !== "dismiss" && !reason)) {
        return refuse("invalid");
      }
      const user = ownerOf(type, id);
      const open = t("reports").some((r) => r.target_type === type && r.target_id === id && r.handled_at === null);
      if (!user && (action !== "dismiss" || !open)) return refuse("target_not_found");
      if (action === "dismiss" && !open) return refuse("already_handled");
      const hidden = isHidden(type, id);
      const auto = hidden
        ? [...t("moderation_actions")].reverse().find((m) => m.target_type === type && m.target_id === id && m.action === "hide" && m.automatic === true && !undone(m.id))
        : undefined;
      if (action === "hide" && hidden && !auto) return refuse("already_hidden");
      if (action === "suspend" && t("suspensions").some((s) => s.user_id === user)) return refuse("already_suspended");
      const actionId = insertAction({
        admin_id: admin,
        action,
        target_type: type,
        target_id: id,
        target_user_id: user ?? null,
        reason: reason ?? null,
        note: note(args.p_note),
        undoes_action_id: action === "hide" ? (auto?.id ?? null) : null,
      });
      if (action === "hide") setHidden(type, id, stamp());
      else if (action === "suspend") t("suspensions").push({ user_id: user, moderation_action_id: actionId, created_at: stamp() });
      else if (auto) {
        const restore = insertAction({ admin_id: admin, action: "restore", target_type: type, target_id: id, target_user_id: user, undoes_action_id: auto.id });
        setHidden(type, id, null);
        notify(user, "moderation", restore);
      }
      if (action !== "dismiss" && !(action === "hide" && auto)) notify(user, "moderation", actionId);
      handleReports(type, id, actionId);
      return ok(actionId);
    }
    if (fn === "moderation_undo") {
      if (!isAdmin(args.p_admin_id)) return refuse("not_admin");
      const original = t("moderation_actions").find((m) => m.id === args.p_action_id);
      if (original?.action === "remove_image") return refuse("not_undoable");
      if (!original || !["hide", "suspend"].includes(String(original.action))) return refuse("target_not_found");
      if (undone(original.id) || (original.action === "suspend" && !t("suspensions").some((s) => s.moderation_action_id === original.id))) return refuse("already_undone");
      const undo = original.action === "hide" ? "restore" : "unsuspend";
      const actionId = insertAction({
        admin_id: args.p_admin_id,
        action: undo,
        target_type: original.target_type,
        target_id: original.target_id,
        target_user_id: original.target_user_id,
        note: note(args.p_note),
        undoes_action_id: original.id,
      });
      if (undo === "restore") setHidden(original.target_type, original.target_id, null);
      else getFake().tables.set("suspensions", t("suspensions").filter((s) => s.moderation_action_id !== original.id));
      notify(original.target_user_id, "moderation", actionId);
      return ok(actionId);
    }
    if (fn === "moderation_auto_hide") {
      const { p_target_type: type, p_target_id: id, p_threshold: threshold } = args;
      if (!["post", "comment", "piece", "collection"].includes(String(type)) || Number(threshold ?? 0) < 2) return refuse("invalid");
      if (type !== "collection") return refuse("target_not_found");
      const owner = ownerOf(type, id);
      if (!owner) return refuse("target_not_found");
      if (isHidden(type, id)) return refuse("already_hidden");
      const since = t("moderation_actions").filter((m) => m.target_type === type && m.target_id === id && m.action === "restore").map((m) => String(m.created_at)).sort().at(-1);
      const mine = t("reports").filter((r) => r.target_type === type && r.target_id === id);
      const eligible = mine.filter(
        (r) =>
          r.handled_at === null &&
          r.reporter_id !== owner &&
          (since === undefined || String(r.created_at) > since) &&
          !t("suspensions").some((s) => s.user_id === r.reporter_id) &&
          !mine.some((o) => o.reporter_id === r.reporter_id && (o.handled_at !== null || (since !== undefined && String(o.created_at) <= since)))
      );
      const reporters = new Set(eligible.map((r) => r.reporter_id));
      if (reporters.size < Number(threshold)) return refuse("below_threshold");
      const counts = new Map<string, number>();
      for (const r of eligible) counts.set(String(r.reason), (counts.get(String(r.reason)) ?? 0) + 1);
      const reason = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
      const actionId = insertAction({ action: "hide", target_type: type, target_id: id, target_user_id: owner, reason, automatic: true });
      setHidden(type, id, stamp());
      notify(owner, "moderation", actionId);
      return ok(actionId);
    }
    if (fn === "moderation_remove_collection_image") {
      if (!isAdmin(args.p_admin_id)) return refuse("not_admin");
      const item = t("collection_items").find((row) => row.id === args.p_item_id && row.collection_id === args.p_collection_id);
      if (!item) return refuse("target_not_found");
      const copy = t("collection_image_copies").find((row) => row.wishlist_item_id === item.wishlist_item_id && row.user_id === item.user_id);
      if (!copy) return refuse("no_copy");
      if ((copy.image_removed_at ?? null) !== null) return refuse("already_removed");
      const actionId = insertAction({
        admin_id: args.p_admin_id,
        action: "remove_image",
        target_type: "collection",
        target_id: args.p_collection_id,
        target_user_id: item.user_id,
        reason: "image_rights",
        note: note(args.p_note),
      });
      Object.assign(copy, { image_url: null, image_thumb_url: null, image_removed_at: stamp() });
      notify(item.user_id, "moderation", actionId);
      handleReports("collection", args.p_collection_id, actionId);
      return ok(actionId);
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

/** Alice, ses amis Bob, Chloé et Dan (chacun suit l'autre), Eve qui la suit
 * sans retour, un administrateur ; sept envies d'Alice, chacune avec une
 * image téléchargeable. Les vraies routes, un compte par en-tête, le vrai
 * journal du serveur (lib/logPrivacy.ts). */
async function world(options: FakeDbOptions = {}): Promise<World> {
  const calls: World["calls"] = [];
  const lines: string[] = [];
  let fake: Fake | null = null;
  fake = fakeSupabase({ rpc: moderationRpc(() => fake!, calls), ...options });
  fake.table("profiles").push(profile(ALICE, "alice"), profile(BOB, "bob"), profile(CHLOE, "chloe"), profile(DAN, "dan"), profile(EVE, "eve"), profile(ADMIN, "admin"));
  fake.table("admins").push({ user_id: ADMIN });
  for (const friend of [BOB, CHLOE, DAN]) {
    fake.table("follows").push({ follower_id: ALICE, followee_id: friend, created_at: "2026-10-01T00:00:00+00:00" }, { follower_id: friend, followee_id: ALICE, created_at: "2026-10-01T00:00:00+00:00" });
  }
  fake.table("follows").push({ follower_id: EVE, followee_id: ALICE, created_at: "2026-10-01T00:00:00+00:00" });
  for (let i = 0; i < WISHES; i += 1) {
    fake.table("wishlist_items").push({
      id: wishId(i),
      user_id: ALICE,
      title: `Envie ${i}`,
      image_url: imageOf(i),
      reference: "Note privée",
      price_min: "50.00",
      currency: "EUR",
      merchant_name: "Boutique",
      merchant_url: `https://boutique.example/envie-${i}`,
      product_match_id: null,
      created_at: `2026-11-0${1 + (i % 8)}T00:00:00+00:00`,
    });
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
  await app.register(collectionsRoutes);
  await app.register(reportsRoutes);
  await app.register(moderationRoutes);
  await app.register(notificationsRoutes);
  await app.register(accountRoutes);
  await app.ready();
  current = app;
  return { fake, app, calls, lines };
}

function as(app: FastifyInstance, user: string) {
  const headers = { "x-test-user": user };
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers }),
    post: (url: string, payload?: object) => app.inject({ method: "POST", url, headers, ...(payload ? { payload } : {}) }),
    patch: (url: string, payload: object) => app.inject({ method: "PATCH", url, headers, payload }),
    put: (url: string, payload: object) => app.inject({ method: "PUT", url, headers, payload }),
  };
}

/** Une collection d'Alice, avec `count` envies (à partir de la `first`-ième,
 * qui ne doivent être dans aucune autre collection), montrée à ses amis. */
async function sharedCollection(app: FastifyInstance, name = SECRET_NAME, count = 2, first = 0): Promise<CollectionSummary> {
  const alice = as(app, ALICE);
  const created = await alice.post("/api/collections", { name });
  expect(created.statusCode).toBe(201);
  const collection: CollectionSummary = created.json();
  for (let i = first; i < first + count; i += 1) expect((await alice.put(`/api/wishlist/${wishId(i)}/collections`, { collectionIds: [collection.id] })).statusCode).toBe(200);
  const shared = await alice.patch(`/api/collections/${collection.id}`, { visibility: "friends" });
  expect(shared.statusCode).toBe(200);
  return shared.json();
}

const report = (app: FastifyInstance, user: string, targetId: string, extra: object = {}) =>
  as(app, user).post("/api/reports", { targetType: "collection", targetId, reason: "inappropriate", ...extra });
const sharedPage = async (app: FastifyInstance, user: string, id: string) => as(app, user).get(`/api/collections/${id}/shared`);
const friendList = async (app: FastifyInstance, user: string): Promise<SharedCollectionsList> => (await as(app, user).get(`/api/users/${ALICE}/collections`)).json();
const queue = async (app: FastifyInstance, status: "open" | "handled" = "open"): Promise<ModerationPage> => (await as(app, ADMIN).get(`/api/admin/moderation?status=${status}`)).json();
const itemOf = async (app: FastifyInstance, id: string, status: "open" | "handled" = "open"): Promise<ModerationItem | undefined> =>
  (await queue(app, status)).items.find((item) => item.targetType === "collection" && item.targetId === id);
const decide = (app: FastifyInstance, payload: object) => as(app, ADMIN).post("/api/admin/moderation/actions", payload);
const notices = async (app: FastifyInstance, user: string): Promise<AppNotification[]> => (await as(app, user).get("/api/notifications")).json();

beforeEach(async () => {
  resetCollectionsProbe();
  resetCollectionModerationProbe();
  resetAutoHideProbe();
  downloads.images.clear();
  const jpeg = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#806040" } }).jpeg().toBuffer();
  for (let i = 0; i < WISHES; i += 1) downloads.images.set(imageOf(i), jpeg);
});

afterEach(async () => {
  await current?.close();
  current = null;
});

describe("sans la migration 0034", () => {
  it("« Signaler » est annoncé indisponible, un signalement reçoit « indisponible » et rien n'est écrit", async () => {
    const { fake, app } = await world({ missingColumns: WITHOUT_0034 });
    expect((await as(app, BOB).get("/api/collections/status")).json()).toEqual({ enabled: true, reportable: false });
    const gifts = await sharedCollection(app);
    const res = await report(app, BOB, gifts.id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "collection_moderation_unavailable", message: "Le signalement des collections n'est pas encore disponible." });
    expect(fake.table("reports")).toHaveLength(0);
    const remove = await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: UNKNOWN });
    expect(remove.statusCode).toBe(404);
    expect(remove.json().error).toBe("collection_moderation_unavailable");
  });

  it("les collections, elles, marchent comme avant (liste, amis, export)", async () => {
    const { app } = await world({ missingColumns: WITHOUT_0034 });
    const gifts = await sharedCollection(app);
    expect(gifts).toMatchObject({ visibility: "friends", itemCount: 2, hidden: false });
    expect((await as(app, ALICE).get("/api/collections")).json().collections).toEqual([expect.objectContaining({ id: gifts.id, hidden: false })]);
    expect((await friendList(app, BOB)).collections.map((c) => c.id)).toEqual([gifts.id]);
    const page: SharedCollectionPage = (await sharedPage(app, BOB, gifts.id)).json();
    expect(page.items.every((item) => item.imageUrl?.startsWith(OWN_FOLDER(ALICE)))).toBe(true);
    // Rendue privée puis remontrée : aucune colonne de 0034 n'est demandée.
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "private" })).statusCode).toBe(200);
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "friends" })).statusCode).toBe(200);
    const exported = (await as(app, ALICE).get("/api/me/export")).json();
    expect(exported.collections).toHaveLength(1);
    expect(exported.collections[0]).not.toHaveProperty("hidden_at");
    expect(exported.collectionItems[0]).not.toHaveProperty("friends_image_removed_at");
  });

  it("sans 0033 non plus : rien n'est annoncé ; la sonde de 0034 attend celle de 0033", async () => {
    const { app } = await world({ missing: ["collections", "collection_items", "collection_image_copies"] });
    expect((await as(app, BOB).get("/api/collections/status")).json()).toEqual({ enabled: false, reportable: false });
    expect((await report(app, BOB, UNKNOWN)).json().error).toBe("collection_moderation_unavailable");
    expect(await collectionModerationReady(app)).toBe(false);
  });
});

describe("signaler une collection : seulement celle qu'on voit vraiment", () => {
  it("un ami peut la signaler (motif et précision) ; « Signaler » est annoncé", async () => {
    const { fake, app } = await world();
    expect((await as(app, BOB).get("/api/collections/status")).json()).toEqual({ enabled: true, reportable: true });
    const gifts = await sharedCollection(app);
    const res = await report(app, BOB, gifts.id, { reason: "harassment", note: "  Nom blessant  " });
    expect(res.statusCode).toBe(204);
    expect(fake.table("reports")).toEqual([expect.objectContaining({ reporter_id: BOB, target_type: "collection", target_id: gifts.id, reason: "harassment", note: "Nom blessant" })]);
  });

  it("tous les autres cas : la même réponse qu'une collection inexistante, rien n'est enregistré", async () => {
    const { fake, app } = await world();
    const gifts = await sharedCollection(app);
    const privateOne = (await as(app, ALICE).post("/api/collections", { name: "Privée" })).json() as CollectionSummary;
    const missing = await report(app, BOB, UNKNOWN);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "target_not_found", message: "Contenu introuvable." });
    const refused = async (user: string, id: string) => {
      const res = await report(app, user, id);
      expect(res.statusCode, `${user} ${id}`).toBe(404);
      expect(res.body).toBe(missing.body);
    };
    await refused(EVE, gifts.id); // pas amie (suit sans retour)
    await refused(ALICE, gifts.id); // la sienne
    await refused(BOB, privateOne.id); // privée
    // Blocage, dans un sens puis dans l'autre.
    fake.table("blocks").push({ blocker_id: ALICE, blocked_id: BOB, created_at: "2026-11-01T00:00:00+00:00" });
    await refused(BOB, gifts.id);
    fake.tables.set("blocks", [{ blocker_id: BOB, blocked_id: ALICE, created_at: "2026-11-01T00:00:00+00:00" }]);
    await refused(BOB, gifts.id);
    fake.tables.set("blocks", []);
    // Auteur suspendu.
    fake.table("suspensions").push({ user_id: ALICE, moderation_action_id: UNKNOWN });
    await refused(BOB, gifts.id);
    fake.tables.set("suspensions", []);
    // Masquée par la modération.
    fake.table("collections").find((row) => row.id === gifts.id)!.hidden_at = "2026-11-09T10:00:00+00:00";
    await refused(BOB, gifts.id);
    expect(fake.table("reports")).toHaveLength(0);
    // Entrée invalide : 400.
    expect((await as(app, BOB).post("/api/reports", { targetType: "collection", targetId: "pas-un-id", reason: "spam" })).statusCode).toBe(400);
  });

  it("signalée : elle disparaît aussitôt de ce que voit la personne (profil, collection, envies) ; les autres amis la voient encore", async () => {
    const { app } = await world();
    const gifts = await sharedCollection(app);
    const other = await sharedCollection(app, "Été", 1, 2);
    const itemId = ((await sharedPage(app, BOB, gifts.id)).json() as SharedCollectionPage).items[0]!.id;
    expect((await report(app, BOB, gifts.id)).statusCode).toBe(204);
    expect((await friendList(app, BOB)).collections.map((c) => c.id)).toEqual([other.id]);
    const unknownBody = (await sharedPage(app, BOB, UNKNOWN)).body;
    const page = await sharedPage(app, BOB, gifts.id);
    expect(page.statusCode).toBe(404);
    expect(page.body).toBe(unknownBody);
    expect((await as(app, BOB).get(`/api/collection-items/${itemId}`)).statusCode).toBe(404);
    expect((await as(app, BOB).post(`/api/collection-items/${itemId}/keep`)).statusCode).toBe(404);
    // Chloé, qui n'a rien signalé, et Alice elle-même la voient toujours.
    expect((await friendList(app, CHLOE)).collections.map((c) => c.id)).toEqual([gifts.id, other.id]);
    expect((await sharedPage(app, CHLOE, gifts.id)).statusCode).toBe(200);
    expect((await as(app, ALICE).get("/api/collections")).json().collections).toHaveLength(2);
  });
});

describe("file de modération : nom, auteur, aperçu des envies", () => {
  it(`la collection signalée, son auteur et ses ${MODERATION_COLLECTION_PREVIEW_ITEMS} dernières envies (titre, copie de l'image)`, async () => {
    const { app } = await world();
    const gifts = await sharedCollection(app, SECRET_NAME, WISHES);
    expect((await report(app, BOB, gifts.id, { note: "Images choquantes" })).statusCode).toBe(204);
    expect((await as(app, BOB).get("/api/admin/moderation")).statusCode).toBe(404);
    const item = await itemOf(app, gifts.id);
    expect(item).toMatchObject({
      targetType: "collection",
      reportCount: 1,
      reasons: { inappropriate: 1 },
      notes: ["Images choquantes"],
      activeHideActionId: null,
      activeSuspendActionId: null,
      canRemoveImage: false,
      preview: { kind: "collection", name: SECRET_NAME, visibility: "friends", itemCount: WISHES, hidden: false, author: { id: ALICE, username: "alice", suspended: false } },
    });
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    expect(item.preview.items).toHaveLength(MODERATION_COLLECTION_PREVIEW_ITEMS);
    // Les plus récemment ajoutées d'abord, comme les amis les voient.
    expect(item.preview.items.map((entry) => entry.title)).toEqual(["Envie 6", "Envie 5", "Envie 4", "Envie 3", "Envie 2", "Envie 1"]);
    for (const entry of item.preview.items) {
      expect(entry.imageUrl?.startsWith(OWN_FOLDER(ALICE))).toBe(true);
      expect(entry).toMatchObject({ imageRemoved: false, canRemoveImage: true });
    }
    // Jamais l'image du marchand, ni la note privée.
    const body = JSON.stringify(await queue(app));
    expect(body).not.toContain("boutique.example/images");
    expect(body).not.toContain("Note privée");
  });

  it("collection supprimée depuis par son auteur : « supprimé », classable sans suite", async () => {
    const { app } = await world();
    const gifts = await sharedCollection(app);
    expect((await report(app, BOB, gifts.id)).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/api/collections/${gifts.id}`, headers: { "x-test-user": ALICE } })).statusCode).toBe(204);
    expect((await itemOf(app, gifts.id))?.preview).toEqual({ kind: "missing" });
    expect((await decide(app, { targetType: "collection", targetId: gifts.id, action: "dismiss" })).statusCode).toBe(200);
  });
});

describe("masquer, rétablir", () => {
  it("masquée : les amis ne la voient plus ; l'auteur la voit « masquée » et ne peut pas la remontrer ; prévenus avec un motif", async () => {
    const { fake, app } = await world();
    const gifts = await sharedCollection(app);
    expect((await report(app, BOB, gifts.id)).statusCode).toBe(204);
    const hide = await decide(app, { targetType: "collection", targetId: gifts.id, action: "hide", reason: "inappropriate", note: "Nom inapproprié" });
    expect(hide.statusCode).toBe(200);

    for (const friend of [BOB, CHLOE]) {
      expect((await friendList(app, friend)).collections).toEqual([]);
      expect((await sharedPage(app, friend, gifts.id)).statusCode).toBe(404);
    }
    const own = (await as(app, ALICE).get("/api/collections")).json().collections as CollectionSummary[];
    expect(own).toEqual([expect.objectContaining({ id: gifts.id, visibility: "friends", hidden: true })]);
    // Renommer reste possible ; rendue privée, elle ne peut plus revenir chez les amis.
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { name: "Idées" })).json()).toMatchObject({ name: "Idées", hidden: true });
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "private" })).statusCode).toBe(200);
    const refused = await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "friends" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "collection_hidden", message: "Cette collection a été masquée par la modération : vous ne pouvez pas la montrer à vos amis." });
    expect(fake.table("collections")[0]).toMatchObject({ visibility: "private" });

    // Journal, auteur prévenu (motif et précision), signalement traité.
    expect(fake.table("moderation_actions")).toEqual([expect.objectContaining({ action: "hide", target_type: "collection", target_id: gifts.id, target_user_id: ALICE, reason: "inappropriate", admin_id: ADMIN })]);
    expect((await notices(app, ALICE)).find((n) => n.type === "moderation")?.moderation).toEqual({ action: "hide", targetType: "collection", reason: "inappropriate", note: "Nom inapproprié" });
    expect((await notices(app, BOB)).find((n) => n.type === "report_handled")?.reportedType).toBe("collection");

    // Dans la file (« Traités ») : masquée, avec « Rétablir ».
    const item = await itemOf(app, gifts.id, "handled");
    expect(item?.preview).toMatchObject({ kind: "collection", hidden: true });
    expect(item?.activeHideActionId).toBe(hide.json().actionId);
    expect((await decide(app, { targetType: "collection", targetId: gifts.id, action: "hide", reason: "spam" })).json().error).toBe("already_hidden");

    // Rétablie : l'auteur peut de nouveau la montrer, les amis la revoient.
    const undo = await as(app, ADMIN).post(`/api/admin/moderation/actions/${hide.json().actionId}/undo`, {});
    expect(undo.statusCode).toBe(200);
    expect((await notices(app, ALICE)).find((n) => n.moderation?.action === "restore")?.moderation).toMatchObject({ targetType: "collection" });
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "friends" })).json()).toMatchObject({ visibility: "friends", hidden: false });
    expect((await friendList(app, CHLOE)).collections.map((c) => c.id)).toEqual([gifts.id]);
    expect((await sharedPage(app, CHLOE, gifts.id)).statusCode).toBe(200);
    expect((await itemOf(app, gifts.id, "handled"))?.activeHideActionId).toBeNull();
  });

  it(`masquage automatique après ${3} personnes différentes (amies) ; « Classer sans suite » le lève`, async () => {
    const { fake, app, calls } = await world();
    expect(AUTO_HIDE_TARGET_TYPES).toContain("collection");
    const gifts = await sharedCollection(app);
    expect((await report(app, BOB, gifts.id)).statusCode).toBe(204);
    expect((await report(app, BOB, gifts.id, { reason: "spam" })).statusCode).toBe(204); // la même personne ne compte qu'une fois
    expect((await report(app, CHLOE, gifts.id)).statusCode).toBe(204);
    expect(fake.table("collections")[0]!.hidden_at ?? null).toBeNull();
    expect((await report(app, DAN, gifts.id)).statusCode).toBe(204);
    expect(calls.filter((call) => call.fn === "moderation_auto_hide").at(-1)?.args).toEqual({ p_target_type: "collection", p_target_id: gifts.id, p_threshold: 3 });
    expect(fake.table("collections")[0]!.hidden_at).toEqual(expect.any(String));
    // Profil d'Alice (vu par elle-même : Bob, Chloé et Dan l'ont signalée, elle n'y est plus pour eux).
    expect((await friendList(app, ALICE)).collections).toEqual([]);
    const item = await itemOf(app, gifts.id);
    expect(item).toMatchObject({ activeHideAutomatic: true, preview: { hidden: true } });
    expect(item?.history[0]).toMatchObject({ action: "hide", automatic: true });
    // Classée sans suite : rétablie, l'auteur prévenu.
    expect((await decide(app, { targetType: "collection", targetId: gifts.id, action: "dismiss" })).statusCode).toBe(200);
    expect(fake.table("collections")[0]!.hidden_at).toBeNull();
    expect((await friendList(app, ALICE)).collections.map((c) => c.id)).toEqual([gifts.id]);
    expect((await friendList(app, BOB)).collections).toEqual([]);
  });
});

describe("retirer la copie de l'image d'une envie", () => {
  async function reportedWithItems(options: FakeDbOptions = {}) {
    const w = await world(options);
    const gifts = await sharedCollection(w.app, SECRET_NAME, 3);
    expect((await report(w.app, BOB, gifts.id)).statusCode).toBe(204);
    const item = await itemOf(w.app, gifts.id);
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    return { ...w, gifts, items: item.preview.items };
  }

  it("le stockage refuse : 3 essais, refus expliqué, et rien n'est changé (copie, journal, personne prévenue, signalement)", async () => {
    let attempts = 0;
    let failing = false;
    const { fake, app, gifts, items } = await reportedWithItems({ failStorageRemove: () => failing && (attempts += 1) > 0 });
    const target = items[0]!;
    const copiesBefore = JSON.stringify(fake.table("collection_image_copies"));
    failing = true;
    const res = await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: target.id });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "storage_failed", message: expect.stringContaining("rien n'a été changé") });
    expect(attempts).toBe(STORAGE_ATTEMPTS);
    expect(JSON.stringify(fake.table("collection_image_copies"))).toBe(copiesBefore);
    expect(fake.removed).toEqual([]);
    expect(fake.table("moderation_actions")).toEqual([]);
    expect(fake.table("notifications")).toEqual([]);
    expect(fake.table("reports")[0]).toMatchObject({ handled_at: null });
    expect(((await sharedPage(app, CHLOE, gifts.id)).json() as SharedCollectionPage).items.every((item) => item.imageUrl !== null)).toBe(true);
  });

  it("retirée : fichiers effacés d'abord, puis « Image indisponible » pour les amis ; journal, motif neutre, signalement traité ; définitif", async () => {
    const { fake, app, gifts, items } = await reportedWithItems();
    const target = items[0]!;
    const page: SharedCollectionPage = (await sharedPage(app, CHLOE, gifts.id)).json();
    const before = page.items.find((item) => item.id === target.id)!;
    const res = await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: target.id, note: "Demande du titulaire des droits" });
    expect(res.statusCode).toBe(200);
    // Les deux fichiers de cette copie, et eux seuls.
    expect(fake.removed.sort()).toEqual([before.imageUrl!, before.imageThumbUrl!].map((url) => url.split("/public/")[1]).sort());

    const after: SharedCollectionPage = (await sharedPage(app, CHLOE, gifts.id)).json();
    expect(after.items.find((item) => item.id === target.id)).toMatchObject({ title: before.title, imageUrl: null, imageThumbUrl: null, merchantUrl: before.merchantUrl });
    expect(after.items.filter((item) => item.id !== target.id).every((item) => item.imageUrl?.startsWith(OWN_FOLDER(ALICE)))).toBe(true);
    // Alice garde l'image d'origine dans ses Envies (seule la copie montrée aux amis est retirée).
    expect(fake.table("wishlist_items").find((row) => row.id === fake.table("collection_items").find((i) => i.id === target.id)!.wishlist_item_id)!.image_url).toMatch(/^https:\/\/boutique\.example\//);

    expect(fake.table("moderation_actions")).toEqual([
      expect.objectContaining({ action: "remove_image", target_type: "collection", target_id: gifts.id, target_user_id: ALICE, reason: "image_rights", note: "Demande du titulaire des droits" }),
    ]);
    expect((await notices(app, ALICE)).find((n) => n.type === "moderation")?.moderation).toEqual({
      action: "remove_image",
      targetType: "collection",
      reason: "image_rights",
      note: "Demande du titulaire des droits",
    });
    expect((await notices(app, BOB)).some((n) => n.type === "report_handled" && n.reportedType === "collection")).toBe(true);

    // File (« Traités ») : l'envie montre « Image retirée », sans bouton ; les autres l'ont encore.
    const handled = await itemOf(app, gifts.id, "handled");
    if (handled?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    expect(handled.preview.items.find((entry) => entry.id === target.id)).toMatchObject({ imageUrl: null, imageRemoved: true, canRemoveImage: false });
    expect(handled.preview.items.filter((entry) => entry.id !== target.id).every((entry) => entry.canRemoveImage)).toBe(true);
    expect(handled.history[0]).toMatchObject({ action: "remove_image", reason: "image_rights" });

    // Une seconde fois : refus ; la décision ne s'annule pas.
    const again = await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: target.id });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("already_removed");
    const undo = await as(app, ADMIN).post(`/api/admin/moderation/actions/${res.json().actionId}/undo`, {});
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error).toBe("not_undoable");
  });

  it("l'image retirée n'est jamais recopiée : ni en rendant la collection privée puis visible, ni dans une autre collection", async () => {
    const { fake, app, gifts, items } = await reportedWithItems();
    const target = items[0]!;
    expect((await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: target.id })).statusCode).toBe(200);
    const uploads = fake.uploads.length;
    const removedWish = fake.table("collection_items").find((row) => row.id === target.id)!.wishlist_item_id;
    await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "private" });
    // Copies des autres envies effacées ; celle qui a été retirée reste, sans adresse.
    expect(fake.table("collection_image_copies")).toEqual([expect.objectContaining({ wishlist_item_id: removedWish, image_url: null, image_thumb_url: null, image_removed_at: expect.any(String) })]);
    await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "friends" });
    const other = (await as(app, ALICE).post("/api/collections", { name: "Autre" })).json() as CollectionSummary;
    await as(app, ALICE).patch(`/api/collections/${other.id}`, { visibility: "friends" });
    await as(app, ALICE).put(`/api/wishlist/${removedWish}/collections`, { collectionIds: [gifts.id, other.id] });
    // Deux autres envies recopiées (deux tailles chacune), jamais celle-là.
    expect(fake.uploads.length).toBe(uploads + 4);
    const otherPage: SharedCollectionPage = (await sharedPage(app, CHLOE, other.id)).json();
    expect(otherPage.items).toEqual([expect.objectContaining({ imageUrl: null, imageThumbUrl: null })]);
    // Couverture : jamais l'envie sans image.
    expect((await friendList(app, CHLOE)).collections.find((c) => c.id === other.id)?.coverUrl).toBeNull();
  });

  it("une envie d'une autre collection, inconnue, sans copie : refus, rien n'est effacé ; entrée invalide : 400", async () => {
    const { fake, app, gifts, items } = await reportedWithItems();
    const removeImage = (payload: object) => as(app, ADMIN).post("/api/admin/moderation/remove-image", payload);
    const other = await sharedCollection(app, "Autre", 1, 3);
    const otherItem = ((await sharedPage(app, CHLOE, other.id)).json() as SharedCollectionPage).items[0]!;
    expect((await removeImage({ targetType: "collection", targetId: gifts.id, itemId: otherItem.id })).json().error).toBe("target_not_found");
    expect((await removeImage({ targetType: "collection", targetId: gifts.id, itemId: UNKNOWN })).statusCode).toBe(404);
    // Copie jamais faite (marchand injoignable) : rien à retirer.
    fake.tables.set("collection_image_copies", fake.table("collection_image_copies").filter((row) => row.wishlist_item_id !== fake.table("collection_items").find((i) => i.id === items[1]!.id)!.wishlist_item_id));
    const noCopy = await removeImage({ targetType: "collection", targetId: gifts.id, itemId: items[1]!.id });
    expect(noCopy.statusCode).toBe(409);
    expect(noCopy.json()).toEqual({ error: "no_copy", message: "Cette envie n'a pas d'image copiée par Spotto : il n'y a rien à retirer." });
    expect(fake.removed).toEqual([]);
    expect(fake.table("moderation_actions")).toEqual([]);
    for (const invalid of [{ targetType: "collection", targetId: gifts.id }, { targetType: "collection", targetId: gifts.id, itemId: "x" }, { targetType: "message", targetId: gifts.id, itemId: items[0]!.id }]) {
      expect((await removeImage(invalid)).statusCode, JSON.stringify(invalid)).toBe(400);
    }
    expect((await as(app, BOB).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: items[0]!.id })).statusCode).toBe(404);
  });
});

describe("suspendre l'auteur", () => {
  it("depuis la collection signalée : compte suspendu, ses collections cachées ; suspension levée, elles reviennent", async () => {
    const { fake, app } = await world();
    const gifts = await sharedCollection(app);
    expect((await report(app, BOB, gifts.id)).statusCode).toBe(204);
    const suspend = await decide(app, { targetType: "collection", targetId: gifts.id, action: "suspend", reason: "harassment" });
    expect(suspend.statusCode).toBe(200);
    expect(fake.table("suspensions")).toEqual([expect.objectContaining({ user_id: ALICE, moderation_action_id: suspend.json().actionId })]);
    expect((await friendList(app, CHLOE)).collections).toEqual([]);
    expect((await sharedPage(app, CHLOE, gifts.id)).statusCode).toBe(404);
    const item = await itemOf(app, gifts.id, "handled");
    expect(item).toMatchObject({ activeSuspendActionId: suspend.json().actionId, preview: { author: { suspended: true } } });
    expect((await notices(app, ALICE)).find((n) => n.type === "moderation")?.moderation).toMatchObject({ action: "suspend", targetType: "collection", reason: "harassment" });
    expect((await as(app, ADMIN).post(`/api/admin/moderation/actions/${suspend.json().actionId}/undo`, {})).statusCode).toBe(200);
    expect((await friendList(app, CHLOE)).collections.map((c) => c.id)).toEqual([gifts.id]);
  });
});

describe("données personnelles et journal", () => {
  it("export : le signalement d'une collection (JSON et fichier lisible) ; l'état « masquée » et l'image retirée chez l'auteur", async () => {
    const { app } = await world();
    const gifts = await sharedCollection(app, SECRET_NAME, 2);
    expect((await report(app, BOB, gifts.id, { note: "Précision" })).statusCode).toBe(204);
    const item = await itemOf(app, gifts.id);
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    expect((await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: item.preview.items[0]!.id })).statusCode).toBe(200);
    expect((await decide(app, { targetType: "collection", targetId: gifts.id, action: "hide", reason: "spam" })).statusCode).toBe(200);

    const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");
    // Celui qui a signalé : le type « collection », le motif, la précision, « traité » ; jamais le nom de la collection.
    const bobJson = (await as(app, BOB).get("/api/me/export")).json();
    expect(bobJson.reportsSubmitted).toEqual([expect.objectContaining({ target_type: "collection", target_id: gifts.id, reason: "inappropriate", note: "Précision", handled_at: expect.any(String) })]);
    const bobHtml = text((await as(app, BOB).get("/api/me/export?format=html")).body);
    expect(bobHtml).toContain(REPORT_TARGET_LABELS.collection.fr);
    expect(bobHtml).toContain(REPORT_HANDLED_LABELS.collection.fr);
    expect(bobHtml).not.toContain(SECRET_NAME);
    const bobEn = text((await app.inject({ method: "GET", url: "/api/me/export?format=html", headers: { "x-test-user": BOB, "accept-language": "en" } })).body);
    expect(bobEn).toContain(REPORT_TARGET_LABELS.collection.en);

    // L'auteur : sa collection masquée (date), l'image retirée (date et motif).
    const aliceJson = (await as(app, ALICE).get("/api/me/export")).json();
    expect(aliceJson.collections[0]).toMatchObject({ name: SECRET_NAME, hidden_at: expect.any(String) });
    expect(aliceJson.collectionItems.filter((row: Row) => row.friends_image_removed_at !== null)).toHaveLength(1);
    const aliceHtml = text((await as(app, ALICE).get("/api/me/export?format=html")).body);
    expect(aliceHtml).toContain("Masquée par la modération le");
    expect(aliceHtml).toContain(EXPORT_TEXT.imageRemovedOn.fr.split(" {date}")[0]!);
  });

  it("le journal du serveur ne contient jamais le nom d'une collection ni le titre d'une envie", async () => {
    let fail = false;
    const { app, lines } = await world({
      failWrite: (table, action, values) => (fail && table === "reports" && action === "insert" ? { code: "23514", message: `Failing row contains (${JSON.stringify(values)}, ${SECRET_NAME})` } : null),
    });
    const gifts = await sharedCollection(app, SECRET_NAME, 2);
    expect((await report(app, BOB, gifts.id, { note: "Léa est visée" })).statusCode).toBe(204);
    // Enregistrement refusé par la base, qui recopie la ligne dans son message.
    fail = true;
    expect((await report(app, CHLOE, gifts.id)).statusCode).toBe(500);
    fail = false;
    const item = await itemOf(app, gifts.id);
    if (item?.preview.kind !== "collection") throw new Error("Aperçu attendu");
    expect((await as(app, ADMIN).post("/api/admin/moderation/remove-image", { targetType: "collection", targetId: gifts.id, itemId: item.preview.items[0]!.id })).statusCode).toBe(200);
    expect((await decide(app, { targetType: "collection", targetId: gifts.id, action: "hide", reason: "spam" })).statusCode).toBe(200);
    await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "private" });
    expect((await as(app, ALICE).patch(`/api/collections/${gifts.id}`, { visibility: "friends" })).statusCode).toBe(409);
    const log = lines.join("\n");
    expect(log).toContain("Échec de l'enregistrement du signalement");
    expect(log).toContain("23514");
    expect(log).toContain("Retrait d'une image copiée");
    expect(log).toContain("Décision de modération");
    for (const secret of ["Cadeaux secrets", "Léa", "Envie 0", "Envie 1"]) expect(log).not.toContain(secret);
  });
});
