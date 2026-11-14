// Accès à l'essayage virtuel : statut d'âge et consentement versionné, tels
// que la base les garde (tryon_profiles, migration 0042). Le consentement
// n'est en vigueur que pour la version courante (TRYON_CONSENT_VERSION),
// acceptée et jamais retirée depuis ; une nouvelle version le fait
// redemander à tout le monde. Fonctions pures : testées sans base.
import type { TryonAgeGate, TryonConsentState, TryonErrorCode } from "@monapp/shared-types";
import { z } from "zod";

export const TRYON_PROFILE_ROW = z.object({
  age_status: z.enum(["adult", "minor"]).nullable(),
  age_checked_at: z.string().nullable(),
  consent_version: z.string().nullable(),
  consent_accepted_at: z.string().nullable(),
  consent_withdrawn_at: z.string().nullable(),
});

/** Le profil d'essayage d'un membre (aucun tant qu'il n'a pas passé la porte d'âge). */
export type TryonProfileRow = z.infer<typeof TRYON_PROFILE_ROW>;

export function ageGateOf(profile: TryonProfileRow | null): TryonAgeGate {
  return profile?.age_status ?? "unknown";
}

/** Un consentement accepté et jamais retiré depuis (quelle que soit sa
 * version) : celui que le membre peut retirer. */
export function hasStandingConsent(profile: TryonProfileRow | null): profile is TryonProfileRow & { consent_version: string } {
  return profile !== null && profile.consent_version !== null && profile.consent_accepted_at !== null && profile.consent_withdrawn_at === null;
}

/** Le consentement est-il à demander pour la version courante ? */
export function consentStateOf(profile: TryonProfileRow | null, currentVersion: string): TryonConsentState {
  return { required: !(hasStandingConsent(profile) && profile.consent_version === currentVersion), version: currentVersion };
}

export type TryonAccessRefusal = Extract<TryonErrorCode, "tryon_age_required" | "tryon_minor" | "tryon_consent_required" | "tryon_consent_outdated">;

/** Pourquoi un essai est refusé avant même de lire la photo, dans l'ordre de
 * la mission ; null si le membre peut essayer. */
export function accessRefusal(profile: TryonProfileRow | null, currentVersion: string): TryonAccessRefusal | null {
  const age = ageGateOf(profile);
  if (age === "unknown") return "tryon_age_required";
  if (age === "minor") return "tryon_minor";
  if (!hasStandingConsent(profile)) return "tryon_consent_required";
  return profile.consent_version === currentVersion ? null : "tryon_consent_outdated";
}
