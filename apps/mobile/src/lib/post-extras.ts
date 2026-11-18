// Plusieurs photos par publication, identifier des personnes (lot « vie
// sociale », migration 0047) : la logique sans écran, testée à part
// (tests/photos-identifications.test.ts). Sans elles sur le serveur
// (migration absente, ancien serveur, réponse illisible), l'app garde le
// choix d'une seule photo et cache « Identifier des personnes » ; une
// publication reçue sans `media` ni `people` se montre comme avant.
import type { Post, PostAuthor, PostExtrasStatus, PostPhoto } from "@monapp/shared-types";

export const POST_EXTRAS_UNAVAILABLE: PostExtrasStatus = { carousel: false, peopleTags: false };

/** Réponse de GET /api/posts/status : seul `true` montre la nouveauté. */
export function readPostExtrasStatus(body: unknown): PostExtrasStatus {
  if (typeof body !== "object" || body === null) return POST_EXTRAS_UNAVAILABLE;
  const fields = body as Record<string, unknown>;
  return { carousel: fields.carousel === true, peopleTags: fields.peopleTags === true };
}

/** Les photos d'une publication, la première comprise : `media` quand le
 * serveur en donne au moins deux, sinon la seule photo (rien quand l'image a
 * été retirée par la modération). */
export function photosOf(post: Pick<Post, "media" | "mediaUrl" | "mediaThumbUrl">): PostPhoto[] {
  const media = Array.isArray(post.media) ? post.media.filter((photo) => typeof photo?.url === "string" && photo.url !== "") : [];
  if (media.length >= 2) return media.map((photo) => ({ url: photo.url, thumbUrl: typeof photo.thumbUrl === "string" && photo.thumbUrl !== "" ? photo.thumbUrl : photo.url }));
  return post.mediaUrl === null ? [] : [{ url: post.mediaUrl, thumbUrl: post.mediaThumbUrl ?? post.mediaUrl }];
}

/** La petite marque « plusieurs photos » d'une grille. */
export function hasSeveralPhotos(post: Pick<Post, "media" | "mediaUrl" | "mediaThumbUrl">): boolean {
  return photosOf(post).length > 1;
}

/** Les personnes identifiées que le serveur montre à ce lecteur. */
export function peopleOf(post: Pick<Post, "people">): PostAuthor[] {
  return Array.isArray(post.people) ? post.people.filter((person) => typeof person?.id === "string") : [];
}

/** La publication sans cette personne (après « Retirer mon identification »). */
export function withoutPerson<T extends Pick<Post, "people">>(post: T, userId: string): T {
  const people = peopleOf(post).filter((person) => person.id !== userId);
  const { people: _removed, ...rest } = post;
  return (people.length > 0 ? { ...rest, people } : rest) as T;
}

// ---- Disponibilité, partagée entre les écrans ----

let current: PostExtrasStatus = POST_EXTRAS_UNAVAILABLE;
const listeners = new Set<(status: PostExtrasStatus) => void>();

export function postExtrasStatus(): PostExtrasStatus {
  return current;
}

/** Nouvel état lu sur le serveur : les écrans abonnés sont prévenus s'il change. */
export function setPostExtrasStatus(next: PostExtrasStatus): void {
  if (next.carousel === current.carousel && next.peopleTags === current.peopleTags) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function onPostExtrasStatus(listener: (status: PostExtrasStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
