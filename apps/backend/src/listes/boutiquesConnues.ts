// BOUTIQUES CONNUES — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : dans les résultats, les offres de ces boutiques portent
// la mention discrète « Boutique connue », partout. Elles remontent un peu
// (2 places au plus) seulement dans « Cette pièce dans d'autres boutiques »
// (la même pièce, vendue dans plusieurs boutiques) ; ailleurs, elles gardent
// leur place (décision du fondateur, 21 novembre 2026). Les sites officiels
// des marques sont dans une autre liste : src/listes/boutiquesOfficielles.ts.
// Les boutiques de cette liste ne sont jamais signalées « Prix
// inhabituellement bas » : un prix bas chez elles est une vraie promotion, ou
// une pièce voisine moins chère. Cette liste ne limite pas les résultats :
// les boutiques qui n'y sont pas sont proposées comme les autres. La règle
// est dans src/lib/shopTrust.ts.
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

  // Sport (grandes enseignes)
  "decathlon.fr",
  "jdsports.fr",
  "courir.com",
  "footlocker.fr",
  "intersport.fr",
];
