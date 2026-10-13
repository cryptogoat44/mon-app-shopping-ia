import type { Post } from "@monapp/shared-types";

// Image d'une publication : photo de la personne, ou image d'une pièce
// (décision du fondateur, lot 5 : « image entière, cadre 4:5 »). L'image
// d'une pièce s'affiche entière, jamais rognée, dans le même cadre que
// l'écran d'une envie (components/product-frame.tsx) ; une photo envoyée par
// la personne garde le carré pleine largeur.
// - Envie republiée : toujours l'image d'une pièce (la copie, dans notre
//   stockage, de l'image du marchand).
// - « Achat » : l'image de l'objet du Vault. Une photo de la personne (ajout
//   à la main, « Changer la photo ») est rangée dans NOTRE stockage
//   (vault-media ou post-media) ; l'image d'un résultat du Spotter (marchand
//   ou Google) ne l'est jamais. Une image HD fournie (mediaHdUrl) vient
//   toujours du Spotter.
// - Publication photo : toujours une photo de la personne.

// Fichier public de notre stockage (Supabase Storage), dans un dossier de
// photos envoyées : le chemin suit immédiatement le nom d'hôte (jamais une
// simple mention dans les paramètres d'une adresse de marchand).
const OWN_PHOTO_URL = /^https?:\/\/[^/?#]+\/storage\/v1\/object\/public\/(?:post-media|vault-media)\//;

/** true pour une photo envoyée par une personne et rangée dans notre stockage. */
export function isOwnStoredPhoto(url: string): boolean {
  return OWN_PHOTO_URL.test(url);
}

/** true quand la publication montre l'image d'une pièce (cadre 4:5, image
 * entière), false pour une photo de la personne (carré pleine largeur). */
export function showsProductPicture(post: Pick<Post, "type" | "mediaUrl" | "mediaHdUrl">): boolean {
  if (post.type === "wish") return true;
  if (post.type !== "purchase") return false;
  return post.mediaHdUrl !== null || !isOwnStoredPhoto(post.mediaUrl);
}
