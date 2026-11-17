import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Garde-fou (12 novembre 2026, règle du fondateur), revu le 15 novembre 2026
// après sa décision des 14 et 15 novembre (analyse automatique d'un lien).
// Le serveur principal, l'app et les types partagés ne téléchargent toujours
// jamais une vidéo, un fichier, une vignette ou une image d'aperçu depuis
// TikTok ou Instagram, et aucune page n'est aspirée. La voie « couverture »
// (image d'un lien demandée à la plateforme, puis téléchargée chez son
// hébergeur d'images) a été retirée le 12 novembre ; elle est archivée sur la
// branche archive/couverture-oembed. Ce test lit le code du serveur, de l'app
// et des types partagés, et échoue si l'une de ses traces revient. Sans base,
// sans réseau.
//
// SEULE EXCEPTION, voulue par le fondateur (14 et 15 novembre 2026) : le
// service vidéo séparé, apps/video-worker (service privé chez Render), qui
// récupère la vidéo publique d'un lien sans la garder et n'en renvoie que
// quelques images. Il n'est pas lu ici : il a ses propres garde-fous. Le
// serveur principal (apps/backend/src) est lu en entier, et il lui est en
// plus interdit de nommer un outil de téléchargement ou de décodage de vidéos
// ou de lancer un programme (BACKEND_ONLY) : il ne fait que demander des
// images au service vidéo (lib/videoWorker.ts).
//
// Non lus : ce fichier (il doit bien nommer ce qu'il interdit) et
// apps/mobile/src/legal/ (textes juridiques publiés).
// Le mot « instagram_oembed » n'est PAS interdit : le seul appel oEmbed admis
// est celui de Meta, par le serveur, pour obtenir le code d'intégration
// officiel (jamais une image).
// Le lecteur intégré de l'app (mission « liens vidéo ») a été repris : il ne
// nomme plus aucun hébergeur de fichiers ni l'oEmbed de TikTok (l'exception
// provisoire qui le couvrait a été retirée, aucune autre ne l'a remplacée).
const REPO = join(__dirname, "../../..");
const SCANNED_DIRS = ["apps/backend/src", "apps/mobile/src", "packages/shared-types/src"] as const;
const EXCLUDED_DIRS = ["apps/mobile/src/legal/"] as const;
/** Le service vidéo séparé : la seule exception, jamais lue ici. */
const VIDEO_WORKER_DIR = "apps/video-worker";
/** Dossier des interdits propres au serveur principal (BACKEND_ONLY). */
const BACKEND_DIR = "apps/backend/src/";
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/;

interface Forbidden {
  /** Nom court, pour le message et les exceptions. */
  name: string;
  pattern: RegExp;
  why: string;
  /** Seulement dans ce dossier (sinon partout où le test lit). */
  onlyIn?: string;
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
  // BACKEND_ONLY : depuis le 15 novembre 2026, seul le service vidéo séparé
  // télécharge et décode une vidéo ; le serveur principal ne nomme même pas
  // ces outils, et ne lance aucun programme.
  {
    name: "téléchargeur de vidéos",
    pattern: /yt[-_]?dlp|youtube[-_]dl/i,
    why: "outil de téléchargement de vidéos : réservé au service vidéo séparé (apps/video-worker)",
    onlyIn: BACKEND_DIR,
  },
  {
    name: "décodeur de vidéos",
    pattern: /ffmpeg|ffprobe/i,
    why: "décodage d'une vidéo : réservé au service vidéo séparé (apps/video-worker)",
    onlyIn: BACKEND_DIR,
  },
  {
    name: "child_process",
    pattern: /child_process/,
    why: "programme lancé par le serveur principal (téléchargeur, décodeur) : réservé au service vidéo séparé",
    onlyIn: BACKEND_DIR,
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
  const rules = FORBIDDEN.filter((rule) => !rule.onlyIn || file.startsWith(rule.onlyIn));
  return source.split("\n").flatMap((text, index) =>
    rules.filter((rule) => rule.pattern.test(text)).map((rule) => ({ file, line: index + 1, name: rule.name, text: text.trim() }))
  );
}

function isAllowed(hit: Hit): boolean {
  return ALLOWED_LINES.some((allowed) => allowed.file === hit.file && allowed.name === hit.name && allowed.line === hit.text);
}

const scanned = SCANNED_DIRS.flatMap((dir) => sourceFiles(join(REPO, dir)))
  .map((file) => ({ file: repoPath(file), source: readFileSync(file, "utf8") }))
  .filter(({ file }) => !EXCLUDED_DIRS.some((excluded) => file.startsWith(excluded)));
const hits = scanned.flatMap(({ file, source }) => forbiddenIn(file, source));

describe("aucune image, vignette ni vidéo de TikTok ou d'Instagram : le code du serveur principal, de l'app et des types partagés n'en garde aucune trace", () => {
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
    // Propres au serveur principal : un téléchargeur, un décodeur, un programme lancé.
    const backend = (text: string) => forbiddenIn(`${BACKEND_DIR}lib/exemple.ts`, text).map((hit) => hit.name);
    expect(backend('spawn("yt-dlp", ["-J", url]);')).toEqual(["téléchargeur de vidéos"]);
    expect(backend("import youtubeDl from \"youtube-dl-exec\";")).toEqual(["téléchargeur de vidéos"]);
    expect(backend("const args = ['-i', input]; // ffmpeg, ffprobe")).toEqual(["décodeur de vidéos"]);
    expect(backend('import { spawn } from "node:child_process";')).toEqual(["child_process"]);
    expect(backend("await fetchVideoFrames(config, { url, platform });")).toEqual([]);
    // Ailleurs (app, types partagés), ces mots-là restent permis (un commentaire peut citer l'outil).
    expect(forbiddenIn("apps/mobile/src/lib/exemple.ts", "// formes relevées par yt-dlp").map((hit) => hit.name)).toEqual([]);
  });

  it("seule exception : le service vidéo séparé (apps/video-worker), jamais lu ici ; le serveur principal, lui, est lu en entier", () => {
    expect(SCANNED_DIRS.some((dir) => dir.startsWith(VIDEO_WORKER_DIR))).toBe(false);
    expect(scanned.some(({ file }) => file.startsWith(`${VIDEO_WORKER_DIR}/`))).toBe(false);
    expect(EXCLUDED_DIRS.some((dir) => dir.startsWith("apps/backend/"))).toBe(false);
    // Le client du service vidéo et la route de l'analyse d'un lien sont bien lus.
    expect(scanned.map(({ file }) => file)).toEqual(expect.arrayContaining(["apps/backend/src/lib/videoWorker.ts", "apps/backend/src/routes/videoLinkAnalysis.ts"]));
  });

  it("aucun fichier du serveur, de l'app ni des types partagés ne nomme un hébergeur d'images de TikTok ou de Meta, l'oEmbed de TikTok, le téléchargement d'une vignette, les anciens interrupteurs, ni n'écrit une adresse de vignette dans la base ; le serveur principal ne nomme ni téléchargeur ni décodeur de vidéos et ne lance aucun programme", () => {
    const found = hits.filter((hit) => !isAllowed(hit)).map((hit) => `${hit.file}:${hit.line} — ${hit.name} (${FORBIDDEN.find((rule) => rule.name === hit.name)!.why}) : ${hit.text.slice(0, 120)}`);
    expect(found).toEqual([]);
  });

  it("chaque exception sert encore : une exception devenue inutile doit être retirée de ce fichier", () => {
    const unused: string[] = [];
    for (const allowed of ALLOWED_LINES) {
      if (!hits.some((hit) => hit.file === allowed.file && hit.name === allowed.name && hit.text === allowed.line)) unused.push(`${allowed.file} — ${allowed.name}`);
    }
    expect(unused).toEqual([]);
  });
});
