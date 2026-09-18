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
  /** true seulement pour une pièce issue d'une vraie recherche IA (id =
   * l'id réel d'un product_match côté serveur) — permet de distinguer
   * une pièce réelle d'une pièce de démonstration (catalogue mock). */
  real?: boolean;
}

export type SpotStatus = "success" | "failed";

/** "needs_photo" : le lien n'a pas de miniature officielle exploitable,
 * l'utilisateur doit réessayer avec "Importer une photo". "no_match" :
 * l'analyse a eu lieu mais n'a identifié aucune pièce. "rate_limited" :
 * trop d'identifications lancées en peu de temps (429 du backend). */
export type SpotFailReason = "no_match" | "needs_photo" | "rate_limited";

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
