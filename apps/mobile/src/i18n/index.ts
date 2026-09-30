// Langue active de l'interface (lot 3). `t` désigne toujours le catalogue de
// la langue active : changer de langue remonte l'arbre des écrans
// (preferences-context.tsx), qui relit alors tous les textes.
import { fr } from "./fr";
import { en } from "./en";
import type { Locale } from "../lib/preferences";
import type { Catalog } from "./types";

export type { Catalog };

const catalogs: Record<Locale, Catalog> = { fr, en };
let active: Locale = "fr";

export const t: Readonly<Catalog> = new Proxy({} as Catalog, {
  get: (_target, key: string) => catalogs[active][key as keyof Catalog],
});

export function setActiveLocale(locale: Locale): void {
  active = locale;
}

export function getActiveLocale(): Locale {
  return active;
}

let deviceRegion: string | null = null;

export function setDeviceRegion(region: string | null): void {
  deviceRegion = region && /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : null;
}

/** En-tête Accept-Language envoyé au serveur : la langue de l'app, suivie
 * pour l'anglais de la région de l'appareil (pays de la recherche visuelle). */
export function acceptLanguage(): string {
  return active === "en" && deviceRegion ? `en-${deviceRegion}` : active;
}
