import type {
  ApiErrorBody,
  AppNotification,
  BlockedUser,
  ConsentStatus,
  ConsentType,
  CreateReportRequest,
  CreateSearchRequest,
  CreateWishlistItemRequest,
  CropRect,
  FeedPage,
  MerchantLinkContext,
  Post,
  Profile,
  ProductMatchClickResponse,
  ProductSearch,
  PublicProfile,
  ReactToPostResponse,
  TaggedPieceInput,
  UpdateMeRequest,
  UpdateVaultItemRequest,
  VaultCategory,
  VaultItem,
  VaultItemDetail,
  VaultPage,
  WishlistItem,
  WishlistPage,
} from "@monapp/shared-types";
import { Platform } from "react-native";
import { supabase } from "./supabase";

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
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body ?? { error: "unknown", message: "Erreur inconnue du serveur." });
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

export async function uploadAvatar(imageUri: string): Promise<Profile> {
  const formData = new FormData();
  await appendImageFile(formData, "file", imageUri);

  const response = await authorizedFetch("/api/me/avatar", { method: "POST", body: formData });
  return response.json();
}

/** Temps 1 du Spotter — gratuit : crée la recherche et renvoie l'image qui
 * sera analysée (`thumbnailUrl`), sans aucun appel SerpApi. */
export async function prepareSearch(payload: CreateSearchRequest): Promise<ProductSearch> {
  const response = await authorizedFetch("/api/searches/prepare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.json();
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

  const response = await authorizedFetch(`/api/searches/${searchId}/run`, { method: "POST", body: formData, signal });
  return response.json();
}

async function appendImageFile(formData: FormData, fieldName: string, imageUri: string): Promise<void> {
  const filename = imageUri.split("/").pop()?.split("?")[0] || "photo.jpg";
  const extensionMatch = /\.(\w+)$/.exec(filename);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "jpg";
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";

  if (Platform.OS === "web") {
    // Sur le web, le sélecteur de photos renvoie une adresse blob:/data: et
    // le FormData du navigateur n'accepte qu'un vrai fichier : l'objet
    // { uri, name, type } propre à React Native y devenait le texte
    // « [object Object] », et aucune photo n'arrivait au serveur.
    const blob = await (await fetch(imageUri)).blob();
    formData.append(fieldName, blob, /\.\w+$/.test(filename) ? filename : `photo.${blob.type === "image/png" ? "png" : "jpg"}`);
    return;
  }

  // Sur iPhone/Android, le fetch de React Native accepte cette forme
  // { uri, name, type } : ce n'est pas un vrai Blob, mais son FormData sait
  // lire le fichier depuis l'uri.
  formData.append(fieldName, { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);
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
  privacy?: string;
}): Promise<VaultItem> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  formData.append("imageUrl", params.imageUrl);
  formData.append("productMatchId", params.productMatchId);
  if (params.privacy) formData.append("privacy", params.privacy);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  return response.json();
}

export async function addVaultItemFromPhoto(params: {
  title: string;
  category: VaultCategory;
  imageUri: string;
  privacy?: string;
}): Promise<VaultItem> {
  const formData = new FormData();
  formData.append("title", params.title);
  formData.append("category", params.category);
  if (params.privacy) formData.append("privacy", params.privacy);
  await appendImageFile(formData, "file", params.imageUri);

  const response = await authorizedFetch("/api/vault", { method: "POST", body: formData });
  return response.json();
}

export async function updateVaultItem(id: string, payload: UpdateVaultItemRequest): Promise<VaultItem> {
  const response = await authorizedFetch(`/api/vault/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return response.json();
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
  return response.json();
}

export async function searchUsers(query: string): Promise<PublicProfile[]> {
  const response = await authorizedFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
  return response.json();
}

export async function followUser(userId: string): Promise<void> {
  await authorizedFetch(`/api/follows/${userId}`, { method: "POST" });
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
  return response.json();
}

export async function sharePurchasePost(vaultItemId: string): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "purchase");
  formData.append("vaultItemId", vaultItemId);

  const response = await authorizedFetch("/api/posts", { method: "POST", body: formData });
  return response.json();
}

export async function reactToPost(postId: string): Promise<ReactToPostResponse> {
  const response = await authorizedFetch(`/api/posts/${postId}/react`, { method: "POST" });
  return response.json();
}

export async function fetchConsentStatus(): Promise<ConsentStatus[]> {
  const response = await authorizedFetch("/api/consents");
  return response.json();
}

export async function recordConsents(types: ConsentType[]): Promise<void> {
  await authorizedFetch("/api/consents", { method: "POST", body: JSON.stringify({ types }) });
}

export async function exportMyData(): Promise<unknown> {
  const response = await authorizedFetch("/api/me/export");
  return response.json();
}

export async function deleteMyAccount(): Promise<void> {
  await authorizedFetch("/api/me", { method: "DELETE" });
}
