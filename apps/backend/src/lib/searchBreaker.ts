// Disjoncteurs de la recherche (0027 ; conception du 24 octobre, ajustée et
// acceptée par le fondateur le 25 octobre) : nos propres mesures disent si la
// recherche est perturbée chez le fournisseur. Un disjoncteur par type de
// recherche : celui de l'image ici ; celui du texte, calculé de la même façon,
// sera branché avec la recherche par texte (mise en ligne 3).
// Calculé à chaque lancement à partir de la table des recherches : aucun état
// en mémoire (le serveur gratuit redémarre souvent), aucune tâche périodique,
// aucune nouvelle table.
// Mise en ligne 1 : en OBSERVATION seulement. Une ligne « Disjoncteur » (des
// nombres) quand il se serait ouvert, rouvert ou fermé, et à chaque lancement
// qu'il aurait bloqué ; rien n'est bloqué. Il bloquera à la mise en ligne 2.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RecognitionMethod } from "@monapp/shared-types";

export const BREAKER_RULES = {
  /** Les recherches des 30 dernières minutes… */
  windowMs: 30 * 60_000,
  /** … dont les 10 dernières… */
  last: 10,
  /** … au moins 6 pour juger… */
  minJudged: 6,
  /** … et 6 mauvaises ou plus pour ouvrir. */
  badToOpen: 6,
  /** Pause après la dernière mauvaise ; ensuite, la recherche suivante sert de test. */
  pauseMs: 15 * 60_000,
  /** Les réponses vides d'une même personne comptent pour 2 au plus. */
  emptiesPerPerson: 2,
} as const;

/** Une recherche qui a atteint le fournisseur, telle que le disjoncteur la juge. */
export interface JudgedSearch {
  id: string;
  userId: string;
  startedAt: number;
  /** failure : panne du fournisseur (compte toujours) ; empty : réponse vide ; null : bonne réponse. */
  bad: "failure" | "empty" | null;
}

export interface BreakerState {
  /** Il bloquerait une recherche maintenant. */
  open: boolean;
  /** Assez de mauvaises, et la dernière recherche mauvaise : ouvert, ou en attente de la recherche de test. */
  tripped: boolean;
  judged: number;
  bad: number;
  /** Minutes avant la recherche de test (ouvert seulement). */
  minutesLeft: number | null;
}

/** Mauvaises parmi `recent` : chaque panne, et les réponses vides plafonnées à 2 par personne. */
function badCount(recent: readonly JudgedSearch[]): number {
  const emptiesByPerson = new Map<string, number>();
  for (const search of recent) {
    if (search.bad === "empty") emptiesByPerson.set(search.userId, (emptiesByPerson.get(search.userId) ?? 0) + 1);
  }
  const empties = [...emptiesByPerson.values()].reduce((sum, count) => sum + Math.min(count, BREAKER_RULES.emptiesPerPerson), 0);
  return recent.filter((search) => search.bad === "failure").length + empties;
}

export function breakerState(searches: readonly JudgedSearch[], now: number): BreakerState {
  const recent = searches
    .filter((search) => search.startedAt <= now && now - search.startedAt <= BREAKER_RULES.windowMs)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, BREAKER_RULES.last);
  const bad = badCount(recent);
  const latest = recent[0];
  const tripped = recent.length >= BREAKER_RULES.minJudged && bad >= BREAKER_RULES.badToOpen && latest !== undefined && latest.bad !== null;
  const resumesAt = tripped && latest ? latest.startedAt + BREAKER_RULES.pauseMs : null;
  const open = resumesAt !== null && now < resumesAt;
  return { open, tripped, judged: recent.length, bad, minutesLeft: open && resumesAt !== null ? Math.ceil((resumesAt - now) / 60_000) : null };
}

/** opened : ouvert par cette recherche ; reopened : la recherche de test était
 * mauvaise, nouvelle pause ; closed : fermé par une bonne recherche. */
export type BreakerEvent = "opened" | "reopened" | "closed";

/** Ce que la recherche `searchId` (comprise dans `searches`) a changé ; null : rien. */
export function breakerEvent(searches: readonly JudgedSearch[], searchId: string, now: number): BreakerEvent | null {
  const before = breakerState(searches.filter((search) => search.id !== searchId), now);
  const after = breakerState(searches, now);
  if (!before.tripped && after.tripped) return "opened";
  if (before.tripped && !after.tripped) return "closed";
  if (before.tripped && after.tripped && !before.open) return "reopened";
  return null;
}

export type BreakerKind = "image";

const BREAKER_METHODS: Record<BreakerKind, readonly RecognitionMethod[]> = {
  image: ["oembed", "manual_screenshot"],
};

// Pannes du fournisseur (serpapi_error : écrite par le serveur d'avant 0027).
// Ne comptent pas : nos pannes d'enregistrement (save_failed) et les recherches
// interrompues (interrupted), ni les refus avant l'appel et les annulations,
// qui n'ont pas d'heure de lancement.
const PROVIDER_FAILURES = ["timeout", "provider_error", "provider_refused", "unreadable_response", "serpapi_error"] as const;
const EMPTY_OUTCOMES: readonly string[] = ["empty_lens", "empty_text"];

const JUDGED_ROWS = z.array(
  z.object({
    id: z.string(),
    user_id: z.string(),
    run_started_at: z.string(),
    outcome: z.enum(["found", "nothing_buyable", "empty_lens", "empty_text", "failure"]),
  })
);

/** Les dernières recherches de ce type qui ont atteint le fournisseur, tous
 * comptes confondus (une de plus que la fenêtre : celle qu'on vient de juger). */
export async function readJudgedSearches(fastify: FastifyInstance, kind: BreakerKind, now: number): Promise<JudgedSearch[]> {
  const { data, error } = await fastify.supabaseAdmin
    .from("product_searches")
    .select("id, user_id, run_started_at, outcome")
    .in("method", [...BREAKER_METHODS[kind]])
    .gte("run_started_at", new Date(now - BREAKER_RULES.windowMs).toISOString())
    .not("outcome", "is", null)
    .or(`failure_kind.is.null,failure_kind.in.(${PROVIDER_FAILURES.join(",")})`)
    .order("run_started_at", { ascending: false })
    .limit(BREAKER_RULES.last + 1);
  const rows = JUDGED_ROWS.safeParse(data);
  if (error || !rows.success) throw new Error("Disjoncteur illisible");
  return rows.data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    startedAt: Date.parse(row.run_started_at),
    bad: row.outcome === "failure" ? "failure" : EMPTY_OUTCOMES.includes(row.outcome) ? "empty" : null,
  }));
}

/** Message de la ligne de journal du disjoncteur, lue par compteurs-ia. */
export const BREAKER_LOG_MESSAGE = "Disjoncteur";

/** Champs de la ligne « Disjoncteur » : l'événement et des nombres, jamais de compte ni d'identifiant. */
export function breakerLogFields(kind: BreakerKind, provider: string, event: BreakerEvent | "would_block", state: BreakerState) {
  return { provider, searchType: kind, mode: "observation" as const, event, judged: state.judged, bad: state.bad, minutesLeft: state.minutesLeft };
}

function logBreaker(fastify: FastifyInstance, kind: BreakerKind, provider: string, event: BreakerEvent | "would_block", state: BreakerState): void {
  fastify.log.info(breakerLogFields(kind, provider, event, state), BREAKER_LOG_MESSAGE);
}

/** Au lancement : note la recherche que le disjoncteur aurait bloquée. Ne
 * bloque jamais (observation) ; une lecture impossible est seulement notée. */
export async function observeBreakerAtLaunch(fastify: FastifyInstance, kind: BreakerKind, provider: string): Promise<void> {
  const now = Date.now();
  try {
    const state = breakerState(await readJudgedSearches(fastify, kind, now), now);
    if (state.open) logBreaker(fastify, kind, provider, "would_block", state);
  } catch (error) {
    fastify.log.warn({ error }, "Disjoncteur illisible (observation, au lancement)");
  }
}

/** Après l'issue d'une recherche : note l'ouverture, la réouverture ou la fermeture qu'elle a causée. */
export async function observeBreakerAfter(fastify: FastifyInstance, kind: BreakerKind, provider: string, searchId: string): Promise<void> {
  const now = Date.now();
  try {
    const searches = await readJudgedSearches(fastify, kind, now);
    const event = breakerEvent(searches, searchId, now);
    if (event) logBreaker(fastify, kind, provider, event, breakerState(searches, now));
  } catch (error) {
    fastify.log.warn({ error }, "Disjoncteur illisible (observation, après la recherche)");
  }
}
