// Mesure de la voie C : ce qui est relevé pour chaque cas (un JSON brut par
// cas, hors de Git) et les calculs purs qui le construisent : propositions de
// la réponse, lignes de mesure du serveur, crédits réellement consommés.
// Testé (tests/mesureVoieC.test.ts).
import { z } from "zod";
import { COMPLEMENT_STATUSES, MATCH_ORIGINS, SEARCH_STATUSES, TEXT_SEARCH_STATUSES, type CropRect, type SearchComplement } from "@monapp/shared-types";
import type { Plan } from "./budget.js";
import type { CadreTrace, CasVerite } from "./jeu-de-verite.js";

/** « unique » : une seule passe ; « avec-mots » puis « sans-mots » : --les-deux. */
export type Passe = "unique" | "avec-mots" | "sans-mots";

export interface Proposition {
  /** Place dans sa liste (Lens, ou boutiques), 1 = en tête, comme à l'écran. */
  position: number;
  rang: number;
  titre: string;
  site: string | null;
  marchand: string | null;
  prix: number | null;
  devise: string | null;
  lien: string;
}

/** Colonnes de product_searches relues après le lancement (lecture seule). */
export const LIGNE_RECHERCHE = z.object({
  status: z.enum(SEARCH_STATUSES),
  error_message: z.string().nullable(),
  outcome: z.string().nullable(),
  failure_kind: z.string().nullable(),
  call_seconds: z.number().nullable(),
  received_count: z.number().nullable(),
  kept_count: z.number().nullable(),
  kept_with_price: z.number().nullable(),
  crop_area_pct: z.number().nullable(),
  provider_status_code: z.number().nullable(),
  complement_status: z.enum(COMPLEMENT_STATUSES).nullable(),
  shopping_calls: z.number(),
  lens_from_cache: z.boolean(),
  served_from_cache: z.boolean(),
  text_suggested: z.boolean(),
  total_seconds: z.number().nullable(),
});
export type LigneRecherche = z.infer<typeof LIGNE_RECHERCHE>;
export const COLONNES_LIGNE = Object.keys(LIGNE_RECHERCHE.shape).join(", ");

/** Lignes du journal du serveur gardées par l'outil : celles de mesure, sans
 * contenu par construction (des nombres et des listes fermées), plus le seul
 * message des erreurs. */
export const MESSAGES_GARDES = ["Mesure recherche", "Mesure complément", "Plafond recherches", "Place rendue"] as const;
export interface LigneJournal {
  msg: string;
  champs: Record<string, unknown>;
}

/** Champs techniques du journal jamais gardés (machine, heure, requête, erreur détaillée). */
const CHAMPS_ECARTES = new Set(["level", "time", "pid", "hostname", "reqId", "req", "res", "err", "error", "msg", "responseTime"]);

/** Une ligne de sortie du serveur (JSON de pino) → ligne gardée, ou null. */
export function lireLigneJournal(ligne: string): LigneJournal | null {
  let objet: unknown;
  try {
    objet = JSON.parse(ligne);
  } catch {
    return null;
  }
  if (typeof objet !== "object" || objet === null) return null;
  const { msg, level } = objet as { msg?: unknown; level?: unknown };
  if (typeof msg !== "string") return null;
  if ((MESSAGES_GARDES as readonly string[]).includes(msg)) {
    const champs = Object.fromEntries(Object.entries(objet).filter(([cle]) => !CHAMPS_ECARTES.has(cle)));
    return { msg, champs };
  }
  if (typeof level === "number" && level >= 50) return { msg: `erreur : ${msg}`, champs: {} };
  return null;
}

export interface JournalCas {
  recherche: Record<string, unknown> | null;
  complement: Record<string, unknown> | null;
  /** Places réservées juste avant un appel réel (Lens « search », Google Shopping « shopping »). */
  reservations: { search: number; shopping: number };
  /** Places rendues (refus non facturé, ou plus le temps d'appeler). */
  placesRendues: number;
  /** Refus des plafonds du serveur. */
  refusPlafond: number;
  erreurs: string[];
}

export function resumerJournal(lignes: readonly LigneJournal[]): JournalCas {
  const journal: JournalCas = { recherche: null, complement: null, reservations: { search: 0, shopping: 0 }, placesRendues: 0, refusPlafond: 0, erreurs: [] };
  for (const { msg, champs } of lignes) {
    if (msg === "Mesure recherche") journal.recherche = champs;
    else if (msg === "Mesure complément") journal.complement = champs;
    else if (msg === "Plafond recherches") {
      const etape = champs.step;
      if (champs.outcome === "reserved" && (etape === "search" || etape === "shopping")) journal.reservations[etape] += 1;
      if (champs.outcome === "refused") journal.refusPlafond += 1;
    } else if (msg === "Place rendue") {
      if (champs.released === true) journal.placesRendues += 1;
    } else journal.erreurs.push(msg);
  }
  return journal;
}

/** Code d'erreur d'une réponse du serveur ({ error, message }), ou null. */
export function codeErreur(corps: unknown): string | null {
  return typeof corps === "object" && corps !== null && typeof (corps as { error?: unknown }).error === "string" ? (corps as { error: string }).error : null;
}

export interface CreditsCas {
  lens: number;
  shopping: number;
  total: number;
  /** Selon le journal du serveur (places réservées moins places rendues). */
  selonJournal: number | null;
  /** Ligne illisible : compté au pire, par prudence. */
  estime: boolean;
}

/** Crédits SerpApi réellement consommés par un lancement. D'après la ligne :
 * Lens appelé (ni cache, ni refus non facturé, ni lancement arrêté avant
 * l'appel) et shopping_calls ; d'après le journal : places réservées moins
 * places rendues. Le plus grand des deux est gardé (prudence) ; sans ligne
 * lisible, le pire (2). */
export function creditsDuCas(ligne: LigneRecherche | null, journal: JournalCas | null): CreditsCas {
  const selonJournal = journal ? Math.max(0, journal.reservations.search + journal.reservations.shopping - journal.placesRendues) : null;
  if (!ligne) return { lens: 1, shopping: 1, total: Math.max(2, selonJournal ?? 0), selonJournal, estime: true };
  const lens = ligne.status !== "pending" && !ligne.lens_from_cache && ligne.failure_kind !== "provider_refused" ? 1 : 0;
  const shopping = ligne.shopping_calls;
  return { lens, shopping, total: Math.max(lens + shopping, selonJournal ?? 0), selonJournal, estime: false };
}

const PROPOSITION = z.object({
  rank: z.number(),
  productName: z.string(),
  merchantName: z.string().nullable().optional(),
  merchantUrl: z.string(),
  priceMin: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  origin: z.enum(MATCH_ORIGINS).optional(),
});
const REPONSE = z.object({
  status: z.enum(SEARCH_STATUSES),
  errorMessage: z.string().nullable().optional(),
  sortedByWords: z.boolean().optional(),
  complement: z
    .object({
      status: z.enum(COMPLEMENT_STATUSES).nullable(),
      query: z.string().optional(),
      suggestText: z.boolean(),
      textStatus: z.enum(TEXT_SEARCH_STATUSES).nullable(),
    })
    .optional(),
  matches: z.array(PROPOSITION),
});

function siteDe(lien: string): string | null {
  try {
    return new URL(lien).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export interface ReponseLue {
  status: string;
  errorMessage: string | null;
  sortedByWords: boolean;
  complement: SearchComplement | null;
  lens: Proposition[];
  boutiques: Proposition[];
}

/** La réponse du lancement, comme l'app la lit : propositions Lens (origine
 * absente ou « lens ») dans l'ordre affiché, puis « Cette pièce dans d'autres
 * boutiques » (origine « shopping »). null : réponse illisible. */
export function lireReponse(corps: unknown): ReponseLue | null {
  const lu = REPONSE.safeParse(corps);
  if (!lu.success) return null;
  const tries = [...lu.data.matches].sort((a, b) => a.rank - b.rank);
  const liste = (origine: "lens" | "shopping"): Proposition[] =>
    tries
      .filter((m) => (m.origin ?? "lens") === origine)
      .map((m, index) => ({
        position: index + 1,
        rang: m.rank,
        titre: m.productName,
        site: siteDe(m.merchantUrl),
        marchand: m.merchantName ?? null,
        prix: m.priceMin ?? null,
        devise: m.currency ?? null,
        lien: m.merchantUrl,
      }));
  return {
    status: lu.data.status,
    errorMessage: lu.data.errorMessage ?? null,
    sortedByWords: lu.data.sortedByWords === true,
    complement: lu.data.complement ?? null,
    lens: liste("lens"),
    boutiques: liste("shopping"),
  };
}

/** Un cas mesuré : écrit tel quel (JSON brut), relu par --refaire-rapport. */
export interface ResultatCas {
  version: 1;
  cas: number;
  passe: Passe;
  verite: Omit<CasVerite, "numero">;
  envoi: {
    /** Cadre envoyé (proportions) : le cadre tracé, ou l'image entière (0, 0, 1, 1). */
    cadre: CropRect | null;
    /** Le cadre tracé (pourcentages), ou null : image entière. */
    cadreTrace: Omit<CadreTrace, "numero"> | null;
    mots: string | null;
    motsTronques: boolean;
    image: { largeur: number; hauteur: number; octets: number };
    /** Empreinte de l'image analysée (celle de la clé du cache Lens). */
    empreinteZone: string | null;
  };
  /** « mesure » : le lancement a répondu ; « refus » : le serveur a refusé
   * (4xx) ; « panne » : erreur du serveur (5xx), ou pas de réponse. */
  issue: "mesure" | "refus" | "panne";
  http: { preparation: number | null; lancement: number | null };
  /** Code d'erreur du serveur, ou message de l'outil (jamais de secret). */
  erreur: string | null;
  reponse: Omit<ReponseLue, "lens" | "boutiques"> | null;
  propositions: { lens: Proposition[]; boutiques: Proposition[] };
  ligne: LigneRecherche | null;
  journal: JournalCas | null;
  durees: { preparationMs: number | null; lancementMs: number | null };
  credits: CreditsCas;
  /** Numéro du compte d'essai qui a lancé ce cas. */
  compte: number;
  horodatage: string;
}

/** Ce que dit la mesure entière (mesure.json), à côté des cas. */
export interface MetaMesure {
  version: 1;
  debut: string;
  fin: string | null;
  serveur: { commit: string | null; identiqueAMain: boolean | null; commitMain: string };
  jeu: string;
  cadres: { chemin: string; nombre: number; tracesParClaude: boolean };
  mots: "avec" | "sans" | "les-deux";
  plan: Plan;
  plafondsServeur: Record<string, string> | null;
  etatLens: string;
  compteurs: { avant: { jour: number; mois: number } | null; entrePasses: { jour: number; mois: number } | null; apres: { jour: number; mois: number } | null };
  /** Raison d'un arrêt avant la fin, ou null. */
  arret: string | null;
  nettoyage: { comptes: number; supprimes: number; restes: string[] };
  avertissements: string[];
}
