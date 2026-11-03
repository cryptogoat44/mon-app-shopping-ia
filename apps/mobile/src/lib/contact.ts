// « Nous contacter » : Apple demande aux apps où les personnes publient des
// contenus un moyen simple de joindre l'éditeur. L'adresse est celle de
// l'éditeur, déjà donnée dans les documents juridiques :
// EXPO_PUBLIC_PUBLISHER_EMAIL, lue une seule fois, dans legal/publisher.ts.
// Le dépôt est PUBLIC : aucune adresse n'est écrite ici (règle du fondateur).
// Sans adresse réelle (variable absente ou vide, « [À compléter : …] »,
// adresse mal formée), l'entrée est masquée : jamais de champ à compléter
// ni de lien cassé à l'écran.
// Imports relatifs : ce fichier est testé par vitest, qui ne connaît pas
// l'alias « @/ ».
import { APP_NAME_DISPLAY } from "../constants/brand";
import { PUBLISHER } from "../legal/publisher";

// Adresse plausible : une partie locale, « @ », un domaine avec au moins un
// point. Seulement des caractères qu'un lien « mailto: » garde tels quels :
// ni espace, ni « ? », « & », « # » ou « % », qui en changeraient le sens.
const PLAUSIBLE_EMAIL = /^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** L'adresse de contact, ou null si la valeur manque, est vide, est encore
 * un « [À compléter : …] » ou n'est pas une adresse e-mail. */
export function contactEmail(value: string | null | undefined): string | null {
  const email = value?.trim() ?? "";
  return PLAUSIBLE_EMAIL.test(email) ? email : null;
}

/** Objet du message, le même dans les deux langues : l'éditeur retrouve ces
 * messages d'un coup d'œil. */
export const CONTACT_SUBJECT = `${APP_NAME_DISPLAY} — contact`;

/** Lien qui ouvre la messagerie vers l'adresse, objet encodé. */
export function contactMailto(email: string, subject: string = CONTACT_SUBJECT): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

/** Adresse de contact de cette version de l'app ou du site (fixée à la
 * construction), ou null : l'entrée « Nous contacter » est alors masquée. */
export const CONTACT_EMAIL = contactEmail(PUBLISHER.email);
