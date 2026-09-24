export interface Piece {
  id: string;
  name: string;
  reference: string | null;
  material: string | null;
  imageUrl: string;
  /** Image originale du marchand (haute définition) quand elle existe ;
   * à afficher en priorité, avec repli sur `imageUrl`. */
  imageHdUrl?: string | null;
  priceFrom: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
  /** Lien à ouvrir au clic (affilié si connu, sinon identique à
   * merchantUrl) — déjà résolu par le backend, aucun appel réseau
   * supplémentaire n'est nécessaire pour l'ouvrir. */
  affiliateUrl: string | null;
  /** true seulement pour une pièce issue d'une vraie recherche IA (id =
   * l'id réel d'un product_match côté serveur) — permet de distinguer
   * une pièce réelle d'une pièce de démonstration (catalogue mock). */
  real?: boolean;
}

export type SpotStatus = "success" | "failed";

/** "no_match" : l'analyse a eu lieu mais n'a rien trouvé (proposer de
 * recadrer). "technical" : panne réseau ou du service (proposer de
 * réessayer). "needs_photo" : aucune image exploitable, il faut importer une
 * capture. "rate_limited" : trop d'identifications en peu de temps (429). */
export type SpotFailReason = "no_match" | "technical" | "needs_photo" | "rate_limited";

export interface SpotResult {
  /** Identifiant de la recherche côté serveur — null si elle n'a pas pu
   * être créée (limite atteinte, réseau...). Permet à l'écran Résultat de
   * la relire après un rechargement de page. */
  searchId: string | null;
  /** Texte « Que cherchez-vous ? » utilisé, s'il y en avait un. */
  query?: string | null;
  /** Lien d'origine de la recherche (null pour une photo importée) — permet
   * de recadrer un résultat rouvert depuis « Récemment spottées ». */
  sourceUrl?: string | null;
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
  /** Pièce identifiée d'origine (suivi du clic marchand), si elle existe. */
  productMatchId: string | null;
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
