import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Lot « couleur des bords » (retours du build 3) : le serveur mesure la
// couleur unie des bords de la vignette des propositions, derrière
// EDGE_COLOR_ENABLED (éteint par défaut), la garde en mémoire et l'envoie à
// l'app dans un champ facultatif. SANS base ni réseau : les résolutions de
// noms et les réponses des sites sont simulées, la base est en mémoire.
const { httpsRequest, switches } = vi.hoisted(() => ({ httpsRequest: vi.fn(), switches: { on: false } }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));
vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "93.184.215.14", family: 4 }];
  return { lookup, default: { lookup } };
});
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return {
    env: new Proxy(original.env, {
      get: (target, key) => (key === "EDGE_COLOR_ENABLED" ? switches.on : target[key as keyof typeof target]),
    }),
  };
});

import type { Resolver } from "../src/lib/publicImage.js";
import {
  EDGE_COLORS_PER_MINUTE,
  EDGE_COLOR_CONCURRENCY,
  EDGE_COLOR_RETRY_MS,
  EDGE_COLOR_SWEEP_MS,
  EDGE_COLOR_TTL_MS,
  edgeColorFor,
  edgeColorField,
  edgesToMeasure,
  isMeasurableImageUrl,
  measureEdgeColor,
  queueEdgeColors,
  queueKeptEdgeColors,
  queueSearchEdgeColors,
  resetEdgeColorMemory,
  sweepExpiredEdgeColors,
} from "../src/lib/edgeColor.js";
import { toProductSearch, type MatchRow, type SearchRow } from "../src/lib/searchRows.js";
import { fakeSupabase } from "./fakeSupabase.js";

const PUBLIC: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const INTERNAL: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste";
const PNG = { "content-type": "image/png" };

type Answer = { status: number; headers?: Record<string, string>; body?: Buffer; delayMs?: number };

let inFlight = 0;
let maxInFlight = 0;

function respond(answer: Answer) {
  return (_url: URL, _options: unknown, callback: (response: Readable) => void) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const req = Object.assign(new EventEmitter(), {
      end: () => {
        setTimeout(() => {
          inFlight -= 1;
          callback(Object.assign(Readable.from(answer.body ? [answer.body] : []), { statusCode: answer.status, headers: answer.headers ?? {} }));
        }, answer.delayMs ?? 0);
      },
    });
    return req;
  };
}

const answerNext = (answer: Answer) => httpsRequest.mockImplementationOnce(respond(answer));
const answerAlways = (answer: Answer) => httpsRequest.mockImplementation(respond(answer));

function logger() {
  const info = vi.fn();
  return { log: { info, warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger, info };
}

const settle = () => new Promise((done) => setTimeout(done, 30));

// ---- Images d'essai (PNG : couleurs exactes) ----

const solid = (width: number, height: number, background: string | { r: number; g: number; b: number; alpha: number }) =>
  sharp({ create: { width, height, channels: 4, background } });

/** Une « pièce » sombre au centre d'un fond uni. */
async function pieceOn(width: number, height: number, background: string | { r: number; g: number; b: number; alpha: number }): Promise<Buffer> {
  const piece = await solid(Math.round(width / 2), Math.round(height / 2), "#203040").png().toBuffer();
  return solid(width, height, background).composite([{ input: piece, gravity: "centre" }]).png().toBuffer();
}

/** Image brute RGB décrite pixel par pixel. */
function rawImage(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      data.set([r, g, b], (y * width + x) * 3);
    }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

let whiteSquare: Buffer;
beforeAll(async () => {
  whiteSquare = await pieceOn(300, 300, "#ffffff");
});

beforeEach(() => {
  httpsRequest.mockReset();
  resetEdgeColorMemory();
  switches.on = false;
  inFlight = 0;
  maxInFlight = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mesure de la couleur des bords (measureEdgeColor)", () => {
  it("permis : photo carrée sur fond blanc uni → #ffffff", async () => {
    expect(await measureEdgeColor(whiteSquare)).toBe("#ffffff");
  });

  it("permis : fond gris #e8e8e8 → #e8e8e8 (minuscules)", async () => {
    expect(await measureEdgeColor(await pieceOn(300, 300, "#E8E8E8"))).toBe("#e8e8e8");
  });

  it("permis : un JPEG sur fond ivoire donne une couleur proche du fond", async () => {
    const jpeg = await sharp(await pieceOn(400, 300, "#f2f1ee")).jpeg({ quality: 90 }).toBuffer();
    const color = await measureEdgeColor(jpeg);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    const channels = [1, 3, 5].map((i) => parseInt(color!.slice(i, i + 2), 16));
    [0xf2, 0xf1, 0xee].forEach((expected, c) => expect(Math.abs(channels[c]! - expected)).toBeLessThanOrEqual(3));
  });

  it("refusé : bords en dégradé → null", async () => {
    expect(await measureEdgeColor(await rawImage(300, 300, (x) => [Math.round((x / 299) * 255), 128, 128]))).toBeNull();
  });

  it("refusé : bords à motif (damier) → null", async () => {
    expect(await measureEdgeColor(await rawImage(300, 300, (x, y) => ((Math.floor(x / 15) + Math.floor(y / 15)) % 2 ? [255, 255, 255] : [0, 0, 0])))).toBeNull();
  });

  it("refusé : haut blanc et bas noir → null (les deux bords doivent se ressembler)", async () => {
    expect(await measureEdgeColor(await rawImage(300, 300, (_x, y) => (y < 150 ? [255, 255, 255] : [0, 0, 0])))).toBeNull();
  });

  it("refusé : photo déjà en 4:5 → null (elle remplit la tuile)", async () => {
    expect(await measureEdgeColor(await pieceOn(400, 500, "#ffffff"))).toBeNull();
  });

  it("PNG transparent : la transparence prend le blanc", async () => {
    expect(await measureEdgeColor(await pieceOn(300, 300, { r: 0, g: 0, b: 0, alpha: 0 }))).toBe("#ffffff");
  });

  it("refusé : pas une image, SVG, plus de 1 Mo, vide → null", async () => {
    expect(await measureEdgeColor(Buffer.from("bonjour, ceci n'est pas une image"))).toBeNull();
    expect(await measureEdgeColor(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#fff"/></svg>'))).toBeNull();
    const big = Buffer.concat([whiteSquare, Buffer.alloc(1024 * 1024)]);
    expect(await measureEdgeColor(big)).toBeNull();
    expect(await measureEdgeColor(Buffer.alloc(0))).toBeNull();
  });
});

describe("choix des bords", () => {
  it("photo large (1:1) → haut et bas ; étroite (9:16) → gauche et droite ; presque 4:5 → aucun", () => {
    expect(edgesToMeasure(1000, 1000)).toBe("top-bottom");
    expect(edgesToMeasure(1600, 900)).toBe("top-bottom");
    expect(edgesToMeasure(900, 1600)).toBe("left-right");
    expect(edgesToMeasure(800, 1000)).toBeNull();
    expect(edgesToMeasure(0, 1000)).toBeNull();
  });

  it("une photo étroite est mesurée sur ses côtés : côtés gris uniformes, haut et bas différents → le gris", async () => {
    // 9:16 : côtés gris ; la pièce touche le haut et le bas (une rangée lue là ne serait pas uniforme).
    const narrow = await rawImage(180, 320, (x) => (x < 30 || x > 149 ? [200, 200, 200] : [40, 60, 90]));
    expect(await measureEdgeColor(narrow)).toBe("#c8c8c8");
  });
});

describe("adresses mesurables", () => {
  it("permis : une vignette de Google, une boutique (même avec « threads » dans son nom)", () => {
    expect(isMeasurableImageUrl(THUMB)).toBe(true);
    expect(isMeasurableImageUrl("https://cdn.threadsandco.fr/a.jpg")).toBe(true);
  });

  it("refusé : http, localhost, identifiants, port inhabituel, trop longue, réseaux sociaux", () => {
    for (const bad of [
      "http://images.exemple.fr/a.jpg",
      "https://localhost/a.jpg",
      "https://u:p@images.exemple.fr/a.jpg",
      "https://images.exemple.fr:8443/a.jpg",
      `https://images.exemple.fr/${"a".repeat(2100)}.jpg`,
      "https://p16-sign.tiktokv.com/a.jpg",
      "https://scontent.cdninstagram.com/a.jpg",
      "https://lookaside.facebook.com/a.jpg",
      "https://static.xx.fbsbx.com/a.jpg",
      "https://p3.byteimg.com/a.jpg",
      "https://www.threads.net/a.jpg",
      null,
      42,
    ]) {
      expect(isMeasurableImageUrl(bad), String(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("la file de mesure", () => {
  it("refusé : interrupteur éteint → aucun téléchargement, rien servi", async () => {
    const { log } = logger();
    queueEdgeColors(log, [THUMB], PUBLIC);
    await settle();
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(edgeColorFor(THUMB)).toBeUndefined();
  });

  it("permis : allumé, la vignette est téléchargée après la réponse, mesurée, gardée ; journal sans adresse", async () => {
    switches.on = true;
    const { log, info } = logger();
    answerNext({ status: 200, headers: PNG, body: whiteSquare });
    queueEdgeColors(log, [THUMB], PUBLIC);
    // Jamais pendant la réponse : au tour suivant.
    expect(httpsRequest).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
    expect(String(httpsRequest.mock.calls[0]![0])).toBe(THUMB);
    expect(info).toHaveBeenCalledWith("Couleur des bords : mesurée");
    expect(JSON.stringify(info.mock.calls)).not.toContain("gstatic");
    // Déjà en cache : plus aucun téléchargement.
    queueEdgeColors(log, [THUMB], PUBLIC);
    await settle();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("bords non uniformes : rien n'est servi (la tuile garde sa copie floue)", async () => {
    switches.on = true;
    const { log, info } = logger();
    answerNext({ status: 200, headers: PNG, body: await rawImage(300, 300, (x) => [Math.round((x / 299) * 255), 0, 0]) });
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : non uniforme"));
    expect(edgeColorFor(THUMB)).toBeUndefined();
  });

  it(`${EDGE_COLOR_CONCURRENCY} téléchargements à la fois au plus`, async () => {
    switches.on = true;
    const { log } = logger();
    answerAlways({ status: 200, headers: PNG, body: whiteSquare, delayMs: 15 });
    const urls = Array.from({ length: 6 }, (_, i) => `https://images.exemple.fr/${i}.png`);
    queueEdgeColors(log, urls, PUBLIC);
    await vi.waitFor(() => expect(urls.every((url) => edgeColorFor(url) === "#ffffff")).toBe(true));
    expect(httpsRequest).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBe(EDGE_COLOR_CONCURRENCY);
  });

  it(`refusé : la ${EDGE_COLORS_PER_MINUTE + 1}ᵉ mesure de la minute (elle revient à la minute suivante)`, async () => {
    switches.on = true;
    const { log } = logger();
    answerAlways({ status: 404 });
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const urls = Array.from({ length: EDGE_COLORS_PER_MINUTE + 1 }, (_, i) => `https://images.exemple.fr/${i}.png`);
    queueEdgeColors(log, urls, PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(EDGE_COLORS_PER_MINUTE));
    await settle();
    expect(httpsRequest).toHaveBeenCalledTimes(EDGE_COLORS_PER_MINUTE);
    now.mockReturnValue(start + 61_000);
    queueEdgeColors(log, urls, PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(EDGE_COLORS_PER_MINUTE + 1));
    expect(String(httpsRequest.mock.calls.at(-1)![0])).toBe(urls.at(-1));
  });

  it("une tentative par adresse et par jour, même en échec", async () => {
    switches.on = true;
    const { log, info } = logger();
    answerAlways({ status: 403 });
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : échec"));
    queueEdgeColors(log, [THUMB, THUMB], PUBLIC);
    now.mockReturnValue(start + 23 * 60 * 60 * 1000);
    queueEdgeColors(log, [THUMB], PUBLIC);
    await settle();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    now.mockReturnValue(start + 25 * 60 * 60 * 1000);
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(2));
  });

  it("refusé avant toute connexion : adresse http, interne (résolue vers 10.0.0.5), réseau social", async () => {
    switches.on = true;
    const { log, info } = logger();
    queueEdgeColors(log, ["http://images.exemple.fr/a.png", "https://localhost/a.png", "https://scontent.cdninstagram.com/a.jpg"], PUBLIC);
    queueEdgeColors(log, ["https://interne.exemple.fr/a.png"], INTERNAL);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : échec"));
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(JSON.stringify(info.mock.calls)).not.toContain("interne.exemple.fr");
  });

  it("refusé : une image de plus de 1 Mo annoncée n'est pas lue", async () => {
    switches.on = true;
    const { log, info } = logger();
    answerNext({ status: 200, headers: { ...PNG, "content-length": String(2 * 1024 * 1024) }, body: whiteSquare });
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : échec"));
    expect(edgeColorFor(THUMB)).toBeUndefined();
  });

  it("une réponse de recherche : seulement les 12 premières propositions, dans l'ordre", async () => {
    switches.on = true;
    const { log } = logger();
    answerAlways({ status: 404 });
    const matches = Array.from({ length: 14 }, (_, i) => ({ imageUrl: `https://images.exemple.fr/${i}.png` }));
    queueSearchEdgeColors(log, { matches }, PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(12));
    await settle();
    expect(httpsRequest.mock.calls.map((call) => String(call[0]))).toEqual(matches.slice(0, 12).map((match) => match.imageUrl));
    queueSearchEdgeColors(log, null, PUBLIC);
  });
});

describe("correctifs de la relecture : durée tenue, empreinte, redirections, réponse qui annonce la mesure", () => {
  it("permis : une couleur gardée moins de 7 jours ; refusé : au-delà, effacée par le balayage SANS nouvelle visite de l'adresse", async () => {
    switches.on = true;
    const { log } = logger();
    answerNext({ status: 200, headers: PNG, body: whiteSquare });
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
    // Six jours plus tard : toujours là.
    sweepExpiredEdgeColors(start + 6 * 24 * 60 * 60 * 1000);
    expect(edgeColorFor(THUMB)).toBe("#ffffff");
    // Le balayage passe juste avant les 7 jours (une minute d'avance au plus), sans consulter l'adresse.
    sweepExpiredEdgeColors(start + EDGE_COLOR_TTL_MS - EDGE_COLOR_SWEEP_MS);
    now.mockReturnValue(start);
    expect(edgeColorFor(THUMB)).toBeUndefined();
  });

  it("refusé : une entrée « non mesurable » ne passe pas 1 jour ; le balayage tourne seul (minuterie qui ne retient pas le serveur)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      switches.on = true;
      const { log, info } = logger();
      answerNext({ status: 403 });
      queueEdgeColors(log, [THUMB], PUBLIC);
      await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : échec"));
      // Encore là après 23 h : une seule tentative par jour.
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);
      expect(queueEdgeColors(log, [THUMB], PUBLIC)).toBe(false);
      // Le jour passé, la minuterie seule l'a effacée : l'adresse peut être remesurée.
      vi.advanceTimersByTime(EDGE_COLOR_RETRY_MS - 23 * 60 * 60 * 1000);
      expect(queueEdgeColors(log, [THUMB], PUBLIC)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("permis : une couleur encore là 2 min avant les 7 jours ; refusé : effacée par la MINUTERIE seule à 30 s des 7 jours (aucune visite entre-temps)", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      switches.on = true;
      const { log } = logger();
      answerNext({ status: 200, headers: PNG, body: whiteSquare });
      queueEdgeColors(log, [THUMB], PUBLIC);
      await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
      vi.advanceTimersByTime(EDGE_COLOR_TTL_MS - 2 * 60_000);
      expect(edgeColorFor(THUMB)).toBe("#ffffff");
      // 90 s de plus, sans queueEdgeColors ni edgeColorFor : à cet âge la lecture
      // la croirait encore fraîche, seul le balayage de la minuterie a pu l'effacer.
      vi.advanceTimersByTime(90_000);
      expect(edgeColorFor(THUMB)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("le cache ne garde jamais l'adresse en clair : une empreinte SHA-256 seulement", () => {
    const source = readFileSync(join(__dirname, "../src/lib/edgeColor.ts"), "utf8");
    expect(source).toContain('createHash("sha256").update(imageUrl).digest("base64url")');
    expect(source).toContain("cache.set(key, { color, at: now });");
    expect(source).not.toMatch(/cache\.(set|get|delete)\(imageUrl/);
    expect(source).toContain("pending.add(keyOf(imageUrl));");
  });

  it("refusé : une vignette qui redirige vers un réseau social n'est jamais appelée là-bas (échec) ; permis : une redirection ordinaire", async () => {
    switches.on = true;
    const { log, info } = logger();
    answerNext({ status: 302, headers: { location: "https://scontent.cdninstagram.com/v/photo.jpg" } });
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith("Couleur des bords : échec"));
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(String(httpsRequest.mock.calls[0]![0])).toBe(THUMB);
    const other = "https://images.exemple.fr/veste.png";
    answerNext({ status: 302, headers: { location: "https://cdn.exemple.fr/veste.png" } });
    answerNext({ status: 200, headers: PNG, body: whiteSquare });
    queueEdgeColors(log, [other], PUBLIC);
    await vi.waitFor(() => expect(edgeColorFor(other)).toBe("#ffffff"));
    expect(String(httpsRequest.mock.calls.at(-1)![0])).toBe("https://cdn.exemple.fr/veste.png");
  });

  it("la file dit si elle a vraiment mis une vignette en file : refusé (éteint, déjà en cache, rien de mesurable) → false ; permis → true", async () => {
    const { log } = logger();
    expect(queueSearchEdgeColors(log, { matches: [{ imageUrl: THUMB }] }, PUBLIC)).toBe(false);
    switches.on = true;
    answerNext({ status: 200, headers: PNG, body: whiteSquare });
    expect(queueSearchEdgeColors(log, { matches: [{ imageUrl: "http://images.exemple.fr/a.png" }] }, PUBLIC)).toBe(false);
    expect(queueSearchEdgeColors(log, { matches: [{ imageUrl: THUMB }] }, PUBLIC)).toBe(true);
    // Déjà en file, puis déjà en cache : rien de neuf.
    expect(queueSearchEdgeColors(log, { matches: [{ imageUrl: THUMB }] }, PUBLIC)).toBe(false);
    await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
    expect(queueSearchEdgeColors(log, { matches: [{ imageUrl: THUMB }] }, PUBLIC)).toBe(false);
  });

  it("les trois réponses de recherche n'ajoutent edgeColorsPending que si une vignette vient d'être mise en file", () => {
    const searches = readFileSync(join(__dirname, "../src/routes/searches.ts"), "utf8");
    expect(searches.match(/queueSearchEdgeColors\(request\.log, (outcome|full|reread)\) \? \{ \.\.\.(outcome|full|reread), edgeColorsPending: true \} : (outcome|full|reread)/g)).toHaveLength(3);
  });
});

describe("Envies et Vault : seulement l'image encore celle du résultat", () => {
  const MATCH = "f0000000-0000-4000-8000-000000000001";
  const PERSONAL = "f0000000-0000-4000-8000-000000000002";

  it("permis : la vignette du résultat ; refusé : photo personnelle, ajout à la main", async () => {
    switches.on = true;
    const { log } = logger();
    const fake = fakeSupabase();
    fake.table("product_matches").push({ id: MATCH, image_url: THUMB }, { id: PERSONAL, image_url: "https://images.exemple.fr/resultat.png" });
    answerAlways({ status: 200, headers: PNG, body: whiteSquare });
    queueKeptEdgeColors(
      { supabaseAdmin: fake.db } as unknown as FastifyInstance,
      log,
      [
        { product_match_id: MATCH, image_url: THUMB },
        // « Changer la photo » : la pièce ne montre plus l'image du résultat.
        { product_match_id: PERSONAL, image_url: "https://x.supabase.co/storage/v1/object/public/vault-media/a/photo.jpg" },
        { product_match_id: null, image_url: "https://x.supabase.co/storage/v1/object/public/vault-media/a/main.jpg" },
      ],
      PUBLIC
    );
    expect(httpsRequest).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
    await settle();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("refusé : éteint, ni la base ni l'image ne sont lues ; une base en échec ne fait rien échouer", async () => {
    const { log } = logger();
    const from = vi.fn();
    queueKeptEdgeColors({ supabaseAdmin: { from } } as unknown as FastifyInstance, log, [{ product_match_id: MATCH, image_url: THUMB }], PUBLIC);
    await settle();
    expect(from).not.toHaveBeenCalled();
    switches.on = true;
    const broken = { supabaseAdmin: { from: () => { throw new Error("base"); } } } as unknown as FastifyInstance;
    expect(() => queueKeptEdgeColors(broken, log, [{ product_match_id: MATCH, image_url: THUMB }], PUBLIC)).not.toThrow();
    await settle();
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});

describe("réponses : le champ facultatif edgeColor", () => {
  const SEARCH: SearchRow = {
    id: "recherche-1",
    user_id: "membre-1",
    source_url: null,
    source_platform: "photo",
    method: "manual_screenshot",
    screenshot_url: null,
    status: "completed",
    error_message: null,
    query: null,
    created_at: "2026-11-20T10:00:00.000Z",
    refused_before_call: 0,
    failure_kind: null,
    provider: "serpapi",
    run_started_at: "2026-11-20T10:00:00.000Z",
  };
  const match = (rank: number, imageUrl: string): MatchRow => ({
    id: `p${rank}`,
    search_id: SEARCH.id,
    rank,
    product_name: `Veste ${rank}`,
    brand: null,
    image_url: imageUrl,
    image_hd_url: null,
    price_min: "90.00",
    price_max: "90.00",
    currency: "EUR",
    merchant_name: "Boutique",
    merchant_url: `https://boutique-${rank}.fr/veste`,
  });
  const rows = [match(1, THUMB), match(2, "https://images.exemple.fr/2.png")];

  it("éteint : réponse identique, au champ près (aucun edgeColor)", () => {
    const search = toProductSearch(SEARCH, rows, new Map(), new Map());
    expect(search.matches.some((m) => "edgeColor" in m)).toBe(false);
    expect(edgeColorField(THUMB)).toEqual({});
  });

  it("permis : présent seulement pour la vignette mesurée et uniforme ; absent pour les autres", async () => {
    switches.on = true;
    const { log } = logger();
    answerNext({ status: 200, headers: PNG, body: whiteSquare });
    queueEdgeColors(log, [THUMB], PUBLIC);
    await vi.waitFor(() => expect(edgeColorFor(THUMB)).toBe("#ffffff"));
    const search = toProductSearch(SEARCH, rows, new Map(), new Map());
    expect(search.matches.find((m) => m.id === "p1")!.edgeColor).toBe("#ffffff");
    expect("edgeColor" in search.matches.find((m) => m.id === "p2")!).toBe(false);
    // Coupé ensuite : plus rien n'est servi, même en cache.
    switches.on = false;
    expect(toProductSearch(SEARCH, rows, new Map(), new Map()).matches.some((m) => "edgeColor" in m)).toBe(false);
  });
});

describe("branchement dans les routes (lecture du code)", () => {
  const read = (file: string) => readFileSync(join(__dirname, "../src", file), "utf8");

  it("les réponses de recherche complètes mettent en file (lancement, compléments, relecture), après avoir préparé la réponse", () => {
    const searches = read("routes/searches.ts");
    expect(searches.match(/queueSearchEdgeColors\(request\.log, /g)).toHaveLength(3);
    expect(read("lib/searchRows.ts")).toContain("...edgeColorField(m.image_url),");
  });

  it("les listes et les fiches des Envies et du Vault servent la couleur et mettent en file", () => {
    for (const file of ["routes/wishlist.ts", "routes/vault.ts"]) {
      const source = read(file);
      expect(source.match(/queueKeptEdgeColors\(fastify, request\.log, /g), file).toHaveLength(2);
      expect(source.match(/edgeColorField\(/g), file).toHaveLength(2);
    }
  });

  it("aucune écriture dans la base, aucune autre route", () => {
    // L'empreinte de l'adresse (node:crypto, createHash(...).update) n'est pas une écriture dans la base.
    const source = read("lib/edgeColor.ts").replace('createHash("sha256").update(imageUrl)', "");
    expect(source).not.toMatch(/\.(insert|update|upsert)\(/);
    expect(source).not.toMatch(/\.rpc\(/);
    // Une seule lecture : l'image du résultat, pour écarter les photos personnelles.
    expect(source.match(/\.from\(/g)).toHaveLength(1);
    expect(source).toContain('.from("product_matches")\n          .select("id, image_url")');
  });
});
