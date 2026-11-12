// Nouveautés avant lancement — parcours à l'écran, sur le site, en français,
// au format iPhone : une capture par état d'écran, pour relecture.
//
//   pnpm --filter backend parcours-ecran nouveautes          (tout)
//   pnpm --filter backend parcours-ecran nouveautes c f      (seulement ces parties)
//
//   a. Résultats : le tri (Pertinence, prix croissant, prix décroissant) et
//      le filtre « Avec prix seulement » ;
//   b. Envies : recherche (par boutique, sans résultat), tri par prix, total ;
//   c. Messagerie : une conversation entre deux amies, une invitation à une
//      personne qui ne suit pas, une pièce envoyée à une amie depuis un résultat ;
//   d. Collections : une privée, une montrée aux amis, la collection d'une
//      amie et « Garder » ;
//   e. Profil : sans photo (initiales), avec photo et bio, l'icône des
//      Réglages, « Modifier le profil » et le compteur de la bio ;
//   f. Alertes prix et stock : la cloche d'une envie et sa feuille,
//      l'interrupteur des Réglages, « Plus disponible ? » sur un résultat ;
//   g. Modération des profils (administratrice) : retirer la bio ou la photo
//      d'un profil signalé, et ce que la personne en voit.
//
// Trois comptes de test : Louise, Camille (son amie : elles se suivent l'une
// l'autre) et Inès (qui ne suit personne) ; deux de plus pour la partie g : Zoé
// (profil signalé) et Alix (administratrice, ajoutée à la table « admins » de
// spotto-dev-2, comme dans lot-5). Tous ont refusé les statistiques : rien n'est envoyé, et la clé
// PostHog du site est FACTICE. Aucun appel à SerpApi ni à l'IA : la recherche
// est rangée directement, avec des images de notre stockage.
//
// Chaque étape est indépendante (nouveautes-outils.ts) : un échec est
// photographié et noté, les suivantes passent, le bilan est donné à la fin.
//
// Le profil d'une autre personne s'ouvre ici DEPUIS le fil (« Profils »),
// jamais par son adresse : le bouton « Message » et la section « Collections »
// n'apparaissent que si l'app a lu, depuis ses onglets, que la messagerie et
// les collections sont disponibles — une adresse ouverte directement
// recharge le site sans passer par les onglets.
import type { Page } from "playwright-core";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { check } from "./spotter-outils.js";
import {
  aller,
  attendre,
  BIO_AMIE,
  BIO_SIGNALEE,
  Bilan,
  bouton,
  calme,
  COLLECTION_AMIE,
  COLLECTION_AMIS,
  COLLECTION_PRIVEE,
  completerProfil,
  creerCollection,
  demande,
  ENVIES,
  ENVIES_AMIE,
  etape,
  exiger,
  garderEnvies,
  MESSAGES,
  ouvrirConversation,
  photographier,
  rangerRecherche,
  repere,
  RESULTATS,
  type Envie,
  type Recherche,
  type Telephones,
  texte,
  toucher,
  uneFois,
} from "./nouveautes-outils.js";

export const name = "Nouveautés avant lancement — tri, Envies, messagerie, collections, profil, alertes, modération des profils (site)";
export const outputDir = "nouveautes-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const PARTIES = ["a", "b", "c", "d", "e", "f", "g"];

// Textes et libellés de l'app qui servent de repères (apps/mobile/src/i18n/fr.ts),
// jamais ceux qui contiennent le nom du produit (il est configurable).
const T = {
  envies: "Envies",
  profils: "Profils",
  chercherProfil: "Rechercher un profil",
  voirProfil: (nom: string) => `Voir le profil de ${nom}`,
  messages: "Messages",
  champMessage: "Écrire un message…",
  envoyer: "Envoyer",
  invitation: (nom: string) => `Ce premier message est une invitation : ${nom} pourra l'accepter ou la refuser. Vous ne pourrez plus écrire avant sa réponse.`,
  invitationEnvoyee: (nom: string) => `Invitation envoyée. Vous pourrez écrire de nouveau quand ${nom} l'aura acceptée.`,
  accepter: "Accepter",
  invitationAcceptee: "Invitation acceptée",
  envoyerDans: "Envoyer dans…",
  pieceJointe: /^Pièce jointe : /,
  pieceEnvoyee: (nom: string) => `Pièce envoyée à ${nom}`,
  privee: "Privée : vous seul la voyez.",
  visibleAmis: "Visible par vos amis (les membres que vous suivez et qui vous suivent).",
  puceAmis: (nom: string) => `${nom}, visible par vos amis`,
  mesAmis: "Mes amis",
  garder: (titre: string) => `Garder ${titre} dans mes Envies`,
  gardee: "Ajoutée à vos Envies",
  modifierProfil: "Modifier le profil",
  bio: "Bio",
  enregistrer: "Enregistrer",
  profilMisAJour: "Profil mis à jour",
  changerPhoto: "Changer la photo de profil",
  photoDeProfil: "Photo de profil",
  reglages: "Réglages",
  alertePiece: "Alerte pour cette pièce",
  baisseDePrix: "Baisse de prix",
  alerteEnregistree: "Alerte enregistrée",
  interrupteurAlertes: "Recevoir les alertes prix et stock de vos envies",
  alertesActivees: /^Activées : .+ cloche\.$/,
  alertesCoupees: "Désactivées : aucune alerte ne vous est envoyée. Pour suivre une envie, touchez sa cloche.",
  plusDisponibleTitre: "Cette pièce n'est plus disponible ?",
  merciNote: "Merci, c'est noté",
  retirerBio: "Retirer la bio",
  retirerPhoto: "Retirer la photo de profil",
  avertissementBio: /^Retirer la bio de ce profil \?/,
  avertissementPhoto: /^Retirer la photo de ce profil \?/,
  annuler: "Annuler",
  confirmerRetrait: "Confirmer le retrait",
  bioRetiree: "Bio retirée.",
  bioRetireeMembre: "Votre bio a été retirée par la modération.",
};

interface Donnees {
  louise: TestAccount;
  camille: TestAccount;
  ines: TestAccount;
  /** Préparées une seule fois, par la première étape qui en a besoin. */
  recherche: () => Promise<Recherche>;
  envies: () => Promise<Envie[]>;
  conversation: () => Promise<string>;
  collections: () => Promise<{ titreAmie: string }>;
}

const onglet = (page: Page, nom: string) => page.getByRole("tab", { name: nom, exact: true }).filter({ visible: true });
const titre = (page: Page, nom: string) => page.getByRole("heading", { name: nom, exact: true }).filter({ visible: true });
const champ = (page: Page, nom: string) => page.getByRole("textbox", { name: nom, exact: true }).filter({ visible: true });
/** Interrupteur, cherché comme dans lot-2 (rôle et libellé). */
const interrupteur = (page: Page, nom: string) => page.getByRole("switch", { name: nom, exact: true });
/** Segment de tri ou filtre coché (sur le site, l'état passe par aria-checked). */
const coche = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"][aria-checked="true"]`).filter({ visible: true });

/** Profil → onglet « Envies » : recherche, tri, total, puces des collections, cloches. */
async function ouvrirEnvies(p: Parcours, page: Page): Promise<void> {
  await aller(p, page, "/profile", "l'onglet « Envies » du profil", onglet(page, T.envies));
  await toucher(page, "l'onglet « Envies » du profil", onglet(page, T.envies));
  await attendre(page, "les outils des Envies (recherche, tri, total)", repere(page, "outils-envies"));
  await calme(page);
}

/** Le profil d'une autre personne, ouvert depuis le fil (voir l'en-tête) : « Profils », recherche, son nom. */
async function ouvrirProfilDe(p: Parcours, page: Page, membre: TestAccount): Promise<void> {
  await aller(p, page, "/feed", "le bouton « Profils » du fil", bouton(page, T.profils));
  await toucher(page, "le bouton « Profils » du fil", bouton(page, T.profils));
  await attendre(page, "le champ « Rechercher un profil »", champ(page, T.chercherProfil));
  await champ(page, T.chercherProfil).fill(membre.username);
  const lien = page.getByRole("link", { name: T.voirProfil(membre.displayName), exact: true }).filter({ visible: true });
  await toucher(page, `${membre.displayName} dans les profils trouvés`, lien);
  await attendre(page, `le profil de ${membre.displayName}`, texte(page, `@${membre.username}`));
  await calme(page);
}

/** Activité → « Messages » → la conversation `id`. */
async function ouvrirConversationDepuisActivite(p: Parcours, page: Page, id: string, avec: string): Promise<void> {
  await aller(p, page, "/activite", "l'entrée « Messages » de l'Activité", repere(page, "entree-messages"));
  await toucher(page, "l'entrée « Messages » de l'Activité", repere(page, "entree-messages"));
  await toucher(page, `la conversation avec ${avec} dans la liste`, repere(page, `conversation-${id}`));
}

async function ouvrirResultats(p: Parcours, page: Page, recherche: Recherche): Promise<void> {
  await aller(p, page, `/spot/result?searchId=${recherche.searchId}`, "l'écran des résultats (barre de tri)", repere(page, "result-sort-bar"));
  await attendre(page, `la proposition « ${RESULTATS[0]!.nom} »`, texte(page, RESULTATS[0]!.nom));
  await calme(page);
}

// ---------- a. Résultats : tri et filtre ----------

async function resultatsTriEtFiltre(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  const recherche = await d.recherche();
  const page = await telephones.connecter(d.louise);
  await ouvrirResultats(p, page, recherche);
  await attendre(page, "« Pertinence » sélectionné", coche(page, "sort-relevance"));
  await photographier(p, page, "a-01-resultats-pertinence");
  for (const [testId, nom, capture] of [
    ["sort-price_asc", "Prix croissant", "a-02-resultats-prix-croissant"],
    ["sort-price_desc", "Prix décroissant", "a-03-resultats-prix-decroissant"],
  ] as const) {
    await toucher(page, `le tri « ${nom} »`, repere(page, testId));
    await attendre(page, `« ${nom} » sélectionné`, coche(page, testId));
    await photographier(p, page, capture);
  }
  await toucher(page, "le filtre « Avec prix seulement »", repere(page, "with-price-only"));
  await attendre(page, "« Avec prix seulement » coché", coche(page, "with-price-only"));
  await photographier(p, page, "a-04-resultats-avec-prix-seulement");
}

// ---------- b. Envies : recherche, tri par prix, total ----------

async function enviesRechercheTriTotal(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await d.envies();
  const page = await telephones.connecter(d.louise);
  await ouvrirEnvies(p, page);
  const total = repere(page, "total-envies");
  await attendre(page, "la ligne du total (« N envies · total … »)", total.filter({ hasText: /· total / }));
  await photographier(p, page, "b-01-envies-recherche-tri-total");

  await repere(page, "recherche-envies").first().fill("atelier");
  await attendre(page, "le total des envies trouvées pour « atelier »", total.filter({ hasText: /trouvées? · / }));
  await photographier(p, page, "b-02-envies-recherche-par-boutique");

  await repere(page, "recherche-envies").first().fill("zzzz");
  await attendre(page, "le message « Aucune envie ne correspond »", repere(page, "recherche-envies-vide"));
  await photographier(p, page, "b-03-envies-recherche-sans-resultat");
  await toucher(page, "la croix « Effacer la recherche »", repere(page, "effacer-recherche-envies"));

  for (const [testId, nom, capture] of [
    ["tri-envies-price_asc", "Prix croissant", "b-04-envies-prix-croissant"],
    ["tri-envies-price_desc", "Prix décroissant", "b-05-envies-prix-decroissant"],
  ] as const) {
    await toucher(page, `le tri « ${nom} » des envies`, repere(page, testId));
    await attendre(page, `« ${nom} » sélectionné`, coche(page, testId));
    await photographier(p, page, capture);
  }
}

// ---------- c. Messagerie ----------

async function conversationEntreAmies(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "messagerie");
  const conversation = await d.conversation();
  const page = await telephones.connecter(d.louise);
  await aller(p, page, "/activite", "l'entrée « Messages » de l'Activité", repere(page, "entree-messages"));
  await photographier(p, page, "c-01-activite-entree-messages");
  await toucher(page, "l'entrée « Messages » de l'Activité", repere(page, "entree-messages"));
  await attendre(page, `la conversation avec ${d.camille.displayName} dans la liste`, repere(page, `conversation-${conversation}`));
  await photographier(p, page, "c-02-messages-liste");
  await toucher(page, `la conversation avec ${d.camille.displayName}`, repere(page, `conversation-${conversation}`));
  await attendre(page, "le dernier message de Camille", texte(page, MESSAGES.camille2));
  await photographier(p, page, "c-03-conversation-entre-amies");

  await champ(page, T.champMessage).fill(MESSAGES.reponse);
  await toucher(page, "le bouton « Envoyer »", bouton(page, T.envoyer));
  await attendre(page, "le message envoyé, dans la conversation", texte(page, MESSAGES.reponse));
  await photographier(p, page, "c-04-conversation-message-envoye");
}

async function invitationSansAbonnement(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "messagerie");
  const louise = await telephones.connecter(d.louise);
  await ouvrirProfilDe(p, louise, d.ines);
  await attendre(louise, "le bouton « Message » du profil", repere(louise, "bouton-message"));
  await photographier(p, louise, "c-05-profil-bouton-message");
  await toucher(louise, "le bouton « Message » du profil", repere(louise, "bouton-message"));
  await attendre(louise, "l'explication « Ce premier message est une invitation »", texte(louise, T.invitation(d.ines.displayName)));
  await champ(louise, T.champMessage).fill(MESSAGES.invitation);
  await photographier(p, louise, "c-06-invitation-avant-envoi");
  await toucher(louise, "le bouton « Envoyer »", bouton(louise, T.envoyer));
  await attendre(louise, "« Invitation envoyée. Vous pourrez écrire de nouveau… »", texte(louise, T.invitationEnvoyee(d.ines.displayName)));
  await photographier(p, louise, "c-07-invitation-envoyee");

  // Inès : l'invitation est rangée à part, elle l'accepte.
  const ines = await telephones.connecter(d.ines);
  await aller(p, ines, "/activite", "l'entrée « Messages » de l'Activité (Inès)", repere(ines, "entree-messages"));
  await toucher(ines, "l'entrée « Messages » de l'Activité (Inès)", repere(ines, "entree-messages"));
  await attendre(ines, "la section « Invitations » d'Inès", repere(ines, "invitations"));
  await photographier(p, ines, "c-08-invitation-recue");
  await toucher(ines, "l'invitation de Louise", repere(ines, "invitations").getByRole("button"));
  await attendre(ines, "les boutons « Accepter », « Refuser », « Bloquer »", bouton(ines, T.accepter));
  await photographier(p, ines, "c-09-invitation-accepter-ou-refuser");
  await toucher(ines, "le bouton « Accepter »", bouton(ines, T.accepter));
  await attendre(ines, "« Invitation acceptée »", texte(ines, T.invitationAcceptee));
  await photographier(p, ines, "c-10-invitation-acceptee");
}

async function pieceEnvoyeeDepuisResultat(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "messagerie");
  const [recherche, conversation] = [await d.recherche(), await d.conversation()];
  const louise = await telephones.connecter(d.louise);
  await ouvrirResultats(p, louise, recherche);
  await attendre(louise, "le lien « Envoyer à un ami » sous la proposition", repere(louise, "envoyer-a-un-ami"));
  await photographier(p, louise, "c-11-resultat-envoyer-a-un-ami", repere(louise, "envoyer-a-un-ami"));
  await toucher(louise, "le lien « Envoyer à un ami »", repere(louise, "envoyer-a-un-ami"));
  await attendre(louise, "l'écran « Envoyer dans… »", titre(louise, T.envoyerDans));
  await attendre(louise, `la conversation avec ${d.camille.displayName} à choisir`, repere(louise, `conversation-${conversation}`));
  await photographier(p, louise, "c-12-choisir-la-conversation");
  await toucher(louise, `la conversation avec ${d.camille.displayName}`, repere(louise, `conversation-${conversation}`));
  await attendre(louise, "la pièce jointe au-dessus du champ (« Pièce jointe : … »)", texte(louise, T.pieceJointe));
  await photographier(p, louise, "c-13-piece-jointe-avant-envoi");
  await toucher(louise, "le bouton « Envoyer »", bouton(louise, T.envoyer));
  await attendre(louise, `« Pièce envoyée à ${d.camille.displayName} »`, texte(louise, T.pieceEnvoyee(d.camille.displayName)));
  await photographier(p, louise, "c-14-piece-envoyee");

  // Camille : la pièce est dans la conversation, avec son image (une copie dans notre stockage).
  const camille = await telephones.connecter(d.camille);
  await ouvrirConversationDepuisActivite(p, camille, conversation, d.louise.displayName);
  await attendre(camille, "la carte de la pièce reçue par Camille", repere(camille, "carte-envie"));
  await photographier(p, camille, "c-15-piece-recue-par-l-amie", repere(camille, "carte-envie"));
}

// ---------- d. Collections ----------

async function collectionsPriveeEtAmis(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "collections");
  await d.collections();
  const page = await telephones.connecter(d.louise);
  await ouvrirEnvies(p, page);
  await attendre(page, `la puce de la collection « ${COLLECTION_PRIVEE} »`, onglet(page, COLLECTION_PRIVEE));
  await photographier(p, page, "d-01-envies-puces-des-collections");
  await toucher(page, `la puce « ${COLLECTION_PRIVEE} »`, onglet(page, COLLECTION_PRIVEE));
  await attendre(page, "« Privée : vous seul la voyez. »", texte(page, T.privee));
  await calme(page);
  await photographier(p, page, "d-02-collection-privee");

  // « Mes amis » demande une confirmation, qui dit ce que les amis verront ; on ne confirme pas.
  await toucher(page, "le bouton « Gérer »", repere(page, "gerer-collection"));
  await toucher(page, "le choix « Mes amis »", page.getByRole("radio", { name: T.mesAmis, exact: true }).filter({ visible: true }));
  await attendre(page, "la confirmation « Montrer cette collection à vos amis ? »", repere(page, "confirmer-amis"));
  await photographier(p, page, "d-03-montrer-aux-amis-confirmation", repere(page, "confirmer-amis"));

  // Le site est rechargé : la feuille se ferme, la collection est restée privée.
  await ouvrirEnvies(p, page);
  await toucher(page, `la puce « ${COLLECTION_AMIS} » (visible par vos amis)`, onglet(page, T.puceAmis(COLLECTION_AMIS)));
  await attendre(page, "« Visible par vos amis… »", texte(page, T.visibleAmis));
  await calme(page);
  await photographier(p, page, "d-04-collection-visible-par-les-amis");
  await toucher(page, "le bouton « Gérer »", repere(page, "gerer-collection"));
  await attendre(page, "la feuille de la collection (« Qui la voit »)", page.getByRole("radio", { name: T.mesAmis, exact: true }).filter({ visible: true }));
  await photographier(p, page, "d-05-gerer-la-collection");
}

async function collectionAmieEtGarder(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "collections");
  const { titreAmie } = await d.collections();
  const page = await telephones.connecter(d.louise);
  await ouvrirProfilDe(p, page, d.camille);
  await attendre(page, `la section « Collections » du profil de ${d.camille.displayName}`, repere(page, "collections-ami"));
  await photographier(p, page, "d-06-profil-amie-collections", repere(page, "collections-ami"));
  await toucher(page, `la collection « ${COLLECTION_AMIE} » de ${d.camille.displayName}`, bouton(page, new RegExp(`^${COLLECTION_AMIE}, \\d+ envies?$`)));
  await attendre(page, `l'envie « ${titreAmie} » de la collection`, bouton(page, T.garder(titreAmie)));
  await calme(page);
  await photographier(p, page, "d-07-collection-d-une-amie");
  await toucher(page, `« Garder » sur « ${titreAmie} »`, bouton(page, T.garder(titreAmie)));
  await attendre(page, "« Ajoutée à vos Envies »", texte(page, T.gardee));
  await photographier(p, page, "d-08-garder-dans-mes-envies");
}

// ---------- e. Profil ----------

async function profil(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  const page = await telephones.connecter(d.louise);
  const monProfil = bouton(page, T.modifierProfil);
  await aller(p, page, "/profile", "le profil de Louise", monProfil);
  await attendre(page, "les initiales à la place de la photo", repere(page, "avatar-initiales"));
  await photographier(p, page, "e-01-profil-sans-photo-initiales");

  const bio = "Je collectionne les belles vestes.";
  await completerProfil(p, d.louise, bio, "#7A8B6F");
  await aller(p, page, "/profile", "la bio de Louise sur son profil", texte(page, bio));
  await photographier(p, page, "e-02-profil-avec-photo-et-bio");

  await toucher(page, "l'icône des Réglages, en haut du profil", bouton(page, T.reglages));
  await attendre(page, "l'écran « Réglages »", titre(page, T.reglages));
  await calme(page);
  await photographier(p, page, "e-03-reglages-depuis-l-icone");

  await aller(p, page, "/profile", "le bouton « Modifier le profil »", monProfil);
  await toucher(page, "le bouton « Modifier le profil »", monProfil);
  await attendre(page, "le compteur de la bio", repere(page, "compteur-bio"));
  const nouvelleBio = "Je collectionne les belles vestes, les sacs qui durent et les adresses qu'on se passe entre amies.";
  await champ(page, T.bio).fill(nouvelleBio);
  await attendre(page, `le compteur à ${nouvelleBio.length}/160`, repere(page, "compteur-bio").filter({ hasText: `${nouvelleBio.length}/160` }));
  await photographier(p, page, "e-04-modifier-le-profil-compteur-bio", repere(page, "compteur-bio"));
  await toucher(page, "le bouton « Enregistrer »", bouton(page, T.enregistrer));
  await attendre(page, "« Profil mis à jour »", texte(page, T.profilMisAJour));
  await photographier(p, page, "e-05-profil-mis-a-jour");

  // En dernier : la feuille reste ouverte (rien d'autre à toucher derrière elle).
  await toucher(page, "la photo du profil (« Changer la photo de profil »)", bouton(page, T.changerPhoto));
  await attendre(page, "la feuille « Photo de profil »", titre(page, T.photoDeProfil));
  await photographier(p, page, "e-06-photo-de-profil-choix");
}

// ---------- f. Alertes prix et stock ----------

async function clocheEtFeuille(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "alertes");
  await d.envies();
  const page = await telephones.connecter(d.louise);
  await ouvrirEnvies(p, page);
  await attendre(page, "la cloche sur une envie", repere(page, "cloche-envie"));
  await photographier(p, page, "f-01-envies-cloches");
  await toucher(page, "la cloche de la première envie", repere(page, "cloche-envie"));
  await attendre(page, "la feuille « Alerte pour cette pièce »", titre(page, T.alertePiece));
  await photographier(p, page, "f-02-cloche-feuille");
  await toucher(page, "l'interrupteur « Baisse de prix »", interrupteur(page, T.baisseDePrix));
  await photographier(p, page, "f-03-cloche-baisse-de-prix-choisie");
  await toucher(page, "le bouton « Enregistrer » de la feuille", repere(page, "enregistrer-alerte"));
  await attendre(page, "« Alerte enregistrée »", texte(page, T.alerteEnregistree));
  await photographier(p, page, "f-04-alerte-enregistree");
}

async function interrupteurDesReglages(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "alertes");
  // Allumé d'avance par le serveur local : l'étape ne dépend pas de la précédente.
  await demande(p, d.louise, "PUT", "/api/alerts/settings", { enabled: true }, "interrupteur « Alertes prix et stock » allumé");
  const page = await telephones.connecter(d.louise);
  const alertes = interrupteur(page, T.interrupteurAlertes);
  await aller(p, page, "/settings", "l'interrupteur « Alertes prix et stock » des Réglages", alertes);
  await attendre(page, "« Activées : … »", texte(page, T.alertesActivees));
  await photographier(p, page, "f-05-reglages-alertes-activees", alertes);
  await toucher(page, "l'interrupteur « Alertes prix et stock »", alertes);
  await attendre(page, "« Désactivées : aucune alerte ne vous est envoyée… »", texte(page, T.alertesCoupees));
  await photographier(p, page, "f-06-reglages-alertes-desactivees", alertes);
}

async function plusDisponible(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  await exiger(p, d.louise, "alertes");
  const recherche = await d.recherche();
  const page = await telephones.connecter(d.louise);
  await ouvrirResultats(p, page, recherche);
  await attendre(page, "le lien « Plus disponible ? » sous la proposition", repere(page, "plus-disponible"));
  await photographier(p, page, "f-07-resultat-plus-disponible", repere(page, "plus-disponible"));
  await toucher(page, "le lien « Plus disponible ? »", repere(page, "plus-disponible"));
  await attendre(page, "la feuille « Cette pièce n'est plus disponible ? »", titre(page, T.plusDisponibleTitre));
  await photographier(p, page, "f-08-plus-disponible-confirmation");
  await toucher(page, "le bouton « Oui, plus disponible »", repere(page, "confirmer-plus-disponible"));
  await attendre(page, "« Merci, c'est noté »", texte(page, T.merciNote));
  await photographier(p, page, "f-09-plus-disponible-note");
}

// ---------- g. Modération des profils ----------

async function moderationDesProfils(p: Parcours, d: Donnees, telephones: Telephones): Promise<void> {
  // Comptes propres à l'étape : Zoé (bio et photo, signalée par Camille) et Alix, administratrice.
  const zoe = await p.createAccount("zoe", "Zoé (test)", { settled: true });
  const alix = await p.createAccount("alix", "Alix (test)", { settled: true });
  check(!(await p.admin.from("admins").insert({ user_id: alix.id })).error, "préparation — rôle d'administratrice d'Alix (spotto-dev-2)");
  await completerProfil(p, zoe, BIO_SIGNALEE, "#5B1F28");
  await demande(p, d.camille, "POST", "/api/reports", { targetType: "user", targetId: zoe.id, reason: "spam" }, "signalement du profil de Zoé par Camille");

  const page = await telephones.connecter(alix);
  const carte = repere(page, `moderation-user-${zoe.id}`);
  await aller(p, page, "/moderation", "le profil de Zoé dans la file « À traiter »", carte);
  const dansLaCarte = (nom: string) => carte.getByRole("button", { name: nom, exact: true });
  await attendre(page, "« Retirer la bio » et « Retirer la photo de profil » (migration 0037 appliquée sur la base de test ?)", dansLaCarte(T.retirerBio));
  await photographier(p, page, "g-01-moderation-profil-signale", carte);

  await toucher(page, "le bouton « Retirer la photo de profil »", dansLaCarte(T.retirerPhoto));
  await attendre(page, "l'avertissement « Retirer la photo de ce profil ? »", texte(page, T.avertissementPhoto));
  await photographier(p, page, "g-02-retirer-la-photo-avertissement", bouton(page, T.confirmerRetrait));
  // On ne confirme pas : une seule décision par signalement, ce sera la bio.
  await toucher(page, "le bouton « Annuler » de l'avertissement", bouton(page, T.annuler));

  await toucher(page, "le bouton « Retirer la bio »", dansLaCarte(T.retirerBio));
  await attendre(page, "l'avertissement « Retirer la bio de ce profil ? »", texte(page, T.avertissementBio));
  await photographier(p, page, "g-03-retirer-la-bio-avertissement", bouton(page, T.confirmerRetrait));
  await toucher(page, "le bouton « Confirmer le retrait »", bouton(page, T.confirmerRetrait));
  await attendre(page, "« Bio retirée. »", texte(page, T.bioRetiree));
  await photographier(p, page, "g-04-bio-retiree");

  // Zoé est prévenue dans son Activité, avec le motif, sans le nom de l'administratrice.
  const membre = await telephones.connecter(zoe);
  await aller(p, membre, "/activite", "« Votre bio a été retirée par la modération. » dans l'Activité de Zoé", texte(membre, T.bioRetireeMembre));
  await photographier(p, membre, "g-05-activite-bio-retiree");
}

export async function run(p: Parcours): Promise<void> {
  const inconnues = p.args.filter((partie) => !PARTIES.includes(partie));
  check(inconnues.length === 0, `parties inconnues (${inconnues.join(", ")}) : choisissez parmi ${PARTIES.join(", ")}, ou aucune pour tout jouer`);
  const bilan = new Bilan(p.args);

  // Comptes communs : Louise et Camille sont amies (elles se suivent l'une l'autre) ; Inès ne suit personne.
  const louise = await p.createAccount("louise", "Louise (test)", { settled: true });
  const camille = await p.createAccount("camil", "Camille (test)", { settled: true });
  const ines = await p.createAccount("ines", "Inès (test)", { settled: true });
  // Comme le reste des données : préparé par la première étape qui en a besoin
  // (c1, c3, d1, d2), pour qu'un refus ici n'arrête pas les autres parties.
  const amies = uneFois(async () => {
    await demande(p, louise, "POST", `/api/follows/${camille.id}`, undefined, "Louise suit Camille");
    await demande(p, camille, "POST", `/api/follows/${louise.id}`, undefined, "Camille suit Louise");
    // Photo et bio de Camille : pour ses captures ; sans elles, le parcours continue.
    await completerProfil(p, camille, BIO_AMIE, "#6B4A3A").catch((erreur: unknown) => {
      process.stdout.write(`  ⚠ photo et bio de Camille non préparées : ${erreur instanceof Error ? erreur.message : String(erreur)}\n`);
    });
  });
  const envies = uneFois(() => garderEnvies(p, louise, ENVIES, "envie"));
  const d: Donnees = {
    louise,
    camille,
    ines,
    recherche: uneFois(() => rangerRecherche(p, louise)),
    envies,
    conversation: uneFois(async () => {
      await amies();
      return ouvrirConversation(p, louise, camille);
    }),
    collections: uneFois(async () => {
      await amies();
      const mesEnvies = await envies();
      await creerCollection(p, louise, COLLECTION_PRIVEE, mesEnvies.slice(0, 2), false);
      await creerCollection(p, louise, COLLECTION_AMIS, mesEnvies.slice(2, 5), true);
      const enviesAmie = await garderEnvies(p, camille, ENVIES_AMIE, "envie-amie");
      await creerCollection(p, camille, COLLECTION_AMIE, enviesAmie, true);
      return { titreAmie: enviesAmie[0]!.nom };
    }),
  };

  await etape(p, bilan, "a", "Résultats : tri (pertinence, prix croissant, prix décroissant) et « Avec prix seulement »", (t) => resultatsTriEtFiltre(p, d, t));
  await etape(p, bilan, "b", "Envies : recherche, tri par prix, total", (t) => enviesRechercheTriTotal(p, d, t));
  await etape(p, bilan, "c1", "Messagerie : une conversation entre deux amies", (t) => conversationEntreAmies(p, d, t));
  await etape(p, bilan, "c2", "Messagerie : une invitation à une personne qui ne suit pas, puis son acceptation", (t) => invitationSansAbonnement(p, d, t));
  await etape(p, bilan, "c3", "Messagerie : une pièce envoyée à une amie depuis un résultat", (t) => pieceEnvoyeeDepuisResultat(p, d, t));
  await etape(p, bilan, "d1", "Collections : une privée, une montrée aux amis, « Gérer »", (t) => collectionsPriveeEtAmis(p, d, t));
  await etape(p, bilan, "d2", "Collections : la collection d'une amie et « Garder »", (t) => collectionAmieEtGarder(p, d, t));
  await etape(p, bilan, "e", "Profil : initiales, photo et bio, icône des Réglages, compteur de la bio", (t) => profil(p, d, t));
  await etape(p, bilan, "f1", "Alertes : la cloche d'une envie et sa feuille", (t) => clocheEtFeuille(p, d, t));
  await etape(p, bilan, "f2", "Alertes : l'interrupteur « Alertes prix et stock » des Réglages", (t) => interrupteurDesReglages(p, d, t));
  await etape(p, bilan, "f3", "Alertes : « Plus disponible ? » sur un résultat, et sa confirmation", (t) => plusDisponible(p, d, t));
  await etape(p, bilan, "g", "Modération des profils (administratrice) : retirer la bio ou la photo d'un profil signalé", (t) => moderationDesProfils(p, d, t));

  process.stdout.write(`${bilan.resume()}\n`);
  check(bilan.echecs.length === 0, `${bilan.echecs.length} étape(s) en échec (captures ECHEC-… dans docs/${outputDir}/) :\n${bilan.echecs.join("\n")}`);
}
