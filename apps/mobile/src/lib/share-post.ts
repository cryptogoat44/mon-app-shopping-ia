import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Post } from "@monapp/shared-types";
import { PUBLIC_WEB_URL } from "../constants/brand";

// Lien vers une publication (Lot F). La confidentialité est respectée à
// l'ouverture : le serveur ne renvoie la publication qu'aux personnes qui
// ont le droit de la voir (sinon « n'est pas disponible »).
export function postLink(postId: string): string {
  const base = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : PUBLIC_WEB_URL;
  return `${base}/publication?id=${encodeURIComponent(postId)}`;
}

export function postShareMessage(post: Pick<Post, "id" | "caption" | "author">): string {
  const caption = post.caption ? ` : « ${post.caption} »` : "";
  return `${post.author.displayName} sur Spotto${caption}\n${postLink(post.id)}`;
}

/** Partage du système ; sur un navigateur sans partage, copie le lien.
 * Renvoie "copied" quand le lien a été copié (pour prévenir l'utilisateur). */
export async function sharePost(post: Pick<Post, "id" | "caption" | "author">): Promise<"shared" | "copied" | "cancelled"> {
  const message = postShareMessage(post);
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: message, url: postLink(post.id) });
        return "shared";
      }
      await Clipboard.setStringAsync(postLink(post.id));
      return "copied";
    }
    await Share.share({ message });
    return "shared";
  } catch {
    return "cancelled";
  }
}
