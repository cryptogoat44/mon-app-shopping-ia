// Essai du type de recherche de Google Lens (décisions du fondateur, 2026-10-20
// et 2026-10-21). SerpApi a abandonné « products » le 2026-10-09 ;
// « visual_matches » renvoie les mêmes champs (documentation de SerpApi, lue le
// 2026-10-20). Logique pure, testée (tests/essaiType.test.ts) : plans,
// autorisation de dépenser (et ses deux dérogations), relevé de chaque
// recherche (sans contenu personnel), réponses de test réduites, neutralisées,
// anonymisées et vérifiées (dépôt public).
import { z } from "zod";
import { DEFAULT_LOCALE, type LensSettings } from "../../src/services/lensSettings.js";
import { articleTitleParts, exclusionReason } from "../../src/services/matchFilters.js";
import { structureReponse, type Essai, type Structure } from "./essai-photo.js";
import type { Piece } from "./mesure-texte.js";

// ---- Plans ----

/** Pièces retenues par le fondateur, dans cet ordre (zones sans visage du 2026-10-08). */
export const PIECES_ESSAI_TYPE = ["veste-bleu-marine", "tshirt-blanc", "pull-noir", "maillot-nike"] as const;
/** Le remplaçant documenté de « products », en français comme l'app. */
export const REGLAGES_VISUAL_MATCHES: LensSettings = { type: "visual_matches", locale: DEFAULT_LOCALE };
/** « products », abandonné : une erreur est attendue, non facturée d'après SerpApi. */
export const REGLAGES_PRODUCTS: LensSettings = { type: "products", locale: DEFAULT_LOCALE };

/** « type » : l'essai complet ; « sonde » : une seule recherche, pour savoir si Google Lens répond. */
export type PlanType = "type" | "sonde";
/** Crédits au plus : 4 recherches, plus 1 si SerpApi facturait l'erreur malgré sa documentation ; la sonde, 1. */
export const CREDITS_MAX: Record<PlanType, number> = { type: PIECES_ESSAI_TYPE.length + 1, sonde: 1 };

export interface EssaiType {
  piece: Piece;
  essai: Essai;
  /** L'appel « products » : une erreur de SerpApi est le résultat attendu. */
  erreurAttendue: boolean;
}

function pieceNommee(pieces: readonly Piece[], nom: string): Piece {
  const piece = pieces.find((p) => p.nom === nom);
  if (!piece) throw new Error(`Pièce « ${nom} » absente du fichier des pièces.`);
  return piece;
}

function rechercheVisuelle(piece: Piece, numero: number): EssaiType {
  return { piece, essai: { numero, titre: `${piece.nom} : cadre seul, type « visual_matches » (1 crédit)`, zone: "vetement", texte: null, reglages: REGLAGES_VISUAL_MATCHES }, erreurAttendue: false };
}

/** « visual_matches » sur chaque pièce (cadre seul, sans texte), puis « products »
 * sur la première, EN DERNIER : l'erreur attendue n'empêche aucune autre recherche. */
export function essaisType(pieces: readonly Piece[]): EssaiType[] {
  const recherches = PIECES_ESSAI_TYPE.map((nom, index) => rechercheVisuelle(pieceNommee(pieces, nom), index + 1));
  const premiere = pieceNommee(pieces, PIECES_ESSAI_TYPE[0]);
  const titre = `${premiere.nom} : cadre seul, type « products » (erreur attendue, aucun crédit d'après SerpApi)`;
  return [...recherches, { piece: premiere, essai: { numero: recherches.length + 1, titre, zone: "vetement", texte: null, reglages: REGLAGES_PRODUCTS }, erreurAttendue: true }];
}

export function planEssaiType(plan: PlanType, pieces: readonly Piece[]): EssaiType[] {
  return plan === "sonde" ? [rechercheVisuelle(pieceNommee(pieces, PIECES_ESSAI_TYPE[0]), 1)] : essaisType(pieces);
}

// ---- Autorisation de dépenser ----

/** Une sonde « réussie » ne vaut que 24 heures : l'état de Google Lens change. */
export const VALIDITE_SONDE_MS = 24 * 60 * 60 * 1000;
export type VerdictSonde = { reussie: true } | { reussie: false; raison: string };

const LIGNE_DE_SONDE = z.object({
  type: z.string(),
  lanceeLe: z.string().datetime(),
  issue: z.string(),
  code: z.number().nullable(),
  statutSerpApi: z.string().nullable(),
  gardees: z.number().nullable(),
});

/** Sonde réussie : son relevé a une seule recherche « visual_matches », réussie
 * (code 200, statut « Success »), avec au moins UNE proposition gardée par
 * Spotto (donc qu'une personne verrait), lancée il y a moins de 24 heures. */
export function verdictSonde(releve: unknown, maintenant: Date): VerdictSonde {
  const lignes = z.array(LIGNE_DE_SONDE).safeParse(releve);
  if (!lignes.success || lignes.data.length !== 1) return { reussie: false, raison: "relevé de sonde illisible, ou avec plus d'une recherche" };
  const ligne = lignes.data[0]!;
  if (ligne.type !== "visual_matches" || ligne.issue !== "reussie" || ligne.code !== 200 || ligne.statutSerpApi !== "Success") {
    return { reussie: false, raison: `la dernière sonde n'a pas réussi (issue « ${ligne.issue} », code ${ligne.code ?? "—"})` };
  }
  if ((ligne.gardees ?? 0) < 1) return { reussie: false, raison: "la dernière sonde n'a donné aucune proposition gardée par Spotto" };
  const age = maintenant.getTime() - Date.parse(ligne.lanceeLe);
  if (!(age >= 0 && age <= VALIDITE_SONDE_MS)) return { reussie: false, raison: "la dernière sonde date de plus de 24 heures : refaites une sonde" };
  return { reussie: true };
}

/** « aucune » : la règle ; « sonde » : la sonde unique malgré la page d'état ;
 * « apres-sonde » : l'essai complet malgré la page d'état, après une sonde réussie. */
export type Derogation = { type: "aucune" } | { type: "sonde" } | { type: "apres-sonde"; verdict: VerdictSonde };
type Autorisation = { permis: true } | { permis: false; raison: string };

const refus = (raison: string): Autorisation => ({ permis: false, raison });

/** Dépense permise ? La règle : seulement si la page d'état de SerpApi annonce
 * Google Lens opérationnel. Chaque dérogation, lancée seulement après la phrase
 * tapée par le fondateur, ne vaut que pour son plan ; celle de l'essai complet
 * exige en plus une sonde réussie. */
export function depensePermise(plan: PlanType, etat: string, derogation: Derogation): Autorisation {
  if (derogation.type === "sonde" && plan !== "sonde") return refus("« --malgre-page-etat » ne vaut que pour la sonde unique, jamais pour l'essai complet.");
  if (derogation.type === "apres-sonde" && plan !== "type") return refus("« --malgre-page-etat-apres-sonde » ne vaut que pour l'essai complet.");
  if (etat === "operational" || derogation.type === "sonde") return { permis: true };
  if (derogation.type === "apres-sonde") return derogation.verdict.reussie ? { permis: true } : refus(`essai complet refusé : ${derogation.verdict.raison}.`);
  return refus(`SerpApi n'annonce pas Google Lens opérationnel (« ${etat} ») : aucun crédit dépensé.`);
}

// ---- Relevé de chaque recherche (sans contenu personnel) ----

export type Issue = "en_cours" | "reussie" | "vide" | "erreur" | "panne";
export type Facturee = "oui" | "non" | "inconnu";

/** Une ligne du relevé : des nombres, des états et les noms des rubriques,
 * jamais un titre, un lien ou une image. Écrite AVANT l'appel (« en_cours »),
 * complétée après : un appel interrompu reste visible. */
export interface LigneReleve {
  numero: number;
  piece: string;
  type: LensSettings["type"];
  /** Heure de Paris du lancement, et l'instant exact (pour la validité d'une sonde). */
  lancee: string;
  lanceeLe: string;
  issue: Issue;
  /** Code de réponse de SerpApi (200, 400…). */
  code: number | null;
  statutSerpApi: string | null;
  /** D'après la documentation de SerpApi : une recherche « Success » est facturée, une erreur non. */
  factureeSelonSerpApi: Facturee;
  recues: number | null;
  gardees: number | null;
  avecPrix: number | null;
  /** Rubriques de la réponse et leur taille (« visual_matches (60) »). */
  rubriques: string[];
  secondes: number | null;
  /** Message de SerpApi (erreur, ou « aucun résultat »), 160 caractères au plus. */
  message: string | null;
}

const HEURE_DE_PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ligneLancee({ piece, essai }: EssaiType, lancee: Date): LigneReleve {
  return {
    numero: essai.numero, piece: piece.nom, type: essai.reglages.type, lancee: HEURE_DE_PARIS.format(lancee), lanceeLe: lancee.toISOString(),
    issue: "en_cours", code: null, statutSerpApi: null, factureeSelonSerpApi: "inconnu", recues: null, gardees: null, avecPrix: null, rubriques: [], secondes: null, message: null,
  };
}

export function factureeSelonSerpApi(code: number | null, statut: string | null): Facturee {
  if (code === null) return "inconnu";
  if (code >= 400 || statut === "Error") return "non";
  return statut === "Success" ? "oui" : "inconnu";
}

/** Ce que SerpApi a répondu à un appel, ou null s'il n'a pas répondu. */
export interface ReponseRelevee {
  code: number | null;
  structure: Structure | null;
  secondes: number | null;
}

function messageSur(message: string | null | undefined): string | null {
  if (!message) return null;
  return contenusInterdits(message).length > 0 ? "(message retiré : contenu à protéger)" : message.slice(0, 160);
}

/** La ligne complétée après l'appel. `comptes` : présents seulement si les propositions ont été lues. */
export function ligneTerminee(ligne: LigneReleve, reponse: ReponseRelevee | null, comptes: { recues: number; gardees: number; avecPrix: number } | null, secondesSansReponse: number): LigneReleve {
  if (!reponse) return { ...ligne, issue: "panne", secondes: secondesSansReponse };
  const rubriques = Object.entries(reponse.structure?.rubriques ?? {})
    .filter(([cle]) => !cle.startsWith("search_"))
    .map(([cle, taille]) => (typeof taille === "number" ? `${cle} (${taille})` : cle));
  const issue: Issue = comptes ? (comptes.recues > 0 ? "reussie" : "vide") : "erreur";
  const statut = reponse.structure?.etat ?? null;
  return { ...ligne, issue, code: reponse.code, statutSerpApi: statut, factureeSelonSerpApi: factureeSelonSerpApi(reponse.code, statut), ...(comptes ?? {}), rubriques, secondes: reponse.secondes, message: messageSur(reponse.structure?.erreur) };
}

/** Pour lire l'écart du compteur de SerpApi : appels facturés, non facturés et incertains d'après sa documentation. */
export function bilanFacturation(lignes: readonly LigneReleve[]): Record<Facturee, number> {
  const bilan: Record<Facturee, number> = { oui: 0, non: 0, inconnu: 0 };
  for (const ligne of lignes) bilan[ligne.factureeSelonSerpApi] += 1;
  return bilan;
}

// ---- Réponses de test : réduites, neutralisées, anonymisées, vérifiées ----
// Le dépôt est public (décision du fondateur, 2026-10-21) : titres, noms de
// marchands, chemins des liens et images sont remplacés par des valeurs
// neutres ou fictives. Restent tels quels les éléments dont dépendent les tests
// et la mesure : positions, prix et devises, domaines et paramètres des liens,
// rubriques, statut, état de Google et message d'erreur de SerpApi. Les
// relations sont gardées : deux titres identiques (au nom du site près) ou deux
// chemins identiques reçoivent la même valeur neutre.

const OBJET = z.record(z.string(), z.unknown());
/** Champs d'une proposition lus par le serveur, comme dans les réponses enregistrées du 24 septembre. */
const CHAMPS_LUS = ["position", "title", "link", "source", "thumbnail", "image", "price", "in_stock"] as const;
/** Sites d'annonces de particuliers : le lien de l'annonce est anonymisé (comme Leboncoin en septembre). */
const ANNONCES_DE_PARTICULIERS = ["leboncoin", "vinted", "depop", "vestiairecollective"];

function numeroFictif(n: number): string {
  return String(n).padStart(10, "0");
}

/** Valeurs neutres d'UNE réponse : une même valeur d'origine reçoit toujours la même valeur neutre. */
function neutraliseur() {
  const numeros = { titres: new Map<string, number>(), marchands: new Map<string, number>(), chemins: new Map<string, number>() };
  const numero = (carte: Map<string, number>, cle: string): number => {
    if (!carte.has(cle)) carte.set(cle, carte.size + 1);
    return carte.get(cle)!;
  };
  return {
    titre(lien: string, titre: string): string {
      const { key, siteInTitle } = articleTitleParts(lien, titre);
      const neutre = `Produit ${numero(numeros.titres, key)}`;
      return siteInTitle ? `${neutre} - ${siteInTitle.toUpperCase()}` : neutre;
    },
    marchand: (nom: string): string => `Marchand ${numero(numeros.marchands, nom.trim().toLowerCase())}`,
    /** Domaine et paramètres gardés ; chemin neutre ; fragment « # » retiré. Deux
     * chemins sont « les mêmes » exactement comme pour le filtre des doublons
     * (barre finale près, majuscules comprises). */
    lien(lien: string): string {
      try {
        const url = new URL(lien);
        const chemin = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
        return `${url.protocol}//${url.host}/produit-${numero(numeros.chemins, chemin)}${url.search}`;
      } catch {
        return "https://example.invalid/lien-illisible";
      }
    },
  };
}

type Neutraliseur = ReturnType<typeof neutraliseur>;

/** Une proposition réduite aux champs lus ; titre, marchand et chemin neutres ;
 * images fictives ; comptes de réseaux sociaux et annonces de particuliers anonymisés. */
function propositionDeTest(proposition: Record<string, unknown>, index: number, neutre: Neutraliseur): Record<string, unknown> {
  const n = index + 1;
  const reduite: Record<string, unknown> = Object.fromEntries(CHAMPS_LUS.filter((champ) => champ in proposition).map((champ) => [champ, proposition[champ]]));
  const lien = typeof reduite.link === "string" ? reduite.link : null;
  if (typeof reduite.title === "string") reduite.title = neutre.titre(lien ?? "", reduite.title);
  if (typeof reduite.source === "string") reduite.source = neutre.marchand(reduite.source);
  if ("thumbnail" in reduite) reduite.thumbnail = `https://example.invalid/vignette-${n}.jpg`;
  if ("image" in reduite) reduite.image = `https://example.invalid/image-${n}.jpg`;
  if (!lien) return reduite;
  let hote: string;
  try {
    hote = new URL(lien).host.toLowerCase();
  } catch {
    return { ...reduite, link: neutre.lien(lien) };
  }
  if (exclusionReason(lien) === "social") return { ...reduite, link: `https://${hote}/compte-anonyme/${numeroFictif(n)}`, title: "Publication anonymisée" };
  if (ANNONCES_DE_PARTICULIERS.some((nom) => hote.split(".").includes(nom))) return { ...reduite, link: `https://${hote}/annonce/${numeroFictif(n)}` };
  return { ...reduite, link: neutre.lien(lien) };
}

/** Réponse de test, de la forme d'une réponse de SerpApi : le statut de la
 * recherche, l'état de Google, les propositions de test, les autres rubriques
 * gardées VIDES à leur taille (pour la mesure), le message d'erreur. Jamais les
 * identifiants ni les paramètres de la recherche (dont l'adresse de l'image). */
export function reponseDeTest(brut: unknown): Record<string, unknown> | null {
  const lu = OBJET.safeParse(brut);
  if (!lu.success) return null;
  const sortie: Record<string, unknown> = {};
  const statut = structureReponse(brut).etat;
  if (statut) sortie.search_metadata = { status: statut };
  const information = OBJET.safeParse(lu.data.search_information);
  if (information.success && typeof information.data.images_results_state === "string") sortie.search_information = { images_results_state: information.data.images_results_state };
  for (const [cle, valeur] of Object.entries(lu.data)) {
    if (cle.startsWith("search_") || cle === "error" || cle === "visual_matches") continue;
    sortie[cle] = Array.isArray(valeur) ? valeur.map(() => ({})) : {};
  }
  const propositions = z.array(OBJET).safeParse(lu.data.visual_matches);
  const neutre = neutraliseur();
  if (propositions.success) sortie.visual_matches = propositions.data.map((proposition, index) => propositionDeTest(proposition, index, neutre));
  if (typeof lu.data.error === "string") sortie.error = lu.data.error;
  return sortie;
}

/** Contenus à ne jamais enregistrer (demande du fondateur, 2026-10-20). */
const INTERDITS: readonly { nom: string; motif: RegExp }[] = [
  { nom: "clé d'API", motif: /api[_-]?key/i },
  { nom: "adresse e-mail", motif: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { nom: "adresse d'image temporaire de notre serveur", motif: /supabase\.(?:co|in)|\/storage\/v1\/|[?&]token=|sbtwsmxfdfxzgcohbznd|qcwnlqkxnhqpyjpkooiw/i },
  { nom: "lien de recherche de SerpApi (il contient l'adresse de l'image)", motif: /serpapi\.com\/search/i },
];

/** Les contenus interdits trouvés dans un texte (leur nature, jamais leur valeur). */
export function contenusInterdits(texte: string): string[] {
  return INTERDITS.filter(({ motif }) => motif.test(texte)).map(({ nom }) => nom);
}
