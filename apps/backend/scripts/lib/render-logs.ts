// Lecture SEULE des journaux de spotto-api (diagnostic du lot 4 ter, demandé
// par le fondateur le 2026-10-07) : uniquement des COMPTEURS — le nombre de
// requêtes par chemin et par code de réponse, et les compteurs que le serveur
// écrit lui-même pour l'analyse automatique (images, moments, jetons, motif
// d'échec) et pour le plafond des recherches SerpApi (lot 4 quater : réservé
// ou refusé, compteurs du jour, du mois de SerpApi et de la personne — un
// nombre, jamais son identifiant). Render ne garde pas de journal des requêtes HTTP pour ce service :
// on lit les lignes du serveur (« incoming request » / « request completed »),
// dont on n'extrait QUE la méthode, le chemin (comparé à une liste fixe) et le
// code de réponse. Aucun message brut, adresse IP, identifiant de compte ni
// contenu de requête n'est affiché ni gardé : seuls des nombres et des codes sortent.
import { z } from "zod";
import { RENDER_API, type FetchLike } from "./render-api.js";

/** Requêtes suivies, dans l'ordre du parcours « vidéo + quelques mots ». */
export const REQUETES_SUIVIES = [
  { method: "GET", chemin: /^\/api\/video-moments\/status$/, nom: "GET /api/video-moments/status", sens: "fonction d'analyse active ? (après le choix d'une vidéo)" },
  { method: "POST", chemin: /^\/api\/consents$/, nom: "POST /api/consents", sens: "accord enregistré (tous types d'accord)" },
  { method: "POST", chemin: /^\/api\/video-moments$/, nom: "POST /api/video-moments", sens: "analyse par l'IA" },
  { method: "POST", chemin: /^\/api\/searches\/prepare$/, nom: "POST /api/searches/prepare", sens: "image préparée pour l'identification" },
  { method: "POST", chemin: /^\/api\/searches\/[^/]+\/run$/, nom: "POST /api/searches/:id/run", sens: "identification (SerpApi)" },
  { method: "GET", chemin: /^\/api\/searches\/[0-9a-f-]{36}$/, nom: "GET /api/searches/:id", sens: "résultats consultés" },
] as const;

const REQUETE = z.object({ reqId: z.string(), msg: z.literal("incoming request"), req: z.object({ method: z.string(), url: z.string() }) });
const REPONSE = z.object({ reqId: z.string(), msg: z.literal("request completed"), res: z.object({ statusCode: z.number() }) });

/** Seuls champs lus dans les lignes « Analyse vidéo IA » du serveur (des nombres et un motif). */
const COMPTEURS_IA = z.object({
  msg: z.string(),
  frames: z.number().optional(),
  candidates: z.number().optional(),
  moments: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  kind: z.enum(["unavailable", "refused", "invalid_output"]).optional(),
  status: z.number().nullable().optional(),
});
export type CompteursIA = z.infer<typeof COMPTEURS_IA>;

const LOGS = z.object({
  hasMore: z.boolean(),
  nextStartTime: z.string().optional(),
  logs: z.array(z.object({ timestamp: z.string(), message: z.string(), labels: z.array(z.object({ name: z.string(), value: z.string() })) })),
});
type Entree = z.infer<typeof LOGS>["logs"][number];

const PAGES_MAX = 30;

export function parametresJournaux(ownerId: string, serviceId: string, depuis: string, filtre: Record<string, string>, jusque: string): URLSearchParams {
  const parametres = new URLSearchParams({ ownerId, startTime: depuis, endTime: jusque, direction: "forward", limit: "100", ...filtre });
  parametres.append("resource", serviceId);
  return parametres;
}

/** Toutes les entrées correspondant au filtre (pages successives), lecture seule. */
export async function lireJournaux(renderKey: string, parametres: URLSearchParams, fetchImpl: FetchLike = fetch): Promise<Entree[]> {
  const entrees: Entree[] = [];
  const courants = new URLSearchParams(parametres);
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const response = await fetchImpl(`${RENDER_API}/logs?${courants.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${renderKey}`, Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Render a répondu ${response.status} (lecture des journaux).`);
    }
    const lu = LOGS.safeParse(await response.json().catch(() => null));
    if (!lu.success) throw new Error("Réponse inattendue de Render (journaux).");
    entrees.push(...lu.data.logs);
    if (!lu.data.hasMore || !lu.data.nextStartTime) return entrees;
    courants.set("startTime", lu.data.nextStartTime);
  }
  throw new Error(`Plus de ${PAGES_MAX} pages de journaux : resserrez la période (--depuis).`);
}

function lireJson(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}

/** Requêtes suivies → nombre par code de réponse. Seuls la méthode, le chemin
 * (sans paramètres) et le code sont lus ; une requête sans réponse compte « ? ». */
export function compterRequetes(entrees: readonly Entree[]): Map<string, Record<string, number>> {
  const enCours = new Map<string, string>();
  const codes = new Map<string, Record<string, number>>(REQUETES_SUIVIES.map((r) => [r.nom, {}]));
  const ajouter = (nom: string, code: string) => {
    const parCode = codes.get(nom)!;
    parCode[code] = (parCode[code] ?? 0) + 1;
  };
  for (const entree of entrees) {
    const instance = entree.labels.find((label) => label.name === "instance")?.value ?? "";
    const brut = lireJson(entree.message);
    const requete = REQUETE.safeParse(brut);
    if (requete.success) {
      const chemin = requete.data.req.url.split("?")[0] ?? "";
      const suivie = REQUETES_SUIVIES.find((r) => r.method === requete.data.req.method && r.chemin.test(chemin));
      if (suivie) enCours.set(`${instance} ${requete.data.reqId}`, suivie.nom);
      continue;
    }
    const reponse = REPONSE.safeParse(brut);
    if (!reponse.success) continue;
    const cle = `${instance} ${reponse.data.reqId}`;
    const nom = enCours.get(cle);
    if (!nom) continue;
    enCours.delete(cle);
    ajouter(nom, String(reponse.data.res.statusCode));
  }
  for (const nom of enCours.values()) ajouter(nom, "?");
  return codes;
}

export interface Evenement {
  /** Heure de la ligne du journal (ISO, donnée par Render) : arrivée de la requête, ou ligne du serveur. */
  heure: string;
  nom: string;
  /** Code de réponse (« ? » sans réponse) ; pour une analyse par l'IA, ses seuls compteurs. */
  issue: string;
}

/** Ordre des événements (demande du fondateur, 2026-10-08) : requêtes suivies,
 * analyses par l'IA et plafond SerpApi, chacun avec son heure, son chemin
 * générique et son code ou ses compteurs — jamais d'identifiant, d'adresse IP
 * ni de contenu. */
export function chronologie(entrees: readonly Entree[]): Evenement[] {
  const enCours = new Map<string, Evenement>();
  const evenements: Evenement[] = [];
  for (const entree of entrees) {
    const cle = (reqId: string) => `${entree.labels.find((label) => label.name === "instance")?.value ?? ""} ${reqId}`;
    const brut = lireJson(entree.message);
    const requete = REQUETE.safeParse(brut);
    if (requete.success) {
      const chemin = requete.data.req.url.split("?")[0] ?? "";
      const suivie = REQUETES_SUIVIES.find((r) => r.method === requete.data.req.method && r.chemin.test(chemin));
      if (!suivie) continue;
      const evenement = { heure: entree.timestamp, nom: suivie.nom, issue: "?" };
      enCours.set(cle(requete.data.reqId), evenement);
      evenements.push(evenement);
      continue;
    }
    const reponse = REPONSE.safeParse(brut);
    if (reponse.success) {
      const evenement = enCours.get(cle(reponse.data.reqId));
      if (evenement) evenement.issue = String(reponse.data.res.statusCode);
      enCours.delete(cle(reponse.data.reqId));
      continue;
    }
    const compteurs = extraireCompteursIA(entree.message);
    if (compteurs) evenements.push({ heure: entree.timestamp, nom: "Analyse vidéo IA", issue: decrireAnalyse(compteurs) });
    const plafond = extrairePlafond(entree.message);
    if (plafond) evenements.push({ heure: entree.timestamp, nom: "Plafond SerpApi", issue: decrirePlafond(plafond) });
  }
  return evenements.sort((a, b) => Date.parse(a.heure) - Date.parse(b.heure));
}

/** Ligne « Analyse vidéo IA » du serveur → ses seuls compteurs (null si ce n'en est pas une). */
export function extraireCompteursIA(message: string): CompteursIA | null {
  const lu = COMPTEURS_IA.safeParse(lireJson(message));
  if (!lu.success || !lu.data.msg.startsWith("Analyse vidéo IA")) return null;
  const { msg, frames, candidates, moments, inputTokens, outputTokens, kind, status } = lu.data;
  return { msg, frames, candidates, moments, inputTokens, outputTokens, kind, status };
}

/** Seuls champs lus dans les lignes « Plafond SerpApi » du serveur (src/lib/searchCapacity.ts) : des nombres et des états. */
const PLAFOND = z.object({
  msg: z.literal("Plafond SerpApi"),
  step: z.enum(["search", "video_ai"]),
  outcome: z.enum(["reserved", "refused"]),
  limit: z.enum(["day", "month", "user"]).nullable(),
  day: z.number(),
  month: z.number(),
  user: z.number(),
  dayCap: z.number(),
  monthCap: z.number(),
  userCap: z.number(),
  renewalDay: z.number(),
});
export type LignePlafond = z.infer<typeof PLAFOND>;

/** Ligne « Plafond SerpApi » du serveur → ses seuls compteurs (null si ce n'en est pas une). */
export function extrairePlafond(message: string): LignePlafond | null {
  const lu = PLAFOND.safeParse(lireJson(message));
  if (!lu.success) return null;
  const { msg, step, outcome, limit, day, month, user, dayCap, monthCap, userCap, renewalDay } = lu.data;
  return { msg, step, outcome, limit, day, month, user, dayCap, monthCap, userCap, renewalDay };
}

function etatPlafond(ligne: LignePlafond): string {
  return `aujourd'hui ${ligne.day}/${ligne.dayCap}, depuis le ${ligne.renewalDay} ${ligne.month}/${ligne.monthCap}, personne ${ligne.user}/${ligne.userCap}`;
}

const PLAFONDS = { day: "plafond du jour", month: "plafond du mois", user: "part de la personne pour la journée" } as const;

export function decrirePlafond(ligne: LignePlafond): string {
  if (ligne.outcome === "reserved" || !ligne.limit) return `recherche réservée — ${etatPlafond(ligne)}`;
  const moment = ligne.step === "video_ai" ? "avant l'analyse par l'IA" : "au lancement d'une recherche";
  return `refus (${PLAFONDS[ligne.limit]}), ${moment} — ${etatPlafond(ligne)}`;
}

/** Bilan de la période : réservations, refus, et le dernier état lu (lignes dans l'ordre). */
export function resumerPlafond(lignes: readonly LignePlafond[]): string {
  const derniere = lignes.at(-1);
  if (!derniere) return "aucune ligne dans la période";
  const reservees = lignes.filter((ligne) => ligne.outcome === "reserved").length;
  const refus = (limit: LignePlafond["limit"]) => lignes.filter((ligne) => ligne.outcome === "refused" && ligne.limit === limit).length;
  const total = refus("day") + refus("month") + refus("user");
  return `${reservees} recherche(s) réservée(s), ${total} refus (jour ${refus("day")}, mois ${refus("month")}, part personnelle ${refus("user")}) ; dernier état lu : ${etatPlafond(derniere)}`;
}

export function decrireCodes(codes: Record<string, number>): string {
  // Codes dans l'ordre, les inconnus (« ? ») en dernier.
  const liste = Object.entries(codes).sort(([a], [b]) => (a === "?" ? 1 : b === "?" ? -1 : a.localeCompare(b)));
  return liste.length === 0 ? "aucune" : liste.map(([code, nombre]) => `${code} × ${nombre}`).join(", ");
}

export function decrireAnalyse(compteurs: CompteursIA): string {
  if (compteurs.msg.includes("sans résultat")) return `sans résultat — motif ${compteurs.kind ?? "?"}${compteurs.status ? ` (réponse ${compteurs.status})` : ""}, ${compteurs.frames ?? "?"} image(s)`;
  return `${compteurs.frames ?? "?"} image(s) envoyée(s), ${compteurs.candidates ?? "?"} moment(s) proposé(s), ${compteurs.moments ?? "?"} retenu(s), jetons ${compteurs.inputTokens ?? "?"} lus / ${compteurs.outputTokens ?? "?"} écrits`;
}
