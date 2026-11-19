import { PINNED_POSTS_MAX, type Post, type UserPostsPage } from "@monapp/shared-types";
import { t } from "../i18n";

// Publications épinglées (lot « vie sociale », migration 0049), côté app : la
// logique sans écran, testée à part (tests/epingles-lien.test.ts). Un serveur
// ou une base sans 0049 ne donne ni `pinnedAt` ni `pinned` : l'app cache alors
// l'entrée « Épingler sur mon profil » et garde l'ordre des publications.

/** L'entrée « Épingler sur mon profil » : sur ses propres photos seulement
 * (« Une photo » : la grille du profil ne montre qu'elles), et seulement si
 * le serveur dit où en est l'épingle. */
export function pinEntryShown(post: Pick<Post, "type" | "pinnedAt">, isMine: boolean): boolean {
  return isMine && post.type === "lifestyle" && post.pinnedAt !== undefined;
}

/** Épingler, ou retirer l'épingle. */
export function pinActionOf(post: Pick<Post, "pinnedAt">): "pin" | "unpin" {
  return typeof post.pinnedAt === "string" ? "unpin" : "pin";
}

/** Sa propre grille (GET /api/posts/mine) : les épinglées d'abord, la plus
 * récemment épinglée en tête (3 au plus, comme le serveur les lit), puis les
 * autres dans leur ordre. Rend aussi les identifiants des épinglées (la marque). */
export function pinnedFirst(posts: readonly Post[]): { posts: Post[]; pinnedIds: Set<string> } {
  const pinned = posts
    .filter((post) => typeof post.pinnedAt === "string")
    .sort((a, b) => (a.pinnedAt! < b.pinnedAt! ? 1 : a.pinnedAt! > b.pinnedAt! ? -1 : 0))
    .slice(0, PINNED_POSTS_MAX);
  const pinnedIds = new Set(pinned.map((post) => post.id));
  return { posts: [...pinned, ...posts.filter((post) => !pinnedIds.has(post.id))], pinnedIds };
}

/** Le profil d'un autre membre : ses épinglées (première page, `pinned`)
 * d'abord, puis ses publications sans doublon (une épinglée reste aussi à sa
 * place dans la liste du serveur, pour les anciennes apps). */
export function profileGrid(page: Pick<UserPostsPage, "posts" | "pinned">): { posts: Post[]; pinnedIds: Set<string> } {
  const pinned = (page.pinned ?? []).slice(0, PINNED_POSTS_MAX);
  const pinnedIds = new Set(pinned.map((post) => post.id));
  return { posts: [...pinned, ...page.posts.filter((post) => !pinnedIds.has(post.id))], pinnedIds };
}

/** Une page suivante ajoutée à la grille, sans doublon (une épinglée revient à sa place chronologique). */
export function appendGridPage(shown: readonly Post[], next: readonly Post[]): Post[] {
  const seen = new Set(shown.map((post) => post.id));
  return [...shown, ...next.filter((post) => !seen.has(post.id))];
}

/** Ce que VoiceOver lit pour une case de la grille d'un profil : sa légende
 * (ou son repli), suivie de « Épinglée » pour une épinglée. La case est un
 * seul élément touchable : une marque posée dedans n'est jamais lue à part
 * (iPhone : les enfants d'un élément accessible sont ignorés ; site : le nom
 * d'un bouton est son aria-label). Lu dans la langue active à l'appel. */
export function gridCellLabel(label: string, pinned: boolean): string {
  return pinned ? `${label}, ${t.profilePins.pinnedMark}` : label;
}
