import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

// Prix d'abord, relecture E5 et E6 : la section repliée « Sans prix » a son
// titre de section, lu comme un titre par VoiceOver (navigation par titres),
// et ne montre que 12 cartes d'emblée. Pas de rendu de composants ici
// (vitest.config.ts) : le fichier du composant est lu ; la règle des 12
// cartes est testée dans price-first.test.ts.
const source = readFileSync(join(__dirname, "../src/components/no-price-section.tsx"), "utf8");

describe("section « Sans prix » : un titre de section au-dessus du bouton (relecture E5)", () => {
  it("titre en tête de la section, rôle « header », avant le bouton qui la déplie", () => {
    const title = source.indexOf("{t.result.withoutPriceTitle}");
    const toggle = source.indexOf('testID="sans-prix"');
    expect(title).toBeGreaterThan(-1);
    expect(source.slice(source.lastIndexOf("<Text", title), title)).toContain('accessibilityRole="header"');
    expect(title).toBeLessThan(toggle);
    expect(fr.result.withoutPriceTitle).toBe("Sans prix affiché");
    expect(en.result.withoutPriceTitle).toBe("No price shown");
  });
});

describe("section « Sans prix » dépliée : 12 cartes, puis « Voir plus » (relecture E6)", () => {
  it("la grille ne montre que les premières, le reste derrière son propre « Voir plus »", () => {
    expect(source).toContain("withoutPriceShown(pieces, showAll)");
    expect(source).toMatch(/visible\.map\(/);
    expect(source).not.toMatch(/pieces\.map\(/);
    expect(source).toContain("t.result.showMore(hiddenCount)");
  });
});
