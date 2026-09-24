import type { WishlistItem as RemoteWishlistItem } from "@monapp/shared-types";
import { addWishlistItem, fetchSearch, fetchWishlist, listRecentSearches } from "@/lib/api";
import { matchToPiece, toSpotResult } from "@/lib/spot-result";
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
    priceFrom: row.priceMin,
    currency: row.currency,
    merchantName: row.merchantName,
    merchantUrl: row.merchantUrl,
    // Les Envies ne passent pas par un product_match : pas de lien affilié
    // distinct connu, on rouvre l'URL marchande telle quelle.
    affiliateUrl: row.merchantUrl,
    real: true,
    addedAt: row.createdAt,
  };
}

// Relit une recherche déjà faite (écran Résultat rouvert ou rechargé) —
// aucun nouvel appel SerpApi, seulement la lecture de ce qui est en base.
export async function loadSpotResult(searchId: string): Promise<SpotResult> {
  return toSpotResult(await fetchSearch(searchId));
}

// Branché sur le vrai historique de recherches (table product_searches) —
// même logique de reconnexion que getWishlist.
export async function getRecentlySpotted(): Promise<Piece[]> {
  return (await getRecentSearches()).map((entry) => entry.piece);
}

/** Recherches récentes avec leur meilleure proposition — pour rouvrir un
 * résultat depuis « Récemment spottées ». */
export async function getRecentSearches(): Promise<{ searchId: string; piece: Piece }[]> {
  const searches = await listRecentSearches();
  return searches.flatMap((search) => {
    const best = search.matches[0];
    return best ? [{ searchId: search.id, piece: matchToPiece(best) }] : [];
  });
}

// Branché sur le vrai backend (table wishlist_items) — "Garder" persiste
// vraiment pour les pièces issues d'une recherche réelle.
export async function getWishlist(cursor?: string): Promise<{ items: WishlistItem[]; nextCursor: string | null }> {
  const page = await fetchWishlist(cursor);
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

export async function addToWishlist(piece: Piece): Promise<void> {
  if (!piece.real) {
    // Pièce de démonstration (catalogue mock) : pas de vraie pièce à
    // référencer, l'ajout reste local/factice.
    return mock.addToWishlist(piece);
  }
  await addWishlistItem({
    title: piece.name,
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
