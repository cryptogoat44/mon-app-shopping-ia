// Mesure de la voie C : « bonne pièce » ou non. Ordre de priorité :
// 1. le jugement du fondateur (jugements.txt, dans le dossier du jeu de
//    vérité), s'il existe — son format n'est pas encore fixé, voir
//    lireJugementsFondateur ;
// 2. sinon la règle du banc d'essai (fonction semblePiece de la branche locale
//    lot-banc-jeu-de-verite), reproduite ici d'après sa description : elle
//    peut différer du banc dans le détail (seuils, traductions).
// ~/Downloads/mon-jugement.txt (sans doute une fiche vierge) n'est jamais lu.
// Logique pure, testée (tests/mesureVoieC.test.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MatchOrigin } from "@monapp/shared-types";
import { isTranslationForm, translationsOf } from "../../../src/lib/fashionWords.js";

/** Le jugement du fondateur, dans le dossier du jeu de vérité. */
export const FICHIER_JUGEMENTS = "jugements.txt";
/** Le banc jugeait les 10 premières propositions. */
export const FENETRE_BANC = 10;

/** Ce que le jeu de vérité attend. */
export interface Attendu {
  marque: string;
  modele: string;
}

/** Une proposition à juger : sa place dans sa liste (Lens, ou boutiques). */
export interface PropositionJugee {
  position: number;
  titre: string;
  site: string | null;
  origine: MatchOrigin;
}

/** Minuscules, sans accents ni ponctuation. Apostrophes, tirets, points et
 * « & » collent les morceaux (« Levi's » → « levis », « H&M » → « hm »,
 * « T-shirt » → « tshirt ») ; toute autre ponctuation sépare les mots. */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/['’`´\-‐‑.&]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function motsDe(texte: string): string[] {
  const propre = normaliser(texte);
  return propre === "" ? [] : [...new Set(propre.split(" "))];
}

/** Mots importants du modèle : 3 caractères ou plus, sans ce qui est entre parenthèses. */
export function motsImportants(modele: string): string[] {
  return motsDe(modele.replace(/\([^)]*\)/g, " ")).filter((mot) => mot.length >= 3);
}

/** Traductions ajoutées pour juger, absentes du dictionnaire du serveur
 * (lib/fashionWords.ts, validé par le fondateur le 27 octobre) : [français, anglais]. */
export const TRADUCTIONS_AJOUTEES: readonly (readonly [readonly string[], readonly string[]])[] = [
  [["chausson"], ["slipper"]],
  [["torsade", "torsadee"], ["cable", "cableknit"]],
  [["tshirt", "teeshirt"], ["tee"]],
  [["bob"], ["bucket"]],
  [["salopette"], ["dungarees", "overalls"]],
  [["sabot"], ["clog"]],
];

function traductions(mot: string): Set<string> {
  const toutes = translationsOf(mot);
  for (const [francais, anglais] of TRADUCTIONS_AJOUTEES) {
    const groupe = [...francais, ...anglais];
    if (groupe.some((forme) => isTranslationForm(mot, forme))) for (const forme of groupe) toutes.add(forme);
  }
  toutes.delete(mot);
  return toutes;
}

const FINALES_COURTES = ["s", "x", "e", "es"];

/** « Commence de la même façon » : même mot ; ou l'un commence par l'autre,
 * le plus court ayant au moins 4 caractères (« jean » / « jeans », « pull » /
 * « pullover ») ; pour 3 caractères, seulement pluriel ou féminin (« sac » /
 * « sacs », jamais « sac » / « sacoche ») ; en dessous, le même mot seulement.
 * Seuils choisis ici : pas forcément ceux du banc. */
export function commencePareil(a: string, b: string): boolean {
  if (a === b) return true;
  const [court, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.startsWith(court)) return false;
  if (court.length >= 4) return true;
  return court.length === 3 && FINALES_COURTES.includes(long.slice(3));
}

/** Le mot attendu est-il dans le titre : tel quel, ou par une de ses traductions (« noir » ↔ « black ») ? */
export function motPresent(mot: string, motsTitre: readonly string[]): boolean {
  if (motsTitre.some((motTitre) => commencePareil(mot, motTitre))) return true;
  const formes = traductions(mot);
  return motsTitre.some((motTitre) => [...formes].some((forme) => isTranslationForm(motTitre, forme)));
}

/** Petits mots d'une marque qui ne la désignent pas (« The Kooples », « De
 * Fursac », « Le Slip Français ») : ignorés pour la juger. */
export const ARTICLES_MARQUE: ReadonlySet<string> = new Set(["le", "la", "les", "de", "des", "du", "the", "a"]);

/** Mots de la marque, sans les articles (une marque faite seulement d'articles les garde). */
export function motsDeMarque(marque: string): string[] {
  const mots = motsDe(marque);
  const utiles = mots.filter((mot) => !ARTICLES_MARQUE.has(mot));
  return utiles.length > 0 ? utiles : mots;
}

/** Un mot de la marque est dans le titre tel quel, ou au pluriel : jamais un
 * début de mot (« Maje » n'est pas « Majestic »), jamais une traduction. */
export function motDeMarquePresent(mot: string, motsTitre: readonly string[]): boolean {
  return motsTitre.some((motTitre) => motTitre === mot || motTitre === `${mot}s` || motTitre === `${mot}x`);
}

/** Règle du banc, telle que décrite : au moins la moitié des mots de la
 * MARQUE dans le titre (articles ignorés, mot exact ou son pluriel), ET au
 * moins la moitié des mots importants du MODÈLE (3 lettres ou plus,
 * traductions FR/EN comprises). Sans marque : au moins 2 mots importants du
 * modèle — un modèle d'un seul mot important n'est donc jamais une bonne
 * pièce sans marque (version stricte, gardée et écrite dans le rapport). Un
 * modèle vide n'est jamais une bonne pièce. */
export function semblePiece(titre: string, attendu: Attendu): boolean {
  const modele = motsImportants(attendu.modele);
  if (modele.length === 0) return false;
  const motsTitre = motsDe(titre);
  const trouvesModele = modele.filter((mot) => motPresent(mot, motsTitre)).length;
  if (trouvesModele * 2 < modele.length) return false;
  const marque = motsDeMarque(attendu.marque);
  if (marque.length === 0) return trouvesModele >= 2;
  return marque.filter((mot) => motDeMarquePresent(mot, motsTitre)).length * 2 >= marque.length;
}

/** La règle, en une phrase, pour le rapport et le mode d'emploi. */
export const REGLE_BONNE_PIECE =
  "au moins la moitié des mots de la marque (articles ignorés, mot exact ou son pluriel) et au moins la moitié des mots importants du modèle (3 lettres ou plus, traductions FR/EN comprises) ; sans marque, au moins 2 mots importants du modèle (un modèle d'un seul mot important n'est donc jamais une bonne pièce sans marque)";

/** Un juge : vrai si la proposition est la bonne pièce. */
export type Juge = (proposition: PropositionJugee) => boolean;

/** Jugement du fondateur pour un cas et une proposition : vrai, faux, ou
 * null (pas d'avis : la règle du banc décide). */
export type JugeFondateur = (cas: number, proposition: PropositionJugee) => boolean | null;

export type EtatJugements = { etat: "absent" } | { etat: "format-a-venir"; chemin: string } | { etat: "lu"; chemin: string; juge: JugeFondateur };

/** POINT D'ENTRÉE du jugement du fondateur : jugements.txt, dans le dossier du
 * jeu de vérité. Absent aujourd'hui, et son format n'est pas encore fixé. Le
 * jour où il l'est : lire le fichier ici et rendre { etat: "lu", chemin, juge }
 * (un JugeFondateur), puis refaire le rapport sans rien dépenser
 * (--refaire-rapport). Présent mais pas encore lisible : la règle du banc
 * s'applique, et le rapport le dit. */
export function lireJugementsFondateur(dossierJeu: string): EtatJugements {
  const chemin = join(dossierJeu, FICHIER_JUGEMENTS);
  if (!existsSync(chemin)) return { etat: "absent" };
  return { etat: "format-a-venir", chemin };
}

/** Le juge d'un cas : le fondateur d'abord, s'il a un avis ; sinon la règle du banc. */
export function jugeDuCas(numero: number, attendu: Attendu, jugements: EtatJugements): Juge {
  const banc: Juge = (proposition) => semblePiece(proposition.titre, attendu);
  if (jugements.etat !== "lu") return banc;
  return (proposition) => jugements.juge(numero, proposition) ?? banc(proposition);
}

export interface JugementListe {
  /** Place de la première bonne pièce dans la liste (1 = en tête), ou null. */
  premiere: number | null;
  /** Places de toutes les bonnes pièces. */
  bonnes: number[];
}

export function jugerListe(propositions: readonly PropositionJugee[], juge: Juge): JugementListe {
  const bonnes = propositions.filter((proposition) => juge(proposition)).map((proposition) => proposition.position);
  return { premiere: bonnes[0] ?? null, bonnes };
}

/** En 1re place, dans les 3 premières, dans les 10 premières (règle du banc), n'importe où. */
export function paliers(premiere: number | null): { premiere: boolean; troisPremieres: boolean; dixPremieres: boolean; nimporteOu: boolean } {
  return {
    premiere: premiere === 1,
    troisPremieres: premiere !== null && premiere <= 3,
    dixPremieres: premiere !== null && premiere <= FENETRE_BANC,
    nimporteOu: premiere !== null,
  };
}
