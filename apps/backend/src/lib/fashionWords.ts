// Petit dictionnaire de la mode, français ↔ anglais (petit lot 2, décision du
// fondateur du 27 octobre 2026). Les mots tapés sous une photo sont souvent en
// français, les noms des propositions souvent en anglais : un mot compte aussi
// pour ses traductions courantes, dans les deux sens. Aucun appel extérieur.
// - Il ne fait que remonter des propositions (lib/wordSort.ts), jamais en écarter.
// - Les marques n'y sont pas : elles passent telles quelles.
// - Formes en minuscules, sans accents ; une traduction compte telle quelle ou
//   au pluriel (-s, -es, -x), jamais au début d'un mot plus long (« sac » ne
//   trouve pas « baggy »).

/** [formes françaises, traductions anglaises]. */
export const FASHION_GROUPS: readonly (readonly [readonly string[], readonly string[]])[] = [
  // Vêtements
  [["veste"], ["jacket", "blazer"]],
  [["blouson"], ["jacket", "bomber"]],
  [["manteau"], ["coat"]],
  [["doudoune"], ["puffer"]],
  [["impermeable"], ["raincoat"]],
  [["pull"], ["sweater", "jumper", "pullover"]],
  [["gilet"], ["cardigan", "vest"]],
  [["sweat"], ["sweatshirt", "hoodie"]],
  [["chemise"], ["shirt"]],
  [["chemisier"], ["blouse"]],
  [["debardeur"], ["tank"]],
  [["robe"], ["dress", "gown"]],
  [["jupe"], ["skirt"]],
  [["pantalon"], ["trousers", "pants"]],
  [["jean"], ["jeans", "denim"]],
  [["combinaison"], ["jumpsuit"]],
  [["costume", "tailleur"], ["suit"]],
  [["maillot"], ["swimsuit"]],
  [["survetement"], ["tracksuit"]],
  [["pyjama"], ["pyjamas", "pajamas"]],
  [["chaussette"], ["sock"]],
  [["collant"], ["tights"]],
  // Chaussures
  [["chaussure"], ["shoe"]],
  [["basket"], ["sneaker", "trainer"]],
  [["botte", "bottine"], ["boot"]],
  [["sandale"], ["sandal"]],
  [["escarpin"], ["pump", "heel"]],
  [["mocassin"], ["loafer"]],
  // Accessoires
  [["sac"], ["bag", "handbag", "tote"]],
  [["pochette"], ["clutch", "pouch"]],
  [["portefeuille"], ["wallet"]],
  [["ceinture"], ["belt"]],
  [["echarpe", "foulard"], ["scarf"]],
  [["chapeau"], ["hat"]],
  [["casquette"], ["cap"]],
  [["bonnet"], ["beanie"]],
  [["gant"], ["glove"]],
  [["lunette"], ["glasses", "sunglasses"]],
  [["montre"], ["watch"]],
  [["bijou"], ["jewelry", "jewellery"]],
  [["collier"], ["necklace"]],
  [["bague"], ["ring"]],
  [["boucle"], ["earring"]],
  [["valise"], ["suitcase"]],
  // Matières
  [["cuir"], ["leather"]],
  [["daim"], ["suede"]],
  [["laine"], ["wool"]],
  [["cachemire"], ["cashmere"]],
  [["coton"], ["cotton"]],
  [["lin"], ["linen"]],
  [["soie"], ["silk"]],
  [["velours"], ["velvet", "corduroy"]],
  [["fourrure"], ["fur"]],
  [["maille", "tricot"], ["knit", "knitted", "knitwear"]],
  // Couleurs
  [["noir", "noire"], ["black"]],
  [["blanc", "blanche"], ["white"]],
  [["gris", "grise"], ["grey", "gray"]],
  [["bleu", "bleue"], ["blue"]],
  [["marine"], ["navy"]],
  [["rouge"], ["red"]],
  [["vert", "verte"], ["green"]],
  [["jaune"], ["yellow"]],
  [["rose"], ["pink"]],
  [["marron", "brun", "brune"], ["brown"]],
  [["kaki"], ["khaki"]],
  [["bordeaux"], ["burgundy"]],
  [["violet", "violette"], ["purple"]],
  [["dore", "doree"], ["gold", "golden"]],
  [["argente", "argentee"], ["silver"]],
  [["creme"], ["cream"]],
  // Motifs et finitions
  [["raye", "rayee"], ["striped"]],
  [["fleuri", "fleurie"], ["floral"]],
  [["carreaux"], ["plaid", "checked"]],
  [["imprime", "imprimee"], ["print", "printed"]],
  [["matelasse", "matelassee"], ["quilted"]],
  [["capuche"], ["hood", "hooded"]],
];

/** Mot → ses traductions (et, en français, ses autres formes : « noir » ↔ « noire »). */
const TRANSLATIONS: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const map = new Map<string, Set<string>>();
  const add = (word: string, others: readonly string[]) => {
    const set = map.get(word) ?? new Set<string>();
    for (const other of others) if (other !== word) set.add(other);
    map.set(word, set);
  };
  for (const [french, english] of FASHION_GROUPS) {
    for (const word of french) add(word, [...english, ...french]);
    for (const word of english) add(word, french);
  }
  return map;
})();

/** Le mot, puis ses singuliers possibles (« bottes » → « botte », « bijoux » → « bijou », « dresses » → « dress »). */
function lookupForms(word: string): string[] {
  const forms = [word];
  if (word.length > 3 && word.endsWith("s")) forms.push(word.slice(0, -1));
  if (word.length > 3 && word.endsWith("x")) forms.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) forms.push(word.slice(0, -2));
  return forms;
}

/** Les traductions d'un mot tapé (minuscules, sans accents), au singulier comme au pluriel. */
export function translationsOf(word: string): Set<string> {
  const found = new Set<string>();
  for (const form of lookupForms(word)) for (const translation of TRANSLATIONS.get(form) ?? []) found.add(translation);
  found.delete(word);
  return found;
}

/** Un mot du nom est-il cette traduction, telle quelle ou au pluriel ? */
export function isTranslationForm(nameWord: string, translation: string): boolean {
  return nameWord === translation || nameWord === `${translation}s` || nameWord === `${translation}es` || nameWord === `${translation}x`;
}
