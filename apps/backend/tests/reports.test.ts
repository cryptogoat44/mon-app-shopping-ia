import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

describe("reports", () => {
  let app: FastifyInstance;
  let reporter: TestUser;
  let target: TestUser;

  beforeAll(async () => {
    app = await buildTestApp();
    reporter = await createTestUser(app, "rptr");
    target = await createTestUser(app, "rtgt");
  });

  afterAll(async () => {
    await deleteTestUser(app, reporter.id);
    await deleteTestUser(app, target.id);
    await app.close();
  });

  it("rejects a request with no token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid target type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "post_or_something", targetId: target.id, reason: "spam" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "user", targetId: target.id, reason: "because" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing targetId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "user", reason: "spam" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("records a valid report", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "user", targetId: target.id, reason: "harassment", note: "test note" },
    });
    expect(res.statusCode).toBe(204);

    const { data } = await app.supabaseAdmin
      .from("reports")
      .select("*")
      .eq("reporter_id", reporter.id)
      .eq("target_id", target.id)
      .maybeSingle();
    expect(data?.reason).toBe("harassment");
    expect(data?.target_type).toBe("user");
    expect(data?.note).toBe("test note");
  });

  it("accepts a report without a note", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "post", targetId: target.id, reason: "spam" },
    });
    expect(res.statusCode).toBe(204);
  });
});
