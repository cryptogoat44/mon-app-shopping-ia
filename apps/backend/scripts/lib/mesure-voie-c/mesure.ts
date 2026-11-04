// Mesure de la voie C : le déroulé. Contrôles gratuits et plan d'abord ; puis,
// sans --confirmer, l'essai à blanc (aucun appel payant) ; avec, la mesure
// réelle, cas par cas, par le parcours HTTP de l'app. Comptes d'essai
// supprimés et serveur local arrêté à la fin, même après une erreur ou un
// Ctrl-C. Tout ce qui parle au monde passe par des PORTS (reel.ts) : les tests
// les remplacent par des faux (tests/mesureVoieC.test.ts).
import { join } from "node:path";
import type { CropRect } from "@monapp/shared-types";
import { DEV_PROJECT_NAME } from "../dev-database.js";
import { CAS_PAR_COMPTE, CREDITS_PAR_CAS, GardeBudget, lignesDuPlan, plafondsServeur, planMesure, type Compteurs, type Plan } from "./budget.js";
import { CLE_SERPAPI_A_BLANC, environnementServeur, verifierSpottoDev2, type OptionsMesure } from "./environnement.js";
import { cadreEnProportions, ErreurMesure, IMAGE_ENTIERE, motsDeLApp, nomCas, type CasVerite, type JeuCharge } from "./jeu-de-verite.js";
import { jugeDuCas, jugerListe, type EtatJugements } from "./jugement.js";
import { construireRapport } from "./rapport.js";
import { codeErreur, creditsDuCas, lireReponse, resumerJournal, type LigneJournal, type LigneRecherche, type MetaMesure, type Passe, type ResultatCas } from "./resultats.js";

/** main en ligne quand cet outil a été écrit : le serveur mesuré doit en avoir le même code. */
export const COMMIT_MAIN = "9ad5420";
/** Réponse attendue de la sonde gratuite quand la voie C est en service (recherche pas encore lancée). */
const SONDE_VOIE_C_ATTENDUE = "text_search_not_allowed";
/** Deux pannes de Lens de suite : arrêt net (le service va mal, inutile de dépenser). */
const PANNES_DE_SUITE_MAX = 2;

export interface ServeurLocal {
  url: string;
  /** Lignes de mesure du serveur, dans l'ordre (resultats.ts, lireLigneJournal). */
  journal: LigneJournal[];
  arreter(): Promise<void>;
}

export interface CompteEssai {
  numero: number;
  id: string;
  /** Jeton de session : jamais affiché ni écrit. */
  jeton: string;
}

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
  etatLens(): Promise<string>;
  /** null : clé acceptée et modèle disponible ; sinon la raison. Gratuit (liste des modèles). */
  verifierCleAnthropic(cle: string): Promise<string | null>;
  /** Compteurs de spotto-dev-2 (lecture seule, rien n'est réservé). */
  lireCompteurs(): Promise<Compteurs>;
  portLibre(): Promise<number>;
  demarrerServeur(env: Record<string, string>): Promise<ServeurLocal>;
  creerCompte(numero: number): Promise<CompteEssai>;
  /** Supprime le compte et ses recherches ; vrai si plus rien ne reste. */
  supprimerCompte(compte: CompteEssai, serveur: ServeurLocal | null): Promise<boolean>;
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
  /** À Ctrl-C : `action`, puis fin du programme. Rend de quoi annuler. */
  surInterruption(action: () => Promise<void>): () => void;
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
  /** Dossier de cette mesure (le sous-dossier daté des sorties). */
  dossierSortie: string;
  /** Fichier .env inexistant, donné au serveur local (DOTENV_CONFIG_PATH). */
  envAbsent: string;
  /** Les cadres viennent-ils du fichier tracé par Claude le 30 octobre (emplacement par défaut) ? */
  cadresTracesParClaude: boolean;
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

/** Les passes demandées : une seule, ou avec vos mots puis sans (--les-deux). */
export function passesDe(mots: OptionsMesure["mots"]): Passe[] {
  return mots === "les-deux" ? ["avec-mots", "sans-mots"] : ["unique"];
}

/** Envoie-t-on vos mots dans cette passe ? */
function avecMots(mots: OptionsMesure["mots"], passe: Passe): boolean {
  return passe === "avec-mots" || (passe === "unique" && mots === "avec");
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

/** Contrôles préalables, gratuits : base, jeu de vérité, cadres, page d'état
 * de SerpApi, clé d'essai d'Anthropic ; puis le plan. */
async function controler(entree: EntreeMesure, ports: PortsMesure): Promise<{ jeu: JeuCharge; plan: Plan; etatLens: string; cle: string | null; avertissements: string[] }> {
  const { options } = entree;
  const url = verifierSpottoDev2(entree.environnement);
  ports.afficher("Contrôles préalables (gratuits) :");
  ports.afficher(`  ✓ apps/backend/.env vise ${DEV_PROJECT_NAME} (${url.hostname}).`);
  const avertissements: string[] = [];
  const { commit, identiqueAMain } = entree.depot;
  if (identiqueAMain === true) ports.afficher(`  ✓ Serveur : commit ${commit}, code du serveur identique à main en ligne (${COMMIT_MAIN}).`);
  else {
    const ecart = identiqueAMain === false ? `le code du serveur DIFFÈRE de main en ligne (${COMMIT_MAIN})` : `code du serveur non comparé à main en ligne (${COMMIT_MAIN})`;
    avertissements.push(`Serveur : ${ecart}.`);
    ports.afficher(`  ⚠ Serveur : ${ecart}.`);
  }

  const jeu = entree.chargerJeu();
  const visibles = jeu.cas.filter((c) => c.marqueVisible).length;
  const avecCadre = jeu.cas.filter((c) => c.cadre).length;
  ports.afficher(`  ✓ Jeu de vérité : ${jeu.cas.length} cas (${visibles} avec marque visible, ${avecCadre} avec « cadre : oui »), toutes les photos présentes.`);
  ports.afficher(`  ✓ Cadres : ${jeu.cadres.size} (${jeu.cheminCadres})${entree.cadresTracesParClaude ? ", tracés par Claude le 30 octobre, à valider par le fondateur" : ""} ; les autres cas en image entière.`);
  for (const ecart of jeu.avertissements) {
    avertissements.push(ecart);
    ports.afficher(`  ⚠ ${ecart}`);
  }
  const tronques = jeu.cas.filter((c) => motsDeLApp(c.mots).tronques).map((c) => c.numero);
  if (options.mots !== "sans" && tronques.length > 0) {
    const note = `Mots coupés à 60 caractères, comme le champ de l'app : cas ${tronques.join(", ")}.`;
    avertissements.push(note);
    ports.afficher(`  ⚠ ${note}`);
  }
  if (entree.jugements.etat === "absent") ports.afficher("  ✓ Jugement du fondateur (jugements.txt) : absent — règle du banc (semblePiece).");
  else if (entree.jugements.etat === "format-a-venir") {
    const note = "jugements.txt existe, mais son format n'est pas encore pris en charge : la règle du banc s'applique ; le rapport pourra être refait sans rien dépenser (--refaire-rapport).";
    avertissements.push(note);
    ports.afficher(`  ⚠ ${note}`);
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

  const plan = planMesure(jeu.cas.length, { lesDeux: options.mots === "les-deux", plafond: options.plafond });
  ports.afficher("");
  for (const ligne of lignesDuPlan(plan)) ports.afficher(ligne);
  return { jeu, plan, etatLens, cle, avertissements };
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
  await mesureReelle(entree, ports, { ...controle, cle: controle.cle! });
}

/** Essai à blanc : rien de payant. Le serveur local démarre avec une clé
 * SerpApi INVALIDE et sans clé d'Anthropic ; un compte d'essai est créé, UNE
 * recherche est préparée (gratuit : routes/searches.ts, « prepare » n'appelle
 * aucun fournisseur), la sonde gratuite de la voie C est faite, puis tout est
 * supprimé. Aucun lancement. */
async function essaiABlanc(entree: EntreeMesure, ports: PortsMesure, controle: Awaited<ReturnType<typeof controler>>): Promise<void> {
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
  let serveur: ServeurLocal | null = null;
  let compte: CompteEssai | null = null;
  let nettoye = false;
  const nettoyer = async () => {
    if (nettoye) return;
    nettoye = true;
    if (compte) ports.afficher(`  ${(await ports.supprimerCompte(compte, serveur).catch(() => false)) ? "✓ Compte d'essai supprimé" : "⚠ Compte d'essai NON supprimé : pnpm --filter backend nettoyer-comptes-test-dev"}.`);
    await serveur?.arreter().catch(() => undefined);
  };
  const oublier = ports.surInterruption(nettoyer);
  try {
    serveur = await ports.demarrerServeur(env);
    ports.afficher(`  ✓ Serveur local démarré (${serveur.url}), voie C allumée pour lui seul, clé SerpApi invalide (rien ne peut partir).`);
    compte = await ports.creerCompte(1);
    ports.afficher("  ✓ Compte d'essai créé sur spotto-dev-2.");
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
  ports.afficher("Essai à blanc terminé : aucun crédit dépensé, aucun appel à l'IA.");
  ports.afficher("Pour la mesure réelle, après l'accord écrit du fondateur : la même commande, avec --confirmer.");
}

interface EtatMesure {
  resultats: ResultatCas[];
  comptes: CompteEssai[];
  serveur: ServeurLocal | null;
  meta: MetaMesure;
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
 * les lignes de mesure du serveur. */
async function mesurerCas(prepare: CasPrepare, passe: Passe, envoiMots: boolean, compte: CompteEssai, serveur: ServeurLocal, ports: PortsMesure): Promise<ResultatCas> {
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
  resultat.credits = incertain ? { ...credits, total: Math.max(credits.total, CREDITS_PAR_CAS), estime: true } : credits;
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
  return `${debut} Lens ${r.propositions.lens.length} (${prix(r.propositions.lens)} avec prix) · complément ${r.reponse?.complement?.status ?? "aucun"}, ${r.propositions.boutiques.length} boutique(s) (${prix(
    r.propositions.boutiques
  )} avec prix) · bonne pièce : Lens ${place(lens.premiere)}, boutiques ${place(boutiques.premiere)} · ${duree} · ${credits}`;
}

/** La mesure réelle (avec --confirmer). */
async function mesureReelle(entree: EntreeMesure, ports: PortsMesure, controle: Awaited<ReturnType<typeof controler>> & { cle: string }): Promise<void> {
  const { options } = entree;
  const { jeu, plan } = controle;
  const dossier = entree.dossierSortie;
  ports.afficher("");
  ports.afficher(`Mesure réelle (--confirmer). Sorties : ${dossier}`);
  const prepares = await preparerCas(jeu, dossier, ports);

  const compteursAvant = await ports.lireCompteurs();
  const plafonds = plafondsServeur(compteursAvant, plan.creditsAuPlus);
  const etat: EtatMesure = {
    resultats: [],
    comptes: [],
    serveur: null,
    meta: {
      version: 1,
      debut: new Date(ports.maintenant()).toISOString(),
      fin: null,
      serveur: { ...entree.depot, commitMain: COMMIT_MAIN },
      jeu: jeu.dossier,
      cadres: { chemin: jeu.cheminCadres, nombre: jeu.cadres.size, tracesParClaude: entree.cadresTracesParClaude },
      mots: options.mots,
      plan,
      plafondsServeur: plafonds,
      etatLens: controle.etatLens,
      compteurs: { avant: compteursAvant, entrePasses: null, apres: null },
      arret: null,
      nettoyage: { comptes: 0, supprimes: 0, restes: [] },
      avertissements: controle.avertissements,
    },
  };
  ports.afficher(`  Compteurs de ${DEV_PROJECT_NAME} avant : ${compteursAvant.jour} appel(s) aujourd'hui, ${compteursAvant.mois} ce cycle.`);
  ports.afficher(`  Plafonds du serveur local : ${plafonds.SERPAPI_DAILY_CAP} par jour, ${plafonds.SERPAPI_MONTHLY_CAP} par cycle, ${plafonds.SERPAPI_USER_DAILY_CAP} photos par compte.`);

  let fini: Promise<void> | null = null;
  const finaliser = () =>
    (fini ??= (async () => {
      etat.meta.nettoyage.comptes = etat.comptes.length;
      for (const compte of etat.comptes) {
        if (await ports.supprimerCompte(compte, etat.serveur).catch(() => false)) etat.meta.nettoyage.supprimes += 1;
        else etat.meta.nettoyage.restes.push(compte.id);
      }
      await etat.serveur?.arreter().catch(() => undefined);
      etat.meta.compteurs.apres = await ports.lireCompteurs().catch(() => null);
      etat.meta.fin = new Date(ports.maintenant()).toISOString();
      ports.ecrire(join(dossier, "mesure.json"), `${JSON.stringify(etat.meta, null, 2)}\n`);
      ports.ecrire(join(dossier, "rapport.md"), construireRapport({ meta: etat.meta, resultats: etat.resultats, jugements: entree.jugements }));
      const credits = etat.resultats.reduce((somme, r) => somme + r.credits.total, 0);
      ports.afficher("");
      ports.afficher(`Comptes d'essai supprimés : ${etat.meta.nettoyage.supprimes}/${etat.meta.nettoyage.comptes}${etat.meta.nettoyage.restes.length > 0 ? ` — ⚠ restent : ${etat.meta.nettoyage.restes.join(", ")} (pnpm --filter backend nettoyer-comptes-test-dev)` : ""}.`);
      ports.afficher(`Crédits SerpApi dépensés : ${credits} (plafond ${plan.plafond}).${etat.meta.arret ? ` Arrêt : ${etat.meta.arret}.` : ""}`);
      ports.afficher(`Rapport : ${join(dossier, "rapport.md")}`);
    })());
  const oublier = ports.surInterruption(async () => {
    etat.meta.arret ??= "interrompue (Ctrl-C)";
    await finaliser();
  });

  const garde = new GardeBudget(plan.plafond);
  const comptesParPasse = new Map<string, CompteEssai>();
  const compteDe = async (passe: Passe, index: number): Promise<CompteEssai> => {
    const cle = `${passe}-${Math.floor(index / CAS_PAR_COMPTE)}`;
    let compte = comptesParPasse.get(cle);
    if (!compte) {
      compte = await ports.creerCompte(etat.comptes.length + 1);
      etat.comptes.push(compte);
      comptesParPasse.set(cle, compte);
    }
    return compte;
  };

  try {
    const env = environnementServeur(entree.environnement, { port: await ports.portLibre(), cleAnthropic: controle.cle, cleSerpApi: null, plafonds, envAbsent: entree.envAbsent });
    etat.serveur = await ports.demarrerServeur(env);
    const serveur = etat.serveur;
    ports.afficher(`  ✓ Serveur local démarré (${serveur.url}) : voie C et son IA allumées pour lui seul, Sentry coupé, photo vers Anthropic coupée.`);

    // Sonde gratuite : la voie C est-elle en service ? (Sinon, rien à mesurer : arrêt avant toute dépense.)
    const passes = passesDe(options.mots);
    const premier = await compteDe(passes[0]!, 0);
    const preparation = await ports.preparer(serveur, premier);
    if (preparation.id === null) throw new ErreurMesure(`Préparation d'une recherche refusée (${preparation.erreur ?? preparation.statut}) : arrêt avant toute dépense.`);
    const sonde = await ports.sonderVoieC(serveur, premier, preparation.id);
    if (sonde.statut !== 409 || sonde.erreur !== SONDE_VOIE_C_ATTENDUE) {
      throw new ErreurMesure(`La voie C n'est pas en service sur le serveur local (réponse ${sonde.statut}) : interrupteur, ou migration 0028 absente de spotto-dev-2. Arrêt avant toute dépense.`);
    }
    ports.afficher("  ✓ Voie C en service sur le serveur local (sonde gratuite).");

    let pannesDeSuite = 0;
    mesure: for (const passe of passes) {
      ports.afficher("");
      ports.afficher(passe === "unique" ? `Cas par cas (${options.mots === "avec" ? "avec vos mots" : "sans vos mots"}) :` : passe === "avec-mots" ? "Passe 1, avec vos mots :" : "Passe 2, sans vos mots (le cache de 24 h doit la rendre gratuite) :");
      for (const [index, prepare] of prepares.entries()) {
        if (!garde.peutLancer()) {
          etat.meta.arret = `plafond de ${plan.plafond} crédits : le cas ${prepare.cas.numero} aurait pu le dépasser (${garde.depenses} déjà dépensés)`;
          break mesure;
        }
        const compte = await compteDe(passe, index);
        const resultat = await mesurerCas(prepare, passe, avecMots(options.mots, passe), compte, serveur, ports);
        etat.resultats.push(resultat);
        ports.ecrire(join(dossier, nomFichierCas(resultat.cas, passe)), `${JSON.stringify(resultat, null, 2)}\n`);
        garde.compter(resultat.credits.total);
        ports.afficher(ligneTerminal(resultat, entree.jugements, garde));
        if (resultat.http.lancement === 429 || resultat.http.preparation === 429) {
          etat.meta.arret = `le serveur a refusé un lancement (${resultat.erreur ?? "429"}) : plafond ou limite atteints`;
          break mesure;
        }
        const panne = resultat.issue === "panne" || resultat.ligne?.outcome === "failure";
        pannesDeSuite = panne ? pannesDeSuite + 1 : 0;
        if (pannesDeSuite >= PANNES_DE_SUITE_MAX) {
          etat.meta.arret = `${PANNES_DE_SUITE_MAX} pannes de suite (dernière : ${resultat.erreur ?? resultat.ligne?.failure_kind ?? "panne"})`;
          break mesure;
        }
      }
      if (passe === "avec-mots") etat.meta.compteurs.entrePasses = await ports.lireCompteurs().catch(() => null);
    }
  } catch (erreur) {
    etat.meta.arret ??= message(erreur);
    throw erreur;
  } finally {
    await finaliser();
    oublier();
  }
}

/** Refait rapport.md d'une mesure déjà faite, à partir de ses JSON : aucun
 * appel, aucune dépense (règle ou jugement du fondateur changés). */
export function refaireRapport(
  dossier: string,
  jugements: EtatJugements,
  fichiers: { lire(chemin: string): string; lister(dossier: string): string[]; ecrire(chemin: string, contenu: string): void }
): string {
  const meta = JSON.parse(fichiers.lire(join(dossier, "mesure.json"))) as MetaMesure;
  const resultats = fichiers
    .lister(dossier)
    .filter((nom) => /^cas-\d+(-avec-mots|-sans-mots)?\.json$/.test(nom))
    .map((nom) => JSON.parse(fichiers.lire(join(dossier, nom))) as ResultatCas);
  const chemin = join(dossier, "rapport.md");
  fichiers.ecrire(chemin, construireRapport({ meta, resultats, jugements }));
  return chemin;
}
