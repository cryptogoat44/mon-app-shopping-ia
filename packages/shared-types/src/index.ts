export type PrivacyLevel = "public" | "followers" | "private";

export interface Profile {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  locale: string;
  defaultPrivacy: PrivacyLevel;
  followersCount: number;
  followingCount: number;
  createdAt: string;
  updatedAt: string;
}

/** True once the user has picked a username — the app shows the
 * "complete your profile" screen until this is true. */
export function isProfileComplete(profile: Profile): boolean {
  return profile.username !== null;
}

export interface UpdateMeRequest {
  username: string;
  displayName: string;
  bio?: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export type PlatformSource = "tiktok" | "instagram" | "other" | "photo";
export type RecognitionMethod = "oembed" | "manual_screenshot";
export type SearchStatus = "pending" | "processing" | "completed" | "failed";

export interface ProductMatch {
  id: string;
  rank: number;
  productName: string;
  brand: string | null;
  imageUrl: string;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string;
}

export interface ProductSearch {
  id: string;
  sourceUrl: string | null;
  sourcePlatform: PlatformSource;
  method: RecognitionMethod;
  thumbnailUrl: string | null;
  status: SearchStatus;
  errorMessage: string | null;
  createdAt: string;
  matches: ProductMatch[];
}

export interface CreateSearchRequest {
  sourceUrl?: string;
}

export interface ProductMatchClickResponse {
  url: string;
}

/** D'où l'utilisateur a ouvert un lien marchand — sert à mesurer l'usage
 * réel des différentes surfaces sans identifier personne (remplace l'IP
 * hachée, retirée de `affiliate_clicks`). Source unique : le mobile et le
 * backend importent `MERCHANT_LINK_CONTEXTS` plutôt que de dupliquer la
 * liste, pour qu'une faute de frappe ou un contexte oublié soit impossible. */
export const MERCHANT_LINK_CONTEXTS = ["result", "similar", "vault", "wishlist", "post", "price_alert"] as const;
export type MerchantLinkContext = (typeof MERCHANT_LINK_CONTEXTS)[number];

export interface TrackProductMatchClickRequest {
  context?: MerchantLinkContext;
}

export type VaultCategory = "clothing" | "watches" | "accessories" | "shoes" | "bags" | "home" | "other";

export interface VaultItem {
  id: string;
  title: string;
  imageUrl: string;
  category: VaultCategory;
  privacy: PrivacyLevel;
  verified: boolean;
  productMatchId: string | null;
  createdAt: string;
}

export interface UpdateVaultItemRequest {
  title?: string;
  category?: VaultCategory;
  privacy?: PrivacyLevel;
}

export interface VaultPage {
  items: VaultItem[];
  nextCursor: string | null;
  /** Nombre total d'objets, tous les toutes pages confondues — seulement
   * calculé pour la première page (sans curseur), `null` au-delà. */
  totalCount: number | null;
}

export interface WishlistItem {
  id: string;
  title: string;
  imageUrl: string;
  reference: string | null;
  priceMin: number | null;
  currency: string | null;
  merchantName: string | null;
  merchantUrl: string | null;
  productMatchId: string | null;
  createdAt: string;
}

export interface CreateWishlistItemRequest {
  title: string;
  imageUrl: string;
  reference?: string | null;
  priceMin?: number | null;
  currency?: string | null;
  merchantName?: string | null;
  merchantUrl?: string | null;
  productMatchId?: string | null;
}

export interface WishlistPage {
  items: WishlistItem[];
  nextCursor: string | null;
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowing: boolean;
}

export type PostType = "lifestyle" | "purchase";

export interface PostAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostVaultItem {
  id: string;
  title: string;
  verified: boolean;
}

export interface Post {
  id: string;
  type: PostType;
  caption: string | null;
  mediaUrl: string;
  privacy: PrivacyLevel;
  createdAt: string;
  author: PostAuthor;
  vaultItem: PostVaultItem | null;
  reactionCount: number;
  viewerHasReacted: boolean;
}

export interface ReactToPostResponse {
  reactionCount: number;
  viewerHasReacted: boolean;
}

export interface FeedPage {
  posts: Post[];
  nextCursor: string | null;
}

export type ConsentType = "terms" | "privacy_policy" | "marketing_email";

export interface ConsentStatus {
  type: ConsentType;
  grantedAt: string | null;
}

export interface RecordConsentsRequest {
  types: ConsentType[];
}

export type NotificationType = "follow" | "like";

export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: PostAuthor;
  createdAt: string;
  read: boolean;
}

export type ReportTargetType = "user" | "post";
export type ReportReason = "spam" | "inappropriate" | "harassment" | "other";

export interface CreateReportRequest {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  note?: string;
}

export interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  blockedAt: string;
}
