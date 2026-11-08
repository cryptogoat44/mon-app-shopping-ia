import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_FAILURE_MESSAGES, type ProductMatch, type ProductSearch, type SearchStatus } from "@monapp/shared-types";

// Lot recherche coupée : une recherche coupée (réseau perdu, retour sur
// TikTok, « Annuler ») se retrouve, elle ne se repaie pas. Serveur SIMULÉ :
// aucun appel réseau, aucun appel payant.
const { runSearch, prepareSearch, fetchSearch, track, reportUnexpectedError } = vi.hoisted(() => ({
  runSearch: vi.fn(),
  prepareSearch: vi.fn(),
  fetchSearch: vi.fn(),
  track: vi.fn(),
  reportUnexpectedError: vi.fn(),
}));
// La vraie classe ApiError : celle que reconnaît la logique de reprise.
vi.mock("../src/lib/api", async () => ({ ApiError: (await import("../src/lib/api-error")).ApiError, runSearch, prepareSearch, fetchSearch }));
vi.mock("../src/lib/analytics", () => ({ track }));
vi.mock("../src/lib/error-tracking", () => ({ reportUnexpectedError }));

import { getLastSpotResult } from "../src/api/spotSession";
import { ApiError } from "../src/lib/api-error";
import { failureCorrections } from "../src/lib/spot-corrections";
import { getDraft, updateDraft } from "../src/lib/spot-draft";
import { beginFromPhoto } from "../src/lib/spot-flow";
import { checkSearch, identifyDraft } from "../src/lib/spot-identify";
import {
  READ_ATTEMPTS,
  RECHECK_INTERVAL_MS,
  RUNNING_LIMIT_MS,
  launchOutcomeUnknown,
  notifyAppForeground,
  recheckOnReturn,
  recoverSearch,
  resumeStep,
  sameLaunch,
  searchProgress,
  unsettledAction,
  type RecoveryPorts,
} from "../src/lib/spot-recovery";
import { toSpotResult } from "../src/lib/spot-result";

const BOX = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };

const MATCH: ProductMatch = {
  id: "m1",
  rank: 1,
  productName: "Veste en daim",
  brand: null,
  imageUrl: "https://example.com/v.jpg",
  priceMin: 120,
  priceMax: 120,
  currency: "EUR",
  merchantName: "Example",
  merchantUrl: "https://example.com/v",
  imageHdUrl: null,
  affiliateUrl: "https://example.com/v",
  feedbackReason: null,
};

function search(status: SearchStatus, extra: Partial<ProductSearch> = {}): ProductSearch {
  return {
    id: "recherche-1",
    sourceUrl: null,
    sourcePlatform: "photo",
    method: "manual_screenshot",
    thumbnailUrl: null,
    status,
    errorMessage: null,
    query: null,
    createdAt: "2026-11-03T08:00:00Z",
    matches: status === "completed" ? [MATCH] : [],
    ...extra,
  };
}
/** Panne du service, ou recherche marquée interrompue au bout de 2 minutes : même message côté serveur. */
const interrupted = () => search("failed", { errorMessage: SEARCH_FAILURE_MESSAGES.technical });
const noMatch = () => search("failed", { errorMessage: SEARCH_FAILURE_MESSAGES.noMatch });

/** Relectures simulées ; la dernière réponse se répète. Une horloge avance à chaque attente. */
function fakePorts(answers: Array<ProductSearch | Error>) {
  let clock = 0;
  const read = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0]!;
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const ports: RecoveryPorts = { read, sleep, now: () => clock };
  return { ports, read, sleep };
}

describe("où en est une recherche relue", () => {
  it("jamais partie, en cours, terminée, « rien trouvé » (un vrai résultat), en échec ou interrompue", () => {
    expect(searchProgress(search("pending"))).toBe("not_started");
    expect(searchProgress(search("processing"))).toBe("running");
    expect(searchProgress(search("completed"))).toBe("finished");
    expect(searchProgress(noMatch())).toBe("finished");
    expect(searchProgress(interrupted())).toBe("failed");
  });

  it("une recherche en cours n'est jamais prise pour « rien trouvé », et n'offre aucune correction payante", () => {
    expect(toSpotResult(search("processing"))).toMatchObject({ status: "failed", failReason: "running" });
    expect(failureCorrections("running", { hasDraft: true, hasVideo: true, remainingMoments: 2, fromLink: false })).toEqual([]);
    // En pause (lot garde-fous) : un nouvel essai serait refusé jusqu'à la fin de la pause.
    expect(failureCorrections("paused", { hasDraft: true, hasVideo: true, remainingMoments: 2, fromLink: false })).toEqual([]);
  });
});

describe("issue du lancement inconnue : la recherche est relue", () => {
  it.each([
    ["réseau coupé (site)", new TypeError("Failed to fetch"), true],
    ["réseau coupé (iPhone)", new Error("fetch failed: The network connection was lost."), true],
    ["délai dépassé (iPhone)", new Error("fetch failed: The request timed out."), true],
    ["serveur en panne", new ApiError(500, { error: "search_save_failed", message: "…" }), true],
    ["serveur redémarré", new ApiError(502, { error: "unknown", message: "…" }), true],
    ["délai dépassé (serveur)", new ApiError(504, { error: "unknown", message: "…" }), true],
    ["déjà lancée (relance croisée)", new ApiError(409, { error: "search_already_run", message: "…" }), true],
    ["plafond atteint, avant tout appel", new ApiError(429, { error: "search_capacity_user", message: "…" }), false],
    // Lot garde-fous : le disjoncteur refuse avant tout appel ; l'écran dit « en pause », sans relire.
    ["recherche en pause (fournisseur en panne), avant tout appel", new ApiError(503, { error: "search_paused", message: "…" }), false],
    ["image refusée, avant tout appel", new ApiError(422, { error: "preview_unavailable", message: "…" }), false],
    ["session expirée", new ApiError(401, { error: "unauthorized", message: "…" }), false],
    ["erreur de l'app", new Error("image illisible"), false],
  ])("%s : %s", (_label, error, unknown) => {
    expect(launchOutcomeUnknown(error)).toBe(unknown);
  });
});

describe("même image, même cadre, mêmes mots : la même recherche", () => {
  const previous = { searchId: "recherche-1", imageUri: "file:///photo.jpg", crop: BOX, words: "veste" };
  it("relancée à l'identique, elle est reconnue ; un autre cadre, d'autres mots ou une autre image, non", () => {
    expect(sameLaunch(previous, { imageUri: "file:///photo.jpg", crop: { ...BOX }, words: "veste" })).toBe(true);
    expect(sameLaunch(previous, { imageUri: "file:///photo.jpg", crop: { ...BOX, x: 0.25 }, words: "veste" })).toBe(false);
    expect(sameLaunch(previous, { imageUri: "file:///photo.jpg", crop: BOX, words: null })).toBe(false);
    expect(sameLaunch(previous, { imageUri: "file:///autre.jpg", crop: BOX, words: "veste" })).toBe(false);
    expect(sameLaunch(null, { imageUri: "file:///photo.jpg", crop: BOX, words: "veste" })).toBe(false);
  });
});

describe("relecture jusqu'à l'issue (seulement des lectures, gratuites)", () => {
  const signal = () => new AbortController().signal;

  it("terminée : son résultat, tout de suite", async () => {
    const { ports, sleep } = fakePorts([search("completed")]);
    expect(await recoverSearch("recherche-1", ports, signal())).toEqual({ kind: "settled", search: search("completed") });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("en cours : relue toutes les 3 s, jusqu'au résultat", async () => {
    const { ports, read, sleep } = fakePorts([search("processing"), search("processing"), search("completed")]);
    expect(await recoverSearch("recherche-1", ports, signal())).toMatchObject({ kind: "settled", search: { status: "completed" } });
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[RECHECK_INTERVAL_MS, expect.anything()], [RECHECK_INTERVAL_MS, expect.anything()]]);
  });

  it("interrompue ou en échec côté service : l'échec, à dire tel quel", async () => {
    const { ports } = fakePorts([interrupted()]);
    expect(await recoverSearch("recherche-1", ports, signal())).toEqual({ kind: "settled", search: interrupted() });
  });

  it("jamais partie : « Relancer » à proposer, sans autre lecture", async () => {
    const { ports, read } = fakePorts([search("pending")]);
    expect(await recoverSearch("recherche-1", ports, signal())).toEqual({ kind: "unsettled", state: "not_started" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("relecture impossible : retentée, puis Spotto injoignable ; le réseau qui revient entre-temps suffit", async () => {
    const offline = fakePorts([new TypeError("Failed to fetch")]);
    expect(await recoverSearch("recherche-1", offline.ports, signal())).toEqual({ kind: "unsettled", state: "unreachable" });
    expect(offline.read).toHaveBeenCalledTimes(READ_ATTEMPTS);
    const back = fakePorts([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), search("completed")]);
    expect(await recoverSearch("recherche-1", back.ports, signal())).toMatchObject({ kind: "settled" });
  });

  it("toujours en cours à la limite (le serveur la marque interrompue après 2 min) : on cesse d'attendre", async () => {
    const { ports, read } = fakePorts([search("processing")]);
    expect(await recoverSearch("recherche-1", ports, signal())).toEqual({ kind: "unsettled", state: "still_running" });
    expect(read).toHaveBeenCalledTimes(RUNNING_LIMIT_MS / RECHECK_INTERVAL_MS + 1);
  });

  it("« Annuler » : abandon, sans autre lecture", async () => {
    const abort = new AbortController();
    const { ports, read } = fakePorts([search("processing")]);
    ports.sleep = async () => abort.abort();
    expect(await recoverSearch("recherche-1", ports, abort.signal)).toEqual({ kind: "cancelled" });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("relance à l'identique, par un geste : relue d'abord", () => {
  it("terminée ou « rien trouvé » : montrée sans nouvel appel ; jamais partie : le même numéro ; en échec : une nouvelle recherche", () => {
    expect(resumeStep({ kind: "settled", search: search("completed") })).toEqual({ kind: "show", search: search("completed") });
    expect(resumeStep({ kind: "settled", search: noMatch() })).toEqual({ kind: "show", search: noMatch() });
    expect(resumeStep({ kind: "unsettled", state: "not_started" })).toEqual({ kind: "run_same" });
    expect(resumeStep({ kind: "settled", search: interrupted() })).toEqual({ kind: "run_fresh" });
  });

  it("injoignable ou toujours en cours : rien n'est lancé", () => {
    expect(resumeStep({ kind: "unsettled", state: "unreachable" })).toEqual({ kind: "unsettled", state: "unreachable" });
    expect(resumeStep({ kind: "unsettled", state: "still_running" })).toEqual({ kind: "unsettled", state: "still_running" });
    expect(resumeStep({ kind: "cancelled" })).toEqual({ kind: "cancelled" });
  });
});

describe("règle absolue : aucune relance sans geste de la personne", () => {
  it("jamais partie : « Relancer » (un geste), et rien au retour dans l'app", () => {
    expect(unsettledAction("not_started")).toBe("relaunch");
    expect(recheckOnReturn("not_started")).toBe(false);
  });

  it("injoignable ou toujours en cours : « Vérifier à nouveau », une relecture, refaite seule au retour dans l'app", () => {
    for (const state of ["unreachable", "still_running"] as const) {
      expect(unsettledAction(state)).toBe("check");
      expect(recheckOnReturn(state)).toBe(true);
    }
  });
});

describe("identification d'une photo coupée en route", () => {
  function photoDraft() {
    beginFromPhoto("file:///cache/photo.jpg", { width: 1200, height: 1600 });
    return updateDraft({ crop: BOX, words: "veste" })!;
  }
  /** Mène l'identification à son terme : attentes et délais simulés. */
  async function finish<T>(pending: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return pending;
  }
  /** Un lancement qui attend la réponse, et ne s'arrête que si on l'abandonne. */
  function hangingRun() {
    const signals: AbortSignal[] = [];
    runSearch.mockImplementationOnce(
      (_id: string, _params: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    );
    return signals;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    runSearch.mockReset();
    fetchSearch.mockReset();
    prepareSearch.mockReset();
    prepareSearch.mockResolvedValueOnce({ id: "recherche-1", thumbnailUrl: null }).mockResolvedValue({ id: "recherche-2", thumbnailUrl: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("réponse perdue (réseau), recherche terminée sur le serveur : son résultat s'affiche, sans second lancement", async () => {
    runSearch.mockRejectedValue(new TypeError("Network request failed"));
    fetchSearch.mockResolvedValue(search("completed"));
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(getLastSpotResult()).toMatchObject({ searchId: "recherche-1", status: "success" });
    expect(fetchSearch).toHaveBeenCalledWith("recherche-1", expect.anything());
    expect(runSearch).toHaveBeenCalledTimes(1);
    expect(prepareSearch).toHaveBeenCalledTimes(1);
    expect(getDraft()?.unsettled ?? null).toBeNull();
  });

  it.each([
    ["délai dépassé (iPhone)", new Error("fetch failed: The request timed out.")],
    ["serveur redémarré", new ApiError(502, { error: "unknown", message: "…" })],
  ])("%s : même relecture, le numéro est gardé", async (_label, error) => {
    runSearch.mockRejectedValue(error);
    fetchSearch.mockResolvedValue(search("completed"));
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("encore en cours : l'attente continue, relue toutes les 3 s, jusqu'au résultat", async () => {
    runSearch.mockRejectedValue(new TypeError("Network request failed"));
    fetchSearch.mockResolvedValueOnce(search("processing")).mockResolvedValueOnce(search("processing")).mockResolvedValue(search("completed"));
    const pending = identifyDraft(photoDraft(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS - 1);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSearch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS);
    expect(await pending).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("interrompue côté serveur : « n'a pas abouti », dit clairement, sans relance", async () => {
    runSearch.mockRejectedValue(new TypeError("Network request failed"));
    fetchSearch.mockResolvedValue(interrupted());
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(getLastSpotResult()).toMatchObject({ searchId: "recherche-1", status: "failed", failReason: "technical" });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("jamais partie : « Relancer » proposé, rien n'est relancé seul ; « Relancer » reprend le même numéro", async () => {
    runSearch.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(search("completed"));
    fetchSearch.mockResolvedValue(search("pending"));
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "unsettled", searchId: "recherche-1", state: "not_started" });
    expect(runSearch).toHaveBeenCalledTimes(1);

    // Le geste « Relancer » : le même brouillon, relu d'abord, puis lancé sous le même numéro.
    expect(await finish(identifyDraft(getDraft()!, new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch.mock.calls.map(([id]) => id)).toEqual(["recherche-1", "recherche-1"]);
    expect(prepareSearch).toHaveBeenCalledTimes(1);
  });

  it("Spotto injoignable : « Vérifier à nouveau » ne fait que relire, et affiche le résultat", async () => {
    runSearch.mockRejectedValue(new TypeError("Network request failed"));
    fetchSearch.mockRejectedValue(new TypeError("Network request failed"));
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "unsettled", searchId: "recherche-1", state: "unreachable" });

    fetchSearch.mockResolvedValue(search("completed"));
    expect(await finish(checkSearch("recherche-1", new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("« Vérifier à nouveau » sur une recherche jamais partie : rien n'est relancé", async () => {
    fetchSearch.mockResolvedValue(search("pending"));
    expect(await finish(checkSearch("recherche-1", new AbortController().signal))).toEqual({ kind: "unsettled", searchId: "recherche-1", state: "not_started" });
    expect(runSearch).not.toHaveBeenCalled();
  });

  it("refus avant tout appel (part du jour atteinte) : montré tel quel, sans relecture", async () => {
    runSearch.mockRejectedValue(new ApiError(429, { error: "search_capacity_user", message: "…" }));
    expect(await finish(identifyDraft(photoDraft(), new AbortController().signal))).toEqual({ kind: "done", searchId: null });
    expect(getLastSpotResult()).toMatchObject({ status: "failed", failReason: "capacity_user" });
    expect(fetchSearch).not.toHaveBeenCalled();
  });

  it("retour dans l'app pendant l'attente : la recherche déjà terminée l'emporte, la requête devenue inutile est abandonnée", async () => {
    const signals = hangingRun();
    fetchSearch.mockResolvedValue(search("completed"));
    const pending = identifyDraft(photoDraft(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSearch).not.toHaveBeenCalled();
    notifyAppForeground();
    expect(await finish(pending)).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(signals[0]?.aborted).toBe(true);
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("retour dans l'app, image encore en route (jamais partie) : la requête continue, rien n'est relancé", async () => {
    let answer: (value: ProductSearch) => void = () => {};
    runSearch.mockImplementationOnce(() => new Promise<ProductSearch>((resolve) => (answer = resolve)));
    fetchSearch.mockResolvedValue(search("pending"));
    const pending = identifyDraft(photoDraft(), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    notifyAppForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSearch).toHaveBeenCalledTimes(1);
    answer(search("completed"));
    expect(await finish(pending)).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it("« Annuler » puis « Lancer » sur la même image et le même cadre : la recherche annulée, terminée, s'affiche sans nouvel appel", async () => {
    hangingRun();
    const abort = new AbortController();
    const cancelled = identifyDraft(photoDraft(), abort.signal);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    expect(await cancelled).toEqual({ kind: "cancelled" });
    expect(getDraft()?.unsettled).toMatchObject({ searchId: "recherche-1", crop: BOX, words: "veste" });

    fetchSearch.mockResolvedValue(search("completed"));
    expect(await finish(identifyDraft(getDraft()!, new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
    expect(runSearch).toHaveBeenCalledTimes(1);
    expect(prepareSearch).toHaveBeenCalledTimes(1);
  });

  describe("« Annuler » puis « Lancer »", () => {
    /** Lancement de la photo en cours, annulé pendant l'attente. */
    async function cancelLaunch() {
      photoDraft();
      hangingRun();
      const abort = new AbortController();
      const cancelled = identifyDraft(getDraft()!, abort.signal);
      await vi.advanceTimersByTimeAsync(0);
      abort.abort();
      expect(await cancelled).toEqual({ kind: "cancelled" });
    }

    it("recherche annulée jamais partie : lancée sous le même numéro", async () => {
      await cancelLaunch();
      fetchSearch.mockResolvedValue(search("pending"));
      runSearch.mockResolvedValueOnce(search("completed"));
      expect(await finish(identifyDraft(getDraft()!, new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-1" });
      expect(runSearch.mock.calls.map(([id]) => id)).toEqual(["recherche-1", "recherche-1"]);
      expect(prepareSearch).toHaveBeenCalledTimes(1);
    });

    it("recherche annulée en échec côté service : une nouvelle recherche, celle du geste", async () => {
      await cancelLaunch();
      fetchSearch.mockResolvedValue(interrupted());
      runSearch.mockResolvedValueOnce(search("completed", { id: "recherche-2" }));
      expect(await finish(identifyDraft(getDraft()!, new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-2" });
      expect(runSearch.mock.calls.map(([id]) => id)).toEqual(["recherche-1", "recherche-2"]);
    });

    it("avec un autre cadre : une nouvelle recherche, sans relecture", async () => {
      await cancelLaunch();
      runSearch.mockResolvedValueOnce(search("completed", { id: "recherche-2" }));
      const reframed = updateDraft({ crop: { ...BOX, width: 0.3 } })!;
      expect(await finish(identifyDraft(reframed, new AbortController().signal))).toEqual({ kind: "done", searchId: "recherche-2" });
      expect(fetchSearch).not.toHaveBeenCalled();
      expect(runSearch.mock.calls.map(([id]) => id)).toEqual(["recherche-1", "recherche-2"]);
    });
  });
});
