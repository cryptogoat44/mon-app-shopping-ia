// Lot 5 — partage d'une envie (5.C), sur le site.
//
//   pnpm --filter backend parcours-ecran lot-5-partage
//
// Trois comptes par combinaison : Louise (qui partage), Camille (qui la suit
// et reçoit) et Alix (administratrice, ajoutée à la table « admins » de
// spotto-dev). Louise republie son envie sur son profil (« Abonnés ») puis
// l'envoie à Camille ; Camille la voit dans l'Activité, dans « Reçues » et
// dans son fil (étiquette « Envie », mention « lien affilié »), avec une
// copie de l'image dans notre stockage, jamais l'adresse d'origine ; elle
// signale la pièce, Alix la masque, Louise en est informée ; Camille passe
// son réglage à « Personne » et le nouvel envoi de Louise est refusé. Dans les
// 4 combinaisons. Statistiques : clé PostHog FACTICE, envois interceptés (rien
// ne sort) ; aucun appel à SerpApi ni à l'IA. L'image d'origine est un
// fichier déposé sur le stockage de spotto-dev, que le serveur local copie.
import type { Page } from "playwright-core";
import sharp from "sharp";
import { z } from "zod";
import type { Parcours, TestAccount } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { attendreEnvoi, check, ouvrirSpotter, visible, type Envoi } from "./spotter-outils.js";
import { capteur, nouveauCompte, TEXTES } from "./lot-4-ter-outils.js";

export const name = "Lot 5 — partage d'une envie (site)";
export const outputDir = "lot-5-partage-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const TITRE = "Kelly 28 (test)";

const T = {
  fr: {
    partager: "Partager cette envie",
    abonnes: "Abonnés",
    republier: "Republier sur mon profil",
    republiee: "Sur votre profil · Abonnés",
    envoyerA: "Envoyer à quelqu'un sur Spotto",
    hors: "Partager hors de Spotto",
    titreEnvoi: "Envoyer à…",
    recherche: "Rechercher une personne",
    envoyerVers: (nom: string) => `Envoyer à ${nom}`,
    envoyee: (nom: string) => `Envoyée à ${nom}`,
    recue: "vous a envoyé une pièce.",
    piecesRecues: "Pièces reçues",
    lienAffilie: "Lien affilié",
    envie: "Envie",
    options: (titre: string) => `Options pour ${titre}`,
    signaler: "Signaler cette pièce",
    motif: "Contenu inapproprié",
    signale: "Signalement envoyé. Merci.",
    file: "Pièce envoyée · 1 signalement",
    masquer: "Masquer la pièce",
    confirmerMasquage: "Confirmer le masquage",
    enregistree: "Décision enregistrée.",
    aucuneRecue: /^Aucune pièce reçue pour l'instant/,
    masqueeExpeditrice: "Une pièce que vous avez envoyée a été masquée par la modération.",
    reglage: "Qui peut m'envoyer des pièces",
    personne: "Personne",
    refus: "Cette personne ne reçoit pas de pièces de votre part.",
  },
  en: {
    partager: "Share this wish",
    abonnes: "Followers",
    republier: "Repost on my profile",
    republiee: "On your profile · Followers",
    envoyerA: "Send to someone on Spotto",
    hors: "Share outside Spotto",
    titreEnvoi: "Send to…",
    recherche: "Search for someone",
    envoyerVers: (nom: string) => `Send to ${nom}`,
    envoyee: (nom: string) => `Sent to ${nom}`,
    recue: "sent you a piece.",
    piecesRecues: "Received pieces",
    lienAffilie: "Affiliate link",
    envie: "Wish",
    options: (titre: string) => `Options for ${titre}`,
    signaler: "Report this piece",
    motif: "Inappropriate content",
    signale: "Report sent. Thank you.",
    file: "Sent piece · 1 report",
    masquer: "Hide the piece",
    confirmerMasquage: "Confirm hiding",
    enregistree: "Decision saved.",
    aucuneRecue: /^No pieces received yet/,
    masqueeExpeditrice: "A piece you sent was hidden by moderation.",
    reglage: "Who can send me pieces",
    personne: "No one",
    refus: "This person doesn't accept pieces from you.",
  },
} as const satisfies Record<Locale, Record<string, unknown>>;

interface Comptes {
  alix: TestAccount;
  louise: TestAccount;
  camille: TestAccount;
  wishId: string;
  /** Adresse d'origine de l'image de l'envie : jamais montrée telle quelle. */
  source: string;
}

async function ok(response: Response, what: string): Promise<Response> {
  check(response.ok, `${what} (${response.status})`);
  return response;
}

/** Trois comptes neufs ; Camille suit Louise ; Louise a une envie venue d'un résultat avec lien affilié. */
async function preparer(p: Parcours, combo: Combo): Promise<Comptes> {
  const id = combo.id.replace("-", "").slice(0, 4);
  const [alix, louise, camille] = [await nouveauCompte(p, `pa${id}`), await nouveauCompte(p, `pl${id}`), await nouveauCompte(p, `pc${id}`)];
  await p.admin.from("profiles").update({ display_name: "Alix (test)" }).eq("id", alix.id);
  await p.admin.from("profiles").update({ display_name: "Camille (test)" }).eq("id", camille.id);
  check(!(await p.admin.from("admins").insert({ user_id: alix.id })).error, "rôle d'administratrice d'Alix (spotto-dev)");
  await ok(await p.api(camille, "POST", `/api/follows/${louise.id}`), "abonnement de Camille");

  // Image d'origine : un fichier public du stockage de spotto-dev (supprimé avec le compte de Louise).
  const photo = await sharp({ create: { width: 900, height: 1100, channels: 3, background: "#6B4A3A" } }).jpeg().toBuffer();
  const chemin = `${louise.id}/origine-parcours.jpg`;
  check(!(await p.admin.storage.from("post-media").upload(chemin, photo, { contentType: "image/jpeg", upsert: true })).error, "image d'origine déposée");
  const source = p.admin.storage.from("post-media").getPublicUrl(chemin).data.publicUrl;

  // Résultat d'une recherche de Louise, avec un lien affilié (inséré directement : aucun appel SerpApi).
  const search = z.object({ id: z.string().uuid() }).parse(
    (await p.admin.from("product_searches").insert({ user_id: louise.id, source_url: "https://www.tiktok.com/@test/video/1", source_platform: "tiktok", method: "oembed", status: "completed" }).select("id").single()).data
  );
  const match = z.object({ id: z.string().uuid() }).parse(
    (await p.admin.from("product_matches").insert({ search_id: search.id, rank: 1, product_name: TITRE, image_url: source, merchant_url: "https://example.com/kelly" }).select("id").single()).data
  );
  check(!(await p.admin.from("affiliate_links").insert({ product_match_id: match.id, network: "direct", affiliate_url: "https://example.com/kelly?aff=spotto" })).error, "lien affilié");
  const wish = z.object({ id: z.string().uuid() }).parse(
    await (
      await ok(
        await p.api(louise, "POST", "/api/wishlist", { title: TITRE, imageUrl: source, merchantName: "Boutique (test)", merchantUrl: "https://example.com/kelly", priceMin: 1290, currency: "EUR", productMatchId: match.id }),
        "envie de Louise"
      )
    ).json()
  );
  return { alix, louise, camille, wishId: wish.id, source };
}

async function ouvrir(p: Parcours, compte: TestAccount, combo: Combo, envois: Envoi[], chemin: string, attendu: string | RegExp): Promise<Page> {
  const page = await ouvrirSpotter(p, compte, combo, envois, TEXTES[combo.locale].ajouterVideo);
  await page.goto(`${p.siteUrl}${chemin}`);
  await page.getByText(attendu).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  return page;
}

/** Adresses des images affichées : jamais l'adresse d'origine, toujours une copie dans le dossier de Louise. */
async function controlerImages(page: Page, c: Comptes, ou: string): Promise<void> {
  const adresses = z.array(z.string()).parse(await page.evaluate("[...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src)"));
  check(!adresses.includes(c.source), `${ou} : jamais l'adresse d'origine de l'image`);
  check(adresses.some((a) => a.includes(`/post-media/${c.louise.id}/`) && !a.includes("origine-parcours")), `${ou} : la copie de l'image dans notre stockage`);
}

/** Louise : republier (« Abonnés »), puis envoyer à Camille. */
async function partager(p: Parcours, combo: Combo, c: Comptes, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const louise = await ouvrir(p, c.louise, combo, envois, `/envie?id=${c.wishId}`, M.partager);
  const capture = capteur(p, louise, combo, problemes);
  check((await visible(louise, M.hors).count()) === 1, "« Partager hors de Spotto » proposé");
  await louise.getByRole("radio", { name: M.abonnes, exact: true }).click();
  await louise.getByRole("button", { name: M.republier, exact: true }).scrollIntoViewIfNeeded();
  await capture("01-envie-partager");
  await louise.getByRole("button", { name: M.republier, exact: true }).click();
  await visible(louise, M.republiee).waitFor({ timeout: 30_000 });
  await attendreEnvoi(louise, envois, "wish_republished", { visibility: "followers" });
  await capture("02-envie-republiee");

  await louise.getByRole("button", { name: M.envoyerA, exact: true }).click();
  await visible(louise, M.titreEnvoi).waitFor({ timeout: 30_000 });
  await louise.getByLabel(M.recherche, { exact: true }).fill(c.camille.username);
  await visible(louise, `@${c.camille.username}`).waitFor({ timeout: 30_000 });
  await capture("03-envoyer-a");
  await louise.getByRole("button", { name: M.envoyerVers("Camille (test)"), exact: true }).click();
  await visible(louise, M.envoyee("Camille (test)")).waitFor({ timeout: 30_000 });
  await attendreEnvoi(louise, envois, "piece_sent", {});
  const envoi = envois.find((e) => e.event === "piece_sent");
  check(!JSON.stringify(envoi?.properties ?? {}).includes(c.camille.id), "statistique : jamais la personne");
  await louise.context().close();
}

/** Camille : Activité, « Reçues », fil ; elle signale la pièce. */
async function recevoir(p: Parcours, combo: Combo, c: Comptes, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const camille = await ouvrir(p, c.camille, combo, envois, "/activite", M.recue);
  const capture = capteur(p, camille, combo, problemes);
  await capture("04-activite-piece-recue");
  await camille.getByText(M.recue).filter({ visible: true }).first().click();
  await visible(camille, M.piecesRecues).waitFor({ timeout: 30_000 });
  await visible(camille, TITRE).waitFor({ timeout: 30_000 });
  check((await visible(camille, M.lienAffilie).count()) >= 1, "pièce reçue : mention « lien affilié »");
  await controlerImages(camille, c, "pièce reçue");
  await capture("05-pieces-recues");

  await camille.goto(`${p.siteUrl}/feed`);
  await camille.getByTestId("publication-envie").filter({ visible: true }).waitFor({ timeout: 30_000 });
  check((await visible(camille, M.envie).count()) >= 1, "fil : étiquette « Envie »");
  await controlerImages(camille, c, "publication « envie »");
  await camille.getByTestId("publication-envie").filter({ visible: true }).scrollIntoViewIfNeeded();
  await capture("06-fil-publication-envie");

  await camille.goto(`${p.siteUrl}/pieces-recues`);
  await visible(camille, TITRE).waitFor({ timeout: 30_000 });
  await camille.getByRole("button", { name: M.options(TITRE), exact: true }).click();
  await camille.getByRole("button", { name: M.signaler, exact: true }).click();
  await camille.getByRole("button", { name: M.motif, exact: true }).click();
  await visible(camille, M.signale).waitFor({ timeout: 30_000 });
  await attendreEnvoi(camille, envois, "report_submitted", { target_type: "piece" });
  await camille.context().close();
}

/** Alix masque la pièce ; elle disparaît chez Camille ; Louise en est informée. */
async function moderer(p: Parcours, combo: Combo, c: Comptes, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const pieces = z.object({ pieces: z.array(z.object({ id: z.string().uuid() })) }).parse(await (await ok(await p.api(c.camille, "GET", "/api/pieces/received"), "pièces de Camille")).json());
  const pieceId = pieces.pieces[0]?.id;
  check(pieceId !== undefined, "une pièce reçue par Camille");

  const alix = await ouvrir(p, c.alix, combo, envois, "/moderation", M.file);
  const carte = alix.getByTestId(`moderation-piece-${pieceId}`);
  await carte.scrollIntoViewIfNeeded();
  check(!String(await alix.evaluate("document.body.innerText")).includes("Camille (test)"), "file : jamais l'autrice du signalement");
  await capteur(p, alix, combo, problemes)("07-moderation-piece");
  await carte.getByRole("button", { name: M.masquer, exact: true }).click();
  await alix.getByRole("button", { name: M.confirmerMasquage, exact: true }).click();
  await visible(alix, M.enregistree).waitFor({ timeout: 30_000 });
  await attendreEnvoi(alix, envois, "moderation_decision", { decision: "hide", target_type: "piece" });
  await alix.context().close();

  const camille = await ouvrir(p, c.camille, combo, envois, "/pieces-recues", M.piecesRecues);
  await camille.getByText(M.aucuneRecue).filter({ visible: true }).waitFor({ timeout: 30_000 });
  await capteur(p, camille, combo, problemes)("08-recues-apres-masquage");
  await camille.context().close();

  const louise = await ouvrir(p, c.louise, combo, envois, "/activite", M.masqueeExpeditrice);
  await capteur(p, louise, combo, problemes)("09-activite-expeditrice");
  await louise.context().close();
}

/** Camille : « Personne » ; le nouvel envoi de Louise est refusé, sans dire pourquoi. */
async function refuser(p: Parcours, combo: Combo, c: Comptes, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const camille = await ouvrir(p, c.camille, combo, envois, "/settings", M.reglage);
  await camille.getByRole("radio", { name: M.personne, exact: true }).scrollIntoViewIfNeeded();
  await camille.getByRole("radio", { name: M.personne, exact: true }).click();
  await attendreEnvoi(camille, envois, "piece_sends_setting_changed", { value: "nobody" });
  await capteur(p, camille, combo, problemes)("10-reglage-personne");
  await camille.context().close();

  const louise = await ouvrir(p, c.louise, combo, envois, `/envoyer-envie?id=${c.wishId}`, M.titreEnvoi);
  await louise.getByLabel(M.recherche, { exact: true }).fill(c.camille.username);
  await visible(louise, `@${c.camille.username}`).waitFor({ timeout: 30_000 });
  await louise.getByRole("button", { name: M.envoyerVers("Camille (test)"), exact: true }).click();
  await visible(louise, M.refus).waitFor({ timeout: 30_000 });
  await capteur(p, louise, combo, problemes)("11-envoi-refuse");
  await louise.context().close();
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  for (const combo of COMBOS) {
    await p.step(`${combo.id} : republier, envoyer, recevoir, signaler, masquer, refuser`, async () => {
      const envois: Envoi[] = [];
      const comptes = await preparer(p, combo);
      await partager(p, combo, comptes, envois, problemes);
      await recevoir(p, combo, comptes, envois, problemes);
      await moderer(p, combo, comptes, envois, problemes);
      await refuser(p, combo, comptes, envois, problemes);
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
