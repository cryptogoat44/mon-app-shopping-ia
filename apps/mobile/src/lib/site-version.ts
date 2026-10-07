// Version du site (lot 4 ter) : chaque mise en ligne change le nom du
// programme principal (« entry-<empreinte>.js »). Un onglet resté ouvert
// compare le sien à celui de la page en ligne, pour ne jamais tester une
// ancienne version sans le savoir. Logique pure, testée.
const ENTRY_SCRIPT = /\/_expo\/static\/js\/web\/entry-[0-9a-f]+\.js/;

/** Nom du programme principal dans une page ou une adresse ; null sinon
 * (serveur de développement : aucune comparaison). */
export function entryScriptOf(text: string): string | null {
  return text.match(ENTRY_SCRIPT)?.[0] ?? null;
}

export function isNewVersion(loaded: string | null, online: string | null): boolean {
  return loaded !== null && online !== null && loaded !== online;
}
