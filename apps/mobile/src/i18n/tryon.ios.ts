// Textes de l'essayage virtuel dans l'app iPhone, dans la langue de l'app et
// lus à chaque affichage, comme `t` (src/i18n/index.ts) : ceux du site
// (tryon.web.ts, repris tels quels : un chemin .web écrit en entier se résout
// aussi sur iPhone, et une correction du site arrive donc ici sans rien
// recopier), plus les quelques textes propres à l'iPhone
// (tryon-iphone-fr.ios.ts et tryon-iphone-en.ios.ts).
import { getActiveLocale } from "./index";
import type { Locale } from "../lib/preferences";
import { tryonIphoneEn } from "./tryon-iphone-en.ios";
import { tryonIphoneFr, type TryonIphoneCatalog } from "./tryon-iphone-fr.ios";

export { tryonText, type TryonCatalog } from "./tryon.web";
export type { TryonIphoneCatalog };

const catalogs: Record<Locale, TryonIphoneCatalog> = { fr: tryonIphoneFr, en: tryonIphoneEn };

export const tryonIphoneText: Readonly<TryonIphoneCatalog> = new Proxy({} as TryonIphoneCatalog, {
  get: (_target, key: string) => catalogs[getActiveLocale()][key as keyof TryonIphoneCatalog],
});
