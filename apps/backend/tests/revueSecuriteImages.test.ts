import { deflateSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { IMAGE_TOO_HEAVY, ImageQueueFullError, MAX_DECODE_BYTES, MAX_WAITING_IMAGES, fullDecodeBytes, isTooHeavyToDecode, oneImageAtATime } from "../src/lib/imageSafety.js";
import { ImageSourceError, prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import { AVATAR_MAX_INPUT_PIXELS, encodeAvatar, encodeSharedCopy, optimizePhoto } from "../src/lib/photos.js";
import { MULTIPART_LIMITS, isTooManyPartsError } from "../src/lib/multipartErrors.js";

// Revue de sécurité du 12 novembre 2026 (points « entrees-01 » et
// « entrees-02 ») : une image de 0,6 Mo qui se décode d'un seul bloc
// dépassait la mémoire du serveur (512 Mo), et un formulaire pouvait faire
// garder 1 Go de champs texte en mémoire. Tout est fabriqué ici, en mémoire :
// ni réseau, ni base. Les images « lourdes » ne sont que des en-têtes : elles
// ne sont jamais décodées, c'est justement ce qui est vérifié.

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  let crc = ~0;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(~crc >>> 0);
  return Buffer.concat([length, body, sum]);
}

/** PNG réduit à son en-tête (quelques dizaines d'octets) : il annonce
 * `width` × `height`, `depth` bits par couche, 4 couches (couleurs et
 * transparence), entrelacé ou non. Ses données sont presque vides : le
 * décoder échouerait, mais lire son en-tête suffit à le refuser. */
function pngHeader(width: number, height: number, options: { depth?: 8 | 16; interlaced?: boolean } = {}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([options.depth ?? 8, 6, 0, 0, options.interlaced ? 1 : 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0))]);
}

const flat = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#806040" } });

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageSourceError);
    return (error as Error).message;
  }
  return "acceptée";
}

describe("mémoire du décodage estimée d'après l'en-tête, avant tout décodage", () => {
  it("l'image de la revue (PNG entrelacé 7 200 × 7 200, 16 bits, 4 couches) : 518 Mo estimés, refusée", async () => {
    const header = await sharp(pngHeader(7200, 7200, { depth: 16, interlaced: true })).metadata();
    expect(header).toMatchObject({ format: "png", width: 7200, height: 7200, isProgressive: true });
    expect(fullDecodeBytes(header)).toBe(7200 * 7200 * 4 * 2 * 1.25);
    expect(isTooHeavyToDecode(header)).toBe(true);
  });

  it("le même PNG non entrelacé se lit par bandes : rien à compter, il garde le seul plafond de pixels", async () => {
    const header = await sharp(pngHeader(7200, 7200, { depth: 16 })).metadata();
    expect(header.isProgressive).toBeFalsy();
    expect(fullDecodeBytes(header)).toBe(0);
    expect(isTooHeavyToDecode(header)).toBe(false);
  });

  it("coûts par format : JPEG ordinaire et WebP 0 ; JPEG progressif, GIF et AVIF comptés en entier ; format ou taille inconnus refusés", () => {
    const size = { width: 6000, height: 6000 };
    expect(fullDecodeBytes({ format: "jpeg", channels: 3, ...size })).toBe(0);
    expect(fullDecodeBytes({ format: "webp", channels: 4, ...size })).toBe(0);
    expect(fullDecodeBytes({ format: "jpeg", channels: 3, isProgressive: true, ...size })).toBe(36e6 * 3.5);
    expect(fullDecodeBytes({ format: "jpeg", channels: 4, isProgressive: true, ...size })).toBe(36e6 * 8.5);
    expect(fullDecodeBytes({ format: "gif", channels: 4, ...size })).toBe(36e6 * 5.5);
    expect(fullDecodeBytes({ format: "heif", channels: 3, ...size })).toBe(36e6 * 18);
    expect(fullDecodeBytes({ format: "tiff", channels: 3, depth: "uchar", ...size })).toBe(36e6 * 3 * 1.25);
    expect(fullDecodeBytes({ format: "png" })).toBe(Number.POSITIVE_INFINITY);
    // Une photo de téléphone en JPEG progressif (12 Mpx) passe largement ; un AVIF de 12 Mpx non.
    expect(isTooHeavyToDecode({ format: "jpeg", channels: 3, isProgressive: true, width: 4000, height: 3000 })).toBe(false);
    expect(isTooHeavyToDecode({ format: "heif", channels: 3, width: 4000, height: 3000 })).toBe(true);
    expect(MAX_DECODE_BYTES).toBe(128 * 1024 * 1024);
  });
});

describe("chaque entrée d'image refuse l'image lourde sur son en-tête", () => {
  const heavy = pngHeader(7200, 7200, { depth: 16, interlaced: true });

  it("photo du Vault ou d'une publication (optimizePhoto), image du Spotter (prepareImageForAnalysis), copie d'une envie (encodeSharedCopy)", async () => {
    expect(await refusal(() => optimizePhoto(heavy, 1600))).toBe(IMAGE_TOO_HEAVY);
    expect(await refusal(() => prepareImageForAnalysis(heavy, null))).toBe(IMAGE_TOO_HEAVY);
    // La copie d'une envie a son propre plafond de 40 Mpx : 6 000 × 6 000 passe ce plafond, pas celui de la mémoire.
    expect(await refusal(() => encodeSharedCopy(pngHeader(6000, 6000, { depth: 16, interlaced: true })))).toBe(IMAGE_TOO_HEAVY);
  });

  it("photo de profil : 2 048 × 2 048 px au plus, quel que soit le format ; juste en dessous, acceptée", async () => {
    expect(AVATAR_MAX_INPUT_PIXELS).toBe(2048 * 2048);
    expect(await refusal(() => encodeAvatar(heavy))).toBe(IMAGE_TOO_HEAVY);
    expect(await refusal(() => encodeAvatar(pngHeader(2049, 2048)))).toBe(IMAGE_TOO_HEAVY);
    const atLimit = await flat(2048, 2048).png({ progressive: true }).toBuffer();
    expect((await encodeAvatar(atLimit)).side).toBe(512);
    const progressive = await flat(1024, 1024).jpeg({ progressive: true }).toBuffer();
    expect((await encodeAvatar(progressive)).side).toBe(512);
  });

  it("les photos ordinaires passent toujours : JPEG progressif de 12 Mpx, PNG entrelacé de 4 Mpx", async () => {
    const jpeg = await flat(4000, 3000).jpeg({ progressive: true }).toBuffer();
    expect((await optimizePhoto(jpeg, 1600)).length).toBeGreaterThan(0);
    const png = await flat(2000, 2000).png({ progressive: true }).toBuffer();
    expect((await prepareImageForAnalysis(png, null)).length).toBeGreaterThan(0);
  });
});

describe("oneImageAtATime : un seul traitement d'image à la fois", () => {
  it("les traitements passent dans l'ordre d'arrivée, jamais deux ensemble, même après un échec", async () => {
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const job = (id: number, fail = false) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      order.push(id);
      if (fail) throw new Error("échec");
      return id;
    };
    const results = await Promise.allSettled([oneImageAtATime(job(1)), oneImageAtATime(job(2, true)), oneImageAtATime(job(3)), oneImageAtATime(job(4))]);
    expect(most).toBe(1);
    expect(order).toEqual([1, 2, 3, 4]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  });

  it("file pleine (12 traitements en attente) : le suivant est refusé aussitôt, sans être lancé ; la file se vide, tout repasse", async () => {
    expect(MAX_WAITING_IMAGES).toBe(12);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let started = 0;
    const slow = () => oneImageAtATime(async () => {
      started += 1;
      await gate;
    });
    const first = slow(); // en cours
    await new Promise((resolve) => setTimeout(resolve, 0));
    const waiting = Array.from({ length: 12 }, slow); // en attente
    await expect(slow()).rejects.toBeInstanceOf(ImageQueueFullError);
    expect(started).toBe(1);
    // Une vraie photo envoyée à ce moment : « réessayez », jamais « image illisible ».
    const jpeg = await flat(64, 64).jpeg().toBuffer();
    await expect(optimizePhoto(jpeg, 480)).rejects.toBeInstanceOf(ImageQueueFullError);
    await expect(encodeAvatar(jpeg)).rejects.toBeInstanceOf(ImageQueueFullError);
    await expect(prepareImageForAnalysis(jpeg, null)).rejects.toBeInstanceOf(ImageQueueFullError);
    await expect(encodeSharedCopy(jpeg)).rejects.toBeInstanceOf(ImageQueueFullError);
    open();
    await Promise.all([first, ...waiting]);
    expect(started).toBe(13);
    expect((await optimizePhoto(jpeg, 480)).length).toBeGreaterThan(0);
  });

  it("quatre photos envoyées en même temps sont toutes traitées", async () => {
    const jpeg = await flat(1200, 900).jpeg().toBuffer();
    const sizes = await Promise.all([1, 2, 3, 4].map(() => optimizePhoto(jpeg, 480)));
    expect(sizes.every((data) => data.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Formulaires avec fichier : plafonds de champs (app.ts, MULTIPART_LIMITS)
// ---------------------------------------------------------------------

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/** Formulaire de `fields` champs texte de `size` octets, puis un petit fichier. */
function form(fields: number, size: number): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = [];
  for (let index = 0; index < fields; index++) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="champ${index}"\r\n\r\n${"a".repeat(size)}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\nimage\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** Une route qui lit son formulaire comme /api/vault, /api/posts et le lancement d'une recherche. */
async function formApp(): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: MULTIPART_LIMITS });
  app.setErrorHandler((error, _request, reply) => reply.code(isTooManyPartsError(error) ? 413 : 500).send({ error: isTooManyPartsError(error) ? "invalid_request" : "internal_error" }));
  app.post("/formulaire", async (request) => {
    const fields: Record<string, number> = {};
    let file = 0;
    for await (const part of request.parts()) {
      if (part.type === "file") file = (await part.toBuffer()).length;
      else fields[part.fieldname] = String(part.value).length;
    }
    return { fields, file };
  });
  await app.ready();
  return app;
}

describe("formulaires avec fichier : champs plafonnés", () => {
  it("plafonds posés : 1 fichier de 10 Mo, 20 champs de 64 Ko, 24 parties", () => {
    expect(MULTIPART_LIMITS).toEqual({ fileSize: 10 * 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024, parts: 24 });
  });

  it("ce que l'app envoie passe : quelques champs courts et un fichier", async () => {
    const res = await (await formApp()).inject({ method: "POST", url: "/formulaire", ...form(5, 200) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ file: 5, fields: { champ0: 200, champ4: 200 } });
  });

  it("21 champs : envoi refusé (413), jamais une erreur du serveur", async () => {
    const res = await (await formApp()).inject({ method: "POST", url: "/formulaire", ...form(21, 10) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "invalid_request" });
  });

  it("un champ de 1 Mo n'est gardé que pour 64 Ko", async () => {
    const res = await (await formApp()).inject({ method: "POST", url: "/formulaire", ...form(1, 1024 * 1024) });
    expect(res.statusCode).toBe(200);
    expect(res.json().fields.champ0).toBe(64 * 1024);
  });
});
