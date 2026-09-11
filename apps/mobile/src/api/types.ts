export type MatchConfidence = "exact" | "similar";

export interface Piece {
  id: string;
  name: string;
  reference: string | null;
  material: string | null;
  imageUrl: string;
  confidence: MatchConfidence;
  priceFrom: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
}

export type SpotStatus = "success" | "failed";

/** "needs_photo" : le lien n'a pas de miniature officielle exploitable,
 * l'utilisateur doit réessayer avec "Importer une photo". "no_match" :
 * l'analyse a eu lieu mais n'a identifié aucune pièce. */
export type SpotFailReason = "no_match" | "needs_photo";

export interface SpotResult {
  status: SpotStatus;
  /** Une entrée par pièce détectée dans l'image. Vide si status === "failed". */
  pieces: Piece[];
  similarPieces: Piece[];
  failReason?: SpotFailReason;
}

export type VaultVerificationState = "pending" | "verified" | "refused";

export interface VaultItem extends Piece {
  verificationState: VaultVerificationState;
  addedAt: string;
}

export interface WishlistItem extends Piece {
  addedAt: string;
}

export interface Profile {
  id: string;
  name: string;
  handle: string;
  bio: string | null;
  avatarUrl: string | null;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
}

export type PostType = "lifestyle" | "purchase";

export interface Post {
  id: string;
  type: PostType;
  mediaUrl: string;
  caption: string | null;
  taggedPieces: Pick<Piece, "id" | "name" | "imageUrl">[];
  createdAt: string;
}
