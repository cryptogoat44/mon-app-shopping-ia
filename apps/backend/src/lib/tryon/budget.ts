// Budget mensuel de l'essayage virtuel, même règle que la base (migration
// 0042) : dépense du mois = crédits des essais réussis × prix du crédit.
// - Réservation (tryon_reserve) : refusée si la dépense du mois, plus les
//   essais en cours et celui-ci, dépasserait le budget.
// - Après un essai réussi (tryon_complete) : alerte « budget_80 » dès que la
//   dépense atteint le seuil (80 % par défaut), alerte « budget_100 » dès que
//   le budget ne permet plus un essai de plus ; une seule de chaque par mois.
// Les montants sont comptés en millionièmes de dollar (nombres entiers),
// comme les nombres exacts de la base : jamais d'écart d'arrondi.
// Fonctions pures, utilisées par le rapport du fondateur et par la fausse
// base des tests.

const MICRO = 1_000_000;
const micro = (usd: number) => Math.round(usd * MICRO);

/** Dépense en dollars de `credits` crédits. */
export function spendUsd(credits: number, pricePerCreditUsd: number): number {
  return (credits * micro(pricePerCreditUsd)) / MICRO;
}

export interface BudgetRule {
  budgetUsd: number;
  pricePerCreditUsd: number;
  alertThreshold: number;
}

/** Un essai de plus tient-il dans le budget du mois (essais en cours comptés) ? */
export function reservationFitsBudget(rule: BudgetRule, creditsUsedThisMonth: number, pendingTries: number, creditsPerTry: number): boolean {
  const credits = creditsUsedThisMonth + (pendingTries + 1) * creditsPerTry;
  return credits * micro(rule.pricePerCreditUsd) <= micro(rule.budgetUsd);
}

export type BudgetAlertKind = "budget_80" | "budget_100";

/** Les seuils atteints après un essai réussi (la base ne garde chaque alerte
 * qu'une fois par mois) : « budget_80 », puis « budget_100 » quand il n'y a
 * plus de quoi payer un essai de plus du même coût. */
export function budgetThresholdsReached(rule: BudgetRule, creditsUsedThisMonth: number, lastTryCredits: number): BudgetAlertKind[] {
  const spent = creditsUsedThisMonth * micro(rule.pricePerCreditUsd);
  const reached: BudgetAlertKind[] = [];
  if (spent >= Math.round(rule.alertThreshold * micro(rule.budgetUsd))) reached.push("budget_80");
  if (spent + Math.max(lastTryCredits, 1) * micro(rule.pricePerCreditUsd) > micro(rule.budgetUsd)) reached.push("budget_100");
  return reached;
}

/** Le mois en un coup d'œil : dépense, reste et part du budget utilisée. */
export function budgetSummary(rule: BudgetRule, creditsUsedThisMonth: number): { spentUsd: number; remainingUsd: number; usedShare: number } {
  const spent = creditsUsedThisMonth * micro(rule.pricePerCreditUsd);
  const budget = micro(rule.budgetUsd);
  return { spentUsd: spent / MICRO, remainingUsd: Math.max(budget - spent, 0) / MICRO, usedShare: budget > 0 ? spent / budget : 1 };
}
