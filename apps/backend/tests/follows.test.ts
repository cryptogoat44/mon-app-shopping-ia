import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("follows", () => {
  let app: FastifyInstance;
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    a = await createTestUser(app, "flwa");
    b = await createTestUser(app, "flwb");
  });

  afterAll(async () => {
    await deleteTestUser(app, a.id);
    await deleteTestUser(app, b.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "POST", url: `/api/follows/${b.id}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects following yourself", async () => {
    const res = await app.inject({ method: "POST", url: `/api/follows/${a.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(400);
  });

  it("404s on a non-existent target", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/follows/00000000-0000-0000-0000-000000000000`,
      headers: authHeaders(a.token),
    });
    expect(res.statusCode).toBe(404);
  });

  it("follows a user", async () => {
    const res = await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);
  });

  it("is idempotent — following twice does not error", async () => {
    const res = await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);
  });

  it("shows up in the followee's follower count via /api/me", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(b.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().followersCount).toBe(1);
  });

  it("unfollows a user", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(b.token) });
    expect(me.json().followersCount).toBe(0);
  });

  it("unfollowing someone you don't follow is a no-op, not an error", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);
  });
});
