import type { ForYouPage, Post, Profile } from "@monapp/shared-types";
import { ApiError } from "./api-error";

// Fil « Pour vous » et suggestions de comptes (lot « découverte »), côté app :
// le choix « Abonnements | Pour vous » gardé pour la session, les pages mises
// bout à bout sans doublon, la suite demandée quand une page revient vide, et
// ce qui cache « Pour vous » face à un serveur d'avant ce lot. Fonctions
// pures, sans écran. Imports relatifs : fichier testé par vitest.

export const FEED_SEGMENTS = ["following", "forYou"] as const;
export type FeedSegment = (typeof FEED_SEGMENTS)[number];

// Gardés en mémoire pour la session (jamais enregistrés sur le téléphone) :
// le fil choisi, et « le serveur ne connaît pas Pour vous ».
let chosen: FeedSegment = "following";
let available = true;

/** Le fil à montrer en ouvrant l'écran : le dernier choisi pendant la session. */
export function rememberedSegment(): FeedSegment {
  return available ? chosen : "following";
}

export function rememberSegment(segment: FeedSegment): void {
  chosen = segment;
}

/** « Pour vous » est-il proposé ? Non, une fois qu'un serveur d'avant ce lot a répondu 404. */
export function forYouShown(): boolean {
  return available;
}

/** Une route qui n'existe pas encore sur ce serveur (404) : un serveur d'avant ce lot. */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Après un échec de « Pour vous » : vrai si le serveur ne le connaît pas
 * (404), et « Pour vous » est alors caché pour la session ; faux pour toute
 * autre erreur (l'écran montre « Réessayer »). */
export function noteForYouFailure(error: unknown): boolean {
  if (!isMissingRoute(error)) return false;
  available = false;
  chosen = "following";
  return true;
}

/** Tests seulement : oublie la session. */
export function resetForYouSession(): void {
  chosen = "following";
  available = true;
}

/** Une page de plus, au bout de la liste, sans doublon : le classement a pu
 * être refait entre deux pages, et une publication déjà montrée revenir. */
export function appendUnique(previous: readonly Post[], page: readonly Post[]): Post[] {
  const seen = new Set(previous.map((post) => post.id));
  const added: Post[] = [];
  for (const post of page) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    added.push(post);
  }
  return [...previous, ...added];
}

/** La page à `offset`, et les suivantes tant qu'elles reviennent vides alors
 * qu'il en reste (une publication devenue invisible depuis le classement est
 * retirée par le serveur) : quatre pages au plus, la liste en compte 60. */
export async function fetchUntilShown(fetchPage: (offset: number) => Promise<ForYouPage>, offset = 0): Promise<ForYouPage> {
  let page = await fetchPage(offset);
  for (let tries = 1; page.posts.length === 0 && page.nextOffset !== null && tries < 4; tries += 1) page = await fetchPage(page.nextOffset);
  return page;
}

/** Le réglage « Proposer mon compte aux autres membres » : seulement quand le serveur en parle (migration 0050). */
export function discoverableSettingShown(profile: Pick<Profile, "discoverable"> | null | undefined): boolean {
  return typeof profile?.discoverable === "boolean";
}
