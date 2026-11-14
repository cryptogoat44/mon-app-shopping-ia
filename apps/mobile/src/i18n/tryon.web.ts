// Textes de l'essayage virtuel (site seulement), dans la langue de l'app :
// même principe que `t` (src/i18n/index.ts). Toujours lus à l'affichage,
// jamais figés dans une constante au chargement d'un module (vérifié par
// tests/tryon-catalog.test.ts). Les textes : tryon-fr.web.ts et tryon-en.web.ts.
import { getActiveLocale } from "./index";
import type { Locale } from "../lib/preferences";
import { tryonFr, type TryonCatalog } from "./tryon-fr.web";
import { tryonEn } from "./tryon-en.web";

export type { TryonCatalog };

const catalogs: Record<Locale, TryonCatalog> = { fr: tryonFr, en: tryonEn };

export const tryonText: Readonly<TryonCatalog> = new Proxy({} as TryonCatalog, {
  get: (_target, key: string) => catalogs[getActiveLocale()][key as keyof TryonCatalog],
});
