import { deflateSync } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp, { type Sharp } from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { VIDEO_AI } from "@monapp/shared-types";
import { ALLOWED_IMAGE_LOADERS, MAX_INPUT_PIXELS, imageFormatOf } from "../src/lib/imageSafety.js";
import { ImageSourceError, prepareImageForAnalysis } from "../src/lib/imageProcessing.js";
import { encodeSharedCopy, measureSharedSource, optimizePhoto, optimizePhotoWithSize, PHOTO_SIZES } from "../src/lib/photos.js";
import meRoutes from "../src/routes/me.js";
import postsRoutes from "../src/routes/posts.js";
import searchesRoutes from "../src/routes/searches.js";
import vaultRoutes from "../src/routes/vault.js";

// Lot « sécurité des images » (faille GHSA-wq5f-xc86-pv6w, librsvg) : aucun
// SVG ne doit jamais être lu par le serveur, quel que soit le type annoncé ;
// JPEG, PNG, WebP, GIF et AVIF passent ; une image trop grande est refusée
// avant d'être décodée. Tout est fabriqué en mémoire : ni réseau, ni base,
// et le SVG piégé ne sort jamais de ce fichier.

// SVG « malveillant » fabriqué ici : il tente de lire un fichier du serveur
// et d'exécuter un script. Il ne doit jamais atteindre librsvg.
const MALICIOUS_SVG = Buffer.from(
  '<?xml version="1.0"?>\n<!DOCTYPE svg [<!ENTITY secret SYSTEM "file:///etc/passwd">]>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64">' +
    '<script>alert(1)</script><text>&secret;</text><image xlink:href="file:///etc/passwd" width="64" height="64"/></svg>'
);
const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c03020"/></svg>';
/** Le même SVG sous plusieurs déguisements. Les deux derniers commencent
 * comme un GIF ou un WebP : ils passent le contrôle des premiers octets,
 * puis sharp les refuse (lecteur SVG bloqué, GIF ou WebP invalide). */
const SVG_VARIANTS: [string, Buffer][] = [
  ["SVG piégé", MALICIOUS_SVG],
  ["SVG simple", Buffer.from(SVG_BODY)],
  ["SVG précédé d'un BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SVG_BODY)])],
  ["SVG précédé d'espaces", Buffer.from(`   \n\t${SVG_BODY}`)],
  ["faux en-tête « ftyp » écrit en texte", Buffer.from(`    ftypavif    ${SVG_BODY}`)],
  ["en-tête GIF suivi d'un SVG", Buffer.from(`GIF89a${SVG_BODY}`)],
  ["en-tête WebP suivi d'un SVG", Buffer.from(`RIFF    WEBP${SVG_BODY}`)],
];

const base = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#806040" } });
/** Une image de chaque format permis, et le format attendu. */
const ALLOWED_SAMPLES: [string, Buffer, string][] = [
  ["JPEG", await base().jpeg().toBuffer(), "jpeg"],
  ["PNG", await base().png().toBuffer(), "png"],
  ["WebP", await base().webp().toBuffer(), "webp"],
  ["GIF", await base().gif().toBuffer(), "gif"],
  ["AVIF", await base().avif().toBuffer(), "heif"],
];
const TIFF = await base().tiff().toBuffer();

/** Boîte « ftyp » d'un fichier HEIF/AVIF : taille, « ftyp », marque, version, autres marques. */
function ftyp(brand: string, size = 24): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(size);
  return Buffer.concat([head, Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(4), Buffer.from("mif1miaf", "latin1")]);
}

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** « Bombe » : un PNG valide, noir, 1 bit, entrelacé (il se décode d'un
 * seul bloc, en entier), de quelques dizaines de Ko pour `width` × `height`
 * pixels. */
function pngBomb(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // 1 bit par pixel
  header[12] = 1; // entrelacé (Adam7)
  // Les sept passes d'Adam7 : départ et pas, en colonnes puis en lignes.
  const passes = [
    [0, 8, 0, 8],
    [4, 8, 0, 8],
    [0, 4, 4, 8],
    [2, 4, 0, 4],
    [0, 2, 2, 4],
    [1, 2, 0, 2],
    [0, 1, 1, 2],
  ];
  let rawLength = 0;
  for (const [x0, dx, y0, dy] of passes) {
    const columns = Math.ceil((width - x0!) / dx!);
    const rows = Math.ceil((height - y0!) / dy!);
    if (columns > 0 && rows > 0) rawLength += rows * (1 + Math.ceil(columns / 8));
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = deflateSync(Buffer.alloc(rawLength), { level: 9 });
  return Buffer.concat([signature, pngChunk("IHDR", header), pngChunk("IDAT", data), pngChunk("IEND", Buffer.alloc(0))]);
}

const peakMemoryMb = () => process.resourceUsage().maxRSS / 1024;

/** Tous les points d'entrée qui passent une image reçue à sharp. */
const ENTRY_POINTS: [string, (input: Buffer) => Promise<unknown>][] = [
  ["Spotter : image importée ou vignette officielle (prepareImageForAnalysis)", (input) => prepareImageForAnalysis(input, null)],
  ["photo d'une publication, du Vault ou de l'avatar (optimizePhoto)", (input) => optimizePhoto(input, PHOTO_SIZES.display)],
  ["image d'une vidéo pour l'analyse automatique (optimizePhotoWithSize)", (input) => optimizePhotoWithSize(input, VIDEO_AI.frameEdge, 80)],
  ["copie d'une envie : mesure de la source (measureSharedSource)", (input) => measureSharedSource(input)],
  ["copie d'une envie : copie (encodeSharedCopy)", (input) => encodeSharedCopy(input)],
];

// En premier : le pic de mémoire du processus (maxRSS) ne fait que monter,
// il doit être encore bas pour que la mesure de la bombe ait un sens.
describe("plafond de pixels : refus avant tout décodage", () => {
  it("une bombe (PNG de 15 000 × 15 000 en quelques Ko, sous le plafond par défaut de sharp) est refusée partout, sans que la mémoire monte", async () => {
    const bomb = pngBomb(15_000, 15_000);
    expect(bomb.length).toBeLessThan(100_000);
    // Image valide, que sharp aurait décodée sans notre plafond (225 Mo au moins, entrelacée).
    expect(await sharp(bomb).metadata()).toMatchObject({ format: "png", width: 15_000, height: 15_000 });
    await expect(sharp(bomb, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()).rejects.toThrow(/exceeds pixel limit/);
    const before = peakMemoryMb();
    for (const [, run] of ENTRY_POINTS) await expect(run(bomb)).rejects.toBeInstanceOf(ImageSourceError);
    expect(peakMemoryMb() - before).toBeLessThan(100);
  });

  it("une image juste au-dessus du plafond est refusée, une photo d'iPhone de 48 Mpx (8064 × 6048) passe", async () => {
    expect(7300 * 7200).toBeGreaterThan(MAX_INPUT_PIXELS);
    const tooBig = await sharp({ create: { width: 7300, height: 7200, channels: 3, background: "#806040" } }).jpeg().toBuffer();
    await expect(optimizePhoto(tooBig, PHOTO_SIZES.display)).rejects.toBeInstanceOf(ImageSourceError);
    await expect(prepareImageForAnalysis(tooBig, null)).rejects.toBeInstanceOf(ImageSourceError);

    const iphone = sharp({ create: { width: 8064, height: 6048, channels: 3, background: "#806040" } }).jpeg();
    // Photo verticale, comme sur iPhone : orientation EXIF « tournée de 90° ».
    const vertical = await sharp(await optimizePhoto(await iphone.clone().withMetadata({ orientation: 6 }).toBuffer(), PHOTO_SIZES.display)).metadata();
    expect([vertical.width, vertical.height]).toEqual([1200, 1600]);
    const analysed = await sharp(await prepareImageForAnalysis(await iphone.toBuffer(), null)).metadata();
    expect([analysed.width, analysed.height]).toEqual([1600, 1200]);
  });
});

describe("imageFormatOf : format reconnu sur les premiers octets, avant sharp", () => {
  it("reconnaît les cinq formats permis", () => {
    for (const [, sample, format] of ALLOWED_SAMPLES) expect(imageFormatOf(sample)).toBe(format);
    expect(imageFormatOf(Buffer.from("GIF87a\x01\x00\x01\x00", "latin1"))).toBe("gif");
    for (const brand of ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"]) expect(imageFormatOf(ftyp(brand))).toBe("heif");
  });

  it("refuse SVG, HTML, fichier vide ou coupé, et les autres formats", () => {
    const refused: Buffer[] = [
      ...SVG_VARIANTS.slice(0, 5).map(([, svg]) => svg),
      Buffer.from("<html><body>pas une image</body></html>"),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xd8]), // début de JPEG coupé
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]), // signature PNG coupée
      TIFF,
      Buffer.from("BM\x36\x00\x00\x00\x00\x00\x00\x00", "latin1"), // BMP
      Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1"),
      Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), // son WAV
      ftyp("isom"), // vidéo MP4
      ftyp("qt  "), // vidéo QuickTime
      ftyp("avif", 8), // boîte trop petite pour être une vraie boîte ftyp
    ];
    for (const input of refused) expect(imageFormatOf(input)).toBeNull();
  });
});

describe("liste blanche des lecteurs de libvips, posée au chargement de lib/imageSafety.ts", () => {
  it("ne rouvre que les lecteurs d'images en mémoire (variantes « Buffer ») des cinq formats", () => {
    expect(ALLOWED_IMAGE_LOADERS).toEqual([
      "VipsForeignLoadJpegBuffer",
      "VipsForeignLoadPngBuffer",
      "VipsForeignLoadWebpBuffer",
      "VipsForeignLoadNsgifBuffer",
      "VipsForeignLoadHeifBuffer",
    ]);
  });

  it("sharp lui-même refuse un SVG, même sans le contrôle des premiers octets", async () => {
    // Le faux en-tête « ftyp » irait jusqu'à librsvg sans la liste blanche (constaté le 2026-11-04).
    for (const svg of [MALICIOUS_SVG, Buffer.from(SVG_BODY), Buffer.from(`    ftypavif    ${SVG_BODY}`)]) {
      await expect(sharp(svg).metadata()).rejects.toThrow(/unsupported image format/);
    }
  });

  it("sharp refuse aussi le TIFF, dont le serveur n'a pas besoin", async () => {
    await expect(sharp(TIFF).metadata()).rejects.toThrow(/unsupported image format/);
  });

  it("sharp lit toujours JPEG, PNG, WebP, GIF et AVIF, et un JPEG Ultra HDR (Android) comme un JPEG ordinaire", async () => {
    for (const [, sample, format] of ALLOWED_SAMPLES) expect((await sharp(sample).metadata()).format).toBe(format);
    // withGainMap() existe dans sharp 0.35, mais pas encore dans ses types.
    const withGainMap = sharp(ALLOWED_SAMPLES[0]![1]) as Sharp & { withGainMap(): Sharp };
    const ultraHdr = await withGainMap.withGainMap().jpeg().toBuffer();
    expect(await sharp(ultraHdr).metadata()).toMatchObject({ format: "jpeg", width: 64, height: 48 });
  });
});

describe("chaque point d'entrée refuse un SVG, quel que soit son déguisement", () => {
  for (const [name, run] of ENTRY_POINTS) {
    it(name, async () => {
      for (const [, svg] of SVG_VARIANTS) await expect(run(svg)).rejects.toBeInstanceOf(ImageSourceError);
    });
  }
});

describe("chaque point d'entrée laisse passer JPEG, PNG, WebP, GIF et AVIF", () => {
  for (const [name, run] of ENTRY_POINTS) {
    it(name, async () => {
      for (const [, sample] of ALLOWED_SAMPLES) await expect(run(sample)).resolves.toBeDefined();
    });
  }
});

// ---- Routes, sur une fausse base en mémoire (aucun réseau) ----

const USER = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const SEARCH = "33333333-3333-4333-8333-333333333333";

interface DbCall {
  table: string;
  action: string;
  single: boolean;
  values?: unknown;
}
type DbAnswer = (call: DbCall) => { data: unknown; error: unknown };

/** Fausse base : toute chaîne d'appels est acceptée ; `answer` donne la réponse. */
function fakeSupabase(answer: DbAnswer) {
  const calls: DbCall[] = [];
  const uploads: string[] = [];
  function from(table: string) {
    const call: DbCall = { table, action: "select", single: false };
    const run = () => {
      calls.push(call);
      return Promise.resolve(answer(call));
    };
    const chain: object = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject);
          if (property === "single" || property === "maybeSingle") {
            return () => {
              call.single = true;
              return run();
            };
          }
          return (...args: unknown[]) => {
            if (property === "insert" || property === "update" || property === "upsert" || property === "delete") {
              call.action = property;
              call.values = args[0];
            }
            return chain;
          };
        },
      }
    );
    return chain;
  }
  const storage = {
    from: () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://stockage.example/${path}` } }),
      remove: async () => ({ error: null }),
    }),
  };
  return { db: { from, storage }, calls, uploads };
}

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

/** L'app réduite à une famille de routes : connexion et limites simulées. */
async function routesApp(routes: FastifyPluginAsync, db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: USER, email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.decorate("rateLimit", () => async () => {});
  app.decorate("rateLimitCheck", () => async () => {});
  app.decorate("countRateLimitHit", () => {});
  await app.register(routes);
  await app.ready();
  return app;
}

/** Formulaire multipart : des champs, puis le fichier, annoncé comme une photo JPEG. */
function upload(fields: Record<string, string>, file: Buffer) {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const PHOTO_UNREADABLE = { error: "invalid_file", message: "Cette photo n'a pas pu être lue." };

const PENDING_SEARCH = {
  id: SEARCH,
  user_id: USER,
  source_url: null,
  source_platform: "photo",
  method: "manual_screenshot",
  thumbnail_url: null,
  screenshot_url: null,
  status: "pending",
  error_message: null,
  query: null,
  created_at: new Date().toISOString(),
  refused_before_call: 0,
  failure_kind: null,
  provider: null,
  run_started_at: null,
};

describe("routes : un SVG annoncé comme une photo JPEG suit le refus existant, sans rien enregistrer", () => {
  it("photo de profil (POST /api/me/avatar)", async () => {
    const { db, uploads } = fakeSupabase(() => ({ data: null, error: null }));
    const target = await routesApp(meRoutes, db);
    for (const [, svg] of SVG_VARIANTS) {
      const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload({}, svg) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(PHOTO_UNREADABLE);
    }
    expect(uploads).toEqual([]);
  });

  it("pièce ajoutée au Vault (POST /api/vault) et nouvelle photo d'une pièce (POST /api/vault/:id/photo)", async () => {
    const { db, calls, uploads } = fakeSupabase(() => ({ data: { id: ITEM, user_id: USER, image_url: "https://stockage.example/ancienne.jpg" }, error: null }));
    const target = await routesApp(vaultRoutes, db);
    for (const [, svg] of SVG_VARIANTS) {
      const created = await target.inject({ method: "POST", url: "/api/vault", ...upload({ title: "Veste", category: "clothing" }, svg) });
      expect(created.statusCode).toBe(400);
      expect(created.json()).toEqual(PHOTO_UNREADABLE);
      const replaced = await target.inject({ method: "POST", url: `/api/vault/${ITEM}/photo`, ...upload({}, svg) });
      expect(replaced.statusCode).toBe(400);
      expect(replaced.json()).toEqual(PHOTO_UNREADABLE);
    }
    expect(uploads).toEqual([]);
    expect(calls.filter((call) => call.action !== "select")).toEqual([]);
  });

  it("publication avec photo (POST /api/posts)", async () => {
    const { db, calls, uploads } = fakeSupabase(() => ({ data: null, error: null }));
    const target = await routesApp(postsRoutes, db);
    for (const [, svg] of SVG_VARIANTS) {
      const res = await target.inject({ method: "POST", url: "/api/posts", ...upload({ type: "lifestyle" }, svg) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(PHOTO_UNREADABLE);
    }
    expect(uploads).toEqual([]);
    expect(calls.filter((call) => call.action !== "select")).toEqual([]);
  });

  it("lancement d'une recherche (POST /api/searches/:id/run) : refusé avant tout crédit, la recherche reste en attente", async () => {
    const { db, calls } = fakeSupabase((call) =>
      call.table === "product_searches" && call.action === "select" && call.single ? { data: PENDING_SEARCH, error: null } : { data: [], error: null }
    );
    const target = await routesApp(searchesRoutes, db);
    for (const [, svg] of SVG_VARIANTS) {
      const res = await target.inject({ method: "POST", url: `/api/searches/${SEARCH}/run`, ...upload({}, svg) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_image", message: "Cette image n'a pas pu être lue, ou la zone choisie est trop petite." });
    }
    // Seule écriture : le compteur des lancements refusés (mesure existante), jamais le verrou « processing ».
    const writes = calls.filter((call) => call.action !== "select");
    expect(writes).toHaveLength(SVG_VARIANTS.length);
    for (const write of writes) expect(write.values).toEqual({ refused_before_call: 1 });
  });
});
