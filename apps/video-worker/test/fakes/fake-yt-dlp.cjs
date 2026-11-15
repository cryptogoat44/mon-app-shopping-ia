// Faux yt-dlp : rend un JSON ou une erreur selon le scénario lu dans
// l'adresse (pseudo TikTok « @scenario » ou code Instagram). Jamais de réseau.
"use strict";
const { record, previousCalls, hang } = require("./common.cjs");

const args = process.argv.slice(2);
if (args.includes("--version")) {
  process.stdout.write("2026.10.26\n");
  process.exit(0);
}

const url = args[args.length - 1] ?? "";
const scenario = /\/@([a-z0-9._]+)\//.exec(url)?.[1] ?? /\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)\//.exec(url)?.[1] ?? "unknown";
const calls = previousCalls("yt-dlp", scenario);
record("yt-dlp", args, { scenario });

const CDN = "https://media.example-cdn.test";

/** Formats d'une vidéo, comme yt-dlp les décrit (simplifiés). */
function formats(media, extra = {}) {
  return [
    { format_id: "audio", url: `${CDN}/a.m4a`, ext: "m4a", protocol: "https", vcodec: "none", acodec: "mp4a.40.2" },
    { format_id: "hls-720", url: `${CDN}/v.m3u8`, ext: "mp4", protocol: "m3u8_native", vcodec: "avc1.64001f", width: 720, height: 1280 },
    { format_id: "h264_360p", url: `${CDN}/v360.mp4?s=${media}`, ext: "mp4", protocol: "https", vcodec: "h264", width: 360, height: 640, fps: 30 },
    {
      format_id: "h264_720p",
      url: `${CDN}/v720.mp4?s=${media}`,
      ext: "mp4",
      protocol: "https",
      vcodec: "h264",
      acodec: "aac",
      width: 720,
      height: 1280,
      fps: 30,
      tbr: 1500,
      http_headers: { "User-Agent": "Mozilla/5.0 (essai)", Referer: "https://www.tiktok.com/", Accept: "*/*", Cookie: "jamais=repris", "Bad\nName": "x" },
      cookies: "tt_chain_token=abc123; Domain=.example-cdn.test; Path=/; Secure; Expires=1900000000; sid=xyz; Path=/",
      ...extra,
    },
    { format_id: "bytevc1_1080p", url: `${CDN}/v1080.mp4?s=${media}`, ext: "mp4", protocol: "https", vcodec: "h265", width: 1080, height: 1920, fps: 30 },
  ];
}

function video(duration, media, extra = {}) {
  return { _type: "video", id: "7000000000000000001", extractor: "TikTok", title: "essai", duration, formats: formats(media), ...extra };
}

function out(json) {
  process.stdout.write(JSON.stringify(json));
  process.exit(0);
}

function fail(message) {
  process.stderr.write(`WARNING: [TikTok] un avertissement\nERROR: ${message}\n`);
  process.exit(1);
}

switch (scenario) {
  case "ok30":
    out(video(30, "varied&d=30"));
    break;
  case "ok8":
    out(video(8, "varied&d=8"));
    break;
  case "long80":
    out(video(80, "varied&d=80"));
    break;
  case "static":
    out(video(20, "static&d=20"));
    break;
  case "toolong":
    out(video(120, "varied&d=120"));
    break;
  case "nodur":
    out(video(undefined, "varied&d=120&ffdur=120"));
    break;
  case "bigframes":
    out(video(10, "big&d=10"));
    break;
  case "media403":
    out(video(10, "403&d=10"));
    break;
  case "ffslow":
    out(video(10, "slow&d=10"));
    break;
  case "ffgarbage":
    out(video(10, "garbage&d=10"));
    break;
  case "photo":
    out({ _type: "video", id: "7000000000000000002", duration: 10, formats: [formats("x")[0]] });
    break;
  case "live":
    out(video(30, "varied&d=30", { is_live: true }));
    break;
  case "mediaip":
    out({ _type: "video", duration: 10, formats: [{ format_id: "h264_720p", url: "https://10.0.0.5/v.mp4", ext: "mp4", protocol: "https", vcodec: "h264", width: 720, height: 1280 }] });
    break;
  case "mediainternal":
    out({ _type: "video", duration: 10, formats: [{ format_id: "h264_720p", url: "https://autre-service:10000/v.mp4", ext: "mp4", protocol: "https", vcodec: "h264", width: 720, height: 1280 }] });
    break;
  case "mediahttp":
    out({ _type: "video", duration: 10, formats: [{ format_id: "h264_720p", url: "http://media.example-cdn.test/v.mp4", ext: "mp4", protocol: "http", vcodec: "h264", width: 720, height: 1280 }] });
    break;
  case "scn_carousel":
    out({ _type: "playlist", entries: [{ id: "image", formats: [] }, video(12, "varied&d=12")] });
    break;
  case "private":
    fail("[TikTok] 7000000000000000001: You do not have permission to view this post. Log into an account that has access. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies");
    break;
  case "removed":
    fail("[TikTok] 7000000000000000001: Video not available, status code 10231");
    break;
  case "ipblocked":
    fail("[TikTok] 7000000000000000001: Your IP address is blocked from accessing this post");
    break;
  case "geo":
    fail("[TikTok] 7000000000000000001: This video is not available in your country");
    break;
  case "scn_login":
    fail("[Instagram] scn_login: Requested content is not available, rate-limit reached or login required. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (instagram) to provide account credentials");
    break;
  case "scn_wall":
    fail("[Instagram] scn_wall: Main webpage is locked behind the login page. Use --cookies to authenticate");
    break;
  case "unsupported":
    fail("Unsupported URL: https://www.tiktok.com/@unsupported/video/7000000000000000001");
    break;
  case "broken":
    fail("[TikTok] 7000000000000000001: Unable to extract universal data for rehydration; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues");
    break;
  case "flaky":
    if (calls === 0) fail("[TikTok] 7000000000000000001: Unable to extract universal data for rehydration");
    else out(video(8, "varied&d=8"));
    break;
  case "badjson":
    process.stdout.write("pas du JSON");
    process.exit(0);
    break;
  case "hold":
    setTimeout(() => out(video(8, "varied&d=8")), 1500);
    break;
  case "heavyhold":
    setTimeout(() => out(video(8, "heavy&d=8")), 1500);
    break;
  case "slow":
    hang(60_000);
    break;
  default:
    fail(`[generic] ${scenario}: inconnu du faux yt-dlp`);
}
