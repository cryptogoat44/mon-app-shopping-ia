import { t } from "../i18n";
import { ApiError, prepareSearch } from "./api";
import { getDraft, startDraft, updateDraft, type ImageSize, type SpotDraft } from "./spot-draft";
import type { LinkPlatform } from "./link-detection";

// Enchaînement du parcours Spotter. « Préparer » est gratuit (aucun appel
// SerpApi) : on peut le refaire sans scrupule pour chaque nouveau lancement.

export async function beginFromLink(url: string, platform: LinkPlatform): Promise<SpotDraft> {
  const search = await prepareSearch({ sourceUrl: url });
  return startDraft({
    searchId: search.id,
    sourceUrl: url,
    platform,
    previewUrl: search.thumbnailUrl,
    previewIssue: search.previewIssue ?? null,
    localImageUri: null,
  });
}

/** Photo, ou image d'une vidéo : brouillon local. La recherche, gratuite,
 * n'est préparée qu'au lancement (freshSearchId) : l'écran suivant s'ouvre
 * sans attendre le serveur — même quand l'offre gratuite le réveille (lot 4 ter). */
export function beginFromPhoto(uri: string, size: ImageSize): SpotDraft {
  return startDraft({
    searchId: null,
    sourceUrl: null,
    platform: "photo",
    previewUrl: null,
    localImageUri: uri,
    imageSize: size,
  });
}

/** Identifiant d'une recherche encore jamais lancée pour ce brouillon : la
 * même tant qu'elle n'a pas servi, sinon une nouvelle (une recherche ne se
 * lance qu'une fois, côté serveur). */
export async function freshSearchId(draft: SpotDraft): Promise<string> {
  if (draft.searchId) return draft.searchId;
  const search = await prepareSearch(draft.sourceUrl ? { sourceUrl: draft.sourceUrl } : {});
  updateDraft({ searchId: search.id, previewUrl: draft.localImageUri ? draft.previewUrl : search.thumbnailUrl });
  return search.id;
}

/** À appeler dès qu'une recherche a été envoyée (même annulée ensuite). */
export function markSearchUsed(): void {
  updateDraft({ searchId: null });
}

export { getDraft };

/** Message quand « préparer » échoue : réseau coupé côté utilisateur, ou
 * serveur Spotto indisponible (panne, ou réveil du serveur gratuit). */
export function prepareFailureKind(error: unknown): "network" | "server" | "other" {
  if (error instanceof ApiError) return error.status >= 500 ? "server" : "other";
  // fetch échoue sans réponse (hors ligne, serveur injoignable).
  return error instanceof TypeError ? "network" : "other";
}

/** Message affiché quand « préparer » échoue (Spotter, choix d'une image dans une vidéo). */
export function prepareErrorMessage(error: unknown): string {
  const kind = prepareFailureKind(error);
  return kind === "network" ? t.spotter.networkError : kind === "server" ? t.spotter.serverError : t.spotter.prepareError;
}
