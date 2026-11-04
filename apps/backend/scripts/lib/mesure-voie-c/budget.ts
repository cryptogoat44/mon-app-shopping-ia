// Budget de la mesure de la voie C : annoncé avant toute dépense, et
// strictement borné — le compte SerpApi est sans doute partagé avec la
// production. Deux bornes : l'outil s'arrête avant le cas qui pourrait
// dépasser le plafond, et le serveur local reçoit des plafonds relevés juste
// assez pour ce budget (il refuse tout appel au-delà). Logique pure, testée
// (tests/mesureVoieC.test.ts).
import { ErreurMesure } from "./jeu-de-verite.js";

/** Au plus par cas : Lens (1) et Google Shopping avec la requête de l'IA (1).
 * Jamais la voie B (« Que cherchez-vous ? ») : l'outil ne l'appelle pas. */
export const CREDITS_PAR_CAS = 2;
/** Au plus un appel à l'IA d'Anthropic par cas (titres Lens → requête). */
export const APPELS_IA_PAR_CAS = 1;
export const PLAFOND_PAR_DEFAUT = 60;
/** Au-delà, une faute de frappe : l'outil refuse. */
export const PLAFOND_MAX = 100;
/** Cas par compte d'essai : sous la limite de 10 lancements par heure et par
 * personne (lib/rateLimits.ts, searchCreate) et dans la part de 8 photos par
 * jour (SERPAPI_USER_DAILY_CAP) : le serveur n'a pas à être modifié. */
export const CAS_PAR_COMPTE = 8;

export interface Plan {
  cas: number;
  /** 2 avec --les-deux : une passe avec vos mots, puis une sans. */
  passes: 1 | 2;
  /** Crédits SerpApi au plus pour la première passe. */
  creditsPremierePasse: number;
  /** Seconde passe : 0 attendu (cache de 24 h), ceci au pire. */
  creditsSecondePasseAuPire: number;
  plafond: number;
  /** Ce que la mesure peut dépenser au plus : le plafond, ou moins. */
  creditsAuPlus: number;
  appelsIaAuPlus: number;
  /** Cas de la première passe que le plafond pourrait empêcher. */
  casCoupesParLePlafond: number;
  /** Comptes d'essai créés puis supprimés. */
  comptes: number;
}

export function lirePlafond(texte: string | undefined): number {
  const plafond = texte !== undefined && /^\d+$/.test(texte) ? Number(texte) : Number.NaN;
  if (!Number.isInteger(plafond) || plafond < CREDITS_PAR_CAS || plafond > PLAFOND_MAX) {
    throw new ErreurMesure(`--plafond-credits : un nombre entier de ${CREDITS_PAR_CAS} à ${PLAFOND_MAX} (un cas peut coûter ${CREDITS_PAR_CAS} crédits).`);
  }
  return plafond;
}

export function planMesure(cas: number, options: { lesDeux: boolean; plafond: number }): Plan {
  const passes = options.lesDeux ? 2 : 1;
  const creditsPremierePasse = cas * CREDITS_PAR_CAS;
  const auPire = creditsPremierePasse * passes;
  return {
    cas,
    passes,
    creditsPremierePasse,
    creditsSecondePasseAuPire: options.lesDeux ? creditsPremierePasse : 0,
    plafond: options.plafond,
    creditsAuPlus: Math.min(auPire, options.plafond),
    appelsIaAuPlus: cas * APPELS_IA_PAR_CAS * passes,
    casCoupesParLePlafond: Math.max(0, cas - Math.floor(options.plafond / CREDITS_PAR_CAS)),
    comptes: Math.ceil(cas / CAS_PAR_COMPTE) * passes,
  };
}

/** Garde du budget : un cas ne part que si, au pire, il tient dans le plafond. */
export class GardeBudget {
  depenses = 0;

  constructor(readonly plafond: number) {}

  peutLancer(): boolean {
    return this.depenses + CREDITS_PAR_CAS <= this.plafond;
  }

  /** Ajoute les crédits d'un cas ; au-delà du plafond (impossible en principe), arrêt net. */
  compter(credits: number): void {
    this.depenses += credits;
    if (this.depenses > this.plafond) throw new ErreurMesure(`Arrêt net : ${this.depenses} crédits comptés, au-delà du plafond de ${this.plafond}.`);
  }
}

/** Compteurs de spotto-dev-2 (serpapi_quota, lecture seule) : appels du jour et du cycle mensuel. */
export interface Compteurs {
  jour: number;
  mois: number;
}

/** Plafonds du serveur local, pour CE processus seulement : les appels déjà
 * comptés plus le budget, rien de plus ; la part de chaque compte d'essai,
 * ses cas. */
export function plafondsServeur(compteurs: Compteurs, budget: number): Record<"SERPAPI_DAILY_CAP" | "SERPAPI_MONTHLY_CAP" | "SERPAPI_USER_DAILY_CAP", string> {
  return {
    SERPAPI_DAILY_CAP: String(compteurs.jour + budget),
    SERPAPI_MONTHLY_CAP: String(compteurs.mois + budget),
    SERPAPI_USER_DAILY_CAP: String(CAS_PAR_COMPTE),
  };
}

/** Le plan, en lignes simples pour le Terminal. */
export function lignesDuPlan(plan: Plan): string[] {
  const lignes = [
    `Plan : ${plan.cas} cas${plan.passes === 2 ? ", en deux passes (avec vos mots, puis sans)" : ""}.`,
    `  Crédits SerpApi : au plus ${plan.creditsPremierePasse} (Lens + Google Shopping, ${CREDITS_PAR_CAS} par cas ; jamais « Que cherchez-vous ? »).`,
  ];
  if (plan.passes === 2) {
    lignes.push(`  Seconde passe : 0 crédit attendu (cache de 24 h du serveur) ; au pire ${plan.creditsSecondePasseAuPire} de plus si la première a eu des pannes.`);
  }
  lignes.push(
    `  Plafond strict : ${plan.plafond} crédits — l'outil s'arrête avant de le dépasser, et le serveur local refuse tout appel au-delà.`,
    `  Dépense au plus : ${plan.creditsAuPlus} crédits SerpApi, pris sur le compte SerpApi (sans doute partagé avec la production).`,
    `  IA d'Anthropic (clé d'essai) : au plus ${plan.appelsIaAuPlus} appels, texte seulement (titres Lens), jamais d'image.`,
    `  Comptes d'essai sur spotto-dev-2 : ${plan.comptes} (${CAS_PAR_COMPTE} cas au plus chacun), supprimés à la fin.`
  );
  if (plan.casCoupesParLePlafond > 0) lignes.push(`  ⚠ Avec ce plafond, jusqu'à ${plan.casCoupesParLePlafond} cas pourraient ne pas être mesurés.`);
  return lignes;
}
