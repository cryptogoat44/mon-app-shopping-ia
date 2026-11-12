// Code d'intégration officiel d'une publication Instagram (mission « liens
// vidéo », règle 1b) : le SEUL appel du serveur vers Meta. Il sert uniquement
// à afficher le lecteur officiel dans l'app.
//
// - Appel : GET graph.facebook.com/…/instagram_oembed?url=<adresse publique>,
//   sans jeton (annonce de Meta du 15 juin 2026), 8 secondes au plus.
// - Seul le champ `html` (le code d'intégration) est lu. L'adresse de la
//   miniature que Meta joint à sa réponse n'est NI lue, NI gardée, NI
//   téléchargée. Aucune image, aucune vidéo ne passe par le serveur.
// - Le pseudo du créateur n'est retenu que s'il figure dans ce code
//   (« … (@pseudo) »).
// - Limite de Meta sans jeton : 1 000 demandes par heure. Le code d'une vidéo
//   est gardé 24 h en mémoire, le serveur s'arrête de lui-même à 900 demandes
//   par heure, et se tait 10 minutes si Meta répond « trop de demandes ».
//   Dans ces cas l'app montre l'écran de secours (« limit »).
// - Contenu privé, supprimé ou non intégrable : « unavailable » (gardé 1 h).
import type { VideoLink } from "@monapp/shared-types";
import { safeFetch } from "./safeFetch.js";

/** ⚠️ Version de l'API de Meta citée par son annonce du 15 juin 2026 : à
 * relever quand Meta retire cette version (voir docs/liens-video/interrupteurs.md). */
export const INSTAGRAM_OEMBED_ENDPOINT = "https://graph.facebook.com/v25.0/instagram_oembed";
const OEMBED_TIMEOUT_MS = 8_000;
/** Demandes à Meta par heure, au plus (sa limite est de 1 000 : marge gardée). */
export const INSTAGRAM_EMBED_HOURLY_BUDGET = 900;
const HOUR_MS = 60 * 60 * 1000;
const FOUND_TTL_MS = 24 * HOUR_MS;
const UNAVAILABLE_TTL_MS = HOUR_MS;
/** Silence après un « trop de demandes » de Meta. */
export const INSTAGRAM_EMBED_COOLDOWN_MS = 10 * 60 * 1000;
/** Codes d'intégration gardés en mémoire au plus (les plus anciens partent d'abord). */
export const INSTAGRAM_EMBED_CACHE_SIZE = 2_000;
/** Taille maximale d'un code d'intégration accepté (ceux de Meta font quelques Ko). */
const EMBED_HTML_MAX_LENGTH = 30_000;

export type InstagramEmbedIssue = "limit" | "unavailable" | "unreachable";
export type InstagramEmbed = { ok: true; html: string; creatorHandle: string | null } | { ok: false; issue: InstagramEmbedIssue };

interface Cached {
  embed: InstagramEmbed;
  expiresAt: number;
}
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<InstagramEmbed>>();
/** Heures des demandes parties vers Meta (fenêtre glissante d'une heure). */
let calls: number[] = [];
let silentUntil = 0;

/** Tests seulement : oublie le cache, le compteur et le silence. */
export function resetInstagramEmbed(): void {
  cache.clear();
  pending.clear();
  calls = [];
  silentUntil = 0;
}

/** Demandes parties vers Meta depuis une heure. */
export function instagramEmbedCalls(now: number = Date.now()): number {
  calls = calls.filter((at) => now - at < HOUR_MS);
  return calls.length;
}

/** Le pseudo, seulement s'il est écrit dans le code d'intégration (« (@pseudo) »). */
export function handleInEmbed(html: string): string | null {
  const found = /\(@([A-Za-z0-9._]{1,30})\)/.exec(html);
  return found ? found[1]!.toLowerCase() : null;
}

async function askMeta(link: VideoLink): Promise<InstagramEmbed> {
  // omitscript : le code est rendu sans sa balise <script> ; la page hôte de
  // l'app charge elle-même le script officiel d'Instagram (une seule adresse connue).
  const endpoint = `${INSTAGRAM_OEMBED_ENDPOINT}?url=${encodeURIComponent(link.canonicalUrl)}&omitscript=true`;
  let response: Response;
  try {
    response = await safeFetch(endpoint, { allowedHosts: ["graph.facebook.com"], signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) });
  } catch {
    return { ok: false, issue: "unreachable" };
  }
  if (response.status === 429) return { ok: false, issue: "limit" };
  if (response.status >= 500) return { ok: false, issue: "unreachable" };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, issue: response.ok ? "unreachable" : "unavailable" };
  }
  if (!response.ok) {
    // Meta signale ses limites par un code d'erreur (4, 17, 32, 613), parfois avec un statut 400.
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return { ok: false, issue: code === 4 || code === 17 || code === 32 || code === 613 ? "limit" : "unavailable" };
  }
  const html = (body as { html?: unknown } | null)?.html;
  if (typeof html !== "string" || html.length === 0 || html.length > EMBED_HTML_MAX_LENGTH || !html.includes("instagram-media")) {
    return { ok: false, issue: "unavailable" };
  }
  return { ok: true, html, creatorHandle: link.creatorHandle ?? handleInEmbed(html) };
}

function remember(key: string, embed: InstagramEmbed, now: number): void {
  if (!embed.ok && embed.issue !== "unavailable") return;
  cache.delete(key);
  cache.set(key, { embed, expiresAt: now + (embed.ok ? FOUND_TTL_MS : UNAVAILABLE_TTL_MS) });
  while (cache.size > INSTAGRAM_EMBED_CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

/** Le code d'intégration officiel d'une publication Instagram : servi par la
 * mémoire pendant 24 h, sinon demandé à Meta dans la limite horaire. */
export async function instagramEmbed(link: VideoLink, now: () => number = Date.now): Promise<InstagramEmbed> {
  if (link.platform !== "instagram") return { ok: false, issue: "unavailable" };
  const at = now();
  const known = cache.get(link.videoKey);
  if (known && known.expiresAt > at) return known.embed;

  let running = pending.get(link.videoKey);
  if (!running) {
    if (at < silentUntil || instagramEmbedCalls(at) >= INSTAGRAM_EMBED_HOURLY_BUDGET) return { ok: false, issue: "limit" };
    calls.push(at);
    running = askMeta(link)
      .then((embed) => {
        if (!embed.ok && embed.issue === "limit") silentUntil = now() + INSTAGRAM_EMBED_COOLDOWN_MS;
        remember(link.videoKey, embed, now());
        return embed;
      })
      .finally(() => pending.delete(link.videoKey));
    pending.set(link.videoKey, running);
  }
  return running;
}
