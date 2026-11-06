// Filtre des mots interdits (chantier 3, point 6 de la feuille de route V1 ;
// règle 1.2 d'Apple : « un moyen de filtrer les contenus choquants avant leur
// publication »). Appliqué par le serveur, seul juge, aux textes que les
// autres verront : légendes, commentaires, nom d'utilisateur, nom affiché et
// bio. Un texte refusé n'est pas enregistré ; la personne le corrige.
//
// Volontairement simple et prudent : des insultes, des injures racistes,
// homophobes ou antisémites, des termes sexuels crus, en français et en
// anglais. Les mots qui ont aussi un sens courant (« bite » en anglais,
// « chatte », « queue », « pussy » d'un « pussy bow »…) n'y sont PAS : un
// filtre qui refuse « salopette » ou « fagot » serait pire que rien sur une
// app de mode. Les cas qui passent au travers se signalent, et plusieurs
// signalements masquent le contenu (lib/autoHide.ts).
//
// Comparaison sur une forme simplifiée : minuscules, sans accents, chiffres
// « leet » remplacés (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), lettres
// répétées réduites, ponctuation interne retirée (« p.u.t.e », « f-u-c-k »).
// Les mots qui ont un autre sens courant n'y sont pas (« retard », « baiser »,
// « fag » des Anglais, « spic and span ») : refuser « en retard » ou « un
// baiser » serait absurde.
// Fonctions pures, testées par tests/contentFilter.test.ts.

/** Mots refusés tels quels (forme simplifiée), avec leur pluriel en -s/-x. */
const EXACT_WORDS: readonly string[] = [
  // Français : insultes et termes sexuels crus.
  "pute",
  "putain",
  "salope",
  "salaud",
  "connard",
  "connasse",
  "conasse",
  "enfoire",
  "batard",
  "pouffiasse",
  "petasse",
  "grognasse",
  "trouduc",
  "fdp",
  "ntm",
  "nique",
  "niquer",
  "niquez",
  "suceuse",
  "branleur",
  "branleuse",
  // Français : injures racistes, homophobes, antisémites.
  "negre",
  "negresse",
  "bougnoule",
  "bougnoul",
  "bicot",
  "youpin",
  "youtre",
  "chinetoque",
  "bamboula",
  "pd",
  "pede",
  "tarlouze",
  "tafiole",
  "gouine",
  // Anglais : insultes et termes sexuels crus.
  "fuck",
  "shit",
  "bullshit",
  "bitch",
  "bitches",
  "whore",
  "slut",
  "cunt",
  "asshole",
  "arsehole",
  "wanker",
  "twat",
  "dickhead",
  "cocksucker",
  "porn",
  "porno",
  "retarded",
  // Anglais : injures racistes, homophobes, antisémites.
  "nigger",
  "nigga",
  "niggaz",
  "faggot",
  "kike",
  "tranny",
  "coon",
];

/** Racines refusées où qu'elles apparaissent dans un mot (« fuckin »,
 * « enculé », « leconnard ») : seulement des suites de lettres qu'aucun mot
 * courant, français ou anglais, ne contient. */
const BANNED_FRAGMENTS: readonly string[] = ["fuck", "encul", "connard", "connass", "faggot", "motherf", "pouffiass", "salopard"];

/** Expressions refusées (mots simplifiés, séparés par une espace). */
const BANNED_PHRASES: readonly string[] = [
  "fils de pute",
  "nique ta mere",
  "ta mere la pute",
  "trou du cul",
  "va te faire foutre",
  "suce ma bite",
  "sale arabe",
  "sale noir",
  "sale juif",
  "sale negre",
  "sale pede",
  "sale gouine",
  "sale race",
  "heil hitler",
  "sieg heil",
  "kill yourself",
  "kys",
  "son of a bitch",
  "suck my dick",
];

const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Minuscules, sans accents ni ligatures. */
export function simplify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae");
}

/** Chiffres et signes « leet » remplacés par la lettre qu'ils imitent (« s4l0pe »). */
function unLeet(text: string): string {
  return text.replace(/[013457@$]/g, (char) => LEET[char] ?? char);
}

const EXACT = new Set(EXACT_WORDS.map((word) => simplify(word)));
const PHRASES = BANNED_PHRASES.map((phrase) => ` ${simplify(phrase)} `);

/** Le mot, puis ses lettres répétées 3 fois ou plus ramenées à 2
 * (« connnnard »), puis toutes ramenées à 1 (« fuuuck »). */
function squeezed(word: string): string[] {
  return [word, word.replace(/(.)\1{2,}/g, "$1$1"), word.replace(/(.)\1+/g, "$1")];
}

function isBannedWord(word: string): boolean {
  if (word.length === 0) return false;
  for (const form of squeezed(word)) {
    if (EXACT.has(form)) return true;
    // Pluriel : « putes », « connards », « bitchs ».
    if ((form.endsWith("s") || form.endsWith("x")) && EXACT.has(form.slice(0, -1))) return true;
    if (BANNED_FRAGMENTS.some((fragment) => form.includes(fragment))) return true;
  }
  return false;
}

const letters = (chunk: string) => chunk.replace(/[^a-z]/g, "");
const partsOf = (chunk: string) => chunk.split(/[^a-z]+/).filter((part) => part.length > 0);

/** Le texte contient-il un mot ou une expression interdits ? Chaque morceau
 * (séparé par les espaces et les apostrophes : « l'enfoiré ») est essayé
 * entier sans sa ponctuation (« p.u.t.e », « connard ! »), puis découpé à
 * la ponctuation (« fils-de-pute », « nom_ordure ») ; avec et sans
 * remplacement des chiffres « leet ». */
export function containsBannedWords(text: string | null | undefined): boolean {
  if (!text) return false;
  const chunks = simplify(text)
    .split(/[\s'’`´]+/u)
    .filter((chunk) => chunk.length > 0);
  for (const variant of [chunks, chunks.map(unLeet)]) {
    const parts = variant.flatMap(partsOf);
    if (variant.some((chunk) => isBannedWord(letters(chunk))) || parts.some(isBannedWord)) return true;
    // Expressions : mots découpés (« fils-de-pute »), ou morceaux entiers sans leur ponctuation (« trou du c.u.l »).
    const lines = [` ${parts.join(" ")} `, ` ${variant.map(letters).filter((word) => word.length > 0).join(" ")} `];
    if (PHRASES.some((phrase) => lines.some((line) => line.includes(phrase)))) return true;
  }
  return false;
}

/** Réponse d'un texte refusé (400). Traduite en anglais par lib/messages.ts. */
export const CONTENT_NOT_ALLOWED = {
  error: "content_not_allowed",
  message: "Ce texte contient un mot interdit sur Spotto (insulte, propos haineux ou contenu sexuel). Modifiez-le pour continuer.",
} as const;

/** Premier texte refusé parmi ceux fournis, ou null s'ils passent tous. */
export function firstBannedText(...texts: (string | null | undefined)[]): string | null {
  return texts.find((text) => containsBannedWords(text)) ?? null;
}
