// Logique pure : réglages, secret, adresses (SSRF), choix du format, erreurs
// de yt-dlp, découpe JPEG, choix des images. Ni réseau, ni programme lancé.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthorizer, readConfig } from "../src/config.js";
import { ERROR_CODES, ERROR_STATUS, LIMITS } from "../src/contract.js";
import { classifyFfmpegError, decodePlan, ffmpegArgs, parseDurationLine, parseShowinfoLine } from "../src/ffmpeg.js";
import { buildBody } from "../src/job.js";
import { splitJpegStream } from "../src/jpeg.js";
import { MIN_SHARPNESS, scoreFrame, selectFrames } from "../src/selection.js";
import { acceptedVideoUrl, isAcceptableMediaUrl, isPublicDomainName } from "../src/urls.js";
import { DOWNLOAD_FALLBACK_FORMATS, chooseFormat, classifyYtDlpError, downloadError, videoInfoFrom, ytDlpArgs, ytDlpDownloadArgs } from "../src/ytdlp.js";

const LONG_SECRET = "a".repeat(32);

describe("contrat : codes d'erreur et statuts HTTP", () => {
  it("chaque code a le statut documenté", () => {
    assert.deepEqual(ERROR_STATUS, {
      bad_request: 400,
      unauthorized: 401,
      private: 404,
      not_found: 404,
      too_long: 413,
      unsupported: 422,
      blocked: 451,
      unavailable: 502,
      busy: 503,
      timeout: 504,
    });
    assert.equal(ERROR_CODES.length, 10);
  });

  it("limites du contrat", () => {
    assert.equal(LIMITS.maxVideoSeconds, 90);
    assert.equal(LIMITS.requestDeadlineMs, 25_000);
    assert.equal(LIMITS.maxConcurrentJobs, 2);
    assert.equal(LIMITS.minFrames, 6);
    assert.equal(LIMITS.maxFrames, 16);
    assert.equal(LIMITS.maxFrameEdge, 1280);
    // Retours du build 2 : images moins compressées, total relevé ; en base64 (+ un peu de JSON), sous les 16 Mio que lit le serveur.
    assert.equal(LIMITS.jpegQscale, 2);
    assert.equal(LIMITS.maxTotalFrameBytes, 11_000_000);
    assert.ok(Math.ceil(LIMITS.maxTotalFrameBytes / 3) * 4 + 64 * 1024 < 16 * 1024 * 1024);
    assert.ok(LIMITS.maxFrameBytes <= 1024 * 1024);
  });
});

describe("réglages et secret", () => {
  it("secret absent, trop court ou avec espace : refusé (fermé par défaut), sans jamais citer la valeur", () => {
    for (const value of [undefined, "", "court", "a".repeat(31), `${"a".repeat(31)} b`, "é".repeat(40)]) {
      const config = readConfig({ VIDEO_WORKER_SECRET: value });
      assert.equal(config.secret, null);
      assert.equal(config.problems.length, 1);
      if (value) assert.ok(!config.problems[0].includes(value));
    }
    assert.equal(readConfig({ VIDEO_WORKER_SECRET: LONG_SECRET }).secret, LONG_SECRET);
  });

  it("espaces et retour à la ligne autour du secret retirés, comme sur le serveur principal (env.ts)", () => {
    for (const value of [` ${LONG_SECRET}`, `${LONG_SECRET} `, `${LONG_SECRET}\n`, `\t ${LONG_SECRET}\r\n`]) {
      const config = readConfig({ VIDEO_WORKER_SECRET: value });
      assert.equal(config.secret, LONG_SECRET);
      assert.deepEqual(config.problems, []);
      // Le serveur envoie la valeur nettoyée : elle est acceptée.
      assert.equal(createAuthorizer(config.secret)(`Bearer ${LONG_SECRET}`), true);
    }
    // Seulement des espaces : « absent » ; espace au milieu ou trop court une fois nettoyé : refusé.
    assert.match(readConfig({ VIDEO_WORKER_SECRET: "   \n" }).problems[0], /absent/);
    for (const value of [` ${"a".repeat(16)} ${"a".repeat(16)} `, ` ${"a".repeat(31)} `, `${"a".repeat(512)}b `]) {
      const config = readConfig({ VIDEO_WORKER_SECRET: value });
      assert.equal(config.secret, null);
      assert.match(config.problems[0], /forme invalide/);
    }
    assert.equal(readConfig({ VIDEO_WORKER_SECRET: ` ${"a".repeat(512)} ` }).secret, "a".repeat(512));
  });

  it("port : 10000 par défaut, PORT sinon, valeur invalide signalée", () => {
    assert.equal(readConfig({ VIDEO_WORKER_SECRET: LONG_SECRET }).port, 10000);
    assert.equal(readConfig({ VIDEO_WORKER_SECRET: LONG_SECRET, PORT: "8080" }).port, 8080);
    const bad = readConfig({ VIDEO_WORKER_SECRET: LONG_SECRET, PORT: "80a" });
    assert.equal(bad.port, 10000);
    assert.equal(bad.problems.length, 1);
  });

  it("vérification du secret : Bearer exact seulement ; sans secret, tout est refusé", () => {
    const authorize = createAuthorizer(LONG_SECRET);
    assert.equal(authorize(`Bearer ${LONG_SECRET}`), true);
    assert.equal(authorize(`Bearer ${LONG_SECRET}x`), false);
    assert.equal(authorize(`bearer ${LONG_SECRET}`), false);
    assert.equal(authorize(LONG_SECRET), false);
    assert.equal(authorize(`Bearer  ${LONG_SECRET}`), false);
    assert.equal(authorize(undefined), false);
    assert.equal(authorize(""), false);
    const closed = createAuthorizer(null);
    assert.equal(closed("Bearer "), false);
    assert.equal(closed(`Bearer ${LONG_SECRET}`), false);
  });
});

describe("adresses acceptées (SSRF)", () => {
  it("pages https de TikTok et d'Instagram seulement, plateforme cohérente", () => {
    assert.equal(acceptedVideoUrl("https://www.tiktok.com/@exemple/video/7554393000504266014", "tiktok"), "https://www.tiktok.com/@exemple/video/7554393000504266014");
    assert.equal(acceptedVideoUrl("https://www.tiktok.com/@/photo/7554393000504266014", "tiktok"), "https://www.tiktok.com/@/photo/7554393000504266014");
    assert.equal(acceptedVideoUrl("https://vm.tiktok.com/ZMabc123/", "tiktok"), "https://vm.tiktok.com/ZMabc123/");
    assert.equal(acceptedVideoUrl("https://www.instagram.com/reel/Cabc_12-x/", "instagram"), "https://www.instagram.com/reel/Cabc_12-x/");
    assert.equal(acceptedVideoUrl("https://www.TikTok.com/@exemple/video/1234567", "tiktok"), "https://www.tiktok.com/@exemple/video/1234567");
  });

  it("refus : http, autre hôte, sous-domaine inconnu, identifiants, port, paramètres, fragment, IP, mauvaise plateforme, chemin douteux", () => {
    const refused = [
      ["http://www.tiktok.com/@a/video/1234567", "tiktok"],
      ["https://www.tiktok.com.evil.test/@a/video/1234567", "tiktok"],
      ["https://evil.test/www.tiktok.com/@a/video/1234567", "tiktok"],
      ["https://api.tiktok.com/@a/video/1234567", "tiktok"],
      ["https://user:pass@www.tiktok.com/@a/video/1234567", "tiktok"],
      ["https://www.tiktok.com:8443/@a/video/1234567", "tiktok"],
      ["https://www.tiktok.com/@a/video/1234567?x=1", "tiktok"],
      ["https://www.tiktok.com/@a/video/1234567#x", "tiktok"],
      ["https://127.0.0.1/@a/video/1234567", "tiktok"],
      ["https://www.instagram.com/reel/Cabc/", "tiktok"],
      ["https://www.tiktok.com/@a/video/1234567", "instagram"],
      ["https://www.tiktok.com/@a/video/1234567", "youtube"],
      ["https://www.tiktok.com/@a/../../admin", "tiktok"],
      ["https://www.tiktok.com/@a/video/%2e%2e", "tiktok"],
      ["https://www.tiktok.com/", "tiktok"],
      ["https://www.tiktok.com/@a/video/1234567 ", "tiktok"],
      ["https://www.tiktok.com/@a\\video", "tiktok"],
      ["file:///etc/passwd", "tiktok"],
      [`https://www.tiktok.com/@a/video/${"1".repeat(3000)}`, "tiktok"],
      ["https://www.tiktok.com/@exemple", "tiktok"],
      ["https://www.tiktok.com/search/video/1234567", "tiktok"],
      ["https://vm.tiktok.com/ZM/abc/", "tiktok"],
      ["https://www.instagram.com/exemple/", "instagram"],
      ["https://www.instagram.com/explore/tags/mode/", "instagram"],
    ];
    for (const [url, platform] of refused) assert.equal(acceptedVideoUrl(url, platform), null, url);
    assert.equal(acceptedVideoUrl(42, "tiktok"), null);
    assert.equal(acceptedVideoUrl("https://www.tiktok.com/@a/video/1", { toString: () => "tiktok" }), null);
  });

  it("adresse du fichier vidéo : https sur un nom de domaine public seulement", () => {
    assert.equal(isAcceptableMediaUrl("https://media.example-cdn.test/v.mp4?sig=abc&expire=1"), true);
    for (const url of [
      "http://media.example-cdn.test/v.mp4",
      "https://10.0.0.5/v.mp4",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/v.mp4",
      "https://autre-service/v.mp4",
      "https://autre-service:10000/v.mp4",
      "https://media.example-cdn.test:8443/v.mp4",
      "https://x.internal/v.mp4",
      "https://localhost/v.mp4",
      "https://user:pw@media.example-cdn.test/v.mp4",
      "file:///etc/passwd",
      "https://media.example-cdn.123/v.mp4",
    ]) {
      assert.equal(isAcceptableMediaUrl(url), false, url);
    }
    assert.equal(isPublicDomainName("a.b.local"), false);
    assert.equal(isPublicDomainName("v16-webapp.example.com"), true);
  });
});

describe("yt-dlp : arguments, format choisi, erreurs", () => {
  it("rien sur le disque : -J, sans cache ni fichier partiel ni réglage lu, adresse après « -- »", () => {
    const args = ytDlpArgs("https://www.tiktok.com/@a/video/1234567");
    for (const flag of ["--dump-single-json", "--no-cache-dir", "--no-part", "--ignore-config", "--no-playlist"]) assert.ok(args.includes(flag), flag);
    assert.deepEqual(args.slice(-2), ["--", "https://www.tiktok.com/@a/video/1234567"]);
    for (const forbidden of ["-o", "--output", "--exec", "--cookies", "--write-info-json", "--load-info-json"]) assert.ok(!args.includes(forbidden), forbidden);
  });

  it("H.264 MP4 de 480 à 720 px (le plus grand) avant tout le reste ; jamais m3u8, fragments, audio seul, DRM ni http", () => {
    const base = { ext: "mp4", protocol: "https" };
    const info = {
      durationSeconds: 20,
      isLive: false,
      formats: [
        { ...base, format_id: "a", url: "https://c.test/a", vcodec: "none" },
        { ...base, format_id: "hls", url: "https://c.test/v.m3u8", protocol: "m3u8_native", vcodec: "avc1", width: 720, height: 1280 },
        { ...base, format_id: "frag", url: "https://c.test/f", vcodec: "avc1", width: 720, height: 1280, fragments: [{}] },
        { ...base, format_id: "drm", url: "https://c.test/d", vcodec: "avc1", width: 720, height: 1280, has_drm: true },
        { ...base, format_id: "plain", url: "http://c.test/p", vcodec: "avc1", width: 720, height: 1280 },
        { ...base, format_id: "hevc720", url: "https://c.test/h", vcodec: "h265", width: 720, height: 1280 },
        { ...base, format_id: "h264_480", url: "https://c.test/480", vcodec: "h264", width: 480, height: 854 },
        { ...base, format_id: "h264_720", url: "https://c.test/720", vcodec: "avc1.64001f", width: 720, height: 1280, fps: 30 },
        { ...base, format_id: "h264_1080", url: "https://c.test/1080", vcodec: "h264", width: 1080, height: 1920 },
        { ...base, format_id: "h264_4k", url: "https://c.test/4k", vcodec: "h264", width: 2160, height: 3840 },
        { ...base, format_id: "bytevc2_720p", url: "https://c.test/vvc", vcodec: "bytevc2", width: 720, height: 1280, format_note: "UNPLAYABLE" },
      ],
    };
    assert.equal(chooseFormat(info)?.url, "https://c.test/720");
    assert.equal(chooseFormat(info)?.fps, 30);
    // Sans format dans la plage : H.264 le plus proche de 720 px, puis H.265.
    const near = { ...info, formats: info.formats.filter((f) => !["h264_720", "h264_480", "hevc720"].includes(f.format_id)) };
    assert.equal(chooseFormat(near)?.url, "https://c.test/1080");
    assert.equal(chooseFormat({ ...info, formats: [info.formats[0], info.formats[1], info.formats[5]] })?.url, "https://c.test/h");
    assert.equal(chooseFormat({ ...info, formats: [...info.formats.slice(0, 5), info.formats[10]] }), null);
    // À même taille, la piste vidéo seule (moins lourde).
    const pair = { ...info, formats: [{ ...base, url: "https://c.test/av", vcodec: "avc1", acodec: "aac", width: 720, height: 1280 }, { ...base, url: "https://c.test/v", vcodec: "avc1", acodec: "none", width: 720, height: 1280 }] };
    assert.equal(chooseFormat(pair)?.url, "https://c.test/v");
  });

  it("téléchargement : le format choisi puis les formats de secours, sur la sortie standard, plafonné, adresse après « -- »", () => {
    const url = "https://www.tiktok.com/@a/video/1234567";
    const args = ytDlpDownloadArgs(url, "h264_540p_123-0");
    const at = (/** @type {string} */ flag) => args[args.indexOf(flag) + 1];
    assert.equal(at("--format"), `h264_540p_123-0/${DOWNLOAD_FALLBACK_FORMATS}`);
    assert.equal(at("--output"), "-");
    assert.equal(at("--max-filesize"), String(LIMITS.maxMediaBytes));
    for (const flag of ["--no-cache-dir", "--no-part", "--ignore-config", "--no-playlist"]) assert.ok(args.includes(flag), flag);
    assert.deepEqual(args.slice(-2), ["--", url]);
    for (const forbidden of ["--exec", "--cookies", "--cookies-from-browser", "--write-info-json", "--load-info-json", "--paths"]) assert.ok(!args.includes(forbidden), forbidden);
    // Identifiant absent ou douteux : formats de secours seulement (jamais un texte reçu dans « -f »).
    assert.equal(ytDlpDownloadArgs(url, null)[ytDlpDownloadArgs(url, null).indexOf("--format") + 1], DOWNLOAD_FALLBACK_FORMATS);
    const odd = ytDlpDownloadArgs(url, "a/b+c,d e");
    assert.equal(odd[odd.indexOf("--format") + 1], DOWNLOAD_FALLBACK_FORMATS);
    // Jamais le codec maison illisible de TikTok, même en secours.
    assert.ok(!DOWNLOAD_FALLBACK_FORMATS.includes("bytevc2"));
    assert.ok(DOWNLOAD_FALLBACK_FORMATS.split("/").every((selector) => selector.includes("ext=mp4") && selector.includes("[protocol=https]") && /vcodec\^=(?:avc|h264)/.test(selector)));
    // Hors carrousel : pas de « --playlist-items ».
    assert.ok(!args.includes("--playlist-items"));
  });

  it("second essai après un refus : un autre fichier H.264 d'abord, le format refusé en dernier", () => {
    const url = "https://www.tiktok.com/@a/video/1234567";
    const args = ytDlpDownloadArgs(url, "h264_540p_829-0", null, { avoidFormat: true });
    const selector = args[args.indexOf("--format") + 1].split("/");
    assert.deepEqual(selector, [
      "best[ext=mp4][vcodec^=h264][protocol=https][format_id!=h264_540p_829-0][height<=1280]",
      "best[ext=mp4][vcodec^=avc][protocol=https][format_id!=h264_540p_829-0][height<=1280]",
      "best[ext=mp4][vcodec^=h264][protocol=https][format_id!=h264_540p_829-0]",
      "best[ext=mp4][vcodec^=avc][protocol=https][format_id!=h264_540p_829-0]",
      "h264_540p_829-0",
    ]);
    // Identifiant absent ou douteux : formats de secours seulement, comme au premier essai.
    const none = ytDlpDownloadArgs(url, null, null, { avoidFormat: true });
    assert.equal(none[none.indexOf("--format") + 1], DOWNLOAD_FALLBACK_FORMATS);
    const odd = ytDlpDownloadArgs(url, "a]b[c", null, { avoidFormat: true });
    assert.equal(odd[odd.indexOf("--format") + 1], DOWNLOAD_FALLBACK_FORMATS);
  });

  it("carrousel : seule l'entrée choisie est téléchargée (« --playlist-items »)", () => {
    const url = "https://www.instagram.com/p/ABCDE12345/";
    const args = ytDlpDownloadArgs(url, "1080v", 3);
    assert.equal(args[args.indexOf("--playlist-items") + 1], "3");
    for (const bad of [0, -1, 1.5, null]) assert.ok(!ytDlpDownloadArgs(url, "1080v", /** @type {any} */ (bad)).includes("--playlist-items"), String(bad));
    // Numéro de l'entrée : celui donné par yt-dlp, sinon la place dans la liste.
    assert.equal(videoInfoFrom({ _type: "playlist", entries: [{ formats: [{ url: "https://c.test/i.jpg", vcodec: "none" }] }, { formats: [{ url: "https://c.test/v.mp4", vcodec: "avc1" }] }] })?.playlistIndex, 2);
    assert.equal(videoInfoFrom({ _type: "playlist", entries: [{ playlist_index: 4, formats: [{ url: "https://c.test/v.mp4", vcodec: "avc1" }] }] })?.playlistIndex, 4);
    assert.equal(videoInfoFrom({ formats: [{ url: "https://c.test/v.mp4", vcodec: "avc1" }] })?.playlistIndex, null);
  });

  it("échecs du téléchargement : 403 → blocked, 404 et format manquant → unavailable (jamais not_found)", () => {
    const pairs = [
      ["ERROR: unable to download video data: HTTP Error 403: Forbidden", "blocked", "media_forbidden"],
      ["ERROR: unable to download video data: HTTP Error 404: Not Found", "unavailable", "media_not_found"],
      ["ERROR: [TikTok] 1: Requested format is not available. Use --list-formats for a list of available formats", "unavailable", "format_unavailable"],
      ["ERROR: [TikTok] 1: Unable to extract universal data for rehydration", "unavailable", "download_extractor_failed"],
      ["ERROR: [TikTok] 1: Your IP address is blocked from accessing this post", "blocked", "ip_blocked"],
    ];
    for (const [stderr, code, detail] of pairs) {
      const error = downloadError(stderr);
      assert.equal(error.code, code, stderr);
      assert.equal(error.detail, detail, stderr);
    }
  });

  it("format choisi : son identifiant est repris s'il est sûr", () => {
    const info = { durationSeconds: 10, isLive: false, formats: [{ format_id: "h264_720p", url: "https://c.test/720", ext: "mp4", protocol: "https", vcodec: "h264", width: 720, height: 1280 }] };
    assert.equal(chooseFormat(info)?.formatId, "h264_720p");
    assert.equal(chooseFormat({ ...info, formats: [{ ...info.formats[0], format_id: "x;rm -rf" }] })?.formatId, null);
    assert.equal(chooseFormat({ ...info, formats: [{ ...info.formats[0], format_id: undefined }] })?.formatId, null);
  });

  it("carrousel : la première entrée qui contient une vidéo ; direct signalé", () => {
    const info = videoInfoFrom({ _type: "playlist", entries: [{ formats: [{ url: "https://c.test/i.jpg", vcodec: "none" }] }, { duration: 12, formats: [{ url: "https://c.test/v.mp4", vcodec: "avc1" }] }] });
    assert.equal(info?.durationSeconds, 12);
    assert.equal(info?.formats.length, 1);
    assert.equal(videoInfoFrom({ is_live: true, formats: [] })?.isLive, true);
    assert.equal(videoInfoFrom([]), null);
  });

  it("messages de yt-dlp → codes du contrat", () => {
    const cases = [
      ["ERROR: [TikTok] 1: This video is private", "private"],
      // Messages exacts de yt-dlp 2026.10.26 (extracteurs tiktok.py et instagram.py).
      ["ERROR: [TikTok] 1: You do not have permission to view this post. Log into an account that has access. Use --cookies-from-browser or --cookies for the authentication", "private"],
      ["ERROR: [Instagram] x: This content is only available for registered users who follow this account. Use --cookies", "private"],
      ["ERROR: [Instagram] x: Restricted Video: You must be 18 years old or over to see this video", "private"],
      ["ERROR: [TikTok] 1: TikTok is requiring login for access to this content", "blocked"],
      ["ERROR: [Instagram] x: The webpage request was redirected to the login page. You have exceeded the rate-limit for accessing posts anonymously", "blocked"],
      ["ERROR: [Instagram] x: There is no video in this post", "unsupported"],
      ["ERROR: [Instagram] x: Post isn't available: The link may be broken, or the post may have been removed.", "not_found"],
      ["ERROR: [TikTok] 1: This video is not available from your location due to geo restriction", "blocked"],
      ["ERROR: [TikTok] 1: Unable to solve JS challenge", "unavailable"],
      ["ERROR: [TikTok] 1: Video unavailable (status code 10222)", "private"],
      ["ERROR: [TikTok] 1: This post may not be comfortable for some audiences. Log in for access", "private"],
      ["ERROR: [TikTok] 1: Your IP address is blocked from accessing this post", "blocked"],
      ["ERROR: [TikTok] 1: Video not available, status code 10204", "blocked"],
      ["ERROR: [TikTok] 1: The uploader has not made this video available in your country", "blocked"],
      ["ERROR: [Instagram] x: You have exceeded the rate-limit for accessing posts anonymously", "blocked"],
      ["ERROR: [Instagram] x: Main webpage is locked behind the login page", "blocked"],
      ["ERROR: [Instagram] x: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use --cookies-from-browser or --cookies for the authentication", "blocked"],
      ["ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 403: Forbidden", "blocked"],
      ["ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 404: Not Found", "not_found"],
      ["ERROR: [TikTok] 1: Video not available, status code 10231", "not_found"],
      ["ERROR: [Instagram] x: This video has been removed", "not_found"],
      ["ERROR: Unsupported URL: https://www.tiktok.com/@a", "unsupported"],
      ["ERROR: [TikTok] 1: No video formats found!", "unsupported"],
      ["ERROR: [TikTok] 1: Unable to extract universal data for rehydration", "unavailable"],
      ["ERROR: [TikTok] 1: Unable to download webpage: HTTP Error 502: Bad Gateway", "unavailable"],
      ["Traceback (most recent call last): …", "unavailable"],
    ];
    for (const [stderr, code] of cases) assert.equal(classifyYtDlpError(stderr).code, code, stderr);
    // Seules les lignes « ERROR: » comptent quand il y en a.
    assert.equal(classifyYtDlpError("WARNING: private cookies ignored\nERROR: [TikTok] 1: Unable to extract universal data").code, "unavailable");
  });
});

describe("ffmpeg : arguments et lecture de sa sortie d'erreur", () => {
  const input = { url: "http://127.0.0.1:45678/0123456789abcdef0123456789abcdef.mp4", protocolWhitelist: "http,tcp" };

  it("le fichier en mémoire sur la boucle locale, MP4 imposé, aucune sortie dans un fichier (pipe:1 et pipe:3)", () => {
    const args = ffmpegArgs({ input, mode: "full", stepSeconds: 0.75 });
    const at = (/** @type {string} */ flag) => args[args.indexOf(flag) + 1];
    assert.equal(at("-protocol_whitelist"), "http,tcp");
    assert.equal(at("-f"), "mp4");
    assert.equal(at("-i"), input.url);
    assert.equal(at("-t"), "91");
    // Retours du build 2 : moins de compression (avant : 4).
    assert.equal(at("-q:v"), "2");
    assert.ok(args.includes("-nostdin"));
    assert.ok(args.includes("-rw_timeout"));
    assert.ok(!args.includes("-skip_frame"));
    // ffmpeg ne parle plus jamais aux serveurs de TikTok ou d'Instagram : ni en-têtes ni cookies.
    for (const flag of ["-user_agent", "-referer", "-headers", "-cookies", "-tls_verify", "-ca_file"]) assert.ok(!args.includes(flag), flag);
    assert.ok(at("-filter_complex").includes("gte(t-prev_selected_t,0.75)"));
    assert.ok(at("-filter_complex").includes("min(1280,iw)"));
    // Les deux seules sorties sont des tuyaux ; rien d'autre ne ressemble à un fichier.
    const outputs = args.filter((arg) => /^pipe:|^\/|\.(?:jpe?g|png)$/i.test(arg));
    assert.deepEqual(outputs, ["pipe:1", "pipe:3"]);
    assert.ok(!args.includes("-y"));
    const keyframes = ffmpegArgs({ input, mode: "keyframes", stepSeconds: 2 });
    assert.equal(keyframes[keyframes.indexOf("-skip_frame") + 1], "nokey");
    // Entrée standard (tests) : pas de délai réseau.
    assert.ok(!ffmpegArgs({ input: { url: "pipe:0", protocolWhitelist: "pipe" }, mode: "full", stepSeconds: 1 }).includes("-rw_timeout"));
  });

  it("décodage complet pour une vidéo courte, images clés au-delà de ≈ 45 s, durée inconnue : images clés", () => {
    assert.deepEqual(decodePlan(8, 30), { mode: "full", stepSeconds: 0.5 });
    assert.deepEqual(decodePlan(30, 30), { mode: "full", stepSeconds: 0.75 });
    assert.deepEqual(decodePlan(80, 30), { mode: "keyframes", stepSeconds: 2 });
    assert.deepEqual(decodePlan(40, 60), { mode: "keyframes", stepSeconds: 1 });
    assert.deepEqual(decodePlan(null, null), { mode: "keyframes", stepSeconds: 2.25 });
  });

  it("lignes Duration et showinfo ; erreurs du serveur du fichier", () => {
    assert.equal(parseDurationLine("  Duration: 00:01:02.50, start: 0.000000, bitrate: 1500 kb/s"), 62.5);
    assert.equal(parseDurationLine("  Duration: N/A, start: 0.000000"), null);
    assert.equal(parseShowinfoLine("[Parsed_showinfo_1 @ 0x55] n:   3 pts:  23040 pts_time:1.5     duration:    512"), 1.5);
    assert.equal(parseShowinfoLine("[Parsed_showinfo_1 @ 0x55] config in time_base: 1/15360, frame_rate: 30/1"), null);
    assert.equal(classifyFfmpegError("Server returned 403 Forbidden (access denied)").code, "blocked");
    assert.equal(classifyFfmpegError("Protocol 'file' not on whitelist 'https,tls,tcp'!").detail, "media_protocol_refused");
    assert.equal(classifyFfmpegError("moov atom not found").code, "unavailable");
  });
});

describe("découpe du flux JPEG", () => {
  /** JPEG minimal (structure seulement) : SOI, SOF0 (taille), SOS, données, EOI. */
  function fakeJpeg(/** @type {number} */ width, /** @type {number} */ height, /** @type {number[]} */ data = [0x12, 0xff, 0x00, 0x34]) {
    const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
    const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
    // Un commentaire qui contient FF D9 : ne doit pas couper l'image.
    const com = [0xff, 0xfe, 0x00, 0x06, 0xff, 0xd9, 0xff, 0xd9];
    return Buffer.from([0xff, 0xd8, ...com, ...sof, ...sos, ...data, 0xff, 0xd9]);
  }

  it("images complètes, dans l'ordre, avec leur taille ; une image tronquée ou des octets parasites sont ignorés", () => {
    const a = fakeJpeg(720, 1280);
    const b = fakeJpeg(1280, 720, [0x01, 0xff, 0xd0, 0x02]);
    const truncated = fakeJpeg(10, 10).subarray(0, 20);
    const images = splitJpegStream(Buffer.concat([Buffer.from("parasite"), a, b, truncated]));
    assert.equal(images.length, 2);
    assert.deepEqual(
      images.map((image) => [image.width, image.height, image.data.length]),
      [
        [720, 1280, a.length],
        [1280, 720, b.length],
      ]
    );
    assert.deepEqual(splitJpegStream(Buffer.from("rien")), []);
  });
});

describe("choix des images", () => {
  /** Petite image unie, ou à damier (nette) de couleur `hue`. */
  function pixels(/** @type {number} */ hue, /** @type {"sharp" | "flat"} */ kind) {
    const rgb = new Uint8Array(96 * 96 * 3);
    for (let i = 0; i < 96 * 96; i += 1) {
      const x = i % 96;
      const y = Math.floor(i / 96);
      const dark = kind === "sharp" && (x + y) % 2 === 0 ? 0.6 : 1;
      rgb[i * 3] = Math.round(((hue * 37) % 256) * dark);
      rgb[i * 3 + 1] = Math.round(((hue * 91 + 60) % 256) * dark);
      rgb[i * 3 + 2] = Math.round(((hue * 53 + 120) % 256) * dark);
    }
    return rgb;
  }
  const candidate = (/** @type {number} */ timeSeconds, /** @type {number} */ hue, /** @type {"sharp" | "flat"} */ kind = "sharp") => ({ timeSeconds, ...scoreFrame(pixels(hue, kind)) });

  it("mesures : une image à damier est nette, une image unie ne l'est pas", () => {
    assert.ok(scoreFrame(pixels(3, "sharp")).sharpness > 1000);
    assert.ok(scoreFrame(pixels(3, "flat")).sharpness < MIN_SHARPNESS);
    assert.equal(scoreFrame(pixels(3, "flat")).hash.length, 64);
  });

  it("répartition sur toute la vidéo, sans quasi-doublon ni image floue, 12 au plus, dans l'ordre", () => {
    // 40 candidates : un plan toutes les 2, une sur 4 unie (floue).
    const candidates = Array.from({ length: 40 }, (_, i) => candidate(i * 0.75, Math.floor(i / 2), i % 4 === 3 ? "flat" : "sharp"));
    const kept = selectFrames(candidates, { minFrames: 6, maxFrames: 12 });
    assert.equal(kept.length, 12);
    assert.ok(kept.every((frame) => frame.sharpness >= MIN_SHARPNESS));
    const scenes = kept.map((frame) => Math.floor(Math.round(frame.timeSeconds / 0.75) / 2));
    assert.equal(new Set(scenes).size, kept.length);
    for (let i = 1; i < kept.length; i += 1) assert.ok(kept[i].timeSeconds > kept[i - 1].timeSeconds);
    // Répartition : du début à la fin de la vidéo.
    assert.ok(kept[0].timeSeconds < 3);
    assert.ok(kept[kept.length - 1].timeSeconds > 26);
  });

  it("vidéo presque fixe : au moins 6 images, les plus éloignées dans le temps", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(i, 5));
    const kept = selectFrames(candidates, { minFrames: 6, maxFrames: 12 });
    assert.equal(kept.length, 6);
    assert.equal(kept[0].timeSeconds, 0);
    assert.equal(kept[kept.length - 1].timeSeconds, 19);
  });

  it("très courte vidéo : toutes les images s'il y en a moins de 6 ; aucune candidate : rien", () => {
    assert.equal(selectFrames([candidate(0, 1), candidate(0.5, 1), candidate(1, 2)], { minFrames: 6, maxFrames: 12 }).length, 3);
    assert.deepEqual(selectFrames([], { minFrames: 6, maxFrames: 12 }), []);
  });

  it("corps de la réponse : forme du contrat, 16 images au plus pour une longue vidéo, image trop lourde écartée", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const heavy = Buffer.alloc(LIMITS.maxFrameBytes + 1);
    const candidates = Array.from({ length: 40 }, (_, i) => ({ ...candidate(i * 2, i), jpeg: i === 0 ? heavy : jpeg, width: 720, height: 1280 }));
    const stats = /** @type {any} */ ({});
    const body = buildBody(80, { candidates, durationSeconds: 80 }, stats);
    assert.equal(body.durationSeconds, 80);
    assert.equal(body.frames.length, 16);
    assert.ok(body.frames.every((frame) => frame.timeSeconds > 0 && frame.width === 720 && frame.height === 1280 && frame.jpegBase64 === "/9j/2Q=="));
    assert.deepEqual(Object.keys(body.frames[0]).sort(), ["height", "jpegBase64", "timeSeconds", "width"]);
    assert.equal(stats.frames, 16);
    assert.equal(stats.candidates, 40);
  });
});
