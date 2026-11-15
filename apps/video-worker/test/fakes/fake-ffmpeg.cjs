// Faux ffmpeg : écrit des images JPEG (sortie standard), les petites images
// rouge-vert-bleu de 96 × 96 px (descripteur 3) et les lignes « Duration » et
// showinfo (sortie d'erreur), comme le vrai, selon le scénario lu dans
// l'adresse du fichier (« ?s=…&d=… »). Jamais de réseau.
"use strict";
const fs = require("node:fs");
const { record, hang } = require("./common.cjs");

const args = process.argv.slice(2);
if (args.includes("-version")) {
  process.stdout.write("ffmpeg version 7.1.2-0+deb13u1 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with gcc 14\n");
  process.exit(0);
}
record("ffmpeg", args);

/** Petite image JPEG réelle de 72 × 128 px. */
const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgICAkICQsLCwsLCw0MDQ0NDQ0NDQ0NDQ0ODg4REREODg4NDQ4OEBARERITEhERERETExQUFBgYFxccHB0iIin/xABvAAEBAQAAAAAAAAAAAAAAAAAABgUBAQEBAQAAAAAAAAAAAAAAAAAGBQcQAQADAQAAAAAAAAAAAAAAAAAVY+KiEQEAAAAJCgcBAQAAAAAAAAAABhITBREDAQQCgoPDUsJEQzEUFlGjIaLTVNIiMv/AABEIAIAASAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJ0BTNgAAAAAAAAAAAAAAAAAAABVAJRxwAASqqSrWmzi5G0soJb3mdIANVYgAKoBKOOAACVVSVa02cXI2llBLe8zpABqrEABVAJRxwAASqqSrWmzi5G0soJb3mdIANVYgAKoZUnV3kk6u8p/obzqe7D+nNe350+v5lT8jVGVJ1d5JOrvJ0N51Pdh/R2/On1/MqfkaqVasnV3llNC41FZUykfDRTFo9bLeVPhbapYOzferj1EvVyceSi/1gxUxY9P+MWLxs5gDQUoAAAAAAAAAAAAAAAAAAAD/9k=", "base64");
const EDGE = 96;

const input = args[args.indexOf("-i") + 1] ?? "";
const params = new URL(input).searchParams;
const scenario = params.get("s") ?? "varied";
const duration = Number(params.get("d") ?? "10");
const announced = Number(params.get("ffdur") ?? String(duration));
const graph = args[args.indexOf("-filter_complex") + 1] ?? "";
const step = Number(/gte\(t-prev_selected_t,([0-9.]+)\)/.exec(graph)?.[1] ?? "1");
const maxFrames = Number(args[args.indexOf("-frames:v") + 1] ?? "42");
const keyframesOnly = args.includes("-skip_frame");

if (scenario === "403") {
  process.stderr.write("[https @ 0x1] HTTP error 403 Forbidden\n[in#0 @ 0x2] Error opening input: Server returned 403 Forbidden (access denied)\n");
  process.exit(1);
}
if (scenario === "slow") hang(60_000);
else run();

function run() {
  // Instants des images, comme le filtre select : la première, puis au moins « step » plus tard.
  // Images clés seulement : une toutes les 2 s.
  const times = [];
  let last = -Infinity;
  for (let t = 0; t < Math.min(duration, 91) && times.length < maxFrames; t += keyframesOnly ? 2 : 1 / 30) {
    const rounded = Math.round(t * 1000) / 1000;
    if (rounded - last >= step - 1e-9) {
      times.push(rounded);
      last = rounded;
    }
  }
  const hh = String(Math.floor(announced / 3600)).padStart(2, "0");
  const mm = String(Math.floor((announced % 3600) / 60)).padStart(2, "0");
  const ss = (announced % 60).toFixed(2).padStart(5, "0");
  const lines = ["Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://…':", `  Duration: ${hh}:${mm}:${ss}, start: 0.000000, bitrate: 1500 kb/s`];
  times.forEach((t, n) => lines.push(`[Parsed_showinfo_1 @ 0x5555] n:${String(n).padStart(4)} pts:${String(Math.round(t * 15360)).padStart(7)} pts_time:${t}  duration:512 fmt:yuv420p s:720x1280 iskey:1`));
  const stdout = fs.createWriteStream(null, { fd: 1 });
  const small = fs.createWriteStream(null, { fd: 3 });
  process.stderr.write(`${lines.slice(0, 2).join("\n")}\n`);
  if (announced > 91) {
    // Le vrai ffmpeg continuerait à lire : le service doit l'arrêter.
    hang(60_000);
    return;
  }
  process.stderr.write(`${lines.slice(2).join("\n")}\n`);
  if (scenario === "garbage") {
    stdout.end(Buffer.from("pas des images".repeat(50)));
    small.end(Buffer.alloc(0));
    return;
  }
  times.forEach((t, index) => {
    stdout.write(jpegFor(index));
    small.write(pixelsFor(index));
  });
  stdout.end();
  small.end();
}

/**
 * Image JPEG n° index, qui porte son numéro dans un commentaire (« fake-index:N »,
 * relu par les tests) ; scénario « big » : les 3 premières dépassent 1 Mo.
 */
function jpegFor(index) {
  const label = Buffer.from(`fake-index:${index}`);
  const tag = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), label]);
  tag.writeUInt16BE(label.length + 2, 2);
  const comments = [tag];
  for (let i = 0; scenario === "big" && index < 3 && i < 17; i += 1) {
    const segment = Buffer.alloc(65535 + 2, 0x78);
    segment[0] = 0xff;
    segment[1] = 0xfe;
    segment.writeUInt16BE(65535, 2);
    comments.push(segment);
  }
  return Buffer.concat([TINY_JPEG.subarray(0, 2), ...comments, TINY_JPEG.subarray(2)]);
}

/**
 * Petite image n° index. Scénario « varied » : un plan différent toutes les
 * 3 images (couleur et position propres), la 1re noire, une sur 5 floue.
 * « static » : toujours le même plan. Voir test/helpers.js (sceneOf).
 */
function pixelsFor(index) {
  const pixels = Buffer.alloc(EDGE * EDGE * 3);
  if (scenario === "static") return paint(pixels, 0, false);
  if (index === 0) return pixels;
  return paint(pixels, Math.floor(index / 3), index % 5 === 4);
}

function paint(pixels, scene, blurred) {
  const hue = (scene * 47) % 360;
  const [r, g, b] = hsl(hue, 0.8, 0.5);
  const [r2, g2, b2] = hsl((hue + 180) % 360, 0.8, 0.35);
  const left = 8 + ((scene * 13) % 48);
  const top = 8 + ((scene * 29) % 48);
  for (let y = 0; y < EDGE; y += 1) {
    for (let x = 0; x < EDGE; x += 1) {
      const inside = x >= left && x < left + 36 && y >= top && y < top + 36;
      let [pr, pg, pb] = inside ? [r2, g2, b2] : [r, g, b];
      if (blurred) {
        // Flou : dégradé doux, aucun bord franc.
        const fade = 0.85 + 0.15 * Math.sin((x + y) / 30);
        [pr, pg, pb] = [r * fade, g * fade, b * fade];
      } else if ((x + y) % 2 === 0) {
        // Texture fine : une image nette.
        [pr, pg, pb] = [pr * 0.7, pg * 0.7, pb * 0.7];
      }
      const i = (y * EDGE + x) * 3;
      pixels[i] = Math.round(pr);
      pixels[i + 1] = Math.round(pg);
      pixels[i + 2] = Math.round(pb);
    }
  }
  return pixels;
}

function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
