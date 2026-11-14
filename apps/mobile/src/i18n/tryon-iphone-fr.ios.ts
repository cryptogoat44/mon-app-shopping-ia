// Essayage virtuel photo, app iPhone (branche feature/essayage-virtuel-mobile,
// jamais fusionnée) : les seuls textes propres à l'iPhone. Tous les autres
// textes du parcours viennent tels quels du catalogue du site
// (tryon-fr.web.ts), et quelques textes généraux de fr.ts (appareil photo
// refusé, « Choisir dans la galerie », mise à jour depuis l'App Store) :
// aucun texte n'est écrit deux fois. Mêmes règles que fr.ts : vouvoiement,
// phrases courtes, ton sobre ; le nom du produit vient toujours de BRAND.
// L'anglais (tryon-iphone-en.ios.ts) a exactement les mêmes clés :
// tests/tryon-iphone.test.ts le vérifie.
import { APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import type { Widen } from "./types";

export const tryonIphoneFr = {
  consent: {
    // Le serveur demande une version du texte plus récente que celle de cette
    // app : rien à accepter ici, seule une mise à jour de l'app apporte le
    // nouveau texte (sur le site, recharger la page suffit).
    updateBody: `Le texte de consentement de l'essayage a été mis à jour. Cette version de ${BRAND} ne le contient pas encore : mettez l'app à jour pour le lire avant de l'accepter.`,
  },
  save: {
    saved: "Image enregistrée dans vos photos.",
    denied: `L'ajout à vos photos n'est pas autorisé. Pour enregistrer l'image, autorisez-le dans les Réglages de l'iPhone, puis ${BRAND}, puis Photos.`,
    failed: "L'image n'a pas pu être enregistrée dans vos photos. Réessayez.",
  },
} as const;

/** Forme du catalogue : celle du français, avec des textes libres. */
export type TryonIphoneCatalog = Widen<typeof tryonIphoneFr>;
