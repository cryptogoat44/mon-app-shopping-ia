import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Retours du build 2 (« la qualité des images quand elles sont grossies est
// nulle ») : la grande image lue sur la page publique de la boutique, derrière
// MERCHANT_IMAGE_UPGRADE_ENABLED (éteint par défaut). SANS base ni réseau :
// les résolutions de noms et les réponses des sites sont simulées, la base est
// en mémoire.
const { httpsRequest, switches } = vi.hoisted(() => ({ httpsRequest: vi.fn(), switches: { on: false } }));
vi.mock("node:https", () => ({ default: { request: httpsRequest } }));
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
  resetMerchantImageMemory,
  upgradeMerchantImage,
  upgradeMerchantImageLater,
} from "../src/lib/merchantImage.js";
import { fakeSupabase } from "./fakeSupabase.js";

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

  it("une lecture à la fois : une seconde demande simultanée est laissée pour plus tard", async () => {
    switches.on = true;
    const { fastify } = store();
    const other = "f0000000-0000-4000-8000-000000000008";
    shopAnswers();
    const first = upgradeMerchantImage(fastify, log, piece, null, PUBLIC);
    expect(await upgradeMerchantImage(fastify, log, { product_match_id: other, image_url: THUMB }, null, PUBLIC)).toBe("busy");
    expect(await first).toBe("written");
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

describe("branchement dans les routes (lecture du code)", () => {
  const read = (file: string) => readFileSync(join(__dirname, "..", "src", file), "utf8");
  it("« Garder », la fiche d'une envie, « Je l'ai achetée » et la fiche du Vault la lancent, sans l'attendre", () => {
    const wishlist = read("routes/wishlist.ts");
    const vault = read("routes/vault.ts");
    expect(wishlist.match(/upgradeMerchantImageLater\(/g)).toHaveLength(2);
    expect(vault.match(/upgradeMerchantImageLater\(/g)).toHaveLength(2);
    expect(wishlist + vault).not.toMatch(/await upgradeMerchantImage/);
  });

  it("la liste des Envies et du Vault ne lit jamais de page de boutique", () => {
    const wishlist = read("routes/wishlist.ts");
    const list = wishlist.slice(wishlist.indexOf('fastify.get("/api/wishlist"'), wishlist.indexOf('fastify.post("/api/wishlist"'));
    expect(list).not.toContain("upgradeMerchantImage");
  });
});
