import { deflateSync } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, AVATAR_SIDE, BIO_MAX_LENGTH, normalizeBio, singleLine, type ModerationPage, type Profile } from "@monapp/shared-types";
import meRoutes from "../src/routes/me.js";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import { RATE_LIMITS } from "../src/lib/rateLimits.js";
import moderationRoutes from "../src/routes/moderation.js";
import { CONTENT_NOT_ALLOWED } from "../src/lib/contentFilter.js";
import { EN_MESSAGES, localizeMessage } from "../src/lib/messages.js";
import { requestLogFields, scrubLogLine, withoutErrorDetails } from "../src/lib/logPrivacy.js";
import { STORAGE_ORIGIN, fakeSupabase, type FakeDbOptions, type Row } from "./fakeSupabase.js";

// Lot « profil et icône des réglages » : la bio (160 caractères, 3 lignes,
// mots interdits) et la photo de profil (JPEG ou PNG, 5 Mo, carré de 512 px
// sans métadonnées, ancienne photo effacée, « Supprimer ma photo »). Sans
// base ni réseau : fausse base en mémoire (tests/fakeSupabase.ts).

const USER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "b0000000-0000-4000-8000-000000000002";
const ADMIN = "ad000000-0000-4000-8000-000000000003";
const PUBLIC = `${STORAGE_ORIGIN}/storage/v1/object/public/avatars`;
const AVATAR_URL = new RegExp(`^${PUBLIC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${USER}/avatar-[0-9a-f-]{36}\\.jpg$`);

function profileRow(id: string, username: string, extra: Row = {}): Row {
  return {
    id,
    username,
    display_name: username[0]!.toUpperCase() + username.slice(1),
    avatar_url: null,
    bio: null,
    locale: "fr",
    default_privacy: "followers",
    piece_sends_from: "following",
    messages_from: "everyone",
    created_at: "2026-11-01T10:00:00.000000+00:00",
    updated_at: "2026-11-01T10:00:00.000000+00:00",
    ...extra,
  };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

type Fake = ReturnType<typeof fakeSupabase>;

/** L'app réduite à une famille de routes, avec le journal de production
 * (lib/logPrivacy.ts) écrit dans `lines`. */
async function routesApp(routes: FastifyPluginAsync, fake: Fake, lines: string[] = [], userId = USER): Promise<FastifyInstance> {
  app = Fastify({
    logger: {
      level: "info",
      stream: { write: (line: string) => lines.push(line) },
      serializers: { req: requestLogFields },
      formatters: { log: withoutErrorDetails },
      hooks: { streamWrite: scrubLogLine },
    },
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate("supabaseAdmin", fake.db as unknown as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: userId, email: null };
  });
  app.decorate("requireActiveAccount", async () => {});
  app.decorate("requireAdmin", async () => {});
  // Les vraies limites de débit (coupées par NODE_ENV=test, sauf test qui les rallume).
  await app.register(rateLimitPlugin);
  await app.register(routes);
  await app.ready();
  return app;
}

function setup(options: FakeDbOptions = {}, extra: Row = {}): Fake {
  const fake = fakeSupabase(options);
  fake.table("profiles").push(profileRow(USER, "camille", extra), profileRow(OTHER, "noa"));
  return fake;
}

const saved = (fake: Fake) => fake.table("profiles").find((row) => row.id === USER)!;

// ---------------------------------------------------------------------
// Bio
// ---------------------------------------------------------------------

async function patchBio(target: FastifyInstance, bio: string | null | undefined) {
  return target.inject({ method: "PATCH", url: "/api/me", payload: { username: "camille", displayName: "Camille", ...(bio === undefined ? {} : { bio }) } });
}

describe("bio : 160 caractères, 3 lignes, lignes vides et espaces retirés", () => {
  it("160 caractères passent, 161 sont refusés avec un message clair, sans rien enregistrer", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const exact = "a".repeat(BIO_MAX_LENGTH);
    const ok = await patchBio(target, exact);
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as Profile).bio).toBe(exact);

    const tooLong = await patchBio(target, `${exact}b`);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: "bio_too_long", message: "La bio est trop longue (160 caractères maximum)." });
    expect(saved(fake).bio).toBe(exact);

    // Un texte démesuré est écarté avant tout traitement, avec le même message.
    const huge = await patchBio(target, "x".repeat(5000));
    expect(huge.statusCode).toBe(400);
    expect(huge.json().message).toBe("La bio est trop longue (160 caractères maximum).");
  });

  it("les espaces en fin de ligne et autour ne comptent pas dans les 160 caractères", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await patchBio(target, `   ${"é".repeat(BIO_MAX_LENGTH)}   \n\n  `);
    expect(res.statusCode).toBe(200);
    expect(saved(fake).bio).toBe("é".repeat(BIO_MAX_LENGTH));
  });

  it("plusieurs lignes vides de suite deviennent une seule ; retours Windows unifiés ; texte rogné", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await patchBio(target, "\n\n  Mode lente  \r\n\r\n\r\n\r\nParis   \n\n");
    expect(res.statusCode).toBe(200);
    expect(saved(fake).bio).toBe("Mode lente\n\nParis");
    expect((res.json() as Profile).bio).toBe("Mode lente\n\nParis");
  });

  it("3 lignes passent, 4 sont refusées (même après réduction des lignes vides)", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    expect((await patchBio(target, "Une\nDeux\nTrois")).statusCode).toBe(200);
    expect((await patchBio(target, "Une\n\n\n\n\nDeux")).statusCode).toBe(200);
    expect(saved(fake).bio).toBe("Une\n\nDeux");

    const four = await patchBio(target, "Une\nDeux\nTrois\nQuatre");
    expect(four.statusCode).toBe(400);
    expect(four.json()).toEqual({ error: "bio_too_many_lines", message: "La bio ne peut pas dépasser 3 lignes." });
    const blankRuns = await patchBio(target, "Une\n\n\nDeux\n\n\nTrois");
    expect(blankRuns.statusCode).toBe(400);
    expect(saved(fake).bio).toBe("Une\n\nDeux");
  });

  // Revue de sécurité du 12 novembre 2026 (point « entrees-04 »).
  it("les séparateurs de ligne Unicode comptent pour des lignes ; les caractères de contrôle ne sont jamais enregistrés", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    for (const separator of ["\u2028", "\u2029", "\u0085", "\u000B", "\u000C"]) {
      const res = await patchBio(target, Array.from({ length: 80 }, () => "a").join(separator));
      expect(res.statusCode, `U+${separator.charCodeAt(0).toString(16)}`).toBe(400);
      expect(res.json()).toEqual({ error: "bio_too_many_lines", message: "La bio ne peut pas dépasser 3 lignes." });
    }
    expect(saved(fake).bio ?? null).toBeNull();
    const kept = await patchBio(target, "Paris\u2028Vintage\u0000 et\u0007 cuir \u2029Taille 38\u009F");
    expect(kept.statusCode).toBe(200);
    expect(saved(fake).bio).toBe("Paris\nVintage et cuir\nTaille 38");
    expect(normalizeBio("a\tb \t\nc")).toBe("a\tb\nc");
  });

  it("nom affiché : une seule ligne, sans caractère de contrôle ; vide une fois nettoyé, refusé avec un message en français", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const patchName = (displayName: unknown) => target.inject({ method: "PATCH", url: "/api/me", payload: { username: "camille", displayName } });
    expect((await patchName("  Cam\u0000ille\u2028Martin\n\tD. ")).statusCode).toBe(200);
    expect(saved(fake).display_name).toBe("Camille Martin D.");
    for (const empty of ["", " \u0000\u2028\n ", "a".repeat(61), 42, undefined]) {
      const res = await patchName(empty);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_body", message: "Le nom affiché doit compter de 1 à 60 caractères." });
    }
    expect(saved(fake).display_name).toBe("Camille Martin D.");
    const badUsername = await target.inject({ method: "PATCH", url: "/api/me", payload: { username: "Camille Martin", displayName: "Camille" } });
    expect(badUsername.json()).toEqual({ error: "invalid_body", message: "3 à 20 caractères : lettres minuscules, chiffres, underscore." });
    expect(singleLine(" a\r\nb\u2029c\u0001 ")).toBe("a b c");
  });

  it("un mot interdit dans la bio : le même refus 400 content_not_allowed, rien n'est enregistré", async () => {
    const fake = setup({}, { bio: "Avant" });
    const target = await routesApp(meRoutes, fake);
    for (const bio of ["Je suis une salope", "s.a.l.o.p.e\nde la mode", "Ligne 1\n\nNIQUE"]) {
      const res = await patchBio(target, bio);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual(CONTENT_NOT_ALLOWED);
    }
    expect(saved(fake).bio).toBe("Avant");
  });

  it("une bio vide, faite d'espaces ou absente est effacée (null)", async () => {
    for (const bio of ["", "   \n\n  ", null, undefined]) {
      const fake = setup({}, { bio: "Avant" });
      const target = await routesApp(meRoutes, fake);
      const res = await patchBio(target, bio);
      expect(res.statusCode).toBe(200);
      expect(saved(fake).bio).toBeNull();
      await target.close();
      app = null;
    }
  });

  it("messages traduits en anglais", () => {
    expect(localizeMessage("La bio est trop longue (160 caractères maximum).", 400, "en")).toBe("Your bio is too long (160 characters maximum).");
    expect(localizeMessage("La bio ne peut pas dépasser 3 lignes.", 400, "en")).toBe("Your bio can't be longer than 3 lines.");
    expect(EN_MESSAGES["La photo est trop lourde (5 Mo maximum)."]).toBe("The photo is too large (5 MB maximum).");
    expect(EN_MESSAGES["Format non accepté : choisissez une photo JPEG, PNG ou HEIC."]).toBe("Format not accepted: choose a JPEG, PNG or HEIC photo.");
  });
});

describe("journal du serveur : jamais le texte de la bio", () => {
  it("ni à l'enregistrement, ni à un refus, ni quand la base renvoie la ligne refusée dans son erreur", async () => {
    const MARQUE = "bio-secrete-zebre";
    const lines: string[] = [];
    let failNext = false;
    const fake = setup({
      failWrite: (table, action, values) =>
        failNext && table === "profiles" && action === "update"
          ? { code: "23514", message: `new row violates check constraint`, ...{ details: `Failing row contains (${USER}, ${JSON.stringify(values)})` } }
          : null,
    });
    const target = await routesApp(meRoutes, fake, lines);
    expect((await patchBio(target, `Bonjour ${MARQUE}`)).statusCode).toBe(200);
    expect((await patchBio(target, `salope ${MARQUE}`)).statusCode).toBe(400);
    expect((await patchBio(target, `${MARQUE} ${"x".repeat(200)}`)).statusCode).toBe(400);
    expect((await patchBio(target, `${MARQUE}\n2\n3\n4`)).statusCode).toBe(400);
    failNext = true;
    expect((await patchBio(target, `Encore ${MARQUE}`)).statusCode).toBe(500);

    const text = lines.join("\n");
    expect(lines.some((line) => line.includes("Échec de mise à jour du profil"))).toBe(true);
    expect(text).not.toContain(MARQUE);
    expect(text).not.toContain("Failing row");
    expect(text).not.toContain(USER);
  });
});

// ---------------------------------------------------------------------
// Photo de profil
// ---------------------------------------------------------------------

/** Formulaire multipart : le fichier, annoncé avec `type` et `name`. */
function upload(file: Buffer, type = "image/jpeg", name = "photo.jpg") {
  const boundary = "limiteDeTest";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { payload: Buffer.concat([head, file, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const photo = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#806040" } });

/** Photo d'iPhone : position GPS, appareil, profil couleur. */
async function iphonePhoto(width = 1200, height = 800): Promise<Buffer> {
  return photo(width, height)
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 15", Copyright: "Camille" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 300/100" },
    })
    .withIccProfile("p3")
    .jpeg()
    .toBuffer();
}

/** Lecteur EXIF minimal : vrai si le premier répertoire (IFD0) désigne un
 * répertoire GPS (étiquette 0x8825), c'est-à-dire si la photo dit où elle a été prise. */
function hasGpsPointer(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  const start = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
  const tiff = exif.subarray(start);
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  const u16 = (offset: number) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd0 = u32(4);
  const entries = u16(ifd0);
  for (let index = 0; index < entries; index += 1) if (u16(ifd0 + 2 + index * 12) === 0x8825) return true;
  return false;
}

/** PNG valide, noir, de `width` × `height` pixels : quelques Ko seulement. */
function bigPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
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
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([1, 0, 0, 0, 0], 8); // 1 bit, niveaux de gris
  const raw = Buffer.alloc((Math.ceil(width / 8) + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Boîte « ftyp » d'une photo HEIC d'iPhone, suivie de données. */
function heicHeader(): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(24);
  return Buffer.concat([size, Buffer.from("ftypheic", "latin1"), Buffer.alloc(4), Buffer.from("mif1heic", "latin1"), Buffer.alloc(200)]);
}

const storedAvatars = (fake: Fake, userId = USER) => [...fake.files.keys()].filter((key) => key.startsWith(`avatars/${userId}/`));
const pathOf = (url: string) => `avatars/${url.split("/public/avatars/")[1]}`;

describe("photo de profil : formats acceptés et refusés", () => {
  it("JPEG accepté : carré de 512 px, JPEG, adresse publique au nom nouveau", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto(1200, 800)) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Profile;
    expect(body.avatarUrl).toMatch(AVATAR_URL);
    expect(saved(fake).avatar_url).toBe(body.avatarUrl);
    const stored = fake.files.get(pathOf(body.avatarUrl!))!;
    const meta = await sharp(stored).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", AVATAR_SIDE, AVATAR_SIDE]);
  });

  it("PNG accepté (transparence sur fond blanc), photo verticale recadrée en carré", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const png = await sharp({ create: { width: 700, height: 1400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(png, "image/png", "capture.png") });
    expect(res.statusCode).toBe(200);
    const stored = fake.files.get(pathOf((res.json() as Profile).avatarUrl!))!;
    const { data, info } = await sharp(stored).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([AVATAR_SIDE, AVATAR_SIDE]);
    expect([data[0], data[1], data[2]].every((value) => value! > 245)).toBe(true);
  });

  it("une petite photo n'est jamais agrandie, mais reste carrée", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await photo(300, 180).jpeg().toBuffer()) });
    expect(res.statusCode).toBe(200);
    const meta = await sharp(fake.files.get(pathOf((res.json() as Profile).avatarUrl!))!).metadata();
    expect([meta.width, meta.height]).toEqual([180, 180]);
  });

  it("HEIC envoyé sans conversion, WebP, GIF, AVIF : refusés avec le format à choisir ; rien n'est enregistré", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const samples: [string, Buffer, string][] = [
      ["HEIC", heicHeader(), "image/heic"],
      ["WebP", await photo(64, 64).webp().toBuffer(), "image/webp"],
      ["GIF", await photo(64, 64).gif().toBuffer(), "image/gif"],
      ["AVIF", await photo(64, 64).avif().toBuffer(), "image/avif"],
    ];
    for (const [label, file, type] of samples) {
      const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(file, type) });
      expect(res.statusCode, label).toBe(400);
      expect(res.json(), label).toEqual({ error: "unsupported_format", message: "Format non accepté : choisissez une photo JPEG, PNG ou HEIC." });
    }
    expect(fake.uploads).toEqual([]);
    expect(saved(fake).avatar_url).toBeNull();
  });

  it("SVG (même annoncé en JPEG), fichier tronqué ou image démesurée : « illisible » ; un fichier qui n'est pas une image : refusé", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
    const truncated = (await iphonePhoto()).subarray(0, 400);
    const huge = bigPng(8000, 7000); // 56 millions de pixels : au-delà du plafond de 52 millions
    for (const file of [svg, truncated, huge]) {
      const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(file) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
    }
    const text = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(Buffer.from("bonjour"), "text/plain", "note.txt") });
    expect(text.statusCode).toBe(400);
    expect(text.json()).toEqual({ error: "invalid_file", message: "Merci d'envoyer une image." });
    expect(fake.uploads).toEqual([]);
  });

  it("au-delà de 5 Mo : 413 avec la limite dite, rien n'est enregistré", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const jpeg = await iphonePhoto();
    const tooBig = Buffer.concat([jpeg, Buffer.alloc(AVATAR_MAX_BYTES + 1 - jpeg.length)]);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(tooBig) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "file_too_large", message: "La photo est trop lourde (5 Mo maximum)." });
    expect(fake.uploads).toEqual([]);
    // Juste sous la limite : accepté.
    const justUnder = Buffer.concat([jpeg, Buffer.alloc(AVATAR_MAX_BYTES - 1024 - jpeg.length)]);
    expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(justUnder) })).statusCode).toBe(200);
  });
});

// Revue de sécurité du 12 novembre 2026 (points « entrees-01 » à « entrees-03 »).
describe("photo de profil : garde-fous de la revue de sécurité", () => {
  /** Formulaire avec un champ texte AVANT le fichier. */
  function uploadWithField(file: Buffer, field: string) {
    const boundary = "limiteDeTest";
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n${field}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    return { payload: Buffer.concat([head, file, Buffer.from(`\r\n--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
  }

  it("une image de plus de 2 048 × 2 048 px est refusée sur son en-tête ; à 2 048 × 2 048, acceptée", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(bigPng(2049, 2048), "image/png", "photo.png") });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_file", message: "Cette photo n'a pas pu être lue." });
    expect(fake.uploads).toEqual([]);
    expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(bigPng(2048, 2048), "image/png", "photo.png") })).statusCode).toBe(200);
  });

  it("un champ texte en plus du fichier : envoi refusé (413), rien n'est gardé ni enregistré", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...uploadWithField(await iphonePhoto(), "a".repeat(100_000)) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "invalid_file", message: "Merci d'envoyer une seule image, sans autre champ." });
    expect(fake.uploads).toEqual([]);
  });

  it("deux envois en même temps pour le même compte : un seul passe, aucun fichier ne reste sans profil", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const jpeg = await iphonePhoto();
    const answers = await Promise.all([1, 2, 3].map(() => target.inject({ method: "POST", url: "/api/me/avatar", ...upload(jpeg) })));
    const codes = answers.map((res) => res.statusCode).sort();
    expect(codes).toEqual([200, 429, 429]);
    expect(answers.find((res) => res.statusCode === 429)!.json()).toEqual({ error: "avatar_in_progress", message: "Une photo est déjà en cours d'envoi. Réessayez dans un instant." });
    expect(storedAvatars(fake)).toEqual([pathOf(saved(fake).avatar_url as string)]);
    // Une fois l'envoi terminé, le suivant passe.
    expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(jpeg) })).statusCode).toBe(200);
    expect(storedAvatars(fake)).toHaveLength(1);
  });

  it("20 envois ou suppressions par heure et par compte, refus compris ; la limite par défaut ne s'y ajoute pas", async () => {
    expect(RATE_LIMITS.avatarWrite).toMatchObject({ max: 20, windowMs: 60 * 60 * 1000, error: "avatar_limit" });
    const member = "c0000000-0000-4000-8000-00000000000c";
    const fake = setup();
    const target = await routesApp(meRoutes, fake, [], member);
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const notAnImage = upload(Buffer.from("bonjour"), "text/plain", "note.txt");
      for (let attempt = 0; attempt < 19; attempt++) {
        expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...notAnImage })).statusCode).toBe(400);
      }
      // La suppression compte dans la même limite : le 20ᵉ appel passe encore, le 21ᵉ non, pour l'une comme pour l'autre.
      expect((await target.inject({ method: "DELETE", url: "/api/me/avatar" })).statusCode).not.toBe(429);
      const refused = await target.inject({ method: "POST", url: "/api/me/avatar", ...notAnImage });
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toEqual({ error: "avatar_limit", message: "Vous avez changé de photo de profil plusieurs fois en peu de temps. Réessayez dans une heure." });
      expect((await target.inject({ method: "DELETE", url: "/api/me/avatar" })).statusCode).toBe(429);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});

describe("photo de profil : métadonnées retirées avant tout enregistrement", () => {
  it("la position GPS, l'appareil et le profil couleur de la photo d'origine ont disparu du fichier enregistré", async () => {
    const original = await iphonePhoto();
    const before = await sharp(original).metadata();
    expect(hasGpsPointer(before.exif)).toBe(true);
    expect(before.exif!.includes(Buffer.from("iPhone 15"))).toBe(true);
    expect(before.icc).toBeDefined();

    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(original) });
    expect(res.statusCode).toBe(200);
    expect(fake.files.size).toBe(1);
    const stored = [...fake.files.values()][0]!;
    const after = await sharp(stored).metadata();
    expect(after.exif).toBeUndefined();
    expect(hasGpsPointer(after.exif)).toBe(false);
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(stored.includes(Buffer.from("iPhone 15"))).toBe(false);
    expect(stored.includes(Buffer.from("Camille"))).toBe(false);
  });
});

describe("photo de profil : l'ancienne est effacée, « Supprimer ma photo » efface le fichier", () => {
  it("une nouvelle photo remplace l'ancienne : l'ancien fichier est effacé", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const first = (await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto()) })).json() as Profile;
    const second = (await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await photo(900, 900).png().toBuffer(), "image/png") })).json() as Profile;
    expect(second.avatarUrl).toMatch(AVATAR_URL);
    expect(second.avatarUrl).not.toBe(first.avatarUrl);
    expect(fake.removed).toEqual([pathOf(first.avatarUrl!)]);
    expect(storedAvatars(fake)).toEqual([pathOf(second.avatarUrl!)]);
  });

  it("l'ancien nom fixe (« avatar.jpg », avant ce lot) est effacé aussi ; une adresse étrangère n'est jamais touchée", async () => {
    const legacy = setup({}, { avatar_url: `${PUBLIC}/${USER}/avatar.jpg?v=0f0e` });
    legacy.files.set(`avatars/${USER}/avatar.jpg`, Buffer.from("ancienne"));
    let target = await routesApp(meRoutes, legacy);
    expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto()) })).statusCode).toBe(200);
    expect(legacy.removed).toEqual([`avatars/${USER}/avatar.jpg`]);
    expect(storedAvatars(legacy)).toHaveLength(1);
    await target.close();

    for (const foreign of [`${PUBLIC}/${OTHER}/avatar-1.jpg`, "https://ailleurs.example/storage/v1/object/public/avatars/" + USER + "/avatar.jpg"]) {
      const fake = setup({}, { avatar_url: foreign });
      fake.files.set(`avatars/${OTHER}/avatar-1.jpg`, Buffer.from("autre"));
      target = await routesApp(meRoutes, fake);
      expect((await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto()) })).statusCode).toBe(200);
      expect(fake.removed).toEqual([]);
      expect(fake.files.has(`avatars/${OTHER}/avatar-1.jpg`)).toBe(true);
      await target.close();
    }
    app = null;
  });

  it("profil impossible à mettre à jour : la nouvelle photo est effacée, l'ancienne reste", async () => {
    const lines: string[] = [];
    const fake = setup({ failWrite: (table, action) => (table === "profiles" && action === "update" ? { code: "57014", message: "délai dépassé" } : null) }, { avatar_url: `${PUBLIC}/${USER}/avatar-ancienne.jpg` });
    fake.files.set(`avatars/${USER}/avatar-ancienne.jpg`, Buffer.from("ancienne"));
    const target = await routesApp(meRoutes, fake, lines);
    const res = await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto()) });
    expect(res.statusCode).toBe(500);
    expect(storedAvatars(fake)).toEqual([`avatars/${USER}/avatar-ancienne.jpg`]);
    expect(saved(fake).avatar_url).toBe(`${PUBLIC}/${USER}/avatar-ancienne.jpg`);
    expect(lines.join("\n")).not.toContain("avatar-");
  });

  it("« Supprimer ma photo » : tous ses fichiers de photo de profil sont effacés, puis la photo est retirée du profil", async () => {
    const fake = setup();
    const target = await routesApp(meRoutes, fake);
    const sent = (await target.inject({ method: "POST", url: "/api/me/avatar", ...upload(await iphonePhoto()) })).json() as Profile;
    fake.files.set(`avatars/${USER}/avatar.jpg`, Buffer.from("restée d'avant"));
    fake.files.set(`avatars/${OTHER}/avatar-x.jpg`, Buffer.from("à quelqu'un d'autre"));

    const res = await target.inject({ method: "DELETE", url: "/api/me/avatar" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Profile).avatarUrl).toBeNull();
    expect(saved(fake).avatar_url).toBeNull();
    expect(storedAvatars(fake)).toEqual([]);
    expect(fake.removed.sort()).toEqual([pathOf(sent.avatarUrl!), `avatars/${USER}/avatar.jpg`].sort());
    expect(fake.files.has(`avatars/${OTHER}/avatar-x.jpg`)).toBe(true);

    // Sans photo : rien à effacer, même réponse.
    const again = await target.inject({ method: "DELETE", url: "/api/me/avatar" });
    expect(again.statusCode).toBe(200);
    expect((again.json() as Profile).avatarUrl).toBeNull();
  });

  it("le stockage refuse d'effacer : 503, rien n'est changé (jamais une photo « supprimée » encore en ligne)", async () => {
    const fake = setup({ failStorageRemove: () => true }, { avatar_url: `${PUBLIC}/${USER}/avatar-a.jpg` });
    fake.files.set(`avatars/${USER}/avatar-a.jpg`, Buffer.from("photo"));
    const target = await routesApp(meRoutes, fake);
    const res = await target.inject({ method: "DELETE", url: "/api/me/avatar" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "storage_failed", message: "La photo n'a pas pu être effacée : rien n'a été changé. Réessayez dans un instant." });
    expect(saved(fake).avatar_url).toBe(`${PUBLIC}/${USER}/avatar-a.jpg`);
    expect(storedAvatars(fake)).toEqual([`avatars/${USER}/avatar-a.jpg`]);
  });
});

// ---------------------------------------------------------------------
// Modération : la bio d'un profil signalé est montrée
// ---------------------------------------------------------------------

describe("modération : un profil signalé est montré avec sa bio", () => {
  it("la file de modération montre la bio du profil signalé (signalement du profil, cible « user »)", async () => {
    const BIO = "Vends des contrefaçons\nÉcrivez-moi";
    const fake = setup(
      {
        rpc: async (fn) =>
          fn === "moderation_queue"
            ? {
                data: [{ target_type: "user", target_id: USER, report_count: 2, reasons: { inappropriate: 2 }, notes: [], first_at: "2026-11-09T10:00:00+00:00", last_at: "2026-11-09T11:00:00+00:00" }],
                error: null,
              }
            : { data: null, error: { message: "absente" } },
      },
      { bio: BIO, avatar_url: `${PUBLIC}/${USER}/avatar-a.jpg` }
    );
    const target = await routesApp(moderationRoutes, fake, [], ADMIN);
    const res = await target.inject({ method: "GET", url: "/api/admin/moderation" });
    expect(res.statusCode).toBe(200);
    const page = res.json() as ModerationPage;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.preview).toEqual({
      kind: "user",
      author: { id: USER, username: "camille", displayName: "Camille", avatarUrl: `${PUBLIC}/${USER}/avatar-a.jpg`, suspended: false },
      bio: BIO,
    });
  });
});

// Revue de sécurité du 12 novembre 2026 (points « acces-1 » et « app-03 ») :
// le bucket des photos de profil est public ; cacher l'adresse de la photo
// d'un compte suspendu dans les réponses ne suffisait pas.
describe("suspension : la photo de profil change d'adresse", () => {
  const ACTION = "5a000000-0000-4000-8000-00000000000a";
  const LEGACY = `avatars/${USER}/avatar.jpg`;
  const suspend = (target: FastifyInstance, action = "suspend") =>
    target.inject({ method: "POST", url: "/api/admin/moderation/actions", payload: { targetType: "user", targetId: USER, action, reason: "inappropriate" } });

  function suspended(options: FakeDbOptions = {}): Fake {
    const fake = setup(
      { rpc: async (fn) => (fn === "moderation_apply" ? { data: [{ outcome: "ok", action_id: ACTION }], error: null } : { data: null, error: { message: "absente" } }), ...options },
      { avatar_url: `${PUBLIC}/${USER}/avatar.jpg` }
    );
    fake.files.set(LEGACY, Buffer.from("photo"));
    fake.table("suspensions").push({ user_id: USER, moderation_action_id: ACTION });
    return fake;
  }

  it("l'ancienne adresse (« <compte>/avatar.jpg », devinable) ne montre plus rien ; la photo, intacte, a un nom au hasard", async () => {
    const fake = suspended();
    const res = await suspend(await routesApp(moderationRoutes, fake, [], ADMIN));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actionId: ACTION });
    expect(fake.files.has(LEGACY)).toBe(false);
    expect(saved(fake).avatar_url).toMatch(AVATAR_URL);
    expect(storedAvatars(fake)).toEqual([pathOf(saved(fake).avatar_url as string)]);
    expect(fake.files.get(storedAvatars(fake)[0]!)).toEqual(Buffer.from("photo"));
    expect(fake.removed).toEqual([]);
  });

  it("une autre décision (classer sans suite) ne déplace rien ; un compte sans photo non plus", async () => {
    const fake = suspended();
    expect((await suspend(await routesApp(moderationRoutes, fake, [], ADMIN), "dismiss")).statusCode).toBe(200);
    expect(fake.files.has(LEGACY)).toBe(true);
    expect(saved(fake).avatar_url).toBe(`${PUBLIC}/${USER}/avatar.jpg`);

    const noPhoto = suspended();
    saved(noPhoto).avatar_url = null;
    expect((await suspend(await routesApp(moderationRoutes, noPhoto, [], ADMIN))).statusCode).toBe(200);
    expect(noPhoto.files.has(LEGACY)).toBe(true);
  });

  it("le stockage refuse : la suspension est enregistrée quand même, la photo garde son adresse, le journal ne donne ni chemin ni compte", async () => {
    const fake = suspended({ failStorageRemove: () => true });
    const lines: string[] = [];
    const res = await suspend(await routesApp(moderationRoutes, fake, lines, ADMIN));
    expect(res.statusCode).toBe(200);
    expect(fake.files.has(LEGACY)).toBe(true);
    expect(saved(fake).avatar_url).toBe(`${PUBLIC}/${USER}/avatar.jpg`);
    const journal = lines.join("\n");
    expect(journal).toContain("la photo de profil n'a pas pu changer d'adresse");
    expect(journal).not.toContain(USER);
  });
});
