import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Lot 3 : 100 % de l'interface passe par les catalogues (src/i18n). Ce test
// repère tout texte en français resté en dur dans les écrans, composants et
// utilitaires. Exclus : les catalogues eux-mêmes, les documents juridiques
// (un texte complet par langue), les données de démonstration et les
// messages destinés aux développeurs (throw new Error, console).
const ROOT = join(__dirname, "../src");
const EXCLUDED = ["i18n/", "legal/", "api/mock.ts", "lib/format.ts"];
const FRENCH = /[àâçéèêëîïôûùüÿœÉÈÀ]|\b(le|la|les|de|des|du|un|une|et|est|sur|vous|votre|vos|pour|avec|aux|Retour|Annuler|Fermer|Suivre|Profil|Profils|Fil|Rechercher|Aucun|Voir|Plus|Aimer|Publier|Garder|Envies|Partager|Supprimer|Continuer|Enregistrer)\b|[dlnqs]'[a-zà-ÿ]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("aucun texte d'interface en dur (lot 3)", () => {
  it("tous les textes passent par les catalogues de langue", () => {
    const found: string[] = [];
    for (const file of files(ROOT)) {
      const name = relative(ROOT, file);
      if (EXCLUDED.some((prefix) => name.startsWith(prefix))) continue;
      const lines = withoutComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        // Messages pour développeurs : erreurs levées (sur une ou deux lignes) et console.
        if (/throw new Error|super\(|console\.|^\s*import /.test(line) || /Error\($/.test(lines[index - 1] ?? "")) return;
        const literals = [...line.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
        for (const text of literals) {
          if (FRENCH.test(text) && !/^[\w./@-]+$/.test(text)) found.push(`${name}:${index + 1} ${text.trim()}`);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
