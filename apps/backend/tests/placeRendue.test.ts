import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";

// 0027, test demandé par le fondateur (25 octobre) : la place d'une recherche
// refusée par le fournisseur est rendue dans les TROIS plafonds (le jour et le
// mois du service, la part de la personne), et la réponse le dit. Vraie route,
// vraie base (spotto-dev) et vraies fonctions du plafond ; seul le fournisseur
// est simulé (safeFetch remplacé : aucun appel à SerpApi, aucun crédit).
// Les plafonds sont lus à l'heure réelle : les fichiers de tests passent un
// par un, et un seul passage à la fois sur spotto-dev (verifications.yml).
vi.mock("../src/lib/safeFetch.js", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../src/lib/safeFetch.js";
import { env } from "../src/env.js";
import { QUOTA_ROWS } from "../src/lib/searchCapacity.js";
import { authHeaders, buildMultipart, buildTestApp, createTestUser, deleteTestUser, type TestUser } from "./helpers.js";

const safeFetchMock = vi.mocked(safeFetch);

// Une vraie image JPEG (charte, règle 18).
const IMAGE = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#6b4a3a" } }).jpeg().toBuffer();

/** Plafonds très hauts pendant le test : il ne doit jamais buter sur l'un d'eux. */
const HIGH_CAPS = { SERPAPI_DAILY_CAP: 1_000_000, SERPAPI_MONTHLY_CAP: 1_000_000, SERPAPI_USER_DAILY_CAP: 1_000 };

describe("place rendue dans les trois plafonds quand le fournisseur refuse (0027)", () => {
  let app: FastifyInstance;
  let user: TestUser;
  const saved = { SERPAPI_DAILY_CAP: env.SERPAPI_DAILY_CAP, SERPAPI_MONTHLY_CAP: env.SERPAPI_MONTHLY_CAP, SERPAPI_USER_DAILY_CAP: env.SERPAPI_USER_DAILY_CAP };
  const start = new Date(Date.now() - 60_000);

  /** Les trois compteurs, lus sans rien réserver : jour et mois du service, part de la personne. */
  async function counters() {
    const { data, error } = await app.supabaseAdmin.rpc("serpapi_quota", {
      p_daily_cap: HIGH_CAPS.SERPAPI_DAILY_CAP,
      p_monthly_cap: HIGH_CAPS.SERPAPI_MONTHLY_CAP,
      p_user_daily_cap: HIGH_CAPS.SERPAPI_USER_DAILY_CAP,
      p_renewal_day: env.SERPAPI_RENEWAL_DAY,
      p_user_id: user.id,
      p_reserve: false,
    });
    expect(error).toBeNull();
    const row = QUOTA_ROWS.parse(data)[0]!;
    return { day: row.day_count, month: row.month_count, user: row.user_day_count };
  }

  /** Une recherche par photo, de la préparation au lancement ; le fournisseur répond `reply`. */
  async function launch(reply: () => Promise<Response>) {
    const prepared = await app.inject({ method: "POST", url: "/api/searches/prepare", headers: authHeaders(user.token), payload: {} });
    expect(prepared.statusCode).toBe(200);
    const id = z.object({ id: z.string() }).parse(prepared.json()).id;
    safeFetchMock.mockImplementationOnce(reply);
    const mp = buildMultipart({}, { fieldname: "file", filename: "photo.jpg", contentType: "image/jpeg", data: IMAGE });
    const res = await app.inject({ method: "POST", url: `/api/searches/${id}/run`, headers: { ...authHeaders(user.token), ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    const { data } = await app.supabaseAdmin.from("product_searches").select("status, outcome, failure_kind, provider, provider_status_code").eq("id", id).single();
    return { body: res.json(), row: data };
  }

  const refusal = async () => new Response(JSON.stringify({ error: "Your account has run out of searches." }), { status: 429, headers: { "content-type": "application/json" } });

  beforeAll(async () => {
    app = await buildTestApp();
    user = await createTestUser(app, "place");
    Object.assign(env, HIGH_CAPS);
  });

  beforeEach(() => {
    safeFetchMock.mockReset();
  });

  afterAll(async () => {
    Object.assign(env, saved);
    await app.supabaseAdmin.from("serpapi_calls").delete().gte("called_at", start.toISOString());
    await deleteTestUser(app, user.id);
    await app.close();
  });

  it("refus du fournisseur : les trois compteurs reviennent à leur valeur de départ, et la réponse dit « non comptée »", async () => {
    const before = await counters();
    const { body, row } = await launch(refusal);

    expect(safeFetchMock).toHaveBeenCalledOnce();
    expect(body).toMatchObject({ status: "failed", errorMessage: "La recherche visuelle a échoué.", notCounted: true });
    expect(row).toEqual({ status: "failed", outcome: "failure", failure_kind: "provider_refused", provider: "serpapi", provider_status_code: 429 });
    expect(await counters()).toEqual(before);
  });

  it("délai dépassé (facturation incertaine) : les trois compteurs augmentent de 1, et la réponse ne dit pas « non comptée »", async () => {
    const before = await counters();
    const { body, row } = await launch(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });

    expect(body).toMatchObject({ status: "failed", notCounted: false });
    expect(row).toMatchObject({ failure_kind: "timeout", provider: "serpapi", provider_status_code: null });
    expect(await counters()).toEqual({ day: before.day + 1, month: before.month + 1, user: before.user + 1 });
  });

  it("retour de place en panne (simulée) : la place reste comptée partout, et la réponse ne dit pas « non comptée »", async () => {
    const realRpc = app.supabaseAdmin.rpc.bind(app.supabaseAdmin);
    const spy = vi.spyOn(app.supabaseAdmin, "rpc").mockImplementation(((fn: string, args?: Record<string, unknown>) =>
      fn === "serpapi_release"
        ? Promise.resolve({ data: null, error: { message: "panne simulée", details: "", hint: "", code: "08006" } })
        : realRpc(fn, args)) as unknown as typeof app.supabaseAdmin.rpc);
    try {
      const before = await counters();
      const { body, row } = await launch(refusal);

      expect(spy.mock.calls.some(([fn]) => fn === "serpapi_release")).toBe(true);
      expect(body).toMatchObject({ status: "failed", notCounted: false });
      expect(row).toMatchObject({ failure_kind: "provider_error", provider_status_code: 429 });
      expect(await counters()).toEqual({ day: before.day + 1, month: before.month + 1, user: before.user + 1 });
    } finally {
      spy.mockRestore();
    }
  });
});
