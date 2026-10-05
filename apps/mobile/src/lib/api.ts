import type {
  ApiErrorBody,
  AppNotification,
  BlockedUser,
  ConsentStatus,
  VersionedConsentType,
  RecordConsentsRequest,
  CreateReportRequest,
  CreateSearchRequest,
  CreateWishlistItemRequest,
  CropRect,
  FeedPage,
  MerchantLinkContext,
  Post,
  PreviewIssue,
  PrivacyLevel,
  Profile,
  ProductMatchClickResponse,
  ProductSearch,
  PublicProfile,
  ReactToPostResponse,
  TaggedPieceInput,
  UpdateMeRequest,
  UpdateLocaleRequest,
  AppLocale,
  UpdateVaultItemRequest,
  VaultCategory,
  VaultItem,
  VaultItemDetail,
  VaultPage,
  WishlistItem,
  WishlistPage,
  UserProfile,
  CommentsPage,
  PostComment,
} from "@monapp/shared-types";
import { CONSENT_VERSIONS } from "@monapp/shared-types";
import { supabase } from "./supabase";
import { setAnalyticsConsent, track } from "./analytics";
import { acceptLanguage, t } from "@/i18n";
import { imageFileFromUri } from "./image-file";

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error("EXPO_PUBLIC_API_URL doit être définie (voir apps/mobile/.env.example).");
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Aucune session active — impossible d'appeler le backend.");
  }

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  // Ne pas envoyer Content-Type: application/json sans corps — Fastify
  // refuse un JSON body parser sur une requête vide (ex. POST sans body).
  const hasJsonBody = !isFormData && init?.body !== undefined;

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      "Accept-Language": acceptLanguage(),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body ?? { error: "unknown", message: t.common.unknownServerError });
  }

  return response;
}

export async function fetchMyProfile(): Promise<Profile> {
  const response = await authorizedFetch("/api/me");
  return response.json();
}

export async function updateMyProfile(payload: UpdateMeRequest): Promise<Profile> {
  const response = await authorizedFetch("/api/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function updateMyLocale(locale: AppLocale): Promise<void> {
  const payload: UpdateLocaleRequest = { locale };
  await authorizedFetch("/api/me/locale", { method: "PUT", body: JSON.stringify(payload) });
}

export async function uploadAvatar(imageUri: string): Promise<Profile> {
  const formData = new FormData();
  await appendImageFile(formData, "file", imageUri);

  const response = await authorizedFetch("/api/me/avatar", { method: "POST", body: formData });
  const profile: Profile = await response.json();
  track("photo_changed", { target: "avatar" });
  return profile;
}

/** Temps 1 du Spotter — gratuit : crée la recherche et renvoie l'image qui
 * sera analysée (`thumbnailUrl`), sans aucun appel SerpApi. */
export async function prepareSearch(payload: CreateSearchRequest): Promise<ProductSearch & { previewIssue?: PreviewIssue | null }> {
  const response = await authorizedFetch("/api/searches/prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const search: ProductSearch & { previewIssue?: PreviewIssue | null } = await response.json();
  track("spot_started", { source: payload.sourceUrl ? "link" : "photo", platform: search.sourcePlatform });
  return search;
}

/** Temps 2 du Spotter — 1 crédit SerpApi : lance l'identification sur la
 * zone choisie. `imageUri` (capture ou photo importée) remplace l'image
 * préparée. `signal` permet d'abandonner la requête (bouton « Annuler »). */
export async function runSearch(
  searchId: string,
  params: { crop: CropRect | null; query: string; imageUri: string | null },
  signal?: AbortSignal
): Promise<ProductSearch> {
  const formData = new FormData();
  if (params.crop) formData.append("crop", JSON.stringify(params.crop));
  if (params.query.trim()) formData.append("query", params.query.trim());
  if (params.imageUri) await appendImageFile(formData, "file", params.imageUri);

  // Ciblage et précision : seulement des oui / non, jamais le texte saisi.
  track("spot_launched", { zone_adjusted: params.crop !== null, query_added: params.query.trim().length > 0, image_imported: params.imageUri !== null });
  const response = await authorizedFetch(`/api/searches/${searchId}/run`, { method: "POST", body: formData, signal });
  const search: ProductSearch = await response.json();
  track("spot_completed", {
    outcome: search.status === "failed" ? "failed" : search.matches.length > 0 ? "results" : "none",
    results_count: search.matches.length,
  });
  return search;
}

/** Joint une photo locale à un envoi (site et iPhone, voir image-file.ts).
 * Sans extension reconnue, le nom suit le type réel du fichier. */
async function appendImageFile(formData: FormData, fieldName: string, imageUri: string): Promise<void> {
  const file = await imageFileFromUri(imageUri);
  const filename = imageUri.split("/").pop()?.split("?")[0] ?? "";
  formData.append(fieldName, file, /\.\w+$/.test(filename) ? filename : `photo.${file.type === "image/png" ? "png" : "jpg"}`);
}

export async function fetchSearch(searchId: string): Promise<ProductSearch> {
  const response = await authorizedFetch(`/api/searches/${searchId}`);
  return response.json();
}

export async function listRecentSearches(limit?: number): Promise<ProductSearch[]> {
  const query = limit ? `?limit=${limit}` : "";
  const response = await authorizedFetch(`/api/searches${query}`);
  return response.json();
}

export async function trackProductMatchClick(
  matchId: string,
  context: MerchantLinkContext
): Promise<ProductMatchClickResponse> {
  const response = await authorizedFetch(`/api/product-matches/${matchId}/click`, {
    method: "POST",
    body: JSON.stringify({ context }),
    // Ce suivi est envoyé en arrière-plan, jamais attendu avant d'ouvrir le
    // lien marchand (voir merchant-links.ts) — keepalive laisse la requête
    // se terminer même si l'onglet/la page d'origine se ferme juste après.
    keepalive: true,
  });
  return response.json();
}

export async function fetchVault(cursor?: string): Promise<VaultPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/vault${query}`);
  return response.json();
}

export async function fetchVaultItem(id: string): Promise<VaultItemDetail> {
  const response = await authorizedFetch(`/api/vault/${id}`);
  return response.json();
}

export async function addVaultItemFromMatch(params: {
  title: string;
  imageUrl: string;
  category: VaultCategory;
  productMatchId: string;
}): Promise<VaultItem> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  formData.append("imageUrl", params.imageUrl);
  formData.append("productMatchId", params.productMatchId);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  const item: VaultItem = await response.json();
  track("vault_item_added", { source: "spotter", category: params.category });
  return item;
}

export async function addVaultItemFromPhoto(params: {
  title: string;
  category: VaultCategory;
  imageUri: string;
}): Promise<VaultItem> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  await appendImageFile(formData, "file", params.imageUri);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  const item: VaultItem = await response.json();
  track("vault_item_added", { source: "photo", category: params.category });
  return item;
}

export async function updateVaultItem(id: string, payload: UpdateVaultItemRequest): Promise<VaultItem> {
  const response = await authorizedFetch(`/api/vault/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.json();
}

/** « Changer la photo » d'une pièce du Vault (photo prise ou importée). */
export async function changeVaultItemPhoto(id: string, imageUri: string): Promise<VaultItem> {
  const formData = new FormData();
  await appendImageFile(formData, "file", imageUri);
  const response = await authorizedFetch(`/api/vault/${id}/photo`, { method: "POST", body: formData });
  const item: VaultItem = await response.json();
  track("photo_changed", { target: "vault" });
  return item;
}

export async function deleteVaultItem(id: string): Promise<void> {
  await authorizedFetch(`/api/vault/${id}`, { method: "DELETE" });
}

export async function fetchWishlist(cursor?: string): Promise<WishlistPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/wishlist${query}`);
  return response.json();
}

export async function addWishlistItem(payload: CreateWishlistItemRequest): Promise<WishlistItem> {
  const response = await authorizedFetch("/api/wishlist", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const item: WishlistItem = await response.json();
  track("wishlist_item_added", { context: "result" });
  return item;
}

export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const response = await authorizedFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
  return response.json();
}

export async function followUser(userId: string, context: "search" | "profile"): Promise<void> {
  await authorizedFetch(`/api/follows/${userId}`, { method: "POST" });
  track("follow_added", { context });
}

export async function unfollowUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/follows/${userId}`, { method: "DELETE" });
}

export async function fetchFeed(cursor?: string): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/feed${query}`);
  return response.json();
}

export async function fetchMyLifestylePosts(): Promise<Post[]> {
  const response = await authorizedFetch("/api/posts/mine");
  return response.json();
}

export async function fetchPost(id: string): Promise<Post> {
  const response = await authorizedFetch(`/api/posts/${id}`);
  return response.json();
}

export async function updatePostPrivacy(id: string, privacy: PrivacyLevel): Promise<Post> {
  const response = await authorizedFetch(`/api/posts/${id}`, { method: "PATCH", body: JSON.stringify({ privacy }) });
  const post: Post = await response.json();
  track("post_visibility_changed", { visibility: post.privacy });
  return post;
}

export async function deletePost(id: string): Promise<void> {
  await authorizedFetch(`/api/posts/${id}`, { method: "DELETE" });
}

export async function fetchComments(postId: string, cursor?: string): Promise<CommentsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/posts/${postId}/comments${query}`);
  return response.json();
}

export async function createComment(postId: string, body: string): Promise<PostComment> {
  const response = await authorizedFetch(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  const comment: PostComment = await response.json();
  track("comment_posted");
  return comment;
}

export async function deleteComment(commentId: string): Promise<void> {
  await authorizedFetch(`/api/comments/${commentId}`, { method: "DELETE" });
}

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const response = await authorizedFetch(`/api/users/${userId}`);
  return response.json();
}

export async function fetchUserPosts(userId: string, cursor?: string): Promise<FeedPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await authorizedFetch(`/api/users/${userId}/posts${query}`);
  return response.json();
}

export async function fetchWishlistItem(id: string): Promise<WishlistItem> {
  const response = await authorizedFetch(`/api/wishlist/${id}`);
  return response.json();
}

export async function deleteWishlistItem(id: string): Promise<void> {
  await authorizedFetch(`/api/wishlist/${id}`, { method: "DELETE" });
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const response = await authorizedFetch("/api/notifications");
  return response.json();
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  const response = await authorizedFetch("/api/notifications/unread-count");
  const data = (await response.json()) as { count: number };
  return data.count;
}

export async function markNotificationsRead(): Promise<void> {
  await authorizedFetch("/api/notifications/read-all", { method: "POST" });
}

export async function blockUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/blocks/${userId}`, { method: "POST" });
}

export async function unblockUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/blocks/${userId}`, { method: "DELETE" });
}

export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  const response = await authorizedFetch("/api/blocks");
  return response.json();
}

export async function reportContent(payload: CreateReportRequest): Promise<void> {
  await authorizedFetch("/api/reports", { method: "POST", body: JSON.stringify(payload) });
  track("report_submitted", { target_type: payload.targetType });
}

export async function createLifestylePost(params: {
  caption: string;
  imageUri: string;
  privacy?: string;
  taggedPieces?: TaggedPieceInput[];
}): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "lifestyle");
  if (params.caption) formData.append("caption", params.caption);
  if (params.privacy) formData.append("privacy", params.privacy);
  if (params.taggedPieces && params.taggedPieces.length > 0) {
    formData.append("taggedPieces", JSON.stringify(params.taggedPieces));
  }
  await appendImageFile(formData, "file", params.imageUri);

  const response = await authorizedFetch("/api/posts", { method: "POST", body: formData });
  const post: Post = await response.json();
  track("post_published", { type: "lifestyle", visibility: post.privacy, tagged_count: params.taggedPieces?.length ?? 0 });
  return post;
}

export async function sharePurchasePost(vaultItemId: string, privacy: PrivacyLevel, caption?: string): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "purchase");
  formData.append("vaultItemId", vaultItemId);
  formData.append("privacy", privacy);
  if (caption) formData.append("caption", caption);

  const response = await authorizedFetch("/api/posts", { method: "POST", body: formData });
  const post: Post = await response.json();
  track("post_published", { type: "purchase", visibility: post.privacy, tagged_count: 0 });
  return post;
}

export async function reactToPost(postId: string): Promise<ReactToPostResponse> {
  const response = await authorizedFetch(`/api/posts/${postId}/react`, { method: "POST" });
  const result: ReactToPostResponse = await response.json();
  if (result.viewerHasReacted) track("like_added");
  return result;
}

export async function fetchConsentStatus(): Promise<ConsentStatus[]> {
  const response = await authorizedFetch("/api/consents");
  return response.json();
}

/** Enregistre l'acceptation des documents juridiques et la déclaration
 * d'âge, dans la version en vigueur affichée par l'app (le serveur refuse
 * toute autre version). */
export async function acceptConsents(types: VersionedConsentType[]): Promise<void> {
  const body: RecordConsentsRequest = { consents: types.map((type) => ({ type, version: CONSENT_VERSIONS[type] })) };
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify(body) });
}

/** Accord (true) ou refus / retrait (false) des statistiques d'usage ; effet
 * immédiat sur la collecte dès que le serveur a enregistré le choix. */
export async function recordAnalyticsChoice(granted: boolean): Promise<void> {
  const body: RecordConsentsRequest = { consents: [{ type: "analytics", version: CONSENT_VERSIONS.analytics, granted }] };
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify(body) });
  setAnalyticsConsent(granted);
}

export async function exportMyData(): Promise<unknown> {
  const response = await authorizedFetch("/api/me/export");
  return response.json();
}

export async function deleteMyAccount(): Promise<void> {
  await authorizedFetch("/api/me", { method: "DELETE" });
}
