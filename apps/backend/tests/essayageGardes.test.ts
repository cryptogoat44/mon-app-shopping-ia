import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Essayage virtuel, garde-fous du dépôt (mission, § 11 « vérification
// finale ») : aucune clé ni aucun appel à FASHN côté site ou app, le contrat
// partagé reste fait de types seulement (il entre dans l'app iPhone, qui ne
// doit contenir aucune trace de l'essayage : règle 2.5.19 d'Apple), et seul
// le serveur lit la clé, dans ses réglages.

const ROOT = join(__dirname, "../../..");
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);
const SKIPPED = new Set(["node_modules", ".expo", "dist", "build", "ios", "android", ".git", "coverage", "web-build"]);

function textFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return textFiles(path);
    return TEXT_EXTENSIONS.has(extname(name)) ? [path] : [];
  });
}

describe("aucune clé ni aucun appel à FASHN côté site ou app", () => {
  it("apps/mobile et packages ne citent ni l'API de FASHN, ni sa clé, ni son modèle", () => {
    const files = [...textFiles(join(ROOT, "apps/mobile")), ...textFiles(join(ROOT, "packages"))];
    expect(files.length).toBeGreaterThan(50);
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/api\.fashn\.ai/i, /fashn\.ai\/v1/i, /FASHN_API_KEY/, /tryon-v1\.6/]) {
        if (pattern.test(text)) found.push(`${relative(ROOT, file)} : ${pattern}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("le contrat partagé de l'essayage reste fait de types seulement (rien ne s'exécute dans l'app iPhone)", () => {
    const source = readFileSync(join(ROOT, "packages/shared-types/src/index.ts"), "utf8");
    const start = source.indexOf("// ---- Essayage virtuel photo");
    expect(start).toBeGreaterThan(0);
    expect(source.slice(start)).not.toMatch(/^export\s+(?:const|let|var|function|class|enum|default)\b/m);
  });

  it("seul le serveur lit FASHN_API_KEY : ses réglages (env.ts, lib/tryon/config.ts) et ses scripts", () => {
    const readers = textFiles(join(ROOT, "apps/backend/src"))
      .filter((file) => readFileSync(file, "utf8").includes("FASHN_API_KEY"))
      .map((file) => relative(join(ROOT, "apps/backend"), file))
      .sort();
    expect(readers).toEqual(["src/env.ts", "src/lib/tryon/config.ts"]);
  });
});
