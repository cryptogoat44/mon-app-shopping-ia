// Garde-fous de la série de mesure (décisions du fondateur, 2026-10-24) :
// relevé écrit avant et après chaque appel, arrêt à la première panne ou
// après 3 réponses vides de suite, réserve de 30 recherches, plafond par jour,
// page d'état, compteur de SerpApi relu et comparé au relevé, reprise sans
// jamais refaire une recherche déjà facturée. Logique pure, testée
// (tests/serieMesure.test.ts).
import { z } from "zod";
import { AUTORISATION_SERIE, PIECES_SERIE, type EtapeSerie } from "./serie-plan.js";

/** Réserve gardée jusqu'au 2 novembre (décision du fondateur). */
export const RESERVE = 30;
/** Plafond de la série par jour de Paris (proposé le 24 octobre, accepté avec le plan). */
export const PLAFOND_JOUR = 30;
/** Arrêt après autant de réponses vides de suite (signe d'un incident). */
export const VIDES_DE_SUITE_MAX = 3;

const ISSUES = ["en_cours", "reussie", "vide", "erreur", "panne", "interrompue_facturee", "interrompue_non_facturee", "non_lancee"] as const;
export type IssueSerie = (typeof ISSUES)[number];

/** Une valeur relevée : des nombres, des domaines, des devises — jamais un titre ni une adresse. */
const VALEUR = z.union([z.number(), z.string().max(80), z.null(), z.array(z.union([z.number(), z.string().max(80)])).max(60), z.array(z.object({ rang: z.number(), domaine: z.string().max(80), devise: z.string().max(8).nullable() })).max(10)]);

export const LIGNE_SERIE = z.object({
  numero: z.number().int().positive(),
  lot: z.number().int(),
  piece: z.enum(PIECES_SERIE),
  service: z.enum(["lens", "shopping", "immersive", "product"]),
  lanceeLe: z.string(),
  issue: z.enum(ISSUES),
  code: z.number().int().nullable(),
  statutSerpApi: z.string().max(20).nullable(),
  facturee: z.enum(["oui", "non", "inconnu"]),
  secondes: z.number().nullable(),
  mesures: z.record(VALEUR).nullable(),
  message: z.string().max(160).nullable(),
});
export type LigneSerie = z.infer<typeof LIGNE_SERIE>;

export const COMPTEUR = z.object({ utilisees: z.number().int().nonnegative(), restantes: z.number().int(), lueLe: z.string() });
export type Compteur = z.infer<typeof COMPTEUR>;

export const RELEVE_SERIE = z.object({
  phrase: z.string(),
  /** Compteur de référence : la série compare ses recherches facturées à l'écart depuis cette lecture. */
  reference: COMPTEUR.nullable(),
  lignes: z.array(LIGNE_SERIE),
  lots: z.array(z.object({ lot: z.number().int(), avant: COMPTEUR, apres: COMPTEUR.nullable(), services: z.record(z.string().nullable()), incidents: z.array(z.string().max(160)) })),
});
export type ReleveSerie = z.infer<typeof RELEVE_SERIE>;

const JOUR_DE_PARIS = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** Jour de Paris (AAAA-MM-JJ) d'un instant. */
export function jourParis(instant: Date): string {
  return JOUR_DE_PARIS.format(instant);
}

/** Une ligne correspond-elle à un appel réellement parti vers SerpApi ? */
function appelParti(ligne: LigneSerie): boolean {
  return ligne.issue !== "non_lancee" && ligne.issue !== "interrompue_non_facturee";
}

/** Appels partis pendant le jour de Paris donné (plafond par jour). */
export function appelsDuJour(lignes: readonly LigneSerie[], jour: string): number {
  return lignes.filter((l) => appelParti(l) && jourParis(new Date(l.lanceeLe)) === jour).length;
}

/** Recherches comptées contre l'autorisation : parties, sauf celles que SerpApi dit non facturées. */
export function rechercheesAutorisees(lignes: readonly LigneSerie[]): number {
  return lignes.filter((l) => appelParti(l) && l.facturee !== "non").length;
}

/** Recherches facturées d'après le relevé (réponse de SerpApi, ou compteur lors d'une reprise). */
export function factureesSelonReleve(lignes: readonly LigneSerie[]): number {
  return lignes.filter((l) => l.facturee === "oui").length;
}

const TERMINEES: ReadonlySet<IssueSerie> = new Set(["reussie", "vide", "erreur", "panne", "interrompue_facturee", "non_lancee"]);

/** Prochaine étape à faire : la première du plan sans ligne terminée. Une
 * étape interrompue SANS facturation (prouvé par le compteur) est refaite. */
export function etapeSuivante(plan: readonly EtapeSerie[], lignes: readonly LigneSerie[]): EtapeSerie | null {
  return plan.find((etape) => !lignes.some((l) => l.numero === etape.numero && TERMINEES.has(l.issue))) ?? null;
}

export type Arret = { raison: "panne" | "vides" | "en_cours" | "autorisation"; message: string };

/** Faut-il s'arrêter avant le prochain appel ? */
export function arretDemande(lignes: readonly LigneSerie[]): Arret | null {
  if (lignes.some((l) => l.issue === "en_cours")) return { raison: "en_cours", message: "Un appel est resté « en cours » : la reprise doit d'abord être tranchée avec le compteur." };
  const derniere = lignes.at(-1);
  if (derniere && (derniere.issue === "panne" || derniere.issue === "erreur")) return { raison: "panne", message: `Panne à l'étape ${derniere.numero} : série arrêtée (première panne).` };
  const appels = lignes.filter(appelParti);
  const dernieres = appels.slice(-VIDES_DE_SUITE_MAX);
  if (dernieres.length === VIDES_DE_SUITE_MAX && dernieres.every((l) => l.issue === "vide")) return { raison: "vides", message: `${VIDES_DE_SUITE_MAX} réponses vides de suite : série arrêtée (signe d'un incident).` };
  if (rechercheesAutorisees(lignes) >= AUTORISATION_SERIE) return { raison: "autorisation", message: `Autorisation épuisée : ${AUTORISATION_SERIE} recherches.` };
  return null;
}

/** Reprise d'un appel resté « en cours » (session interrompue) : le compteur
 * de SerpApi dit s'il a été facturé. Facturé : on ne le refait pas (sa
 * réponse est perdue). Non facturé : on peut le refaire. Autre écart : on
 * s'arrête et on demande au fondateur. */
export function decisionReprise(reference: Compteur, actuel: Compteur, lignes: readonly LigneSerie[]): "facturee" | "non_facturee" | "ecart" {
  const ecart = actuel.utilisees - reference.utilisees;
  const facturees = factureesSelonReleve(lignes);
  if (ecart === facturees) return "non_facturee";
  if (ecart === facturees + 1) return "facturee";
  return "ecart";
}

/** Le compteur correspond-il au relevé (après chaque lot) ? */
export function compteurConcorde(reference: Compteur, actuel: Compteur, lignes: readonly LigneSerie[]): boolean {
  return actuel.utilisees - reference.utilisees === factureesSelonReleve(lignes);
}

/** La réserve tient-elle si les étapes restantes du lot partent ? */
export function reserveSuffisante(actuel: Compteur, etapesRestantes: number): boolean {
  return actuel.restantes - etapesRestantes >= RESERVE;
}

/** Services de la page d'état dont dépend un lot (Google Product API n'y a pas de ligne). */
export function servicesDuLot(lot: number): string[] {
  return lot === 10 ? ["Shopping Light API", "Immersive Product API"] : ["Lens API"];
}

/** Tous les services du lot sont-ils annoncés « operational » ? */
export function servicesOperationnels(etats: Record<string, string | null>, services: readonly string[]): boolean {
  return services.every((service) => etats[service] === "operational");
}
