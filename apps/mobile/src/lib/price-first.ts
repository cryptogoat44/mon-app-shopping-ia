// Prix d'abord (décision du fondateur du 2026-11-03) : sur l'écran Résultat,
// les propositions AVEC prix d'abord ; celles de la recherche visuelle SANS
// prix vont en dernier, dans une section repliée « Sans prix ». L'affichage
// seulement : le serveur garde les résultats Lens, leur ordre et leurs rangs,
// jamais remplacés (voie C). Les indices restent ceux de la liste complète de
// l'écran (allPieces) : la grande carte et ses actions ne changent pas.
// Logique pure, testée. Imports relatifs : fichier testé par vitest.
import type { Piece, SpotResult } from "../api/types";
import { isForeignPrice } from "./foreign-shop";
import { allPieces, firstShown, otherPiecesBySection, type IndexedPiece } from "./result-sections";

type ResultLists = Pick<SpotResult, "pieces" | "complement">;

/** Une proposition a-t-elle un prix ? Même règle que les cartes (sinon « Prix à vérifier chez le marchand »). */
export function hasPrice(piece: Pick<Piece, "priceFrom">): boolean {
  return piece.priceFrom !== null;
}

/** Un prix qui peut mettre une proposition en grand d'office. Un prix à 0
 * (donnée douteuse) reste affiché tel quel, avec les propositions qui ont un
 * prix, mais ne la fait pas passer devant les autres (relecture, ORD-8). */
function promotable(piece: Pick<Piece, "priceFrom">): boolean {
  return piece.priceFrom !== null && piece.priceFrom > 0;
}

/** Aucune proposition n'a de prix, nulle part (recherche visuelle et
 * complément) : rien n'est replié, l'écran reste comme avant. */
export function noPriceAnywhere(result: ResultLists): boolean {
  return !allPieces(result).some(hasPrice);
}

/** La proposition que « prix d'abord » met en grand d'office : la mieux
 * classée des propositions de la recherche visuelle avec un prix dans la
 * devise du pays de la recherche ; sinon avec un prix dans une autre devise
 * (« Boutique à l'étranger ») ; sinon la première du complément affiché
 * (« boutiques », puis « vos mots »), si elle a un prix ; sinon la première
 * proposition, comme avant. `country` : pays de la recherche
 * (lib/foreign-shop.ts) — le serveur garde les 6 premières de Google à leur
 * place, même avec un prix en $MX, et ne remonte les prix en euros qu'après
 * elles (relecture, ORD-4). Sans pays, ou pour un pays dont la devise n'est
 * pas connue ici, la devise ne compte pas. */
export function bestProposalIndex(result: ResultLists, country?: string): number {
  const local = country === undefined ? -1 : result.pieces.findIndex((piece) => promotable(piece) && !isForeignPrice(piece.priceFrom, piece.currency, country));
  if (local !== -1) return local;
  const lensWithPrice = result.pieces.findIndex(promotable);
  if (lensWithPrice !== -1) return lensWithPrice;
  const firstComplement = allPieces(result)[result.pieces.length];
  return firstComplement && promotable(firstComplement) ? result.pieces.length : 0;
}

export interface StartOptions {
  /** Pays de la recherche (bestProposalIndex). */
  country?: string;
  /** Proposition touchée dans « Récemment spottées » (accueil ou « Tout
   * voir ») : la vignette de la recherche, celle de plus petit rang. */
  matchId?: string | null;
}

/** La grande carte à l'ouverture de l'écran, tant que la personne n'en a
 * choisi aucune :
 * - rouvert depuis « Récemment spottées » : la proposition de la vignette
 *   touchée, pas une autre, la vignette étant repliée tout en bas (relecture, F2) ;
 * - sinon, la règle « prix d'abord » (bestProposalIndex) ;
 * - dans les deux cas, sur un résultat relu qui dit ce que la personne a déjà
 *   gardé ou acheté (lib/owned-marks.ts) : si la carte retenue n'en est pas
 *   une, la mieux classée de ces propositions, avec « Gardée » ou « Ajoutée
 *   au Vault » — elle ne doit pas croire sa pièce perdue (relecture, ORD-3). */
export function startProposalIndex(result: ResultLists & Pick<SpotResult, "owned">, options: StartOptions = {}): number {
  const pieces = allPieces(result);
  const fromHistory = options.matchId ? pieces.findIndex((piece) => piece.id === options.matchId) : -1;
  const base = fromHistory !== -1 ? fromHistory : bestProposalIndex(result, options.country);
  const owned = new Set([...(result.owned?.kept ?? []), ...(result.owned?.bought ?? [])]);
  if (owned.size === 0 || owned.has(pieces[base]?.id ?? "")) return base;
  const firstOwned = pieces.findIndex((piece) => owned.has(piece.id));
  return firstOwned !== -1 ? firstOwned : base;
}

export type BigCardLabel = "best" | "bestWithPrice" | "other";

/** Libellé de la grande carte (relecture, E4) :
 * - « Meilleure proposition » : la première de l'écran, la plus proche selon
 *   la recherche, comme avant le lot ;
 * - « Meilleure proposition avec prix » : celle que « prix d'abord » met en
 *   grand quand ce n'est pas la première — des propositions mieux classées
 *   sont alors plus bas, souvent repliées sans prix ;
 * - « Autre proposition » sinon. */
export function bigCardLabel(selectedIndex: number, bestIndex: number): BigCardLabel {
  if (selectedIndex === 0) return "best";
  return selectedIndex === bestIndex ? "bestWithPrice" : "other";
}

/** Message « Aucune de ces propositions n'affiche de prix » au-dessus de la
 * grande carte (textes validés le 2026-10-21) : la recherche visuelle n'a
 * aucun prix ET la grande carte proposée d'office n'en a pas non plus
 * (relecture, F3). Il suit la carte d'office, pas celle que la personne
 * choisit. Quand une proposition du complément avec prix est en grand
 * d'office, toutes celles de la recherche visuelle sont repliées, avec ce
 * texte sous le bouton. */
export function noPriceNoticeShown(result: ResultLists, startIndex: number): boolean {
  if (result.pieces.length === 0 || result.pieces.some(hasPrice)) return false;
  const start = allPieces(result)[startIndex];
  return start !== undefined && !hasPrice(start);
}

/** Texte du tri par les mots tapés sous la photo (petit lot 2). Le serveur a
 * remonté en tête les propositions dont le nom contient un des mots : la
 * première de l'écran en est une. Quand la grande carte d'office est une
 * autre, cette première est plus bas, repliée sans prix : « Triées selon vos
 * mots » ne décrirait plus l'écran, le texte dit l'ordre réel (relecture, F4). */
export function wordsSortNote(result: Pick<SpotResult, "sortedByWords">, startIndex: number): "words" | "priceThenWords" | null {
  if (!result.sortedByWords) return null;
  return startIndex === 0 ? "words" : "priceThenWords";
}

export interface PriceFirstSections {
  /** « Autres propositions » : la recherche visuelle avec prix, dans son
   * ordre (toute la recherche visuelle quand rien n'a de prix). */
  others: IndexedPiece[];
  /** Sections du complément, inchangées, après « Autres propositions ». */
  shopping: IndexedPiece[];
  words: IndexedPiece[];
  /** Section repliée « Sans prix », en dernier : la recherche visuelle sans
   * prix, dans son ordre. Vide quand rien n'a de prix nulle part. */
  withoutPrice: IndexedPiece[];
}

/** Les sections de l'écran, sans la proposition montrée en grand (celle-ci
 * quitte sa section, comme avant ; elle y revient quand une autre la remplace). */
export function priceFirstSections(result: ResultLists, selectedIndex: number): PriceFirstSections {
  const { lens, shopping, words } = otherPiecesBySection(result, selectedIndex);
  if (noPriceAnywhere(result)) return { others: lens, shopping, words, withoutPrice: [] };
  return {
    others: lens.filter(({ piece }) => hasPrice(piece)),
    shopping,
    words,
    withoutPrice: lens.filter(({ piece }) => !hasPrice(piece)),
  };
}

/** Propositions de la section « Sans prix » montrées une fois dépliée, avant
 * son propre « Voir plus » : sinon jusqu'à 39 cartes et autant d'images d'un
 * coup (relecture, E6). */
export const WITHOUT_PRICE_SHOWN_FIRST = 12;

/** Les premières propositions de la section « Sans prix », et combien restent derrière « Voir plus ». */
export function withoutPriceShown(pieces: readonly IndexedPiece[], showAll: boolean): { visible: IndexedPiece[]; hiddenCount: number } {
  return firstShown(pieces, showAll, WITHOUT_PRICE_SHOWN_FIRST);
}

/** Place d'une proposition, envoyée avec le clic vers la boutique
 * (statistiques d'usage, « merchant_link_opened ») : des nombres et un
 * oui/non, jamais la pièce ni le lien. Noms des propriétés envoyées. */
export interface ClickPlacement {
  /** Rang d'origine : sa place dans l'ordre du serveur, inchangé (1 = la
   * première de la recherche visuelle ; le complément vient ensuite). */
  rank: number;
  /** Place dans la disposition proposée d'office (1 = la grande carte
   * proposée d'office, puis « Autres propositions », le complément et la
   * section « Sans prix »). Elle ne change pas quand la personne met une
   * autre proposition en grand : c'est l'endroit où elle l'a trouvée. */
  displayed_position: number;
  /** Rangée dans la section repliée « Sans prix ». */
  in_no_price_section: boolean;
}

/** La place de chaque proposition de l'écran, par indice dans allPieces,
 * dans la disposition dont la grande carte d'office est `startIndex` — celle
 * de l'écran (startIndexOf). Jamais calculée sans elle : avec une autre carte
 * d'office, la place 1 irait à une carte qui n'est pas en grand (relecture,
 * ORD-4, E3). */
export function clickPlacements(result: ResultLists, startIndex: number): Map<number, ClickPlacement> {
  if (allPieces(result).length === 0) return new Map();
  const { others, shopping, words, withoutPrice } = priceFirstSections(result, startIndex);
  const order = [startIndex, ...[...others, ...shopping, ...words, ...withoutPrice].map(({ index }) => index)];
  const folded = new Set(withoutPrice.map(({ index }) => index));
  return new Map(order.map((index, position) => [index, { rank: index + 1, displayed_position: position + 1, in_no_price_section: folded.has(index) }]));
}

/** Ce que la personne a fait de la grande carte (relecture : ORD-1, E1, F1,
 * E3, ORD-6, F6). Aucun geste : tout est null, la grande carte suit
 * startProposalIndex, y compris quand la recherche « vos mots » répond (cas
 * limite annoncé). Dès un geste, la grande carte ne change plus d'elle-même
 * — ni sous une feuille ouverte (« Je l'ai achetée », « … »), ni sous un
 * lien de secours « navigateur a bloqué » — et la disposition d'office reste
 * celle que la personne avait sous les yeux, pour les statistiques du clic. */
export interface BigCardChoice {
  /** La proposition en grand : touchée dans une section, ou celle sur
   * laquelle la personne a agi (« Voir chez … », Garder, « Je l'ai achetée »,
   * Partager, « … »). */
  chosen: number | null;
  /** La grande carte d'office au moment du premier geste. */
  start: number | null;
  /** Où la personne a trouvé la proposition touchée (ProposalCard). */
  placement: ClickPlacement | null;
}

export const NO_CHOICE: BigCardChoice = { chosen: null, start: null, placement: null };

/** Toucher une carte la met en grand, avec la place où elle a été trouvée. */
export function chooseCard(choice: BigCardChoice, index: number, start: number, placement: ClickPlacement | undefined): BigCardChoice {
  return { chosen: index, start: choice.start ?? start, placement: placement ?? null };
}

/** Agir sur la grande carte la retient ; sans effet si elle l'est déjà. */
export function holdCard(choice: BigCardChoice, start: number): BigCardChoice {
  return choice.chosen !== null ? choice : { chosen: start, start, placement: null };
}

/** La grande carte d'office de l'écran : celle du premier geste, sinon startProposalIndex. */
export function startIndexOf(choice: BigCardChoice, result: ResultLists & Pick<SpotResult, "owned">, options: StartOptions): number {
  return choice.start ?? startProposalIndex(result, options);
}

/** Quand la recherche « vos mots » répond sous des propositions déjà
 * affichées :
 * - « hero » : la grande carte change d'elle-même (aucun geste, la règle
 *   l'annonce) — l'écran remonte la montrer et VoiceOver le dit, au lieu
 *   d'un changement hors de l'écran (relecture, E3) ;
 * - « words » : sinon, l'écran amène « Résultats pour vos mots » en haut
 *   s'ils sont arrivés au-dessus de la partie visible — au-dessus de la
 *   section « Sans prix », parfois dépliée et longue (relecture, E2) ; plus
 *   bas, il ne bouge pas : la personne a pu toucher une carte pendant
 *   l'attente (lib/result-scroll.ts, sectionArrivedAbove) ;
 * - null : après « rien trouvé », l'écran s'ouvre déjà en haut, sur la
 *   grande carte. */
export function wordsArrivalReveal(previous: SpotResult, next: SpotResult, choice: BigCardChoice, options: StartOptions): "hero" | "words" | null {
  if (previous.status !== "success" || next.status !== "success") return null;
  if (choice.chosen === null && startIndexOf(choice, next, options) !== startIndexOf(choice, previous, options)) return "hero";
  return "words";
}
