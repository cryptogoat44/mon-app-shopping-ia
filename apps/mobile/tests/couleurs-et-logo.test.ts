import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Lot « couleurs et logo » (« Noir et ivoire », validé par le fondateur le
// 25 novembre 2026) : l'accent (jeton `vert`) a la couleur du texte. Ce
// fichier lit le source de l'app pour vérifier ce que cela entraîne.

const SRC = join(__dirname, "../src");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return fichiers(chemin);
    return /\.tsx?$/.test(nom) ? [chemin] : [];
  });
}

const sources = fichiers(SRC).map((chemin) => ({ fichier: relative(SRC, chemin), code: readFileSync(chemin, "utf8") }));

/** Les interrupteurs (`<Switch …/>`) d'un source. */
function interrupteurs(code: string): string[] {
  return [...code.matchAll(/<Switch\b[\s\S]*?\/>/g)].map((match) => match[0]);
}

describe("interrupteurs : couleurs communes (theme/accent.ts)", () => {
  it("chaque interrupteur de l'app prend couleursInterrupteur(sa valeur), jamais une piste écrite à la main", () => {
    const tous = sources.flatMap(({ fichier, code }) => interrupteurs(code).map((bloc) => ({ fichier, bloc })));
    expect(tous.length).toBeGreaterThanOrEqual(11);
    for (const { fichier, bloc } of tous) {
      const valeur = bloc.match(/\bvalue=\{(.*)\}/)?.[1];
      expect(valeur, fichier).toBeTruthy();
      expect(bloc, fichier).toContain(`{...couleursInterrupteur(${valeur})}`);
      expect(bloc, fichier).not.toMatch(/trackColor|thumbColor/);
    }
  });

  it("le garde-fou refuse une piste écrite à la main (le curseur blanc d'iOS se perdrait sur l'ivoire)", () => {
    const [bloc] = interrupteurs(`<Switch value={on} trackColor={{ true: color.vert, false: color.filet }} />`);
    expect(bloc).toBeDefined();
    expect(bloc).not.toContain("couleursInterrupteur(");
    expect(bloc).toMatch(/trackColor/);
  });

  it("allumé : curseur `blanc` du thème ; éteint : blanc ; sur le site, le curseur allumé suit (activeThumbColor)", () => {
    const accent = readFileSync(join(SRC, "theme/accent.ts"), "utf8");
    expect(accent).toContain("const curseur = allume ? color.blanc : color.surImage;");
    expect(accent).toContain("trackColor: { true: color.vert, false: color.filet }");
    expect(accent).toContain("activeThumbColor: color.blanc");
  });
});
