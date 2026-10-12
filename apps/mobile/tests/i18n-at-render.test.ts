import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Un texte lu dans `t` au CHARGEMENT d'un module (objet ou tableau de premier
// niveau) reste dans la langue de démarrage : c'était le cas des motifs du
// menu de signalement, restés en français après le passage à l'anglais
// (trouvé au lot 5). Les textes se lisent à l'affichage, dans une fonction.
const ROOT = join(__dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Numéros des lignes qui lisent `t.` dans un objet ou un tableau déclaré au premier niveau. */
function textsReadAtLoad(source: string): number[] {
  const found: number[] = [];
  let inside = false;
  source.split("\n").forEach((line, index) => {
    const opens = /^(export )?const \w+[^=]*= *[{[]\s*$/.test(line);
    const oneLine = /^(export )?const \w+[^=]*= *[{[].*[}\]];?\s*$/.test(line);
    if (opens || oneLine) {
      inside = opens;
      if (oneLine && /(?<![\w.])t\.[a-zA-Z]/.test(line) && !line.includes("=>")) found.push(index + 1);
      return;
    }
    if (!inside) return;
    if (/^[}\]]/.test(line)) {
      inside = false;
      return;
    }
    if (/(?<![\w.])t\.[a-zA-Z]/.test(line) && !line.includes("=>") && !line.includes("function")) found.push(index + 1);
  });
  return found;
}

describe("textes lus à l'affichage, jamais au chargement d'un module (lot 5)", () => {
  it("le détecteur repère le défaut corrigé du menu de signalement", () => {
    const before = [
      "const REASON_LABELS: Record<ReportReason, string> = {",
      "  spam: t.moderation.reasonSpam,",
      "};",
      "const later = () => t.moderation.reasonSpam;",
      "export const COLORS = { a: color.vert };",
    ].join("\n");
    expect(textsReadAtLoad(before)).toEqual([2]);
  });

  it("aucun écran, composant ni utilitaire ne fige un texte au chargement", () => {
    const found = files(ROOT)
      .filter((file) => !relative(ROOT, file).startsWith("i18n/"))
      .flatMap((file) => textsReadAtLoad(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`));
    expect(found).toEqual([]);
  });
});
