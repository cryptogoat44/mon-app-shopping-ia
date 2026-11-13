// Code d'intégration officiel d'une publication Instagram (mission « liens
// vidéo », règle 1b) : le SEUL appel du serveur vers Meta. Il sert uniquement
// à afficher le lecteur officiel dans l'app.
//
// - Appel : GET graph.facebook.com/…/instagram_oembed?url=<adresse publique>,
//   sans jeton (annonce de Meta du 15 juin 2026), 8 secondes au plus.
// - Seul le champ `html` (le code d'intégration) est lu. L'adresse de la
//   miniature que Meta joint à sa réponse n'est NI lue, NI gardée, NI
//   téléchargée. Aucune image, aucune vidéo ne passe par le serveur.
// - Le pseudo du créateur : celui que Meta écrit dans ce code (« A post
//   shared by … (@pseudo) », la DERNIÈRE occurrence), sinon celui du lien de
//   la personne qui demande. Revue de sécurité : le pseudo d'un lien n'entre
//   jamais dans la mémoire partagée (sinon un seul lien fabriqué attribuait
//   un reel à n'importe quel compte, pour tous les membres, pendant 24 h).
// - Limite de Meta sans jeton : 1 000 demandes par heure. Le code d'une vidéo
//   est gardé 24 h en mémoire, le serveur s'arrête de lui-même à 900 demandes
//   par heure, et se tait 10 minutes si Meta répond « trop de demandes ».
//   Dans ces cas l'app montre l'écran de secours (« limit »). Chaque membre
//   n'envoie lui-même qu'un petit nombre de demandes vers Meta (`beforeFetch`,
//   appelée seulement quand la vidéo manque à la mémoire : limite
//   videoEmbedFetch) : quelques comptes ne peuvent plus épuiser le budget de
//   tout le service avec des codes inventés.
// - Contenu privé, supprimé ou non intégrable : « unavailable », gardé 1 h
//   dans une PETITE mémoire à part (500 codes) : des codes inventés ne
//   chassent jamais les vrais codes d'intégration de la mémoire principale.
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
/** Réponses « indisponible » gardées au plus, à part (les plus anciennes partent d'abord). */
export const INSTAGRAM_EMBED_MISSING_CACHE_SIZE = 500;
/** Taille maximale d'un code d'intégration accepté (ceux de Meta font quelques Ko). */
const EMBED_HTML_MAX_LENGTH = 30_000;

export type InstagramEmbedIssue = "limit" | "unavailable" | "unreachable" | "rate_limited";
export type InstagramEmbed = { ok: true; html: string; creatorHandle: string | null } | { ok: false; issue: InstagramEmbedIssue };

/** Ce que Meta a répondu, et rien d'autre : le code et le pseudo qui y est écrit. */
type MetaAnswer = { ok: true; html: string; metaHandle: string | null } | { ok: false; issue: InstagramEmbedIssue };

interface Found {
  html: string;
  metaHandle: string | null;
  expiresAt: number;
}
/** Codes d'intégration trouvés (24 h). */
const found = new Map<string, Found>();
/** Codes que Meta dit indisponibles : la fin de leur heure de mémoire. */
const missing = new Map<string, number>();
const pending = new Map<string, Promise<MetaAnswer>>();
/** Heures des demandes parties vers Meta (fenêtre glissante d'une heure). */
let calls: number[] = [];
let silentUntil = 0;

/** Tests seulement : oublie le cache, le compteur et le silence. */
export function resetInstagramEmbed(): void {
  found.clear();
  missing.clear();
  pending.clear();
  calls = [];
  silentUntil = 0;
}

/** Demandes parties vers Meta depuis une heure. */
export function instagramEmbedCalls(now: number = Date.now()): number {
  calls = calls.filter((at) => now - at < HOUR_MS);
  return calls.length;
}

/** Le pseudo, seulement s'il est écrit dans le code d'intégration : la
 * DERNIÈRE occurrence « (@pseudo) », celle de « A post shared by … » que Meta
 * écrit à la fin (le nom affiché ou la légende, choisis par le créateur,
 * viennent avant). */
export function handleInEmbed(html: string): string | null {
  let last: string | null = null;
  for (const match of html.matchAll(/\(@([A-Za-z0-9._]{1,30})\)/g)) last = match[1]!;
  return last ? last.toLowerCase() : null;
}

async function askMeta(link: VideoLink): Promise<MetaAnswer> {
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
  // Seul ce que Meta a écrit est gardé : jamais le pseudo du lien demandé.
  return { ok: true, html, metaHandle: handleInEmbed(html) };
}

function remember(key: string, answer: MetaAnswer, now: number): void {
  if (answer.ok) {
    missing.delete(key);
    found.delete(key);
    found.set(key, { html: answer.html, metaHandle: answer.metaHandle, expiresAt: now + FOUND_TTL_MS });
    while (found.size > INSTAGRAM_EMBED_CACHE_SIZE) found.delete(found.keys().next().value!);
  } else if (answer.issue === "unavailable") {
    missing.delete(key);
    missing.set(key, now + UNAVAILABLE_TTL_MS);
    while (missing.size > INSTAGRAM_EMBED_MISSING_CACHE_SIZE) missing.delete(missing.keys().next().value!);
  }
}

/** La réponse pour CE demandeur : le pseudo écrit par Meta, sinon celui de
 * son propre lien (jamais celui du lien d'un autre membre). */
function servedTo(link: VideoLink, answer: { html: string; metaHandle: string | null }): InstagramEmbed {
  return { ok: true, html: answer.html, creatorHandle: answer.metaHandle ?? link.creatorHandle ?? null };
}

/** Le code d'intégration officiel d'une publication Instagram : servi par la
 * mémoire pendant 24 h, sinon demandé à Meta dans la limite horaire.
 * `beforeFetch` est appelée juste avant une demande qui part vraiment vers
 * Meta (jamais pour une réponse gardée en mémoire) : elle peut la refuser
 * (limite par membre) ; la réponse est alors « rate_limited ». */
export async function instagramEmbed(link: VideoLink, now: () => number = Date.now, options: { beforeFetch?: () => boolean } = {}): Promise<InstagramEmbed> {
  if (link.platform !== "instagram") return { ok: false, issue: "unavailable" };
  const at = now();
  const known = found.get(link.videoKey);
  if (known && known.expiresAt > at) return servedTo(link, known);
  const goneUntil = missing.get(link.videoKey);
  if (goneUntil !== undefined && goneUntil > at) return { ok: false, issue: "unavailable" };

  let running = pending.get(link.videoKey);
  if (!running) {
    if (at < silentUntil || instagramEmbedCalls(at) >= INSTAGRAM_EMBED_HOURLY_BUDGET) return { ok: false, issue: "limit" };
    if (options.beforeFetch && !options.beforeFetch()) return { ok: false, issue: "rate_limited" };
    calls.push(at);
    running = askMeta(link)
      .then((answer) => {
        if (!answer.ok && answer.issue === "limit") silentUntil = now() + INSTAGRAM_EMBED_COOLDOWN_MS;
        remember(link.videoKey, answer, now());
        return answer;
      })
      .finally(() => pending.delete(link.videoKey));
    pending.set(link.videoKey, running);
  }
  const answer = await running;
  return answer.ok ? servedTo(link, answer) : answer;
}
