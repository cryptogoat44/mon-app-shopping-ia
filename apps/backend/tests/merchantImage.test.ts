import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 2 (« la qualité des images quand elles sont grossies est
// nulle ») : la grande image lue sur la page publique de la boutique, derrière
// MERCHANT_IMAGE_UPGRADE_ENABLED (éteint par défaut). SANS base ni réseau :
// les résolutions de noms et les réponses des sites sont simulées, la base est
// en mémoire.
const { httpsRequest, switches } = vi.hoisted(() => ({ httpsRequest: vi.fn(), switches: { on: false } }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));
// Les routes n'injectent pas de résolveur : la résolution de noms est simulée
// (adresse publique), pour qu'aucune ne parte vraiment.
vi.mock("node:dns/promises", () => {
  const lookup = async () => [{ address: "93.184.215.14", family: 4 }];
  return { lookup, default: { lookup } };
});
vi.mock("../src/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/env.js")>();
  return {
    env: new Proxy(original.env, {
      get: (target, key) => (key === "MERCHANT_IMAGE_UPGRADE_ENABLED" ? switches.on : target[key as keyof typeof target]),
    }),
  };
});

import type { Resolver } from "../src/lib/publicImage.js";
import {
  MERCHANT_PAGE_MAX_BYTES,
  PAGE_REQUEST_HEADERS,
  extractMerchantImageUrl,
  fetchMerchantPage,
  isMerchantPage,
  isUsableLargeImage,
  MERCHANT_QUEUE_MAX,
  queueMerchantImages,
  resetMerchantImageMemory,
  upgradeMerchantImage,
  upgradeMerchantImageLater,
} from "../src/lib/merchantImage.js";
import { fakeSupabase } from "./fakeSupabase.js";
import rateLimitPlugin from "../src/plugins/rateLimit.js";
import moderationPlugin from "../src/plugins/moderation.js";
import wishlistRoutes from "../src/routes/wishlist.js";
import vaultRoutes from "../src/routes/vault.js";

const PAGE = "https://boutique.example/veste";
const PUBLIC: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];
const INTERNAL: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];

type Answer = { status: number; headers?: Record<string, string>; body?: Buffer | Buffer[] } | Error;

function answerNext(answer: Answer) {
  httpsRequest.mockImplementationOnce(
    (_url: URL, options: { lookup: (host: string, opts: object, done: () => void) => void }, callback: (response: Readable) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          setImmediate(() => {
            if (answer instanceof Error) req.emit("error", answer);
            else {
              const chunks = answer.body ? (Array.isArray(answer.body) ? answer.body : [answer.body]) : [];
              callback(Object.assign(Readable.from(chunks), { statusCode: answer.status, headers: answer.headers ?? {} }));
            }
          });
        },
      });
      void options;
      return req;
    }
  );
}

const HTML = { "content-type": "text/html; charset=utf-8" };
const JPEG = { "content-type": "image/jpeg" };
const page = (head: string) => Buffer.from(`<!doctype html><html><head>${head}</head><body>…</body></html>`);

let portrait: Buffer;
let small: Buffer;
let banner: Buffer;
beforeAll(async () => {
  const make = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: "#203040" } }).jpeg().toBuffer();
  [portrait, small, banner] = await Promise.all([make(800, 1000), make(240, 300), make(1500, 400)]);
});

beforeEach(() => {
  httpsRequest.mockReset();
  resetMerchantImageMemory();
  switches.on = false;
});

describe("adresse de la grande image annoncée par la page", () => {
  it("og:image d'abord (entités décodées, adresse relative rendue absolue)", () => {
    const html = `<meta name="twitter:image" content="https://cdn.example/t.jpg"><meta property="og:image" content="/media/veste.jpg?w=1600&amp;h=2000">`;
    expect(extractMerchantImageUrl(html, PAGE)).toBe("https://boutique.example/media/veste.jpg?w=1600&h=2000");
  });

  it("twitter:image quand og:image manque ; adresse « //cdn » en https", () => {
    expect(extractMerchantImageUrl(`<meta content='//cdn.example/t.jpg' name='twitter:image'>`, PAGE)).toBe("https://cdn.example/t.jpg");
  });

  it("l'image du produit en JSON-LD : texte, tableau, objet, @graph", () => {
    const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
    expect(extractMerchantImageUrl(ld({ "@type": "Product", image: "https://cdn.example/a.jpg" }), PAGE)).toBe("https://cdn.example/a.jpg");
    expect(extractMerchantImageUrl(ld({ "@type": ["Product"], image: ["https://cdn.example/b.jpg", "https://cdn.example/c.jpg"] }), PAGE)).toBe(
      "https://cdn.example/b.jpg"
    );
    expect(extractMerchantImageUrl(ld({ "@graph": [{ "@type": "WebSite" }, { "@type": "Product", image: { url: "https://cdn.example/d.jpg" } }] }), PAGE)).toBe(
      "https://cdn.example/d.jpg"
    );
    // Pas un produit : rien.
    expect(extractMerchantImageUrl(ld({ "@type": "Organization", image: "https://cdn.example/logo.jpg" }), PAGE)).toBeNull();
    // JSON illisible : ignoré, sans erreur.
    expect(extractMerchantImageUrl(`<script type="application/ld+json">{oups</script>`, PAGE)).toBeNull();
  });

  it("refusé : http://, data:, localhost, identifiants, port inhabituel (le candidat suivant est pris)", () => {
    for (const bad of ["http://cdn.example/a.jpg", "data:image/png;base64,AAAA", "https://localhost/a.jpg", "https://u:p@cdn.example/a.jpg", "https://cdn.example:8443/a.jpg"]) {
      expect(extractMerchantImageUrl(`<meta property="og:image" content="${bad}">`, PAGE), bad).toBeNull();
    }
    expect(extractMerchantImageUrl(`<meta property="og:image" content="http://cdn.example/a.jpg"><meta name="twitter:image" content="https://cdn.example/t.jpg">`, PAGE)).toBe(
      "https://cdn.example/t.jpg"
    );
  });

  it("refusé : une page hostile de 512 Ko (balises jamais fermées) est lue en moins de 100 ms, sans image", () => {
    const size = 512 * 1024;
    const metas = "<meta ".repeat(Math.ceil(size / 6)).slice(0, size);
    const scripts = `<script type="application/ld+json">`.repeat(Math.ceil(size / 35)).slice(0, size);
    for (const html of [metas, scripts]) {
      const started = performance.now();
      expect(extractMerchantImageUrl(html, PAGE)).toBeNull();
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it("refusé : une balise <meta> géante (512 Ko de lettres) ou 128 balises de 4 Ko sont lues en moins de 100 ms, sans image", () => {
    const giant = `<meta ${"a".repeat(512 * 1024)}>`;
    const many = `<meta ${"a".repeat(4000)}>`.repeat(128);
    for (const html of [giant, many]) {
      const started = performance.now();
      expect(extractMerchantImageUrl(html, PAGE)).toBeNull();
      expect(performance.now() - started).toBeLessThan(100);
    }
  });

  it("permis : og:image est trouvée après une balise <meta> géante, et sans blanc entre les attributs", () => {
    expect(extractMerchantImageUrl(`<meta ${"a".repeat(512 * 1024)}><meta property="og:image" content="https://cdn.example/g.jpg">`, PAGE)).toBe(
      "https://cdn.example/g.jpg"
    );
    expect(extractMerchantImageUrl(`<meta property="og:image"content='https://cdn.example/h.jpg'/>`, PAGE)).toBe("https://cdn.example/h.jpg");
  });

  it("refusé : des milliers de blocs JSON-LD ouverts et un seul </script> final sont lus en moins de 100 ms", () => {
    const opening = `<script type="application/ld+json">`;
    const html = opening.repeat(Math.floor((512 * 1024 - 9) / opening.length)) + "</script>";
    const started = performance.now();
    expect(extractMerchantImageUrl(html, PAGE)).toBeNull();
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("permis : un « İ » avant le bloc JSON-LD ne coupe pas le bloc au mauvais endroit ; </script > et </SCRIPT> ferment le bloc", () => {
    const product = `{"@type":"Product","image":"https://cdn.example/e.jpg"}`;
    expect(extractMerchantImageUrl(`<p>İİ</p><script type="application/ld+json">${product}</script>`, PAGE)).toBe("https://cdn.example/e.jpg");
    expect(extractMerchantImageUrl(`<p>İ</p><script type="application/ld+json">${product}</SCRIPT >`, PAGE)).toBe("https://cdn.example/e.jpg");
  });

  it("permis : après un bloc JSON-LD illisible ou une balise <meta coupée, l'image suivante est trouvée", () => {
    expect(
      extractMerchantImageUrl(`<meta property="og:title" content="x"<meta property="og:image" content="https://cdn.example/m.jpg">`, PAGE)
    ).toBe("https://cdn.example/m.jpg");
    expect(
      extractMerchantImageUrl(
        `<SCRIPT type="application/ld+json">{oups</SCRIPT><script type='application/ld+json'>{"@type":"Product","image":"https://cdn.example/e.jpg"}</script>`,
        PAGE
      )
    ).toBe("https://cdn.example/e.jpg");
  });

  it("page de la boutique : https seulement, jamais une page de Google", () => {
    expect(isMerchantPage(PAGE)).toBe(true);
    expect(isMerchantPage("http://boutique.example/veste")).toBe(false);
    expect(isMerchantPage("https://www.google.com/shopping/product/123")).toBe(false);
    expect(isMerchantPage("https://www.google.fr/search?q=veste")).toBe(false);
    expect(isMerchantPage(null)).toBe(false);
  });
});

describe("lecture de la page", () => {
  it("permis : du HTML, lu par notre robot honnête, sans cookie ni referer", async () => {
    answerNext({ status: 200, headers: HTML, body: page(`<meta property="og:image" content="https://cdn.example/a.jpg">`) });
    const result = await fetchMerchantPage(PAGE, PUBLIC);
    expect(extractMerchantImageUrl(result.html, result.url)).toBe("https://cdn.example/a.jpg");
    const headers = httpsRequest.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers).toEqual(PAGE_REQUEST_HEADERS);
    expect(Object.keys(headers).sort()).toEqual(["accept", "user-agent"]);
    expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0 \(compatible; Spotto\/1\.0; \+https:\/\/[^ )]+\)$/);
  });

  it("refusé : ce qui n'est pas une page HTML", async () => {
    answerNext({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") });
    await expect(fetchMerchantPage(PAGE, PUBLIC)).rejects.toThrow("Ce n'est pas une page");
  });

  it("refusé : une adresse interne, avant toute connexion", async () => {
    await expect(fetchMerchantPage(PAGE, INTERNAL)).rejects.toThrow("Adresse interne refusée");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("refusé : une redirection vers une adresse interne", async () => {
    answerNext({ status: 302, headers: { location: "https://169.254.169.254/latest" } });
    await expect(fetchMerchantPage(PAGE, PUBLIC)).rejects.toThrow("Adresse interne refusée");
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("512 Ko lus au plus : une image annoncée plus loin n'est pas vue", async () => {
    const filler = Buffer.alloc(MERCHANT_PAGE_MAX_BYTES, " ");
    answerNext({ status: 200, headers: HTML, body: [filler, Buffer.from(`<meta property="og:image" content="https://cdn.example/loin.jpg">`)] });
    const far = await fetchMerchantPage(PAGE, PUBLIC);
    expect(far.html.length).toBeLessThanOrEqual(MERCHANT_PAGE_MAX_BYTES);
    expect(extractMerchantImageUrl(far.html, far.url)).toBeNull();
  });
});

describe("l'image trouvée doit être grande et une vraie photo", () => {
  it("permis : une photo de 800 × 1000", async () => {
    expect(await isUsableLargeImage(portrait)).toBe(true);
  });
  it("refusé : trop petite, bannière, pas une image, SVG", async () => {
    expect(await isUsableLargeImage(small)).toBe(false);
    expect(await isUsableLargeImage(banner)).toBe(false);
    expect(await isUsableLargeImage(Buffer.from("<html></html>"))).toBe(false);
    expect(await isUsableLargeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>'))).toBe(false);
  });
});

const MATCH = "f0000000-0000-4000-8000-000000000007";
const THUMB = "https://encrypted-tbn0.gstatic.com/images?q=tbn:veste";
const FOUND = "https://cdn.example/veste-1600.jpg";
const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;

function store(match: Record<string, unknown> = {}) {
  const fake = fakeSupabase();
  fake.table("product_matches").push({ id: MATCH, image_url: THUMB, image_hd_url: null, merchant_url: PAGE, ...match });
  return { fake, fastify: { supabaseAdmin: fake.db } as unknown as FastifyInstance };
}

const piece = { product_match_id: MATCH, image_url: THUMB };
const shopAnswers = (image: Buffer = portrait) => {
  answerNext({ status: 200, headers: HTML, body: page(`<meta property="og:image" content="${FOUND}">`) });
  answerNext({ status: 200, headers: JPEG, body: image });
};

describe("l'écriture de la grande image", () => {
  it("éteint (par défaut) : rien n'est lu ni écrit, aucune requête", async () => {
    const { fake, fastify } = store();
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("off");
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(fake.table("product_matches")[0]!.image_hd_url).toBeNull();
  });

  it("allumé : écrite quand la colonne est vide", async () => {
    switches.on = true;
    const { fake, fastify } = store();
    shopAnswers();
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("written");
    expect(fake.table("product_matches")[0]!.image_hd_url).toBe(FOUND);
  });

  it("refusé : une image HD déjà là n'est jamais remplacée (et rien n'est lu)", async () => {
    switches.on = true;
    const { fake, fastify } = store({ image_hd_url: "https://boutique.example/hd.jpg" });
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("skipped");
    expect(await upgradeMerchantImage(fastify, log, { ...piece }, "https://boutique.example/hd.jpg", PUBLIC)).toBe("skipped");
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(fake.table("product_matches")[0]!.image_hd_url).toBe("https://boutique.example/hd.jpg");
  });

  it("refusé : une photo personnelle (« Changer la photo ») ou une pièce sans résultat", async () => {
    switches.on = true;
    const { fastify } = store();
    expect(await upgradeMerchantImage(fastify, log, { ...piece, image_url: "https://x.supabase.co/vault-media/a/photo.jpg" }, null, PUBLIC)).toBe("skipped");
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: null, image_url: THUMB }, null, PUBLIC)).toBe("skipped");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("refusé : une fiche Google Shopping n'est jamais lue", async () => {
    switches.on = true;
    const { fastify } = store({ merchant_url: "https://www.google.com/shopping/product/1" });
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("skipped");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("refusé : une image trop petite n'est pas écrite", async () => {
    switches.on = true;
    const { fake, fastify } = store();
    shopAnswers(small);
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("none");
    expect(fake.table("product_matches")[0]!.image_hd_url).toBeNull();
  });

  it("une boutique qui refuse notre robot (403) : rien, sans erreur, et pas de nouvel essai le même jour", async () => {
    switches.on = true;
    const { fake, fastify } = store();
    answerNext({ status: 403 });
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("none");
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("skipped");
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(fake.table("product_matches")[0]!.image_hd_url).toBeNull();
    // Le journal ne porte jamais l'adresse de la page ni de l'image.
    expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain("boutique.example");
  });

  it("une lecture à la fois : une seconde demande simultanée est GARDÉE en file, puis lue après la première (retours du build 3)", async () => {
    switches.on = true;
    const { fake, fastify } = store();
    const other = "f0000000-0000-4000-8000-000000000008";
    fake.table("product_matches").push({ id: other, image_url: THUMB, image_hd_url: null, merchant_url: "https://autre.example/pull" });
    shopAnswers();
    shopAnswers();
    const first = upgradeMerchantImage(fastify, log, piece, null, PUBLIC);
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: other, image_url: THUMB }, null, PUBLIC)).toBe("queued");
    // Pendant la première lecture, une seule page est demandée.
    expect(httpsRequest).toHaveBeenCalledTimes(0);
    expect(await first).toBe("written");
    await vi.waitFor(() => expect(fake.table("product_matches")[1]!.image_hd_url).toBe(FOUND));
    expect(httpsRequest).toHaveBeenCalledTimes(4);
  });

  it("une base en échec ne fait jamais échouer l'appelant", async () => {
    switches.on = true;
    const fastify = {
      supabaseAdmin: {
        from: () => {
          throw new Error("base injoignable");
        },
      },
    } as unknown as FastifyInstance;
    await expect(upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).resolves.toBe("none");
  });

  it("lancement après la réponse : rien quand c'est éteint ou que l'image HD existe", () => {
    const fastify = { supabaseAdmin: { from: vi.fn() } } as unknown as FastifyInstance;
    upgradeMerchantImageLater(fastify, log, piece, null);
    switches.on = true;
    upgradeMerchantImageLater(fastify, log, piece, "https://boutique.example/hd.jpg");
    upgradeMerchantImageLater(fastify, log, { product_match_id: null, image_url: THUMB }, null);
    expect((fastify.supabaseAdmin as unknown as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});

// La file (retours du build 3) : rien n'est plus abandonné quand le serveur
// est occupé. Les résultats absents de la base sont lus vite (« skipped »)
// et prennent quand même leur créneau de la minute : ils servent à compter.
describe("la file des pièces gardées ou achetées", () => {
  const id = (n: number) => `f0000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done));
  };
  function counting() {
    const fake = fakeSupabase();
    const from = vi.fn((table: string) => fake.db.from(table));
    return { fake, from, fastify: { supabaseAdmin: { from } } as unknown as FastifyInstance };
  }
  // Une lecture qui ne répond pas tout de suite : la page de la boutique est retenue.
  function holdPage(): () => void {
    let release: () => void = () => undefined;
    httpsRequest.mockImplementationOnce((_url: URL, _options: unknown, callback: (response: Readable) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          release = () => callback(Object.assign(Readable.from([]), { statusCode: 404, headers: {} }));
        },
      });
      return req;
    });
    return () => release();
  }

  it("refusé : pas de doublon — un résultat déjà en file ou en cours de lecture est ignoré", async () => {
    switches.on = true;
    const { fastify } = store();
    const release = holdPage();
    const first = upgradeMerchantImage(fastify, log, piece, null, PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(1));
    expect(await upgradeMerchantImage(fastify, log, piece, null, PUBLIC)).toBe("skipped");
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: id(1), image_url: THUMB }, null, PUBLIC)).toBe("queued");
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: id(1), image_url: THUMB }, null, PUBLIC)).toBe("skipped");
    switches.on = false;
    release();
    expect(await first).toBe("none");
  });

  it(`refusé : au-delà de ${MERCHANT_QUEUE_MAX} demandes en attente, la suivante est ignorée`, async () => {
    switches.on = true;
    const { fastify } = store();
    const release = holdPage();
    const first = upgradeMerchantImage(fastify, log, piece, null, PUBLIC);
    await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(1));
    for (let n = 1; n <= MERCHANT_QUEUE_MAX; n++) {
      expect(await upgradeMerchantImage(fastify, log, { product_match_id: id(n), image_url: THUMB }, null, PUBLIC)).toBe("queued");
    }
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: id(MERCHANT_QUEUE_MAX + 1), image_url: THUMB }, null, PUBLIC)).toBe("skipped");
    // Interrupteur coupé pendant l'attente : la file est vidée sans rien lire.
    switches.on = false;
    release();
    await first;
    await flush();
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });

  it("12 lectures par minute au plus : la 13ᵉ attend la minute suivante, puis est lue (rien n'est perdu)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      switches.on = true;
      const { from, fastify } = counting();
      const results = await Promise.all(Array.from({ length: 13 }, (_, n) => upgradeMerchantImage(fastify, log, { product_match_id: id(n), image_url: THUMB }, null, PUBLIC)));
      expect(results.filter((r) => r === "queued")).toHaveLength(12);
      await flush();
      expect(from).toHaveBeenCalledTimes(12);
      await vi.advanceTimersByTimeAsync(59_000);
      await flush();
      expect(from).toHaveBeenCalledTimes(12);
      await vi.advanceTimersByTimeAsync(1_000);
      await flush();
      expect(from).toHaveBeenCalledTimes(13);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listes des Envies et du Vault : mise en file", () => {
  const OTHER = "f0000000-0000-4000-8000-000000000009";
  const PERSONAL = "f0000000-0000-4000-8000-000000000010";

  it("permis : seule la pièce sans grande image, rattachée à un résultat et montrant son image, est lue et rangée", async () => {
    switches.on = true;
    const { fake } = store();
    fake.table("product_matches").push(
      { id: OTHER, image_url: THUMB, image_hd_url: "https://cdn.example/deja-hd.jpg", merchant_url: "https://autre.example/a" },
      { id: PERSONAL, image_url: THUMB, image_hd_url: null, merchant_url: "https://perso.example/b" }
    );
    // Chaque requête à la base est comptée : la photo personnelle ne doit même
    // pas entrer dans la file (aucune lecture à elle seule).
    const from = vi.fn((table: string) => fake.db.from(table));
    const fastify = { supabaseAdmin: { from } } as unknown as FastifyInstance;
    shopAnswers();
    queueMerchantImages(
      fastify,
      log,
      [
        piece,
        // Déjà servie en HD : jamais mise en file.
        { product_match_id: OTHER, image_url: THUMB },
        // Photo personnelle (« Changer la photo ») : jamais mise en file.
        { product_match_id: PERSONAL, image_url: "https://x.supabase.co/vault-media/a/photo.jpg" },
        // Ajout à la main, sans résultat.
        { product_match_id: null, image_url: "https://x.supabase.co/vault-media/a/main.jpg" },
      ],
      [null, "https://cdn.example/deja-hd.jpg", null, null],
      PUBLIC
    );
    // Rien avant la réponse : tout part après.
    expect(httpsRequest).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(fake.table("product_matches")[0]!.image_hd_url).toBe(FOUND));
    await new Promise((done) => setTimeout(done, 20));
    expect(httpsRequest).toHaveBeenCalledTimes(2);
    expect(String(httpsRequest.mock.calls[0]![0])).toBe(PAGE);
    expect(fake.table("product_matches")[2]!.image_hd_url).toBeNull();
    // Une lecture groupée de la page, puis la pièce retenue : relue et écrite.
    expect(from).toHaveBeenCalledTimes(3);
  });

  it("refusé : éteint, rien n'est lu (ni la base ni la boutique)", async () => {
    const from = vi.fn();
    queueMerchantImages({ supabaseAdmin: { from } } as unknown as FastifyInstance, log, [piece], [null], PUBLIC);
    await new Promise((done) => setTimeout(done, 20));
    expect(from).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("une base en échec ou des lignes illisibles ne font jamais échouer la liste", async () => {
    switches.on = true;
    const broken = { supabaseAdmin: { from: () => { throw new Error("base injoignable"); } } } as unknown as FastifyInstance;
    expect(() => queueMerchantImages(broken, log, [piece], [null], PUBLIC)).not.toThrow();
    const hostile = new Proxy([], { get: () => { throw new Error("illisible"); } }) as unknown as typeof piece[];
    expect(() => queueMerchantImages(broken, log, hostile, [], PUBLIC)).not.toThrow();
    await new Promise((done) => setTimeout(done, 20));
    expect(httpsRequest).not.toHaveBeenCalled();
  });
});

// Les vraies routes GET /api/wishlist et GET /api/vault sur une fausse base.
describe("GET /api/wishlist et GET /api/vault : la liste met en file, après la réponse", () => {
  const ALICE = "a0000000-0000-4000-8000-000000000001";
  const PERSONAL = "f0000000-0000-4000-8000-000000000011";
  const HD_MATCH = "f0000000-0000-4000-8000-000000000012";

  async function listApp(db: unknown): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
    app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
    app.decorateRequest("user", null);
    app.decorate("requireAuth", async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.headers["x-test-user"];
      if (typeof user !== "string") return reply.code(401).send({ error: "unauthorized", message: "Jeton manquant." });
      request.user = { id: user, email: null };
    });
    await app.register(rateLimitPlugin);
    await app.register(moderationPlugin);
    await app.register(wishlistRoutes);
    await app.register(vaultRoutes);
    await app.ready();
    return app;
  }

  function seeded(table: "wishlist_items" | "vault_items") {
    const { fake } = store();
    fake.table("profiles").push({ id: ALICE, username: "alice", locale: "fr" });
    fake.table("product_matches").push(
      { id: PERSONAL, image_url: THUMB, image_hd_url: null, merchant_url: "https://perso.example/a" },
      { id: HD_MATCH, image_url: THUMB, image_hd_url: "https://cdn.example/deja-hd.jpg", merchant_url: "https://hd.example/b" }
    );
    const base = { user_id: ALICE, title: "Veste", brand: null, price: null, currency: null, merchant_url: PAGE, merchant_name: "Boutique" };
    fake.table(table).push(
      { ...base, id: "b0000000-0000-4000-8000-000000000001", image_url: THUMB, product_match_id: MATCH, created_at: "2026-11-20T10:00:03+00:00" },
      { ...base, id: "b0000000-0000-4000-8000-000000000002", image_url: "https://x.supabase.co/vault-media/a/photo.jpg", product_match_id: PERSONAL, created_at: "2026-11-20T10:00:02+00:00" },
      { ...base, id: "b0000000-0000-4000-8000-000000000003", image_url: THUMB, product_match_id: HD_MATCH, created_at: "2026-11-20T10:00:01+00:00" },
      { ...base, id: "b0000000-0000-4000-8000-000000000004", image_url: "https://x.supabase.co/vault-media/a/main.jpg", product_match_id: null, created_at: "2026-11-20T10:00:00+00:00" }
    );
    return fake;
  }

  for (const [url, table] of [
    ["/api/wishlist", "wishlist_items"],
    ["/api/vault", "vault_items"],
  ] as const) {
    it(`permis : ${url} répond sans attendre, puis seule la pièce sans grande image d'un résultat est lue ; refusé : photo personnelle, pièce déjà HD, ajout à la main`, async () => {
      switches.on = true;
      const fake = seeded(table);
      // La page ne répond pas avant la réponse de la liste.
      answerNext({ status: 403 });
      const app = await listApp(fake.db);
      try {
        const res = await app.inject({ method: "GET", url, headers: { "x-test-user": ALICE } });
        expect(res.statusCode).toBe(200);
        expect(res.json().items).toHaveLength(4);
        await vi.waitFor(() => expect(httpsRequest).toHaveBeenCalledTimes(1));
        await new Promise((done) => setTimeout(done, 20));
        expect(httpsRequest).toHaveBeenCalledTimes(1);
        expect(String(httpsRequest.mock.calls[0]![0])).toBe(PAGE);
      } finally {
        await app.close();
      }
    });

    it(`refusé : ${url} avec l'interrupteur éteint ne lit aucune page`, async () => {
      const app = await listApp(seeded(table).db);
      try {
        const res = await app.inject({ method: "GET", url, headers: { "x-test-user": ALICE } });
        expect(res.statusCode).toBe(200);
        await new Promise((done) => setTimeout(done, 20));
        expect(httpsRequest).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  }
});

describe("branchement dans les routes (lecture du code)", () => {
  const read = (file: string) => readFileSync(join(__dirname, "..", "src", file), "utf8");
  it("« Garder », la fiche d'une envie, « Je l'ai achetée » et la fiche du Vault la lancent, sans l'attendre", () => {
    const wishlist = read("routes/wishlist.ts");
    const vault = read("routes/vault.ts");
    expect(wishlist.match(/upgradeMerchantImageLater\(/g)).toHaveLength(2);
    expect(vault.match(/upgradeMerchantImageLater\(/g)).toHaveLength(2);
    expect(wishlist + vault).not.toMatch(/await upgradeMerchantImage/);
  });

  // Remplace « la liste … ne lit jamais de page de boutique » (retours du
  // build 3) : la liste MET EN FILE, une fois, après avoir préparé la réponse,
  // sans l'attendre, et ne lance jamais une lecture elle-même.
  it("les listes des Envies et du Vault mettent en file une fois, après avoir préparé la réponse, sans attendre ni lire elles-mêmes", () => {
    const wishlist = read("routes/wishlist.ts");
    const vault = read("routes/vault.ts");
    const lists = [
      wishlist.slice(wishlist.indexOf('fastify.get("/api/wishlist"'), wishlist.indexOf('fastify.post("/api/wishlist"')),
      vault.slice(vault.indexOf('fastify.get("/api/vault"'), vault.indexOf('fastify.get("/api/vault/:id"')),
    ];
    for (const list of lists) {
      expect(list).not.toContain("upgradeMerchantImage");
      expect(list.match(/queueMerchantImages\(fastify, request\.log, pageRows, hdUrls\);/g)).toHaveLength(1);
      expect(list).not.toMatch(/await queueMerchantImages/);
      const queued = list.indexOf("queueMerchantImages(");
      expect(list.indexOf("const items = pageRows.map(")).toBeGreaterThan(-1);
      expect(list.indexOf("const items = pageRows.map(")).toBeLessThan(queued);
      expect(queued).toBeLessThan(list.indexOf("return reply.send({ items"));
    }
  });
});
