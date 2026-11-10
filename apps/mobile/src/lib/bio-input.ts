// Champ « Bio » de « Modifier le profil » (lot « profil et icône des
// réglages ») : limites appliquées pendant la saisie, compteur et message.
// Les règles elles-mêmes (160 caractères, 3 lignes) sont partagées avec le
// serveur (@monapp/shared-types). Logique pure, testée sans écran
// (tests/bio-input.test.ts).
import { BIO_MAX_LENGTH, BIO_MAX_LINES, bioProblem, limitBioInput, normalizeBio } from "@monapp/shared-types";
import { t } from "../i18n";

/** Nouvelle valeur du champ après une frappe ou un collage. Une bio déjà trop
 * longue (enregistrée avant ce lot, quand 280 caractères étaient permis) peut
 * être raccourcie librement sans être coupée d'un coup ; sinon, les limites
 * s'appliquent (limitBioInput). */
export function nextBioInput(previous: string, typed: string): string {
  if (typed.length > BIO_MAX_LENGTH && typed.length < previous.length) return typed;
  return limitBioInput(typed);
}

/** Compteur affiché sous le champ (« 42/160 »), et s'il est dépassé. */
export function bioCounter(bio: string): { text: string; over: boolean; label: string } {
  return { text: `${bio.length}/${BIO_MAX_LENGTH}`, over: bio.length > BIO_MAX_LENGTH, label: t.editProfile.bioCounterLabel(bio.length, BIO_MAX_LENGTH) };
}

/** Ce qui empêche d'enregistrer la bio, dit à la personne ; null si elle passe. */
export function bioError(bio: string): string | null {
  const problem = bioProblem(normalizeBio(bio));
  if (problem === "too_long") return t.editProfile.bioTooLong(BIO_MAX_LENGTH);
  if (problem === "too_many_lines") return t.editProfile.bioTooManyLines(BIO_MAX_LINES);
  return null;
}
