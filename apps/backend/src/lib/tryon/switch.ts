// Interrupteur double de l'essayage virtuel (mission, § 5.1) : la fonction
// n'est active que si TRYON_ENABLED vaut "true" avec des réglages valides
// (lib/tryon/config.ts) ET si le drapeau feature_flags.tryon de la base est
// allumé (lib/tryon/featureFlag.ts). Le drapeau n'est même pas lu quand le
// premier interrupteur est coupé.
import type { TryonConfig, TryonConfigState } from "./config.js";
import type { FeatureFlagReader } from "./featureFlag.js";

/** Les réglages si l'essayage est actif, sinon null. */
export async function activeTryonConfig(state: TryonConfigState, flag: FeatureFlagReader): Promise<TryonConfig | null> {
  if (state.state !== "ready") return null;
  return (await flag.isOn()) ? state.config : null;
}
