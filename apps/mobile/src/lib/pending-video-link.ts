// Lien de vidéo « en attente » (mission « liens vidéo ») : quand un lien
// TikTok ou Instagram arrive (partagé à l'app ou collé), il est gardé sur
// l'appareil 10 minutes. Toute recherche d'image lancée pendant ce temps hors
// du lecteur (image partagée, recherche d'image d'iOS, photo choisie dans
// l'app, image déposée sur le site) lui est associée : « Associée à la vidéo
// de @pseudo », avec une croix pour l'en détacher. Après une recherche
// réussie, le spot est noté pour cette vidéo (POST /api/video-links/spots)
// et le lien est oublié.
// Logique pure, testée ; le stockage (AsyncStorage) est passé en paramètre,
// chaque lecture et écriture protégée : un stockage indisponible n'empêche
// jamais une recherche. Imports relatifs : fichier testé par vitest.
import type { VideoPlatform } from "@monapp/shared-types";

/** Durée de l'attente : 10 minutes. */
export const PENDING_VIDEO_LINK_TTL_MS = 10 * 60_000;
export const PENDING_VIDEO_LINK_KEY = "spotto.lien-video-en-attente";

const HANDLE = /^[a-z0-9._]{1,30}$/;
const MAX_URL_LENGTH = 2048;

export interface PendingVideoLink {
  /** Lien tel que reçu (déjà extrait du texte de partage) : le serveur le reconnaît à nouveau. */
  url: string;
  platform: VideoPlatform;
  /** Pseudo sans « @ », quand il est connu (adresse, réponse du serveur). */
  creatorHandle: string | null;
  /** Arrivée du lien (ms depuis 1970). */
  receivedAt: number;
}

/** Lien en attente, d'après le lien reçu. null : lien inutilisable. */
export function makePendingLink(input: { url: string; platform: VideoPlatform; creatorHandle?: string | null }, now: number): PendingVideoLink | null {
  const url = input.url.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH || !/^https?:\/\//i.test(url)) return null;
  if (input.platform !== "tiktok" && input.platform !== "instagram") return null;
  const handle = input.creatorHandle?.toLowerCase() ?? null;
  return { url, platform: input.platform, creatorHandle: handle && HANDLE.test(handle) ? handle : null, receivedAt: now };
}

/** Encore en attente ? (10 minutes, horloge revenue en arrière comprise : alors oublié.) */
export function isPendingLinkFresh(link: PendingVideoLink, now: number): boolean {
  const age = now - link.receivedAt;
  return age >= 0 && age <= PENDING_VIDEO_LINK_TTL_MS;
}

/** Lecture du stockage : un lien valide et encore en attente, sinon null. */
export function parsePendingLink(raw: string | null, now: number): PendingVideoLink | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.receivedAt !== "number" || !Number.isFinite(record.receivedAt)) return null;
  if (record.platform !== "tiktok" && record.platform !== "instagram") return null;
  const link = makePendingLink({ url: record.url, platform: record.platform, creatorHandle: typeof record.creatorHandle === "string" ? record.creatorHandle : null }, record.receivedAt);
  return link && isPendingLinkFresh(link, now) ? link : null;
}

/** Ce qu'il faut du stockage (AsyncStorage dans l'app). */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PendingLinkStore {
  /** Un lien arrive : il remplace l'ancien et part pour 10 minutes. */
  hold(input: { url: string; platform: VideoPlatform; creatorHandle?: string | null }): Promise<PendingVideoLink | null>;
  /** Ce que le serveur a appris du lien `receivedUrl` (adresse canonique, pseudo) ;
   * l'attente ne repart pas de zéro. Sans effet si un autre lien attend. */
  learn(receivedUrl: string, update: { url?: string | null; creatorHandle?: string | null }): Promise<void>;
  /** Le lien encore en attente, ou null (expiré : effacé au passage). */
  read(): Promise<PendingVideoLink | null>;
  /** Oublié : spot noté, ou détaché par la personne. */
  clear(): Promise<void>;
}

export function createPendingLinkStore(store: KeyValueStore, now: () => number): PendingLinkStore {
  async function write(link: PendingVideoLink): Promise<void> {
    try {
      await store.setItem(PENDING_VIDEO_LINK_KEY, JSON.stringify(link));
    } catch {
      // Stockage indisponible : le lien n'est simplement pas gardé.
    }
  }
  async function clear(): Promise<void> {
    try {
      await store.removeItem(PENDING_VIDEO_LINK_KEY);
    } catch {
      // Rien à effacer.
    }
  }
  async function readRaw(): Promise<string | null> {
    try {
      return await store.getItem(PENDING_VIDEO_LINK_KEY);
    } catch {
      return null;
    }
  }
  return {
    async hold(input) {
      const link = makePendingLink(input, now());
      if (link) await write(link);
      return link;
    },
    async learn(receivedUrl, update) {
      const current = parsePendingLink(await readRaw(), now());
      if (!current || current.url !== receivedUrl) return;
      const updated = makePendingLink(
        { url: update.url || current.url, platform: current.platform, creatorHandle: update.creatorHandle || current.creatorHandle },
        current.receivedAt
      );
      if (updated) await write(updated);
    },
    async read() {
      const raw = await readRaw();
      const link = parsePendingLink(raw, now());
      if (!link && raw !== null) await clear();
      return link;
    },
    clear,
  };
}
