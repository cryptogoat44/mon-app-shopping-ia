// Pièces qu'on peut essayer (décision 5 du plan) : un résultat d'une
// recherche du membre lui-même (lib/ownMatches.ts), avec une image en https
// et, si TRYON_REQUIRE_BUY_LINK l'exige, un lien d'achat valide. Les
// adresses viennent de la base, jamais de l'app : rien à détourner (SSRF).
import type { OwnMatchLinks } from "../ownMatches.js";
import { webUrlOrNull } from "../validation.js";

/** Une adresse web ordinaire en https ; sinon null. */
function httpsUrl(value: string | null): string | null {
  const url = webUrlOrNull(value);
  return url !== null && new URL(url).protocol === "https:" ? url : null;
}

/** Images de la pièce à donner au fournisseur, dans l'ordre : l'originale de
 * la boutique (grande), puis la vignette ; https seulement, sans doublon. */
export function garmentImageCandidates(match: OwnMatchLinks): string[] {
  const candidates = [httpsUrl(match.imageHdUrl), httpsUrl(match.imageUrl)].filter((url): url is string => url !== null);
  return [...new Set(candidates)];
}

/** Lien d'achat de la pièce (affilié s'il existe, sinon celui du marchand), s'il est valide. */
export function buyLinkOf(match: OwnMatchLinks): string | null {
  return webUrlOrNull(match.affiliateUrl ?? match.merchantUrl);
}

/** Les images à essayer, ou null si la pièce ne peut pas être essayée. */
export function tryonGarmentUrls(match: OwnMatchLinks, requireBuyLink: boolean): string[] | null {
  const candidates = garmentImageCandidates(match);
  if (candidates.length === 0) return null;
  if (requireBuyLink && buyLinkOf(match) === null) return null;
  return candidates;
}
