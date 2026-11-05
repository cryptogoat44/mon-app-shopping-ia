// Budget de la mesure de la voie C : annoncé avant toute dépense, et
// strictement borné — le compte SerpApi est sans doute partagé avec la
// production. Deux bornes : l'outil s'arrête avant le cas qui pourrait
// dépasser le plafond, et le serveur local reçoit des plafonds relevés juste
// assez pour ce budget (il refuse tout appel au-delà). Le plafond vaut pour la
// journée : ce que les mesures précédentes du dossier des sorties ont déjà
// dépensé aujourd'hui en est retranché. Logique pure, testée
// (tests/mesureVoieC.test.ts).
import { ErreurMesure } from "./jeu-de-verite.js";

/** Au plus par cas : Lens (1) et Google Shopping avec la requête de l'IA (1).
 * Jamais la voie B (« Que cherchez-vous ? ») : l'outil ne l'appelle pas. */
export const CREDITS_PAR_CAS = 2;
/** Seconde passe de --les-deux : serveur relancé avec l'IA coupée (ni IA, ni
 * Google Shopping possibles), Lens lu dans le cache ; au pire, Lens rappelé
 * si la lecture du cache ne répond pas à temps (800 ms). */
export const CREDITS_PAR_CAS_SECONDE_PASSE = 1;
/** Au plus un appel à l'IA d'Anthropic par cas de la première passe (titres Lens → requête). */
export const APPELS_IA_PAR_CAS = 1;
export const PLAFOND_PAR_DEFAUT = 60;
/** Au-delà, une faute de frappe : l'outil refuse. */
export const PLAFOND_MAX = 100;
/** Cas par compte d'essai : sous la limite de 10 lancements par heure et par
 * personne (lib/rateLimits.ts, searchCreate) et dans la part de 8 photos par
 * jour (SERPAPI_USER_DAILY_CAP) : le serveur n'a pas à être modifié. */
export const CAS_PAR_COMPTE = 8;
/** Compte SerpApi (src/env.ts, octobre 2026) : 250 recherches par mois, dont
 * 225 pour l'app ; la marge de 25 est celle des outils d'essai du fondateur. */
export const QUOTA_SERPAPI_MOIS = 250;
export const MARGE_OUTILS_SERPAPI = 25;

export interface Plan {
  /** Cas de la première passe (ou de la seule). */
  cas: number;
  /** 2 avec --les-deux : une passe avec vos mots, puis une sans. */
  passes: 1 | 2;
  /** Crédits SerpApi au plus pour la première passe. */
  creditsPremierePasse: number;
  /** Seconde passe : cas relancés au plus (ceux dont Lens a répondu en passe 1). */
  casSecondePasse: number;
  /** Seconde passe : 0 attendu (cache de 24 h, IA coupée), ceci au pire. */
  creditsSecondePasseAuPire: number;
  plafond: number;
  /** Déjà dépensé aujourd'hui par les mesures précédentes du dossier des sorties : retranché du plafond. */
  dejaDepenses: number;
  /** Ce que la mesure peut dépenser au plus : le plafond (moins le déjà dépensé), ou moins. */
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

export function planMesure(cas: number, options: { lesDeux: boolean; plafond: number; dejaDepenses?: number; casSecondePasse?: number }): Plan {
  const dejaDepenses = options.dejaDepenses ?? 0;
  const disponible = Math.max(0, options.plafond - dejaDepenses);
  const casSecondePasse = options.lesDeux ? (options.casSecondePasse ?? cas) : 0;
  const creditsPremierePasse = cas * CREDITS_PAR_CAS;
  const creditsSecondePasseAuPire = casSecondePasse * CREDITS_PAR_CAS_SECONDE_PASSE;
  return {
    cas,
    passes: options.lesDeux ? 2 : 1,
    creditsPremierePasse,
    casSecondePasse,
    creditsSecondePasseAuPire,
    plafond: options.plafond,
    dejaDepenses,
    creditsAuPlus: Math.min(creditsPremierePasse + creditsSecondePasseAuPire, disponible),
    // La seconde passe tourne IA coupée : jamais d'appel à l'IA.
    appelsIaAuPlus: cas * APPELS_IA_PAR_CAS,
    casCoupesParLePlafond: Math.max(0, cas - Math.floor(disponible / CREDITS_PAR_CAS)),
    comptes: Math.ceil(cas / CAS_PAR_COMPTE) + Math.ceil(casSecondePasse / CAS_PAR_COMPTE),
  };
}

/** Garde du budget : un cas ne part que si, au pire, il tient dans le plafond
 * (le déjà dépensé du jour compris). */
export class GardeBudget {
  depenses: number;

  constructor(
    readonly plafond: number,
    dejaDepenses = 0
  ) {
    this.depenses = dejaDepenses;
  }

  peutLancer(coutAuPire: number = CREDITS_PAR_CAS): boolean {
    return this.depenses + coutAuPire <= this.plafond;
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
  const disponible = Math.max(0, plan.plafond - plan.dejaDepenses);
  const lignes = [
    `Plan : ${plan.cas} cas${plan.passes === 2 ? ", en deux passes (avec vos mots, puis sans)" : ""}.`,
    `  Crédits SerpApi : au plus ${plan.creditsPremierePasse} (Lens + Google Shopping, ${CREDITS_PAR_CAS} par cas ; jamais « Que cherchez-vous ? »).`,
  ];
  if (plan.passes === 2) {
    lignes.push(
      `  Seconde passe : serveur local relancé avec l'IA de la voie C coupée (ni IA, ni Google Shopping possibles) ; seuls les cas dont Lens a répondu en passe 1 sont relancés (${plan.casSecondePasse} au plus), Lens lu dans le cache de 24 h : 0 crédit attendu ; au pire ${plan.creditsSecondePasseAuPire} (1 par cas, si le cache ne répond pas à temps).`
    );
  }
  if (plan.dejaDepenses > 0) {
    lignes.push(`  Déjà dépensé aujourd'hui par les mesures précédentes (dossier des sorties) : ${plan.dejaDepenses} crédit(s), retranché(s) du plafond : il reste ${disponible}.`);
  }
  lignes.push(
    `  Plafond strict : ${plan.plafond} crédits${plan.dejaDepenses > 0 ? " pour la journée, mesures précédentes comprises" : ""} — l'outil s'arrête avant de le dépasser, et le serveur local refuse tout appel au-delà.`,
    `  Dépense au plus : ${plan.creditsAuPlus} crédits SerpApi, pris sur le compte SerpApi (sans doute partagé avec la production).`,
    `  Marge des outils prévue par le serveur sur ce compte : ${MARGE_OUTILS_SERPAPI} sur ${QUOTA_SERPAPI_MOIS} par mois (src/env.ts) ; cette mesure : jusqu'à ${plan.creditsAuPlus}. Avant l'accord : vérifier sur le tableau de bord de SerpApi les recherches restantes ce mois-ci.`,
    `  IA d'Anthropic (clé d'essai) : au plus ${plan.appelsIaAuPlus} appels${plan.passes === 2 ? " (première passe seulement)" : ""}, texte seulement (titres Lens), jamais d'image.`,
    `  Comptes d'essai sur spotto-dev-2 : ${plan.comptes} au plus (${CAS_PAR_COMPTE} cas au plus chacun), listés au fur et à mesure dans comptes.json, supprimés à la fin.`
  );
  if (plan.casCoupesParLePlafond > 0) lignes.push(`  ⚠ Avec ce plafond, jusqu'à ${plan.casCoupesParLePlafond} cas pourraient ne pas être mesurés.`);
  lignes.push("  Toute relance avec --confirmer (y compris --reprendre) demande un nouvel accord écrit du fondateur, cumul du jour compris.");
  return lignes;
}
