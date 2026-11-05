import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_HIDE_DISTINCT_REPORTERS, autoHideIfReported, isAutoHideTarget, resetAutoHideProbe, type AutoHideRpc } from "../src/lib/autoHide.js";
import { REPORTED_IDS_LIMIT, notInFilter, reportedIdsFor } from "../src/lib/reportedByViewer.js";
import { captureModerationEvent, moderationEventMessage } from "../src/lib/sentry.js";

// Chantier 3 (point 6) : masquage automatique après plusieurs signalements,
// contenu signalé retiré de ce que voit la personne qui l'a signalé, alerte.
// Hors base : la base est remplacée par des faux.

const ID = "11111111-1111-4111-8111-111111111111";
const ACTION = "22222222-2222-4222-8222-222222222222";

function fakeLog() {
  return { warn: vi.fn(), error: vi.fn() };
}

function rpcReturning(result: { data: unknown; error: { code?: string } | null }) {
  return vi.fn<AutoHideRpc>(async () => result);
}

afterEach(() => resetAutoHideProbe());

describe("masquage automatique après plusieurs signalements", () => {
  it("demande à la base le seuil de 3 personnes différentes, pour les seuls contenus qui se masquent", async () => {
    const rpc = rpcReturning({ data: [{ outcome: "ok", action_id: ACTION }], error: null });
    expect(await autoHideIfReported(rpc, fakeLog(), "post", ID)).toBe("hidden");
    expect(rpc).toHaveBeenCalledWith("moderation_auto_hide", { p_target_type: "post", p_target_id: ID, p_threshold: 3 });
    expect(AUTO_HIDE_DISTINCT_REPORTERS).toBe(3);
    expect(isAutoHideTarget("comment")).toBe(true);
    expect(isAutoHideTarget("piece")).toBe(true);
    expect(isAutoHideTarget("user")).toBe(false);
  });

  it("un profil signalé ne se masque jamais (il se suspend)", async () => {
    const rpc = rpcReturning({ data: [{ outcome: "ok", action_id: ACTION }], error: null });
    expect(await autoHideIfReported(rpc, fakeLog(), "user", ID)).toBe("not_hidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pas encore assez de personnes, ou déjà masqué : rien ne change", async () => {
    for (const outcome of ["below_threshold", "already_hidden", "target_not_found"]) {
      const rpc = rpcReturning({ data: [{ outcome, action_id: null }], error: null });
      expect(await autoHideIfReported(rpc, fakeLog(), "comment", ID)).toBe("not_hidden");
    }
  });

  it("sans la migration 0030 : un seul avertissement, puis plus aucun appel pendant 5 minutes", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const log = fakeLog();
    const rpc = rpcReturning({ data: null, error: { code: "PGRST202" } });
    expect(await autoHideIfReported(rpc, log, "post", ID, now)).toBe("unavailable");
    expect(await autoHideIfReported(rpc, log, "post", ID, now)).toBe("unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    clock += 5 * 60_000;
    expect(await autoHideIfReported(rpc, log, "post", ID, now)).toBe("unavailable");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("une erreur ou une exception est journalisée, sans jamais lever", async () => {
    const log = fakeLog();
    expect(await autoHideIfReported(rpcReturning({ data: null, error: { code: "57014" } }), log, "post", ID)).toBe("failed");
    expect(await autoHideIfReported(rpcReturning({ data: "n'importe quoi", error: null }), log, "post", ID)).toBe("failed");
    const throwing = vi.fn<AutoHideRpc>(async () => {
      throw new Error("réseau");
    });
    expect(await autoHideIfReported(throwing, log, "post", ID)).toBe("failed");
    expect(log.error).toHaveBeenCalledTimes(3);
  });
});

describe("contenus signalés par la personne", () => {
  function fakeDb(result: { data: unknown; error: { code?: string } | null }) {
    const calls: unknown[][] = [];
    const chain = {
      select: (...args: unknown[]) => (calls.push(["select", ...args]), chain),
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), chain),
      order: (...args: unknown[]) => (calls.push(["order", ...args]), chain),
      limit: (...args: unknown[]) => (calls.push(["limit", ...args]), Promise.resolve(result)),
    };
    const db = { from: (table: string) => (calls.push(["from", table]), chain) };
    return { fastify: { supabaseAdmin: db } as never, calls };
  }

  it("lit ses signalements du type demandé, les plus récents, sans doublon", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const { fastify, calls } = fakeDb({ data: [{ target_id: ID }, { target_id: other }, { target_id: ID }], error: null });
    expect(await reportedIdsFor(fastify, fakeLog(), "viewer", "post")).toEqual([ID, other]);
    expect(calls).toContainEqual(["from", "reports"]);
    expect(calls).toContainEqual(["eq", "reporter_id", "viewer"]);
    expect(calls).toContainEqual(["eq", "target_type", "post"]);
    expect(calls).toContainEqual(["limit", REPORTED_IDS_LIMIT]);
  });

  it("lecture impossible : rien n'est retiré, le fil s'affiche quand même", async () => {
    const log = fakeLog();
    const { fastify } = fakeDb({ data: null, error: { code: "57014" } });
    expect(await reportedIdsFor(fastify, log, "viewer", "comment")).toEqual([]);
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it("filtre « not in » seulement s'il y a quelque chose à retirer", () => {
    expect(notInFilter([])).toBeNull();
    expect(notInFilter([ID, ACTION])).toBe(`(${ID},${ACTION})`);
  });
});

describe("alerte de l'administrateur (Sentry)", () => {
  it("décrit l'événement sans rien dire de la personne qui signale", () => {
    expect(moderationEventMessage({ kind: "report", targetType: "post", targetId: ID, reason: "harassment" })).toBe(
      "Nouveau signalement à traiter : post (harassment)"
    );
    expect(moderationEventMessage({ kind: "auto_hide", targetType: "comment", targetId: ID })).toBe(
      "Contenu masqué automatiquement (plusieurs signalements) : comment"
    );
  });

  it("sans Sentry configuré (tests, développement) : rien n'est envoyé, rien ne plante", () => {
    expect(() => captureModerationEvent({ kind: "report", targetType: "post", targetId: ID })).not.toThrow();
  });
});
