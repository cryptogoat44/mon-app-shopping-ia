import { t } from "../i18n";
import { ApiError, prepareSearch } from "./api";
import { getDraft, startDraft, updateDraft, type ImageSize, type SpotDraft } from "./spot-draft";
import type { UnsettledLaunch } from "./spot-recovery";

// Enchaînement du parcours Spotter. « Préparer » est gratuit (aucun appel
// SerpApi) : on peut le refaire sans scrupule pour chaque nouveau lancement.
// Le parcours part toujours d'une image que la personne apporte (photo,
// capture, image de sa vidéo) : jamais de l'image d'un lien.

/** Photo, ou image d'une vidéo : brouillon local. La recherche, gratuite,
 * n'est préparée qu'au lancement (freshSearchId) : l'écran suivant s'ouvre
 * sans attendre le serveur — même quand l'offre gratuite le réveille (lot 4 ter). */
export function beginFromPhoto(uri: string, size: ImageSize): SpotDraft {
  return startDraft({ searchId: null, localImageUri: uri, imageSize: size });
}

/** Identifiant d'une recherche encore jamais lancée pour ce brouillon : la
 * même tant qu'elle n'a pas servi, sinon une nouvelle (une recherche ne se
 * lance qu'une fois, côté serveur). */
export async function freshSearchId(draft: SpotDraft): Promise<string> {
  if (draft.searchId) return draft.searchId;
  const search = await prepareSearch();
  updateDraft({ searchId: search.id });
  return search.id;
}

/** À appeler dès qu'une recherche part (même annulée ensuite) : elle ne se
 * relance plus comme neuve, mais son numéro est gardé avec ce qui part tant
 * que son issue n'est pas montrée (lib/spot-recovery.ts). */
export function markSearchUsed(launch: UnsettledLaunch): void {
  updateDraft({ searchId: null, unsettled: launch });
}

/** Issue montrée (résultat ou échec) : plus rien à retrouver pour ce lancement. */
export function settleLaunch(searchId: string): void {
  if (getDraft()?.unsettled?.searchId === searchId) updateDraft({ unsettled: null });
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
