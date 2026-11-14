// Alertes de l'essayage virtuel : budget du mois à 80 % (« budget_80 »),
// budget épuisé (« budget_100 »), solde de crédits FASHN bas
// (« low_credits »). La base les enregistre une seule fois par période
// (tryon_alerts, migration 0042) ; notifyTryonAlert est appelée seulement
// pour une alerte qui vient d'apparaître.

export type TryonAlertKind = "budget_80" | "budget_100" | "low_credits";

interface WarnLog {
  warn(fields: Record<string, unknown>, message: string): void;
}

/** Point d'accroche des alertes de l'essayage. Aujourd'hui : une ligne
 * d'avertissement dans le journal de Render, rien d'autre (aucun service
 * d'e-mail n'est branché, décision de la mission). Le jour où un e-mail au
 * fondateur est branché, c'est ici, et seulement ici, qu'il part.
 * `details` : des nombres et des valeurs de listes fermées seulement (mois,
 * dépense, budget, solde), jamais une donnée personnelle. */
export function notifyTryonAlert(log: WarnLog, kind: TryonAlertKind, details: Record<string, string | number>): void {
  log.warn({ alerte: `essayage_${kind}`, ...details }, "Alerte de l'essayage virtuel");
}
