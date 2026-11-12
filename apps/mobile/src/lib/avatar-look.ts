// Photo de profil par défaut (lot « profil et icône des réglages ») : sans
// photo, les initiales de la personne sur une couleur à elle. Logique pure,
// testée sans écran (tests/avatar-look.test.ts) ; l'affichage est dans
// components/avatar.tsx.
import { avatarBackgrounds, darkPalette, lightPalette, type ColorScheme } from "../theme/tokens";

// Une lettre ou un chiffre, de n'importe quelle écriture (accents compris).
const LETTER = /[\p{L}\p{N}]/u;
// Ce qui sépare deux mots d'un nom : espaces, tirets, points, apostrophes, « _ ».
const SEPARATORS = /[\s\-‐-―_.·'’]+/u;

/** Première lettre (ou chiffre) d'un mot ; un émoji ou un symbole est sauté. */
function firstLetter(word: string): string | null {
  for (const char of word) if (LETTER.test(char)) return char;
  return null;
}

/** Une lettre en majuscule, toujours un seul caractère (« ß » donnerait « SS »). */
function upper(letter: string): string {
  return Array.from(letter.toLocaleUpperCase())[0] ?? letter;
}

function initialsOf(text: string): string {
  const letters = text
    .normalize("NFC")
    .split(SEPARATORS)
    .map(firstLetter)
    .filter((letter): letter is string => letter !== null);
  if (letters.length === 0) return "";
  const picked = letters.length === 1 ? [letters[0]!] : [letters[0]!, letters[letters.length - 1]!];
  return picked.map(upper).join("");
}

/** Initiales affichées : 1 ou 2 lettres, celles du premier et du dernier mot
 * du nom affiché (« Camille Durand » → « CD », « Élodie » → « É ») ; sans
 * lettre dans le nom affiché (que des émojis), celles du nom d'utilisateur ;
 * chaîne vide s'il n'y a rien à écrire (une silhouette s'affiche alors). */
export function avatarInitials(displayName: string | null | undefined, username?: string | null): string {
  for (const source of [displayName, username]) {
    const initials = initialsOf(source ?? "");
    if (initials) return initials;
  }
  return "";
}

/** Rang de la couleur, toujours le même pour un compte : un calcul simple
 * (FNV-1a sur 32 bits) de son identifiant, ramené au nombre de couleurs. */
export function avatarColorIndex(userId: string, count = avatarBackgrounds.light.length): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % count;
}

/** Fond et couleur des initiales d'un compte, dans le thème voulu. */
export function avatarColors(userId: string, scheme: ColorScheme): { background: string; text: string } {
  const backgrounds = avatarBackgrounds[scheme];
  return {
    background: backgrounds[avatarColorIndex(userId, backgrounds.length)]!,
    text: (scheme === "dark" ? darkPalette : lightPalette).blanc,
  };
}
