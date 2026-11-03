// Identification d'une image préparée (1 crédit SerpApi), commune au
// parcours unique (lot 4 ter) et aux corrections (recadrer, autre moment).
// Le résultat — ou l'échec, jamais déguisé en « pièce introuvable » (audit
// Lot Q, ROB-02) — est gardé en mémoire pour l'écran Résultat. Recherche
// coupée (réseau perdu, retour sur TikTok, « Annuler ») : son numéro est
// gardé et son issue relue sur le serveur, gratuitement, au lieu d'être
// repayée (lib/spot-recovery.ts).
import type { ProductSearch } from "@monapp/shared-types";
import type { SpotFailReason, SpotResult } from "../api/types";
import { setLastSpotResult } from "../api/spotSession";
import { ApiError, fetchSearch, runSearch } from "./api";
import { reportUnexpectedError } from "./error-tracking";
import { capacityFailure } from "./spot-capacity";
import { freshSearchId, markSearchUsed, settleLaunch } from "./spot-flow";
import { toSpotResult } from "./spot-result";
import {
  READ_TIMEOUT_MS,
  launchOutcomeUnknown,
  launchRequestOf,
  onAppForeground,
  recoverSearch,
  resumeStep,
  sameLaunch,
  type Recovery,
  type RecoveryPorts,
  type UnsettledState,
} from "./spot-recovery";
import type { SpotDraft } from "./spot-draft";

/** `done` : résultat à afficher (`searchId` null si aucune recherche n'a pu
 * partir) ; `unsettled` : issue encore inconnue — l'écran propose « Relancer »
 * ou « Vérifier à nouveau », jamais une relance sans geste. */
export type IdentifyOutcome =
  | { kind: "done"; searchId: string | null }
  | { kind: "unsettled"; searchId: string; state: UnsettledState }
  | { kind: "cancelled" };

/** Relectures réelles (GET /api/searches/:id, gratuit), chacune abandonnée
 * au bout de 10 s ou avec « Annuler » ; attentes interrompues par « Annuler ». */
const ports: RecoveryPorts = {
  read: (searchId, signal) => {
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, READ_TIMEOUT_MS);
    return fetchSearch(searchId, attempt.signal).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    });
  },
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done);
    }),
  now: () => Date.now(),
};

function failReasonOf(error: unknown): SpotFailReason {
  if (error instanceof ApiError && error.status === 429) return "rate_limited";
  if (error instanceof ApiError && error.body.error === "preview_unavailable") return "needs_photo";
  // Erreur côté app (ex. image refusée à l'envoi) : invisible du serveur,
  // donc signalée à Sentry (lot 3bis).
  if (!(error instanceof ApiError)) reportUnexpectedError(error, "spot_analysis");
  return "technical";
}

/** Motif d'échec, et pour le plafond du mois le jour de la reprise. Le
 * plafond des recherches (lot 4 quater) passe avant tout autre 429 : jamais
 * « trop de recherches d'un coup ». */
function failureOf(error: unknown): Pick<SpotResult, "failReason" | "resumesOn"> {
  const capacity = error instanceof ApiError ? capacityFailure(error.body) : null;
  return capacity ? { failReason: capacity.reason, resumesOn: capacity.resumesOn } : { failReason: failReasonOf(error) };
}

/** Issue connue (résultat, « rien trouvé » ou échec du service) : gardée pour
 * l'écran Résultat ; plus rien à retrouver pour ce lancement. */
function show(search: ProductSearch): IdentifyOutcome {
  settleLaunch(search.id);
  setLastSpotResult(toSpotResult(search));
  return { kind: "done", searchId: search.id };
}

function afterRecovery(recovery: Recovery, searchId: string): IdentifyOutcome {
  if (recovery.kind === "settled") return show(recovery.search);
  if (recovery.kind === "unsettled") return { kind: "unsettled", searchId, state: recovery.state };
  return recovery;
}

/** Le lancement. Pendant l'attente, chaque retour dans l'app relit la
 * recherche : déjà terminée (réponse perdue pendant la coupure), elle
 * l'emporte et la requête devenue inutile est abandonnée ; encore en cours,
 * elle est relue toutes les 3 s pendant que la requête continue ; jamais
 * partie, on laisse la requête finir (l'image peut être encore en route). */
async function runWatched(searchId: string, draft: SpotDraft, signal: AbortSignal): Promise<ProductSearch> {
  const request = new AbortController();
  const checks = new AbortController();
  const stop = () => {
    request.abort();
    checks.abort();
  };
  if (signal.aborted) stop();
  signal.addEventListener("abort", stop);
  let checking = false;
  let unsubscribe = () => {};
  const recovered = new Promise<ProductSearch>((resolve) => {
    unsubscribe = onAppForeground(() => {
      if (checking) return;
      checking = true;
      void recoverSearch(searchId, ports, checks.signal).then((recovery) => {
        checking = false;
        if (recovery.kind === "settled") resolve(recovery.search);
      });
    });
  });
  try {
    return await Promise.race([runSearch(searchId, { crop: draft.crop, imageUri: draft.localImageUri, words: draft.words }, request.signal), recovered]);
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", stop);
    // Sans effet si la requête a déjà répondu.
    stop();
  }
}

/** Lance l'identification du brouillon. « Annuler » (signal) abandonne la
 * requête côté app ; il ne promet rien sur le crédit, qui peut déjà être
 * engagé côté serveur. Le numéro reste donc dans le brouillon : relancée à
 * l'identique (même image, même cadre, mêmes mots), la recherche est relue
 * d'abord — terminée, son résultat s'affiche sans nouvel appel. Réponse
 * perdue (réseau, délai dépassé, serveur en panne) : relue de même. */
export async function identifyDraft(draft: SpotDraft, signal: AbortSignal): Promise<IdentifyOutcome> {
  const launch = launchRequestOf(draft);
  let searchId: string | null = null;
  try {
    if (sameLaunch(draft.unsettled, launch)) {
      const previous = draft.unsettled.searchId;
      const step = resumeStep(await recoverSearch(previous, ports, signal));
      if (step.kind === "show") return show(step.search);
      if (step.kind === "unsettled") return { kind: "unsettled", searchId: previous, state: step.state };
      if (step.kind === "cancelled") return step;
      // Jamais partie : la même recherche. En échec côté service : une nouvelle, celle du geste.
      if (step.kind === "run_same") searchId = previous;
    }
    searchId ??= await freshSearchId(draft);
    // Rien n'est parti : la recherche préparée reste neuve pour le prochain lancement.
    if (signal.aborted) return { kind: "cancelled" };
    markSearchUsed({ ...launch, searchId });
    const search = await runWatched(searchId, draft, signal);
    if (signal.aborted) return { kind: "cancelled" };
    return show(search);
  } catch (error) {
    if (signal.aborted) return { kind: "cancelled" };
    if (searchId && launchOutcomeUnknown(error)) return afterRecovery(await recoverSearch(searchId, ports, signal), searchId);
    if (searchId) settleLaunch(searchId);
    setLastSpotResult({ searchId: null, status: "failed", pieces: [], similarPieces: [], ...failureOf(error), query: null });
    return { kind: "done", searchId: null };
  }
}

/** « Vérifier à nouveau », ou retour dans l'app sur une recherche restée sans
 * issue : relecture seule, rien n'est jamais relancé. */
export async function checkSearch(searchId: string, signal: AbortSignal): Promise<IdentifyOutcome> {
  return afterRecovery(await recoverSearch(searchId, ports, signal), searchId);
}
