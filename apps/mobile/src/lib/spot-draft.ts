// Brouillon du parcours Spotter en cours (Ciblage → Attente →
// Résultat), gardé en mémoire le temps du parcours. L'identifiant de la
// recherche passe aussi dans l'adresse de chaque écran : après un
// rechargement de page (web), l'écran relit la recherche sur le serveur
// quand c'est possible, ou renvoie proprement vers Spotter.
import type { CropRect, VideoPlatform, VideoSpotSource } from "@monapp/shared-types";
import type { UnsettledLaunch } from "./spot-recovery";

/** Vidéo TikTok ou Instagram à laquelle la recherche est associée (mission
 * « liens vidéo ») : après une recherche réussie, le spot est noté pour elle
 * (POST /api/video-links/spots). Jamais d'image de la vidéo : son lien seul. */
export interface DraftVideoContext {
  url: string;
  platform: VideoPlatform;
  creatorHandle: string | null;
  source: VideoSpotSource;
  /** Moment de la vidéo (secondes entières), quand le lecteur l'a donné. */
  momentSeconds: number | null;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface SpotDraft {
  /** Recherche préparée, encore jamais lancée. Null une fois lancée (même
   * annulée) : un nouveau lancement prépare une nouvelle recherche, gratuite —
   * sauf relance à l'identique d'un lancement resté sans issue (`unsettled`). */
  searchId: string | null;
  /** Photo ou capture importée, ou image d'une vidéo de la personne : la
   * seule image analysée. */
  localImageUri: string | null;
  /** Taille de l'image affichée, connue une fois chargée. */
  imageSize: ImageSize | null;
  crop: CropRect | null;
  /** Zone trouvée par l'IA (moment d'une vidéo) : comptée « ajustée » dans la
   * statistique, même quand elle couvre toute l'image. Retombe à faux quand
   * la personne entoure la pièce elle-même (« Recadrer »). */
  zoneByAi?: boolean;
  /** Mots tapés sous une photo : ils trient les propositions, sans partir avec
   * l'image ; repris par « Recadrer » (petit lot 2). Jamais enregistrés. */
  words: string | null;
  /** Dernier lancement dont l'issue n'a pas encore été montrée (annulé,
   * écran quitté, réponse perdue) : relancé à l'identique, il est relu au
   * lieu d'être repayé (lib/spot-recovery.ts). */
  unsettled?: UnsettledLaunch | null;
  /** Vidéo associée (lecteur, ou lien en attente) ; null : aucune. */
  video?: DraftVideoContext | null;
  /** Image à effacer de l'appareil dès que la recherche est partie
   * (instantané du lecteur, capture reçue de la recherche d'image d'iOS),
   * ou dès que le parcours est abandonné. */
  discardImageAfterSearch?: boolean;
}

let current: SpotDraft | null = null;

// Effacement des images à ne pas garder (lib/video-context.ts le branche) :
// ce fichier reste sans dépendance, testé tel quel.
let discardImage: (uri: string) => void = () => {};

export function setDraftImageDiscarder(discard: (uri: string) => void): void {
  discardImage = discard;
}

/** Brouillon abandonné ou remplacé : son image à ne pas garder est effacée. */
function letGo(draft: SpotDraft | null, keepUri: string | null): void {
  if (draft?.discardImageAfterSearch && draft.localImageUri && draft.localImageUri !== keepUri) discardImage(draft.localImageUri);
}

export function startDraft(draft: Omit<SpotDraft, "crop" | "imageSize" | "words"> & Partial<SpotDraft>): SpotDraft {
  letGo(current, draft.localImageUri);
  current = { crop: null, imageSize: null, words: null, ...draft };
  return current;
}

export function getDraft(): SpotDraft | null {
  return current;
}

export function updateDraft(patch: Partial<SpotDraft>): SpotDraft | null {
  if (!current) return null;
  current = { ...current, ...patch };
  return current;
}

/** L'image à analyser : celle que la personne a importée. */
export function draftImageUri(draft: SpotDraft): string | null {
  return draft.localImageUri;
}

export function clearDraft(): void {
  letGo(current, null);
  current = null;
}

/** La recherche de `searched` est partie : son image à ne pas garder est
 * effacée, et le brouillon n'y renvoie plus (« Recadrer » n'est alors plus
 * proposé). */
export function discardSearchedImage(searched: SpotDraft): void {
  const uri = searched.localImageUri;
  if (!searched.discardImageAfterSearch || !uri) return;
  discardImage(uri);
  if (current?.localImageUri === uri) current = { ...current, localImageUri: null };
}
