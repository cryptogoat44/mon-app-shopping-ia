import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";
import { ACCOUNT_DELETION_WORDS, CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { USER_STORAGE_BUCKETS } from "../src/lib/storage.js";

describe("account consents and export", () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "acca");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/consents" });
    expect(res.statusCode).toBe(401);
  });

  it("starts with no consent granted", async () => {
    const res = await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().every((c: { grantedAt: string | null }) => c.grantedAt === null)).toBe(true);
  });

  it("rejects an invalid consent type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: authHeaders(user.token),
      payload: { types: ["not_a_real_type"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a legal document accepted without its version, or in another version", async () => {
    for (const consents of [
      [{ type: "terms" }],
      [{ type: "terms", version: "ancienne-version" }],
      [{ type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms }, { type: "privacy_policy", version: "ancienne-version" }],
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(user.token), payload: { consents } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("outdated_document");
    }
    // Rien n'a été enregistré, même partiellement.
    const { count } = await app.supabaseAdmin.from("consents").select("id", { count: "exact", head: true }).eq("user_id", user.id);
    expect(count).toBe(0);
  });

  it("refuses the former request format (types without versions)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: authHeaders(user.token),
      payload: { types: ["terms", "privacy_policy"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("records consents with the accepted version and reflects it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: authHeaders(user.token),
      payload: {
        consents: [
          { type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms },
          { type: "privacy_policy", version: LEGAL_DOCUMENT_VERSIONS.privacy_policy },
        ],
      },
    });
    expect(res.statusCode).toBe(204);

    const status = await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(user.token) });
    const terms = status.json().find((c: { type: string }) => c.type === "terms");
    const privacy = status.json().find((c: { type: string }) => c.type === "privacy_policy");
    const marketing = status.json().find((c: { type: string }) => c.type === "marketing_email");
    expect(terms.grantedAt).not.toBeNull();
    expect(terms.version).toBe(LEGAL_DOCUMENT_VERSIONS.terms);
    expect(terms.isCurrent).toBe(true);
    expect(privacy.version).toBe(LEGAL_DOCUMENT_VERSIONS.privacy_policy);
    expect(marketing.grantedAt).toBeNull();
    expect(marketing.isCurrent).toBe(false);

    const { data: rows } = await app.supabaseAdmin.from("consents").select("type, document_version").eq("user_id", user.id);
    expect(rows).toHaveLength(2);
    expect(rows!.every((row) => row.document_version === LEGAL_DOCUMENT_VERSIONS[row.type as "terms" | "privacy_policy"])).toBe(true);
  });

  it("records the age declaration (15 years) with its version, and refuses it without", async () => {
    const other = await createTestUser(app, "acag");
    try {
      for (const consents of [[{ type: "age_declaration" }], [{ type: "age_declaration", version: "13-ans" }]]) {
        const refused = await app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(other.token), payload: { consents } });
        expect(refused.statusCode).toBe(409);
      }
      const res = await app.inject({
        method: "POST",
        url: "/api/consents",
        headers: authHeaders(other.token),
        payload: { consents: [{ type: "age_declaration", version: CONSENT_VERSIONS.age_declaration }] },
      });
      expect(res.statusCode).toBe(204);
      expect(CONSENT_VERSIONS.age_declaration).toMatch(/^15-ans-/);
      const status = await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(other.token) });
      const age = status.json().find((c: { type: string }) => c.type === "age_declaration");
      expect(age.version).toBe(CONSENT_VERSIONS.age_declaration);
      expect(age.isCurrent).toBe(true);
      const { data: rows } = await app.supabaseAdmin.from("consents").select("type, granted_at, document_version").eq("user_id", other.id);
      expect(rows).toHaveLength(1);
      expect(rows![0]!.granted_at).not.toBeNull();
    } finally {
      await deleteTestUser(app, other.id);
    }
  });

  it("une mise à jour d'information garde valable la version déjà acceptée", async () => {
    const other = await createTestUser(app, "acin");
    try {
      // Politique acceptée dans sa version précédente (avant le déménagement à Francfort).
      await app.supabaseAdmin.from("consents").insert([
        { user_id: other.id, type: "privacy_policy", granted_at: new Date().toISOString(), document_version: "projet-2026-09-25" },
        { user_id: other.id, type: "terms", granted_at: new Date().toISOString(), document_version: "une-version-inconnue" },
      ]);
      const status = (await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(other.token) })).json();
      const privacy = status.find((c: { type: string }) => c.type === "privacy_policy");
      const terms = status.find((c: { type: string }) => c.type === "terms");
      expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).not.toBe("projet-2026-09-25");
      expect(privacy.version).toBe("projet-2026-09-25");
      expect(privacy.isCurrent).toBe(true);
      expect(terms.isCurrent).toBe(false);
      // Une nouvelle acceptation se fait toujours dans la version en vigueur.
      const old = await app.inject({
        method: "POST",
        url: "/api/consents",
        headers: authHeaders(other.token),
        payload: { consents: [{ type: "privacy_policy", version: "projet-2026-09-25" }] },
      });
      expect(old.statusCode).toBe(409);
    } finally {
      await deleteTestUser(app, other.id);
    }
  });

  it("statistiques d'usage : accord, retrait et refus sont des événements datés, versionnés", async () => {
    const other = await createTestUser(app, "acan");
    try {
      const post = (consents: unknown) =>
        app.inject({ method: "POST", url: "/api/consents", headers: authHeaders(other.token), payload: { consents } });
      const status = async () =>
        (await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(other.token) }))
          .json()
          .find((c: { type: string }) => c.type === "analytics");

      // Jamais demandé.
      expect(await status()).toMatchObject({ grantedAt: null, decidedAt: null, isCurrent: false });
      // Texte d'une autre version : refusé.
      expect((await post([{ type: "analytics", version: "ancienne" }])).statusCode).toBe(409);
      // Accord.
      expect((await post([{ type: "analytics", version: CONSENT_VERSIONS.analytics }])).statusCode).toBe(204);
      const granted = await status();
      expect(granted.grantedAt).not.toBeNull();
      expect(granted.isCurrent).toBe(true);
      expect(granted.version).toBe(CONSENT_VERSIONS.analytics);
      // Retrait : nouvel événement, l'accord reste dans l'historique.
      expect((await post([{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted: false }])).statusCode).toBe(204);
      const withdrawn = await status();
      expect(withdrawn.grantedAt).toBeNull();
      expect(withdrawn.decidedAt).not.toBeNull();
      expect(withdrawn.isCurrent).toBe(false);
      const { data: rows } = await app.supabaseAdmin
        .from("consents")
        .select("granted_at, revoked_at, document_version")
        .eq("user_id", other.id)
        .eq("type", "analytics");
      expect(rows).toHaveLength(2);
      expect(rows!.filter((r) => r.granted_at !== null && r.revoked_at === null)).toHaveLength(1);
      expect(rows!.filter((r) => r.revoked_at !== null && r.granted_at === null)).toHaveLength(1);
      // Les documents obligatoires ne se « retirent » pas.
      expect((await post([{ type: "terms", version: LEGAL_DOCUMENT_VERSIONS.terms, granted: false }])).statusCode).toBe(400);
      // L'export contient tout l'historique des choix.
      const exported = (await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(other.token) })).json();
      expect(exported.consents.filter((c: { type: string }) => c.type === "analytics")).toHaveLength(2);
    } finally {
      await deleteTestUser(app, other.id);
    }
  });

  it("reports an acceptance given before version tracking as not current", async () => {
    const other = await createTestUser(app, "accv");
    try {
      await app.supabaseAdmin.from("consents").insert({ user_id: other.id, type: "terms", granted_at: new Date().toISOString() });
      const status = await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(other.token) });
      const terms = status.json().find((c: { type: string }) => c.type === "terms");
      expect(terms.grantedAt).not.toBeNull();
      expect(terms.version).toBeNull();
      expect(terms.isCurrent).toBe(false);
    } finally {
      await deleteTestUser(app, other.id);
    }
  });

  it("exports the user's own data", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/export", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.id).toBe(user.id);
    expect(Array.isArray(body.vaultItems)).toBe(true);
    expect(Array.isArray(body.posts)).toBe(true);
  });
});

describe("account deletion", () => {
  let app: FastifyInstance;
  // Mot tapé dans l'app (lot 5), revérifié par le serveur.
  const CONFIRMED = { confirmation: ACCOUNT_DELETION_WORDS.fr };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const deleteAccount = (user: TestUser, payload?: object, language?: string) =>
    app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...authHeaders(user.token), ...(language ? { "accept-language": language } : {}) },
      ...(payload === undefined ? {} : { payload }),
    });

  async function profileExists(id: string): Promise<boolean> {
    const { data, error } = await app.supabaseAdmin.from("profiles").select("id").eq("id", id).maybeSingle();
    expect(error).toBeNull();
    return data !== null;
  }

  it("deletes the account and invalidates its token", async () => {
    const user = await createTestUser(app, "accd");
    const del = await deleteAccount(user, CONFIRMED);
    expect(del.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.statusCode).toBe(401);
    expect(await profileExists(user.id)).toBe(false);
  });

  it("refuses without the typed word, or with a wrong one, and keeps the account", async () => {
    const user = await createTestUser(app, "accw");
    try {
      for (const payload of [undefined, {}, { confirmation: "" }, { confirmation: "SUPPRIME" }, { confirmation: "oui" }, { confirmation: 42 }]) {
        const res = await deleteAccount(user, payload);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: "deletion_not_confirmed", message: "Pour confirmer la suppression, tapez le mot demandé." });
      }
      const english = await deleteAccount(user, { confirmation: "nope" }, "en-GB");
      expect(english.json().message).toBe("To confirm the deletion, type the requested word.");
      expect(await profileExists(user.id)).toBe(true);
    } finally {
      await deleteTestUser(app, user.id);
    }
  });

  it("accepts the word of either language, whatever the case and the spaces around it", async () => {
    const user = await createTestUser(app, "acce");
    const del = await deleteAccount(user, { confirmation: "  delete " });
    expect(del.statusCode).toBe(204);
    expect(await profileExists(user.id)).toBe(false);
  });

  it("refuses to delete an administrator until the role is removed, with a clear message", async () => {
    const admin = await createTestUser(app, "accadm");
    expect((await app.supabaseAdmin.from("admins").insert({ user_id: admin.id })).error).toBeNull();
    try {
      const refused = await deleteAccount(admin, CONFIRMED);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toEqual({
        error: "admin_account",
        message: "Ce compte est administrateur et ne peut pas être supprimé tant qu'il a ce rôle. Retirez d'abord le rôle d'administrateur, puis recommencez.",
      });
      const english = await deleteAccount(admin, CONFIRMED, "en");
      expect(english.json().message).toBe(
        "This account is an administrator and can't be deleted while it has this role. Remove the administrator role first, then try again."
      );
      expect(await profileExists(admin.id)).toBe(true);

      expect((await app.supabaseAdmin.from("admins").delete().eq("user_id", admin.id)).error).toBeNull();
      const deleted = await deleteAccount(admin, CONFIRMED);
      expect(deleted.statusCode).toBe(204);
      expect(await profileExists(admin.id)).toBe(false);
    } finally {
      await app.supabaseAdmin.from("admins").delete().eq("user_id", admin.id);
      await deleteTestUser(app, admin.id);
    }
  });

  it("removes files from every storage bucket, including avatars", async () => {
    const storageUser = await createTestUser(app, "accs");
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#6B4A3A" } }).jpeg().toBuffer();

    for (const bucket of USER_STORAGE_BUCKETS) {
      const { error } = await app.supabaseAdmin.storage
        .from(bucket)
        .upload(`${storageUser.id}/test.jpg`, photo, { contentType: "image/jpeg", upsert: true });
      expect(error).toBeNull();
    }

    const del = await deleteAccount(storageUser, CONFIRMED);
    expect(del.statusCode).toBe(204);

    for (const bucket of USER_STORAGE_BUCKETS) {
      const { data: remaining } = await app.supabaseAdmin.storage.from(bucket).list(storageUser.id);
      expect(remaining ?? []).toHaveLength(0);
    }
  });

  // Cas du fichier orphelin de post-media (constat du 2026-10-14) : un fichier
  // qui refuse de s'effacer. Le compte est supprimé quand même (décision du
  // fondateur du 2026-10-15) ; le fichier reste, compté au journal du
  // serveur, pour un nettoyage ultérieur.
  it("deletes the account even when a file refuses to be erased", async () => {
    const user = await createTestUser(app, "accf");
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#1E3D32" } }).jpeg().toBuffer();
    const path = `${user.id}/incident.jpg`;
    expect((await app.supabaseAdmin.storage.from("post-media").upload(path, photo, { contentType: "image/jpeg" })).error).toBeNull();

    const storage = app.supabaseAdmin.storage;
    const realFrom = storage.from.bind(storage);
    const spy = vi.spyOn(storage, "from").mockImplementation((bucket: string) => {
      const files = realFrom(bucket);
      if (bucket === "post-media") files.remove = async () => Promise.reject(new Error("panne simulée du stockage"));
      return files;
    });
    try {
      const del = await deleteAccount(user, CONFIRMED);
      expect(del.statusCode).toBe(204);
      expect(await profileExists(user.id)).toBe(false);
    } finally {
      spy.mockRestore();
    }

    const { data } = await app.supabaseAdmin.storage.from("post-media").list(user.id);
    expect((data ?? []).map((file) => file.name)).toEqual(["incident.jpg"]);
    expect((await app.supabaseAdmin.storage.from("post-media").remove([path])).error).toBeNull();
  });
});
