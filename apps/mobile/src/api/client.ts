import type { ProductMatch, ProductSearch, WishlistItem as RemoteWishlistItem } from "@monapp/shared-types";
import { addWishlistItem, createSearch, fetchWishlist, uploadSearchScreenshot } from "@/lib/api";
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

function matchToPiece(match: ProductMatch): Piece {
  return {
    id: match.id,
    name: match.productName,
    reference: match.brand,
    material: null,
    imageUrl: match.imageUrl,
    confidence: match.rank === 1 ? "exact" : "similar",
    priceFrom: match.priceMin,
    currency: match.currency,
    merchantName: match.merchantName,
    merchantUrl: match.merchantUrl,
    real: true,
  };
}

function wishlistRowToItem(row: RemoteWishlistItem): WishlistItem {
  return {
    id: row.id,
    name: row.title,
    reference: row.reference,
    material: null,
    imageUrl: row.imageUrl,
    confidence: "exact",
    priceFrom: row.priceMin,
    currency: row.currency,
    merchantName: row.merchantName,
    merchantUrl: row.merchantUrl,
    real: true,
    addedAt: row.createdAt,
  };
}

function toSpotResult(search: ProductSearch): SpotResult {
  if (search.matches.length === 0) {
    const needsPhoto = search.method === "manual_screenshot" && search.status === "pending";
    return { status: "failed", pieces: [], similarPieces: [], failReason: needsPhoto ? "needs_photo" : "no_match" };
  }
  return { status: "success", pieces: search.matches.map(matchToPiece), similarPieces: [] };
}

// Branché sur le vrai pipeline de reconnaissance (oEmbed + SerpApi côté
// backend) — seule fonction de ce fichier à ne plus dépendre de USE_MOCK.
// Les erreurs réseau/API sont ramenées à un résultat "failed" ordinaire
// pour qu'analysis.tsx n'ait rien à connaître de cette distinction.
export async function spot(source: { type: "link"; url: string } | { type: "photo"; uri: string }): Promise<SpotResult> {
  try {
    if (source.type === "link") {
      const search = await createSearch({ sourceUrl: source.url });
      return toSpotResult(search);
    }
    const created = await createSearch({});
    const search = await uploadSearchScreenshot(created.id, source.uri);
    return toSpotResult(search);
  } catch {
    return { status: "failed", pieces: [], similarPieces: [], failReason: "no_match" };
  }
}

export async function getRecentlySpotted(): Promise<Piece[]> {
  if (USE_MOCK) return mock.getRecentlySpotted();
  notImplemented();
}

// Branché sur le vrai backend (table wishlist_items) — "Garder" persiste
// vraiment pour les pièces issues d'une recherche réelle.
export async function getWishlist(): Promise<WishlistItem[]> {
  const rows = await fetchWishlist();
  return rows.map(wishlistRowToItem);
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
