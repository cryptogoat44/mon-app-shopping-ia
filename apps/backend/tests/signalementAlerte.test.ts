import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

// Fusion du lot garde-fous avec le chantier 3 (comptes et modération) : les
// deux envoyaient une alerte Sentry à chaque signalement. Il n'en reste
// qu'UNE (captureModerationEvent), avec le tag « alerte » de la règle unique
// d'ALERTES.md, et rien sur la personne qui signale (ni compte, ni note).
// Hors base : Sentry et la base sont simulés, rien n'est envoyé.
vi.mock("@sentry/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@sentry/node")>();
  const scope = { setTags: vi.fn(), setTag: vi.fn(), setUser: vi.fn(), setFingerprint: vi.fn() };
  return {
    ...original,
    init: vi.fn(),
    captureMessage: vi.fn(),
    captureException: vi.fn(),
    withScope: (callback: (s: typeof scope) => void) => callback(scope),
    __scope: scope,
  };
});

import * as Sentry from "@sentry/node";
import { initSentry, moderationEventTags } from "../src/lib/sentry.js";
import reportsRoutes from "../src/routes/reports.js";
import { fakeSupabase } from "./fakeSupabase.js";

const REPORTER = "99999999-9999-4999-8999-999999999999";
const TARGET = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";
type Mock = ReturnType<typeof vi.fn>;
const scope = (Sentry as unknown as { __scope: { setTags: Mock; setTag: Mock; setUser: Mock; setFingerprint: Mock } }).__scope;
const captureMessage = vi.mocked(Sentry.captureMessage);

describe("signalement : une seule alerte, rien sur la personne qui signale", () => {
  let app: FastifyInstance;
  let autoHideOutcome = "below_threshold";

  beforeAll(async () => {
    initSentry("https://cle@o1.ingest.de.sentry.io/1", "test");
    app = Fastify({ logger: false });
    app.decorate("requireAuth", async (request: FastifyRequest) => {
      request.user = { id: REPORTER } as never;
    });
    app.decorate("rateLimit", () => async () => {});
    // Lot « corrections en ligne » : une publication ne se signale que si on
    // la voit ; celle-ci est publique, d'un autre compte.
    const fake = fakeSupabase({ rpc: async () => ({ data: [{ outcome: autoHideOutcome, action_id: null }], error: null }) });
    fake.table("posts").push({ id: TARGET, user_id: AUTHOR, type: "lifestyle", privacy: "public", hidden_at: null, created_at: "2026-11-01T12:00:00Z" });
    app.decorate("supabaseAdmin", fake.db as never);
    await app.register(reportsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    captureMessage.mockClear();
    for (const fn of Object.values(scope)) fn.mockClear();
  });

  const report = () =>
    app.inject({
      method: "POST",
      url: "/api/reports",
      payload: { targetType: "post", targetId: TARGET, reason: "spam", note: "Note privée de Camille" },
    });

  it("un signalement : exactement un avertissement Sentry, tag « alerte »", async () => {
    expect((await report()).statusCode).toBe(204);
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage).toHaveBeenCalledWith("Nouveau signalement à traiter : post (spam)", "warning");
    expect(scope.setTags).toHaveBeenCalledWith({ alerte: "signalement", moderation: "report", target_type: "post", reason: "spam" });
    expect(scope.setUser).not.toHaveBeenCalled();
    const sent = JSON.stringify([captureMessage.mock.calls, scope.setTags.mock.calls, scope.setTag.mock.calls, scope.setFingerprint.mock.calls]);
    expect(sent).not.toContain(REPORTER);
    expect(sent).not.toContain("Camille");
  });

  it("le 3e signalement qui masque le contenu : l'alerte du signalement, plus celle du masquage", async () => {
    autoHideOutcome = "ok";
    expect((await report()).statusCode).toBe(204);
    autoHideOutcome = "below_threshold";
    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(scope.setTags.mock.calls.map(([tags]) => tags.alerte)).toEqual(["signalement", "masquage_auto"]);
    expect(JSON.stringify(scope.setFingerprint.mock.calls)).not.toContain(REPORTER);
  });

  it("tags : des listes fermées seulement", () => {
    expect(moderationEventTags({ kind: "auto_hide", targetType: "comment", targetId: TARGET })).toEqual({
      alerte: "masquage_auto",
      moderation: "auto_hide",
      target_type: "comment",
    });
  });
});
