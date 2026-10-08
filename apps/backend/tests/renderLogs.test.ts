import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RENDER_API, type FetchLike } from "../scripts/lib/render-api.js";
import { chronologie, compterRequetes, decrireAnalyse, decrireCodes, extraireCompteursIA, extrairePlafond, lireJournaux, parametresJournaux, resumerPlafond } from "../scripts/lib/render-logs.js";
import { CAPACITY_LOG_MESSAGE, capacityLogFields } from "../src/lib/searchCapacity.js";

// Diagnostic du lot 4 ter (2026-10-07) : lecture SEULE des journaux de
// spotto-api, des compteurs et jamais de contenu. Journaux SIMULÉS, qui
// contiennent exprès une adresse IP, un identifiant et un texte : rien de tout
// cela ne doit ressortir.
const IP = "203.0.113.42";
const TEXTE = "veste en daim marron";
const COMPTE = "0b6f2d1e-1111-2222-3333-444455556666";

/** Ligne du serveur (format de Fastify), avec l'adresse IP comme en production. */
function ligne(contenu: Record<string, unknown>, instance = "srv-darcqk3tqb8s73f082f0-abc12") {
  return {
    id: "log-1",
    timestamp: "2026-10-07T06:00:00Z",
    message: JSON.stringify({ level: 30, pid: 1, hostname: "srv-host", ...contenu }),
    labels: [
      { name: "instance", value: instance },
      { name: "type", value: "app" },
    ],
  };
}
function requete(reqId: string, method: string, url: string, instance?: string) {
  return ligne({ reqId, req: { method, url, host: "spotto-api.onrender.com", remoteAddress: IP, remotePort: 51515 }, msg: "incoming request" }, instance);
}
function reponse(reqId: string, statusCode: number, instance?: string) {
  return ligne({ reqId, res: { statusCode }, responseTime: 12.3, msg: "request completed" }, instance);
}
function entree(statusCode: string) {
  return ligne({ msg: `code ${statusCode}` });
}

function fauxFetch(pages: unknown[]): { fetchImpl: FetchLike; adresses: string[] } {
  const adresses: string[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    adresses.push(`${init?.method ?? "GET"} ${url}`);
    const page = pages[Math.min(index, pages.length - 1)];
    index += 1;
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, adresses };
}

describe("lecture des journaux de spotto-api : des compteurs, jamais de contenu", () => {
  it("demande une période précise, du plus ancien au plus récent, pour le seul serveur", () => {
    const parametres = parametresJournaux("tea-abc", "srv-darcqk3tqb8s73f082f0", "2026-10-07T05:51:00Z", { type: "request", method: "POST", path: "/api/video-moments" }, "2026-10-07T08:00:00Z");
    expect(Object.fromEntries(parametres)).toEqual({
      ownerId: "tea-abc",
      startTime: "2026-10-07T05:51:00Z",
      endTime: "2026-10-07T08:00:00Z",
      direction: "forward",
      limit: "100",
      type: "request",
      method: "POST",
      path: "/api/video-moments",
      resource: "srv-darcqk3tqb8s73f082f0",
    });
  });

  it("lit toutes les pages, en lecture seule (GET sur /logs uniquement)", async () => {
    const { fetchImpl, adresses } = fauxFetch([
      { hasMore: true, nextStartTime: "2026-10-07T06:30:00Z", logs: [entree("200"), entree("403")] },
      { hasMore: false, logs: [entree("200")] },
    ]);
    const entrees = await lireJournaux("cle-render-factice", parametresJournaux("tea-abc", "srv-x", "2026-10-07T05:51:00Z", {}, "2026-10-07T08:00:00Z"), fetchImpl);
    expect(entrees).toHaveLength(3);
    expect(adresses).toHaveLength(2);
    expect(adresses.every((adresse) => adresse.startsWith(`GET ${RENDER_API}/logs?`))).toBe(true);
    expect(adresses[1]).toContain("startTime=2026-10-07T06%3A30%3A00Z");
  });

  it("compte les requêtes suivies par code de réponse ; ni adresse IP, ni identifiant, ni paramètre ne ressortent", () => {
    const recherche = "5e2b6c1a-0d4f-4b7e-9a51-3f6f2f7c1b9e";
    const codes = compterRequetes([
      requete("req-1", "GET", "/api/video-moments/status"),
      reponse("req-1", 200),
      requete("req-2", "POST", "/api/video-moments"),
      requete("req-3", "POST", "/api/consents"),
      reponse("req-3", 201),
      reponse("req-2", 503),
      requete("req-4", "POST", `/api/searches/${recherche}/run?mode=1`),
      reponse("req-4", 200),
      requete("req-5", "GET", `/api/searches/${recherche}`),
      requete("req-6", "GET", "/api/feed?cursor=abc"), // non suivie
      reponse("req-6", 200),
      // Redémarrage du serveur : les numéros de requête repartent, sur une autre instance.
      requete("req-1", "POST", "/api/video-moments", "srv-darcqk3tqb8s73f082f0-def34"),
      reponse("req-1", 200, "srv-darcqk3tqb8s73f082f0-def34"),
    ]);
    expect(Object.fromEntries(codes)).toEqual({
      "GET /api/video-moments/status": { "200": 1 },
      "POST /api/consents": { "201": 1 },
      "POST /api/video-moments": { "503": 1, "200": 1 },
      "POST /api/searches/prepare": {},
      "POST /api/searches/:id/run": { "200": 1 },
      "GET /api/searches/:id": { "?": 1 },
    });
    const texte = [...codes.values()].map(decrireCodes).join(" | ");
    expect(texte).toBe("200 × 1 | 201 × 1 | 200 × 1, 503 × 1 | aucune | 200 × 1 | ? × 1");
    for (const interdit of [IP, recherche, "cursor", "51515"]) expect(texte + JSON.stringify(Object.fromEntries(codes))).not.toContain(interdit);
  });

  it("codes inconnus affichés en dernier", () => {
    expect(decrireCodes({ "?": 1, "403": 1, "200": 2 })).toBe("200 × 2, 403 × 1, ? × 1");
    expect(entree("200").labels.map((label) => label.name)).not.toContain("clientIP");
  });

  it("ligne « Analyse vidéo IA » : seuls ses compteurs sont lus, jamais le reste", () => {
    const ligne = JSON.stringify({
      level: 30,
      reqId: "req-7",
      hostname: "srv-darcqk3tqb8s73f082f0-abc",
      remoteAddress: IP,
      userId: COMPTE,
      query: TEXTE,
      frames: 9,
      candidates: 3,
      moments: 2,
      inputTokens: 3300,
      outputTokens: 120,
      msg: "Analyse vidéo IA",
    });
    const compteurs = extraireCompteursIA(ligne);
    expect(compteurs).toEqual({ msg: "Analyse vidéo IA", frames: 9, candidates: 3, moments: 2, inputTokens: 3300, outputTokens: 120, kind: undefined, status: undefined });
    const texte = decrireAnalyse(compteurs!);
    expect(texte).toBe("9 image(s) envoyée(s), 3 moment(s) proposé(s), 2 retenu(s), jetons 3300 lus / 120 écrits");
    for (const interdit of [IP, TEXTE, COMPTE, "req-7"]) expect(JSON.stringify(compteurs) + texte).not.toContain(interdit);
  });

  it("échec de l'analyse : motif et code de réponse seulement", () => {
    const compteurs = extraireCompteursIA(JSON.stringify({ msg: "Analyse vidéo IA sans résultat", frames: 12, kind: "unavailable", status: 400, reqId: "req-8" }));
    expect(decrireAnalyse(compteurs!)).toBe("sans résultat — motif unavailable (réponse 400), 12 image(s)");
  });

  it("autres lignes (texte libre, autre message) : ignorées", () => {
    expect(extraireCompteursIA(`incoming request ${IP}`)).toBeNull();
    expect(extraireCompteursIA(JSON.stringify({ msg: "incoming request", remoteAddress: IP }))).toBeNull();
    expect(extraireCompteursIA(JSON.stringify({ msg: "Analyse vidéo IA", frames: "neuf" }))).toBeNull();
  });

  it("le code de lecture des journaux ne fait que des lectures", () => {
    const code = readFileSync(fileURLToPath(new URL("../scripts/lib/render-logs.ts", import.meta.url)), "utf8");
    // Un seul appel réseau, en lecture (« POST » n'y figure que comme filtre de recherche dans les journaux).
    expect(code.match(/fetchImpl\(/g)).toHaveLength(1);
    expect(code).toMatch(/fetchImpl\(`\$\{RENDER_API\}\/logs\?[^`]*`, \{\s*method: "GET"/);
    expect(code).not.toMatch(/\b(PUT|PATCH|DELETE)\b/);
  });
});

describe("ordre des événements (demande du fondateur, 2026-10-08)", () => {
  const a = (heure: string, contenu: ReturnType<typeof ligne>) => ({ ...contenu, timestamp: heure });
  it("heure, chemin générique et code, dans l'ordre ; jamais d'identifiant, d'adresse IP ni de texte", () => {
    const entrees = [
      a("2026-10-08T20:16:05Z", requete("r3", "POST", `/api/searches/${COMPTE}/run?q=${encodeURIComponent(TEXTE)}`)),
      a("2026-10-08T20:15:00Z", requete("r1", "POST", "/api/video-moments")),
      a("2026-10-08T20:15:04Z", reponse("r1", 200)),
      a("2026-10-08T20:15:04Z", ligne({ msg: "Analyse vidéo IA", frames: 12, candidates: 3, moments: 3, inputTokens: 3776, outputTokens: 153, texte: TEXTE })),
      a("2026-10-08T20:16:01Z", requete("r2", "POST", "/api/searches/prepare")),
      a("2026-10-08T20:16:02Z", reponse("r2", 200)),
      a("2026-10-08T20:16:09Z", reponse("r3", 200)),
      a("2026-10-08T20:17:00Z", requete("r4", "GET", "/api/me")),
    ];
    const evenements = chronologie(entrees);
    expect(evenements.map((e) => `${e.heure} ${e.nom} ${e.issue}`)).toEqual([
      "2026-10-08T20:15:00Z POST /api/video-moments 200",
      "2026-10-08T20:15:04Z Analyse vidéo IA 12 image(s) envoyée(s), 3 moment(s) proposé(s), 3 retenu(s), jetons 3776 lus / 153 écrits",
      "2026-10-08T20:16:01Z POST /api/searches/prepare 200",
      "2026-10-08T20:16:05Z POST /api/searches/:id/run 200",
    ]);
    const tout = JSON.stringify(evenements);
    for (const interdit of [IP, COMPTE, TEXTE, "veste"]) expect(tout).not.toContain(interdit);
  });

  it("requête sans réponse : « ? »", () => {
    expect(chronologie([a("2026-10-08T20:16:01Z", requete("r9", "POST", "/api/searches/prepare"))])).toEqual([{ heure: "2026-10-08T20:16:01Z", nom: "POST /api/searches/prepare", issue: "?" }]);
  });
});

describe("plafond global SerpApi (lot 4 quater)", () => {
  // La ligne telle que le serveur l'écrit (mêmes champs que src/lib/searchCapacity.ts), plus ce que Fastify y ajoute.
  const plafond = (outcome: "reserved" | "refused", limit: "day" | "month" | "user" | null, day: number, window: number, step: "search" | "video_ai" = "search") =>
    ligne({
      reqId: "r7",
      ...capacityLogFields(
        step,
        outcome === "reserved"
          ? { allowed: true, refused_by: null, day_count: day, window_count: window, user_day_count: 3 }
          : { allowed: false, refused_by: limit ?? "day", day_count: day, window_count: window, user_day_count: 3 },
        { daily: 25, monthly: 225, userDaily: 8 }
      ),
      msg: CAPACITY_LOG_MESSAGE,
      compte: COMPTE,
      adresse: IP,
      texte: TEXTE,
    });

  it("lit la ligne écrite par le serveur : des nombres et des états, rien d'autre", () => {
    const lue = extrairePlafond(plafond("refused", "month", 3, 225, "video_ai").message);
    expect(lue).toEqual({ msg: "Plafond SerpApi", step: "video_ai", outcome: "refused", limit: "month", day: 3, window: 225, user: 3, dayCap: 25, monthCap: 225, userCap: 8 });
    expect(JSON.stringify(lue)).not.toContain(IP);
    expect(extrairePlafond(ligne({ msg: "Analyse vidéo IA", frames: 3 }).message)).toBeNull();
  });

  it("bilan : réservations, refus par plafond, dernier état ; ordre des événements sans identifiant, adresse ni texte", () => {
    const entrees = [
      plafond("reserved", null, 24, 120),
      plafond("reserved", null, 25, 121),
      plafond("refused", "day", 25, 121),
      plafond("refused", "user", 25, 121),
      plafond("refused", "month", 2, 225, "video_ai"),
    ].map((entree, index) => ({ ...entree, timestamp: `2026-10-09T08:0${index}:00Z` }));
    const lignes = entrees.flatMap((entree) => extrairePlafond(entree.message) ?? []);
    expect(resumerPlafond(lignes)).toBe(
      "2 recherche(s) réservée(s), 3 refus (jour 1, 31 jours 1, part personnelle 1) ; dernier état lu : aujourd'hui 2/25, 31 jours 225/225, personne 3/8"
    );
    expect(resumerPlafond([])).toBe("aucune ligne dans la période");
    const evenements = chronologie(entrees);
    expect(evenements.map((e) => e.issue)).toEqual([
      "recherche réservée — aujourd'hui 24/25, 31 jours 120/225, personne 3/8",
      "recherche réservée — aujourd'hui 25/25, 31 jours 121/225, personne 3/8",
      "refus (plafond du jour), au lancement d'une recherche — aujourd'hui 25/25, 31 jours 121/225, personne 3/8",
      "refus (part de la personne pour la journée), au lancement d'une recherche — aujourd'hui 25/25, 31 jours 121/225, personne 3/8",
      "refus (plafond des 31 jours), avant l'analyse par l'IA — aujourd'hui 2/25, 31 jours 225/225, personne 3/8",
    ]);
    const tout = JSON.stringify(evenements);
    for (const interdit of [IP, COMPTE, TEXTE]) expect(tout).not.toContain(interdit);
  });
});
