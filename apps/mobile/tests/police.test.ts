import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { font, serifDisplayLetterSpacing, serifFont, serifLineHeight } from "../src/theme/tokens";

// Lot « identité de marque » (décision du fondateur, 2026-11-17) : Bodoni Moda
// Medium remplace Newsreader pour le nom de l'app, les titres et les noms de
// pièces. Pas de rendu de composants ici (vitest.config.ts) : les fichiers
// sont lus.
const MOBILE = join(__dirname, "..");
const SRC = join(MOBILE, "src");
const read = (path: string) => readFileSync(join(MOBILE, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Chaque style écrit avec la police éditoriale : son fichier et le contenu de ses accolades. */
function serifStyles(): { file: string; style: string }[] {
  return sources(SRC).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(/fontFamily: serifFont/g)].map((match) => ({
      file: relative(SRC, path),
      style: source.slice(source.lastIndexOf("{", match.index) + 1, source.indexOf("}", match.index)),
    }));
  });
}

describe("police éditoriale : Bodoni Moda Medium", () => {
  it("le nom de la police est celui du fichier chargé au démarrage", () => {
    expect(serifFont).toBe("BodoniModa_500Medium");
    const fonts = read("src/theme/fonts.ts");
    expect(fonts).toContain(`import { ${serifFont} } from "@expo-google-fonts/bodoni-moda/500Medium";`);
    expect(fonts).toMatch(new RegExp(`useFonts\\(\\{\\s*${serifFont},\\s*\\}\\)`));
  });

  it("une seule graisse part dans le site : jamais le paquet entier (12 fichiers de police)", () => {
    const imports = sources(SRC).flatMap((path) => [...readFileSync(path, "utf8").matchAll(/from "(@expo-google-fonts\/[^"]+)"/g)].map((match) => match[1]));
    expect(imports).toEqual(["@expo-google-fonts/bodoni-moda/500Medium"]);
  });

  it("l'ancienne police n'est plus installée ; la nouvelle l'est, à une version fixée par pnpm-lock.yaml", () => {
    const dependencies: Record<string, string> = JSON.parse(read("package.json")).dependencies;
    expect(Object.keys(dependencies).filter((name) => name.startsWith("@expo-google-fonts/"))).toEqual(["@expo-google-fonts/bodoni-moda"]);
    expect(read("../../pnpm-lock.yaml")).not.toContain("@expo-google-fonts/newsreader");
  });

  it("le démarrage n'attend pas une police qui ne se charge pas : l'app s'ouvre avec la police de secours", () => {
    const layout = read("src/app/_layout.tsx");
    expect(layout).toContain("const [fontsLoaded, fontError] = useAppFonts();");
    expect(layout).toContain("const fontsReady = fontsLoaded || fontError !== null;");
  });
});

describe("hauteur de ligne : Bodoni Moda réserve 1,5 fois la taille du texte si on ne la fixe pas", () => {
  const SIZES = ["display", "title", "body"] as const;

  it("une hauteur par taille : la place d'une capitale accentuée et d'un jambage (au moins 1,23 fois la taille), sans plus", () => {
    for (const size of SIZES) {
      expect(serifLineHeight[size] / font[size], size).toBeGreaterThanOrEqual(1.23);
      expect(serifLineHeight[size] / font[size], size).toBeLessThanOrEqual(1.3);
    }
  });

  it("chaque texte en police éditoriale fixe sa hauteur de ligne, à la taille qu'il utilise", () => {
    const styles = serifStyles();
    expect(styles.length).toBeGreaterThan(40);
    const faulty = styles.filter(({ file, style }) => {
      const size = /fontSize: font\.(display|title|body)\b/.exec(style)?.[1] as (typeof SIZES)[number] | undefined;
      const lineHeight = /lineHeight: (?:serifLineHeight\.(\w+)|(\d+))/.exec(style);
      if (!size || !lineHeight) return true;
      // Soit la hauteur prévue pour cette taille, soit un nombre qui laisse au moins autant de place (à 1 point près).
      return lineHeight[1] ? lineHeight[1] !== size : Number(lineHeight[2]) < serifLineHeight[size] - 1;
    });
    expect(faulty.map(({ file, style }) => `${file} : ${style.trim()}`)).toEqual([]);
  });

  it("les grands titres sont un peu resserrés, tous de la même façon", () => {
    expect(serifDisplayLetterSpacing).toBeLessThan(0);
    expect(serifDisplayLetterSpacing).toBeGreaterThanOrEqual(-1);
    const display = serifStyles().filter(({ style }) => style.includes("fontSize: font.display"));
    expect(display.length).toBeGreaterThanOrEqual(8);
    expect(display.filter(({ style }) => !style.includes("letterSpacing: serifDisplayLetterSpacing")).map(({ file }) => file)).toEqual([]);
  });

  it("petits textes, prix et boutons restent dans la police du téléphone : la police éditoriale ne sert qu'à trois tailles", () => {
    const sizes = serifStyles().map(({ style }) => /fontSize: font\.(\w+)/.exec(style)?.[1]).filter((size) => size !== undefined);
    expect([...new Set(sizes)].sort()).toEqual(["body", "display", "title"]);
  });
});
