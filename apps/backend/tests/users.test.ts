import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("users search", () => {
  let app: FastifyInstance;
  let searcher: TestUser;
  let match: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    searcher = await createTestUser(app, "srch");
    match = await createTestUser(app, "mtch");
  });

  afterAll(async () => {
    await deleteTestUser(app, searcher.id);
    await deleteTestUser(app, match.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: `/api/users/search?q=${match.username}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an empty query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/users/search?q=", headers: authHeaders(searcher.token) });
    expect(res.statusCode).toBe(400);
  });

  it("finds a profile by exact username", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${match.username}`,
      headers: authHeaders(searcher.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.some((p: { id: string; username: string }) => p.id === match.id && p.username === match.username)).toBe(
      true
    );
  });

  it("finds a profile by partial username", async () => {
    const partial = match.username.slice(0, -2);
    const res = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${partial}`,
      headers: authHeaders(searcher.token),
    });
    expect(res.json().some((p: { id: string }) => p.id === match.id)).toBe(true);
  });

  it("never returns yourself", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${searcher.username}`,
      headers: authHeaders(searcher.token),
    });
    expect(res.json().some((p: { id: string }) => p.id === searcher.id)).toBe(false);
  });

  it("reflects isFollowing correctly", async () => {
    const before = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${match.username}`,
      headers: authHeaders(searcher.token),
    });
    expect(before.json().find((p: { id: string }) => p.id === match.id).isFollowing).toBe(false);

    await app.inject({ method: "POST", url: `/api/follows/${match.id}`, headers: authHeaders(searcher.token) });

    const after = await app.inject({
      method: "GET",
      url: `/api/users/search?q=${match.username}`,
      headers: authHeaders(searcher.token),
    });
    expect(after.json().find((p: { id: string }) => p.id === match.id).isFollowing).toBe(true);
  });
});
