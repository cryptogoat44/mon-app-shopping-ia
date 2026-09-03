import type {
  ApiErrorBody,
  CreateSearchRequest,
  Post,
  Profile,
  ProductMatchClickResponse,
  ProductSearch,
  PublicProfile,
  ReactToPostResponse,
  UpdateMeRequest,
  UpdateVaultItemRequest,
  VaultCategory,
  VaultItem,
} from "@monapp/shared-types";
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

export async function createSearch(payload: CreateSearchRequest): Promise<ProductSearch> {
  const response = await authorizedFetch("/api/searches", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.json();
}

function appendImageFile(formData: FormData, fieldName: string, imageUri: string): void {
  const filename = imageUri.split("/").pop() ?? "photo.jpg";
  const extensionMatch = /\.(\w+)$/.exec(filename);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "jpg";
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";

  // React Native's fetch accepts this { uri, name, type } shape for files —
  // it is not a real Blob/File, but RN's FormData polyfill knows how to
  // stream it from the uri.
  formData.append(fieldName, { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);
}

export async function uploadSearchScreenshot(searchId: string, imageUri: string): Promise<ProductSearch> {
  const formData = new FormData();
  appendImageFile(formData, "file", imageUri);

  const response = await authorizedFetch(`/api/searches/${searchId}/screenshot`, {
    method: "POST",
    body: formData,
  });
  return response.json();
}

export async function fetchSearch(searchId: string): Promise<ProductSearch> {
  const response = await authorizedFetch(`/api/searches/${searchId}`);
  return response.json();
}

export async function trackProductMatchClick(matchId: string): Promise<ProductMatchClickResponse> {
  const response = await authorizedFetch(`/api/product-matches/${matchId}/click`, { method: "POST" });
  return response.json();
}

export async function fetchVault(): Promise<VaultItem[]> {
  const response = await authorizedFetch("/api/vault");
  return response.json();
}

export async function fetchVaultItem(id: string): Promise<VaultItem> {
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
  appendImageFile(formData, "file", params.imageUri);

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

export async function fetchFeed(): Promise<Post[]> {
  const response = await authorizedFetch("/api/feed");
  return response.json();
}

export async function createLifestylePost(params: {
  caption: string;
  imageUri: string;
  privacy?: string;
}): Promise<Post> {
  const formData = new FormData();
  formData.append("type", "lifestyle");
  if (params.caption) formData.append("caption", params.caption);
  if (params.privacy) formData.append("privacy", params.privacy);
  appendImageFile(formData, "file", params.imageUri);

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
