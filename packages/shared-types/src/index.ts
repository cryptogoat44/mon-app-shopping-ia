export type PrivacyLevel = "public" | "followers" | "private";

export interface Profile {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  locale: string;
  defaultPrivacy: PrivacyLevel;
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

export type PlatformSource = "tiktok" | "instagram" | "other";
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
  sourceUrl: string;
  sourcePlatform: PlatformSource;
  method: RecognitionMethod;
  thumbnailUrl: string | null;
  status: SearchStatus;
  errorMessage: string | null;
  createdAt: string;
  matches: ProductMatch[];
}

export interface CreateSearchRequest {
  sourceUrl: string;
}

export interface ProductMatchClickResponse {
  url: string;
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
