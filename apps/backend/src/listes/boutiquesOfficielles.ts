// BOUTIQUES OFFICIELLES DES MARQUES — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : le site officiel d'une marque (nike.com, sezane.com,
// dior.com…) passe EN TÊTE de sa section dans les résultats, avant les
// revendeurs, avec la mention « Boutique officielle de la marque » (décision
// du fondateur, 21 novembre 2026 : privilégier les boutiques des marques
// elles-mêmes). Comme les boutiques connues, elles ne sont jamais signalées
// « Prix inhabituellement bas ». La règle est dans src/lib/shopTrust.ts.
// Les revendeurs (Zalando, Galeries Lafayette, Farfetch, Amazon, Vinted…)
// sont dans src/listes/boutiquesConnues.ts.
//
// Comment ajouter ou retirer une marque :
// 1. Une adresse par ligne : sans « https:// » ni « www. », en minuscules,
//    entre guillemets droits, suivie d'une virgule. Exemple :   "sezane.com",
// 2. Les sous-domaines sont compris : "hm.com" vaut aussi pour www2.hm.com.
// 3. Chaque pays est une adresse à part : "adidas.fr" ne vaut pas pour
//    "adidas.de". Une adresse qui imite une marque (« nike-outlet.shop »)
//    n'est donc jamais comprise.
// 4. Seulement le site de la marque elle-même, jamais un revendeur.
// 5. Une ligne qui commence par // est une note : elle ne compte pas.
// Les tests (pnpm run test:hors-base, dans apps/backend) vérifient
// l'écriture de chaque adresse, et qu'aucune n'est aussi dans l'autre liste.
export const BOUTIQUES_OFFICIELLES: readonly string[] = [
  // Mode
  "zara.com",
  "hm.com",
  "mango.com",
  "uniqlo.com",
  "cos.com",
  "arket.com",
  "stories.com",
  "massimodutti.com",
  "bershka.com",
  "pullandbear.com",
  "stradivarius.com",
  "oysho.com",
  "primark.com",
  "kiabi.com",
  "celio.com",
  "jules.com",
  "promod.fr",
  "etam.com",
  "sezane.com",
  "ba-sh.com",
  "maje.com",
  "sandro-paris.com",
  "claudiepierlot.com",
  "isabelmarant.com",
  "jacquemus.com",
  "rouje.com",
  "petit-bateau.fr",
  "lacoste.com",
  "levi.com",
  "ralphlauren.fr",
  "tommy.com",
  "calvinklein.fr",

  // Sport
  "nike.com",
  "adidas.fr",
  "adidas.com",
  "puma.com",
  "newbalance.fr",
  "converse.com",
  "vans.fr",
  "asics.com",
  "salomon.com",
  "thenorthface.fr",
  "thenorthface.com",
  "patagonia.com",

  // Maisons de luxe
  "dior.com",
  "chanel.com",
  "louisvuitton.com",
  "hermes.com",
  "gucci.com",
  "prada.com",
  "balenciaga.com",
  "ysl.com",
  "celine.com",
  "burberry.com",
  "versace.com",
  "moncler.com",
  "stoneisland.com",
  "canadagoose.com",
];
