// Page « Aide et contact » (chantier 3) : adresse publique, ouverte à tous,
// connecté ou non — c'est aussi l'adresse d'assistance (« Support URL ») de
// la fiche App Store : https://<adresse du site>/aide.
// Imports relatifs : ce fichier est testé par vitest, qui ne connaît pas
// l'alias « @/ ».
import { CONTACT_EMAIL } from "./contact";
import { PUBLISHER, PUBLISHER_EN } from "../legal/publisher";
import type { Locale } from "./preferences";

export const HELP_PATH = "/aide";

/** Adresse affichée sur la page : l'adresse de contact réelle ; sinon la
 * valeur saisie telle quelle, ou le « [À compléter : …] » des documents
 * juridiques, bien visible (la page reste lisible, rien n'est inventé). */
export function helpContactText(
  locale: Locale,
  email: string | null = CONTACT_EMAIL,
  publisherEmail: { fr: string; en: string } = { fr: PUBLISHER.email, en: PUBLISHER_EN.email }
): string {
  return email ?? publisherEmail[locale];
}
