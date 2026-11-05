import { describe, expect, it } from "vitest";
import { isAffiliateLink } from "../src/lib/affiliate-link";

// Lot garde-fous (point 20) : « Lien affilié » seulement pour un vrai lien
// affilié, avec la même règle sur tous les écrans.
describe("lien affilié : une seule règle", () => {
  it("le lien du marchand tel quel (réseau « direct », tous les liens d'aujourd'hui) n'est pas affilié", () => {
    expect(isAffiliateLink({ affiliateUrl: "https://marchand.example/p", merchantUrl: "https://marchand.example/p" })).toBe(false);
  });

  it("aucun lien affilié : pas de mention", () => {
    expect(isAffiliateLink({ affiliateUrl: null, merchantUrl: "https://marchand.example/p" })).toBe(false);
    expect(isAffiliateLink({ affiliateUrl: null, merchantUrl: null })).toBe(false);
  });

  it("un lien différent de celui du marchand (programme d'affiliation) : mention", () => {
    expect(isAffiliateLink({ affiliateUrl: "https://reseau.example/clic?id=1", merchantUrl: "https://marchand.example/p" })).toBe(true);
  });
});
