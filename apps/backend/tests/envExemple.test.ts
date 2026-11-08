import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Fichier d'exemple des réglages (lot « filets de sécurité », point 32) :
// chaque variable lue par src/env.ts y figure, expliquée, sans vraie clé.
const racine = join(__dirname, "..");
const schema = readFileSync(join(racine, "src/env.ts"), "utf8");
const exemple = readFileSync(join(racine, ".env.example"), "utf8");

describe("apps/backend/.env.example", () => {
  const variables = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]!);

  it("cite chaque variable de src/env.ts, précédée d'une explication", () => {
    expect(variables.length).toBeGreaterThan(15);
    const lignes = exemple.split("\n");
    for (const variable of variables) {
      const index = lignes.findIndex((ligne) => new RegExp(`^(# )?${variable}=`).test(ligne));
      expect(index, variable).toBeGreaterThan(0);
      // Au-dessus : un commentaire (l'explication) ou une autre variable du même bloc.
      expect(lignes[index - 1]!.startsWith("#"), variable).toBe(true);
    }
  });

  it("ne contient aucune vraie clé", () => {
    for (const motif of [/sk-ant-/, /sb_secret_/, /eyJhbGciOi/, /rnd_[A-Za-z0-9]{10,}/, /phc_[A-Za-z0-9]{20,}/, /@o\d+\.ingest/]) {
      expect(exemple, String(motif)).not.toMatch(motif);
    }
  });
});
