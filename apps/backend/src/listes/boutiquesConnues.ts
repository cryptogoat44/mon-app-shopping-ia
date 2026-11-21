// BOUTIQUES CONNUES — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : dans les résultats, les offres de ces boutiques portent
// la mention discrète « Boutique connue » et remontent un peu (2 places au
// plus dans leur section). Elles ne sont jamais signalées « Prix
// inhabituellement bas » : un prix bas chez elles est une vraie promotion, ou
// une pièce voisine moins chère. La règle est dans src/lib/shopTrust.ts.
//
// Comment ajouter ou retirer une boutique :
// 1. Une boutique par ligne : son adresse, sans « https:// » ni « www. »,
//    en minuscules, entre guillemets droits, suivie d'une virgule.
//    Exemple :   "zalando.fr",
// 2. Les sous-domaines sont compris : "hm.com" vaut aussi pour www2.hm.com.
// 3. Chaque pays est une adresse à part : "zalando.fr" ne vaut pas pour
//    "zalando.de". Une adresse qui imite une boutique (« zalando-outlet.shop »)
//    n'est donc jamais comprise.
// 4. Une ligne qui commence par // est une note : elle ne compte pas.
// 5. N'ajoutez que des boutiques sûres : la mention rassure les membres.
// Les tests (pnpm run test:hors-base, dans apps/backend) vérifient
// l'écriture de chaque adresse.
export const BOUTIQUES_CONNUES: readonly string[] = [
  // Grands magasins et plateformes de mode
  "zalando.fr",
  "zalando.be",
  "zalando.ch",
  "zalando.de",
  "zalando.it",
  "zalando.es",
  "zalando.nl",
  "zalando.at",
  "zalando.co.uk",
  "asos.com",
  "aboutyou.fr",
  "aboutyou.de",
  "galerieslafayette.com",
  "printemps.com",
  "laredoute.fr",
  "24s.com",
  "elcorteingles.es",
  "selfridges.com",
  "harrods.com",
  "veepee.fr",
  "showroomprive.com",
  "bonprix.fr",
  "sarenza.com",
  "spartoo.com",

  // Grandes places de marché et revente (avec paiement et protection des acheteurs)
  "amazon.fr",
  "amazon.com.be",
  "amazon.de",
  "amazon.it",
  "amazon.es",
  "amazon.nl",
  "amazon.co.uk",
  "vinted.fr",
  "vinted.be",
  "vinted.de",
  "vinted.it",
  "vinted.es",
  "vinted.nl",
  "vestiairecollective.com",
  "stockx.com",

  // Boutiques de luxe en ligne
  "farfetch.com",
  "mytheresa.com",
  "net-a-porter.com",
  "mrporter.com",
  "theoutnet.com",
  "yoox.com",
  "ssense.com",
  "luisaviaroma.com",
  "brownsfashion.com",

  // Enseignes de mode (sites officiels)
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

  // Sport (sites officiels et grandes enseignes)
  "nike.com",
  "adidas.fr",
  "adidas.com",
  "decathlon.fr",
  "puma.com",
  "newbalance.fr",
  "converse.com",
  "vans.fr",
  "asics.com",
  "salomon.com",
  "thenorthface.fr",
  "thenorthface.com",
  "patagonia.com",
  "jdsports.fr",
  "courir.com",
  "footlocker.fr",
  "intersport.fr",

  // Maisons de luxe (sites officiels)
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
