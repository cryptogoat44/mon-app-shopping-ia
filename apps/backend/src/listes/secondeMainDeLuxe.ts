// SECONDE MAIN DE LUXE — liste que le fondateur peut modifier lui-même.
//
// À quoi elle sert : sous une pièce trouvée qui semble venir d'une maison de
// luxe, l'écran Résultat propose une entrée discrète, « Seconde main de
// luxe ». Elle ouvre une courte feuille avec un bouton par site de revente
// de cette liste ; chaque bouton ouvre, dans le navigateur du membre, la
// page de recherche publique du site, déjà remplie avec des mots tirés du
// titre d'une offre montrée. Le serveur n'appelle JAMAIS ces sites, et aucun
// prix d'occasion n'est jamais annoncé. La règle est dans
// src/lib/luxuryResale.ts.
//
// Ces sites sont un CHOIX de l'app (décisions du fondateur, novembre 2026 :
// « pas vinted ni leboncoin » ; « pour l'instant vestiaire collective seul,
// ensuite au cas par cas, une sorte d'agrément »). Ils sont montrés par
// ordre alphabétique de leur nom, jamais selon une préférence. Ajouter un
// site agréé = ajouter une ligne. Liste vide = l'entrée n'apparaît plus.
//
// Comment ajouter ou retirer un site de revente :
// 1. Un site par ligne : son nom tel qu'il s'affiche, et l'adresse de sa
//    page de recherche publique, en https, avec {mots} (une seule fois) à
//    l'endroit des mots de la recherche.
//    Exemple :   { nom: "Exemple Revente", recherche: "https://www.exemple.com/recherche?q={mots}" },
// 2. 5 sites au plus, de noms différents. Jamais une place de marché
//    généraliste (Vinted, Leboncoin) ni un site masqué.
// 3. Avant de mettre un site en ligne, ouvrez son adresse une fois dans votre
//    navigateur, avec par exemple « Dior Saddle » à la place de {mots} :
//    la page de recherche du site doit s'ouvrir, bien remplie. Une adresse
//    qui ne marche pas est retirée de la liste, jamais « réparée » par un
//    appel du serveur.
// 4. Une ligne qui commence par // est une note : elle ne compte pas.
// 5. Si un jour un lien de cette liste devient affilié, la phrase « leave »
//    de la feuille devient fausse : la changer, ajouter la mention « Lien
//    affilié » (apps/mobile/src/components/affiliate-mention.tsx) et la
//    phrase des conditions d'utilisation.
//
// Comment ajouter ou retirer une maison (seconde liste, plus bas) :
// - Adresses : comme dans boutiquesOfficielles.ts (sans « https:// » ni
//   « www. », en minuscules ; les sous-domaines sont compris ; chaque pays
//   est une adresse à part). Jamais l'adresse d'un revendeur.
// - Noms : le nom ENTIER de la maison (« nom », et ses autres noms exacts
//   dans « aussi »), cherché en mots entiers et consécutifs dans les titres
//   des boutiques connues : majuscules, accents et signes ne comptent pas,
//   un mot plus long ou un pluriel ne compte pas. Jamais un mot courant.
// - « sauf » (facultatif) : les noms d'AUTRES marques qui contiennent le nom
//   de la maison (« See by Chloé » pour Chloé) ; un titre qui en nomme une
//   ne compte jamais pour la maison.
// - « siteRequis: true » (facultatif) : pour une maison dont le nom est aussi
//   un prénom ou le nom d'une autre ligne (Valentino, Celine, Chloé), des
//   titres de boutiques seuls ne suffisent pas : il faut au moins une offre
//   de son site officiel.
// - Ces maisons servent seulement à cette entrée : aucune mention
//   « Boutique officielle », aucun effet sur l'ordre des résultats.
//
// Les tests (pnpm run test:hors-base, dans apps/backend :
// tests/secondeMainDeLuxe.test.ts) vérifient l'écriture de chaque adresse de
// recherche (https, un seul {mots}), le nombre de sites, l'absence de Vinted,
// de Leboncoin et des sites masqués, et l'écriture des maisons.

/** Un site de revente : son nom affiché, l'adresse de sa recherche publique. */
export interface SiteDeRevente {
  nom: string;
  recherche: string;
}

export const SITES_DE_REVENTE: readonly SiteDeRevente[] = [
  // À VÉRIFIER PAR LE FONDATEUR avant la mise en ligne : ouvrir une fois
  // cette adresse dans votre navigateur, avec « Dior Saddle » à la place de
  // {mots} (https://fr.vestiairecollective.com/search/?q=Dior%20Saddle), et
  // vérifier que la recherche de Vestiaire Collective s'ouvre bien remplie.
  // Adresse relevée chez un outil tiers (version « us. »), pas encore
  // essayée dans un navigateur. Si elle ne marche pas, retirer la ligne.
  { nom: "Vestiaire Collective", recherche: "https://fr.vestiairecollective.com/search/?q={mots}" },
];

/** Une maison de luxe : son nom affiché, ses sites officiels, ses autres
 * noms exacts, et les noms d'autres marques qui contiennent le sien. */
export interface MaisonDeLuxe {
  nom: string;
  adresses: readonly string[];
  aussi?: readonly string[];
  sauf?: readonly string[];
  /** Au moins une offre de son site officiel est nécessaire (voir plus haut). */
  siteRequis?: boolean;
}

export const MAISONS_DE_LUXE: readonly MaisonDeLuxe[] = [
  // Les 14 « Maisons de luxe » de boutiquesOfficielles.ts (mêmes adresses, mêmes autres noms).
  { nom: "Dior", adresses: ["dior.com"], aussi: ["Christian Dior"] },
  { nom: "Chanel", adresses: ["chanel.com"] },
  { nom: "Louis Vuitton", adresses: ["louisvuitton.com"] },
  { nom: "Hermès", adresses: ["hermes.com"] },
  { nom: "Gucci", adresses: ["gucci.com"] },
  { nom: "Prada", adresses: ["prada.com"] },
  { nom: "Balenciaga", adresses: ["balenciaga.com"] },
  { nom: "Saint Laurent", adresses: ["ysl.com"], aussi: ["Yves Saint Laurent", "YSL"] },
  { nom: "Celine", adresses: ["celine.com"], siteRequis: true },
  { nom: "Burberry", adresses: ["burberry.com"] },
  { nom: "Versace", adresses: ["versace.com"], sauf: ["Versus Versace"] },
  { nom: "Moncler", adresses: ["moncler.com"] },
  { nom: "Stone Island", adresses: ["stoneisland.com"] },
  { nom: "Canada Goose", adresses: ["canadagoose.com"] },
  // Ajoutées pour cette entrée seulement (décision du fondateur, 23 novembre 2026).
  { nom: "Fendi", adresses: ["fendi.com"] },
  { nom: "Givenchy", adresses: ["givenchy.com"] },
  { nom: "Valentino", adresses: ["valentino.com"], sauf: ["Mario Valentino", "Valentino Bags", "Red Valentino", "Valentino Orlandi"], siteRequis: true },
  { nom: "Bottega Veneta", adresses: ["bottegaveneta.com"] },
  { nom: "Loewe", adresses: ["loewe.com"] },
  { nom: "Miu Miu", adresses: ["miumiu.com"] },
  { nom: "Chloé", adresses: ["chloe.com"], sauf: ["See by Chloé"], siteRequis: true },
  { nom: "Balmain", adresses: ["balmain.com"], sauf: ["Pierre Balmain"] },
  { nom: "Goyard", adresses: ["goyard.com"] },
];
