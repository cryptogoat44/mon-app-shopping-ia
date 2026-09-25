import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
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
  let user: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "accd");
  });

  afterAll(async () => {
    await app.close();
  });

  it("deletes the account and invalidates its token", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/me", headers: authHeaders(user.token) });
    expect(del.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.statusCode).toBe(401);

    const { data } = await app.supabaseAdmin.from("profiles").select("id").eq("id", user.id).maybeSingle();
    expect(data).toBeNull();
  });

  it("removes files from every storage bucket, including avatars", async () => {
    const storageUser = await createTestUser(app, "accs");
    const content = Buffer.from("fichier de test");

    for (const bucket of USER_STORAGE_BUCKETS) {
      const { error } = await app.supabaseAdmin.storage
        .from(bucket)
        .upload(`${storageUser.id}/test.txt`, content, { contentType: "text/plain", upsert: true });
      expect(error).toBeNull();
    }

    const del = await app.inject({ method: "DELETE", url: "/api/me", headers: authHeaders(storageUser.token) });
    expect(del.statusCode).toBe(204);

    for (const bucket of USER_STORAGE_BUCKETS) {
      const { data: remaining } = await app.supabaseAdmin.storage.from(bucket).list(storageUser.id);
      expect(remaining ?? []).toHaveLength(0);
    }
  });
});
