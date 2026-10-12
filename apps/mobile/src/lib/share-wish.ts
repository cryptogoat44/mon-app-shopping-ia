import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { WishlistItem } from "@monapp/shared-types";
import { track } from "./analytics";
import { t } from "../i18n";

// Partager une envie hors de Spotto (lot 5, 5.C) : un geste volontaire, par
// la feuille de partage du téléphone. Les envies sont privées : aucune page
// publique n'est créée, on partage le lien du marchand. Quand c'est un lien
// affilié, la mention « lien affilié » voyage avec lui (obligation de
// transparence), y compris quand le lien est seulement copié.

type ShareableWish = Pick<WishlistItem, "title" | "merchantName" | "merchantUrl" | "affiliateUrl">;

/** Le lien partagé : affilié s'il existe, sinon celui du marchand ; null sans marchand. */
export function wishShareLink(item: ShareableWish): string | null {
  return item.affiliateUrl ?? item.merchantUrl;
}

/** true quand le lien partagé est un lien affilié (mention obligatoire). */
export function wishShareIsAffiliate(item: ShareableWish): boolean {
  return item.affiliateUrl !== null && item.affiliateUrl !== item.merchantUrl;
}

/** Le texte partagé : la pièce, le marchand, le lien et, s'il y a lieu, la mention. */
export function wishShareMessage(item: ShareableWish): string | null {
  const link = wishShareLink(item);
  if (!link) return null;
  const mention = wishShareIsAffiliate(item) ? ` ${t.wishlistItem.affiliateMention}` : "";
  return `${t.wishlistItem.shareMessage(item.title, item.merchantName)}\n${link}${mention}`;
}

/** Feuille de partage du système ; sur un navigateur sans partage, copie le
 * texte (mention comprise). "copied" : prévenir l'utilisateur. */
export async function shareWishOutside(item: ShareableWish): Promise<"shared" | "copied" | "cancelled"> {
  const message = wishShareMessage(item);
  if (!message) return "cancelled";
  const affiliate = wishShareIsAffiliate(item);
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ text: message });
        track("wish_shared_external", { method: "native", affiliate });
        return "shared";
      }
      await Clipboard.setStringAsync(message);
      track("wish_shared_external", { method: "copy", affiliate });
      return "copied";
    }
    // Fermer la feuille de partage sans choisir d'app n'est pas un partage.
    const { action } = await Share.share({ message });
    if (action !== Share.sharedAction) return "cancelled";
    track("wish_shared_external", { method: "native", affiliate });
    return "shared";
  } catch {
    return "cancelled";
  }
}
