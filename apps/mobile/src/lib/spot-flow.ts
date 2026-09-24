import { prepareSearch } from "./api";
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
    localImageUri: null,
  });
}

export async function beginFromPhoto(uri: string, size: ImageSize): Promise<SpotDraft> {
  const search = await prepareSearch({});
  return startDraft({
    searchId: search.id,
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
