// Lot « vidéo auto » : la demande d'analyse d'un lien (délai de l'app,
// « Annuler ») et le passage d'un moment choisi à la recherche habituelle,
// exactement comme un moment d'une vidéo du téléphone : son image et le cadre
// de l'IA deviennent le brouillon d'une photo (beginFromPhoto), la vidéo
// reste associée pour que la mémoire collective note le spot. L'image reste
// en mémoire (« data: ») : rien n'est écrit sur l'appareil ni dans le
// navigateur. Logique sans écran, testée (serveur simulé).
import { SEARCH_QUERY_MAX_LENGTH, type CropRect, type VideoLinkAnalysisRequest, type VideoPlatform, type VideoSpotSource } from "@monapp/shared-types";
import { analyzeVideoLink } from "./api";
import { track } from "./analytics";
import { momentSeconds } from "./player-state";
import { beginFromPhoto } from "./spot-flow";
import { updateDraft, type DraftVideoContext, type SpotDraft } from "./spot-draft";
import { cleanQuery, LINK_ANALYSIS_TIMEOUT_MS, linkAiFailure, type LinkAnalysis, type LinkFailureInfo, type LinkMoment } from "./video-link-analysis";
import { waitNow, waitSince } from "./wait-clock";

export type LinkRunOutcome = { kind: "found"; analysis: LinkAnalysis } | { kind: "failed"; info: LinkFailureInfo } | { kind: "cancelled" };

/** `startedAt` : départ de l'analyse (waitNow), pour le temps d'attente. */
function failed(platform: VideoPlatform, info: LinkFailureInfo, startedAt: number): LinkRunOutcome {
  track("video_link_ai_result", { platform, outcome: info.failure === "no_moment" ? "not_found" : "failed", reason: info.failure, moments_count: 0, wait_ms: waitSince(startedAt) });
  return { kind: "failed", info };
}

/** Une analyse : `signal` est « Annuler » (rien à montrer ensuite) ; au-delà
 * de `timeoutMs`, l'attente s'arrête et l'échec « délai dépassé » s'affiche. */
export async function runLinkAnalysis(
  request: VideoLinkAnalysisRequest,
  platform: VideoPlatform,
  signal: AbortSignal,
  timeoutMs: number = LINK_ANALYSIS_TIMEOUT_MS
): Promise<LinkRunOutcome> {
  if (signal.aborted) return { kind: "cancelled" };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop);
  track("video_link_ai_started", { platform });
  // Mesure du parcours : chaque issue dit l'attente depuis ce départ.
  const startedAt = waitNow();
  try {
    const analysis = await analyzeVideoLink(request, controller.signal);
    if (signal.aborted) throw new Error("cancelled");
    if (analysis.moments.length === 0) return failed(platform, { failure: "no_moment", capacity: null }, startedAt);
    track("video_link_ai_result", { platform, outcome: "found", moments_count: analysis.moments.length, wait_ms: waitSince(startedAt) });
    return { kind: "found", analysis };
  } catch (error) {
    if (signal.aborted && !timedOut) {
      track("video_link_ai_result", { platform, outcome: "cancelled", moments_count: 0, wait_ms: waitSince(startedAt) });
      return { kind: "cancelled" };
    }
    return failed(platform, linkAiFailure(error, timedOut), startedAt);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/** D'où vient l'image d'un spot noté pour la vidéo : l'app iPhone ou le site
 * (sources existantes de la mémoire collective : aucune migration). */
export type LinkSpotOrigin = Extract<VideoSpotSource, "app" | "web">;

export function momentVideoContext(analysis: LinkAnalysis, moment: LinkMoment, origin: LinkSpotOrigin): DraftVideoContext {
  const { video } = analysis;
  return { url: video.canonicalUrl, platform: video.platform, creatorHandle: video.creatorHandle, source: origin, momentSeconds: momentSeconds(moment.timeSeconds) };
}

/** La description gardée dans le brouillon : espaces superflus retirés,
 * dans la limite des mots d'une recherche ; null si rien ne reste. */
function draftWords(words: string): string | null {
  const clean = cleanQuery(words).slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
  return clean === "" ? null : clean;
}

/** Plan B en un geste (lot « recherche confiance ») : la capture d'écran
 * ajoutée après un échec de l'analyse reprend la description, comme les mots
 * tapés sous une photo — elle trie les propositions, sans partir avec l'image
 * vers Google Lens, et n'est jamais enregistrée. Jamais de recherche de plus
 * (textSearchIfNoPrice n'est pas posé : aucun appel payant ajouté). Le lien,
 * lui, suit par le lien en attente (lib/pending-video-link.ts). null : aucun
 * brouillon, ou rien à reprendre. */
export function keepDescriptionInDraft(words: string): SpotDraft | null {
  const kept = draftWords(words);
  return kept === null ? null : updateDraft({ words: kept });
}

/** « Lancer la recherche » : l'image du moment et la zone choisie sur
 * l'écran des moments (le cadre de l'IA, ou la pièce entourée par la
 * personne) deviennent le brouillon de la recherche habituelle (1 crédit au
 * lancement, comme une photo). La description (`words`, déjà envoyée à l'IA)
 * reste dans le brouillon comme les mots tapés sous une photo : elle trie
 * les propositions, ne part jamais avec l'image vers Google Lens et n'est
 * jamais enregistrée. Lien vidéo sans prix (décision du fondateur du
 * 17 novembre 2026) : le brouillon est marqué (textSearchIfNoPrice) — si
 * aucune proposition n'a de prix, l'écran Résultat lance de lui-même la
 * recherche avec cette description (« Que cherchez-vous ? », 1 crédit de
 * plus). null : moment absent. */
export function startMomentSearch(
  analysis: LinkAnalysis,
  rank: number,
  origin: LinkSpotOrigin,
  zone?: { crop: CropRect; byAi: boolean },
  words = ""
): SpotDraft | null {
  const moment = analysis.moments[rank];
  if (!moment) return null;
  const started = beginFromPhoto(moment.image, moment.size, { video: momentVideoContext(analysis, moment, origin) });
  track("video_link_ai_moment_chosen", { platform: analysis.video.platform, rank: rank + 1, moments_count: analysis.moments.length });
  return updateDraft({ crop: zone ? { ...zone.crop } : moment.box, zoneByAi: zone ? zone.byAi : true, words: draftWords(words), textSearchIfNoPrice: true }) ?? started;
}
