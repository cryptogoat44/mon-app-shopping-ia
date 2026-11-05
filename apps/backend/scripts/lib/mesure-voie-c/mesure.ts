// Mesure de la voie C : le déroulé. Contrôles gratuits et plan d'abord ; puis,
// sans --confirmer, l'essai à blanc (aucun appel payant) ; avec, la mesure
// réelle, cas par cas, par le parcours HTTP de l'app. Comptes d'essai
// supprimés et serveur local arrêté à la fin, même après une erreur ou un
// signal (Ctrl-C, Terminal fermé, arrêt par une session Claude) : au signal,
// le serveur local — seul à appeler SerpApi et Anthropic — est arrêté
// d'abord, la boucle s'arrête (plus aucun compte, plus aucun lancement), puis
// les comptes sont supprimés par l'administration et le rapport écrit. Traces
// durables dans le dossier de la mesure : comptes.json (chaque compte dès sa
// création), mesure.json provisoire dès le début. Tout ce qui parle au monde
// passe par des PORTS (reel.ts) : les tests les remplacent par des faux
// (tests/mesureVoieC.test.ts).
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CropRect } from "@monapp/shared-types";
import { DEV_PROJECT_NAME } from "../dev-database.js";
import { CAS_PAR_COMPTE, CREDITS_PAR_CAS, CREDITS_PAR_CAS_SECONDE_PASSE, GardeBudget, lignesDuPlan, plafondsServeur, planMesure, type Compteurs, type Plan } from "./budget.js";
import { CLE_SERPAPI_A_BLANC, environnementServeur, verifierSpottoDev2, type ModeMots, type OptionsMesure } from "./environnement.js";
import { cadreEnProportions, ErreurMesure, IMAGE_ENTIERE, motsDeLApp, nomCas, type CasVerite, type JeuCharge } from "./jeu-de-verite.js";
import { jugeDuCas, jugerListe, type EtatJugements } from "./jugement.js";
import { construireRapport, dateDeParis } from "./rapport.js";
import {
  codeErreur,
  creditsDuCas,
  FICHIER_CAS,
  FICHIER_CAS_REMPLACE,
  lensARepondu,
  lensDuCache,
  lireReponse,
  resumerJournal,
  type LigneJournal,
  type LigneRecherche,
  type MetaMesure,
  type Passe,
  type ResultatCas,
} from "./resultats.js";

/** main en ligne quand cet outil a été écrit : le serveur mesuré doit en avoir le même code. */
export const COMMIT_MAIN = "9ad5420";
/** Réponse attendue de la sonde gratuite quand la voie C est en service (recherche pas encore lancée). */
const SONDE_VOIE_C_ATTENDUE = "text_search_not_allowed";
/** Deux pannes de Lens de suite : arrêt net (le service va mal, inutile de dépenser). */
const PANNES_DE_SUITE_MAX = 2;
/** Au signal, une fois le serveur arrêté : attente de la sortie de la boucle (le cas en vol échoue vite). */
export const ATTENTE_SORTIE_BOUCLE_MS = 5_000;
/** Une création de compte en cours au moment du nettoyage : attendue au plus ceci, pour que son compte soit supprimé. */
export const ATTENTE_CREATION_MS = 15_000;
/** Adresse des comptes d'essai : mesure-voie-c-<exécution>-<suffixe>@example.com. */
export const PREFIXE_COMPTE = "mesure-voie-c-";
export const FICHIER_COMPTES = "comptes.json";
const JOUR_MS = 24 * 60 * 60 * 1000;
/** Dans le mesure.json provisoire : ce qui reste vrai si l'outil disparaît sans finir. */
export const ARRET_COUPURE = "coupure brutale : l'outil s'est arrêté sans finir son nettoyage (mesure.json provisoire) ; comptes d'essai peut-être restés, voir comptes.json puis --nettoyer <ce dossier>";

export interface ServeurLocal {
  url: string;
  /** Lignes de mesure du serveur, dans l'ordre (resultats.ts, lireLigneJournal). */
  journal: LigneJournal[];
  arreter(): Promise<void>;
}

export interface CompteEssai {
  numero: number;
  id: string;
  /** Adresse d'essai (mesure-voie-c-<exécution>-…@example.com) : pas un secret. */
  email: string;
  /** Jeton de session : jamais affiché ni écrit. */
  jeton: string;
}

/** Compte connu dès sa création, avant la connexion : de quoi le supprimer par l'administration. */
export type CompteCree = Omit<CompteEssai, "jeton">;
/** Compte suivi par l'outil : le jeton n'existe qu'après la connexion. */
export type CompteSuivi = CompteCree & { jeton: string | null };

/** Ce que l'app envoie au lancement d'une photo (apps/mobile/src/lib/api.ts, runSearch). */
export interface EnvoiApp {
  image: Buffer;
  nomFichier: string;
  cadre: CropRect | null;
  mots: string | null;
}

export interface PortsMesure {
  maintenant(): number;
  afficher(texte: string): void;
  /** Écrit un fichier de sortie (les textes passent par le masquage des secrets). */
  ecrire(chemin: string, contenu: string | Buffer): void;
  creerDossier(chemin: string): void;
  /** Contenu d'un fichier texte ; null s'il n'existe pas ou ne se lit pas. */
  lire(chemin: string): string | null;
  /** Noms des entrées d'un dossier ; [] s'il n'existe pas. */
  lister(dossier: string): string[];
  etatLens(): Promise<string>;
  /** null : clé acceptée et modèle disponible ; sinon la raison. Gratuit (liste des modèles). */
  verifierCleAnthropic(cle: string): Promise<string | null>;
  /** Compteurs de spotto-dev-2 (lecture seule, rien n'est réservé). */
  lireCompteurs(): Promise<Compteurs>;
  portLibre(): Promise<number>;
  demarrerServeur(env: Record<string, string>): Promise<ServeurLocal>;
  /** Crée un compte d'essai ; `surCree` est appelé dès que le compte existe,
   * AVANT le profil, les accords et la connexion : il ne peut plus échapper
   * au nettoyage. */
  creerCompte(numero: number, surCree: (compte: CompteCree) => void): Promise<CompteEssai>;
  /** Supprime le compte et ses recherches : par l'app si un serveur et un
   * jeton sont là, sinon par l'administration ; vrai si plus rien ne reste. */
  supprimerCompte(compte: CompteSuivi, serveur: ServeurLocal | null): Promise<boolean>;
  /** Comptes de cette exécution encore sur spotto-dev-2 (balayage par l'adresse). */
  comptesDeLExecution(execution: string): Promise<CompteCree[]>;
  /** POST /api/searches/prepare (gratuit : aucun appel à un fournisseur). */
  preparer(serveur: ServeurLocal, compte: CompteEssai): Promise<{ statut: number; id: string | null; erreur: string | null }>;
  /** POST /api/searches/:id/text sur une recherche pas encore lancée : refusée avant tout appel. */
  sonderVoieC(serveur: ServeurLocal, compte: CompteEssai, id: string): Promise<{ statut: number; erreur: string | null }>;
  /** POST /api/searches/:id/run, multipart comme l'app : LE lancement payant. */
  lancer(serveur: ServeurLocal, compte: CompteEssai, id: string, envoi: EnvoiApp): Promise<{ statut: number; corps: unknown; dureeMs: number }>;
  lireLigne(id: string): Promise<LigneRecherche | null>;
  /** La photo comme l'app l'importe : 1 600 px au plus, JPEG 0,85 (apps/mobile/src/lib/image-import.ts). */
  imageCommeLApp(chemin: string): Promise<{ jpeg: Buffer; largeur: number; hauteur: number }>;
  /** L'image que le serveur analysera (prepareImageForAnalysis) et son empreinte (clé du cache Lens). */
  zoneAnalysee(jpeg: Buffer, cadre: CropRect | null): Promise<{ zone: Buffer; empreinte: string }>;
  attendre(ms: number): Promise<void>;
  /** Au premier SIGINT, SIGTERM ou SIGHUP : `action`, puis fin du programme ;
   * les signaux suivants sont ignorés. Rend de quoi annuler, sans effet une
   * fois l'action lancée. `attendre` : ce que la personne doit attendre à l'écran. */
  surInterruption(action: (signal: string) => Promise<void>, attendre: string): () => void;
}

export interface EntreeMesure {
  options: OptionsMesure;
  /** apps/backend/.env, et par-dessus les variables du Terminal. */
  environnement: Record<string, string>;
  chargerJeu(): JeuCharge;
  jugements: EtatJugements;
  /** Lit apps/backend/.anthropic-essai-key (jamais affichée) ; lève une erreur si absente. */
  lireCleAnthropic(): string;
  depot: { commit: string | null; identiqueAMain: boolean | null };
  /** Dossier de cette mesure (le sous-dossier daté des sorties) ; --reprendre écrit dans le dossier repris. */
  dossierSortie: string;
  /** Fichier .env inexistant, donné au serveur local (DOTENV_CONFIG_PATH). */
  envAbsent: string;
  /** Les cadres viennent-ils du fichier tracé par Claude le 30 octobre (emplacement par défaut) ? */
  cadresTracesParClaude: boolean;
  /** Marqueur de cette exécution, dans l'adresse de ses comptes d'essai (balayage de nettoyage). */
  execution: string;
}

interface CasPrepare {
  cas: CasVerite;
  /** Le cadre tracé, ou l'image entière. */
  cadre: CropRect;
  envoi: ResultatCas["envoi"];
  jpeg: Buffer;
}

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

function nomFichierCas(numero: number, passe: Passe): string {
  return passe === "unique" ? `${nomCas(numero)}.json` : `${nomCas(numero)}-${passe}.json`;
}

function nomFichierRemplace(numero: number, passe: Passe, execution: string): string {
  return nomFichierCas(numero, passe).replace(/\.json$/, `.remplace-${execution}.json`);
}

/** Les passes demandées : une seule, ou avec vos mots puis sans (--les-deux). */
export function passesDe(mots: ModeMots): Passe[] {
  return mots === "les-deux" ? ["avec-mots", "sans-mots"] : ["unique"];
}

/** Envoie-t-on vos mots dans cette passe ? */
function avecMots(mots: ModeMots, passe: Passe): boolean {
  return passe === "avec-mots" || (passe === "unique" && mots === "avec");
}

/** Commande qui supprime les comptes restés d'une mesure. */
function commandeNettoyer(dossier: string): string {
  return `pnpm --filter backend mesure-voie-c --nettoyer ${dossier}`;
}

function raisonInterruption(signal: string): string {
  if (signal === "SIGINT") return "interrompue (Ctrl-C)";
  if (signal === "SIGHUP") return "interrompue (SIGHUP : Terminal fermé)";
  if (signal === "SIGTERM") return "interrompue (SIGTERM : arrêt demandé, par exemple par la session Claude)";
  return `interrompue (${signal})`;
}

// ---- comptes.json : chaque compte d'essai, dès sa création ----

const LIGNE_COMPTES = z.object({
  execution: z.string(),
  numero: z.number(),
  id: z.string(),
  email: z.string(),
  etat: z.enum(["cree", "supprime", "reste"]),
});
type LigneComptes = z.infer<typeof LIGNE_COMPTES>;
const FICHIER_COMPTES_LU = z.object({ comptes: z.array(LIGNE_COMPTES) });

/** Les comptes listés dans comptes.json ; [] s'il manque ou ne se lit pas. */
export function lireLignesComptes(texte: string | null): LigneComptes[] {
  if (texte === null) return [];
  try {
    const lu = FICHIER_COMPTES_LU.safeParse(JSON.parse(texte));
    return lu.success ? lu.data.comptes : [];
  } catch {
    return [];
  }
}

/** comptes.json (numéro, id, adresse, état ; jamais de jeton ni de mot de
 * passe), réécrit à chaque création et à chaque suppression : après une
 * coupure brutale, il dit quels comptes restent. */
class SuiviComptes {
  private readonly lignes: LigneComptes[];
  private readonly jetons = new Map<string, string>();
  private ecritureRatee = false;

  constructor(
    private readonly chemin: string,
    private readonly execution: string,
    private readonly ports: Pick<PortsMesure, "ecrire" | "lire" | "afficher">,
    garderLeFichier: boolean
  ) {
    this.lignes = garderLeFichier ? lireLignesComptes(ports.lire(chemin)) : [];
  }

  ajouter(compte: CompteCree, execution = this.execution): void {
    if (this.lignes.some((ligne) => ligne.id === compte.id)) return;
    this.lignes.push({ execution, numero: compte.numero, id: compte.id, email: compte.email, etat: "cree" });
    this.ecrire();
  }

  connecte(compte: CompteEssai): void {
    this.jetons.set(compte.id, compte.jeton);
  }

  marquer(id: string, supprime: boolean): void {
    const ligne = this.lignes.find((l) => l.id === id);
    if (ligne) ligne.etat = supprime ? "supprime" : "reste";
    this.ecrire();
  }

  etatDe(id: string): LigneComptes["etat"] | null {
    return this.lignes.find((l) => l.id === id)?.etat ?? null;
  }

  /** Comptes pas encore supprimés (copie figée) : ceux de cette exécution, ou de toutes (null). */
  aSupprimer(execution: string | null = this.execution): CompteSuivi[] {
    return this.lignes
      .filter((l) => (execution === null || l.execution === execution) && l.etat !== "supprime")
      .map((l) => ({ numero: l.numero, id: l.id, email: l.email, jeton: this.jetons.get(l.id) ?? null }));
  }

  executions(): string[] {
    return [...new Set(this.lignes.map((l) => l.execution).filter((e) => e !== ""))];
  }

  prochainNumero(): number {
    return this.lignes.filter((l) => l.execution === this.execution).length + 1;
  }

  /** Bilan d'une exécution (null : toutes) : créés, supprimés, restes. */
  bilan(execution: string | null = this.execution): MetaMesure["nettoyage"] {
    const lignes = this.lignes.filter((l) => execution === null || l.execution === execution);
    return { comptes: lignes.length, supprimes: lignes.filter((l) => l.etat === "supprime").length, restes: lignes.filter((l) => l.etat !== "supprime").map((l) => l.id) };
  }

  private ecrire(): void {
    try {
      this.ports.ecrire(this.chemin, `${JSON.stringify({ version: 1, comptes: this.lignes }, null, 2)}\n`);
    } catch {
      if (!this.ecritureRatee) this.ports.afficher(`  ⚠ ${FICHIER_COMPTES} n'a pas pu être écrit : la liste des comptes d'essai reste en mémoire.`);
      this.ecritureRatee = true;
    }
  }
}

/** Dernier balayage : un compte de cette exécution que l'outil n'aurait pas
 * vu (création coupée) est supprimé par l'administration. Rend un
 * avertissement si le balayage n'a pas pu se faire. */
async function balayer(execution: string, suivi: SuiviComptes, ports: PortsMesure, dossier: string): Promise<string | null> {
  try {
    for (const compte of await ports.comptesDeLExecution(execution)) {
      // Déjà essayé et resté : pas une seconde fois ici (--nettoyer réessaiera).
      if (suivi.etatDe(compte.id) === "reste") continue;
      suivi.ajouter(compte, execution);
      suivi.marquer(compte.id, await ports.supprimerCompte({ ...compte, jeton: null }, null).catch(() => false));
    }
    return null;
  } catch {
    return `balayage final des comptes d'essai impossible (spotto-dev-2 injoignable ?) : ${commandeNettoyer(dossier)}`;
  }
}

// ---- Les cas déjà mesurés : dossier d'une mesure, mesures précédentes ----

/** Les JSON des cas d'un dossier : cas-NN….json, et les lancements refaits (…remplace-….json). */
export function lireCasDuDossier(dossier: string, fichiers: { lire(chemin: string): string | null; lister(dossier: string): string[] }): { resultats: ResultatCas[]; remplaces: ResultatCas[]; illisibles: string[] } {
  const resultats: ResultatCas[] = [];
  const remplaces: ResultatCas[] = [];
  const illisibles: string[] = [];
  for (const nom of fichiers.lister(dossier)) {
    const vers = FICHIER_CAS.test(nom) ? resultats : FICHIER_CAS_REMPLACE.test(nom) ? remplaces : null;
    if (!vers) continue;
    try {
      vers.push(JSON.parse(fichiers.lire(join(dossier, nom)) ?? "") as ResultatCas);
    } catch {
      illisibles.push(nom);
    }
  }
  return { resultats, remplaces, illisibles };
}

const JOUR_DE_PARIS = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

export interface MesuresAnterieures {
  /** Crédits dépensés aujourd'hui (heure de Paris) par les cas déjà mesurés dans ces dossiers. */
  depensesDuJour: number;
  /** Mesures dont le dernier lancement a moins de 24 h : leurs images sont dans le cache du serveur. */
  recentes: { dossier: string; dernier: string }[];
}

/** Mesures déjà faites dans le dossier des sorties (et dans `autres`) : ce
 * qu'elles ont dépensé aujourd'hui, et celles de moins de 24 h. Un JSON de
 * cas illisible compte au pire, aujourd'hui (prudence). */
export function mesuresAnterieures(sortie: string, autres: readonly string[], ports: Pick<PortsMesure, "lire" | "lister">, maintenant: number): MesuresAnterieures {
  const dossiers = new Set([...ports.lister(sortie).map((nom) => resolve(sortie, nom)), ...autres.map((dossier) => resolve(dossier))]);
  const aujourdhui = JOUR_DE_PARIS.format(new Date(maintenant));
  let depensesDuJour = 0;
  const recentes: MesuresAnterieures["recentes"] = [];
  for (const dossier of dossiers) {
    const texteMeta = ports.lire(join(dossier, "mesure.json"));
    if (texteMeta === null) continue;
    let dernier = Number.NaN;
    try {
      dernier = Date.parse((JSON.parse(texteMeta) as MetaMesure).debut);
    } catch {
      // mesure.json illisible : seuls les cas datent la mesure.
    }
    const { resultats, remplaces, illisibles } = lireCasDuDossier(dossier, ports);
    depensesDuJour += illisibles.length * CREDITS_PAR_CAS;
    for (const cas of [...resultats, ...remplaces]) {
      const quand = Date.parse(cas.horodatage);
      if (!Number.isFinite(quand)) {
        depensesDuJour += CREDITS_PAR_CAS;
        continue;
      }
      if (JOUR_DE_PARIS.format(new Date(quand)) === aujourdhui) depensesDuJour += typeof cas.credits?.total === "number" ? cas.credits.total : CREDITS_PAR_CAS;
      if (!Number.isFinite(dernier) || quand > dernier) dernier = quand;
    }
    if (Number.isFinite(dernier) && maintenant - dernier < JOUR_MS) recentes.push({ dossier, dernier: new Date(dernier).toISOString() });
  }
  return { depensesDuJour, recentes };
}

/** Une mesure à finir (--reprendre) : ce qu'elle a déjà. */
interface Reprise {
  dossier: string;
  meta: MetaMesure;
  existants: Map<string, ResultatCas>;
  remplaces: ResultatCas[];
}

function cleCas(passe: Passe, numero: number): string {
  return `${passe}:${numero}`;
}

/** Un cas déjà mesuré est gardé s'il a été mesuré et que Lens a répondu ; sinon il est refait. */
function casAGarder(r: ResultatCas | undefined): boolean {
  return r !== undefined && lensARepondu(r);
}

function lireReprise(dossier: string, ports: PortsMesure): Reprise {
  const texte = ports.lire(join(dossier, "mesure.json"));
  if (texte === null) throw new ErreurMesure(`--reprendre : pas de mesure.json dans ${dossier} — rien à reprendre.`);
  let meta: MetaMesure;
  try {
    meta = JSON.parse(texte) as MetaMesure;
  } catch {
    throw new ErreurMesure(`--reprendre : mesure.json illisible dans ${dossier}.`);
  }
  const { resultats, remplaces } = lireCasDuDossier(dossier, ports);
  return { dossier, meta, existants: new Map(resultats.map((r) => [cleCas(r.passe, r.cas), r])), remplaces };
}

/** Images de chaque cas, préparées sur ce Mac (gratuit) avant toute dépense :
 * une photo illisible ou un cadre impossible arrête tout ici. Les images
 * analysées sont écrites dans zones/ (hors de Git), pour vérifier les cadres. */
async function preparerCas(jeu: JeuCharge, dossier: string, ports: PortsMesure): Promise<CasPrepare[]> {
  ports.creerDossier(join(dossier, "zones"));
  const prepares: CasPrepare[] = [];
  for (const cas of jeu.cas) {
    const trace = jeu.cadres.get(cas.numero) ?? null;
    const cadre = trace ? cadreEnProportions(trace) : IMAGE_ENTIERE;
    let image: Awaited<ReturnType<PortsMesure["imageCommeLApp"]>>;
    let zone: Awaited<ReturnType<PortsMesure["zoneAnalysee"]>>;
    try {
      image = await ports.imageCommeLApp(join(jeu.dossier, cas.fichier));
      zone = await ports.zoneAnalysee(image.jpeg, cadre);
    } catch (erreur) {
      throw new ErreurMesure(`Cas ${cas.numero} (${cas.fichier}) : image illisible, ou cadre trop petit une fois appliqué (${message(erreur)}).`);
    }
    ports.ecrire(join(dossier, "zones", `${nomCas(cas.numero)}.jpg`), zone.zone);
    prepares.push({
      cas,
      cadre,
      jpeg: image.jpeg,
      envoi: {
        cadre,
        cadreTrace: trace ? { gauche: trace.gauche, haut: trace.haut, largeur: trace.largeur, hauteur: trace.hauteur, rappel: trace.rappel } : null,
        mots: null,
        motsTronques: false,
        image: { largeur: image.largeur, hauteur: image.hauteur, octets: image.jpeg.length },
        empreinteZone: zone.empreinte,
      },
    });
  }
  return prepares;
}

interface Controle {
  jeu: JeuCharge;
  plan: Plan;
  etatLens: string;
  cle: string | null;
  avertissements: string[];
  mots: ModeMots;
  reprise: Reprise | null;
  /** Avec --confirmer : la raison de ne rien lancer (aucune dépense), ou null. */
  refus: string | null;
}

/** Contrôles préalables, gratuits : base, jeu de vérité, cadres, page d'état
 * de SerpApi, clé d'essai d'Anthropic, mesures précédentes du dossier des
 * sorties (dépense du jour, cache de 24 h) ; puis le plan. */
async function controler(entree: EntreeMesure, ports: PortsMesure): Promise<Controle> {
  const { options } = entree;
  const url = verifierSpottoDev2(entree.environnement);
  ports.afficher("Contrôles préalables (gratuits) :");
  ports.afficher(`  ✓ apps/backend/.env vise ${DEV_PROJECT_NAME} (${url.hostname}).`);
  const avertissements: string[] = [];
  const avertir = (note: string) => {
    avertissements.push(note);
    ports.afficher(`  ⚠ ${note}`);
  };
  const { commit, identiqueAMain } = entree.depot;
  if (identiqueAMain === true) ports.afficher(`  ✓ Serveur : commit ${commit}, code du serveur identique à main en ligne (${COMMIT_MAIN}).`);
  else avertir(`Serveur : ${identiqueAMain === false ? `le code du serveur DIFFÈRE de main en ligne (${COMMIT_MAIN})` : `code du serveur non comparé à main en ligne (${COMMIT_MAIN})`}.`);

  const jeu = entree.chargerJeu();
  const visibles = jeu.cas.filter((c) => c.marqueVisible).length;
  const avecCadre = jeu.cas.filter((c) => c.cadre).length;
  ports.afficher(`  ✓ Jeu de vérité : ${jeu.cas.length} cas (${visibles} avec marque visible, ${avecCadre} avec « cadre : oui »), toutes les photos présentes.`);
  ports.afficher(`  ✓ Cadres : ${jeu.cadres.size} (${jeu.cheminCadres})${entree.cadresTracesParClaude ? ", tracés par Claude le 30 octobre, à valider par le fondateur" : ""} ; les autres cas en image entière.`);
  for (const ecart of jeu.avertissements) avertir(ecart);

  const reprise = options.reprendre ? lireReprise(options.reprendre, ports) : null;
  const mots: ModeMots = reprise ? reprise.meta.mots : options.mots;
  const tronques = jeu.cas.filter((c) => motsDeLApp(c.mots).tronques).map((c) => c.numero);
  if (mots !== "sans" && tronques.length > 0) avertir(`Mots coupés à 60 caractères, comme le champ de l'app : cas ${tronques.join(", ")}.`);
  if (entree.jugements.etat === "absent") ports.afficher("  ✓ Jugement du fondateur (jugements.txt) : absent — règle du banc (semblePiece).");
  else if (entree.jugements.etat === "format-a-venir") {
    avertir("jugements.txt existe, mais son format n'est pas encore pris en charge : la règle du banc s'applique ; le rapport pourra être refait sans rien dépenser (--refaire-rapport).");
  } else ports.afficher("  ✓ Jugement du fondateur (jugements.txt) : lu, il passe avant la règle du banc.");

  const etatLens = await ports.etatLens();
  ports.afficher(`  ${etatLens === "operational" ? "✓" : "⚠"} Google Lens chez SerpApi (page d'état publique) : ${etatLens}.`);

  let cle: string | null = null;
  try {
    cle = entree.lireCleAnthropic();
  } catch (erreur) {
    if (options.confirmer) throw erreur;
    ports.afficher(`  ⚠ Clé d'essai d'Anthropic : ${message(erreur)}`);
  }
  if (cle !== null) {
    const probleme = await ports.verifierCleAnthropic(cle);
    if (probleme !== null) {
      if (options.confirmer) throw new ErreurMesure(`Clé d'essai d'Anthropic : ${probleme}. Aucune dépense.`);
      ports.afficher(`  ⚠ Clé d'essai d'Anthropic : ${probleme}.`);
    } else ports.afficher("  ✓ Clé d'essai d'Anthropic : acceptée, modèle de la voie C disponible (vérifié par la liste des modèles, gratuite).");
  }

  // Une mesure reprise : seuls ses cas absents ou en panne (Lens sans réponse) sont refaits.
  const passes = passesDe(mots);
  const aRefaire = (passe: Passe, numero: number) => !reprise || !casAGarder(reprise.existants.get(cleCas(passe, numero)));
  const casPremiere = jeu.cas.filter((c) => aRefaire(passes[0]!, c.numero)).length;
  // Passe 2 : au plus ces cas ; seuls ceux dont Lens aura répondu en passe 1 partiront.
  const casSeconde = mots === "les-deux" ? jeu.cas.filter((c) => aRefaire("sans-mots", c.numero)).length : 0;
  if (reprise) {
    const refaire = passes.flatMap((passe) => jeu.cas.filter((c) => aRefaire(passe, c.numero)).map((c) => (passe === "unique" ? `${c.numero}` : `${c.numero} (${passe})`)));
    const gardes = [...reprise.existants.values()].filter(casAGarder).length;
    ports.afficher(`  ✓ Reprise de ${reprise.dossier} (mesure du ${dateDeParis(reprise.meta.debut)}, ${mots === "avec" ? "avec vos mots" : mots === "sans" ? "sans vos mots" : "les deux passes"}) : ${gardes} cas gardés ; à refaire : ${refaire.length > 0 ? refaire.join(", ") : "aucun"}.`);
    const restes = lireLignesComptes(ports.lire(join(reprise.dossier, FICHIER_COMPTES))).filter((l) => l.etat !== "supprime");
    if (restes.length > 0) avertir(`${restes.length} compte(s) d'essai d'une exécution précédente de cette mesure non supprimé(s) : ${commandeNettoyer(reprise.dossier)}.`);
  }

  // Mesures précédentes : la dépense du jour est retranchée du plafond ; une mesure de moins de 24 h est dans le cache.
  const anterieures = mesuresAnterieures(options.sortie, reprise ? [reprise.dossier] : [], ports, ports.maintenant());
  let refus: string | null = null;
  const recentes = anterieures.recentes.filter((r) => !reprise || r.dossier !== resolve(reprise.dossier));
  for (const recente of recentes) {
    avertir(
      `Mesure de moins de 24 h : ${recente.dossier} (dernier lancement le ${dateDeParis(recente.dernier)}). Ses images sont dans le cache du serveur jusqu'au ${dateDeParis(recente.dernier, JOUR_MS)} : ces cas seraient servis par le cache (exclus des durées et des boutiques).`
    );
  }
  if (!reprise && recentes.length > 0) {
    const recente = recentes[0]!;
    refus = `Une mesure a moins de 24 h (${recente.dossier}) : relancée maintenant, une bonne partie serait servie par le cache. Pour finir une mesure arrêtée : --reprendre ${recente.dossier}. Sinon, attendre le ${dateDeParis(recente.dernier, JOUR_MS)}. Aucune dépense.`;
  }

  const plan = planMesure(casPremiere, { lesDeux: mots === "les-deux", plafond: options.plafond, dejaDepenses: anterieures.depensesDuJour, casSecondePasse: casSeconde });
  const premierCout = plan.cas > 0 ? CREDITS_PAR_CAS : CREDITS_PAR_CAS_SECONDE_PASSE;
  if (plan.cas + plan.casSecondePasse > 0 && plan.plafond - plan.dejaDepenses < premierCout) {
    refus ??= `Plafond de la journée déjà atteint : ${plan.dejaDepenses} crédit(s) dépensé(s) aujourd'hui par les mesures précédentes, plafond ${plan.plafond}. Rien ne peut partir ; un plafond plus haut demande un nouvel accord écrit du fondateur. Aucune dépense.`;
  }
  ports.afficher("");
  for (const ligne of lignesDuPlan(plan)) ports.afficher(ligne);
  if (refus) ports.afficher(`  ⚠ Avec --confirmer : refus. ${refus}`);
  return { jeu, plan, etatLens, cle, avertissements, mots, reprise, refus };
}

/** Lance la mesure : contrôles et plan, puis essai à blanc ou mesure réelle. */
export async function lancerMesure(entree: EntreeMesure, ports: PortsMesure): Promise<void> {
  ports.afficher(`Mesure de la voie C — le serveur de main, lancé sur ce Mac ; base ${DEV_PROJECT_NAME} seulement.`);
  const controle = await controler(entree, ports);
  if (!entree.options.confirmer) {
    await essaiABlanc(entree, ports, controle);
    return;
  }
  if (controle.etatLens !== "operational") {
    throw new ErreurMesure(`SerpApi n'annonce pas Google Lens opérationnel (« ${controle.etatLens} ») : mesure reportée, aucun crédit dépensé.`);
  }
  if (controle.refus) throw new ErreurMesure(controle.refus);
  if (controle.reprise && controle.plan.cas === 0 && controle.plan.casSecondePasse === 0) {
    const chemin = refaireRapport(controle.reprise.dossier, entree.jugements, { lire: (c) => ports.lire(c), lister: (d) => ports.lister(d), ecrire: (c, t) => ports.ecrire(c, t) });
    ports.afficher(`Rien à reprendre : tous les cas sont mesurés. Rapport refait, sans aucun appel : ${chemin}`);
    return;
  }
  await mesureReelle(entree, ports, { ...controle, cle: controle.cle! });
}

/** Essai à blanc : rien de payant. Le serveur local démarre avec une clé
 * SerpApi INVALIDE et sans clé d'Anthropic ; un compte d'essai est créé (et
 * listé dans comptes.json dès sa création), UNE recherche est préparée
 * (gratuit : routes/searches.ts, « prepare » n'appelle aucun fournisseur), la
 * sonde gratuite de la voie C est faite, puis tout est supprimé. Aucun
 * lancement. */
async function essaiABlanc(entree: EntreeMesure, ports: PortsMesure, controle: Controle): Promise<void> {
  const dossier = `${entree.dossierSortie}-essai-a-blanc`;
  ports.afficher("");
  ports.afficher("Essai à blanc (sans --confirmer) : aucun appel payant.");
  await preparerCas(controle.jeu, dossier, ports);
  ports.afficher(`  ✓ Images préparées comme l'app, sur ce Mac ; images analysées par cas : ${join(dossier, "zones")}`);
  const compteurs = await ports.lireCompteurs();
  const plafonds = plafondsServeur(compteurs, controle.plan.creditsAuPlus);
  ports.afficher(`  ✓ Compteurs de ${DEV_PROJECT_NAME} : ${compteurs.jour} appel(s) aujourd'hui, ${compteurs.mois} ce cycle.`);
  ports.afficher(
    `    Plafonds que recevrait le serveur de la mesure : ${plafonds.SERPAPI_DAILY_CAP} par jour, ${plafonds.SERPAPI_MONTHLY_CAP} par cycle, ${plafonds.SERPAPI_USER_DAILY_CAP} photos par compte.`
  );
  const env = environnementServeur(entree.environnement, { port: await ports.portLibre(), cleAnthropic: null, cleSerpApi: CLE_SERPAPI_A_BLANC, plafonds, envAbsent: entree.envAbsent });
  const suivi = new SuiviComptes(join(dossier, FICHIER_COMPTES), entree.execution, ports, false);
  let serveur: ServeurLocal | null = null;
  let creation: Promise<CompteEssai> | null = null;
  let interrompu = false;
  let nettoyage: Promise<void> | null = null;
  const nettoyer = () =>
    (nettoyage ??= (async () => {
      // Une création en cours se termine d'abord : son compte est alors supprimé avec les autres.
      const creationInachevee = creation ? !(await Promise.race([creation.then(() => true, () => true), ports.attendre(ATTENTE_CREATION_MS).then(() => false)])) : false;
      for (const compte of suivi.aSupprimer()) {
        const supprime = await ports.supprimerCompte(compte, interrompu ? null : serveur).catch(() => false);
        suivi.marquer(compte.id, supprime);
        ports.afficher(supprime ? "  ✓ Compte d'essai supprimé." : `  ⚠ Compte d'essai NON supprimé : ${commandeNettoyer(dossier)}`);
      }
      const balayage = await balayer(entree.execution, suivi, ports, dossier);
      if (balayage) ports.afficher(`  ⚠ ${balayage}`);
      await serveur?.arreter().catch(() => undefined);
      if (creationInachevee) ports.afficher(`  ⚠ Une création de compte d'essai était encore en cours : un compte a pu rester. Dans 15 minutes : ${commandeNettoyer(dossier)}`);
    })());
  const oublier = ports.surInterruption(async () => {
    interrompu = true;
    ports.afficher("Essai à blanc interrompu : suppression du compte d'essai et arrêt du serveur local…");
    await nettoyer();
    ports.afficher("Essai à blanc interrompu : rien n'a été lancé.");
  }, "« Essai à blanc interrompu »");
  try {
    serveur = await ports.demarrerServeur(env);
    if (interrompu) return;
    ports.afficher(`  ✓ Serveur local démarré (${serveur.url}), voie C allumée pour lui seul, clé SerpApi invalide (rien ne peut partir).`);
    creation = ports.creerCompte(suivi.prochainNumero(), (cree) => suivi.ajouter(cree));
    const compte = await creation;
    suivi.connecte(compte);
    if (interrompu) return;
    ports.afficher(`  ✓ Compte d'essai créé sur spotto-dev-2 (listé dans ${join(dossier, FICHIER_COMPTES)}).`);
    const preparation = await ports.preparer(serveur, compte);
    if (preparation.id === null) throw new ErreurMesure(`Préparation d'une recherche refusée (${preparation.erreur ?? preparation.statut}).`);
    ports.afficher("  ✓ Une recherche préparée (gratuit).");
    const sonde = await ports.sonderVoieC(serveur, compte, preparation.id);
    if (sonde.statut === 409 && sonde.erreur === SONDE_VOIE_C_ATTENDUE) ports.afficher("  ✓ Voie C en service sur le serveur local (migration 0028 vue sur spotto-dev-2).");
    else ports.afficher(`  ⚠ Voie C PAS en service sur le serveur local (réponse ${sonde.statut}${sonde.erreur ? `, ${sonde.erreur}` : ""}) : la mesure n'aurait rien à mesurer.`);
  } finally {
    await nettoyer();
    oublier();
  }
  if (interrompu) return;
  ports.afficher("Essai à blanc terminé : aucun crédit dépensé, aucun appel à l'IA.");
  ports.afficher("Pour la mesure réelle, après l'accord écrit du fondateur : la même commande, avec --confirmer.");
}

interface EtatMesure {
  resultats: ResultatCas[];
  /** Lancements refaits (reprise) : leurs crédits ont été dépensés. */
  remplaces: ResultatCas[];
  serveur: ServeurLocal | null;
  meta: MetaMesure;
  /** Signal reçu : plus aucun compte, plus aucun lancement. */
  arretDemande: boolean;
  /** La boucle des cas est sortie (fin, erreur ou arrêt). */
  boucleFinie: boolean;
  /** Création de compte en cours, attendue avant le nettoyage. */
  creation: Promise<unknown> | null;
}

/** Attend (3 s au plus) la ligne « Mesure complément » du lancement : le
 * serveur l'écrit juste avant de répondre, elle peut arriver un instant après. */
async function attendreMesureDuServeur(serveur: ServeurLocal, depuis: number, ports: PortsMesure): Promise<void> {
  for (let attente = 0; attente < 3000; attente += 50) {
    if (serveur.journal.slice(depuis).some((ligne) => ligne.msg === "Mesure complément")) return;
    await ports.attendre(50);
  }
}

/** Un cas, par le parcours HTTP de l'app : préparation, lancement (photo,
 * cadre, mots), réponse finale avec le complément ; puis la ligne relue et
 * les lignes de mesure du serveur. null : arrêt demandé avant le lancement
 * (rien n'est parti). */
async function mesurerCas(
  prepare: CasPrepare,
  passe: Passe,
  envoiMots: boolean,
  compte: CompteEssai,
  serveur: ServeurLocal,
  ports: PortsMesure,
  options: { coutAuPire: number; arretDemande: () => boolean }
): Promise<ResultatCas | null> {
  const { cas } = prepare;
  const mots = envoiMots ? motsDeLApp(cas.mots) : { mots: null, tronques: false };
  const { numero: _numero, ...verite } = cas;
  const resultat: ResultatCas = {
    version: 1,
    cas: cas.numero,
    passe,
    verite,
    envoi: { ...prepare.envoi, mots: mots.mots, motsTronques: mots.tronques },
    issue: "panne",
    http: { preparation: null, lancement: null },
    erreur: null,
    reponse: null,
    propositions: { lens: [], boutiques: [] },
    ligne: null,
    journal: null,
    durees: { preparationMs: null, lancementMs: null },
    credits: { lens: 0, shopping: 0, total: 0, selonJournal: null, estime: false },
    compte: compte.numero,
    horodatage: new Date(ports.maintenant()).toISOString(),
  };

  const debut = ports.maintenant();
  const preparation = await ports.preparer(serveur, compte);
  resultat.durees.preparationMs = ports.maintenant() - debut;
  resultat.http.preparation = preparation.statut;
  if (preparation.id === null) {
    resultat.issue = preparation.statut >= 400 && preparation.statut < 500 ? "refus" : "panne";
    resultat.erreur = preparation.erreur;
    return resultat;
  }
  // Arrêt demandé pendant la préparation : rien ne part (la recherche préparée, gratuite, s'en va avec le compte).
  if (options.arretDemande()) return null;

  const depuis = serveur.journal.length;
  let lancement: Awaited<ReturnType<PortsMesure["lancer"]>> | null = null;
  try {
    lancement = await ports.lancer(serveur, compte, preparation.id, { image: prepare.jpeg, nomFichier: `${nomCas(cas.numero)}.jpg`, cadre: prepare.cadre, mots: mots.mots });
  } catch (erreur) {
    resultat.erreur = `lancement sans réponse (${message(erreur)})`;
  }
  if (lancement) {
    resultat.http.lancement = lancement.statut;
    resultat.durees.lancementMs = lancement.dureeMs;
    if (lancement.statut === 200) {
      await attendreMesureDuServeur(serveur, depuis, ports);
      const reponse = lireReponse(lancement.corps);
      if (reponse) {
        const { lens, boutiques, ...reste } = reponse;
        resultat.issue = "mesure";
        resultat.reponse = reste;
        resultat.propositions = { lens, boutiques };
      } else resultat.erreur = "réponse illisible";
    } else {
      resultat.issue = lancement.statut >= 400 && lancement.statut < 500 ? "refus" : "panne";
      resultat.erreur = codeErreur(lancement.corps) ?? `réponse ${lancement.statut}`;
    }
  }
  resultat.ligne = await ports.lireLigne(preparation.id).catch(() => null);
  resultat.journal = resumerJournal(serveur.journal.slice(depuis));
  const credits = creditsDuCas(resultat.ligne, resultat.journal);
  // Sans réponse, ou recherche encore en cours : le pire est compté, par prudence.
  const incertain = lancement === null || resultat.ligne?.status === "processing";
  resultat.credits = incertain ? { ...credits, total: Math.max(credits.total, options.coutAuPire), estime: true } : credits;
  return resultat;
}

/** Une ligne par cas dans le Terminal : des nombres, jamais un titre ni un marchand. */
function ligneTerminal(r: ResultatCas, jugements: EtatJugements, garde: GardeBudget): string {
  const debut = `  cas ${String(r.cas).padStart(2, "0")}${r.passe === "unique" ? "" : ` (${r.passe})`} :`;
  const credits = `${r.credits.total} crédit(s)${r.credits.estime ? " (estimé)" : ""} — cumul ${garde.depenses}/${garde.plafond}`;
  if (r.issue !== "mesure") return `${debut} non mesuré (${r.erreur ?? r.issue}) · ${credits}`;
  const juge = jugeDuCas(r.cas, r.verite, jugements);
  const place = (premiere: number | null) => (premiere === null ? "—" : premiere === 1 ? "1re" : `${premiere}e`);
  const lens = jugerListe(r.propositions.lens.map((p) => ({ ...p, origine: "lens" as const })), juge);
  const boutiques = jugerListe(r.propositions.boutiques.map((p) => ({ ...p, origine: "shopping" as const })), juge);
  const prix = (liste: readonly { prix: number | null }[]) => liste.filter((p) => p.prix !== null).length;
  const duree = r.durees.lancementMs === null ? "—" : `${(r.durees.lancementMs / 1000).toFixed(1).replace(".", ",")} s`;
  return `${debut} Lens ${r.propositions.lens.length} (${prix(r.propositions.lens)} avec prix)${lensDuCache(r) ? " · Lens du cache" : ""} · complément ${r.reponse?.complement?.status ?? "aucun"}, ${
    r.propositions.boutiques.length
  } boutique(s) (${prix(r.propositions.boutiques)} avec prix) · bonne pièce : Lens ${place(lens.premiere)}, boutiques ${place(boutiques.premiere)} · ${duree} · ${credits}`;
}

/** La mesure réelle (avec --confirmer). */
async function mesureReelle(entree: EntreeMesure, ports: PortsMesure, controle: Controle & { cle: string }): Promise<void> {
  const { jeu, plan, reprise, mots } = controle;
  const dossier = reprise?.dossier ?? entree.dossierSortie;
  const passes = passesDe(mots);
  ports.afficher("");
  ports.afficher(`Mesure réelle (--confirmer). Sorties : ${dossier}`);
  const prepares = await preparerCas(jeu, dossier, ports);

  const compteursAvant = await ports.lireCompteurs();
  const plafonds = plafondsServeur(compteursAvant, plan.creditsAuPlus);
  const aRefaire = (passe: Passe, numero: number) => !reprise || !casAGarder(reprise.existants.get(cleCas(passe, numero)));
  const etat: EtatMesure = {
    resultats: reprise ? [...reprise.existants.values()] : [],
    remplaces: reprise ? [...reprise.remplaces] : [],
    serveur: null,
    meta: {
      version: 1,
      debut: new Date(ports.maintenant()).toISOString(),
      fin: null,
      execution: entree.execution,
      serveur: { ...entree.depot, commitMain: COMMIT_MAIN },
      jeu: jeu.dossier,
      cadres: { chemin: jeu.cheminCadres, nombre: jeu.cadres.size, tracesParClaude: entree.cadresTracesParClaude },
      mots,
      plan,
      plafondsServeur: plafonds,
      etatLens: controle.etatLens,
      compteurs: { avant: compteursAvant, entrePasses: null, apres: null },
      arret: null,
      nettoyage: { comptes: 0, supprimes: 0, restes: [] },
      avertissements: [...controle.avertissements],
      ...(reprise
        ? {
            reprise: { debutPrecedent: reprise.meta.debut, casGardes: [...reprise.existants.values()].filter(casAGarder).length, casRefaits: [] },
            precedentes: [{ ...reprise.meta, precedentes: undefined }, ...(reprise.meta.precedentes ?? [])],
          }
        : {}),
    },
    arretDemande: false,
    boucleFinie: false,
    creation: null,
  };
  ports.afficher(`  Compteurs de ${DEV_PROJECT_NAME} avant : ${compteursAvant.jour} appel(s) aujourd'hui, ${compteursAvant.mois} ce cycle.`);
  ports.afficher(`  Plafonds du serveur local : ${plafonds.SERPAPI_DAILY_CAP} par jour, ${plafonds.SERPAPI_MONTHLY_CAP} par cycle, ${plafonds.SERPAPI_USER_DAILY_CAP} photos par compte.`);

  const suivi = new SuiviComptes(join(dossier, FICHIER_COMPTES), entree.execution, ports, reprise !== null);
  let fini: Promise<void> | null = null;
  const ecrireMeta = (meta: MetaMesure) => ports.ecrire(join(dossier, "mesure.json"), `${JSON.stringify(meta, null, 2)}\n`);
  /** mesure.json provisoire (dès le début, puis à chaque compte) : --refaire-rapport et --nettoyer marchent après une coupure brutale. */
  const ecrireMetaProvisoire = () => {
    if (fini) return;
    try {
      ecrireMeta({ ...etat.meta, arret: etat.meta.arret ?? ARRET_COUPURE, nettoyage: suivi.bilan() });
    } catch {
      // Le mesure.json final le remplacera.
    }
  };
  ecrireMetaProvisoire();

  let boucleTerminee: () => void = () => undefined;
  const sortieDeBoucle = new Promise<void>((resolve) => (boucleTerminee = resolve));
  /** Une seule fois, la boucle arrêtée : comptes supprimés (copie figée), balayage, serveur arrêté, mesure.json et rapport. */
  const finaliser = () =>
    (fini ??= (async () => {
      const creation = etat.creation;
      const creationInachevee = creation ? !(await Promise.race([creation.then(() => true, () => true), ports.attendre(ATTENTE_CREATION_MS).then(() => false)])) : false;
      // Après un signal, le serveur est déjà arrêté : suppression par l'administration.
      const serveurPourSupprimer = etat.arretDemande ? null : etat.serveur;
      for (const compte of suivi.aSupprimer()) suivi.marquer(compte.id, await ports.supprimerCompte(compte, serveurPourSupprimer).catch(() => false));
      const balayage = await balayer(entree.execution, suivi, ports, dossier);
      if (balayage) etat.meta.avertissements.push(balayage);
      if (creationInachevee) etat.meta.avertissements.push(`une création de compte d'essai était encore en cours à l'arrêt : un compte a pu rester ; dans 15 minutes : ${commandeNettoyer(dossier)}`);
      etat.meta.nettoyage = suivi.bilan();
      await etat.serveur?.arreter().catch(() => undefined);
      etat.meta.compteurs.apres = await ports.lireCompteurs().catch(() => null);
      etat.meta.fin = new Date(ports.maintenant()).toISOString();
      ecrireMeta(etat.meta);
      ports.ecrire(join(dossier, "rapport.md"), construireRapport({ meta: etat.meta, resultats: etat.resultats, remplaces: etat.remplaces, jugements: entree.jugements, dossier }));
      const credits = [...etat.resultats, ...etat.remplaces].reduce((somme, r) => somme + r.credits.total, 0);
      const { nettoyage } = etat.meta;
      ports.afficher("");
      ports.afficher(`Comptes d'essai supprimés : ${nettoyage.supprimes}/${nettoyage.comptes}${nettoyage.restes.length > 0 ? ` — ⚠ restent : ${nettoyage.restes.join(", ")} (${commandeNettoyer(dossier)})` : ""}.`);
      ports.afficher(`Crédits SerpApi dépensés : ${credits} (plafond ${plan.plafond}).${etat.meta.arret ? ` Arrêt : ${etat.meta.arret}.` : ""}`);
      ports.afficher(`Rapport : ${join(dossier, "rapport.md")}`);
    })());
  // Au signal : le serveur d'abord (lui seul paie), la sortie de la boucle
  // ensuite (bornée), puis le nettoyage, une seule fois.
  const oublier = ports.surInterruption(async (signal) => {
    etat.arretDemande = true;
    if (!etat.boucleFinie) etat.meta.arret ??= raisonInterruption(signal);
    ports.afficher("Arrêt : serveur local d'abord (plus aucun appel payant ne peut partir), puis suppression des comptes d'essai et rapport…");
    await etat.serveur?.arreter().catch(() => undefined);
    await Promise.race([sortieDeBoucle, ports.attendre(ATTENTE_SORTIE_BOUCLE_MS)]);
    await finaliser();
  }, "« Rapport : … »");

  const garde = new GardeBudget(plan.plafond, plan.dejaDepenses);
  const comptesParCle = new Map<string, CompteEssai>();
  /** Le compte d'essai de ce rang dans la passe (8 cas par compte) ; null après un signal (aucun nouveau compte). */
  const compteDe = async (passe: Passe, rang: number): Promise<CompteEssai | null> => {
    const cle = `${passe}-${Math.floor(rang / CAS_PAR_COMPTE)}`;
    const existant = comptesParCle.get(cle);
    if (existant) return existant;
    if (etat.arretDemande) return null;
    const creation = ports.creerCompte(suivi.prochainNumero(), (cree) => {
      suivi.ajouter(cree);
      ecrireMetaProvisoire();
    });
    etat.creation = creation;
    try {
      const compte = await creation;
      suivi.connecte(compte);
      comptesParCle.set(cle, compte);
      return compte;
    } finally {
      if (etat.creation === creation) etat.creation = null;
    }
  };
  const resultatDe = (passe: Passe, numero: number) => etat.resultats.find((r) => r.passe === passe && r.cas === numero);
  /** Range un cas (le JSON brut, écrit tout de suite) ; un cas refait garde l'ancien sous …remplace-<exécution>.json. */
  const enregistrer = (resultat: ResultatCas) => {
    const index = etat.resultats.findIndex((r) => r.passe === resultat.passe && r.cas === resultat.cas);
    if (index >= 0) {
      const ancien = etat.resultats[index]!;
      etat.remplaces.push(ancien);
      ports.ecrire(join(dossier, nomFichierRemplace(ancien.cas, ancien.passe, entree.execution)), `${JSON.stringify(ancien, null, 2)}\n`);
      etat.resultats[index] = resultat;
    } else etat.resultats.push(resultat);
    if (etat.meta.reprise) etat.meta.reprise.casRefaits.push(resultat.passe === "unique" ? `${resultat.cas}` : `${resultat.cas} (${resultat.passe})`);
    ports.ecrire(join(dossier, nomFichierCas(resultat.cas, resultat.passe)), `${JSON.stringify(resultat, null, 2)}\n`);
  };

  /** Passe 2 de --les-deux : serveur relancé IA coupée (ni IA ni Google Shopping possibles) ; Lens vient du cache. */
  const relancerSansIa = async (): Promise<boolean> => {
    etat.meta.compteurs.entrePasses = await ports.lireCompteurs().catch(() => null);
    ecrireMetaProvisoire();
    if (etat.arretDemande) return false;
    await etat.serveur?.arreter().catch(() => undefined);
    const budget = Math.max(0, Math.min(plan.plafond - garde.depenses, plan.creditsSecondePasseAuPire));
    const plafondsSeconde = etat.meta.compteurs.entrePasses ? plafondsServeur(etat.meta.compteurs.entrePasses, budget) : plafonds;
    const env = environnementServeur(entree.environnement, { port: await ports.portLibre(), cleAnthropic: null, cleSerpApi: null, plafonds: plafondsSeconde, envAbsent: entree.envAbsent });
    if (etat.arretDemande) return false;
    etat.serveur = await ports.demarrerServeur(env);
    if (etat.arretDemande) return false;
    ports.afficher(
      `  ✓ Serveur local relancé pour la passe 2 : IA de la voie C coupée (ni IA, ni Google Shopping possibles), Lens lu dans le cache ; plafonds ${plafondsSeconde.SERPAPI_DAILY_CAP} par jour, ${plafondsSeconde.SERPAPI_MONTHLY_CAP} par cycle.`
    );
    return true;
  };

  const deroule = async (): Promise<void> => {
    const env = environnementServeur(entree.environnement, { port: await ports.portLibre(), cleAnthropic: controle.cle, cleSerpApi: null, plafonds, envAbsent: entree.envAbsent });
    if (etat.arretDemande) return;
    etat.serveur = await ports.demarrerServeur(env);
    if (etat.arretDemande) return;
    ports.afficher(`  ✓ Serveur local démarré (${etat.serveur.url}) : voie C et son IA allumées pour lui seul, Sentry coupé, photo vers Anthropic coupée.`);

    // Sonde gratuite : la voie C est-elle en service ? (Sinon, rien à mesurer : arrêt avant toute dépense.)
    const premier = await compteDe(plan.cas > 0 ? passes[0]! : "sans-mots", 0);
    if (!premier || etat.arretDemande) return;
    const preparation = await ports.preparer(etat.serveur, premier);
    if (preparation.id === null) throw new ErreurMesure(`Préparation d'une recherche refusée (${preparation.erreur ?? preparation.statut}) : arrêt avant toute dépense.`);
    const sonde = await ports.sonderVoieC(etat.serveur, premier, preparation.id);
    if (sonde.statut !== 409 || sonde.erreur !== SONDE_VOIE_C_ATTENDUE) {
      throw new ErreurMesure(`La voie C n'est pas en service sur le serveur local (réponse ${sonde.statut}) : interrupteur, ou migration 0028 absente de spotto-dev-2. Arrêt avant toute dépense.`);
    }
    if (etat.arretDemande) return;
    ports.afficher("  ✓ Voie C en service sur le serveur local (sonde gratuite).");

    let pannesDeSuite = 0;
    for (const passe of passes) {
      if (etat.arretDemande) return;
      if (passe === "sans-mots" && !(await relancerSansIa())) return;
      ports.afficher("");
      ports.afficher(passe === "unique" ? `Cas par cas (${mots === "avec" ? "avec vos mots" : "sans vos mots"}) :` : passe === "avec-mots" ? "Passe 1, avec vos mots :" : "Passe 2, sans vos mots (IA coupée, Lens lu dans le cache) :");
      const coutAuPire = passe === "sans-mots" ? CREDITS_PAR_CAS_SECONDE_PASSE : CREDITS_PAR_CAS;
      let lances = 0;
      for (const prepare of prepares) {
        if (etat.arretDemande) return;
        const numero = prepare.cas.numero;
        if (!aRefaire(passe, numero)) continue;
        if (passe === "sans-mots") {
          const passe1 = resultatDe("avec-mots", numero);
          if (!passe1 || !lensARepondu(passe1)) {
            ports.afficher(`  cas ${String(numero).padStart(2, "0")} (sans-mots) : non relancé (Lens sans réponse en passe 1 : il serait refacturé).`);
            continue;
          }
        }
        if (!garde.peutLancer(coutAuPire)) {
          etat.meta.arret = `plafond de ${plan.plafond} crédits : le cas ${numero} aurait pu le dépasser (${garde.depenses} déjà dépensés)`;
          return;
        }
        const compte = await compteDe(passe, lances);
        if (!compte || etat.arretDemande) return;
        const resultat = await mesurerCas(prepare, passe, avecMots(mots, passe), compte, etat.serveur!, ports, { coutAuPire, arretDemande: () => etat.arretDemande });
        if (!resultat) return;
        lances += 1;
        enregistrer(resultat);
        garde.compter(resultat.credits.total);
        ports.afficher(ligneTerminal(resultat, entree.jugements, garde));
        if (etat.arretDemande) return;
        if (resultat.http.lancement === 429 || resultat.http.preparation === 429) {
          etat.meta.arret = `le serveur a refusé un lancement (${resultat.erreur ?? "429"}) : plafond ou limite atteints`;
          return;
        }
        const panne = resultat.issue === "panne" || resultat.ligne?.outcome === "failure";
        pannesDeSuite = panne ? pannesDeSuite + 1 : 0;
        if (pannesDeSuite >= PANNES_DE_SUITE_MAX) {
          etat.meta.arret = `${PANNES_DE_SUITE_MAX} pannes de suite (dernière : ${resultat.erreur ?? resultat.ligne?.failure_kind ?? "panne"})`;
          return;
        }
      }
    }
  };

  try {
    await deroule();
  } catch (erreur) {
    // Après un signal, les échecs viennent de l'arrêt du serveur : attendus.
    if (!etat.arretDemande) {
      etat.meta.arret ??= message(erreur);
      throw erreur;
    }
  } finally {
    etat.boucleFinie = true;
    boucleTerminee();
    // Après un signal, le gestionnaire finit le nettoyage, puis le programme.
    if (!etat.arretDemande) {
      await finaliser();
      oublier();
    }
  }
}

/** Refait rapport.md d'une mesure déjà faite, à partir de ses JSON : aucun
 * appel, aucune dépense (règle ou jugement du fondateur changés, coupure
 * brutale, comptes nettoyés après coup). */
export function refaireRapport(
  dossier: string,
  jugements: EtatJugements,
  fichiers: { lire(chemin: string): string | null; lister(dossier: string): string[]; ecrire(chemin: string, contenu: string): void }
): string {
  const texte = fichiers.lire(join(dossier, "mesure.json"));
  if (texte === null) throw new ErreurMesure(`Pas de mesure.json dans ${dossier} : rien à refaire.`);
  const meta = JSON.parse(texte) as MetaMesure;
  const { resultats, remplaces, illisibles } = lireCasDuDossier(dossier, fichiers);
  if (illisibles.length > 0) throw new ErreurMesure(`JSON de cas illisible(s) dans ${dossier} : ${illisibles.join(", ")}.`);
  const chemin = join(dossier, "rapport.md");
  fichiers.ecrire(chemin, construireRapport({ meta, resultats, remplaces, jugements, dossier }));
  return chemin;
}

/** --nettoyer <dossier> : supprime par l'administration chaque compte d'essai
 * listé dans comptes.json et pas encore supprimé, puis balaie les comptes des
 * exécutions de cette mesure par leur adresse ; met à jour comptes.json,
 * mesure.json et le rapport. Aucun appel payant. */
export async function nettoyerDossier(dossier: string, ports: PortsMesure, jugements: EtatJugements): Promise<{ supprimes: number; restes: number }> {
  const texteMeta = ports.lire(join(dossier, "mesure.json"));
  let meta: MetaMesure | null = null;
  try {
    meta = texteMeta === null ? null : (JSON.parse(texteMeta) as MetaMesure);
  } catch {
    meta = null;
  }
  const cheminComptes = join(dossier, FICHIER_COMPTES);
  if (ports.lire(cheminComptes) === null && meta === null) {
    throw new ErreurMesure(`Ni ${FICHIER_COMPTES} ni mesure.json dans ${dossier} : rien à nettoyer ici. Pour un compte d'essai laissé ailleurs : pnpm --filter backend nettoyer-comptes-test-dev (liste, puis --supprimer).`);
  }
  const suivi = new SuiviComptes(cheminComptes, "", ports, true);
  const executions = new Set([...suivi.executions(), ...[meta, ...(meta?.precedentes ?? [])].flatMap((m) => (m?.execution ? [m.execution] : []))]);
  ports.afficher(`Nettoyage de ${dossier} : comptes d'essai sur ${DEV_PROJECT_NAME}, par l'administration (aucun appel payant).`);
  for (const compte of suivi.aSupprimer(null)) {
    const supprime = await ports.supprimerCompte(compte, null).catch(() => false);
    suivi.marquer(compte.id, supprime);
    ports.afficher(`  ${supprime ? "✓" : "⚠"} ${compte.email} : ${supprime ? "supprimé" : "NON supprimé"}`);
  }
  for (const execution of executions) {
    try {
      for (const compte of await ports.comptesDeLExecution(execution)) {
        if (suivi.etatDe(compte.id) === "reste") continue;
        suivi.ajouter(compte, execution);
        const supprime = await ports.supprimerCompte({ ...compte, jeton: null }, null).catch(() => false);
        suivi.marquer(compte.id, supprime);
        ports.afficher(`  ${supprime ? "✓" : "⚠"} ${compte.email} (trouvé par son adresse) : ${supprime ? "supprimé" : "NON supprimé"}`);
      }
    } catch {
      ports.afficher(`  ⚠ Balayage des comptes ${PREFIXE_COMPTE}${execution}-… impossible (spotto-dev-2 injoignable ?) : relancer plus tard.`);
    }
  }
  const bilan = suivi.bilan(null);
  ports.afficher(`Comptes d'essai de cette mesure : ${bilan.supprimes}/${bilan.comptes} supprimés${bilan.restes.length > 0 ? ` — ⚠ restent : ${bilan.restes.join(", ")}` : ""}.`);
  if (meta) {
    meta.nettoyage = suivi.bilan(meta.execution ?? null);
    for (const precedente of meta.precedentes ?? []) if (precedente.execution) precedente.nettoyage = suivi.bilan(precedente.execution);
    if (meta.arret === ARRET_COUPURE) meta.arret = "coupure brutale : l'outil s'est arrêté sans finir ; comptes d'essai repris ensuite par --nettoyer";
    if (bilan.comptes > 0) meta.avertissements = [...meta.avertissements, `comptes d'essai repris par --nettoyer le ${dateDeParis(new Date(ports.maintenant()).toISOString())}`];
    ports.ecrire(join(dossier, "mesure.json"), `${JSON.stringify(meta, null, 2)}\n`);
    const chemin = refaireRapport(dossier, jugements, { lire: (c) => ports.lire(c), lister: (d) => ports.lister(d), ecrire: (c, t) => ports.ecrire(c, t) });
    ports.afficher(`Rapport refait, sans aucun appel : ${chemin}`);
  }
  return { supprimes: bilan.supprimes, restes: bilan.restes.length };
}
