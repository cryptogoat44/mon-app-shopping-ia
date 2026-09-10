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

export async function spot(source: { type: "link"; url: string } | { type: "photo"; uri: string }): Promise<SpotResult> {
  if (USE_MOCK) return mock.spot(source);
  notImplemented();
}

export async function getRecentlySpotted(): Promise<Piece[]> {
  if (USE_MOCK) return mock.getRecentlySpotted();
  notImplemented();
}

export async function getWishlist(): Promise<WishlistItem[]> {
  if (USE_MOCK) return mock.getWishlist();
  notImplemented();
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
  if (USE_MOCK) return mock.addToWishlist(piece);
  notImplemented();
}

export async function addToVaultFromPiece(piece: Piece): Promise<void> {
  if (USE_MOCK) return mock.addToVaultFromPiece(piece);
  notImplemented();
}
