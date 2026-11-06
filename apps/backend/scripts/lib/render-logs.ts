// Lecture SEULE des journaux de spotto-api (diagnostic du lot 4 ter, demandé
// par le fondateur le 2026-10-07) : uniquement des COMPTEURS — le nombre de
// requêtes par chemin et par code de réponse, et les compteurs que le serveur
// écrit lui-même pour l'analyse automatique (images, moments, jetons, motif
// d'échec), pour le plafond des recherches SerpApi (lot 4 quater : réservé
// ou refusé, compteurs du jour, du mois de SerpApi et de la personne — un
// nombre, jamais son identifiant), pour la mesure de chaque recherche (petit
// lot : issue, propositions, prix, rangs des ajouts de la règle des prix),
// depuis 0027, pour les places rendues et les disjoncteurs et, depuis la voie C
// (lot c), pour le complément de chaque recherche (« Mesure complément »).
// Render ne garde pas de journal des requêtes HTTP pour ce service :
// on lit les lignes du serveur (« incoming request » / « request completed »),
// dont on n'extrait QUE la méthode, le chemin (comparé à une liste fixe) et le
// code de réponse. Aucun message brut, adresse IP, identifiant de compte ni
// contenu de requête n'est affiché ni gardé : seuls des nombres et des codes sortent.
import { z } from "zod";
import { RENDER_API, type FetchLike } from "./render-api.js";

/** Requêtes suivies, dans l'ordre du parcours « vidéo + quelques mots ».
 * Depuis le lot « filets de sécurité », le serveur note la route déclarée
 * (« /api/searches/:id ») au lieu de l'adresse réelle : les deux formes sont
 * lues, pour les journaux d'avant et d'après. */
export const REQUETES_SUIVIES = [
  { method: "GET", chemin: /^\/api\/video-moments\/status$/, nom: "GET /api/video-moments/status", sens: "fonction d'analyse active ? (après le choix d'une vidéo)" },
  { method: "POST", chemin: /^\/api\/consents$/, nom: "POST /api/consents", sens: "accord enregistré (tous types d'accord)" },
  { method: "POST", chemin: /^\/api\/video-moments$/, nom: "POST /api/video-moments", sens: "analyse par l'IA" },
  { method: "POST", chemin: /^\/api\/searches\/prepare$/, nom: "POST /api/searches/prepare", sens: "image préparée pour l'identification" },
  { method: "POST", chemin: /^\/api\/searches\/[^/]+\/run$/, nom: "POST /api/searches/:id/run", sens: "identification (SerpApi)" },
  { method: "GET", chemin: /^\/api\/searches\/(?:[0-9a-f-]{36}|:id)$/, nom: "GET /api/searches/:id", sens: "résultats consultés" },
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
    if (plafond) evenements.push({ heure: entree.timestamp, nom: "Plafond recherches", issue: decrirePlafond(plafond) });
    const mesure = extraireMesure(entree.message);
    if (mesure) evenements.push({ heure: entree.timestamp, nom: "Mesure recherche", issue: decrireMesure(mesure) });
    const place = extrairePlaceRendue(entree.message);
    if (place) evenements.push({ heure: entree.timestamp, nom: "Place rendue", issue: decrirePlaceRendue(place) });
    const disjoncteur = extraireDisjoncteur(entree.message);
    if (disjoncteur) evenements.push({ heure: entree.timestamp, nom: "Disjoncteur", issue: decrireDisjoncteur(disjoncteur) });
    const complement = extraireComplement(entree.message);
    if (complement) evenements.push({ heure: entree.timestamp, nom: "Mesure complément", issue: decrireComplement(complement) });
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

/** Seuls champs lus dans les lignes « Plafond recherches » du serveur
 * (src/lib/searchCapacity.ts ; « Plafond SerpApi » avant 0027) : des nombres et des états.
 * Étapes : search (Lens), video_ai (avant l'analyse d'une vidéo) et, depuis la
 * voie C, complement_ai (lecture avant l'IA des boutiques) et shopping
 * (Google Shopping : la requête de l'IA, ou vos mots). */
const PLAFOND = z.object({
  msg: z.enum(["Plafond SerpApi", "Plafond recherches"]),
  step: z.enum(["search", "video_ai", "complement_ai", "shopping"]),
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

/** Ligne « Plafond recherches » (ou « Plafond SerpApi ») du serveur → ses seuls compteurs (null si ce n'en est pas une). */
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
const MOMENTS = {
  search: "au lancement d'une recherche",
  video_ai: "avant l'analyse par l'IA",
  complement_ai: "avant la requête des boutiques par l'IA",
  shopping: "avant une recherche dans les boutiques",
} as const;

export function decrirePlafond(ligne: LignePlafond): string {
  if (ligne.outcome === "reserved" || !ligne.limit) {
    return `recherche réservée${ligne.step === "shopping" ? " (boutiques)" : ""} — ${etatPlafond(ligne)}`;
  }
  return `refus (${PLAFONDS[ligne.limit]}), ${MOMENTS[ligne.step]} — ${etatPlafond(ligne)}`;
}

/** Bilan de la période : réservations (dont celles de Google Shopping), refus,
 * et le dernier état lu (lignes dans l'ordre). */
export function resumerPlafond(lignes: readonly LignePlafond[]): string {
  const derniere = lignes.at(-1);
  if (!derniere) return "aucune ligne dans la période";
  const reservees = lignes.filter((ligne) => ligne.outcome === "reserved").length;
  const boutiques = lignes.filter((ligne) => ligne.outcome === "reserved" && ligne.step === "shopping").length;
  const refus = (limit: LignePlafond["limit"]) => lignes.filter((ligne) => ligne.outcome === "refused" && ligne.limit === limit).length;
  const total = refus("day") + refus("month") + refus("user");
  const dont = boutiques > 0 ? ` (dont ${boutiques} dans les boutiques)` : "";
  return `${reservees} recherche(s) réservée(s)${dont}, ${total} refus (jour ${refus("day")}, mois ${refus("month")}, part personnelle ${refus("user")}) ; dernier état lu : ${etatPlafond(derniere)}`;
}

/** Seuls champs lus dans les lignes « Mesure recherche » du serveur
 * (src/lib/searchMeasure.ts, petit lot ; fournisseur et code de réponse
 * depuis 0027 ; fromCache depuis la voie C, absent quand elle est coupée) :
 * l'issue et des nombres. */
const MESURE = z.object({
  msg: z.literal("Mesure recherche"),
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).nullable().default(null),
  statusCode: z.number().nullable().default(null),
  outcome: z.enum(["found", "nothing_buyable", "empty_lens", "failure"]),
  failureKind: z.enum(["timeout", "provider_error", "provider_refused", "unreadable_response", "save_failed", "interrupted", "serpapi_error"]).nullable(),
  received: z.number().nullable(),
  kept: z.number().nullable(),
  keptWithPrice: z.number().nullable(),
  keptOtherCurrency: z.number().nullable(),
  added: z.number(),
  addedRanks: z.array(z.number()),
  callSeconds: z.number().nullable(),
  // Voie C : la réponse de Lens vient du cache (aucun appel).
  fromCache: z.boolean().optional(),
});
export type LigneMesure = z.infer<typeof MESURE>;

/** Ligne « Mesure recherche » du serveur → ses seuls nombres (null si ce n'en est pas une). */
export function extraireMesure(message: string): LigneMesure | null {
  const lu = MESURE.safeParse(lireJson(message));
  if (!lu.success) return null;
  const { msg, provider, statusCode, outcome, failureKind, received, kept, keptWithPrice, keptOtherCurrency, added, addedRanks, callSeconds, fromCache } = lu.data;
  return {
    msg,
    provider,
    statusCode,
    outcome,
    failureKind,
    received,
    kept,
    keptWithPrice,
    keptOtherCurrency,
    added,
    addedRanks,
    callSeconds,
    ...(fromCache === undefined ? {} : { fromCache }),
  };
}

const ISSUES = { found: "trouvée", nothing_buyable: "rien d'achetable", empty_lens: "vide", failure: "panne" } as const;
const PANNES = {
  timeout: "délai dépassé",
  provider_error: "erreur du fournisseur",
  provider_refused: "refus du fournisseur, place rendue",
  unreadable_response: "réponse illisible",
  save_failed: "enregistrement",
  interrupted: "interrompue",
  serpapi_error: "erreur du fournisseur, ancien serveur",
} as const;

function duree(secondes: number | null): string {
  return secondes === null ? "durée inconnue" : `${secondes} s`;
}

export function decrireMesure(ligne: LigneMesure): string {
  if (ligne.outcome === "failure") {
    // Le code de réponse ne dit quelque chose que pour un refus ou une erreur du fournisseur.
    const parlant = ligne.failureKind === "provider_refused" || ligne.failureKind === "provider_error";
    const code = parlant && ligne.statusCode !== null ? `, code ${ligne.statusCode}` : "";
    return `panne (${ligne.failureKind ? PANNES[ligne.failureKind] : "?"}${code}), ${duree(ligne.callSeconds)}`;
  }
  const ajoutees = ligne.added > 0 ? ` ; ${ligne.added} ajoutée(s) par la règle des prix (rangs ${ligne.addedRanks.join(", ")})` : "";
  const cache = ligne.fromCache === true ? " — réponse du cache, sans appel" : "";
  return `${ISSUES[ligne.outcome]} — ${ligne.received ?? "?"} reçue(s), ${ligne.kept ?? "?"} gardée(s) dont ${ligne.keptWithPrice ?? "?"} avec un prix (${ligne.keptOtherCurrency ?? "?"} dans une autre devise)${ajoutees}, ${duree(ligne.callSeconds)}${cache}`;
}

/** Bilan de la période : issues, pannes par type, prix, ajouts de la règle des
 * prix. Les recherches servies par le cache (voie C, aucun appel) sont
 * comptées à part : elles ne disent rien de Google Lens ce jour-là. */
export function resumerMesures(lignes: readonly LigneMesure[]): string {
  if (lignes.length === 0) return "aucune ligne dans la période";
  const servies = lignes.filter((ligne) => ligne.fromCache === true);
  const appels = lignes.filter((ligne) => ligne.fromCache !== true);
  const bilan = resumerAppels(appels);
  if (servies.length === 0) return bilan;
  const issue = (code: LigneMesure["outcome"]) => servies.filter((ligne) => ligne.outcome === code).length;
  return `${bilan} ; servies par le cache, sans appel : ${servies.length} (trouvées ${issue("found")}, rien d'achetable ${issue("nothing_buyable")}, vides ${issue("empty_lens")})`;
}

function resumerAppels(lignes: readonly LigneMesure[]): string {
  const issue = (code: LigneMesure["outcome"]) => lignes.filter((ligne) => ligne.outcome === code).length;
  const pannes = Object.entries(PANNES)
    .map(([code, nom]) => [nom, lignes.filter((ligne) => ligne.failureKind === code).length] as const)
    .filter(([, nombre]) => nombre > 0)
    .map(([nom, nombre]) => `${nom} ${nombre}`);
  const abouties = lignes.filter((ligne) => ligne.outcome !== "failure");
  const somme = (champ: "kept" | "keptWithPrice" | "added") => abouties.reduce((total, ligne) => total + (ligne[champ] ?? 0), 0);
  return `${lignes.length} recherche(s) : trouvées ${issue("found")}, rien d'achetable ${issue("nothing_buyable")}, vides ${issue("empty_lens")}, pannes ${issue("failure")}${pannes.length > 0 ? ` (${pannes.join(", ")})` : ""} ; ${somme("kept")} propositions gardées, dont ${somme("keptWithPrice")} avec un prix et ${somme("added")} ajoutées par la règle des prix`;
}

/** Seuls champs lus dans les lignes « Place rendue » du serveur (0027,
 * src/lib/searchCapacity.ts) : le fournisseur et l'issue du retour. */
const PLACE_RENDUE = z.object({
  msg: z.literal("Place rendue"),
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  // search : Lens ; shopping : Google Shopping (voie C).
  step: z.enum(["search", "shopping"]),
  released: z.boolean(),
});
export type LignePlaceRendue = z.infer<typeof PLACE_RENDUE>;

/** Ligne « Place rendue » du serveur → l'issue du retour (null si ce n'en est pas une). */
export function extrairePlaceRendue(message: string): LignePlaceRendue | null {
  const lu = PLACE_RENDUE.safeParse(lireJson(message));
  if (!lu.success) return null;
  const { msg, provider, step, released } = lu.data;
  return { msg, provider, step, released };
}

export function decrirePlaceRendue(ligne: LignePlaceRendue): string {
  const qui = ligne.step === "shopping" ? "refus du fournisseur (boutiques)" : "refus du fournisseur";
  return ligne.released ? `${qui} : place rendue (jour et mois)` : `${qui} : place NON rendue (retour en échec, elle reste comptée)`;
}

export function resumerPlacesRendues(lignes: readonly LignePlaceRendue[]): string {
  if (lignes.length === 0) return "aucune ligne dans la période";
  const rendues = lignes.filter((ligne) => ligne.released).length;
  return `${rendues} place(s) rendue(s), ${lignes.length - rendues} retour(s) en échec (places restées comptées)`;
}

/** Seuls champs lus dans les lignes « Disjoncteur » du serveur (0027,
 * src/lib/searchBreaker.ts) : l'événement et des nombres. */
const DISJONCTEUR = z.object({
  msg: z.literal("Disjoncteur"),
  provider: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  searchType: z.enum(["image"]),
  // « observation » : serveur d'avant le lot garde-fous ; « block » : depuis.
  mode: z.enum(["observation", "block"]),
  event: z.enum(["opened", "reopened", "closed", "would_block", "blocked"]),
  judged: z.number(),
  bad: z.number(),
  minutesLeft: z.number().nullable(),
});
export type LigneDisjoncteur = z.infer<typeof DISJONCTEUR>;

/** Ligne « Disjoncteur » du serveur → l'événement et ses nombres (null si ce n'en est pas une). */
export function extraireDisjoncteur(message: string): LigneDisjoncteur | null {
  const lu = DISJONCTEUR.safeParse(lireJson(message));
  if (!lu.success) return null;
  const { msg, provider, searchType, mode, event, judged, bad, minutesLeft } = lu.data;
  return { msg, provider, searchType, mode, event, judged, bad, minutesLeft };
}

// Mise en ligne 1 : le disjoncteur de l'image, en observation (il ne bloquait
// rien). Depuis le lot garde-fous, il bloque (mode « block »).
const EVENEMENTS_OBSERVATION = {
  opened: "se serait ouvert",
  reopened: "se serait rouvert (recherche de test mauvaise)",
  closed: "se serait refermé",
  would_block: "aurait bloqué une recherche",
  blocked: "a bloqué une recherche",
} as const;
const EVENEMENTS_BLOCAGE = {
  opened: "ouvert (recherche en pause)",
  reopened: "rouvert (recherche de test mauvaise)",
  closed: "refermé",
  would_block: "aurait bloqué une recherche",
  blocked: "a bloqué une recherche",
} as const;

export function decrireDisjoncteur(ligne: LigneDisjoncteur): string {
  const reste = ligne.minutesLeft === null ? "" : `, encore ${ligne.minutesLeft} min`;
  const evenements = ligne.mode === "block" ? EVENEMENTS_BLOCAGE : EVENEMENTS_OBSERVATION;
  return `image (${ligne.mode === "block" ? "blocage" : "observation"}) : ${evenements[ligne.event]} — ${ligne.bad} mauvaise(s) sur ${ligne.judged}${reste}`;
}

export function resumerDisjoncteurs(lignes: readonly LigneDisjoncteur[]): string {
  if (lignes.length === 0) return "aucune ligne dans la période";
  const nombre = (mode: LigneDisjoncteur["mode"], event: LigneDisjoncteur["event"]) => lignes.filter((ligne) => ligne.mode === mode && ligne.event === event).length;
  const parties: string[] = [];
  if (lignes.some((ligne) => ligne.mode === "observation")) {
    parties.push(
      `en observation : ouvertures ${nombre("observation", "opened")}, réouvertures ${nombre("observation", "reopened")}, fermetures ${nombre("observation", "closed")}, recherches qui auraient été bloquées ${nombre("observation", "would_block")}`
    );
  }
  if (lignes.some((ligne) => ligne.mode === "block")) {
    parties.push(
      `en blocage : ouvertures ${nombre("block", "opened")}, réouvertures ${nombre("block", "reopened")}, fermetures ${nombre("block", "closed")}, recherches bloquées ${nombre("block", "blocked")}`
    );
  }
  return parties.join(" ; ");
}

/** Seuls champs lus dans les lignes « Mesure complément » du serveur (voie C,
 * src/lib/searchMeasure.ts, complementLogLine) : l'issue, des durées, des
 * nombres et des valeurs de listes fermées. Jamais la requête, un titre, une
 * marque, un modèle, vos mots ni une adresse : le serveur ne les écrit pas, et
 * rien d'autre n'est lu ici. */
const COMPLEMENT = z.object({
  msg: z.literal("Mesure complément"),
  // ai : « Cette pièce dans d'autres boutiques » (au lancement) ; words : « Que cherchez-vous ? ».
  source: z.enum(["ai", "words"]),
  // null : le complément n'a pas tourné (panne de Lens, « Annuler »).
  status: z.enum(["shown", "empty", "no_query", "ai_failed", "shopping_failed", "no_time", "no_capacity", "skipped", "error"]).nullable(),
  lensFromCache: z.boolean(),
  queryFromCache: z.boolean(),
  shoppingFromCache: z.boolean(),
  calls: z.number(),
  aiMs: z.number().nullable(),
  shoppingMs: z.number().nullable(),
  totalMs: z.number(),
  overBudget: z.boolean(),
  received: z.number().nullable(),
  kept: z.number().nullable(),
  keptWithPrice: z.number().nullable(),
  tier0: z.number().nullable(),
  tier1: z.number().nullable(),
  googleLinks: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  aiErrorKind: z.enum(["unavailable", "refused", "invalid_output"]).nullable(),
  noQueryReason: z.enum(["empty", "invented", "brand_not_shared", "too_long", "operators"]).nullable(),
  shoppingFailureKind: z.enum(["refused", "timeout", "error", "unreadable"]).nullable(),
});
export type LigneComplement = z.infer<typeof COMPLEMENT>;

/** Ligne « Mesure complément » du serveur → ses seuls champs (null si ce n'en est pas une). */
export function extraireComplement(message: string): LigneComplement | null {
  const lu = COMPLEMENT.safeParse(lireJson(message));
  if (!lu.success) return null;
  const d = lu.data;
  return {
    msg: d.msg,
    source: d.source,
    status: d.status,
    lensFromCache: d.lensFromCache,
    queryFromCache: d.queryFromCache,
    shoppingFromCache: d.shoppingFromCache,
    calls: d.calls,
    aiMs: d.aiMs,
    shoppingMs: d.shoppingMs,
    totalMs: d.totalMs,
    overBudget: d.overBudget,
    received: d.received,
    kept: d.kept,
    keptWithPrice: d.keptWithPrice,
    tier0: d.tier0,
    tier1: d.tier1,
    googleLinks: d.googleLinks,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    aiErrorKind: d.aiErrorKind,
    noQueryReason: d.noQueryReason,
    shoppingFailureKind: d.shoppingFailureKind,
  };
}

const ISSUES_COMPLEMENT = {
  shown: "montré",
  empty: "rien gardé",
  no_query: "aucune requête sûre",
  ai_failed: "échec de l'IA",
  shopping_failed: "échec de la recherche",
  no_time: "plus le temps",
  no_capacity: "plafond atteint",
  skipped: "IA coupée",
  error: "exception inattendue",
} as const;

const SOURCES_COMPLEMENT = { ai: "boutiques", words: "vos mots" } as const;

function secondes(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** Une ligne lisible : issue et sa raison, propositions, origine des réponses (cache), durées, jetons. */
export function decrireComplement(ligne: LigneComplement): string {
  const source = SOURCES_COMPLEMENT[ligne.source];
  if (ligne.status === null) return `${source} : non lancé (panne de Lens ou « Annuler »), total ${secondes(ligne.totalMs)}`;
  const raison =
    ligne.status === "no_query" ? ligne.noQueryReason : ligne.status === "ai_failed" ? ligne.aiErrorKind : ligne.status === "shopping_failed" ? ligne.shoppingFailureKind : null;
  const parties = [`${source} : ${ISSUES_COMPLEMENT[ligne.status]}${raison ? ` (${raison})` : ""}`];
  if (ligne.kept !== null) {
    const paliers = ligne.tier0 !== null ? `, paliers 0 / 1 : ${ligne.tier0} / ${ligne.tier1 ?? "?"}` : "";
    const google = ligne.googleLinks ? `, ${ligne.googleLinks} lien(s) vers Google` : "";
    parties.push(`${ligne.received ?? "?"} reçue(s), ${ligne.kept} gardée(s) dont ${ligne.keptWithPrice ?? "?"} avec un prix${paliers}${google}`);
  }
  const caches = [ligne.lensFromCache ? "Lens" : null, ligne.queryFromCache ? "requête" : null, ligne.shoppingFromCache ? "boutiques" : null].filter((nom) => nom !== null);
  if (caches.length > 0) parties.push(`du cache : ${caches.join(", ")}`);
  const durees = [ligne.aiMs !== null ? `IA ${ligne.aiMs} ms` : null, ligne.shoppingMs !== null ? `recherche ${ligne.shoppingMs} ms` : null].filter((duree) => duree !== null);
  if (ligne.inputTokens !== null) durees.push(`jetons ${ligne.inputTokens} lus / ${ligne.outputTokens ?? "?"} écrits`);
  parties.push(`${ligne.calls} appel(s)${durees.length > 0 ? `, ${durees.join(", ")}` : ""}`);
  parties.push(`total ${secondes(ligne.totalMs)}${ligne.overBudget ? " (15 s ou plus)" : ""}`);
  return parties.join(" ; ");
}

/** Bilan de la période, par source : issues, appels aux boutiques, lancements de 15 s ou plus. */
export function resumerComplements(lignes: readonly LigneComplement[]): string {
  if (lignes.length === 0) return "aucune ligne dans la période";
  const bilan = (source: LigneComplement["source"], nom: string) => {
    const lues = lignes.filter((ligne) => ligne.source === source);
    const comptes: [string, number][] = Object.entries(ISSUES_COMPLEMENT).map(([code, libelle]) => [libelle, lues.filter((ligne) => ligne.status === code).length]);
    comptes.push(["non lancé", lues.filter((ligne) => ligne.status === null).length]);
    const issues = comptes
      .filter(([, nombre]) => nombre > 0)
      .map(([libelle, nombre]) => `${libelle} ${nombre}`);
    return `${nom} ${lues.length}${issues.length > 0 ? ` (${issues.join(", ")})` : ""}`;
  };
  const appels = lignes.reduce((total, ligne) => total + ligne.calls, 0);
  const longs = lignes.filter((ligne) => ligne.overBudget).length;
  return `${bilan("ai", "boutiques")} ; ${bilan("words", "vos mots")} ; ${appels} recherche(s) dans les boutiques ; ${longs} de 15 s ou plus`;
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
