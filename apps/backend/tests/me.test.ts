import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("me", () => {
  let app: FastifyInstance;
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "mea");
    other = await createTestUser(app, "meb");
  });

  afterAll(async () => {
    await deleteTestUser(app, user.id);
    await deleteTestUser(app, other.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the profile with zeroed follow counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(user.id);
    expect(body.username).toBe(user.username);
    expect(body.followersCount).toBe(0);
    expect(body.followingCount).toBe(0);
  });

  it("rejects an invalid username format", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: "AB", displayName: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing displayName", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: user.username },
    });
    expect(res.statusCode).toBe(400);
  });

  it("updates displayName and bio", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: user.username, displayName: "Updated Name", bio: "hello there" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("Updated Name");
    expect(res.json().bio).toBe("hello there");
  });

  it("rejects a username already taken by another user", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: authHeaders(user.token),
      payload: { username: other.username, displayName: "Trying to steal" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("records the interface language (lot 3)", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload: { locale: "en" } });
    expect(res.statusCode).toBe(204);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.json().locale).toBe("en");
    const back = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload: { locale: "fr" } });
    expect(back.statusCode).toBe(204);
  });

  it("rejects an unsupported or missing language, and an anonymous request", async () => {
    for (const payload of [{ locale: "de" }, { locale: 1 }, {}]) {
      const res = await app.inject({ method: "PUT", url: "/api/me/locale", headers: authHeaders(user.token), payload });
      expect(res.statusCode).toBe(400);
    }
    const anonymous = await app.inject({ method: "PUT", url: "/api/me/locale", payload: { locale: "en" } });
    expect(anonymous.statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: authHeaders(user.token) });
    expect(me.json().locale).toBe("fr");
  });
});
