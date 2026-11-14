// Choix du fournisseur d'essayage par TRYON_PROVIDER (lib/tryon/config.ts).
// Changer de fournisseur : ajouter son fichier dans ce dossier (il met en
// œuvre TryOnProvider, lib/tryon/provider.ts), son nom dans
// TRYON_PROVIDER_NAMES et sa ligne ci-dessous, puis régler TRYON_PROVIDER
// chez Render. Rien d'autre ne change : les routes ne connaissent que
// l'interface.
import type { TryonConfig, TryonProviderName } from "../config.js";
import type { TryOnProvider } from "../provider.js";
import { FakeProvider } from "./fake.js";
import { FashnProvider } from "./fashn.js";

const FACTORIES: Record<TryonProviderName, (config: TryonConfig) => TryOnProvider> = {
  fake: () => new FakeProvider(),
  fashn: (config) => {
    // Garanti par la vérification des réglages (clé obligatoire avec « fashn »).
    if (!config.apiKey) throw new Error("Clé FASHN absente : réglages non vérifiés");
    return new FashnProvider({ apiKey: config.apiKey, baseUrl: config.apiBaseUrl });
  },
};

/** Le fournisseur choisi par des réglages vérifiés (état « ready »). */
export function createTryonProvider(config: TryonConfig): TryOnProvider {
  return FACTORIES[config.provider](config);
}
