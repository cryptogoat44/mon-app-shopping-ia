import type { WishlistItem as RemoteWishlistItem } from "@monapp/shared-types";
import { addWishlistItem, fetchCollectionWishlist, fetchSearch, fetchWishlist, listRecentSearches } from "@/lib/api";
import { matchToPiece, pieceTitle, toSpotResult } from "@/lib/spot-result";
import { ownedMarks } from "@/lib/owned-marks";
import { HISTORY_PAGE_SIZE, matchesHistoryQuery } from "@/lib/recent-searches";
import * as mock from "./mock";
import type { Piece, Profile, SpotResult, VaultItem, WishlistItem } from "./types";

// Un seul paramètre bascule tout l'app entre données fictives et vraies
// données. Tant que le nouveau design n'est pas validé, on reste sur le
// mock — le vrai backend (déjà construit et déployé) sera rebranché écran
// par écran, une fois chaque écran validé.
const USE_MOCK = true;

function notImplemented(): never {
  throw new Error(
    "Le vrai backend n'est pas encore branché pour ce nouveau design (USE_MOCK=false). Voir src/api/client.ts."
  );
}

function wishlistRowToItem(row: RemoteWishlistItem): WishlistItem {
  return {
    id: row.id,
    name: row.title,
    reference: row.reference,
    material: null,
    imageUrl: row.imageUrl,
    imageHdUrl: row.imageHdUrl,
    edgeColor: row.edgeColor ?? null,
    priceFrom: row.priceMin,
    currency: row.currency,
    merchantName: row.merchantName,
    merchantUrl: row.merchantUrl,
    // Lien affilié de la pièce identifiée d'origine s'il existe, sinon le
    // lien marchand tel quel.
    affiliateUrl: row.affiliateUrl ?? row.merchantUrl,
    real: true,
    addedAt: row.createdAt,
    productMatchId: row.productMatchId,
  };
}

// Relit une recherche déjà faite (écran Résultat rouvert ou rechargé) —
// aucun nouvel appel SerpApi, seulement la lecture de ce qui est en base.
// Avec ce que la personne en a déjà gardé ou acheté.
export async function loadSpotResult(searchId: string): Promise<SpotResult> {
  const search = await fetchSearch(searchId);
  return { ...toSpotResult(search), owned: ownedMarks(search) };
}

// Branché sur le vrai historique de recherches (table product_searches) —
// même logique de reconnexion que getWishlist.
export async function getRecentlySpotted(): Promise<Piece[]> {
  return (await getRecentSearches()).map((entry) => entry.piece);
}

/** Recherches récentes avec leur meilleure proposition et leur date — pour
 * rouvrir un résultat depuis « Récemment spottées ». `limit` : 6 par défaut
 * côté serveur, 20 au plus (lib/recent-searches.ts). */
export async function getRecentSearches(limit?: number): Promise<{ searchId: string; createdAt: string; piece: Piece }[]> {
  const searches = await listRecentSearches(limit);
  return searches.flatMap((search) => {
    const best = search.matches[0];
    return best ? [{ searchId: search.id, createdAt: search.createdAt, piece: matchToPiece(best) }] : [];
  });
}

/** Le serveur ne sait pas encore chercher dans l'historique (plus ancien que l'app). */
export class HistorySearchUnavailableError extends Error {}

/** Une page de l'historique (lot « historique ») : 20 recherches, plus
 * anciennes que `before` ; avec `q`, seulement celles dont une pièce
 * correspond, et c'est CETTE pièce qui est renvoyée (rouverte en grand). Un
 * serveur qui renverrait une pièce qui ne correspond pas ignore `q` :
 * HistorySearchUnavailableError, jamais un résultat faux à l'écran. */
export async function getHistoryPage(options: { before?: string | null; q?: string | null }): Promise<{ searchId: string; createdAt: string; piece: Piece }[]> {
  const searches = await listRecentSearches(HISTORY_PAGE_SIZE, options);
  const q = options.q;
  if (q && searches.some((search) => search.matches[0] !== undefined && !matchesHistoryQuery(search.matches[0], q))) throw new HistorySearchUnavailableError();
  return searches.flatMap((search) => {
    const shown = search.matches[0];
    return shown ? [{ searchId: search.id, createdAt: search.createdAt, piece: matchToPiece(shown) }] : [];
  });
}

// Branché sur le vrai backend (table wishlist_items) — "Garder" persiste
// vraiment pour les pièces issues d'une recherche réelle.
export async function getWishlist(cursor?: string): Promise<{ items: WishlistItem[]; nextCursor: string | null }> {
  const page = await fetchWishlist(cursor);
  return { items: page.items.map(wishlistRowToItem), nextCursor: page.nextCursor };
}

// Lot collections : les envies d'une de ses collections (puce de l'écran
// Envies), sous la même forme que getWishlist.
export async function getCollectionWishlist(collectionId: string, cursor?: string): Promise<{ items: WishlistItem[]; nextCursor: string | null }> {
  const page = await fetchCollectionWishlist(collectionId, cursor);
  return { items: page.items.map(wishlistRowToItem), nextCursor: page.nextCursor };
}

export async function getVaultItems(): Promise<VaultItem[]> {
  if (USE_MOCK) return mock.getVaultItems();
  notImplemented();
}

export async function getMyProfile(): Promise<Profile> {
  if (USE_MOCK) return mock.getMyProfile();
  notImplemented();
}

// Parcours 3 : l'Envie créée est rendue (son identifiant sert à allumer son
// alerte de baisse de prix, lib/keep-alert.ts) ; null pour une pièce de
// démonstration, qui n'en a pas.
export async function addToWishlist(piece: Piece): Promise<RemoteWishlistItem | null> {
  if (!piece.real) {
    // Pièce de démonstration (catalogue mock) : pas de vraie pièce à
    // référencer, l'ajout reste local/factice.
    await mock.addToWishlist(piece);
    return null;
  }
  return await addWishlistItem({
    title: pieceTitle(piece.name),
    imageUrl: piece.imageUrl,
    reference: piece.reference,
    priceMin: piece.priceFrom,
    currency: piece.currency,
    merchantName: piece.merchantName,
    merchantUrl: piece.merchantUrl,
    productMatchId: piece.id,
  });
}

export async function addToVaultFromPiece(piece: Piece): Promise<void> {
  if (USE_MOCK) return mock.addToVaultFromPiece(piece);
  notImplemented();
}
