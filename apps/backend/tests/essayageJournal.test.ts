import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ErrorEvent } from "@sentry/node";
import sharp from "sharp";
import { buildApp } from "../src/app.js";
import { LOG_REDACT_PATHS, MASKED_DATA, scrubBinaryText, scrubLogLine } from "../src/lib/logPrivacy.js";
import { scrubEvent } from "../src/lib/sentry.js";

// Essayage virtuel : jamais une image (photo du membre, image produite, en
// base64) ni une date de naissance dans le journal de Render ou dans Sentry.
// Deux protections : le journal masque lui-même les champs qui pourraient en
// porter (option « redact » de pino), puis un filet final remplace toute
// image en « data URI » ou longue suite base64 restée dans une ligne. Hors
// base : une route d'essai journalise comme le ferait une erreur imprévue.

const PHOTO = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#806040" } }).jpeg().toBuffer();
const PHOTO_BASE64 = PHOTO.toString("base64");
const DATA_URI = `data:image/jpeg;base64,${PHOTO_BASE64}`;
const BIRTH_DATE = "2008-11-14";
/** Un morceau reconnaissable du base64 (sans « + » ni « / »). */
const FRAGMENT = PHOTO_BASE64.slice(40, 100).replace(/[+/=]/g, "");

describe("journal du serveur : aucune image, aucune date de naissance", () => {
  let app: FastifyInstance;
  const lines: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: { level: "info", stream: { write: (line: string) => lines.push(line) } } });
    app.post("/essai-journal-essayage", async (request) => {
      // Ce qu'aucune route ne fait, mais qu'une erreur imprévue pourrait faire.
      request.log.info({ image: DATA_URI, birthDate: BIRTH_DATE, body: request.body, photo: PHOTO_BASE64, output: [DATA_URI] }, "Essai : champs sensibles");
      request.log.info({ details: { image: DATA_URI, birthDate: BIRTH_DATE } }, "Essai : champs sensibles un niveau plus bas");
      request.log.warn({ trace: `réponse inattendue ${PHOTO_BASE64}` }, `Essai : image dans le message ${DATA_URI}`);
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("champs masqués par le journal, image et base64 remplacés partout ; la ligne reste un JSON valide", async () => {
    lines.length = 0;
    const res = await app.inject({ method: "POST", url: "/essai-journal-essayage", payload: { birthDate: BIRTH_DATE, photo: DATA_URI } });
    expect(res.statusCode).toBe(200);
    const text = lines.join("\n");
    expect(text).toContain("Essai : champs sensibles");
    for (const secret of [PHOTO_BASE64, FRAGMENT, BIRTH_DATE, "base64,/9j"]) expect(text, secret).not.toContain(secret);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const first = parsed.find((line) => line.msg === "Essai : champs sensibles")!;
    expect(first).toMatchObject({ image: MASKED_DATA, birthDate: MASKED_DATA, body: MASKED_DATA, photo: MASKED_DATA, output: MASKED_DATA });
    expect(parsed.find((line) => line.msg === "Essai : champs sensibles un niveau plus bas")).toMatchObject({ details: { image: MASKED_DATA, birthDate: MASKED_DATA } });
    const warning = parsed.find((line) => String(line.msg).startsWith("Essai : image dans le message"))!;
    expect(warning.msg).toBe(`Essai : image dans le message data:${MASKED_DATA}`);
    expect(warning.trace).toBe(`réponse inattendue ${MASKED_DATA}`);
  });

  it("les champs masqués sont ceux qui peuvent porter une image ou une date de naissance", () => {
    for (const path of ["body", "image", "photo", "birthDate", "model_image", "garment_image", "output", "*.image", "*.birthDate"]) expect(LOG_REDACT_PATHS).toContain(path);
  });
});

describe("filet final : scrubBinaryText et scrubLogLine", () => {
  it("une image en data URI ou une longue suite base64 devient « [données masquées] »", () => {
    expect(scrubBinaryText(`avant ${DATA_URI} après`)).toBe(`avant data:${MASKED_DATA} après`);
    expect(scrubBinaryText(`png data:image/png;base64,${"A".repeat(500)}==`)).toBe(`png data:${MASKED_DATA}`);
    expect(scrubBinaryText(`suite ${PHOTO_BASE64}`)).toBe(`suite ${MASKED_DATA}`);
  });

  it("le texte ordinaire ne change pas : identifiants courts, empreintes, phrases, adresses", () => {
    for (const text of ["Essayage réussi", "a".repeat(64), "pose_not_detected", "https://api.fashn.ai/v1/status/123a87r9-4129", "credits 1 durée 8000 ms"]) {
      expect(scrubBinaryText(text)).toBe(text);
    }
  });

  it("dans une ligne JSON, l'image disparaît et la ligne reste lisible", () => {
    const line = JSON.stringify({ level: 50, msg: "Erreur", detail: DATA_URI, other: "texte" });
    const cleaned = scrubLogLine(line);
    expect(JSON.parse(cleaned)).toEqual({ level: 50, msg: "Erreur", detail: `data:${MASKED_DATA}`, other: "texte" });
  });
});

describe("Sentry : aucune image dans un événement envoyé", () => {
  it("message, exception, fil d'Ariane, données jointes et contextes : images et base64 masqués", () => {
    const event = scrubEvent({
      type: undefined,
      message: `Échec ${DATA_URI}`,
      exception: { values: [{ type: "Error", value: `réponse : ${PHOTO_BASE64}` }] },
      breadcrumbs: [{ category: "fetch", message: `corps ${DATA_URI}`, data: { url: "https://api.fashn.ai/v1/run?x=1", body: { model_image: DATA_URI } } }],
      extra: { inputs: { model_image: DATA_URI, garment_image: "https://boutique.example/veste.jpg" }, list: [PHOTO_BASE64] },
      contexts: { essai: { output: [DATA_URI] } },
      tags: { note: PHOTO_BASE64 },
      user: { id: "u-1", email: "camille@example.com" },
    } as unknown as ErrorEvent);
    const text = JSON.stringify(event);
    for (const secret of [PHOTO_BASE64, FRAGMENT, "camille@example.com", "x=1"]) expect(text, secret).not.toContain(secret);
    expect(event.message).toBe(`Échec data:${MASKED_DATA}`);
    expect(event.exception!.values![0]!.value).toBe(`réponse : ${MASKED_DATA}`);
    expect(event.breadcrumbs![0]).toMatchObject({ message: `corps data:${MASKED_DATA}`, data: { url: "https://api.fashn.ai/v1/run", body: { model_image: `data:${MASKED_DATA}` } } });
    expect(event.extra).toEqual({ inputs: { model_image: `data:${MASKED_DATA}`, garment_image: "https://boutique.example/veste.jpg" }, list: [MASKED_DATA] });
    expect(event.user).toEqual({ id: "u-1" });
  });
});
