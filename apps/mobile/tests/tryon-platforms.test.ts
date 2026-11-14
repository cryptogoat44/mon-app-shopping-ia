import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PRODUCTION_SERVICES, contentSecurityPolicy } from "../web-headers";

// Essayage virtuel photo, branche de l'app iPhone (feature/essayage-virtuel-mobile,
// jamais fusionnée) : ici, l'essayage est ATTENDU dans l'app iPhone. Ce
// fichier remplace, sur cette branche seulement, le garde-fou « rien dans
// l'app iPhone » de la branche principale (tests/tryon-web-only.test.ts), et
// garde tout ce qui reste vrai partout :
// - tout fichier qui parle de l'essayage est propre à une plateforme : .web
//   (le site) ou .ios (l'iPhone), catalogues de textes compris ; aucun
//   fichier partagé n'en parle, et les points d'entrée neutres (la version
//   de base, prise par toute autre plateforme) ne rendent toujours rien ;
// - rien sous src/app/ : aucun nouvel écran (un fichier y part dans l'app
//   quel que soit son suffixe) ;
// - aucun fichier partagé n'importe un chemin .web ou .ios écrit en entier,
//   et le site n'importe jamais un fichier de l'iPhone ;
// - ni clé, ni adresse, ni appel de FASHN nulle part dans l'app ou le site ;
// - la photo et l'image ne sont jamais rangées (ni AsyncStorage, ni stockage
//   du navigateur), suivies, journalisées ni partagées ; sur l'iPhone, les
//   seuls fichiers passent par lib/tryon-files.ios.ts, effacés aussitôt.
// La preuve sur les vrais paquets (export iPhone et site) : scripts/verifier-essayage-paquets.js.

const MOBILE = join(__dirname, "..");
const SRC = join(MOBILE, "src");
const DEPOT = join(MOBILE, "../..");

/** Mots qui trahissent l'essayage dans le code. Sensibles à la casse là où il
 * le faut : « tryOn » se cache dans des noms de bibliothèques (« RegistryOnAndroid »). */
const MARKERS: RegExp[] = [/essayage/i, /fashn/i, /\btry-on\b/i, /\btryon/i, /[a-z]Tryon/];
const hasMarker = (text: string) => MARKERS.some((marker) => marker.test(text));

/** Points d'entrée neutres : version de base vide, versions site et iPhone réelles. */
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
const isIosFile = (path: string) => /\.ios\.(ts|tsx|js|jsx)$/.test(path);
const isPlatformFile = (path: string) => isWebFile(path) || isIosFile(path);
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

/** Ce qui part vraiment dans un paquet : le fichier une fois ses types et ses
 * commentaires effacés (la compilation de TypeScript, comme celle de Metro). */
function runtimeOf(source: string, fileName = "module.ts"): string {
  return ts.transpileModule(source, { fileName, compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText;
}

const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];

/** Le fichier qu'un import désigne pour une plateforme, comme Metro : version
 * .ios (ou .web) d'abord, puis .native pour l'iPhone, puis le fichier de
 * base ; un chemin au suffixe écrit en entier désigne ce fichier-là. null :
 * une bibliothèque, ou un fichier hors de l'app. */
function resolveFor(platform: "ios" | "web", from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return base;
  const suffixes = platform === "ios" ? [".ios", ".native", ""] : [".web", ""];
  for (const candidate of [base, join(base, "index")]) {
    for (const suffix of suffixes) {
      for (const extension of CODE_EXTENSIONS) {
        const path = `${candidate}${suffix}${extension}`;
        if (existsSync(path) && statSync(path).isFile()) return path;
      }
    }
  }
  return null;
}

/** Fichiers de l'app que reçoit le paquet d'une plateforme à partir de ces
 * imports d'écran : imports exécutés et réexportations suivis (les imports de
 * types disparaissent à la compilation). Les fichiers partagés ne sont pas
 * suivis plus loin : un autre test vérifie qu'ils n'importent rien de
 * l'essayage ni aucun chemin propre à une plateforme. */
function bundledFrom(platform: "ios" | "web", screen: string, specifiers: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = specifiers.map((specifier) => resolveFor(platform, screen, specifier)).filter((path): path is string => path !== null);
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const source = read(file);
    if (!isPlatformFile(file) && !hasMarker(source)) continue;
    for (const specifier of importedPaths(runtimeOf(source, file))) {
      const target = resolveFor(platform, file, specifier);
      if (target) queue.push(target);
    }
  }
  return seen;
}

/** Noms exportés par un module : fonctions et réexportations (« export { A } from … »). */
function exportedNames(source: string): string[] {
  const functions = [...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1]!);
  const reexported = [...source.matchAll(/^export \{([^}]+)\} from/gm)].flatMap((match) =>
    match[1]!.split(",").map((name) => name.trim().split(/\s+as\s+/).pop()!).filter((name) => name && !name.startsWith("type "))
  );
  return [...functions, ...reexported].sort();
}

describe("détecteurs de ce garde-fou", () => {
  it("les mots repérés : oui pour l'essayage, non pour les noms de bibliothèques", () => {
    for (const text of ["essayage", "Essayage virtuel", "FASHN", "/api/tryon/status", "useTryonStatus", "TryonStatus", "tryonText", "Virtual try-on"]) expect(hasMarker(text), text).toBe(true);
    for (const text of ["useOptimizedViewRegistryOnAndroid", "RNSentryOnDrawReporter", "LinkEntry onHelp", "Essayer un autre moment", "entryOnly"]) expect(hasMarker(text), text).toBe(false);
  });

  it("les imports : chemins écrits en entier, imports de types écartés", () => {
    const source = 'import { a } from "./x.web";\nimport type { B } from "./y";\nexport { c } from "@/z";\nconst d = await import("./lazy.ios");\nimport "./side-effect";';
    expect(importedPaths(source).sort()).toEqual(["./lazy.ios", "./side-effect", "./x.web", "./y", "@/z"]);
    expect(runtimeImports(source)).toEqual(["./x.web"]);
  });
});

describe("essayage : seulement dans des fichiers propres à une plateforme (.web pour le site, .ios pour l'iPhone)", () => {
  const files = codeFiles(SRC);
  const withMarkers = files.filter((file) => hasMarker(read(file)));

  it("aucun fichier partagé n'en parle ; il y a bien les deux versions, catalogues de textes compris", () => {
    expect(withMarkers.filter((file) => !isPlatformFile(file)).map(rel)).toEqual([]);
    expect(withMarkers.filter(isWebFile).length).toBeGreaterThan(10);
    expect(withMarkers.filter(isIosFile).length).toBeGreaterThan(10);
    expect(withMarkers.map(rel)).toEqual(
      expect.arrayContaining([
        "src/i18n/tryon-fr.web.ts",
        "src/i18n/tryon-en.web.ts",
        "src/lib/tryon-api.web.ts",
        "src/components/piece-extra-actions.web.tsx",
        "src/i18n/tryon-iphone-fr.ios.ts",
        "src/i18n/tryon-iphone-en.ios.ts",
        "src/lib/tryon-photo.ios.ts",
        "src/lib/tryon-files.ios.ts",
        "src/lib/tryon-image.ios.ts",
      ])
    );
  });

  it("rien sous src/app/ : ni mot de l'essayage, ni fichier propre à une plateforme (aucun nouvel écran)", () => {
    const appFiles = codeFiles(join(SRC, "app"));
    expect(appFiles.length).toBeGreaterThan(30);
    expect(appFiles.filter((file) => hasMarker(read(file))).map(rel)).toEqual([]);
    expect(appFiles.filter((file) => /\.(web|ios|android|native)\.[jt]sx?$/.test(file)).map(rel)).toEqual([]);
  });

  it("aucun fichier partagé n'importe un chemin .web ou .ios écrit en entier, ni un module de l'essayage", () => {
    const leaks = files
      .filter((file) => !isPlatformFile(file))
      .flatMap((file) => importedPaths(read(file)).filter((path) => /\.(web|ios)$|\.(web|ios)\.[jt]sx?$/.test(path) || hasMarker(path)).map((path) => `${rel(file)} → ${path}`));
    expect(leaks).toEqual([]);
  });

  it("le site n'importe jamais un fichier de l'iPhone", () => {
    const leaks = files.filter(isWebFile).flatMap((file) => importedPaths(read(file)).filter((path) => /\.ios$|\.ios\.[jt]sx?$/.test(path)).map((path) => `${rel(file)} → ${path}`));
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

  it("contrat partagé : seulement des types pour l'essayage ; types effacés, plus aucune trace, même dans un objet existant", () => {
    const contract = read(join(DEPOT, "packages/shared-types/src/index.ts"));
    expect(contract).toMatch(/export type TryonStatus\b/);
    const runtime = runtimeOf(contract);
    expect(runtime.length).toBeGreaterThan(1000);
    expect(hasMarker(runtime)).toBe(false);
    const tampered = contract.replace(/export const CONSENT_VERSIONS: [^=]*= \{/, (start) => `${start}\n  tryon: "2026-11-v1",`);
    expect(tampered).not.toBe(contract);
    expect(hasMarker(runtimeOf(tampered))).toBe(true);
  });
});

describe("points d'entrée neutres", () => {
  it("version de base (toute plateforme autre que le site et l'iPhone) : aucun mot de l'essayage, aucun import exécuté, ne rend rien", () => {
    for (const entry of NEUTRAL_ENTRIES) {
      const source = read(join(MOBILE, entry));
      expect(hasMarker(source), entry).toBe(false);
      expect(runtimeImports(source), entry).toEqual([]);
      expect(source, entry).toMatch(/return null;/);
      expect(basename(entry)).not.toMatch(/\.(web|ios)\./);
    }
  });

  it("chaque version de base a sa version site et sa version iPhone, avec les mêmes noms exportés", () => {
    expect(exportedNames('export function A() {}\nexport { B, C as D } from "./x";')).toEqual(["A", "B", "D"]);
    for (const entry of NEUTRAL_ENTRIES) {
      const base = exportedNames(read(join(MOBILE, entry)));
      expect(base.length, entry).toBeGreaterThan(0);
      for (const platform of [".web.tsx", ".ios.tsx"]) {
        const sibling = entry.replace(/\.tsx$/, platform);
        expect(existsSync(join(MOBILE, sibling)), sibling).toBe(true);
        expect(exportedNames(read(join(MOBILE, sibling))), sibling).toEqual(base);
      }
    }
  });

  it("les écrans importent les points d'entrée par leur nom neutre (choix par plateforme)", () => {
    for (const screen of ["src/app/(app)/spot/result.tsx", "src/app/(app)/envie.tsx", "src/app/(app)/vault-item/[id].tsx"]) {
      expect(read(join(MOBILE, screen)), screen).toContain('from "@/components/piece-extra-actions"');
    }
    expect(read(join(MOBILE, "src/app/(app)/settings.tsx"))).toContain('from "@/components/extra-data-settings"');
  });
});

describe("ce que reçoit chaque paquet, à partir des écrans (résolution par plateforme, comme Metro)", () => {
  const SCREEN = join(SRC, "app/(app)/settings.tsx");
  const ENTRIES = ["@/components/piece-extra-actions", "@/components/extra-data-settings"];
  const at = (path: string) => join(MOBILE, path);

  it("le résolveur suit Metro : version de la plateforme d'abord, chemin au suffixe écrit en entier pris tel quel", () => {
    expect(resolveFor("ios", SCREEN, "@/components/piece-extra-actions")).toBe(at("src/components/piece-extra-actions.ios.tsx"));
    expect(resolveFor("web", SCREEN, "@/components/piece-extra-actions")).toBe(at("src/components/piece-extra-actions.web.tsx"));
    expect(resolveFor("ios", at("src/components/tryon-ui.ios.tsx"), "./tryon-ui.web")).toBe(at("src/components/tryon-ui.web.tsx"));
    expect(resolveFor("ios", SCREEN, "@/i18n")).toBe(at("src/i18n/index.ts"));
    expect(resolveFor("ios", SCREEN, "react-native")).toBeNull();
  });

  it("iPhone : les écrans, la photo, les fichiers temporaires et l'enregistrement de l'iPhone ; jamais la fenêtre du site (choix de fichier, page rechargée, téléchargement)", () => {
    const ios = bundledFrom("ios", SCREEN, ENTRIES);
    for (const file of [
      "src/components/piece-extra-actions.ios.tsx",
      "src/components/extra-data-settings.ios.tsx",
      "src/components/tryon-sheet.ios.tsx",
      "src/components/tryon-steps.ios.tsx",
      "src/components/tryon-photo-step.ios.tsx",
      "src/components/tryon-result.ios.tsx",
      "src/lib/tryon-photo.ios.ts",
      "src/lib/tryon-files.ios.ts",
      "src/lib/tryon-image.ios.ts",
      "src/i18n/tryon-iphone-fr.ios.ts",
      "src/i18n/tryon-iphone-en.ios.ts",
      // Logique et textes du site, repris tels quels.
      "src/lib/tryon-api.web.ts",
      "src/lib/tryon-flow.web.ts",
      "src/i18n/tryon-fr.web.ts",
    ]) {
      expect(ios.has(at(file)), file).toBe(true);
    }
    for (const file of ["src/components/tryon-sheet.web.tsx", "src/components/piece-extra-actions.web.tsx", "src/components/piece-extra-actions.tsx", "src/components/extra-data-settings.tsx"]) {
      expect(ios.has(at(file)), file).toBe(false);
    }
  });

  it("site : la fenêtre du site, et aucun fichier de l'iPhone", () => {
    const web = bundledFrom("web", SCREEN, ENTRIES);
    expect(web.has(at("src/components/tryon-sheet.web.tsx"))).toBe(true);
    expect([...web].filter(isIosFile).map(rel)).toEqual([]);
  });

  it("iPhone : même délai d'abandon d'un essai que le site (le serveur abandonne le sien avant)", () => {
    const timeout = (file: string) => /const CLIENT_TIMEOUT_MS = ([\d_]+);/.exec(read(at(file)))?.[1];
    expect(timeout("src/components/tryon-sheet.ios.tsx")).toBe(timeout("src/components/tryon-sheet.web.tsx"));
    expect(timeout("src/components/tryon-sheet.ios.tsx")).toBe("120_000");
  });

  it("iPhone : la fenêtre vide le dossier de l'essayage à l'ouverture et à la fermeture, et efface la photo remplacée", () => {
    const sheet = withoutComments(read(at("src/components/tryon-sheet.ios.tsx")));
    expect(sheet.match(/sweepTryonFiles\(\);/g)).toHaveLength(2);
    expect(sheet).toContain("discardTryonFile(previous.uri)");
  });
});

describe("photo et image : jamais rangées, suivies, partagées ni envoyées ailleurs qu'au serveur", () => {
  const tryonFiles = codeFiles(SRC).filter((file) => isPlatformFile(file) && hasMarker(read(file)));
  const forbidden: [string, RegExp][] = [
    ["stockage durable (AsyncStorage, navigateur, trousseau)", /AsyncStorage|localStorage|sessionStorage|indexedDB|\bcaches\.|expo-secure-store/],
    ["suivi d'usage", /lib\/analytics|analytics-events|posthog|\btrack\(/i],
    ["journal de la console", /\bconsole\./],
    ["suivi des erreurs", /sentry|reportUnexpectedError|captureException/i],
    ["partage", /\bShare\b|expo-sharing|navigator\.share|share-wish|send-to-friend|\/api\/posts/],
    ["appel réseau direct (tout passe par authorizedFetch, vers le serveur)", /(?<![\w.])fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/],
  ];
  /** Modules natifs qui touchent aux fichiers, aux photos ou à l'appareil photo : seulement là où il le faut (iPhone). */
  const nativeModules: [RegExp, string[]][] = [
    [/expo-file-system/, ["src/lib/tryon-files.ios.ts", "src/lib/tryon-photo.ios.ts"]],
    [/expo-media-library/, ["src/lib/tryon-image.ios.ts"]],
    [/expo-image-picker|expo-image-manipulator/, ["src/lib/tryon-photo.ios.ts"]],
  ];

  it("le détecteur lit le code, pas les commentaires", () => {
    const code = withoutComments('// jamais localStorage\n/* ni fetch() */\nconst url = "https://exemple.test";\nlocalStorage.setItem("a", url);');
    expect(code).toContain("https://exemple.test");
    expect(forbidden[0]![1].test(code)).toBe(true);
    expect(forbidden[5]![1].test(code)).toBe(false);
  });

  it("aucun fichier de l'essayage (site ou iPhone) n'y touche", () => {
    expect(tryonFiles.length).toBeGreaterThan(20);
    const found = tryonFiles.flatMap((file) => forbidden.filter(([, pattern]) => pattern.test(withoutComments(read(file)))).map(([what]) => `${rel(file)} : ${what}`));
    expect(found).toEqual([]);
  });

  it("fichiers, photothèque, appareil photo : seulement dans les modules de l'iPhone prévus pour cela, jamais sur le site", () => {
    const found = tryonFiles.flatMap((file) =>
      nativeModules.filter(([pattern, allowed]) => pattern.test(withoutComments(read(file))) && !allowed.includes(rel(file))).map(([pattern]) => `${rel(file)} : ${pattern}`)
    );
    expect(found).toEqual([]);
    for (const [pattern, allowed] of nativeModules) for (const file of allowed) expect(read(join(MOBILE, file)), file).toMatch(pattern);
  });

  it("iPhone : aucun objet du navigateur dans les fichiers .ios de l'essayage", () => {
    const found = tryonFiles.filter(isIosFile).filter((file) => /\bdocument\.|\bwindow\.|URL\.createObjectURL|<input\b/.test(withoutComments(read(file))));
    expect(found.map(rel)).toEqual([]);
  });

  it("iPhone : la photo et l'image produite sont affichées sans aucun cache d'images ; jamais Image.loadAsync ni prefetch (ils écrivent sur le disque)", () => {
    const images = tryonFiles.filter(isIosFile).flatMap((file) => [...withoutComments(read(file)).matchAll(/<Image\b[\s\S]*?\/>/g)].map((match) => ({ file: rel(file), tag: match[0] })));
    // L'aperçu de la photo et l'image produite.
    expect(images.map((image) => image.file).sort()).toEqual(["src/components/tryon-photo-step.ios.tsx", "src/components/tryon-result.ios.tsx"]);
    for (const image of images) expect(image.tag, image.file).toMatch(/cachePolicy="none"/);
    const found = tryonFiles.filter(isIosFile).filter((file) => /Image\.(loadAsync|prefetch)|useImage\(|writeToCacheAsync/.test(withoutComments(read(file))));
    expect(found.map(rel)).toEqual([]);
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
    const allowed = [join(MOBILE, "tests", "tryon-platforms.test.ts"), join(MOBILE, "tests", "tryon-bundle-check.test.ts")];
    const files = walk(MOBILE, (name) => /\.(ts|tsx|js|jsx|mjs|cjs|json|md|html|txt|ya?ml)$/.test(name) || name.startsWith(".env")).filter((file) => !allowed.includes(file));
    expect(files.length).toBeGreaterThan(150);
    const secrets: RegExp[] = [/fashn\.ai/i, /FASHN_API_KEY/, /EXPO_PUBLIC_\w*(FASHN|TRYON)/i, /process\.env\.\w*FASHN/i];
    const found = files.flatMap((file) => secrets.filter((pattern) => pattern.test(read(file))).map((pattern) => `${rel(file)} : ${pattern}`));
    expect(found).toEqual([]);
  });

  it("configuration de l'app iPhone : l'essayage n'y apparaît que dans les textes d'autorisation (appareil photo, photothèque, ajout aux photos)", () => {
    for (const file of ["app.config.js", "eas.json", "package.json", "metro.config.js", ...walk(join(MOBILE, "plugins"), () => true).map(rel)]) expect(hasMarker(read(join(MOBILE, file))), file).toBe(false);
    // app.json : les textes des deux modules d'Expo, rien d'autre.
    const app = read(join(MOBILE, "app.json"));
    const plugins = (JSON.parse(app) as { expo: { plugins: unknown[] } }).expo.plugins;
    const options = (name: string) => (plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name) as [string, Record<string, unknown>])[1];
    const permissionTexts = [options("expo-image-picker").photosPermission, options("expo-image-picker").cameraPermission, options("expo-media-library").photosPermission, options("expo-media-library").savePhotosPermission] as string[];
    for (const text of permissionTexts) expect(hasMarker(text), text).toBe(true);
    expect(hasMarker(permissionTexts.reduce((rest, text) => rest.split(JSON.stringify(text)).join('""'), app))).toBe(false);
    // Textes traduits d'iOS : les trois textes d'autorisation, rien d'autre.
    const withTryon = ["NSPhotoLibraryUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryAddUsageDescription"];
    for (const file of walk(join(MOBILE, "locales"), () => true)) {
      for (const [key, value] of Object.entries(JSON.parse(read(file)) as Record<string, string>)) expect(hasMarker(value), `${rel(file)} : ${key}`).toBe(withTryon.includes(key));
    }
  });
});
