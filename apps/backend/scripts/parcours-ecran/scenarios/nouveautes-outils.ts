// Outils du parcours « nouveautés » (finitions avant lancement).
//
// - étapes INDÉPENDANTES : chacune ouvre son téléphone, se connecte, et ferme
//   tout à la fin ; une étape en échec est photographiée (ECHEC-<étape>.png),
//   notée, et les suivantes passent quand même ; le parcours échoue à la fin,
//   avec le bilan. Seul le garde-fou « statistiques » arrête tout de suite ;
// - attentes avec un message clair : ce qui manquait à l'écran, et ce que le
//   site attendait encore (attendreAvecReleve de la boîte à outils) ;
// - données de départ préparées comme dans les autres parcours : par le
//   serveur local (envies, collections, messages, abonnements, profil,
//   signalement), et, pour ce que le serveur ne sait faire qu'avec SerpApi, par
//   le client d'administration de spotto-dev-2 — une recherche rangée avec ses
//   propositions (comme fiabilite-signalement), des images déposées sur notre
//   stockage (comme lot-5-partage), le rôle d'administratrice (comme lot-5).
//   Aucun appel à SerpApi ni à l'IA.
import type { Locator, Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import { attendreAvecReleve, type Parcours, type TestAccount } from "../boite-a-outils.js";
import { check } from "./spotter-outils.js";

// ---------- Étapes indépendantes ----------

/** Une partie passée proprement (nouveauté absente de la base de test…) : ni réussie, ni en échec. */
export class PartiePassee extends Error {}

export class Bilan {
  readonly reussies: string[] = [];
  readonly passees: string[] = [];
  readonly echecs: string[] = [];

  /** `demandees` : lettres des parties à jouer (« a » à « g », et « z ») ; aucune : toutes. */
  constructor(private readonly demandees: readonly string[]) {}

  demandee(etape: string): boolean {
    return this.demandees.length === 0 || this.demandees.includes(etape.charAt(0));
  }

  resume(): string {
    const lignes = [`Bilan : ${this.reussies.length} étape(s) réussie(s), ${this.passees.length} passée(s), ${this.echecs.length} en échec.`];
    for (const passee of this.passees) lignes.push(`  – passée : ${passee}`);
    for (const echec of this.echecs) lignes.push(`  ✗ échec : ${echec}`);
    return lignes.join("\n");
  }
}

/** Les téléphones d'une étape : ouverts connectés, photographiés en cas d'échec, fermés à la fin. */
export class Telephones {
  private readonly pages: Page[] = [];

  constructor(private readonly p: Parcours) {}

  /** Téléphone neuf (format iPhone, en français), connecté au compte : il arrive sur le Spotter. */
  async connecter(compte: TestAccount): Promise<Page> {
    const page = await this.p.newPhone();
    this.pages.push(page);
    await compte.signIn(page);
    await calme(page);
    return page;
  }

  async photographierEchec(etape: string): Promise<void> {
    for (const [index, page] of this.pages.entries()) {
      await this.p.capture(page, `ECHEC-${etape}-telephone-${index + 1}`).catch(() => {});
    }
  }

  async fermer(): Promise<void> {
    for (const page of this.pages) await page.context().close().catch(() => {});
  }
}

/** Joue une étape sans que son échec cache les suivantes (voir l'en-tête). */
export async function etape(p: Parcours, bilan: Bilan, id: string, titre: string, jouer: (telephones: Telephones) => Promise<void>): Promise<void> {
  if (!bilan.demandee(id)) return;
  const nom = `${id} — ${titre}`;
  const telephones = new Telephones(p);
  try {
    await p.step(nom, () => jouer(telephones));
    bilan.reussies.push(nom);
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    // Une statistique partie (ou bloquée) : jamais ignoré, le parcours s'arrête.
    if (message.startsWith("Garde-fou statistiques")) throw erreur;
    if (erreur instanceof PartiePassee) {
      bilan.passees.push(`${nom} : ${message}`);
      process.stdout.write(`  – étape passée : ${message}\n`);
      return;
    }
    await telephones.photographierEchec(id);
    bilan.echecs.push(`${nom} : ${message}`);
    process.stdout.write(`  ✗ ÉCHEC de l'étape « ${titre} » : ${message}\n  (les étapes suivantes continuent)\n`);
  } finally {
    await telephones.fermer();
  }
}

// ---------- Ce qu'on voit, ce qu'on touche ----------

/** Élément VISIBLE portant ce testID : les écrans précédents restent dans la page, cachés. */
export const repere = (page: Page, testId: string): Locator => page.getByTestId(testId).filter({ visible: true });
/** Bouton visible, par son nom exact (libellé d'accessibilité ou texte). */
export const bouton = (page: Page, nom: string | RegExp): Locator => page.getByRole("button", { name: nom, exact: true }).filter({ visible: true });
/** Texte visible, exact (ou qui correspond au motif). */
export const texte = (page: Page, contenu: string | RegExp): Locator => page.getByText(contenu, { exact: true }).filter({ visible: true });

/** Laisse le site finir ses lectures (5 s au plus : une conversation se relit sans fin). */
export async function calme(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
}

/** Attend `cible` à l'écran ; sinon l'erreur dit en clair ce qui manquait. */
export async function attendre(page: Page, quoi: string, cible: Locator, delai = 30_000): Promise<void> {
  await attendreAvecReleve(page, `Pas trouvé à l'écran : ${quoi}`, () => cible.first().waitFor({ state: "visible", timeout: delai }));
}

export async function toucher(page: Page, quoi: string, cible: Locator): Promise<void> {
  await attendre(page, quoi, cible);
  await cible.first().click();
}

/** Ouvre une adresse du site (il redémarre) et attend `cible`. */
export async function aller(p: Parcours, page: Page, chemin: string, quoi: string, cible: Locator): Promise<void> {
  await page.goto(`${p.siteUrl}${chemin}`);
  await attendre(page, quoi, cible);
  await calme(page);
}

/** Capture, l'élément amené dans l'écran d'abord (sans erreur s'il y est déjà). */
export async function photographier(p: Parcours, page: Page, nom: string, aMontrer?: Locator): Promise<void> {
  if (aMontrer) await aMontrer.first().scrollIntoViewIfNeeded().catch(() => {});
  await p.capture(page, nom);
}

// ---------- Serveur local ----------

const IDENTIFIANT = z.object({ id: z.guid() });

/** Appel au serveur local au nom du compte ; la réponse est relue avec `schema`. */
export async function appel<T>(p: Parcours, compte: TestAccount, methode: string, chemin: string, corps: unknown, quoi: string, schema: z.ZodType<T>): Promise<T> {
  const reponse = await p.api(compte, methode, chemin, corps);
  check(reponse.ok, `préparation — ${quoi} (réponse ${reponse.status} du serveur local)`);
  const lu = schema.safeParse(await reponse.json().catch(() => null));
  check(lu.success, `préparation — ${quoi} : réponse illisible`);
  return lu.data;
}

/** Comme `appel`, quand la réponse n'a pas à être lue. */
export async function demande(p: Parcours, compte: TestAccount, methode: string, chemin: string, corps: unknown, quoi: string): Promise<void> {
  const reponse = await p.api(compte, methode, chemin, corps);
  check(reponse.ok, `préparation — ${quoi} (réponse ${reponse.status} du serveur local)`);
}

export type Nouveaute = "messagerie" | "collections" | "alertes";
const DISPONIBILITE: Record<Nouveaute, { chemin: string; champ: string; migration: string }> = {
  messagerie: { chemin: "/api/messages/status", champ: "enabled", migration: "0032" },
  collections: { chemin: "/api/collections/status", champ: "enabled", migration: "0033" },
  alertes: { chemin: "/api/alerts/status", champ: "available", migration: "0036" },
};

/** La nouveauté est-elle disponible sur la base de test ? Sinon l'app la cache : l'étape est passée, avec la raison. */
export async function exiger(p: Parcours, compte: TestAccount, nouveaute: Nouveaute): Promise<void> {
  const { chemin, champ, migration } = DISPONIBILITE[nouveaute];
  const etat = await appel(p, compte, "GET", chemin, undefined, `disponibilité (${nouveaute})`, z.record(z.string(), z.unknown()));
  if (etat[champ] !== true) {
    throw new PartiePassee(`le serveur local dit que « ${nouveaute} » n'est pas disponible sur la base de test (migration ${migration} appliquée ?)`);
  }
}

// ---------- Données de départ ----------

export interface Piece {
  nom: string;
  boutique: string;
  /** En euros ; null : proposition ou envie sans prix. */
  prix: number | null;
  fond: string;
  /** Page produit d'une boutique d'exemple : reconnue par les alertes (cloche, « Plus disponible ? »). */
  lien: string;
}

/** Propositions de la recherche rangée, dans l'ordre « Pertinence ». */
export const RESULTATS: readonly Piece[] = [
  { nom: "Veste en daim camel", boutique: "Atelier Example", prix: 189, fond: "#8A5A3C", lien: "https://example.com/produit/resultat-veste-daim-camel" },
  { nom: "Blouson en daim cognac", boutique: "Maison Example", prix: 245, fond: "#6E4B32", lien: "https://example.com/produit/resultat-blouson-daim-cognac" },
  { nom: "Surchemise en daim", boutique: "Example Store", prix: null, fond: "#9C6B48", lien: "https://example.com/produit/resultat-surchemise-daim" },
  { nom: "Veste courte en daim", boutique: "Boutique Example", prix: 159, fond: "#7B5B45", lien: "https://example.com/produit/resultat-veste-courte-daim" },
  { nom: "Veste en daim vintage", boutique: "Atelier Example", prix: 89, fond: "#A0703F", lien: "https://example.com/produit/resultat-veste-daim-vintage" },
  { nom: "Veste en cuir camel", boutique: "Maison Example", prix: 320, fond: "#5C4033", lien: "https://example.com/produit/resultat-veste-cuir-camel" },
];

/** Envies de Louise : deux chez « Atelier Example » (recherche par boutique), une sans prix (total). */
export const ENVIES: readonly Piece[] = [
  { nom: "Sac seau noir", boutique: "Atelier Example", prix: 320, fond: "#2E2B29", lien: "https://example.com/produit/sac-seau-noir" },
  { nom: "Mocassins bordeaux", boutique: "Example Store", prix: 129, fond: "#5B1F28", lien: "https://example.com/produit/mocassins-bordeaux" },
  { nom: "Foulard en soie", boutique: "Maison Example", prix: 89, fond: "#7A8B6F", lien: "https://example.com/produit/foulard-soie" },
  { nom: "Montre acier", boutique: "Example Store", prix: null, fond: "#3A4A5A", lien: "https://example.com/produit/montre-acier" },
  { nom: "Blouson cognac", boutique: "Maison Example", prix: 245, fond: "#6E4B32", lien: "https://example.com/produit/blouson-cognac" },
  { nom: "Veste en daim camel", boutique: "Atelier Example", prix: 189, fond: "#8A5A3C", lien: "https://example.com/produit/veste-daim-camel" },
];

/** Envies de Camille, dans la collection qu'elle montre à ses amis. */
export const ENVIES_AMIE: readonly Piece[] = [
  { nom: "Trench beige", boutique: "Maison Example", prix: 210, fond: "#B59B7A", lien: "https://example.com/produit/trench-beige" },
  { nom: "Bottines noires", boutique: "Atelier Example", prix: 175, fond: "#2B2B2E", lien: "https://example.com/produit/bottines-noires" },
];

export const COLLECTION_PRIVEE = "Cadeaux";
export const COLLECTION_AMIS = "Printemps";
export const COLLECTION_AMIE = "Week-end";

/** Conversation de départ entre Louise et Camille (amies : elles se suivent l'une l'autre). */
export const MESSAGES = {
  camille1: "Tu as vu la veste en daim dont je te parlais ?",
  louise1: "Oui, je crois que je l'ai retrouvée.",
  camille2: "Montre-moi quand tu peux !",
  reponse: "Je te l'envoie tout de suite.",
  invitation: "Bonjour, j'aime beaucoup votre style. On échange nos trouvailles ?",
} as const;

export const BIO_AMIE = "Paris. Cuir, daim et belles matières.";
export const BIO_SIGNALEE = "Promotions tous les jours : écrivez-moi pour en profiter.";

/** Image de démonstration lisible : fond de couleur et nom de la pièce (comme lot-f). */
async function image(libelle: string, fond: string, largeur = 900, hauteur = 1100): Promise<Buffer> {
  const svg = `<svg width="${largeur}" height="${hauteur}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${fond}"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="${Math.round(largeur / 14)}" fill="#FAF9F7" text-anchor="middle">${libelle}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** Image déposée sur notre stockage de spotto-dev-2, dans le dossier du compte (supprimée avec lui). */
async function deposerImage(p: Parcours, compte: TestAccount, fichier: string, libelle: string, fond: string): Promise<string> {
  const chemin = `${compte.id}/nouveautes-${fichier}.jpg`;
  const { error } = await p.admin.storage.from("post-media").upload(chemin, await image(libelle, fond), { contentType: "image/jpeg", upsert: true });
  check(!error, `préparation — image « ${libelle} » déposée (${error?.message ?? "ok"})`);
  return p.admin.storage.from("post-media").getPublicUrl(chemin).data.publicUrl;
}

/** Fait une seule fois, à la première étape qui en a besoin ; un échec est redit à chaque étape qui en dépend. */
export function uneFois<T>(preparer: () => Promise<T>): () => Promise<T> {
  let promesse: Promise<T> | null = null;
  return () => (promesse ??= preparer());
}

export interface Recherche {
  searchId: string;
}

/** Une recherche aboutie, rangée directement avec ses propositions (aucun appel à SerpApi). */
export async function rangerRecherche(p: Parcours, compte: TestAccount): Promise<Recherche> {
  const { data, error } = await p.admin
    .from("product_searches")
    .insert({ user_id: compte.id, source_url: null, source_platform: "photo", method: "manual_screenshot", status: "completed", outcome: "found" })
    .select("id")
    .single();
  check(!error && data !== null, `préparation — recherche rangée (${error?.message ?? "ok"})`);
  const searchId = IDENTIFIANT.parse(data).id;
  const lignes = [];
  for (const [index, piece] of RESULTATS.entries()) {
    const adresse = await deposerImage(p, compte, `resultat-${index + 1}`, piece.nom, piece.fond);
    lignes.push({
      search_id: searchId,
      rank: index + 1,
      product_name: piece.nom,
      image_url: adresse,
      image_hd_url: adresse,
      price_min: piece.prix,
      price_max: piece.prix,
      currency: piece.prix === null ? null : "EUR",
      merchant_name: piece.boutique,
      merchant_url: piece.lien,
    });
  }
  const { error: erreurLignes } = await p.admin.from("product_matches").insert(lignes);
  check(!erreurLignes, `préparation — propositions rangées (${erreurLignes?.message ?? "ok"})`);
  return { searchId };
}

export interface Envie {
  id: string;
  nom: string;
}

/** Envies gardées par le serveur local (POST /api/wishlist), dans l'ordre de `pieces` : la dernière est la plus récente. */
export async function garderEnvies(p: Parcours, compte: TestAccount, pieces: readonly Piece[], prefixe: string): Promise<Envie[]> {
  const envies: Envie[] = [];
  for (const [index, piece] of pieces.entries()) {
    const adresse = await deposerImage(p, compte, `${prefixe}-${index + 1}`, piece.nom, piece.fond);
    const corps = { title: piece.nom, imageUrl: adresse, merchantName: piece.boutique, merchantUrl: piece.lien, ...(piece.prix === null ? {} : { priceMin: piece.prix, currency: "EUR" }) };
    envies.push({ id: (await appel(p, compte, "POST", "/api/wishlist", corps, `envie « ${piece.nom} »`, IDENTIFIANT)).id, nom: piece.nom });
  }
  return envies;
}

/** Une collection, ses envies rangées, puis montrée aux amis si demandé. */
export async function creerCollection(p: Parcours, compte: TestAccount, nom: string, envies: readonly Envie[], montreeAuxAmis: boolean): Promise<string> {
  const { id } = await appel(p, compte, "POST", "/api/collections", { name: nom }, `collection « ${nom} »`, IDENTIFIANT);
  for (const envie of envies) {
    await demande(p, compte, "PUT", `/api/wishlist/${envie.id}/collections`, { collectionIds: [id] }, `« ${envie.nom} » rangée dans « ${nom} »`);
  }
  if (montreeAuxAmis) await demande(p, compte, "PATCH", `/api/collections/${id}`, { visibility: "friends" }, `« ${nom} » montrée aux amis`);
  return id;
}

/** Trois messages entre les deux amies, par le serveur local ; renvoie l'identifiant de la conversation. */
export async function ouvrirConversation(p: Parcours, louise: TestAccount, camille: TestAccount): Promise<string> {
  const envoi = z.object({ conversationId: z.guid() });
  const premier = await appel(p, camille, "POST", "/api/messages", { recipientId: louise.id, text: MESSAGES.camille1 }, "premier message de Camille", envoi);
  await appel(p, louise, "POST", "/api/messages", { recipientId: camille.id, text: MESSAGES.louise1 }, "réponse de Louise", envoi);
  await appel(p, camille, "POST", "/api/messages", { recipientId: louise.id, text: MESSAGES.camille2 }, "second message de Camille", envoi);
  return premier.conversationId;
}

/** Photo de profil et bio, par le serveur local (comme l'app : POST /api/me/avatar, PATCH /api/me). */
export async function completerProfil(p: Parcours, compte: TestAccount, bio: string, fond: string): Promise<void> {
  const photo = new FormData();
  photo.append("file", new Blob([new Uint8Array(await image(compte.displayName.charAt(0), fond, 600, 600))], { type: "image/jpeg" }), "photo.jpg");
  await demande(p, compte, "POST", "/api/me/avatar", photo, `photo de profil de ${compte.displayName}`);
  await demande(p, compte, "PATCH", "/api/me", { username: compte.username, displayName: compte.displayName, bio }, `bio de ${compte.displayName}`);
}
