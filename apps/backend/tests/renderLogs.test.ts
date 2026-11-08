import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RENDER_API, type FetchLike } from "../scripts/lib/render-api.js";
import {
  chronologie,
  compterRequetes,
  decrireAnalyse,
  decrireCodes,
  decrireComplement,
  decrireMesure,
  decrirePlafond,
  extraireComplement,
  extraireCompteursIA,
  extraireDisjoncteur,
  extraireMesure,
  extrairePlaceRendue,
  extrairePlafond,
  lireJournaux,
  parametresJournaux,
  resumerComplements,
  resumerDisjoncteurs,
  resumerMesures,
  resumerPlacesRendues,
  resumerPlafond,
} from "../scripts/lib/render-logs.js";
import { CAPACITY_LOG_MESSAGE, capacityLogFields, RELEASE_LOG_MESSAGE, type CapacityStep } from "../src/lib/searchCapacity.js";
import {
  COMPLEMENT_LOG_MESSAGE,
  complementLogLine,
  failedColumns,
  MEASURE_LOG_MESSAGE,
  measuredColumns,
  measureLogLine,
  type ComplementMeasure,
  type MeasureColumns,
  type ProviderReply,
} from "../src/lib/searchMeasure.js";
import { BREAKER_LOG_MESSAGE, breakerLogFields, type BreakerLogEvent } from "../src/lib/searchBreaker.js";

describe("mesure de chaque recherche (petit lot)", () => {
  // La ligne telle que le serveur l'écrit (src/lib/searchMeasure.ts), plus ce que Fastify y ajoute.
  const SERPAPI_200: ProviderReply = { provider: "serpapi", statusCode: 200 };
  const mesure = (colonnes: MeasureColumns, ajouts: number[], reponse: ProviderReply = SERPAPI_200) =>
    ligne({ ...measureLogLine(colonnes, ajouts, reponse), msg: MEASURE_LOG_MESSAGE, compte: COMPTE, adresse: IP, texte: TEXTE });
  const lens = (received: number, kept: number, keptWithPrice: number) => ({ received, removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, kept, keptWithPrice, keptOtherCurrency: 0, distinctSites: kept, sections: [], googleState: null });
  const AJOUTS = [32, 36, 37, 38, 46, 47, 51, 52, 53, 55];

  it("lit la ligne écrite par le serveur : l'issue et des nombres, rien d'autre", () => {
    const lue = extraireMesure(mesure(measuredColumns(lens(60, 40, 22), 4), AJOUTS).message);
    expect(lue).toEqual({
      msg: "Mesure recherche",
      provider: "serpapi",
      statusCode: 200,
      outcome: "found",
      failureKind: null,
      received: 60,
      kept: 40,
      keptWithPrice: 22,
      keptOtherCurrency: 0,
      added: 10,
      addedRanks: AJOUTS,
      callSeconds: 4,
    });
    for (const interdit of [IP, COMPTE, TEXTE]) expect(JSON.stringify(lue)).not.toContain(interdit);
    expect(decrireMesure(lue!)).toBe("trouvée — 60 reçue(s), 40 gardée(s) dont 22 avec un prix (0 dans une autre devise) ; 10 ajoutée(s) par la règle des prix (rangs 32, 36, 37, 38, 46, 47, 51, 52, 53, 55), 4 s");
    // Une panne n'a jamais d'ajouts, même si on lui en passe.
    expect(extraireMesure(mesure(failedColumns("timeout", 15), AJOUTS).message)).toMatchObject({ outcome: "failure", failureKind: "timeout", added: 0, addedRanks: [] });
    expect(extraireMesure(ligne({ msg: "Plafond SerpApi" }).message)).toBeNull();
  });

  it("0027 : nouvelles causes de panne, code de réponse du fournisseur ; les lignes d'avant 0027 restent lues", () => {
    const refus = extraireMesure(mesure(failedColumns("provider_refused", 1), [], { provider: "serpapi", statusCode: 429 }).message);
    expect(decrireMesure(refus!)).toBe("panne (refus du fournisseur, place rendue, code 429), 1 s");
    const coupee = extraireMesure(mesure(failedColumns("interrupted", null), [], { provider: null, statusCode: null }).message);
    expect(decrireMesure(coupee!)).toBe("panne (interrompue), durée inconnue");
    const erreur = extraireMesure(mesure(failedColumns("provider_error", 15), [], { provider: "serpapi", statusCode: null }).message);
    expect(decrireMesure(erreur!)).toBe("panne (erreur du fournisseur), 15 s");
    const erreurCode = extraireMesure(mesure(failedColumns("provider_error", 1), [], { provider: "serpapi", statusCode: 502 }).message);
    expect(decrireMesure(erreurCode!)).toBe("panne (erreur du fournisseur, code 502), 1 s");
    // Ligne écrite par le serveur d'avant 0027 : ni fournisseur ni code.
    const ancienne = ligne({ msg: "Mesure recherche", outcome: "failure", failureKind: "serpapi_error", received: null, kept: null, keptWithPrice: null, keptOtherCurrency: null, added: 0, addedRanks: [], callSeconds: 2 });
    const lueAncienne = extraireMesure(ancienne.message);
    expect(lueAncienne).toMatchObject({ provider: null, statusCode: null, failureKind: "serpapi_error" });
    expect(decrireMesure(lueAncienne!)).toBe("panne (erreur du fournisseur, ancien serveur), 2 s");
    expect(resumerMesures([refus!, coupee!, erreur!, lueAncienne!])).toBe(
      "4 recherche(s) : trouvées 0, rien d'achetable 0, vides 0, pannes 4 (erreur du fournisseur 1, refus du fournisseur, place rendue 1, interrompue 1, erreur du fournisseur, ancien serveur 1) ; 0 propositions gardées, dont 0 avec un prix et 0 ajoutées par la règle des prix"
    );
  });

  it("bilan de la période et ordre des événements, sans identifiant, adresse ni texte", () => {
    const entrees = [
      mesure(measuredColumns(lens(60, 40, 22), 4), AJOUTS),
      mesure(measuredColumns(lens(3, 0, 0), 2), []),
      mesure(measuredColumns(lens(0, 0, 0), 2), []),
      mesure(failedColumns("timeout", 15), [], { provider: "serpapi", statusCode: null }),
      mesure(failedColumns("save_failed", 3), []),
    ].map((entree, index) => ({ ...entree, timestamp: `2026-10-25T08:0${index}:00Z` }));
    const lignes = entrees.flatMap((entree) => extraireMesure(entree.message) ?? []);
    expect(resumerMesures(lignes)).toBe(
      "5 recherche(s) : trouvées 1, rien d'achetable 1, vides 1, pannes 2 (délai dépassé 1, enregistrement 1) ; 40 propositions gardées, dont 22 avec un prix et 10 ajoutées par la règle des prix"
    );
    expect(resumerMesures([])).toBe("aucune ligne dans la période");
    const evenements = chronologie(entrees);
    expect(evenements.map((e) => e.issue)).toEqual([
      "trouvée — 60 reçue(s), 40 gardée(s) dont 22 avec un prix (0 dans une autre devise) ; 10 ajoutée(s) par la règle des prix (rangs 32, 36, 37, 38, 46, 47, 51, 52, 53, 55), 4 s",
      "rien d'achetable — 3 reçue(s), 0 gardée(s) dont 0 avec un prix (0 dans une autre devise), 2 s",
      "vide — 0 reçue(s), 0 gardée(s) dont 0 avec un prix (0 dans une autre devise), 2 s",
      "panne (délai dépassé), 15 s",
      "panne (enregistrement), 3 s",
    ]);
    const tout = JSON.stringify(evenements);
    for (const interdit of [IP, COMPTE, TEXTE]) expect(tout).not.toContain(interdit);
  });
});

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

  it("journaux d'après le lot « filets de sécurité » : la route déclarée (« :id ») est comptée comme l'adresse réelle", () => {
    const codes = compterRequetes([
      requete("req-1", "POST", "/api/searches/:id/run"),
      reponse("req-1", 200),
      requete("req-2", "GET", "/api/searches/:id"),
      reponse("req-2", 200),
      requete("req-3", "GET", "(route inconnue)"),
      reponse("req-3", 404),
    ]);
    expect(codes.get("POST /api/searches/:id/run")).toEqual({ "200": 1 });
    expect(codes.get("GET /api/searches/:id")).toEqual({ "200": 1 });
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
  const plafond = (outcome: "reserved" | "refused", limit: "day" | "month" | "user" | null, day: number, month: number, step: "search" | "video_ai" = "search") =>
    ligne({
      reqId: "r7",
      ...capacityLogFields(
        step,
        outcome === "reserved"
          ? { allowed: true, refused_by: null, reservation_id: 77, day_count: day, month_count: month, user_day_count: 3, next_renewal: "2026-11-03" }
          : { allowed: false, refused_by: limit ?? "day", reservation_id: null, day_count: day, month_count: month, user_day_count: 3, next_renewal: "2026-11-03" },
        { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 }
      ),
      msg: CAPACITY_LOG_MESSAGE,
      compte: COMPTE,
      adresse: IP,
      texte: TEXTE,
    });

  it("lit la ligne écrite par le serveur : des nombres et des états, rien d'autre", () => {
    const lue = extrairePlafond(plafond("refused", "month", 3, 225, "video_ai").message);
    expect(lue).toEqual({ msg: "Plafond recherches", step: "video_ai", outcome: "refused", limit: "month", day: 3, month: 225, user: 3, dayCap: 25, monthCap: 225, userCap: 8, renewalDay: 3 });
    expect(JSON.stringify(lue)).not.toContain(IP);
    // Le numéro de place n'est jamais écrit dans le journal.
    expect(plafond("reserved", null, 1, 1).message).not.toContain("reservation");
    expect(extrairePlafond(ligne({ msg: "Analyse vidéo IA", frames: 3 }).message)).toBeNull();
    // Lignes d'avant 0027 (« Plafond SerpApi », sans fournisseur) : toujours lues.
    const ancienne = { step: "search", outcome: "reserved", limit: null, day: 4, month: 70, user: 1, dayCap: 25, monthCap: 225, userCap: 8, renewalDay: 3 };
    expect(extrairePlafond(ligne({ ...ancienne, msg: "Plafond SerpApi" }).message)).toEqual({ ...ancienne, msg: "Plafond SerpApi" });
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
      "2 recherche(s) réservée(s), 3 refus (jour 1, mois 1, part personnelle 1) ; dernier état lu : aujourd'hui 2/25, depuis le 3 225/225, personne 3/8"
    );
    expect(resumerPlafond([])).toBe("aucune ligne dans la période");
    const evenements = chronologie(entrees);
    expect(evenements.map((e) => e.issue)).toEqual([
      "recherche réservée — aujourd'hui 24/25, depuis le 3 120/225, personne 3/8",
      "recherche réservée — aujourd'hui 25/25, depuis le 3 121/225, personne 3/8",
      "refus (plafond du jour), au lancement d'une recherche — aujourd'hui 25/25, depuis le 3 121/225, personne 3/8",
      "refus (part de la personne pour la journée), au lancement d'une recherche — aujourd'hui 25/25, depuis le 3 121/225, personne 3/8",
      "refus (plafond du mois), avant l'analyse par l'IA — aujourd'hui 2/25, depuis le 3 225/225, personne 3/8",
    ]);
    const tout = JSON.stringify(evenements);
    for (const interdit of [IP, COMPTE, TEXTE]) expect(tout).not.toContain(interdit);
  });
});

describe("places rendues et disjoncteur (0027)", () => {
  it("place rendue : l'issue du retour seulement, jamais de compte ni de numéro de place", () => {
    const rendue = ligne({ provider: "serpapi", step: "search", released: true, msg: RELEASE_LOG_MESSAGE, compte: COMPTE, adresse: IP });
    const ratee = ligne({ provider: "serpapi", step: "search", released: false, msg: RELEASE_LOG_MESSAGE });
    const lues = [rendue, ratee].flatMap((entree) => extrairePlaceRendue(entree.message) ?? []);
    expect(lues).toEqual([
      { msg: "Place rendue", provider: "serpapi", step: "search", released: true },
      { msg: "Place rendue", provider: "serpapi", step: "search", released: false },
    ]);
    expect(resumerPlacesRendues(lues)).toBe("1 place(s) rendue(s), 1 retour(s) en échec (places restées comptées)");
    expect(resumerPlacesRendues([])).toBe("aucune ligne dans la période");
    expect(chronologie([rendue, ratee]).map((e) => `${e.nom} — ${e.issue}`)).toEqual([
      "Place rendue — refus du fournisseur : place rendue (jour et mois)",
      "Place rendue — refus du fournisseur : place NON rendue (retour en échec, elle reste comptée)",
    ]);
    for (const interdit of [IP, COMPTE]) expect(JSON.stringify(lues)).not.toContain(interdit);
  });

  it("disjoncteur en observation (serveur d'avant le lot garde-fous) : événements et nombres seulement", () => {
    // Les lignes telles que l'ancien serveur les écrivait, plus ce que Fastify y ajoute.
    const disjoncteur = (event: "opened" | "reopened" | "closed" | "would_block", bad: number, minutesLeft: number | null, timestamp: string) => ({
      ...ligne({ provider: "serpapi", searchType: "image", mode: "observation", event, judged: 10, bad, minutesLeft, msg: BREAKER_LOG_MESSAGE, compte: COMPTE }),
      timestamp,
    });
    const entrees = [
      disjoncteur("opened", 6, 15, "2026-10-26T08:00:00Z"),
      disjoncteur("would_block", 6, 12, "2026-10-26T08:03:00Z"),
      disjoncteur("reopened", 7, 15, "2026-10-26T08:16:00Z"),
      disjoncteur("closed", 6, null, "2026-10-26T08:32:00Z"),
    ];
    const champs = { provider: "serpapi", searchType: "image", mode: "observation", msg: BREAKER_LOG_MESSAGE };
    const lues = entrees.flatMap((entree) => extraireDisjoncteur(entree.message) ?? []);
    expect(lues).toHaveLength(4);
    expect(JSON.stringify(lues)).not.toContain(COMPTE);
    expect(resumerDisjoncteurs(lues)).toBe("en observation : ouvertures 1, réouvertures 1, fermetures 1, recherches qui auraient été bloquées 1");
    expect(chronologie(entrees).map((e) => e.issue)).toEqual([
      "image (observation) : se serait ouvert — 6 mauvaise(s) sur 10, encore 15 min",
      "image (observation) : aurait bloqué une recherche — 6 mauvaise(s) sur 10, encore 12 min",
      "image (observation) : se serait rouvert (recherche de test mauvaise) — 7 mauvaise(s) sur 10, encore 15 min",
      "image (observation) : se serait refermé — 6 mauvaise(s) sur 10",
    ]);
    expect(extraireDisjoncteur(ligne({ ...champs, event: "inconnu", judged: 1, bad: 1, minutesLeft: null }).message)).toBeNull();
  });

  it("disjoncteur qui bloque (lot garde-fous) : la ligne du serveur, lue telle quelle", () => {
    // La ligne telle que le serveur l'écrit (src/lib/searchBreaker.ts), plus ce que Fastify y ajoute.
    const disjoncteur = (event: BreakerLogEvent, bad: number, minutesLeft: number | null, timestamp: string) => ({
      ...ligne({ ...breakerLogFields("image", "serpapi", event, { open: minutesLeft !== null, tripped: true, judged: 10, bad, minutesLeft }), msg: BREAKER_LOG_MESSAGE, compte: COMPTE }),
      timestamp,
    });
    const entrees = [
      disjoncteur("opened", 6, 15, "2026-11-06T08:00:00Z"),
      disjoncteur("blocked", 6, 12, "2026-11-06T08:03:00Z"),
      disjoncteur("blocked", 6, 11, "2026-11-06T08:04:00Z"),
      disjoncteur("closed", 5, null, "2026-11-06T08:32:00Z"),
    ];
    const lues = entrees.flatMap((entree) => extraireDisjoncteur(entree.message) ?? []);
    expect(lues).toHaveLength(4);
    expect(JSON.stringify(lues)).not.toContain(COMPTE);
    expect(resumerDisjoncteurs(lues)).toBe("en blocage : ouvertures 1, réouvertures 0, fermetures 1, recherches bloquées 2");
    expect(chronologie(entrees).map((e) => e.issue)).toEqual([
      "image (blocage) : ouvert (recherche en pause) — 6 mauvaise(s) sur 10, encore 15 min",
      "image (blocage) : a bloqué une recherche — 6 mauvaise(s) sur 10, encore 12 min",
      "image (blocage) : a bloqué une recherche — 6 mauvaise(s) sur 10, encore 11 min",
      "image (blocage) : refermé — 5 mauvaise(s) sur 10",
    ]);
  });
});

// Voie C (lot c, 2026-11-02) : les lignes que le serveur écrit pour le
// complément, telles que src/lib/searchMeasure.ts et searchCapacity.ts les
// fabriquent. Journaux SIMULÉS : la requête, la marque et vos mots y sont
// glissés exprès (fictifs) ; rien de tout cela ne doit ressortir.
describe("voie C : « Mesure complément », étapes des boutiques, réponses du cache", () => {
  const REQUETE = "Exemplor veste Nuage 07";
  const MARQUE = "Exemplor";
  const mesureVide = (source: ComplementMeasure["source"]): ComplementMeasure => ({
    source,
    status: null,
    queryFromCache: false,
    shoppingFromCache: false,
    calls: 0,
    aiMs: null,
    shoppingMs: null,
    received: null,
    kept: null,
    keptWithPrice: null,
    tier0: null,
    tier1: null,
    googleLinks: null,
    inputTokens: null,
    outputTokens: null,
    aiErrorKind: null,
    noQueryReason: null,
    shoppingFailureKind: null,
  });
  const complement = (mesure: ComplementMeasure, run: { lensFromCache: boolean; totalMs: number; deferred?: boolean }, heure = "2026-11-02T08:00:00Z") => ({
    ...ligne({ ...complementLogLine(mesure, run), msg: COMPLEMENT_LOG_MESSAGE, compte: COMPTE, adresse: IP, texte: TEXTE, query: REQUETE, brand: MARQUE }),
    timestamp: heure,
  });
  const MONTRE: ComplementMeasure = {
    ...mesureVide("ai"),
    status: "shown",
    calls: 1,
    aiMs: 1240,
    shoppingMs: 2100,
    received: 40,
    kept: 18,
    keptWithPrice: 15,
    tier0: 3,
    tier1: 6,
    googleLinks: 2,
    inputTokens: 910,
    outputTokens: 28,
  };

  it("lit la ligne écrite par le serveur : issue, durées et nombres, jamais la requête, la marque ni vos mots", () => {
    const lue = extraireComplement(complement(MONTRE, { lensFromCache: false, totalMs: 9_430 }).message);
    expect(lue).toEqual({
      msg: "Mesure complément",
      source: "ai",
      status: "shown",
      lensFromCache: false,
      queryFromCache: false,
      shoppingFromCache: false,
      calls: 1,
      aiMs: 1240,
      shoppingMs: 2100,
      totalMs: 9_430,
      overBudget: false,
      received: 40,
      kept: 18,
      keptWithPrice: 15,
      tier0: 3,
      tier1: 6,
      googleLinks: 2,
      inputTokens: 910,
      outputTokens: 28,
      aiErrorKind: null,
      noQueryReason: null,
      shoppingFailureKind: null,
    });
    const texte = decrireComplement(lue!);
    expect(texte).toBe(
      "boutiques : montré ; 40 reçue(s), 18 gardée(s) dont 15 avec un prix, paliers 0 / 1 : 3 / 6, 2 lien(s) vers Google ; 1 appel(s), IA 1240 ms, recherche 2100 ms, jetons 910 lus / 28 écrits ; total 9,4 s"
    );
    for (const interdit of [IP, COMPTE, TEXTE, REQUETE, MARQUE]) expect(JSON.stringify(lue) + texte).not.toContain(interdit);
    // Une autre ligne, ou une issue inconnue : ignorée.
    expect(extraireComplement(ligne({ msg: "Mesure recherche" }).message)).toBeNull();
    expect(extraireComplement(ligne({ ...complementLogLine(MONTRE, { lensFromCache: false, totalMs: 1 }), status: "inconnue", msg: COMPLEMENT_LOG_MESSAGE }).message)).toBeNull();
  });

  it("issue absente (Lens en panne, « Annuler »), raisons en listes fermées, réponses du cache, 15 s ou plus", () => {
    const nonLance = extraireComplement(complement(mesureVide("ai"), { lensFromCache: false, totalMs: 15_200 }).message)!;
    expect(nonLance).toMatchObject({ status: null, overBudget: true });
    expect(decrireComplement(nonLance)).toBe("boutiques : non lancé (panne de Lens ou « Annuler »), total 15,2 s");

    const sansRequete = extraireComplement(complement({ ...mesureVide("ai"), status: "no_query", noQueryReason: "brand_not_shared", aiMs: 900, inputTokens: 700, outputTokens: 12 }, { lensFromCache: true, totalMs: 3_000 }).message)!;
    expect(decrireComplement(sansRequete)).toBe("boutiques : aucune requête sûre (brand_not_shared) ; du cache : Lens ; 0 appel(s), IA 900 ms, jetons 700 lus / 12 écrits ; total 3,0 s");

    const toutDuCache = extraireComplement(complement({ ...MONTRE, calls: 0, aiMs: null, shoppingMs: null, inputTokens: null, outputTokens: null, queryFromCache: true, shoppingFromCache: true }, { lensFromCache: true, totalMs: 1_100 }).message)!;
    expect(decrireComplement(toutDuCache)).toContain("du cache : Lens, requête, boutiques ; 0 appel(s) ; total 1,1 s");

    const vosMots = extraireComplement(complement({ ...mesureVide("words"), status: "shopping_failed", calls: 1, shoppingMs: 10_000, shoppingFailureKind: "timeout" }, { lensFromCache: false, totalMs: 11_800 }).message)!;
    expect(decrireComplement(vosMots)).toBe("vos mots : échec de la recherche (timeout) ; 1 appel(s), recherche 10000 ms ; total 11,8 s");

    const echecIA = extraireComplement(complement({ ...mesureVide("ai"), status: "ai_failed", aiErrorKind: "refused", aiMs: 2_000 }, { lensFromCache: false, totalMs: 8_000 }).message)!;
    expect(decrireComplement(echecIA)).toBe("boutiques : échec de l'IA (refused) ; 0 appel(s), IA 2000 ms ; total 8,0 s");
  });

  it("boutiques ensuite : la ligne le dit (durée comptée depuis la demande des boutiques) ; les lignes d'avant restent lues", () => {
    const differe = extraireComplement(complement(MONTRE, { lensFromCache: false, totalMs: 3_400, deferred: true }).message)!;
    expect(differe).toMatchObject({ deferred: true, totalMs: 3_400 });
    expect(decrireComplement(differe)).toContain("total 3,4 s, après l'affichage des résultats Lens (boutiques ensuite)");
    const { deferred: _absent, ...avant } = complementLogLine(MONTRE, { lensFromCache: false, totalMs: 9_430 });
    const ancienne = extraireComplement(ligne({ ...avant, msg: COMPLEMENT_LOG_MESSAGE }).message)!;
    expect(ancienne).not.toHaveProperty("deferred");
    expect(decrireComplement(ancienne)).not.toContain("boutiques ensuite");
  });

  it("bilan de la période par source, et ordre des événements, sans identifiant, adresse ni texte", () => {
    const entrees = [
      complement(MONTRE, { lensFromCache: false, totalMs: 9_430 }, "2026-11-02T08:00:00Z"),
      complement({ ...mesureVide("ai"), status: "skipped" }, { lensFromCache: false, totalMs: 6_000 }, "2026-11-02T08:01:00Z"),
      complement({ ...mesureVide("ai"), status: "no_time" }, { lensFromCache: false, totalMs: 15_400 }, "2026-11-02T08:02:00Z"),
      complement(mesureVide("ai"), { lensFromCache: false, totalMs: 12_000 }, "2026-11-02T08:03:00Z"),
      complement({ ...mesureVide("words"), status: "shown", calls: 1, shoppingMs: 1_800, received: 20, kept: 12, keptWithPrice: 12 }, { lensFromCache: false, totalMs: 2_500 }, "2026-11-02T08:04:00Z"),
    ];
    const lignes = entrees.flatMap((entree) => extraireComplement(entree.message) ?? []);
    expect(resumerComplements(lignes)).toBe("boutiques 4 (montré 1, plus le temps 1, IA coupée 1, non lancé 1) ; vos mots 1 (montré 1) ; 2 recherche(s) dans les boutiques ; 1 de 15 s ou plus");
    expect(resumerComplements([])).toBe("aucune ligne dans la période");
    const evenements = chronologie(entrees);
    expect(evenements.map((e) => e.nom)).toEqual(Array.from({ length: 5 }, () => "Mesure complément"));
    expect(evenements[4]!.issue).toBe("vos mots : montré ; 20 reçue(s), 12 gardée(s) dont 12 avec un prix ; 1 appel(s), recherche 1800 ms ; total 2,5 s");
    const tout = JSON.stringify(evenements);
    for (const interdit of [IP, COMPTE, TEXTE, REQUETE, MARQUE]) expect(tout).not.toContain(interdit);
  });

  it("« Plafond recherches » : les étapes complement_ai et shopping sont lues ; « Place rendue » : l'étape shopping aussi", () => {
    const plafond = (step: CapacityStep, allowed: boolean) =>
      ligne({
        ...capacityLogFields(
          step,
          allowed
            ? { allowed: true, refused_by: null, reservation_id: 9, day_count: 5, month_count: 40, user_day_count: 2, next_renewal: "2026-11-03" }
            : { allowed: false, refused_by: "day", reservation_id: null, day_count: 25, month_count: 40, user_day_count: 2, next_renewal: "2026-11-03" },
          { daily: 25, monthly: 225, userDaily: 8, renewalDay: 3 }
        ),
        msg: CAPACITY_LOG_MESSAGE,
        compte: COMPTE,
      });
    const boutiques = extrairePlafond(plafond("shopping", true).message)!;
    expect(boutiques).toMatchObject({ step: "shopping", outcome: "reserved" });
    expect(decrirePlafond(boutiques)).toBe("recherche réservée (boutiques) — aujourd'hui 5/25, depuis le 3 40/225, personne 2/8");
    const avantIA = extrairePlafond(plafond("complement_ai", false).message)!;
    expect(decrirePlafond(avantIA)).toBe("refus (plafond du jour), avant la requête des boutiques par l'IA — aujourd'hui 25/25, depuis le 3 40/225, personne 2/8");
    expect(decrirePlafond(extrairePlafond(plafond("shopping", false).message)!)).toBe("refus (plafond du jour), avant une recherche dans les boutiques — aujourd'hui 25/25, depuis le 3 40/225, personne 2/8");
    const lens = extrairePlafond(plafond("search", true).message)!;
    expect(resumerPlafond([lens, boutiques, avantIA])).toBe(
      "2 recherche(s) réservée(s) (dont 1 dans les boutiques), 1 refus (jour 1, mois 0, part personnelle 0) ; dernier état lu : aujourd'hui 25/25, depuis le 3 40/225, personne 2/8"
    );
    expect(JSON.stringify([boutiques, avantIA])).not.toContain(COMPTE);

    const rendue = extrairePlaceRendue(ligne({ provider: "serpapi", step: "shopping", released: true, msg: RELEASE_LOG_MESSAGE, compte: COMPTE }).message);
    expect(rendue).toEqual({ msg: "Place rendue", provider: "serpapi", step: "shopping", released: true });
    expect(chronologie([ligne({ provider: "serpapi", step: "shopping", released: false, msg: RELEASE_LOG_MESSAGE })]).map((e) => e.issue)).toEqual([
      "refus du fournisseur (boutiques) : place NON rendue (retour en échec, elle reste comptée)",
    ]);
  });

  it("« Mesure recherche » : fromCache lu quand il est écrit ; les recherches servies par le cache sont comptées à part", () => {
    const lens = { received: 60, removedIncomplete: 0, removedSocial: 0, removedProfessional: 0, removedDuplicates: 0, kept: 40, keptWithPrice: 22, keptOtherCurrency: 0, distinctSites: 40, sections: [], googleState: null };
    const mesure = (fromCache: boolean | undefined, callSeconds: number) =>
      ligne({ ...measureLogLine(measuredColumns(lens, callSeconds), [], { provider: "serpapi", statusCode: fromCache ? null : 200 }, fromCache), msg: MEASURE_LOG_MESSAGE, compte: COMPTE });
    const avant = extraireMesure(mesure(undefined, 4).message)!;
    expect("fromCache" in avant).toBe(false);
    const appel = extraireMesure(mesure(false, 4).message)!;
    const cache = extraireMesure(mesure(true, 0).message)!;
    expect(appel.fromCache).toBe(false);
    expect(cache.fromCache).toBe(true);
    expect(decrireMesure(appel)).toBe(decrireMesure(avant));
    expect(decrireMesure(cache)).toBe("trouvée — 60 reçue(s), 40 gardée(s) dont 22 avec un prix (0 dans une autre devise), 0 s — réponse du cache, sans appel");
    expect(resumerMesures([avant, appel, cache])).toBe(
      "2 recherche(s) : trouvées 2, rien d'achetable 0, vides 0, pannes 0 ; 80 propositions gardées, dont 44 avec un prix et 0 ajoutées par la règle des prix ; servies par le cache, sans appel : 1 (trouvées 1, rien d'achetable 0, vides 0)"
    );
    expect(chronologie([mesure(true, 0)]).map((e) => e.issue)).toEqual(["trouvée — 60 reçue(s), 40 gardée(s) dont 22 avec un prix (0 dans une autre devise), 0 s — réponse du cache, sans appel"]);
  });
});
