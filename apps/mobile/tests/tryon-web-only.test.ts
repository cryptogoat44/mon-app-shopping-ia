import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCTION_SERVICES, contentSecurityPolicy } from "../web-headers";

// Essayage virtuel photo : il n'existe que sur le SITE. Le même code construit
// l'app iPhone, qui ne doit en contenir aucune trace (règle 2.5.19 d'Apple sur
// les fonctions cachées ou dormantes) :
// - tout fichier qui parle de l'essayage est un fichier .web (Metro ne les
//   prend jamais pour l'iPhone), catalogue de textes compris ;
// - rien sous src/app/ (les écrans y partent tous dans l'app iPhone, quel que
//   soit leur suffixe) ;
// - aucun fichier partagé n'importe un chemin .web écrit en entier (il
//   contournerait le choix par plateforme) ;
// - les versions iPhone des points d'entrée (noms neutres) ne contiennent rien
//   de l'essayage et ne rendent rien ;
// - ni clé ni adresse de FASHN nulle part dans l'app ; la photo et l'image ne
//   sont jamais rangées dans le navigateur, ni suivies, ni partagées.
// La preuve sur les vrais paquets (export iPhone et site) : scripts/verifier-essayage-paquets.js.

const MOBILE = join(__dirname, "..");
const SRC = join(MOBILE, "src");
const DEPOT = join(MOBILE, "../..");

/** Mots qui trahissent l'essayage dans le code. Sensibles à la casse là où il
 * le faut : « tryOn » se cache dans des noms de bibliothèques (« RegistryOnAndroid »). */
const MARKERS: RegExp[] = [/essayage/i, /fashn/i, /\btry-on\b/i, /\btryon/i, /[a-z]Tryon/];
const hasMarker = (text: string) => MARKERS.some((marker) => marker.test(text));

/** Points d'entrée neutres : version iPhone vide, version site réelle. */
const NEUTRAL_ENTRIES = ["src/components/piece-extra-actions.tsx", "src/components/extra-data-settings.tsx"];

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (["node_modules", "dist", ".expo", "ios", "android", ".git"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return keep(name) ? [path] : [];
  });
}

const codeFiles = (dir: string) => walk(dir, (name) => /\.(ts|tsx|js|jsx)$/.test(name));
const isWebFile = (path: string) => /\.web\.(ts|tsx|js|jsx)$/.test(path);
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => relative(MOBILE, path);

/** Chemins importés par un fichier (import, export … from, import(), require()). */
function importedPaths(source: string): string[] {
  const patterns = [/\bfrom\s+["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s+["']([^"']+)["']/gm];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
}

/** Le code sans ses commentaires (qui expliquent justement ce que le code ne fait pas). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Imports exécutés (hors `import type`). */
function runtimeImports(source: string): string[] {
  return [...source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]!);
}

describe("détecteurs de ce garde-fou", () => {
  it("les mots repérés : oui pour l'essayage, non pour les noms de bibliothèques", () => {
    for (const text of ["essayage", "Essayage virtuel", "FASHN", "/api/tryon/status", "useTryonStatus", "TryonStatus", "tryonText", "Virtual try-on"]) expect(hasMarker(text), text).toBe(true);
    for (const text of ["useOptimizedViewRegistryOnAndroid", "RNSentryOnDrawReporter", "LinkEntry onHelp", "Essayer un autre moment", "entryOnly"]) expect(hasMarker(text), text).toBe(false);
  });

  it("les imports : chemins écrits en entier, imports de types écartés", () => {
    const source = 'import { a } from "./x.web";\nimport type { B } from "./y";\nexport { c } from "@/z";\nconst d = await import("./lazy.web");\nimport "./side-effect";';
    expect(importedPaths(source).sort()).toEqual(["./lazy.web", "./side-effect", "./x.web", "./y", "@/z"]);
    expect(runtimeImports(source)).toEqual(["./x.web"]);
  });
});

describe("essayage : seulement dans des fichiers .web", () => {
  const files = codeFiles(SRC);

  it("il y a bien des fichiers de l'essayage, et tous sont des fichiers .web (catalogue de textes compris)", () => {
    const withMarkers = files.filter((file) => hasMarker(read(file)));
    expect(withMarkers.length).toBeGreaterThan(10);
    expect(withMarkers.filter((file) => !isWebFile(file)).map(rel)).toEqual([]);
    expect(withMarkers.map(rel)).toEqual(expect.arrayContaining(["src/i18n/tryon-fr.web.ts", "src/i18n/tryon-en.web.ts", "src/lib/tryon-api.web.ts", "src/components/piece-extra-actions.web.tsx"]));
  });

  it("rien sous src/app/ : ni mot de l'essayage, ni fichier propre à une plateforme", () => {
    const appFiles = codeFiles(join(SRC, "app"));
    expect(appFiles.length).toBeGreaterThan(30);
    expect(appFiles.filter((file) => hasMarker(read(file))).map(rel)).toEqual([]);
    expect(appFiles.filter((file) => /\.(web|ios|android|native)\.[jt]sx?$/.test(file)).map(rel)).toEqual([]);
  });

  it("aucun fichier partagé n'importe un chemin .web écrit en entier ni un module de l'essayage", () => {
    const leaks = files
      .filter((file) => !isWebFile(file))
      .flatMap((file) => importedPaths(read(file)).filter((path) => /\.web$|\.web\.[jt]sx?$/.test(path) || hasMarker(path)).map((path) => `${rel(file)} → ${path}`));
    expect(leaks).toEqual([]);
  });

  it("fichiers partagés sensibles : catalogues, appels au serveur, suivi d'usage, Réglages, fiches, textes juridiques", () => {
    const shared = [
      "src/i18n/fr.ts",
      "src/i18n/en.ts",
      "src/i18n/index.ts",
      "src/lib/api.ts",
      "src/lib/analytics-events.ts",
      "src/lib/status-loading.ts",
      "src/app/(app)/settings.tsx",
      "src/app/(app)/spot/result.tsx",
      "src/app/(app)/envie.tsx",
      "src/app/(app)/vault-item/[id].tsx",
      ...codeFiles(join(SRC, "legal")).map(rel),
    ];
    for (const file of shared) expect(hasMarker(read(join(MOBILE, file))), file).toBe(false);
  });

  it("contrat partagé : seulement des types pour l'essayage (aucune valeur dans l'app iPhone)", () => {
    const contract = read(join(DEPOT, "packages/shared-types/src/index.ts"));
    expect(contract).toMatch(/export type TryonStatus\b/);
    const runtime = [...contract.matchAll(/^export\s+(?:const|let|var|function|class|enum|async\s+function)\s+(\w+)/gm)].map((match) => match[1]!);
    expect(runtime.filter((name) => /tryon/i.test(name))).toEqual([]);
    // Ni chaîne propre à l'essayage écrite comme valeur (« tryon_… », adresse de la route).
    const values = contract.split("\n").filter((line) => /^export\s+(const|let|var|function|class|enum)\b/.test(line) && hasMarker(line));
    expect(values).toEqual([]);
  });
});

describe("points d'entrée neutres", () => {
  it("version iPhone : aucun mot de l'essayage, aucun import exécuté, ne rend rien", () => {
    for (const entry of NEUTRAL_ENTRIES) {
      const source = read(join(MOBILE, entry));
      expect(hasMarker(source), entry).toBe(false);
      expect(runtimeImports(source), entry).toEqual([]);
      expect(source, entry).toMatch(/return null;/);
      expect(basename(entry)).not.toMatch(/\.web\./);
    }
  });

  it("chaque version iPhone a sa version site, avec les mêmes noms exportés", () => {
    const exported = (source: string) => [...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1]).sort();
    for (const entry of NEUTRAL_ENTRIES) {
      const web = entry.replace(/\.tsx$/, ".web.tsx");
      expect(existsSync(join(MOBILE, web)), web).toBe(true);
      expect(exported(read(join(MOBILE, web))), web).toEqual(exported(read(join(MOBILE, entry))));
    }
  });

  it("les écrans importent les points d'entrée par leur nom neutre (choix par plateforme)", () => {
    for (const screen of ["src/app/(app)/spot/result.tsx", "src/app/(app)/envie.tsx", "src/app/(app)/vault-item/[id].tsx"]) {
      expect(read(join(MOBILE, screen)), screen).toContain('from "@/components/piece-extra-actions"');
    }
    expect(read(join(MOBILE, "src/app/(app)/settings.tsx"))).toContain('from "@/components/extra-data-settings"');
  });
});

describe("photo et image : jamais rangées, suivies, partagées ni envoyées ailleurs qu'au serveur", () => {
  const tryonFiles = codeFiles(SRC).filter((file) => isWebFile(file) && hasMarker(read(file)));
  const forbidden: [string, RegExp][] = [
    ["stockage du navigateur ou de l'appareil", /AsyncStorage|localStorage|sessionStorage|indexedDB|\bcaches\.|expo-file-system|expo-secure-store|expo-media-library/],
    ["suivi d'usage", /lib\/analytics|analytics-events|posthog|\btrack\(/i],
    ["journal de la console", /\bconsole\./],
    ["suivi des erreurs", /sentry|reportUnexpectedError|captureException/i],
    ["partage", /\bShare\b|expo-sharing|navigator\.share|share-wish|send-to-friend|\/api\/posts/],
    ["appel réseau direct (tout passe par authorizedFetch, vers le serveur)", /(?<![\w.])fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/],
  ];

  it("le détecteur lit le code, pas les commentaires", () => {
    const code = withoutComments('// jamais localStorage\n/* ni fetch() */\nconst url = "https://exemple.test";\nlocalStorage.setItem("a", url);');
    expect(code).toContain("https://exemple.test");
    expect(forbidden[0]![1].test(code)).toBe(true);
    expect(forbidden[5]![1].test(code)).toBe(false);
  });

  it("aucun fichier de l'essayage n'y touche", () => {
    expect(tryonFiles.length).toBeGreaterThan(10);
    const found = tryonFiles.flatMap((file) => forbidden.filter(([, pattern]) => pattern.test(withoutComments(read(file)))).map(([what]) => `${rel(file)} : ${what}`));
    expect(found).toEqual([]);
  });

  it("le site peut afficher l'image produite (data: et blob: permis pour les images) et n'appelle aucun service d'essayage", () => {
    const csp = contentSecurityPolicy(PRODUCTION_SERVICES);
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("img-src").split(" ")).toEqual(expect.arrayContaining(["data:", "blob:"]));
    expect(csp).not.toMatch(/fashn/i);
  });
});

describe("ni clé ni adresse de FASHN dans l'app ou le site", () => {
  it("aucun fichier de l'app (code, configuration, pages publiques, réglages d'exemple, tests)", () => {
    // Seules exceptions : ce fichier (il écrit les motifs cherchés) et le test du
    // contrôle des paquets, dont un faux paquet contient exprès l'adresse pour
    // vérifier que le contrôle la voit.
    const allowed = [join(MOBILE, "tests", "tryon-web-only.test.ts"), join(MOBILE, "tests", "tryon-bundle-check.test.ts")];
    const files = walk(MOBILE, (name) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|txt|ya?ml)$/.test(name) || name.startsWith(".env")).filter((file) => !allowed.includes(file));
    expect(files.length).toBeGreaterThan(150);
    const secrets: RegExp[] = [/fashn\.ai/i, /FASHN_API_KEY/, /EXPO_PUBLIC_\w*(FASHN|TRYON)/i, /process\.env\.\w*FASHN/i];
    const found = files.flatMap((file) => secrets.filter((pattern) => pattern.test(read(file))).map((pattern) => `${rel(file)} : ${pattern}`));
    expect(found).toEqual([]);
  });

  it("configuration de l'app iPhone : aucun mot de l'essayage", () => {
    const config = ["app.json", "app.config.js", "eas.json", "package.json", "metro.config.js", ...walk(join(MOBILE, "plugins"), () => true).map(rel), ...walk(join(MOBILE, "locales"), () => true).map(rel)];
    for (const file of config) expect(hasMarker(read(join(MOBILE, file))), file).toBe(false);
  });
});
