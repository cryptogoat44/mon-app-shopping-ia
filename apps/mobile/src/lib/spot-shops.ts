// Boutiques ensuite (2026-11-08). L'écran Résultat montre les propositions de
// la recherche visuelle dès qu'elles arrivent, avec une ligne discrète
// « Recherche dans d'autres boutiques… » ; « Cette pièce dans d'autres
// boutiques » s'ajoute dessous quelques secondes plus tard
// (POST /api/searches/:id/complement). Rien trouvé, refus, panne ou délai
// dépassé : la ligne disparaît, sans message.
// - La grande carte, choisie au premier affichage, ne change jamais quand les
//   boutiques arrivent (complement.late, lib/price-first.ts) : « Je l'ai
//   achetée » vise toujours la pièce montrée.
// - Une seule demande par recherche dans la session, partie dès la réponse
//   du lancement (lib/api.ts) ; l'écran la retrouve ici. Le serveur, lui, ne
//   fait l'étape payante qu'une fois par recherche, quoi qu'il arrive.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../api/types";
import { toSpotResult } from "./spot-result";

/** Au-delà, l'app n'attend plus les boutiques : la ligne disparaît. Le
 * serveur leur donne 14 s, plus 20 s au plus quand une autre demande fait
 * déjà l'étape. */
export const SHOPS_TIMEOUT_MS = 40_000;

/** Ce que l'écran fait de la réponse : ajouter les boutiques (même vides :
 * l'issue et « Que cherchez-vous ? » viennent avec elles), ou retirer la ligne. */
export type ShopsOutcome = { kind: "added"; search: ProductSearch } | { kind: "none" };

const NONE: ShopsOutcome = { kind: "none" };

/** Le résultat attend-il encore ses boutiques ? */
export function shopsPending(result: Pick<SpotResult, "searchId" | "complement"> | null): boolean {
  return result?.searchId != null && result.complement?.pending === true;
}

/** La réponse du serveur : son complément, s'il est connu ; encore
 * « pending » (une autre demande n'a pas fini à temps) : rien. */
export function shopsOutcomeOf(search: ProductSearch): ShopsOutcome {
  return search.complement && search.complement.pending !== true ? { kind: "added", search } : NONE;
}

/** Les boutiques ajoutées sous le résultat déjà affiché. Les propositions de
 * la recherche visuelle restent celles affichées, dans le même ordre (mêmes
 * indices, même tri par les mots) ; seules les sections du complément
 * s'ajoutent dessous, marquées `late` : la grande carte et ce qui est replié
 * ne changent pas. */
export function withShops(previous: SpotResult, search: ProductSearch): SpotResult {
  const shops = toSpotResult(search).complement;
  if (previous.status !== "success" || !shops) return withoutShopsPending(previous);
  return {
    ...previous,
    complement: {
      shopping: shops.shopping,
      words: shops.words,
      status: shops.status,
      query: shops.query,
      suggestText: shops.suggestText,
      textStatus: shops.textStatus,
      late: true,
    },
  };
}

/** Plus rien à attendre : la ligne disparaît, rien d'autre ne change. */
export function withoutShopsPending(result: SpotResult): SpotResult {
  if (!result.complement?.pending) return result;
  const { pending: _pending, ...complement } = result.complement;
  return { ...result, complement };
}

/** Le résultat de l'écran une fois l'issue des boutiques connue. Seulement
 * pour la recherche attendue, et tant qu'elle attend encore. */
export function afterShops(current: SpotResult, searchId: string, outcome: ShopsOutcome): SpotResult {
  if (current.searchId !== searchId || !current.complement?.pending) return current;
  return outcome.kind === "added" ? withShops(current, outcome.search) : withoutShopsPending(current);
}

// Une demande par recherche dans la session (20 au plus en mémoire).
const requests = new Map<string, Promise<ShopsOutcome>>();
const REQUESTS_MAX = 20;

/** La demande des boutiques de cette recherche : lancée une fois (par la
 * réponse du lancement, ou par l'écran pour un résultat relu encore en
 * attente), puis rendue telle quelle. Ne lève jamais d'erreur : refus, panne
 * ou délai dépassé donnent « rien ». La demande n'est pas abandonnée quand
 * l'écran se ferme : le serveur enregistre les boutiques, visibles à la
 * réouverture. */
export function requestShops(searchId: string, fetchShops: (signal: AbortSignal) => Promise<ProductSearch>, timeoutMs = SHOPS_TIMEOUT_MS): Promise<ShopsOutcome> {
  const known = requests.get(searchId);
  if (known) return known;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const request = Promise.resolve()
    .then(() => fetchShops(controller.signal))
    .then(shopsOutcomeOf, () => NONE)
    .finally(() => clearTimeout(timer));
  requests.set(searchId, request);
  if (requests.size > REQUESTS_MAX) {
    const oldest = requests.keys().next().value;
    if (oldest !== undefined) requests.delete(oldest);
  }
  return request;
}

/** Tests seulement : oublie les demandes. */
export function forgetShopsRequests(): void {
  requests.clear();
}
