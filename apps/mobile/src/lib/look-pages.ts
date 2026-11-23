// La page look, côté membre (lot « page look », migration 0057) : statut,
// création, liste, arrêt, et l'arrêt par la modération. Chaque appel porte la
// session du membre (authorizedFetch). Le visiteur, lui, passe par
// lib/look-public.ts, sans session.
import { useEffect, useState } from "react";
import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { CreateLookResponse, LookPagesStatus, SharedLooksList, StopLookRequest } from "@monapp/shared-types";
import { ApiError, authorizedFetch } from "./api";
import { track } from "./analytics";
import { useAuth } from "./auth-context";
import { lookShareMessage, readLookPagesStatus } from "./look-page";
import { t } from "../i18n";

const HIDDEN: LookPagesStatus = { enabled: false, manage: false };

/** GET /api/looks/status. Ancien serveur (404) : tout caché ; hors ligne : une erreur (redemandé plus tard). */
export async function fetchLookPagesStatus(): Promise<LookPagesStatus> {
  try {
    const response = await authorizedFetch("/api/looks/status");
    return readLookPagesStatus(await response.json().catch(() => null));
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return HIDDEN;
    throw error;
  }
}

// Statut lu une fois par compte et par session (au modèle des collections).
let cached: { userId: string; status: LookPagesStatus } | null = null;
let pending: { userId: string; promise: Promise<LookPagesStatus> } | null = null;

function ensureStatus(userId: string): Promise<LookPagesStatus> {
  if (cached?.userId === userId) return Promise.resolve(cached.status);
  if (pending?.userId === userId) return pending.promise;
  const promise = fetchLookPagesStatus().then(
    (status) => {
      cached = { userId, status };
      pending = null;
      return status;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    }
  );
  pending = { userId, promise };
  return promise;
}

/** Le statut des pages look pour le compte connecté ; null tant qu'il n'est pas connu (tout reste caché). */
export function useLookPagesStatus(): LookPagesStatus | null {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [status, setStatus] = useState<LookPagesStatus | null>(() => (userId && cached?.userId === userId ? cached.status : null));
  useEffect(() => {
    if (!userId) {
      setStatus(null);
      return;
    }
    let active = true;
    ensureStatus(userId).then(
      (value) => active && setStatus(value),
      () => active && setStatus(null)
    );
    return () => {
      active = false;
    };
  }, [userId]);
  return status;
}

// Liens déjà créés pendant cette visite (mémoire seulement) : la même pièce
// partagée de nouveau reprend son lien sans nouvelle feuille de confirmation.
const sharedLookUrls = new Map<string, string>();

export function rememberedLookUrl(matchId: string): string | null {
  return sharedLookUrls.get(matchId) ?? null;
}

export function rememberLookUrl(matchId: string, url: string): void {
  sharedLookUrls.set(matchId, url);
}

/** POST /api/looks : la page de la pièce (ou celle déjà active : même lien). */
export async function createLook(matchId: string): Promise<CreateLookResponse> {
  const response = await authorizedFetch("/api/looks", { method: "POST", body: JSON.stringify({ matchId }) });
  return response.json();
}

export async function listLooks(): Promise<SharedLooksList> {
  const response = await authorizedFetch("/api/looks");
  return response.json();
}

export async function stopLook(id: string): Promise<void> {
  await authorizedFetch(`/api/looks/${encodeURIComponent(id)}`, { method: "DELETE" });
  // Un lien arrêté ne doit plus être repris par « Partager le look ».
  sharedLookUrls.clear();
  track("look_stopped", { from: "settings" });
}

/** Modération : arrêter une page à partir du lien collé. */
export async function stopLookAsAdmin(link: string): Promise<void> {
  const payload: StopLookRequest = { link };
  await authorizedFetch("/api/admin/looks/stop", { method: "POST", body: JSON.stringify(payload) });
}

/** Partage du lien d'une page : feuille de partage du téléphone ; sur un
 * navigateur sans partage, copie du message (comme lib/share-post.ts). */
export async function shareLookLink(pieceName: string, url: string, reused: boolean): Promise<"shared" | "copied" | "cancelled"> {
  const message = lookShareMessage(pieceName, url, t.look);
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: t.look.shareMessage(pieceName), url });
        track("look_shared", { method: "native", reused });
        return "shared";
      }
      await Clipboard.setStringAsync(message);
      track("look_shared", { method: "copy", reused });
      return "copied";
    }
    const { action } = await Share.share({ message });
    if (action !== Share.sharedAction) return "cancelled";
    track("look_shared", { method: "native", reused });
    return "shared";
  } catch {
    return "cancelled";
  }
}
