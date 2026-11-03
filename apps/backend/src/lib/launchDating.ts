// Jour du lancement (lot quota, 2026-11-02). La part de chaque personne (8
// photos par jour, serpapi_quota, migrations 0022 puis 0027) compte ses
// recherches créées le jour (de Paris) de la réservation. Préparée avant
// minuit et lancée après, une recherche ne comptait dans aucune part : sa
// journée de création était finie, et celle du lancement ne la voyait pas.
// Préparer ne coûtant rien, un seul compte pouvait préparer 25 recherches le
// soir, les lancer le lendemain et épuiser le plafond du jour de tout le
// service. Au lancement, une telle recherche prend donc l'heure du lancement
// comme date de création ; lancée le jour même, elle garde la sienne. Arrêtée
// avant l'appel (plafond atteint, annulation), elle garde cette nouvelle date
// et compte le jour où elle repart.
// Effets acceptés de cette date : la conservation de 12 mois part du
// lancement, non de la préparation (lib/searchRetention.ts) ; « Récemment
// spottées » la range à l'heure du lancement ; l'export RGPD la montre créée
// à cette heure.
import { parisDayStart } from "./matchFeedback.js";

/** Colonnes écrites par le verrou du lancement. */
export interface LaunchDating {
  run_started_at: string;
  /** Seulement pour une recherche créée avant minuit (heure de Paris) le jour du lancement. */
  created_at?: string;
}

/** L'heure du lancement, et la même heure comme date de création si la
 * recherche a été créée un jour (de Paris) précédent. Date de création
 * illisible : jamais changée (comme avant). */
export function launchDating(createdAt: string, now: Date): LaunchDating {
  const launchedAt = now.toISOString();
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || created >= parisDayStart(now).getTime()) return { run_started_at: launchedAt };
  return { run_started_at: launchedAt, created_at: launchedAt };
}
