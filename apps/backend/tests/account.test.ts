import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

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

  it("records consents and reflects grantedAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/consents",
      headers: authHeaders(user.token),
      payload: { types: ["terms", "privacy_policy"] },
    });
    expect(res.statusCode).toBe(204);

    const status = await app.inject({ method: "GET", url: "/api/consents", headers: authHeaders(user.token) });
    const terms = status.json().find((c: { type: string }) => c.type === "terms");
    const marketing = status.json().find((c: { type: string }) => c.type === "marketing_email");
    expect(terms.grantedAt).not.toBeNull();
    expect(marketing.grantedAt).toBeNull();
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
});
