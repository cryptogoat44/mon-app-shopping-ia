// Élément reçu par la feuille de partage d'iOS (lot « partager vers Spotto ») :
// un lien, une image ou une vidéo, classé ici, puis gardé en attente jusqu'à
// ce que le Spotter puisse l'ouvrir (personne connectée, profil chargé : les
// écrans qui le prennent n'existent qu'à ce moment-là), sans jamais couper ce
// qui est en cours à l'écran. Logique pure, testée ; la réception elle-même :
// share-intake.ts (app iPhone) ; les écrans : use-shared-item.ts.
import { APP_GROUP, APP_SCHEME } from "../constants/brand";
import { t } from "../i18n";
import { extractUrl } from "./link-detection";

// Schéma de l'app (l'extension rouvre l'app par « spotto://dataUrl=spottoShareKey?… »)
// et groupe d'apps de l'app et de son extension (module expo-share-intent) :
// lus dans le fichier unique de la marque (constants/brand.ts), comme app.config.js.
export { APP_GROUP, APP_SCHEME };
/** Clé sous laquelle l'extension dépose le partage (réglages du groupe d'apps). */
export const SHARE_KEY = `${APP_SCHEME}ShareKey`;
// Au-delà, ce n'est plus un lien de partage ordinaire.
const MAX_LINK_LENGTH = 2048;

/** Ce que transmet l'extension (forme d'expo-share-intent ; champs parfois vides malgré ses types). */
export interface SharedFileInput {
  path?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
}

export interface ShareInput {
  files?: SharedFileInput[] | null;
  webUrl?: string | null;
  text?: string | null;
}

export type SharedRefusal = "several" | "unsupported" | "unreadable";

export type SharedItem =
  /** Lien web, déjà extrait du texte qui l'accompagne. */
  | { kind: "link"; text: string }
  /** `origin` : « visual_intelligence » pour une capture reçue de la recherche
   * d'image d'iOS (lib/visual-search-intake.ts) ; absent : feuille de partage. */
  | { kind: "image"; uri: string; width: number | null; height: number | null; origin?: "share" | "visual_intelligence" }
  | { kind: "video"; uri: string; sizeBytes: number | null }
  /** Plusieurs éléments, fichier quelconque, texte sans lien, ou partage illisible. */
  | { kind: "refused"; reason: SharedRefusal };

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp"];
const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v", "3gp"];

/** Lien d'un partage : le premier lien web du texte (TikTok et Instagram y
 * ajoutent souvent une phrase), sans espaces ni ponctuation finale — la même
 * extraction que le champ de lien (extractUrl), pour un même résultat. */
export function normalizeSharedLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = extractUrl(value);
  if (!url || url.length > MAX_LINK_LENGTH) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Adresse locale du fichier copié par l'extension ; rien d'autre n'est accepté. */
function fileUri(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("file://")) return path;
  return path.startsWith("/") ? `file://${path}` : null;
}

function mediaKind(file: SharedFileInput): "image" | "video" | null {
  const mime = (file.mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  // Type absent ou générique : l'extension du nom tranche.
  const extension = (file.fileName || file.path || "").split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return VIDEO_EXTENSIONS.includes(extension) ? "video" : null;
}

const known = (value: number | null | undefined): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** Lien, image, vidéo ou refus, d'après le contenu réel du partage. */
export function classifySharedItem(input: ShareInput | null | undefined): SharedItem {
  const files = (input?.files ?? []).filter((file) => Boolean(file?.path));
  if (files.length > 1) return { kind: "refused", reason: "several" };
  const file = files[0];
  if (file) {
    const uri = fileUri(file.path);
    const kind = mediaKind(file);
    if (!uri) return { kind: "refused", reason: "unreadable" };
    if (kind === "image") return { kind: "image", uri, width: known(file.width), height: known(file.height) };
    if (kind === "video") return { kind: "video", uri, sizeBytes: known(file.size) };
    return { kind: "refused", reason: "unsupported" };
  }
  // Le texte d'abord, lu comme le champ de lien : le lien que le module en tire
  // à sa façon s'arrête à une virgule ou à une lettre accentuée.
  const link = normalizeSharedLink(input?.text) ?? normalizeSharedLink(input?.webUrl);
  if (link) return { kind: "link", text: link };
  return { kind: "refused", reason: input?.text?.trim() || input?.webUrl ? "unsupported" : "unreadable" };
}

/** Message clair quand l'élément partagé ne peut pas s'ouvrir. */
export function sharedRefusalMessage(reason: SharedRefusal): string {
  return t.share[reason];
}

// Adresse exacte de l'extension : « spotto://dataUrl=spottoShareKey?nonce=…#type ».
// Sans type reconnu, le module natif s'arrêterait net (plantage) : une adresse
// fabriquée à la main n'est donc jamais lue comme un partage.
const SHARE_OPENING = new RegExp(`^${APP_SCHEME}://dataUrl=${SHARE_KEY}(\\?[^#]*)?#(media|weburl|text|file)$`);

/** L'app s'ouvre par l'extension de partage : l'adresse ne désigne aucun écran. */
export function isShareOpeningUrl(url: string): boolean {
  return SHARE_OPENING.test(url);
}

// Repli du partage (lot « app iPhone prête », point 12). Pour rouvrir Spotto,
// l'extension passe par un chemin qu'Apple ne prévoit pas : s'il échoue, rien
// ne s'ouvre et le partage était perdu. L'extension dépose donc aussi son
// adresse d'ouverture dans ce fichier du groupe d'apps
// (plugins/extension-partage.js) ; l'app le relit quand on l'ouvre à la main,
// au lancement ou au retour au premier plan (share-intake.ts).
/** Fichier du groupe d'apps : l'adresse d'ouverture du dernier partage. */
export const PENDING_SHARE_FILE = "partage-en-attente.txt";
/** Au-delà, un partage resté en attente n'est plus ouvert : il est oublié. */
export const PENDING_SHARE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Adresse à relire depuis le fichier de repli, ou null : contenu qui n'est
 * pas une adresse d'ouverture exacte (le module natif s'arrêterait net sur un
 * type inconnu), ou partage trop ancien. Date du fichier inconnue : relu. */
export function pendingShareOpening(content: string, modifiedAt: number | null, now: number): string | null {
  const url = content.trim();
  if (!isShareOpeningUrl(url)) return null;
  if (modifiedAt !== null && now - modifiedAt > PENDING_SHARE_MAX_AGE_MS) return null;
  return url;
}

// Élément en attente : un seul, le plus récent ; gardé en mémoire tant que
// l'app reste ouverte (même en arrière-plan), jamais enregistré.
let waiting: SharedItem | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Nouveau partage. Rend celui qu'il remplace, encore en attente, pour en effacer la copie. */
export function receiveSharedItem(item: SharedItem): SharedItem | null {
  const replaced = waiting;
  waiting = item;
  notify();
  return replaced;
}

export function peekSharedItem(): SharedItem | null {
  return waiting;
}

/** Le Spotter prend l'élément : il ne s'ouvre qu'une fois. */
export function takeSharedItem(): SharedItem | null {
  const item = waiting;
  waiting = null;
  if (item) notify();
  return item;
}

export function subscribeSharedItem(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** État de navigation (forme de React Navigation), lu quand un partage arrive. */
export interface NavigationStateLike {
  index?: number;
  routes: readonly { name: string; state?: NavigationStateLike }[];
}

/** Écrans de la zone connectée qu'un partage peut refermer sans rien faire
 * perdre (noms d'expo-router : fichiers de src/app/(app)) : les onglets et les
 * pages de simple lecture, sans saisie. LISTE BLANCHE : un écran absent
 * (oublié, ou ajouté plus tard) garde le partage en attente. Restent donc en
 * dehors : le parcours du Spotter (spot/…, une recherche peut-être payée),
 * les formulaires (nouvelle publication, ajout au Vault, modifier le profil,
 * envoyer une envie) et les écrans où l'on écrit ou agit (publication et ses
 * commentaires, recherche de personnes, pièce du Vault, Réglages, modération). */
const LEAVABLE_SCREENS: ReadonlySet<string> = new Set(["(tabs)", "recentes", "pieces-recues", "profil", "envie", "blocked-users"]);

/** Peut-on revenir tout de suite au Spotter pour ouvrir un partage ? Ce retour
 * referme TOUS les écrans empilés sur les onglets, pas seulement celui
 * affiché : chacun doit être de la liste. Écran hors de la zone connectée
 * affiché (Conditions, Confidentialité, nouveau mot de passe) : non, le retour
 * y empilerait un second Spotter. État illisible : non (on attend). */
export function canLeaveForSharedItem(root: NavigationStateLike | null | undefined): boolean {
  let state = root;
  while (state) {
    const shown = state.routes[state.index ?? state.routes.length - 1];
    if (!shown) return false;
    if (shown.name === "(app)") {
      const stack = shown.state?.routes ?? [];
      return stack.length > 0 && stack.every((screen) => LEAVABLE_SCREENS.has(screen.name));
    }
    state = shown.state;
  }
  return false;
}

/** Partage arrivé, personne connectée, un autre écran affiché (appelé une fois
 * par arrivée). Rien à perdre : retour au Spotter, qui l'ouvre. Sinon on reste
 * sur l'écran et l'élément attend le Spotter, qui l'ouvrira à la prochaine
 * visite (« Fermer », onglet marqué d'une pastille en attendant). Un refus
 * attend aussi : le Spotter l'affiche en message fixe, qui reste, alors qu'un
 * message flottant passerait trop vite pour l'expliquer. On dit seulement
 * qu'il attend. Rien n'est relancé ensuite : un écran dont on se sert ne se
 * ferme jamais tout seul. */
export function onSharedItemArrival(navigation: NavigationStateLike | null | undefined, actions: { backToSpotter: () => void; say: (message: string) => void }): void {
  if (!peekSharedItem()) return;
  if (canLeaveForSharedItem(navigation)) return actions.backToSpotter();
  actions.say(t.share.waiting);
}

/** Onglet Spotter : une pastille tant qu'un partage l'attend (comme celle
 * d'Activité), dite aussi par VoiceOver. */
export function spotterTab(pending: SharedItem | null): { badge: string | undefined; accessibilityLabel: string } {
  if (!pending) return { badge: undefined, accessibilityLabel: t.spotter.title };
  return { badge: "", accessibilityLabel: t.share.tabWaiting(t.spotter.title) };
}

/** Durée d'affichage d'un message du partage : il arrive au retour d'une autre
 * app, sans qu'on l'attende. Le temps de le remarquer, puis de le lire
 * posément (moins de 3 mots par seconde) ; jamais moins de 4 s. */
export function sharedMessageDurationMs(message: string): number {
  const words = message.split(/\s+/).filter(Boolean).length;
  return Math.max(4000, 1500 + words * 350);
}

/** Pas connecté (accueil) : un refus est pris et dit tout de suite, plutôt
 * qu'après la connexion, hors de propos ; le reste s'ouvrira après la
 * connexion, on le dit. */
export function onSharedItemSignedOut(say: (message: string) => void): void {
  const item = peekSharedItem();
  if (!item) return;
  if (item.kind === "refused") {
    takeSharedItem();
    return say(sharedRefusalMessage(item.reason));
  }
  say(t.share.signInFirst);
}
