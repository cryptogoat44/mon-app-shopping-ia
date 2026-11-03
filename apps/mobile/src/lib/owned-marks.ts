// « Gardée » et « Ajoutée au Vault » sur un résultat rouvert (lot « Retrouver
// ses pièces ») : le serveur dit, à la relecture d'une recherche, quelles
// propositions la personne a déjà dans ses Envies ou son Vault. Sans cela,
// l'écran rouvert reproposait « Garder » et « Je l'ai achetée ».
// Imports relatifs : fichier testé par vitest.
import type { ProductSearch } from "@monapp/shared-types";
import type { SpotResult } from "../api/types";

/** Repères d'une recherche relue ; un ancien serveur n'en envoie pas : aucun. */
export function ownedMarks(search: Pick<ProductSearch, "wishlistMatchIds" | "vaultMatchIds">): NonNullable<SpotResult["owned"]> {
  return { kept: search.wishlistMatchIds ?? [], bought: search.vaultMatchIds ?? [] };
}

/** `current` avec les identifiants `ids` en plus — le même ensemble s'il ne
 * manque rien, pour ne pas redessiner l'écran pour rien. */
export function withIds(current: Set<string>, ids: readonly string[]): Set<string> {
  const missing = ids.filter((id) => !current.has(id));
  return missing.length === 0 ? current : new Set([...current, ...missing]);
}
