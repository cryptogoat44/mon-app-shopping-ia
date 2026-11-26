import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Raccord du lot « amis par défaut » avec les retours du build 3 (lot 11) :
// les files d'images arrivées depuis (grandes images lues sur la page de la
// boutique, lots 3 ; couleur des bords des petites images, lot 9) restent
// branchées sur les listes du PROPRIÉTAIRE seulement. Quand un ami ouvre une
// étagère, le serveur ne télécharge rien de plus qu'avant et ne contacte
// aucune boutique ni Google : il lit seulement l'adresse d'une grande image
// déjà rangée (fetchHdImageUrls, comme avant la fusion). Dans le doute, pas
// branché (fiche du lot 11, décision 4).

const users = readFileSync(join(__dirname, "../src/routes/users.ts"), "utf8");
const vault = readFileSync(join(__dirname, "../src/routes/vault.ts"), "utf8");
const shelves = users.slice(users.indexOf('fastify.get("/api/users/:userId/wishlist"'), users.indexOf("// Listes des abonnés et des abonnements"));

const QUEUES = ["queueMerchantImages", "upgradeMerchantImageLater", "queueResultMerchantImages", "upgradeResultMerchantImages", "queueKeptEdgeColors", "queueEdgeColors", "queueSearchEdgeColors", "edgeColorField", "edgeColorFor"];

describe("étagères d'un ami : aucune file d'images des retours du build 3", () => {
  it("le découpage voit bien les deux routes des étagères", () => {
    expect(shelves).toContain('fastify.get("/api/users/:userId/wishlist"');
    expect(shelves).toContain('fastify.get("/api/users/:userId/vault"');
    expect(shelves).toContain("fetchHdImageUrls(fastify, pageRows)");
  });

  it("refusé : ni grande image cherchée chez la boutique, ni couleur des bords, ni même lue en mémoire", () => {
    for (const name of QUEUES) expect(shelves, name).not.toContain(name);
    expect(users).not.toMatch(/from "\.\.\/lib\/(merchantImage|edgeColor)\.js"/);
  });

  it("permis : les listes du propriétaire, elles, gardent leurs files (le détecteur les voit)", () => {
    expect(vault).toContain("queueMerchantImages(fastify, request.log, pageRows, hdUrls);");
    expect(vault).toContain("queueKeptEdgeColors(fastify, request.log, pageRows);");
  });
});
