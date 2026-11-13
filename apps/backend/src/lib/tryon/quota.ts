// Quota de l'essayage virtuel, tel que le compte la base (migration 0042,
// tryon_reserve et tryon_complete) : d'abord les essais gratuits du mois
// civil (TRYON_FREE_PER_MONTH, non reportables), puis les essais offerts
// encore valables, celui qui expire le plus tôt d'abord. Un essai n'est
// décompté que s'il réussit. Fonctions pures : la base reste la seule à
// décider ; elles servent au rapport du fondateur, à la fausse base des
// tests, et documentent la règle par des tests.

/** Un essai offert (une commande), tel que la base le garde. */
export interface BonusGrant {
  id: string;
  remaining: number;
  expiresAt: Date;
  createdAt: Date;
}

/** Essais gratuits restants : jamais moins de zéro. */
export function freeRemaining(freeUsedThisMonth: number, freePerMonth: number): number {
  return Math.max(freePerMonth - freeUsedThisMonth, 0);
}

/** Un essai offert est valable tant qu'il n'a pas expiré à cet instant. */
function isValid(grant: BonusGrant, at: Date): boolean {
  return grant.remaining > 0 && grant.expiresAt.getTime() > at.getTime();
}

/** Essais offerts encore valables à cet instant (les expirés ne comptent jamais). */
export function bonusRemaining(grants: readonly BonusGrant[], at: Date): number {
  return grants.filter((grant) => isValid(grant, at)).reduce((sum, grant) => sum + grant.remaining, 0);
}

/** L'essai offert à décompter : valable à l'instant de la réservation, celui
 * qui expire le plus tôt (puis le plus ancien) ; null s'il n'y en a aucun. */
export function bonusToConsume(grants: readonly BonusGrant[], reservedAt: Date): BonusGrant | null {
  const valid = grants.filter((grant) => isValid(grant, reservedAt));
  valid.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  return valid[0] ?? null;
}

/** D'où vient un essai réussi : du mois (gratuit) tant qu'il en reste, puis
 * d'un essai offert. Sans aucun des deux (cas limite d'un essai rattrapé),
 * compté sur le mois : l'image a été remise. */
export function quotaSourceFor(freeUsedThisMonth: number, freePerMonth: number, grants: readonly BonusGrant[], reservedAt: Date): { source: "free" | "bonus"; grant: BonusGrant | null } {
  if (freeUsedThisMonth < freePerMonth) return { source: "free", grant: null };
  const grant = bonusToConsume(grants, reservedAt);
  return grant ? { source: "bonus", grant } : { source: "free", grant: null };
}
