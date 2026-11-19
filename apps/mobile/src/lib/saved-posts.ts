import type { CollectionSummary, Post } from "@monapp/shared-types";
import { t } from "../i18n";

// Publications enregistrées (lot « vie sociale », migration 0048) : la
// logique sans écran, testée à part (tests/publications-enregistrees.test.ts).
// Le signet n'apparaît que si le serveur donne l'état de la publication
// (`viewerHasSaved`) : un serveur ou une base sans 0048 n'en dit rien, et
// l'app le cache. Toucher le signet d'une publication pas encore enregistrée
// l'enregistre ; toucher celui d'une publication enregistrée ouvre les choix
// (la ranger dans une de ses collections, sans collection, la retirer) — le
// même chemin sur l'iPhone et sur le site, où l'appui long n'existe pas.
// Sur l'iPhone, l'appui long ouvre aussi les choix.

/** Ce que le signet montre : enregistrée ou non, et dans laquelle de ses collections. */
export interface SaveState {
  saved: boolean;
  collectionId: string | null;
}

export const NOT_SAVED: SaveState = { saved: false, collectionId: null };

/** Le serveur dit-il l'état de la publication (migration 0048 là) ? */
export function bookmarkShown(post: Pick<Post, "viewerHasSaved">): boolean {
  return typeof post.viewerHasSaved === "boolean";
}

/** L'état de départ du signet, tel que le serveur l'a donné. */
export function saveStateOf(post: Pick<Post, "viewerHasSaved" | "viewerSavedCollectionId">): SaveState {
  if (post.viewerHasSaved !== true) return NOT_SAVED;
  return { saved: true, collectionId: typeof post.viewerSavedCollectionId === "string" ? post.viewerSavedCollectionId : null };
}

/** Un geste sur le signet, puis la réponse du serveur. */
export type SaveAction =
  /** Enregistrer (affiché tout de suite, avant la réponse), sans collection. */
  | { type: "save" }
  /** Ranger dans une collection (null : sans collection) ; enregistre aussi. */
  | { type: "file"; collectionId: string | null }
  /** Retirer des enregistrées. */
  | { type: "unsave" }
  /** La réponse du serveur : son état fait foi. */
  | { type: "confirmed"; state: SaveState }
  /** La publication relue par l'écran (fil revenu, publication enregistrée ou
   * rangée ailleurs entre-temps) : son état fait foi ; rien ne change s'il est
   * le même. */
  | { type: "synced"; state: SaveState }
  /** Le serveur a refusé : retour à l'état d'avant le geste. */
  | { type: "rollback"; state: SaveState };

export function saveReducer(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case "save":
      // Déjà enregistrée : rien ne change (sa collection reste).
      return state.saved ? state : { saved: true, collectionId: null };
    case "file":
      return { saved: true, collectionId: action.collectionId };
    case "unsave":
      return NOT_SAVED;
    case "confirmed":
    case "rollback":
      return action.state;
    case "synced":
      return state.saved === action.state.saved && state.collectionId === action.state.collectionId ? state : action.state;
  }
}

/** Ce que fait un toucher du signet : enregistrer, ou ouvrir les choix. */
export function bookmarkTapAction(state: SaveState): "save" | "openSheet" {
  return state.saved ? "openSheet" : "save";
}

/** La collection envoyée au serveur : un choix de la feuille l'envoie (null :
 * sans collection) ; un simple toucher n'en envoie aucune, et le serveur garde
 * celle de la publication si elle est déjà enregistrée — un signet resté en
 * retard ne la sort jamais de sa collection. */
export function saveRequestCollection(action: "save" | { collectionId: string | null }): string | null | undefined {
  return action === "save" ? undefined : action.collectionId;
}

/** Le bouton du signet pour les lecteurs d'écran : son état dans le libellé,
 * et ce que fait le toucher quand il ouvre les choix. */
export function bookmarkA11y(state: SaveState): { label: string; hint: string | undefined } {
  return state.saved ? { label: t.savedPosts.savedLabel, hint: t.savedPosts.savedHint } : { label: t.savedPosts.notSavedLabel, hint: undefined };
}

/** Un choix de la feuille « Ranger dans une collection ». */
export interface SaveSheetOption {
  key: string;
  kind: "collection" | "none" | "remove";
  collectionId: string | null;
  label: string;
  /** Le choix actuel (les choix se comportent comme des boutons radio). */
  selected: boolean;
}

/** Les choix de la feuille : ses collections (dans leur ordre), puis « Sans
 * collection », puis « Retirer des enregistrées » quand elle l'est. Une
 * collection disparue entre-temps (supprimée ailleurs) n'est pas cochée :
 * « Sans collection » non plus, rien ne l'est. Collections illisibles (null) :
 * seulement les deux derniers choix. */
export function saveSheetOptions(collections: readonly CollectionSummary[] | null, state: SaveState): SaveSheetOption[] {
  const list = collections ?? [];
  const options: SaveSheetOption[] = list.map((collection) => ({
    key: collection.id,
    kind: "collection",
    collectionId: collection.id,
    label: collection.name,
    selected: state.saved && state.collectionId === collection.id,
  }));
  options.push({ key: "none", kind: "none", collectionId: null, label: t.savedPosts.noCollection, selected: state.saved && state.collectionId === null });
  if (state.saved) options.push({ key: "remove", kind: "remove", collectionId: null, label: t.savedPosts.unsave, selected: false });
  return options;
}

/** Le message flottant après un choix dans la feuille. */
export function filedMessage(collectionId: string | null, collections: readonly CollectionSummary[] | null): string {
  if (collectionId === null) return t.savedPosts.unfiled;
  const found = collections?.find((collection) => collection.id === collectionId);
  return found ? t.savedPosts.filed(found.name) : t.savedPosts.saved;
}

// ---- L'écran « Publications enregistrées » ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Où mène l'entrée « Publications enregistrées » (toutes, ou celles d'une de ses collections). */
export function savedListRoute(collectionId?: string | null): { pathname: "/enregistrees"; params: { collection?: string } } {
  return collectionId ? { pathname: "/enregistrees", params: { collection: collectionId } } : { pathname: "/enregistrees", params: {} };
}

/** Lit l'adresse « /enregistrees?collection=… ». Absente : toutes. Un
 * identifiant qui n'en est pas un : null (l'écran ne demande rien au serveur). */
export function parseSavedListParams(params: { collection?: unknown }): { collectionId: string | null } | null {
  const value = params.collection;
  if (value === undefined || value === null || value === "") return { collectionId: null };
  return typeof value === "string" && UUID.test(value) ? { collectionId: value.toLowerCase() } : null;
}

/** La phrase d'une liste vide. */
export function savedListEmptyText(inCollection: boolean): string {
  return inCollection ? t.savedPosts.collectionEmpty : t.savedPosts.listEmpty;
}

/** Ajoute une page à la liste, sans doublon (une publication enregistrée de
 * nouveau entre deux pages n'apparaît qu'une fois). */
export function appendSavedPage(current: readonly Post[], page: readonly Post[]): Post[] {
  const known = new Set(current.map((post) => post.id));
  return [...current, ...page.filter((post) => !known.has(post.id))];
}
