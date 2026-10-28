// Identification d'une image préparée (1 crédit SerpApi), commune au
// parcours unique (lot 4 ter) et aux corrections (recadrer, autre moment).
// Le résultat — ou l'échec, jamais déguisé en « pièce introuvable » (audit
// Lot Q, ROB-02) — est gardé en mémoire pour l'écran Résultat.
import type { SpotFailReason, SpotResult } from "../api/types";
import { setLastSpotResult } from "../api/spotSession";
import { ApiError, runSearch } from "./api";
import { reportUnexpectedError } from "./error-tracking";
import { capacityFailure } from "./spot-capacity";
import { freshSearchId, markSearchUsed } from "./spot-flow";
import { toSpotResult } from "./spot-result";
import type { SpotDraft } from "./spot-draft";

/** `searchId` : la recherche à afficher (null si elle n'a pas pu aboutir). */
export type IdentifyOutcome = { kind: "done"; searchId: string | null } | { kind: "cancelled" };

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

/** Lance l'identification du brouillon. « Annuler » (signal) abandonne
 * vraiment la requête ; il ne promet rien sur le crédit, qui peut déjà être
 * engagé côté serveur. */
export async function identifyDraft(draft: SpotDraft, signal: AbortSignal): Promise<IdentifyOutcome> {
  try {
    const searchId = await freshSearchId(draft);
    markSearchUsed();
    const search = await runSearch(searchId, { crop: draft.crop, imageUri: draft.localImageUri, words: draft.words }, signal);
    if (signal.aborted) return { kind: "cancelled" };
    setLastSpotResult(toSpotResult(search));
    return { kind: "done", searchId: search.id };
  } catch (error) {
    if (signal.aborted) return { kind: "cancelled" };
    setLastSpotResult({ searchId: null, status: "failed", pieces: [], similarPieces: [], ...failureOf(error), query: null });
    return { kind: "done", searchId: null };
  }
}
