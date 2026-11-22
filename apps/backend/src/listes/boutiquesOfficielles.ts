// BOUTIQUES OFFICIELLES DES MARQUES — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : le site officiel d'une marque (nike.com, sezane.com,
// dior.com…) porte la mention « Boutique officielle de la marque », partout
// dans les résultats. Il passe en tête, avant les revendeurs, seulement dans
// « Cette pièce dans d'autres boutiques » (la même pièce, vendue dans
// plusieurs boutiques), et seulement quand le serveur l'a reconnu comme la
// boutique de la marque de la pièce (migration 0054 ; sans elle, aucune ne
// l'est). Reconnu veut dire : le nom de la marque de la pièce, en entier,
// est exactement l'adresse sans extension ni tiret (« zara.com » pour Zara,
// « hm.com » pour H&M, « thenorthface.fr » pour The North Face), ou
// exactement un des autres noms écrits après « aussi » (voir plus bas).
// Un mot à l'intérieur d'un nom plus long ne suffit jamais : « Sandro
// Ferrone » n'est pas sandro-paris.com, ni « Tommy Bahama » tommy.com.
// Une boutique officielle non reconnue (une autre marque, une marque
// écrite autrement, ou sans 0054) y garde sa place. Ailleurs
// (recherche visuelle, « Résultats pour vos mots »), il garde sa place :
// aucune marque n'est mise en avant (décision du fondateur, 21 novembre
// 2026). Comme les boutiques connues, les sites de cette liste ne sont
// jamais signalés « Prix inhabituellement bas ». Cette liste ne limite pas
// les résultats : les boutiques et les marques qui n'y sont pas sont
// proposées comme les autres. La règle est dans src/lib/shopTrust.ts.
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
// 6. Autres noms de la marque (facultatif), quand l'adresse ne l'écrit pas
//    (« ysl.com » pour Saint Laurent) : la ligne s'écrit alors
//      { adresse: "ysl.com", aussi: ["Saint Laurent", "YSL"] },
//    Chaque nom est le nom ENTIER de la marque, sans ambiguïté : il doit
//    être exactement celui de la pièce (majuscules, accents, espaces et
//    signes comme « & » ou « ' » ne comptent pas). Jamais un mot courant
//    (« Polo », « Jeans », « Paris ») ni le nom d'une autre marque : en cas
//    de doute, ne rien ajouter (la boutique garde alors sa place).
// Les tests (pnpm run test:hors-base, dans apps/backend) vérifient
// l'écriture de chaque adresse, qu'aucune n'est aussi dans l'autre liste,
// et qu'un autre nom ne désigne jamais la boutique d'une autre marque.

/** Une adresse et les autres noms exacts de sa marque (règle 6). */
interface BoutiqueAvecAutresNoms {
  adresse: string;
  aussi: readonly string[];
}

const LISTE: readonly (string | BoutiqueAvecAutresNoms)[] = [
  // Mode
  "zara.com",
  { adresse: "hm.com", aussi: ["H&M"] },
  "mango.com",
  "uniqlo.com",
  "cos.com",
  "arket.com",
  { adresse: "stories.com", aussi: ["& Other Stories", "Other Stories"] },
  "massimodutti.com",
  "bershka.com",
  { adresse: "pullandbear.com", aussi: ["Pull&Bear", "Pull and Bear"] },
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
  { adresse: "sandro-paris.com", aussi: ["Sandro"] },
  "claudiepierlot.com",
  "isabelmarant.com",
  "jacquemus.com",
  "rouje.com",
  "petit-bateau.fr",
  "lacoste.com",
  { adresse: "levi.com", aussi: ["Levi's", "Levis"] },
  { adresse: "ralphlauren.fr", aussi: ["Ralph Lauren", "Polo Ralph Lauren", "Lauren Ralph Lauren"] },
  { adresse: "tommy.com", aussi: ["Tommy Hilfiger", "Tommy Jeans"] },
  { adresse: "calvinklein.fr", aussi: ["Calvin Klein Jeans"] },

  // Sport
  "nike.com",
  { adresse: "adidas.fr", aussi: ["adidas Originals"] },
  { adresse: "adidas.com", aussi: ["adidas Originals"] },
  "puma.com",
  "newbalance.fr",
  "converse.com",
  "vans.fr",
  "asics.com",
  "salomon.com",
  { adresse: "thenorthface.fr", aussi: ["The North Face", "North Face"] },
  { adresse: "thenorthface.com", aussi: ["The North Face", "North Face"] },
  "patagonia.com",

  // Maisons de luxe
  { adresse: "dior.com", aussi: ["Dior", "Christian Dior"] },
  "chanel.com",
  "louisvuitton.com",
  "hermes.com",
  "gucci.com",
  "prada.com",
  "balenciaga.com",
  { adresse: "ysl.com", aussi: ["Saint Laurent", "Yves Saint Laurent", "YSL"] },
  "celine.com",
  "burberry.com",
  "versace.com",
  "moncler.com",
  "stoneisland.com",
  "canadagoose.com",
];

/** Les adresses de la liste (sans les autres noms). */
export const BOUTIQUES_OFFICIELLES: readonly string[] = LISTE.map((entree) => (typeof entree === "string" ? entree : entree.adresse));

/** Les autres noms exacts de la marque de chaque adresse qui en a (« aussi »). */
export const AUTRES_NOMS_DES_MARQUES: ReadonlyMap<string, readonly string[]> = new Map(
  LISTE.flatMap((entree) => (typeof entree === "string" ? [] : [[entree.adresse, entree.aussi] as const]))
);
