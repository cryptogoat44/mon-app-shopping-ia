import { describe, expect, it } from "vitest";
import { MAX_CALLS_PER_PHOTO, photoCallsLeft, startDeadline, VOIE_C_BUDGET } from "../src/lib/deadline.js";

// Lot c, voie C : budget de temps d'un lancement, avec une fausse horloge.
function fakeClock(start: number) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("budget de la voie C", () => {
  it("valeurs du budget corrigé : 14 s au total, 1,5 s pour l'enregistrement, Lens fixe à 12 s", () => {
    expect(VOIE_C_BUDGET).toEqual({
      totalMs: 14_000,
      saveReserveMs: 1_500,
      lensTimeoutMs: 12_000,
      aiMaxMs: 3_000,
      aiMinMs: 1_000,
      shoppingMaxMs: 5_000,
      shoppingMinMs: 2_500,
      textShoppingMaxMs: 10_000,
      cacheReadMs: 800,
    });
  });

  it("temps écoulé et restant depuis T0, négatif une fois dépassé", () => {
    const clock = fakeClock(1_000_000);
    const deadline = startDeadline(clock.now(), VOIE_C_BUDGET.totalMs, clock.now);
    expect(deadline.elapsedMs()).toBe(0);
    expect(deadline.remainingMs()).toBe(14_000);
    clock.advance(9_000);
    expect(deadline.elapsedMs()).toBe(9_000);
    expect(deadline.remainingMs()).toBe(5_000);
    clock.advance(6_000);
    expect(deadline.remainingMs()).toBe(-1_000);
  });

  it("délai d'une étape : min(plafond, restant − réserve) ; null sous 1 ms", () => {
    const clock = fakeClock(0);
    const deadline = startDeadline(0, 14_000, clock.now);
    // IA : min(3 s, restant − 4 s).
    expect(deadline.stepTimeoutMs(3_000, 4_000)).toBe(3_000);
    clock.advance(8_500);
    expect(deadline.stepTimeoutMs(3_000, 4_000)).toBe(1_500);
    clock.advance(1_499.6);
    expect(deadline.stepTimeoutMs(3_000, 4_000)).toBeNull();
    // Boutiques : min(5 s, restant − 1,5 s).
    const fresh = startDeadline(0, 14_000, () => 7_000);
    expect(fresh.stepTimeoutMs(5_000, 1_500)).toBe(5_000);
    const late = startDeadline(0, 14_000, () => 12_400);
    expect(late.stepTimeoutMs(5_000, 1_500)).toBe(100);
    expect(startDeadline(0, 14_000, () => 12_500).stepTimeoutMs(5_000, 1_500)).toBeNull();
  });

  it("3 recherches au plus par photo : un 4ᵉ appel est toujours refusé", () => {
    expect(MAX_CALLS_PER_PHOTO).toBe(3);
    expect(photoCallsLeft(true, 0)).toBe(2);
    expect(photoCallsLeft(false, 0)).toBe(3);
    expect(photoCallsLeft(true, 1)).toBe(1);
    expect(photoCallsLeft(true, 2)).toBe(0);
    expect(photoCallsLeft(false, 2)).toBe(1);
    // Jamais négatif, même si la ligne était incohérente.
    expect(photoCallsLeft(true, 5)).toBe(0);
  });
});
