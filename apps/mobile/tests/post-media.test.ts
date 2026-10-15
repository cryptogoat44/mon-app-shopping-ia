import { describe, expect, it } from "vitest";
import type { Post } from "@monapp/shared-types";
import { isOwnStoredPhoto, showsProductPicture } from "../src/lib/post-media";

// Lot 5 (décision du fondateur : « image entière, cadre 4:5 ») : l'image
// d'une pièce s'affiche entière dans le cadre de l'écran d'une envie ; une
// photo de la personne garde le carré pleine largeur.
const STORAGE = "https://spotto-dev.supabase.co/storage/v1/object/public";
const GOOGLE = "https://encrypted-tbn2.gstatic.com/images?q=tbn:ANd9GcR";
const MERCHANT_HD = "https://images.asos-media.com/products/bottes/204489237-4";

const post = (type: Post["type"], mediaUrl: string | null, mediaHdUrl: string | null = null) => ({ type, mediaUrl, mediaHdUrl });

describe("image d'une publication : pièce ou photo de la personne", () => {
  it("envie republiée : toujours l'image d'une pièce (notre copie, dans notre stockage)", () => {
    expect(showsProductPicture(post("wish", `${STORAGE}/post-media/u1/copie.jpg`))).toBe(true);
  });

  it("« achat » qui montre encore l'image du Spotter (marchand ou Google) : image d'une pièce", () => {
    expect(showsProductPicture(post("purchase", GOOGLE, MERCHANT_HD))).toBe(true);
    // Résultat ancien, sans image HD : la vignette de Google reste l'image d'une pièce.
    expect(showsProductPicture(post("purchase", GOOGLE))).toBe(true);
    expect(showsProductPicture(post("purchase", MERCHANT_HD))).toBe(true);
  });

  it("« achat » dont la personne a changé la photo, ou ajouté à la main : sa photo, en carré", () => {
    expect(showsProductPicture(post("purchase", `${STORAGE}/vault-media/u1/photo.jpg`))).toBe(false);
    expect(showsProductPicture(post("purchase", `${STORAGE}/post-media/u1/photo.jpg`))).toBe(false);
  });

  it("publication photo : toujours la photo de la personne, en carré", () => {
    expect(showsProductPicture(post("lifestyle", `${STORAGE}/post-media/u1/photo.jpg`))).toBe(false);
    expect(showsProductPicture(post("lifestyle", GOOGLE))).toBe(false);
  });

  it("image retirée par la modération (lot 5, partie B) : une envie garde le cadre d'une pièce, sans planter", () => {
    expect(showsProductPicture(post("wish", null))).toBe(true);
    expect(showsProductPicture(post("purchase", null))).toBe(false);
    expect(showsProductPicture(post("lifestyle", null))).toBe(false);
  });

  it("notre stockage se reconnaît au chemin qui suit le nom d'hôte, jamais à une mention dans les paramètres", () => {
    expect(isOwnStoredPhoto(`${STORAGE}/vault-media/u1/photo.jpg`)).toBe(true);
    expect(isOwnStoredPhoto("http://127.0.0.1:54321/storage/v1/object/public/post-media/u1/photo.jpg")).toBe(true);
    expect(isOwnStoredPhoto(`${GOOGLE}&u=/storage/v1/object/public/vault-media/x.jpg`)).toBe(false);
    expect(isOwnStoredPhoto("https://cdn.marchand.test/a/storage/v1/object/public/post-media/x.jpg")).toBe(false);
    // Autre dossier de notre stockage (ex. avatars) : pas une photo de publication.
    expect(isOwnStoredPhoto(`${STORAGE}/avatars/u1/a.jpg`)).toBe(false);
  });
});
