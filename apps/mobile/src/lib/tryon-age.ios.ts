// Essayage virtuel photo, app iPhone : la saisie de la date de naissance de
// la porte d'âge. Le site s'appuie sur le champ de date du navigateur ; sur
// l'iPhone, un champ au clavier numérique, vide au départ (aucune date
// proposée qu'un appui distrait enverrait : le statut enregistré ne change
// plus) : on tape les chiffres, les tirets se placent seuls, au format du
// site et du serveur (« AAAA-MM-JJ », texte d'aide du catalogue). Le contrôle
// avant l'envoi est celui du site (checkBirthDate, lib/tryon-read.web.ts).
// Logique pure, testée (tests/tryon-iphone.test.ts).

/** Huit chiffres : l'année, le mois, le jour. */
const DIGITS = 8;

/** Longueur du champ, tirets compris (« 1990-05-12 »). */
export const BIRTH_DATE_INPUT_LENGTH = 10;

/** Ce que montre le champ après une frappe ou un collage : les chiffres
 * seuls, avec un tiret après l'année et après le mois dès que la suite est
 * commencée (un retour arrière efface donc aussi le tiret devenu inutile). */
export function formatBirthDateInput(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, DIGITS);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
