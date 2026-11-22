import { describe, expect, it } from "vitest";
import words from "@monapp/shared-types/pieces-portees.json" with { type: "json" };
import { isWornPiece } from "../src/lib/tryon/wornPiece.js";

// Garde-fou de l'essayage (lot du 22 novembre 2026) : d'après son seul nom,
// une pièce qui ne se porte pas sur le corps est refusée avant toute dépense ;
// dans le doute, elle passe. Les refus de la route elle-même (rien de
// consommé) sont dans tests/essayageRoutes.test.ts.

describe("pièces qui ne se portent pas sur le corps : refusées, en français comme en anglais", () => {
  it("chaussures, sacs, bijoux, montres, lunettes, chapeaux, ceintures, accessoires, maison", () => {
    const refused = [
      "Baskets en cuir blanc",
      "Bottines à talon",
      "Leather Chelsea Boots",
      "Sac à main matelassé noir",
      "Mini tote bag",
      "Boucles d'oreilles dorées",
      "Bague en argent",
      "Gold hoop earrings",
      "Montre automatique acier",
      "Smartwatch Series 9",
      "Lunettes de soleil œil-de-chat",
      "Aviator sunglasses",
      "Chapeau de paille",
      "Wool beanie",
      "Ceinture en cuir",
      "Reversible belt",
      "Écharpe en cachemire",
      "Porte-clés en cuir",
      "Accessoires cheveux",
      "Coussin en lin",
      "Scented candle",
    ];
    for (const title of refused) expect(isWornPiece(title), title).toBe(false);
  });

  it("au pluriel et avec accents ou majuscules", () => {
    for (const title of ["CHAUSSURES DE VILLE", "Sacs", "Bijoux fantaisie", "Watches", "Gloves"]) expect(isWornPiece(title), title).toBe(false);
  });
});

describe("vêtements, et pièces dans le doute : permis, comme avant", () => {
  it("un vêtement passe", () => {
    for (const title of ["Veste en jean", "Robe midi fleurie", "Wool coat", "T-shirt col rond", "Pantalon large", "Oversized hoodie", "Combinaison en lin"]) {
      expect(isWornPiece(title), title).toBe(true);
    }
  });

  it("un vêtement nommé avec un accessoire passe (« robe avec ceinture »)", () => {
    for (const title of ["Robe avec ceinture", "Trench-coat ceinturé à boucle", "Belted wool coat", "Chemise à motif sacs"]) expect(isWornPiece(title), title).toBe(true);
  });

  it("nom vide, absent ou sans mot reconnu : la pièce passe", () => {
    for (const title of ["", "   ", null, undefined, "Nouvelle collection", "Article 12345", "Zara"]) expect(isWornPiece(title), String(title)).toBe(true);
  });

  it("un mot n'en trouve jamais un autre plus long (« bag » ne trouve pas « baggy »)", () => {
    for (const title of ["Jean baggy", "Ringer", "Hatched print", "Bagatelle"]) expect(isWornPiece(title), title).toBe(true);
  });
});

describe("la liste des mots", () => {
  it("minuscules, sans accents, sans doublon, aucun mot dans les deux listes", () => {
    const all = [...words.vetements, ...words.nonPortees];
    for (const word of all) expect(word, word).toMatch(/^[a-z0-9]+(?: [a-z0-9]+)*$/);
    expect(new Set(all).size).toBe(all.length);
  });
});
