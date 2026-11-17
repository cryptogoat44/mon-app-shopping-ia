// Lot « vidéo auto » : la demande d'analyse d'un lien (délai de l'app,
// « Annuler ») et le passage d'un moment choisi à la recherche habituelle,
// exactement comme un moment d'une vidéo du téléphone : son image et le cadre
// de l'IA deviennent le brouillon d'une photo (beginFromPhoto), la vidéo
// reste associée pour que la mémoire collective note le spot. L'image reste
// en mémoire (« data: ») : rien n'est écrit sur l'appareil ni dans le
// navigateur. Logique sans écran, testée (serveur simulé).
import type { CropRect, VideoLinkAnalysisRequest, VideoPlatform, VideoSpotSource } from "@monapp/shared-types";
import { analyzeVideoLink } from "./api";
import { track } from "./analytics";
import { momentSeconds } from "./player-state";
import { beginFromPhoto } from "./spot-flow";
import { updateDraft, type DraftVideoContext, type SpotDraft } from "./spot-draft";
import { LINK_ANALYSIS_TIMEOUT_MS, linkAiFailure, type LinkAnalysis, type LinkFailureInfo, type LinkMoment } from "./video-link-analysis";

export type LinkRunOutcome = { kind: "found"; analysis: LinkAnalysis } | { kind: "failed"; info: LinkFailureInfo } | { kind: "cancelled" };

function failed(platform: VideoPlatform, info: LinkFailureInfo): LinkRunOutcome {
  track("video_link_ai_result", { platform, outcome: info.failure === "no_moment" ? "not_found" : "failed", reason: info.failure, moments_count: 0 });
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
  try {
    const analysis = await analyzeVideoLink(request, controller.signal);
    if (signal.aborted) throw new Error("cancelled");
    if (analysis.moments.length === 0) return failed(platform, { failure: "no_moment", capacity: null });
    track("video_link_ai_result", { platform, outcome: "found", moments_count: analysis.moments.length });
    return { kind: "found", analysis };
  } catch (error) {
    if (signal.aborted && !timedOut) {
      track("video_link_ai_result", { platform, outcome: "cancelled", moments_count: 0 });
      return { kind: "cancelled" };
    }
    return failed(platform, linkAiFailure(error, timedOut));
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

/** « Lancer la recherche » : l'image du moment et la zone choisie sur
 * l'écran des moments (le cadre de l'IA, ou la pièce entourée par la
 * personne) deviennent le brouillon de la recherche habituelle (1 crédit au
 * lancement, comme une photo). Les mots ont servi à l'IA seulement : ils ne
 * partent pas avec l'image. null : moment absent. */
export function startMomentSearch(
  analysis: LinkAnalysis,
  rank: number,
  origin: LinkSpotOrigin,
  zone?: { crop: CropRect; byAi: boolean }
): SpotDraft | null {
  const moment = analysis.moments[rank];
  if (!moment) return null;
  const started = beginFromPhoto(moment.image, moment.size, { video: momentVideoContext(analysis, moment, origin) });
  track("video_link_ai_moment_chosen", { platform: analysis.video.platform, rank: rank + 1, moments_count: analysis.moments.length });
  return updateDraft({ crop: zone ? { ...zone.crop } : moment.box, zoneByAi: zone ? zone.byAi : true }) ?? started;
}
