// Parcours 3 : « Vous l'avez achetée ? » au retour de la boutique (décision
// B1 du fondateur, 21 novembre 2026). Logique pure, testée
// (tests/achat-et-alerte.test.ts) : le retour de la boutique, les règles
// « pas trop souvent » et la mémoire de l'appareil (stockage passé en
// paramètre, comme lib/first-run-guide.ts). Branchée sur les écrans par
// lib/use-purchase-question.ts ; la feuille : components/purchase-question-sheet.tsx.
//
// Le retour, sans rien changer à l'ouverture (l'appel openMerchantLink est
// reçu tel quel) :
// - iPhone : openMerchantLink attend la fenêtre Safari, qui rend la main
//   quand le membre la ferme ; temps passé = fin − début. Un second toucher
//   pendant la visite (rien ne s'ouvre : double toucher, fenêtre déjà
//   ouverte) n'est pas un retour ;
// - site : openMerchantLink rend la main tout de suite. Si la page est
//   cachée dans les 10 s qui suivent le clic (boutique ouverte dans un
//   onglet), le retour suivant donne le temps passé, du clic au retour. Page
//   jamais cachée (fenêtre à part, onglet en arrière-plan) ou cachée plus
//   tard : rien. Ouverture bloquée par le navigateur : rien, et le lien de
//   secours n'est pas guetté ;
// - ailleurs (Android, où la fenêtre rend la main tout de suite) : rien
//   n'est guetté.
// Tout reste en mémoire de l'écran : rien si l'app a été fermée, l'onglet
// effacé ou l'écran quitté.
//
// Pas trop souvent : au moins 30 s dans la boutique ; une fois par pièce
// (matchId) et par jour, même après « Plus tard » ; 2 par jour au plus (jour
// de l'appareil) ; jamais pour une pièce déjà au Vault, par-dessus une autre
// feuille, ni sans compte connecté. La question compte dès qu'elle
// s'affiche. Mémoire par compte, sur l'appareil : le jour, le nombre de
// questions de ce jour et les pièces demandées ce jour-là (2 au plus) ; un
// autre jour, elle repart de zéro. Stockage illisible : pas de question.
// Imports relatifs : fichier testé par vitest.
import type { MerchantLinkContext, VaultCategory } from "@monapp/shared-types";
import type { Piece } from "../api/types";
import type { OpenMerchantLinkResult } from "./merchant-links";

/** Au moins ce temps dans la boutique avant de poser la question. */
export const MIN_AWAY_MS = 30_000;
/** Site : la page doit être cachée au plus tard ce temps après le clic. */
export const WEB_HIDE_WINDOW_MS = 10_000;
/** Au plus ce nombre de questions par jour (jour de l'appareil). */
export const QUESTIONS_PER_DAY = 2;

/** Où la question peut être posée, par le contexte du clic vers la boutique :
 * l'écran Résultat (result ; boutiques ajoutées et vos mots : similar) et la
 * fiche d'une Envie (wishlist ; ouverte par une alerte : price_alert). Nulle
 * part ailleurs : grille des Envies, Vault, publications, pièces reçues,
 * collections d'amis, messages, mémoire des vidéos (« Oui » y échouerait,
 * ou la pièce est déjà achetée). */
export const PURCHASE_CONTEXTS = ["result", "similar", "wishlist", "price_alert"] as const;
export type PurchaseContext = (typeof PURCHASE_CONTEXTS)[number];

export function purchaseContextOf(context: MerchantLinkContext): PurchaseContext | null {
  return (PURCHASE_CONTEXTS as readonly string[]).includes(context) ? (context as PurchaseContext) : null;
}

/** La pièce visée par la question : celle de la carte touchée, jamais la
 * grande carte affichée au retour. */
export interface QuestionTarget {
  /** Sa proposition d'origine (product_match) : « Oui » la range au Vault depuis elle. */
  matchId: string;
  title: string;
  imageUrl: string;
  imageHdUrl: string | null;
  /** Écran Résultat : la proposition touchée (« Garder », « Oui ») ; null sur la fiche d'une Envie. */
  piece: Piece | null;
}

/** Une carte de l'écran Résultat ; null pour une pièce de démonstration (jamais de question). */
export function targetOfPiece(piece: Piece): QuestionTarget | null {
  if (piece.real !== true) return null;
  return { matchId: piece.id, title: piece.name, imageUrl: piece.imageUrl, imageHdUrl: piece.imageHdUrl ?? null, piece };
}

/** La fiche d'une Envie : seulement avec sa proposition d'origine. */
export function targetOfWish(wish: { productMatchId: string | null; title: string; imageUrl: string; imageHdUrl: string | null }): QuestionTarget | null {
  if (!wish.productMatchId) return null;
  return { matchId: wish.productMatchId, title: wish.title, imageUrl: wish.imageUrl, imageHdUrl: wish.imageHdUrl, piece: null };
}

// ---- La mémoire de l'appareil ----

/** Clé du stockage, par compte (AsyncStorage dans l'app, localStorage sur le site). */
export function purchaseQuestionKey(userId: string): string {
  return `spotto.achat-question.${userId}`;
}

/** Tout ce qui est gardé : le jour, le nombre de questions de ce jour et
 * les pièces demandées ce jour-là (2 au plus). */
export interface QuestionMemory {
  day: string;
  count: number;
  asked: string[];
}

/** Le jour de l'appareil (« 2026-11-21 »), à l'heure de l'appareil. */
export function deviceDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** La mémoire de `today`. Un autre jour, rien, ou une valeur qui n'est pas
 * une mémoire (seul ce fichier écrit cette clé) : la journée repart de zéro. */
export function readQuestionMemory(raw: string | null, today: string): QuestionMemory {
  const fresh: QuestionMemory = { day: today, count: 0, asked: [] };
  if (!raw) return fresh;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (typeof value !== "object" || value === null) return fresh;
  const { day, count, asked } = value as Record<string, unknown>;
  if (day !== today) return fresh;
  const pieces = Array.isArray(asked) ? asked.filter((id): id is string => typeof id === "string").slice(-QUESTIONS_PER_DAY) : [];
  const counted = typeof count === "number" && Number.isInteger(count) && count >= 0 ? Math.min(count, QUESTIONS_PER_DAY) : QUESTIONS_PER_DAY;
  return { day: today, count: Math.max(counted, pieces.length), asked: pieces };
}

/** Encore une question permise aujourd'hui, et jamais deux fois la même pièce. */
export function questionAllowedToday(memory: QuestionMemory, matchId: string): boolean {
  return memory.count < QUESTIONS_PER_DAY && !memory.asked.includes(matchId);
}

export function withQuestionAsked(memory: QuestionMemory, matchId: string): QuestionMemory {
  return { day: memory.day, count: memory.count + 1, asked: [...memory.asked, matchId].slice(-QUESTIONS_PER_DAY) };
}

/** Ce qu'il faut du stockage (AsyncStorage dans l'app, localStorage sur le site). */
export interface QuestionStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Réserve la question pour cette pièce : elle compte dès qu'elle
 * s'affiche, donc la mémoire est écrite avant. false : déjà posée pour cette
 * pièce aujourd'hui, 2 déjà posées aujourd'hui, ou stockage illisible. */
export async function claimPurchaseQuestion(store: QuestionStore, userId: string, matchId: string, now: Date): Promise<boolean> {
  try {
    const key = purchaseQuestionKey(userId);
    const memory = readQuestionMemory(await store.getItem(key), deviceDay(now));
    if (!questionAllowedToday(memory, matchId)) return false;
    await store.setItem(key, JSON.stringify(withQuestionAsked(memory, matchId)));
    return true;
  } catch {
    return false;
  }
}

// ---- Le retour ----

export interface ReturnFacts {
  awayMs: number;
  userId: string | null;
  /** Déjà au Vault : « Ajoutée au Vault » sur l'écran Résultat (rouvert
   * compris), `inVault` sur la fiche, ou cloche « achetée ». */
  owned: boolean;
  /** Une autre feuille est ouverte (ou la question elle-même). */
  sheetOpen: boolean;
}

/** La question est-elle due à ce retour (avant la mémoire de l'appareil) ? */
export function questionDue(facts: ReturnFacts): boolean {
  return facts.awayMs >= MIN_AWAY_MS && facts.userId !== null && !facts.owned && !facts.sheetOpen;
}

export type WatchPlatform = "ios" | "web" | "other";

export function watchPlatformOf(os: string): WatchPlatform {
  return os === "ios" ? "ios" : os === "web" ? "web" : "other";
}

/** Un retour de la boutique repéré : la pièce ouverte, d'où, et le temps passé. */
export interface ShopReturn {
  target: QuestionTarget;
  context: PurchaseContext;
  awayMs: number;
}

export interface ShopWatcher {
  /** Ouvre la boutique par `open` (l'appel openMerchantLink, tel quel) et
   * guette le retour. Sans pièce ou sans contexte admis : `open` seulement. */
  open(target: QuestionTarget | null, context: PurchaseContext | null, open: () => Promise<OpenMerchantLinkResult>): Promise<OpenMerchantLinkResult>;
  /** Site : la page cachée (« background ») ou revenue (« active »). */
  appStateChanged(state: string): void;
  /** L'écran est quitté : plus aucun retour. */
  stop(): void;
}

/** Le même délai que lib/merchant-links.ts (DEBOUNCE_MS, non exporté) : un
 * second toucher sur la même pièce moins de 2 s après le précédent n'ouvre
 * rien (ni boutique, ni merchant_link_opened). Il n'est donc pas une visite. */
export const SAME_PIECE_DEBOUNCE_MS = 2_000;

/** Horloge et plateforme injectées (tests). */
export function createShopWatcher(platform: WatchPlatform, now: () => number, onReturn: (back: ShopReturn) => void): ShopWatcher {
  type Visit = { target: QuestionTarget; context: PurchaseContext; startedAt: number; hiddenAt: number | null };
  let visit: Visit | null = null;
  let stopped = false;
  // Début de la dernière ouverture, par pièce (comme openMerchantLink, par matchId).
  const lastOpened = new Map<string, number>();

  /** Ce toucher ouvrira-t-il quelque chose ? Non dans les 2 s qui suivent le
   * précédent sur la même pièce ; sinon, son début est noté. */
  function opens(target: QuestionTarget): boolean {
    const at = now();
    const last = lastOpened.get(target.matchId);
    if (last !== undefined && at - last < SAME_PIECE_DEBOUNCE_MS) return false;
    lastOpened.set(target.matchId, at);
    return true;
  }

  async function openOnIphone(target: QuestionTarget, context: PurchaseContext, open: () => Promise<OpenMerchantLinkResult>): Promise<OpenMerchantLinkResult> {
    // Une visite en cours : ce toucher n'ouvre rien (double toucher, fenêtre déjà ouverte).
    if (visit) return open();
    const current: Visit = { target, context, startedAt: now(), hiddenAt: null };
    visit = current;
    let outcome: OpenMerchantLinkResult;
    try {
      outcome = await open();
    } finally {
      if (visit === current) visit = null;
    }
    if (!stopped && !outcome.blocked) onReturn({ target, context, awayMs: Math.max(0, now() - current.startedAt) });
    return outcome;
  }

  async function openOnWeb(target: QuestionTarget, context: PurchaseContext, open: () => Promise<OpenMerchantLinkResult>): Promise<OpenMerchantLinkResult> {
    // Notée avant l'ouverture : la page peut se cacher aussitôt.
    const current: Visit = { target, context, startedAt: now(), hiddenAt: null };
    visit = current;
    try {
      const outcome = await open();
      if (outcome.blocked && visit === current) visit = null;
      return outcome;
    } catch (error) {
      if (visit === current) visit = null;
      throw error;
    }
  }

  return {
    open(target, context, open) {
      if (stopped || !target || !context || platform === "other" || !opens(target)) return open();
      return platform === "ios" ? openOnIphone(target, context, open) : openOnWeb(target, context, open);
    },
    appStateChanged(state) {
      if (platform !== "web" || stopped || !visit) return;
      const at = now();
      if (state !== "active") {
        if (visit.hiddenAt !== null) return;
        // Cachée trop tard : ce n'est pas la boutique qui l'a cachée.
        if (at - visit.startedAt <= WEB_HIDE_WINDOW_MS) visit.hiddenAt = at;
        else visit = null;
        return;
      }
      if (visit.hiddenAt === null) return;
      const done = visit;
      visit = null;
      onReturn({ target: done.target, context: done.context, awayMs: Math.max(0, at - done.startedAt) });
    },
    stop() {
      stopped = true;
      visit = null;
    },
  };
}

// ---- Les réponses ----

/** Après « Non, pas encore » : pièce pas gardée → la garder (et suivre son
 * prix si l'alerte est possible) ; gardée, Envie connue, alerte possible et
 * cloche éteinte → suivre son prix ; sinon (cloche déjà allumée, pièce sans
 * clé, Envie inconnue d'un résultat rouvert) la feuille se ferme. */
export type NoStep = "keep_follow" | "keep" | "follow" | "close";

export function noStepFor(facts: { kept: boolean; wishKnown: boolean; alertPossible: boolean; alertOn: boolean }): NoStep {
  if (!facts.kept) return facts.alertPossible ? "keep_follow" : "keep";
  return facts.wishKnown && facts.alertPossible && !facts.alertOn ? "follow" : "close";
}

/** L'issue de « Oui » : la pièce entrée au Vault (ou déjà là), ou un échec. */
export type YesOutcome = { kind: "added"; vaultItemId: string; alreadyInVault: boolean } | { kind: "failed" };

/** « Oui » puis la catégorie : la pièce au Vault depuis sa proposition
 * d'origine (le même POST /api/vault que « Je l'ai achetée »), puis le Vault
 * prévenu. Aucune publication : « Partager… » ouvre seulement la fiche de la
 * pièce, où « Partager dans mon fil » reste un geste à part. */
export async function addToVaultFromQuestion(
  target: { matchId: string; title: string; imageUrl: string },
  category: VaultCategory,
  deps: {
    add: (params: { title: string; imageUrl: string; category: VaultCategory; productMatchId: string }) => Promise<{ id: string; alreadyInVault?: boolean }>;
    changed: () => void;
  }
): Promise<YesOutcome> {
  try {
    const item = await deps.add({ title: target.title, imageUrl: target.imageUrl, category, productMatchId: target.matchId });
    deps.changed();
    return { kind: "added", vaultItemId: item.id, alreadyInVault: item.alreadyInVault === true };
  } catch {
    return { kind: "failed" };
  }
}

/** La fiche de la pièce rangée au Vault (« Partager… »). */
export function vaultItemRoute(id: string): { pathname: "/vault-item/[id]"; params: { id: string } } {
  return { pathname: "/vault-item/[id]", params: { id } };
}
