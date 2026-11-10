import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAffiliateLink } from "../src/lib/affiliateLinks.js";

// Lot « mention Lien affilié » : côté serveur aussi, une seule règle décide
// de `isAffiliate` — la même que dans l'app
// (apps/mobile/src/lib/affiliate-link.ts). Sans base : la règle est testée
// seule, et les fichiers qui construisent une réponse sont lus.
const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

describe("lien affilié : une seule règle côté serveur", () => {
  it("un lien différent de celui du marchand (programme d'affiliation) : mention", () => {
    expect(isAffiliateLink("https://reseau.example/clic?id=1", "https://marchand.example/p")).toBe(true);
    // Pièce sans lien de marchand connu, mais avec un lien de réseau.
    expect(isAffiliateLink("https://reseau.example/clic?id=1", null)).toBe(true);
  });

  it("le lien du marchand tel quel (réseau « direct », tous les liens d'aujourd'hui) : aucune mention", () => {
    expect(isAffiliateLink("https://marchand.example/p", "https://marchand.example/p")).toBe(false);
  });

  it("aucun lien affilié : aucune mention", () => {
    expect(isAffiliateLink(null, "https://marchand.example/p")).toBe(false);
    expect(isAffiliateLink(undefined, "https://marchand.example/p")).toBe(false);
    expect(isAffiliateLink(null, null)).toBe(false);
  });
});

describe("chaque réponse qui porte un lien de boutique passe par la règle", () => {
  const sites: [string, string, string][] = [
    ["l'envie d'une publication", "routes/posts.ts", "isAffiliate: isAffiliateLink(affiliateUrl, wish.merchant_url),"],
    ["la pièce taguée d'une publication", "routes/posts.ts", "isAffiliate: isAffiliateLink(affiliateUrl, m.merchant_url),"],
    ["la pièce reçue d'un ami", "routes/pieces.ts", "isAffiliate: isAffiliateLink(affiliateUrl, row.merchant_url),"],
    ["l'envie jointe à un message", "lib/messaging.ts", "isAffiliate: isAffiliateLink(affiliateUrl, row.wish_merchant_url),"],
    ["l'envie d'une collection partagée", "lib/collections.ts", "isAffiliate: isAffiliateLink(affiliateUrl, wish.merchant_url),"],
  ];

  it.each(sites)("%s", (_surface, file, line) => {
    expect(read(file)).toContain(line);
  });

  it("personne ne réécrit la comparaison à la main", () => {
    for (const file of new Set(sites.map(([, path]) => path))) {
      expect(read(file)).not.toMatch(/affiliateUrl !== null && affiliateUrl !==/);
    }
  });

  it("une pièce taguée venue du Vault n'a pas de lien : jamais de mention", () => {
    const posts = read("routes/posts.ts");
    const vaultPiece = posts.slice(posts.indexOf("if (tag.vault_item_id) {"), posts.indexOf("} else if (tag.product_match_id) {"));
    expect(vaultPiece).toContain("merchantUrl: null,");
    expect(vaultPiece).toContain("isAffiliate: false,");
  });
});
