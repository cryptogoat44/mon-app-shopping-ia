import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou (12 novembre 2026, règle absolue du fondateur) : ni le serveur ni
// l'app ne téléchargent jamais une vidéo, un fichier, une vignette ou une
// image d'aperçu depuis TikTok ou Instagram, et aucune page n'est aspirée.
// La voie « couverture » (image d'un lien demandée à la plateforme, puis
// téléchargée chez son hébergeur d'images) a été retirée ce jour-là ; elle est
// archivée sur la branche archive/couverture-oembed. Ce test lit le code du
// serveur, de l'app et des types partagés, et échoue si l'une de ses traces
// revient. Sans base, sans réseau.
//
// Non lus : ce fichier (il doit bien nommer ce qu'il interdit) et
// apps/mobile/src/legal/ (textes juridiques publiés).
// Le mot « instagram_oembed » n'est PAS interdit : le seul appel oEmbed admis
// plus tard est celui de Meta, pour obtenir le code d'intégration officiel
// (jamais une image).
const REPO = join(__dirname, "../../..");
const SCANNED_DIRS = ["apps/backend/src", "apps/mobile/src", "packages/shared-types/src"] as const;
const EXCLUDED_DIRS = ["apps/mobile/src/legal/"] as const;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

interface Forbidden {
  /** Nom court, pour le message et les exceptions. */
  name: string;
  pattern: RegExp;
  why: string;
}

const FORBIDDEN: readonly Forbidden[] = [
  { name: "tiktokcdn", pattern: /tiktokcdn/i, why: "hébergeur des images et des vidéos de TikTok" },
  { name: "cdninstagram", pattern: /cdninstagram/i, why: "hébergeur des images et des vidéos d'Instagram" },
  { name: "fbcdn", pattern: /fbcdn/i, why: "hébergeur des images et des vidéos de Meta" },
  { name: "tiktok.com/oembed", pattern: /tiktok\.com\/oembed/i, why: "oEmbed de TikTok (il renvoie l'adresse d'une vignette)" },
  { name: "downloadThumbnail", pattern: /downloadThumbnail/, why: "téléchargement d'une vignette (fonction retirée)" },
  { name: "LINK_PREVIEW_ENABLED", pattern: /LINK_PREVIEW_ENABLED/, why: "interrupteur du serveur de la voie « couverture » (retiré)" },
  { name: "LINK_COVER_ENABLED", pattern: /LINK_COVER_ENABLED/, why: "interrupteur de l'app de la voie « couverture » (retiré)" },
  {
    // « thumbnail_url: » suivi d'autre chose que null : une adresse d'image
    // rangée dans product_searches. La colonne reste dans la base, toujours vide.
    name: "thumbnail_url: <valeur>",
    pattern: /thumbnail_url["'`]?\s*:(?!\s*null\b)/,
    why: "adresse d'une image de plateforme écrite dans la base (la colonne reste, toujours à null)",
  },
];

/** Lignes précises qui ressemblent à un interdit sans en être un. Chaque
 * entrée dit pourquoi ; une entrée devenue inutile fait échouer le test. */
const ALLOWED_LINES: readonly { file: string; name: string; line: string; why: string }[] = [
  {
    file: "apps/backend/src/lib/exportText.ts",
    name: "thumbnail_url: <valeur>",
    line: 'thumbnail_url: shown("Image de la vidéo", "Video image"),',
    why: "libellé de la colonne dans l'export des données (droit d'accès) : rien n'est écrit dans la base",
  },
];

/** Exception PROVISOIRE : le lecteur intégré de l'app (coupé : LINK_PLAYER_ENABLED
 * vaut false, lib/spot-flags.ts) n'a pas été touché par le retrait de la voie
 * « couverture » : il est repris juste après, dans la même mission « liens
 * vidéo ». Son fichier nomme encore les hébergeurs que la vue web du lecteur
 * officiel a le droit de charger, et l'oEmbed de TikTok. À VIDER quand le
 * lecteur est repris : une entrée devenue inutile fait échouer le test. */
const PLAYER_PENDING: Readonly<Record<string, readonly string[]>> = {
  "apps/mobile/src/lib/player-link.ts": ["tiktokcdn", "cdninstagram", "fbcdn", "tiktok.com/oembed"],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return SOURCE_FILE.test(name) ? [path] : [];
  });
}

/** Chemin depuis la racine du dépôt, avec des « / » sur toutes les machines. */
function repoPath(file: string): string {
  return relative(REPO, file).split("\\").join("/");
}

interface Hit {
  file: string;
  line: number;
  name: string;
  text: string;
}

/** Tout ce qu'un texte contient d'interdit, ligne par ligne. */
function forbiddenIn(file: string, source: string): Hit[] {
  return source.split("\n").flatMap((text, index) =>
    FORBIDDEN.filter((rule) => rule.pattern.test(text)).map((rule) => ({ file, line: index + 1, name: rule.name, text: text.trim() }))
  );
}

function isAllowed(hit: Hit): boolean {
  if (PLAYER_PENDING[hit.file]?.includes(hit.name)) return true;
  return ALLOWED_LINES.some((allowed) => allowed.file === hit.file && allowed.name === hit.name && allowed.line === hit.text);
}

const scanned = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(REPO, dir)))
  .map((file) => ({ file: repoPath(file), source: readFileSync(file, "utf8") }))
  .filter(({ file }) => !EXCLUDED_DIRS.some((excluded) => file.startsWith(excluded)));
const hits = scanned.flatMap(({ file, source }) => forbiddenIn(file, source));

describe("aucune image, vignette ni vidéo de TikTok ou d'Instagram : le code n'en garde aucune trace", () => {
  it("le test lit bien le code du serveur, de l'app et des types partagés (hors textes juridiques)", () => {
    for (const dir of SCANNED_DIRS) expect(scanned.filter(({ file }) => file.startsWith(`${dir}/`)).length, dir).toBeGreaterThan(0);
    expect(scanned.length).toBeGreaterThan(250);
    expect(scanned.map(({ file }) => file)).toEqual(expect.arrayContaining(["apps/backend/src/routes/searches.ts", "apps/mobile/src/lib/spot-flow.ts", "packages/shared-types/src/index.ts"]));
    expect(scanned.some(({ file }) => file.startsWith("apps/mobile/src/legal/"))).toBe(false);
  });

  it("le repérage fonctionne : chaque interdit est reconnu, et ce qui est permis ne l'est pas", () => {
    const names = (text: string) => forbiddenIn("exemple.ts", text).map((hit) => hit.name);
    expect(names('const HOSTS = ["p16-sign.tiktokcdn-eu.com"];')).toEqual(["tiktokcdn"]);
    expect(names("// scontent.cdninstagram.com, static.xx.fbcdn.net")).toEqual(["cdninstagram", "fbcdn"]);
    expect(names("const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;")).toEqual(["tiktok.com/oembed"]);
    expect(names("source = await downloadThumbnail(row.thumbnail_url);")).toEqual(["downloadThumbnail"]);
    expect(names("if (env.LINK_PREVIEW_ENABLED) {}")).toEqual(["LINK_PREVIEW_ENABLED"]);
    expect(names("export const LINK_COVER_ENABLED = false;")).toEqual(["LINK_COVER_ENABLED"]);
    expect(names("thumbnail_url: thumbnail?.thumbnailUrl ?? null,")).toEqual(["thumbnail_url: <valeur>"]);
    expect(names('"thumbnail_url": preview.url,')).toEqual(["thumbnail_url: <valeur>"]);
    expect(names("thumbnail_url:cover,")).toEqual(["thumbnail_url: <valeur>"]);
    // Permis : la colonne laissée vide, et l'oEmbed de Meta pour le code d'intégration.
    expect(names("thumbnail_url: null,")).toEqual([]);
    expect(names("thumbnail_url:  null }")).toEqual([]);
    expect(names("const endpoint = `https://graph.facebook.com/v26.0/instagram_oembed?url=${url}`;")).toEqual([]);
    expect(names('const canonical = "https://www.tiktok.com/@exemple/video/7554393000504266014";')).toEqual([]);
  });

  it("aucun fichier du serveur, de l'app ni des types partagés ne nomme un hébergeur d'images de TikTok ou de Meta, l'oEmbed de TikTok, le téléchargement d'une vignette, les anciens interrupteurs, ni n'écrit une adresse de vignette dans la base", () => {
    const found = hits.filter((hit) => !isAllowed(hit)).map((hit) => `${hit.file}:${hit.line} — ${hit.name} (${FORBIDDEN.find((rule) => rule.name === hit.name)!.why}) : ${hit.text.slice(0, 120)}`);
    expect(found).toEqual([]);
  });

  it("chaque exception sert encore : une exception devenue inutile doit être retirée de ce fichier", () => {
    const unused: string[] = [];
    for (const allowed of ALLOWED_LINES) {
      if (!hits.some((hit) => hit.file === allowed.file && hit.name === allowed.name && hit.text === allowed.line)) unused.push(`${allowed.file} — ${allowed.name}`);
    }
    for (const [file, names] of Object.entries(PLAYER_PENDING)) {
      for (const name of names) if (!hits.some((hit) => hit.file === file && hit.name === name)) unused.push(`${file} — ${name}`);
    }
    expect(unused).toEqual([]);
  });
});
