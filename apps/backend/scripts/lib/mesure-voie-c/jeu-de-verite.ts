// Mesure de la voie C : le jeu de vérité du fondateur et les cadres tracés pour
// lui, tous deux HORS de Git. Lecture seule : aucune photo n'est copiée.
// Logique pure, testée (tests/mesureVoieC.test.ts).
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { SEARCH_QUERY_MAX_LENGTH, type CropRect } from "@monapp/shared-types";

/** Refus clair de l'outil (fichier mal formé, garde, budget…) : jamais de secret dans le message. */
export class ErreurMesure extends Error {}

/** Les réponses du fondateur, dans le dossier du jeu de vérité. */
export const FICHIER_REPONSES = "reponses.txt";
const NB_CHAMPS = 11;
/** Côté minimal d'un cadre envoyé par l'app de main, en proportion de
 * l'image (apps/mobile/src/lib/crop-geometry.ts, MIN_CROP) : le cadre à
 * poignées ne descend jamais en dessous, et la zone d'une pièce entourée au
 * doigt y est élargie autour de son milieu (piece-trace.ts, side). Le serveur,
 * lui, refuserait sous 5 % (routes/searches.ts, cropSchema). */
export const COTE_MIN_APP = 0.12;

/** Une ligne de reponses.txt. Le numéro du cas est le rang de la ligne. */
export interface CasVerite {
  numero: number;
  /** Nom de la photo, dans le même dossier (casNN.png). */
  fichier: string;
  marque: string;
  modele: string;
  nombrePieces: string;
  pieceDesignee: string;
  /** « oui » : le banc avait un cadre pour ce cas. */
  cadre: boolean;
  /** « Vos mots », tapés comme dans l'app. */
  mots: string;
  marqueVisible: boolean;
}

/** Un cadre de cadres-traces.txt, en pourcentages de l'image (0 à 100). */
export interface CadreTrace {
  numero: number;
  gauche: number;
  haut: number;
  largeur: number;
  hauteur: number;
  /** Ce que le cadre entoure (« la veste »). */
  rappel: string;
}

function deuxChiffres(numero: number): string {
  return String(numero).padStart(2, "0");
}

function ouiNon(valeur: string, ligne: number, champ: string): boolean {
  const lu = valeur.trim().toLowerCase();
  if (lu === "oui") return true;
  if (lu === "non") return false;
  throw new ErreurMesure(`${FICHIER_REPONSES}, ligne ${ligne} : « ${champ} » doit valoir oui ou non.`);
}

/** Lit reponses.txt : sans ligne de titres, 11 champs séparés par « ; »
 * (fichier ; marque ; modèle ; lien ; pièces visibles ; pièce désignée ;
 * cadre ; vos mots ; fichier recadré ; marque visible ; instant). Une ligne
 * vide au milieu décalerait les numéros : refusée. */
export function lireReponses(texte: string): CasVerite[] {
  const lignes = texte.replace(/^﻿/, "").split(/\r?\n/);
  while (lignes.length > 0 && lignes[lignes.length - 1]!.trim() === "") lignes.pop();
  if (lignes.length === 0) throw new ErreurMesure(`${FICHIER_REPONSES} est vide.`);
  return lignes.map((ligne, index) => {
    const numero = index + 1;
    if (ligne.trim() === "") throw new ErreurMesure(`${FICHIER_REPONSES}, ligne ${numero} vide : le numéro d'un cas est le rang de sa ligne.`);
    const champs = ligne.split(";").map((champ) => champ.trim());
    if (champs.length !== NB_CHAMPS) {
      throw new ErreurMesure(`${FICHIER_REPONSES}, ligne ${numero} : ${champs.length} champ(s) au lieu de ${NB_CHAMPS} (séparés par « ; »).`);
    }
    const [fichier, marque, modele, , nombrePieces, pieceDesignee, cadre, mots, , marqueVisible] = champs as [string, string, string, string, string, string, string, string, string, string, string];
    const nom = fichier === "" ? `cas${deuxChiffres(numero)}.png` : fichier;
    if (basename(nom) !== nom) throw new ErreurMesure(`${FICHIER_REPONSES}, ligne ${numero} : le fichier doit être un simple nom, dans le dossier du jeu.`);
    return {
      numero,
      fichier: nom,
      marque,
      modele,
      nombrePieces,
      pieceDesignee,
      cadre: ouiNon(cadre, numero, "cadre"),
      mots,
      marqueVisible: ouiNon(marqueVisible, numero, "marque visible"),
    };
  });
}

function nombre(texte: string): number {
  return /^\d+([.,]\d+)?$/.test(texte) ? Number(texte.replace(",", ".")) : Number.NaN;
}

/** Lit cadres-traces.txt : une ligne « cas ; gauche haut largeur hauteur ;
 * rappel », en POURCENTAGES de l'image. Lignes vides et lignes de
 * commentaire (commençant par « # ») ignorées ; toute autre ligne mal formée
 * est refusée, avec son numéro. */
export function lireCadres(texte: string, origine: string): Map<number, CadreTrace> {
  const cadres = new Map<number, CadreTrace>();
  texte
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((ligne, index) => {
      if (ligne.trim() === "" || ligne.trimStart().startsWith("#")) return;
      const refus = (raison: string) => new ErreurMesure(`${origine}, ligne ${index + 1} : ${raison} (attendu : « cas ; gauche haut largeur hauteur ; rappel », en pourcentages).`);
      const [cas, valeurs, ...rappel] = ligne.split(";").map((champ) => champ.trim());
      if (cas === undefined || valeurs === undefined || rappel.length === 0) throw refus("il faut trois champs séparés par « ; »");
      if (!/^\d+$/.test(cas) || Number(cas) < 1) throw refus("numéro de cas illisible");
      const nombres = valeurs.split(/\s+/).map(nombre);
      if (nombres.length !== 4 || nombres.some((n) => !Number.isFinite(n))) throw refus("il faut quatre nombres séparés par des espaces");
      const [gauche, haut, largeur, hauteur] = nombres as [number, number, number, number];
      if (nombres.some((n) => n < 0 || n > 100)) throw refus("chaque nombre est un pourcentage, de 0 à 100");
      if (largeur === 0 || hauteur === 0) throw refus("largeur et hauteur doivent être plus grandes que 0");
      const numero = Number(cas);
      if (cadres.has(numero)) throw refus(`deuxième cadre pour le cas ${numero}`);
      cadres.set(numero, { numero, gauche, haut, largeur, hauteur, rappel: rappel.join(";").trim() });
    });
  return cadres;
}

/** Image entière : l'app envoie toujours un cadre pour une photo ; couvrant
 * toute la photo, c'est celui-ci (le serveur analyse alors l'image entière). */
export const IMAGE_ENTIERE: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Un côté du cadre, comme side() de l'app (piece-trace.ts) : borné à
 * l'image, puis élargi autour de son milieu jusqu'à 12 % s'il est plus petit.
 * null : rien de ce côté dans l'image. */
function coteDeLApp(debut: number, fin: number): { depart: number; longueur: number; elargi: boolean } | null {
  const de = Math.max(debut, 0);
  const a = Math.min(fin, 1);
  if (a - de <= 0) return null;
  if (a - de >= COTE_MIN_APP) return { depart: de, longueur: a - de, elargi: false };
  return { depart: Math.min(Math.max((de + a) / 2 - COTE_MIN_APP / 2, 0), 1 - COTE_MIN_APP), longueur: COTE_MIN_APP, elargi: true };
}

function cotesDeLApp(cadre: CadreTrace) {
  const largeur = coteDeLApp(cadre.gauche / 100, (cadre.gauche + cadre.largeur) / 100);
  const hauteur = coteDeLApp(cadre.haut / 100, (cadre.haut + cadre.hauteur) / 100);
  if (!largeur || !hauteur) throw new ErreurMesure(`Cadre du cas ${cadre.numero} : en dehors de l'image.`);
  return { largeur, hauteur };
}

/** Cadre envoyé par l'app : des proportions de l'image (0 à 1), bornées à
 * l'image, chaque côté porté à 12 % au moins autour de son milieu, comme
 * l'app de main (elle ne peut jamais envoyer moins). La marge de 6 points de
 * la pièce entourée au doigt n'est pas ajoutée : elle dépend de la taille
 * d'affichage. */
export function cadreEnProportions(cadre: CadreTrace): CropRect {
  const { largeur, hauteur } = cotesDeLApp(cadre);
  return { x: largeur.depart, y: hauteur.depart, width: largeur.longueur, height: hauteur.longueur };
}

/** Le cadre tracé a-t-il un côté sous 12 % une fois borné à l'image (donc élargi, comme l'app) ? */
export function cadreElargi(cadre: CadreTrace): boolean {
  const { largeur, hauteur } = cotesDeLApp(cadre);
  return largeur.elargi || hauteur.elargi;
}

/** Les mots que l'app enverrait : sans espaces autour, rien s'ils sont vides,
 * 60 caractères au plus (le champ de l'app n'en accepte pas davantage). */
export function motsDeLApp(mots: string): { mots: string | null; tronques: boolean } {
  const propres = mots.trim();
  if (propres === "") return { mots: null, tronques: false };
  return { mots: propres.slice(0, SEARCH_QUERY_MAX_LENGTH), tronques: propres.length > SEARCH_QUERY_MAX_LENGTH };
}

export interface JeuCharge {
  dossier: string;
  cas: CasVerite[];
  cadres: Map<number, CadreTrace>;
  cheminCadres: string;
  /** Écarts entre le jeu de vérité et les cadres, montrés avec le plan. */
  avertissements: string[];
}

/** Écarts entre la colonne « cadre » du jeu et le fichier des cadres, et
 * cadres élargis à 12 % comme l'app. Les cas sans cadre partent en image
 * entière ; un cadre présent est toujours utilisé. */
export function ecartsCadres(cas: readonly CasVerite[], cadres: ReadonlyMap<number, CadreTrace>): string[] {
  const ecarts: string[] = [];
  for (const numero of cadres.keys()) {
    if (!cas.some((c) => c.numero === numero)) throw new ErreurMesure(`Cadre pour le cas ${numero}, absent du jeu de vérité (${cas.length} cas).`);
  }
  for (const c of cas) {
    if (c.cadre && !cadres.has(c.numero)) ecarts.push(`cas ${c.numero} : le jeu dit « cadre : oui », mais aucun cadre n'est tracé : image entière.`);
    if (!c.cadre && cadres.has(c.numero)) ecarts.push(`cas ${c.numero} : cadre tracé alors que le jeu dit « cadre : non » : le cadre est utilisé.`);
    const trace = cadres.get(c.numero);
    if (trace && cadreElargi(trace)) {
      ecarts.push(`cas ${c.numero} : cadre de moins de 12 % de côté (${trace.largeur} × ${trace.hauteur} %), élargi à 12 % autour de son milieu comme l'app (qui ne peut pas envoyer moins) : c'est cette zone qui est envoyée (zones/).`);
    }
  }
  return ecarts;
}

/** Charge le jeu de vérité et les cadres, et vérifie que chaque photo est là.
 * Lecture seule ; rien n'est copié. */
export function chargerJeu(dossier: string, cheminCadres: string): JeuCharge {
  const reponses = join(dossier, FICHIER_REPONSES);
  if (!existsSync(reponses)) throw new ErreurMesure(`Jeu de vérité introuvable : ${reponses} (option --jeu <dossier>).`);
  const cas = lireReponses(readFileSync(reponses, "utf8"));
  const manquantes = cas.filter((c) => {
    const chemin = join(dossier, c.fichier);
    return !existsSync(chemin) || !statSync(chemin).isFile();
  });
  if (manquantes.length > 0) {
    throw new ErreurMesure(`Photo(s) introuvable(s) dans ${dossier} : ${manquantes.map((c) => `${c.fichier} (cas ${c.numero})`).join(", ")}.`);
  }
  if (!existsSync(cheminCadres)) throw new ErreurMesure(`Fichier des cadres introuvable : ${cheminCadres} (option --cadres <fichier>).`);
  const cadres = lireCadres(readFileSync(cheminCadres, "utf8"), basename(cheminCadres));
  return { dossier, cas, cadres, cheminCadres, avertissements: ecartsCadres(cas, cadres) };
}

/** Nom des fichiers d'un cas dans le dossier des sorties. */
export function nomCas(numero: number): string {
  return `cas-${deuxChiffres(numero)}`;
}
