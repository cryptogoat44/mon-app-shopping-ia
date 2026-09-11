import type { Piece, Profile, VaultItem, WishlistItem } from "./types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PIECE_CATALOG: Piece[] = [
  {
    id: "tank-louis-cartier",
    name: "Tank Louis Cartier",
    reference: "WGTA0011",
    material: "Or jaune 18 carats",
    imageUrl: "",
    confidence: "exact",
    priceFrom: 8900,
    currency: "EUR",
    merchantName: "Cartier",
    merchantUrl: "https://www.cartier.com",
  },
  {
    id: "tank-must",
    name: "Tank Must, acier",
    reference: "WSTA0053",
    material: "Acier",
    imageUrl: "",
    confidence: "similar",
    priceFrom: 2500,
    currency: "EUR",
    merchantName: "Cartier",
    merchantUrl: "https://www.cartier.com",
  },
  {
    id: "kelly-25",
    name: "Sac Kelly 25",
    reference: null,
    material: "Cuir Togo",
    imageUrl: "",
    confidence: "exact",
    priceFrom: 11500,
    currency: "EUR",
    merchantName: "Hermès",
    merchantUrl: "https://www.hermes.com",
  },
  {
    id: "bottega-bounce",
    name: "Mocassins Bottega Veneta",
    reference: "Modèle Bounce",
    material: "Cuir intrecciato",
    imageUrl: "",
    confidence: "exact",
    priceFrom: 790,
    currency: "EUR",
    merchantName: "Bottega Veneta",
    merchantUrl: "https://www.bottegaveneta.com",
  },
  {
    id: "ceinture-h",
    name: "Ceinture H, 32mm",
    reference: null,
    material: "Cuir box",
    imageUrl: "",
    confidence: "exact",
    priceFrom: 480,
    currency: "EUR",
    merchantName: "Hermès",
    merchantUrl: "https://www.hermes.com",
  },
];

function byId(id: string): Piece {
  const piece = PIECE_CATALOG.find((p) => p.id === id);
  if (!piece) throw new Error(`Pièce introuvable dans le mock : ${id}`);
  return piece;
}

export async function getRecentlySpotted(): Promise<Piece[]> {
  await wait(300);
  return [byId("tank-louis-cartier"), byId("kelly-25"), byId("bottega-bounce")];
}

export async function getWishlist(): Promise<WishlistItem[]> {
  await wait(300);
  return [
    { ...byId("tank-must"), addedAt: "2026-09-02T10:00:00.000Z" },
    { ...byId("ceinture-h"), addedAt: "2026-08-28T14:30:00.000Z" },
  ];
}

export async function getVaultItems(): Promise<VaultItem[]> {
  await wait(300);
  return [
    { ...byId("tank-louis-cartier"), verificationState: "verified", addedAt: "2026-07-14T09:00:00.000Z" },
    { ...byId("kelly-25"), verificationState: "pending", addedAt: "2026-08-30T18:00:00.000Z" },
    { ...byId("bottega-bounce"), verificationState: "verified", addedAt: "2026-06-01T11:00:00.000Z" },
    { ...byId("ceinture-h"), verificationState: "pending", addedAt: "2026-09-05T08:00:00.000Z" },
  ];
}

export async function getMyProfile(): Promise<Profile> {
  await wait(200);
  return {
    id: "me",
    name: "Camille L.",
    handle: "camille_l",
    bio: "Curation discrète. Montres et maroquinerie, surtout.",
    avatarUrl: null,
    followersCount: 312,
    followingCount: 96,
    isFollowing: false,
  };
}

// Non persisté (prototype à données fictives) : confirme juste l'action à
// l'écran. Le vrai enregistrement viendra avec le backend.
export async function addToWishlist(_piece: Piece): Promise<void> {
  await wait(200);
}

export async function addToVaultFromPiece(_piece: Piece): Promise<void> {
  await wait(200);
}
