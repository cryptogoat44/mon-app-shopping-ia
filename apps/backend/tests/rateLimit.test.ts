import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { authHeaders, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";
import { registerHit } from "../src/plugins/rateLimit.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";

describe("rate limit window logic", () => {
  it("allows up to max, blocks past it, then resets once the window elapses", async () => {
    const rule = { max: 3, windowMs: 200 };
    const key = `unit-test:${Date.now()}:${Math.random()}`;

    expect(registerHit(key, rule).allowed).toBe(true);
    expect(registerHit(key, rule).allowed).toBe(true);
    expect(registerHit(key, rule).allowed).toBe(true);

    const blocked = registerHit(key, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.retryAfterMs).toBeLessThanOrEqual(rule.windowMs);

    await new Promise((resolve) => setTimeout(resolve, rule.windowMs + 20));

    expect(registerHit(key, rule).allowed).toBe(true);
  });
});

describe("rate limit enforcement on a real route", () => {
  let app: FastifyInstance;
  let reporter: TestUser;
  let target: TestUser;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    app = await buildTestApp();
    reporter = await createTestUser(app, "rl");
    target = await createTestUser(app, "rlt");
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await deleteTestUser(app, reporter.id);
    await deleteTestUser(app, target.id);
    await app.close();
  });

  it("returns 429 with a clear message once the report limit is exceeded", async () => {
    // La limitation est désactivée par défaut sous Vitest (NODE_ENV=test,
    // fixé automatiquement) — on la réactive juste pour ce test, le temps
    // de vérifier qu'elle fonctionne vraiment, puis on la restaure dans
    // afterAll.
    process.env.NODE_ENV = "development";

    for (let i = 0; i < RATE_LIMITS.report.max; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/reports",
        headers: authHeaders(reporter.token),
        payload: { targetType: "user", targetId: target.id, reason: "spam" },
      });
      expect(res.statusCode).toBe(204);
    }

    const blocked = await app.inject({
      method: "POST",
      url: "/api/reports",
      headers: authHeaders(reporter.token),
      payload: { targetType: "user", targetId: target.id, reason: "spam" },
    });

    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(blocked.json()).toEqual({
      error: "rate_limited",
      message: "Trop de tentatives en peu de temps. Réessayez dans quelques instants.",
    });
  });
});
