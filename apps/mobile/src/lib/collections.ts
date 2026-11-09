// Collections d'envies (lot collections) : la logique sans écran, testée à
// part (tests/collections.test.ts). Sans les collections sur le serveur
// (migration 0033 absente, ancien serveur, réponse illisible), l'app les
// cache toutes : puces, « Ajouter à une collection », section des profils.
import {
  COLLECTION_NAME_MAX_LENGTH,
  type CollectionSummary,
  type CollectionVisibility,
  type CollectionsStatus,
  type SharedCollectionItem,
  type SharedCollectionSummary,
} from "@monapp/shared-types";
import { t } from "../i18n";
import { formatPrice } from "./format";
import type { Locale } from "./preferences";

/** Réponse de GET /api/collections/status : seul `enabled: true` les montre. */
export function readCollectionsStatus(body: unknown): CollectionsStatus {
  if (typeof body !== "object" || body === null) return { enabled: false };
  return { enabled: (body as Record<string, unknown>).enabled === true };
}

/** Nom tel que le serveur le gardera : espaces de début et de fin retirés,
 * suites d'espaces réduites à une seule. */
export function cleanCollectionName(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim();
}

/** Longueur comptée comme le serveur (un emoji vaut 1). */
export function collectionNameLength(raw: string): number {
  return [...cleanCollectionName(raw)].length;
}

/** Un nom enregistrable : 1 à 40 caractères une fois nettoyé (les mots
 * interdits, eux, sont refusés par le serveur, qui l'explique). */
export function canSaveName(raw: string): boolean {
  const length = collectionNameLength(raw);
  return length > 0 && length <= COLLECTION_NAME_MAX_LENGTH;
}

/** Une puce de l'écran Envies : « Toutes » (collectionId null) ou une collection. */
export interface CollectionChip {
  key: string;
  collectionId: string | null;
  label: string;
  accessibilityLabel: string;
  shared: boolean;
}

/** Puces de l'écran Envies : « Toutes », puis une par collection. null
 * quand les collections ne sont pas disponibles (rien n'est affiché). */
export function collectionChips(status: CollectionsStatus, collections: readonly CollectionSummary[] | null): CollectionChip[] | null {
  if (!status.enabled || collections === null) return null;
  return [
    { key: "all", collectionId: null, label: t.collections.all, accessibilityLabel: t.collections.all, shared: false },
    ...collections.map((collection) => {
      const shared = collection.visibility === "friends";
      return { key: collection.id, collectionId: collection.id, label: collection.name, accessibilityLabel: t.collections.chipLabel(collection.name, shared), shared };
    }),
  ];
}

/** La puce choisie existe-t-elle encore ? Sinon, retour à « Toutes ». */
export function selectedCollection(collections: readonly CollectionSummary[] | null, selected: string | null): CollectionSummary | null {
  if (selected === null || collections === null) return null;
  return collections.find((collection) => collection.id === selected) ?? null;
}

/** Phrase sous les puces : qui voit la collection choisie. */
export function visibilityState(visibility: CollectionVisibility): string {
  return visibility === "friends" ? t.collections.friendsState : t.collections.privateState;
}

/** Les choix de visibilité, dans l'ordre (« Privée » par défaut). */
export function visibilityOptions(): { value: CollectionVisibility; label: string }[] {
  return [
    { value: "private", label: t.collections.visibilityPrivate },
    { value: "friends", label: t.collections.visibilityFriends },
  ];
}

/** Passer à « Mes amis » se confirme toujours (ce que les amis verront) ;
 * revenir à « Privée » se fait tout de suite. */
export function needsShareConfirmation(from: CollectionVisibility, to: CollectionVisibility): boolean {
  return from !== "friends" && to === "friends";
}

/** Case cochée ou décochée dans la feuille « Ajouter à une collection ». */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
}

/** La sélection a-t-elle changé depuis l'ouverture de la feuille ? */
export function selectionChanged(initial: readonly string[], selected: readonly string[]): boolean {
  return initial.length !== selected.length || initial.some((id) => !selected.includes(id));
}

/** Section « Collections » d'un profil : seulement si les collections sont
 * disponibles et que la personne en montre au moins une (sinon rien). */
export function friendSectionVisible(status: CollectionsStatus, collections: readonly SharedCollectionSummary[] | null): boolean {
  return status.enabled && collections !== null && collections.length > 0;
}

/** Image d'une envie d'un ami : toujours la copie de Spotto, jamais une
 * autre adresse ; null → « Image indisponible ». */
export function sharedItemImage(item: Pick<SharedCollectionItem, "imageThumbUrl" | "imageUrl">): string | null {
  return item.imageThumbUrl ?? item.imageUrl ?? null;
}

/** Prix d'une envie d'un ami, dans la langue de l'app, ou null. */
export function sharedItemPrice(item: Pick<SharedCollectionItem, "priceMin" | "currency">, locale: Locale): string | null {
  return item.priceMin === null ? null : formatPrice(item.priceMin, item.currency, locale);
}

// ---- Disponibilité, partagée entre les écrans ----

let current: CollectionsStatus = { enabled: false };
const listeners = new Set<(status: CollectionsStatus) => void>();

export function collectionsStatus(): CollectionsStatus {
  return current;
}

/** Nouvel état lu sur le serveur : les écrans abonnés sont prévenus s'il change. */
export function setCollectionsStatus(next: CollectionsStatus): void {
  if (next.enabled === current.enabled) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onCollectionsStatus(listener: (status: CollectionsStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
