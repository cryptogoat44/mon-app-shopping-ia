import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { Post } from "@monapp/shared-types";
import { PUBLIC_WEB_URL } from "../constants/brand";
import { track } from "./analytics";
import { t } from "../i18n";

// Lien vers une publication (Lot F). La confidentialité est respectée à
// l'ouverture : le serveur ne renvoie la publication qu'aux personnes qui
// ont le droit de la voir (sinon « n'est pas disponible »).
export function postLink(postId: string): string {
  const base = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : PUBLIC_WEB_URL;
  return `${base}/publication?id=${encodeURIComponent(postId)}`;
}

export function postShareMessage(post: Pick<Post, "id" | "caption" | "author">): string {
  return `${t.post.shareMessage(post.author.displayName, post.caption)}\n${postLink(post.id)}`;
}

/** Partage du système ; sur un navigateur sans partage, copie le lien.
 * Renvoie "copied" quand le lien a été copié (pour prévenir l'utilisateur). */
export async function sharePost(post: Pick<Post, "id" | "caption" | "author">): Promise<"shared" | "copied" | "cancelled"> {
  const message = postShareMessage(post);
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: message, url: postLink(post.id) });
        track("post_shared", { method: "native" });
        return "shared";
      }
      await Clipboard.setStringAsync(postLink(post.id));
      track("post_shared", { method: "copy" });
      return "copied";
    }
    // iPhone : fermer la feuille de partage sans choisir d'app n'est pas un
    // partage (lot 3bis) — rien n'est compté.
    const { action } = await Share.share({ message });
    if (action !== Share.sharedAction) return "cancelled";
    track("post_shared", { method: "native" });
    return "shared";
  } catch {
    return "cancelled";
  }
}
