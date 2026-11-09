import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import vaultRoutes from "../src/routes/vault.js";
import { keptMatchIds } from "../src/lib/keptPieces.js";
import { observePurchase } from "../src/lib/wishObserve.js";

// Alertes prix et stock (lot 2) : l'annonce « disponible chez cette boutique
// aujourd'hui » après un achat est remplacée par un espion (sa logique :
// alertesPrixObservation.test.ts).
vi.mock("../src/lib/wishObserve.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/wishObserve.js")>();
  return { ...original, observePurchase: vi.fn() };
});
const purchaseMock = vi.mocked(observePurchase);

// Lot « Retrouver ses pièces », partie sans base (aucun réseau) : la route
// POST /api/vault sur une fausse base en mémoire, et la lecture des pièces
// déjà gardées. Le même comportement sur la vraie base de développement :
// vaultSansDoublon.test.ts (à lancer sur le Mac).

const USER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const MATCH = "33333333-3333-4333-8333-333333333333";
const EXISTING = "44444444-4444-4444-8444-444444444444";
const CREATED = "55555555-5555-4555-8555-555555555555";
const MATCH_IMAGE = "https://encrypted-tbn.example/vignette.jpg";

type Filter = [op: "eq" | "in", column: string, value: unknown];
interface Query {
  table: string;
  action: "select" | "insert";
  filters: Filter[];
  values?: Record<string, unknown>;
}
type Answer = (query: Query) => { data: unknown; error: unknown };

/** Fausse base : chaque requête est notée, `answer` donne sa réponse. Seuls
 * les appels dont ces routes ont besoin existent. */
function fakeDb(answer: Answer) {
  const queries: Query[] = [];
  const uploads: string[] = [];
  function from(table: string) {
    const query: Query = { table, action: "select", filters: [] };
    const run = () => {
      queries.push(query);
      return Promise.resolve(answer(query));
    };
    const chain = {
      select: () => chain,
      insert: (values: Record<string, unknown>) => {
        query.action = "insert";
        query.values = values;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push(["eq", column, value]);
        return chain;
      },
      in: (column: string, value: unknown) => {
        query.filters.push(["in", column, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      single: run,
      maybeSingle: run,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
    };
    return chain;
  }
  const storage = {
    from: () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://stockage.example/vault-media/${path}` } }),
    }),
  };
  return { db: { from, storage }, queries, uploads };
}

function vaultRow(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: "Veste", image_url: MATCH_IMAGE, category: "clothing", verified: false, product_match_id: MATCH, created_at: "2026-10-01T10:00:00Z", ...overrides };
}

/** Réponses ordinaires : la proposition appartient à `owner`, le Vault contient `existing`. */
function standardAnswer(options: { owner?: string; existing?: unknown[]; vaultReadFails?: boolean } = {}): Answer {
  return (query) => {
    if (query.table === "product_matches" && query.filters.some(([op, column]) => op === "eq" && column === "id")) {
      return { data: { id: MATCH, image_url: MATCH_IMAGE, merchant_url: "https://marchand.example/veste", product_searches: { user_id: options.owner ?? USER } }, error: null };
    }
    if (query.table === "product_matches") return { data: [{ id: MATCH, image_url: MATCH_IMAGE, image_hd_url: "https://marchand.example/hd.jpg" }], error: null };
    if (query.table === "vault_items" && query.action === "insert") return { data: vaultRow(CREATED, query.values), error: null };
    if (query.table === "vault_items") return options.vaultReadFails ? { data: null, error: { message: "base injoignable" } } : { data: options.existing ?? [], error: null };
    throw new Error(`Requête inattendue sur ${query.table}`);
  };
}

/** Corps multipart écrit à la main (champs, puis une photo facultative). */
function multipartBody(fields: Record<string, string>, file?: Buffer) {
  const boundary = "limiteDeTest";
  const parts: Buffer[] = Object.entries(fields).map(([name, value]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

let app: FastifyInstance | null = null;

async function vaultApp(db: unknown): Promise<FastifyInstance> {
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.decorate("supabaseAdmin", db as FastifyInstance["supabaseAdmin"]);
  app.decorateRequest("user", null);
  app.decorate("requireAuth", async (request: FastifyRequest) => {
    request.user = { id: USER, email: null };
  });
  await app.register(vaultRoutes);
  await app.ready();
  return app;
}

function post(target: FastifyInstance, fields: Record<string, string>, file?: Buffer) {
  const body = multipartBody(fields, file);
  return target.inject({ method: "POST", url: "/api/vault", headers: body.headers, payload: body.payload });
}

const FROM_MATCH = { title: "Veste", category: "clothing", productMatchId: MATCH, imageUrl: "https://ailleurs.example/autre.jpg" };

afterEach(async () => {
  await app?.close();
  app = null;
  purchaseMock.mockReset();
});

describe("alertes prix : « Je l'ai achetée » annonce la pièce disponible chez cette boutique (sans base)", () => {
  it("pièce créée depuis une proposition de sa recherche : une annonce, après la réponse, avec le lien et la boutique rangés par le serveur (jamais l'acheteur)", async () => {
    const { db } = fakeDb(standardAnswer());
    const res = await post(await vaultApp(db), FROM_MATCH);
    expect(res.statusCode).toBe(200);
    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock.mock.calls[0]![1]).toEqual({ merchantUrl: "https://marchand.example/veste", merchantName: null });
    expect(JSON.stringify(purchaseMock.mock.calls[0]![1])).not.toContain(USER);
  });

  it("déjà dans le Vault, ou ajout à la main (sans proposition) : aucune annonce", async () => {
    const { db } = fakeDb(standardAnswer({ existing: [vaultRow(EXISTING)] }));
    expect((await post(await vaultApp(db), FROM_MATCH)).json()).toMatchObject({ alreadyInVault: true });
    await app?.close();
    const manual = fakeDb(standardAnswer());
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#806040" } }).jpeg().toBuffer();
    expect((await post(await vaultApp(manual.db), { title: "Veste", category: "clothing" }, photo)).statusCode).toBe(200);
    expect(purchaseMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/vault : une même proposition, une seule pièce (sans base)", () => {
  it("première fois : la pièce est créée (alreadyInVault faux), avec l'image du résultat, jamais celle envoyée", async () => {
    const { db, queries } = fakeDb(standardAnswer());
    const res = await post(await vaultApp(db), FROM_MATCH);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: CREATED, productMatchId: MATCH, imageUrl: MATCH_IMAGE, imageHdUrl: "https://marchand.example/hd.jpg", alreadyInVault: false });
    const inserts = queries.filter((query) => query.action === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toMatchObject({ user_id: USER, product_match_id: MATCH, image_url: MATCH_IMAGE });
  });

  it("vérifie le Vault de cette personne pour cette proposition, avant l'insertion", async () => {
    const { db, queries } = fakeDb(standardAnswer());
    await post(await vaultApp(db), FROM_MATCH);
    const vaultQueries = queries.filter((query) => query.table === "vault_items");
    expect(vaultQueries.map((query) => query.action)).toEqual(["select", "insert"]);
    expect(vaultQueries[0]!.filters).toEqual([
      ["eq", "user_id", USER],
      ["eq", "product_match_id", MATCH],
    ]);
  });

  it("déjà dans le Vault : la pièce existante est renvoyée (alreadyInVault vrai), rien n'est créé ni envoyé, même avec une photo", async () => {
    const { db, queries, uploads } = fakeDb(standardAnswer({ existing: [vaultRow(EXISTING, { title: "Veste en daim" })] }));
    const target = await vaultApp(db);
    for (const file of [undefined, Buffer.from("octets d'une photo")]) {
      const res = await post(target, { ...FROM_MATCH, title: "Autre titre" }, file);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: EXISTING, title: "Veste en daim", productMatchId: MATCH, alreadyInVault: true });
    }
    expect(queries.filter((query) => query.action === "insert")).toEqual([]);
    expect(uploads).toEqual([]);
  });

  it("la proposition d'une autre personne : 404, sans même regarder le Vault (rien ne se devine)", async () => {
    const { db, queries } = fakeDb(standardAnswer({ owner: STRANGER, existing: [vaultRow(EXISTING)] }));
    const res = await post(await vaultApp(db), FROM_MATCH);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "product_match_not_found" });
    expect(queries.filter((query) => query.table === "vault_items")).toEqual([]);
  });

  it("Vault illisible : l'ajout s'arrête (500) plutôt que de risquer un doublon", async () => {
    const { db, queries } = fakeDb(standardAnswer({ vaultReadFails: true }));
    const res = await post(await vaultApp(db), FROM_MATCH);
    expect(res.statusCode).toBe(500);
    expect(queries.filter((query) => query.action === "insert")).toEqual([]);
  });

  it("ajout à la main (photo, sans proposition) : aucune vérification, toujours une nouvelle pièce", async () => {
    const { db, queries, uploads } = fakeDb(standardAnswer());
    const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#654" } }).jpeg().toBuffer();
    const res = await post(await vaultApp(db), { title: "Bague", category: "accessories" }, photo);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ alreadyInVault: false });
    expect(queries.filter((query) => query.table === "vault_items").map((query) => query.action)).toEqual(["insert"]);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.startsWith(`${USER}/`)).toBe(true);
  });
});

describe("keptMatchIds : propositions déjà gardées par la personne (sans base)", () => {
  function fakeFastify(answer: Answer) {
    const { db, queries } = fakeDb(answer);
    const error = vi.fn();
    const fastify = { supabaseAdmin: db, log: { error } } as unknown as Parameters<typeof keptMatchIds>[0];
    return { fastify, queries, error };
  }

  it("ne lit que les pièces de la personne, parmi les propositions demandées ; sans doublon ni valeur vide", async () => {
    const { fastify, queries } = fakeFastify(() => ({ data: [{ product_match_id: MATCH }, { product_match_id: MATCH }, { product_match_id: null }], error: null }));
    expect(await keptMatchIds(fastify, "vault_items", USER, [MATCH, EXISTING])).toEqual([MATCH]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ table: "vault_items" });
    expect(queries[0]!.filters).toEqual([
      ["eq", "user_id", USER],
      ["in", "product_match_id", [MATCH, EXISTING]],
    ]);
  });

  it("aucune proposition : aucune lecture", async () => {
    const { fastify, queries } = fakeFastify(() => ({ data: [], error: null }));
    expect(await keptMatchIds(fastify, "wishlist_items", USER, [])).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("lecture impossible ou illisible : aucun repère, et l'erreur est journalisée", async () => {
    for (const reply of [{ data: null, error: { message: "base injoignable" } }, { data: [{ product_match_id: "pas-un-identifiant" }], error: null }]) {
      const { fastify, error } = fakeFastify(() => reply);
      expect(await keptMatchIds(fastify, "wishlist_items", USER, [MATCH])).toEqual([]);
      expect(error).toHaveBeenCalledOnce();
    }
  });

  it("plus de 100 propositions : lues par paquets, pour ne pas allonger l'adresse de la requête", async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
    const { fastify, queries } = fakeFastify((query) => ({ data: [{ product_match_id: (query.filters[1]![2] as string[])[0] }], error: null }));
    expect(await keptMatchIds(fastify, "vault_items", USER, ids)).toEqual([ids[0], ids[100]]);
    expect(queries.map((query) => (query.filters[1]![2] as string[]).length)).toEqual([100, 50]);
  });
});
