import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("blocks", () => {
  let app: FastifyInstance;
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    a = await createTestUser(app, "blka");
    b = await createTestUser(app, "blkb");

    // A et B se suivent mutuellement avant le blocage, pour vérifier que ça
    // rompt bien les deux abonnements.
    await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    await app.inject({ method: "POST", url: `/api/follows/${a.id}`, headers: authHeaders(b.token) });
  });

  afterAll(async () => {
    await deleteTestUser(app, a.id);
    await deleteTestUser(app, b.id);
    await app.close();
  });

  it("rejects blocking yourself", async () => {
    const res = await app.inject({ method: "POST", url: `/api/blocks/${a.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(400);
  });

  it("finds each other in search before blocking", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${b.username}`,
      headers: authHeaders(a.token),
    });
    expect(res.json().some((p: { id: string }) => p.id === b.id)).toBe(true);
  });

  it("A blocks B", async () => {
    const res = await app.inject({ method: "POST", url: `/api/blocks/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);
  });

  it("clears the mutual follow relationship", async () => {
    const meA = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(a.token) });
    const meB = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(b.token) });
    expect(meA.json().followersCount).toBe(0);
    expect(meA.json().followingCount).toBe(0);
    expect(meB.json().followersCount).toBe(0);
    expect(meB.json().followingCount).toBe(0);
  });

  it("hides both profiles from each other's search, in both directions", async () => {
    const aSearchesB = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${b.username}`,
      headers: authHeaders(a.token),
    });
    expect(aSearchesB.json().some((p: { id: string }) => p.id === b.id)).toBe(false);

    const bSearchesA = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${a.username}`,
      headers: authHeaders(b.token),
    });
    expect(bSearchesA.json().some((p: { id: string }) => p.id === a.id)).toBe(false);
  });

  it("prevents a new follow in either direction while blocked", async () => {
    const bFollowsA = await app.inject({ method: "POST", url: `/api/follows/${a.id}`, headers: authHeaders(b.token) });
    expect(bFollowsA.statusCode).toBe(403);

    const aFollowsB = await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(aFollowsB.statusCode).toBe(403);
  });

  it("lists the blocked user via GET /api/blocks", async () => {
    const res = await app.inject({ method: "GET", url: "/api/blocks", headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((u: { id: string }) => u.id === b.id)).toBe(true);
  });

  it("unblocks", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/blocks/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/blocks", headers: authHeaders(a.token) });
    expect(list.json().some((u: { id: string }) => u.id === b.id)).toBe(false);
  });

  it("allows following again after unblock", async () => {
    const res = await app.inject({ method: "POST", url: `/api/follows/${b.id}`, headers: authHeaders(a.token) });
    expect(res.statusCode).toBe(204);
  });
});
