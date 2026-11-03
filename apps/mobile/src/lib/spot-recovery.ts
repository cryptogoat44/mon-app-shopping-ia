// Recherche coupée (lot recherche coupée) : pendant les 10 à 20 s d'attente,
// beaucoup repassent sur TikTok ou perdent le réseau. Le serveur, lui, va au
// bout d'une recherche engagée et l'enregistre. L'app garde donc son numéro
// et relit son issue (GET /api/searches/:id, gratuit) au lieu d'en payer une
// deuxième. Règle absolue : sans geste de la personne, rien n'est jamais
// relancé — une recherche jamais partie attend « Relancer ». Logique sans
// écran, testée (imports relatifs : fichier testé par vitest).
import { SEARCH_FAILURE_MESSAGES, type CropRect, type ProductSearch } from "@monapp/shared-types";
import { ApiError } from "./api-error";
import { isNetworkError } from "./network-error";

/** Une relecture toutes les 3 s tant que la recherche est en cours. */
export const RECHECK_INTERVAL_MS = 3_000;
/** Au-delà, on cesse d'attendre : le serveur marque « interrompue » une
 * recherche restée en cours 2 minutes, et la relecture suivante le dit. */
export const RUNNING_LIMIT_MS = 135_000;
/** Relectures en échec d'affilée avant de dire Spotto injoignable : au retour
 * dans l'app, le réseau revient souvent une ou deux secondes plus tard. */
export const READ_ATTEMPTS = 3;
/** Une relecture restée sans réponse est abandonnée (réseau instable). */
export const READ_TIMEOUT_MS = 10_000;

/** Où en est une recherche relue :
 * - finished : terminée, avec des propositions ou « rien trouvé » (un vrai résultat) ;
 * - failed : en échec côté service (panne, ou interrompue au bout de 2 min) ;
 * - running : encore en cours ;
 * - not_started : jamais partie (« pending ») — le lancement l'accepte encore. */
export type SearchProgress = "finished" | "failed" | "running" | "not_started";

export function searchProgress(search: Pick<ProductSearch, "status" | "errorMessage">): SearchProgress {
  if (search.status === "pending") return "not_started";
  if (search.status === "processing") return "running";
  if (search.status === "failed" && search.errorMessage === SEARCH_FAILURE_MESSAGES.technical) return "failed";
  return "finished";
}

/** Le lancement a échoué sans dire son issue : aucune réponse (réseau coupé,
 * délai dépassé), serveur en panne ou redémarré (5xx), ou « déjà lancée »
 * (409 : une relance qui croise la première). La recherche a pu partir : on
 * la relit. Les autres refus (limite atteinte, image refusée, session
 * expirée…) arrivent avant tout appel à la recherche : ils se montrent tels quels. */
export function launchOutcomeUnknown(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 408 || error.status === 409;
  return isNetworkError(error);
}

/** Ce qui part au lancement : même image, même cadre et mêmes mots (qui
 * trient les propositions), c'est la même recherche. */
export interface LaunchRequest {
  imageUri: string | null;
  crop: CropRect | null;
  words: string | null;
}

/** Lancement dont l'issue n'a pas encore été montrée (annulé, écran quitté,
 * réponse perdue), gardé dans le brouillon avec son numéro. */
export interface UnsettledLaunch extends LaunchRequest {
  searchId: string;
}

export function launchRequestOf(draft: { localImageUri: string | null; crop: CropRect | null; words: string | null }): LaunchRequest {
  return { imageUri: draft.localImageUri, crop: draft.crop, words: draft.words };
}

function sameCrop(a: CropRect | null, b: CropRect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Relancé à l'identique (« Lancer » après « Annuler », « Relancer ») : la
 * recherche coupée est relue d'abord, jamais repayée à l'aveugle. */
export function sameLaunch(previous: UnsettledLaunch | null | undefined, next: LaunchRequest): previous is UnsettledLaunch {
  if (!previous) return false;
  return previous.imageUri === next.imageUri && sameCrop(previous.crop, next.crop) && (previous.words ?? null) === (next.words ?? null);
}

/** Issue encore inconnue, ce que l'écran en dit :
 * - not_started : jamais partie — « Relancer », sous le même numéro ;
 * - unreachable : relecture impossible (réseau) — « Vérifier à nouveau » ;
 * - still_running : toujours en cours à la limite — « Vérifier à nouveau ». */
export type UnsettledState = "not_started" | "unreachable" | "still_running";

export type Recovery =
  /** Terminée ou en échec : à montrer telle quelle. */
  | { kind: "settled"; search: ProductSearch }
  | { kind: "unsettled"; state: UnsettledState }
  | { kind: "cancelled" };

/** Relecture (seulement des lectures, gratuites), attente et horloge :
 * remplaçables dans les tests. */
export interface RecoveryPorts {
  read: (searchId: string, signal: AbortSignal) => Promise<ProductSearch>;
  /** Rend la main au bout de `ms`, ou dès l'abandon (signal). */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

/** Relit la recherche jusqu'à connaître son issue. Aucune relance ici : ces
 * ports ne savent que lire. En cours : relue toutes les 3 s, jusqu'à la
 * limite. Relecture en échec : retentée, puis « injoignable ». */
export async function recoverSearch(searchId: string, ports: RecoveryPorts, signal: AbortSignal): Promise<Recovery> {
  const giveUpAt = ports.now() + RUNNING_LIMIT_MS;
  let failedReads = 0;
  for (;;) {
    if (signal.aborted) return { kind: "cancelled" };
    let search: ProductSearch | null = null;
    try {
      search = await ports.read(searchId, signal);
      failedReads = 0;
    } catch {
      failedReads += 1;
    }
    if (signal.aborted) return { kind: "cancelled" };
    if (search) {
      const progress = searchProgress(search);
      if (progress === "finished" || progress === "failed") return { kind: "settled", search };
      if (progress === "not_started") return { kind: "unsettled", state: "not_started" };
      if (ports.now() >= giveUpAt) return { kind: "unsettled", state: "still_running" };
    } else if (failedReads >= READ_ATTEMPTS) {
      return { kind: "unsettled", state: "unreachable" };
    }
    await ports.sleep(RECHECK_INTERVAL_MS, signal);
  }
}

/** Relance à l'identique, par un geste (« Lancer », « Relancer »), d'un
 * lancement dont l'issue n'a pas été montrée, une fois la recherche relue :
 * - show : terminée — son résultat, sans nouvel appel ;
 * - run_same : jamais partie — lancée sous le même numéro ;
 * - run_fresh : en échec côté service — une nouvelle recherche, celle du geste ;
 * - unsettled : injoignable ou toujours en cours — rien n'est lancé. */
export type ResumeStep =
  | { kind: "show"; search: ProductSearch }
  | { kind: "run_same" }
  | { kind: "run_fresh" }
  | { kind: "unsettled"; state: Exclude<UnsettledState, "not_started"> }
  | { kind: "cancelled" };

export function resumeStep(recovery: Recovery): ResumeStep {
  if (recovery.kind === "cancelled") return recovery;
  if (recovery.kind === "settled") return searchProgress(recovery.search) === "failed" ? { kind: "run_fresh" } : { kind: "show", search: recovery.search };
  return recovery.state === "not_started" ? { kind: "run_same" } : { kind: "unsettled", state: recovery.state };
}

/** Le bouton principal de l'écran : « Relancer » (un geste, la même
 * recherche) seulement pour une recherche jamais partie ; sinon « Vérifier à
 * nouveau », une relecture. */
export function unsettledAction(state: UnsettledState): "relaunch" | "check" {
  return state === "not_started" ? "relaunch" : "check";
}

/** Au retour dans l'app : relire seule (gratuit), jamais relancer seule —
 * une recherche jamais partie attend « Relancer ». */
export function recheckOnReturn(state: UnsettledState): boolean {
  return unsettledAction(state) === "check";
}

const foregroundListeners = new Set<() => void>();

/** Retour dans l'app (iPhone : après TikTok ; site : onglet de nouveau
 * visible), signalé par les écrans du Spotter (use-foreground-return.ts) à
 * l'identification en cours. */
export function notifyAppForeground(): void {
  for (const listener of [...foregroundListeners]) listener();
}

/** Écoute le temps d'un lancement ; renvoie de quoi cesser d'écouter. */
export function onAppForeground(listener: () => void): () => void {
  foregroundListeners.add(listener);
  return () => {
    foregroundListeners.delete(listener);
  };
}
