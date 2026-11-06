// « Lien affilié » (lot garde-fous, point 20 de la feuille de route V1) : une
// seule règle, sur tous les écrans et dans les messages de partage. Un lien
// n'est affilié que s'il diffère du lien du marchand. Aujourd'hui, aucun ne
// l'est (réseau « direct » : le lien du marchand, tel quel) : la mention
// n'apparaît donc nulle part. Elle reviendra d'elle-même le jour où un
// programme d'affiliation donnera un autre lien. Fichier sans dépendance :
// testé par vitest.

export interface MerchantLinks {
  affiliateUrl: string | null;
  merchantUrl: string | null;
}

/** true quand le lien ouvert ou partagé est un vrai lien affilié (mention obligatoire). */
export function isAffiliateLink(links: MerchantLinks): boolean {
  return links.affiliateUrl !== null && links.affiliateUrl !== links.merchantUrl;
}
