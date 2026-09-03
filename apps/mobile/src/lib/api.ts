import type {
  ApiErrorBody,
  CreateSearchRequest,
  Profile,
  ProductMatchClickResponse,
  ProductSearch,
  UpdateMeRequest,
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

export async function uploadSearchScreenshot(searchId: string, imageUri: string): Promise<ProductSearch> {
  const filename = imageUri.split("/").pop() ?? "screenshot.jpg";
  const extensionMatch = /\.(\w+)$/.exec(filename);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? "jpg";
  const mimeType = extension === "png" ? "image/png" : "image/jpeg";

  const formData = new FormData();
  // React Native's fetch accepts this { uri, name, type } shape for files —
  // it is not a real Blob/File, but RN's FormData polyfill knows how to
  // stream it from the uri.
  formData.append("file", { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);

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
