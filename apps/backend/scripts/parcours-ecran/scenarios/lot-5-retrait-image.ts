// Lot 5, partie B — « Retirer l'image copiée », sur le site.
//
//   pnpm --filter backend parcours-ecran lot-5-retrait-image [fr-clair|…]
//
// Trois comptes par combinaison (comme lot-5-partage) : Alix
// (administratrice), Louise (compte ordinaire, qui partage son envie) et
// Camille (compte ordinaire, qui la suit et reçoit la pièce). Préparation
// sans écran : Louise republie son envie (« Abonnés ») et l'envoie à Camille ;
// Camille signale la publication et la pièce. À l'écran : Alix retire l'image
// des deux (confirmation, puis « Traités ») ; Camille voit « Image
// indisponible » dans « Reçues », son fil et le profil de Louise ; Louise est
// prévenue (motif neutre, jamais le nom d'Alix), voit sa publication sans
// image mais avec son titre et le lien du marchand, et son envie garde
// l'image d'origine. Les copies sont effacées du stockage, l'image d'origine
// reste. Dans les 4 combinaisons. Statistiques : clé PostHog FACTICE, envois
// interceptés (rien ne sort) ; aucun appel à SerpApi ni à l'IA.
import type { Page } from "playwright-core";
import { z } from "zod";
import type { Parcours } from "../boite-a-outils.js";
import { COMBOS, type Combo, type Locale } from "./lot-3.js";
import { attendreEnvoi, check, visible, type Envoi } from "./spotter-outils.js";
import { capteur } from "./lot-4-ter-outils.js";
import { allerA, ok, ouvrir, preparer, TITRE, type Comptes } from "./lot-5-partage.js";

export const name = "Lot 5, partie B — retirer l'image copiée (site)";
export const outputDir = "lot-5-retrait-image-captures";
export const buildEnv = { EXPO_PUBLIC_POSTHOG_KEY: "phc_parcoursEcranFausseCle000000000", EXPO_PUBLIC_ENVIRONMENT: "development" };

const T = {
  fr: {
    fileEnvie: "Publication · 1 signalement",
    retirer: "Retirer l'image",
    avertissement: /^Retirer l'image \? Son fichier sera effacé définitivement/,
    confirmer: "Confirmer le retrait",
    retiree: "Image retirée : son fichier est effacé.",
    traites: "Traités",
    indisponible: "Image indisponible",
    piecesRecues: "Pièces reçues",
    lienAffilie: "Lien affilié",
    partager: "Partager cette envie",
    notifPublication: "L'image de votre publication « envie » a été retirée par la modération. La publication reste visible, sans son image.",
    notifPiece: "L'image d'une pièce que vous avez envoyée a été retirée par la modération. La pièce reste visible, sans son image.",
    motif: "Motif : Droits sur l'image",
  },
  en: {
    fileEnvie: "Post · 1 report",
    retirer: "Remove the image",
    avertissement: /^Remove the image\? Its file will be permanently deleted/,
    confirmer: "Confirm removal",
    retiree: "Image removed: its file has been deleted.",
    traites: "Reviewed",
    indisponible: "Image unavailable",
    piecesRecues: "Received pieces",
    lienAffilie: "Affiliate link",
    partager: "Share this wish",
    notifPublication: "The image of your wish post was removed by moderation. The post stays visible, without its image.",
    notifPiece: "The image of a piece you sent was removed by moderation. The piece stays visible, without its image.",
    motif: "Reason: Image rights",
  },
} as const satisfies Record<Locale, Record<string, unknown>>;

interface Partages {
  postId: string;
  pieceId: string;
  /** Noms des fichiers des deux copies (publication et pièce, deux tailles chacune). */
  copies: string[];
}

const fichier = (adresse: string | null) => (adresse ?? "").split("/").pop() ?? "";

/** Sans écran : Louise republie et envoie ; Camille signale les deux. */
async function partager(p: Parcours, c: Comptes): Promise<Partages> {
  const post = z
    .object({ id: z.string().uuid(), mediaUrl: z.string(), mediaThumbUrl: z.string() })
    .parse(await (await ok(await p.api(c.louise, "POST", `/api/wishlist/${c.wishId}/republish`, { privacy: "followers" }), "republication")).json());
  const sent = z.object({ id: z.string().uuid() }).parse(await (await ok(await p.api(c.louise, "POST", `/api/wishlist/${c.wishId}/send`, { recipientId: c.camille.id }), "envoi à Camille")).json());
  const recues = z
    .object({ pieces: z.array(z.object({ id: z.string().uuid(), imageUrl: z.string(), imageThumbUrl: z.string() })) })
    .parse(await (await ok(await p.api(c.camille, "GET", "/api/pieces/received"), "pièces de Camille")).json());
  const piece = recues.pieces.find((r) => r.id === sent.id);
  check(piece !== undefined, "la pièce envoyée est dans « Reçues »");
  for (const [targetType, targetId] of [["post", post.id], ["piece", piece.id]]) {
    await ok(await p.api(c.camille, "POST", "/api/reports", { targetType, targetId, reason: "other" }), `signalement (${targetType})`);
  }
  return { postId: post.id, pieceId: piece.id, copies: [post.mediaUrl, post.mediaThumbUrl, piece.imageUrl, piece.imageThumbUrl].map(fichier) };
}

/** Aucune image affichée ne vient des copies retirées. */
async function sansCopie(page: Page, s: Partages, ou: string): Promise<void> {
  const adresses = z.array(z.string()).parse(await page.evaluate("[...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src)"));
  check(!adresses.some((a) => s.copies.some((nom) => a.endsWith(nom))), `${ou} : aucune copie retirée affichée`);
}

/** Alix retire l'image d'une carte de la file, après confirmation. */
async function retirerDepuisLaFile(page: Page, combo: Combo, carte: ReturnType<Page["getByTestId"]>, envois: Envoi[], cible: "post" | "piece", capture?: (nom: string) => Promise<void>) {
  const M = T[combo.locale];
  await carte.scrollIntoViewIfNeeded();
  await carte.getByRole("button", { name: M.retirer, exact: true }).click();
  await carte.getByText(M.avertissement).waitFor({ timeout: 15_000 });
  await carte.getByRole("button", { name: M.confirmer, exact: true }).scrollIntoViewIfNeeded();
  if (capture) await capture("02-confirmation");
  await carte.getByRole("button", { name: M.confirmer, exact: true }).click();
  await visible(page, M.retiree).waitFor({ timeout: 30_000 });
  await attendreEnvoi(page, envois, "moderation_decision", { decision: "remove_image", target_type: cible });
  await visible(page, M.retiree).waitFor({ state: "hidden", timeout: 15_000 });
}

/** Alix (administratrice) : la file, la confirmation, puis « Traités ». */
async function retirer(p: Parcours, combo: Combo, c: Comptes, s: Partages, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const alix = await ouvrir(p, c.alix, combo, envois, "/moderation", M.fileEnvie);
  const capture = capteur(p, alix, combo, problemes);
  const publication = alix.getByTestId(`moderation-post-${s.postId}`);
  await publication.scrollIntoViewIfNeeded();
  check((await publication.getByRole("button", { name: M.retirer, exact: true }).count()) === 1, "« Retirer l'image » proposé pour la publication « envie »");
  await capture("01-file-publication-envie");
  await retirerDepuisLaFile(alix, combo, publication, envois, "post", capture);
  const envoi = envois.find((e) => e.event === "moderation_decision");
  check(!JSON.stringify(envoi?.properties ?? {}).includes(s.postId), "statistique : jamais l'identifiant du contenu");
  await retirerDepuisLaFile(alix, combo, alix.getByTestId(`moderation-piece-${s.pieceId}`), envois, "piece");

  // « Traités » est commun à tout le service : les combinaisons précédentes y figurent aussi.
  await alix.getByRole("radio", { name: M.traites, exact: true }).click();
  await publication.getByTestId("image-indisponible").waitFor({ timeout: 30_000 });
  check((await publication.getByRole("button", { name: M.retirer, exact: true }).count()) === 0, "« Traités » : plus de « Retirer l'image »");
  await publication.scrollIntoViewIfNeeded();
  await sansCopie(alix, s, "file de modération");
  await capture("03-traites-image-retiree");
  await alix.context().close();

  const restants = ((await p.admin.storage.from("post-media").list(c.louise.id, { limit: 1000 })).data ?? []).map((f) => f.name);
  check(s.copies.every((nom) => !restants.includes(nom)), "les quatre fichiers des copies sont effacés du stockage");
  check(restants.includes("origine-parcours.jpg"), "l'image d'origine (hors copies) reste");
}

/** Camille (compte ordinaire) : « Reçues », fil, profil de Louise. */
async function constaterChezCamille(p: Parcours, combo: Combo, c: Comptes, s: Partages, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const camille = await ouvrir(p, c.camille, combo, envois, "/pieces-recues", M.piecesRecues);
  const capture = capteur(p, camille, combo, problemes);
  const piece = camille.getByTestId(`piece-recue-${s.pieceId}`);
  await piece.getByTestId("image-indisponible").waitFor({ timeout: 30_000 });
  check((await piece.getByText(TITRE, { exact: true }).count()) === 1, "pièce reçue : son titre reste");
  check((await piece.getByText(M.lienAffilie, { exact: true }).count()) === 1, "pièce reçue : le lien du marchand reste");
  await sansCopie(camille, s, "pièces reçues");
  await capture("04-recues-image-indisponible");

  await allerA(p, camille, "/feed", () => camille.getByTestId("publication-envie").filter({ visible: true }).waitFor({ timeout: 30_000 }));
  await visible(camille, M.indisponible).first().waitFor({ timeout: 30_000 });
  await sansCopie(camille, s, "fil");
  await camille.getByTestId("image-indisponible").filter({ visible: true }).first().scrollIntoViewIfNeeded();
  await capture("05-fil-image-indisponible");

  await allerA(p, camille, `/profil?id=${c.louise.id}`, () =>
    camille.getByTestId("image-indisponible").filter({ visible: true }).first().waitFor({ timeout: 30_000 })
  );
  await sansCopie(camille, s, "profil de Louise");
  await capture("06-profil-grille");
  await camille.context().close();
}

/** Louise (compte ordinaire) : prévenue, publication sans image, envie intacte. */
async function constaterChezLouise(p: Parcours, combo: Combo, c: Comptes, s: Partages, envois: Envoi[], problemes: string[]) {
  const M = T[combo.locale];
  const louise = await ouvrir(p, c.louise, combo, envois, "/activite", M.notifPublication);
  const capture = capteur(p, louise, combo, problemes);
  check((await visible(louise, M.notifPiece).count()) === 1, "Louise : retrait de l'image de la pièce annoncé");
  check((await visible(louise, M.motif).count()) >= 2, `Louise : « ${M.motif} »`);
  check(!String(await louise.evaluate("document.body.innerText")).includes(c.alix.username), "Louise : jamais le nom de l'administratrice");
  await capture("07-activite-personne-prevenue");

  await allerA(p, louise, `/publication?id=${s.postId}`, () => visible(louise, M.indisponible).first().waitFor({ timeout: 30_000 }));
  check((await visible(louise, TITRE).count()) >= 1, "publication : son titre reste");
  check((await visible(louise, M.lienAffilie).count()) >= 1, "publication : le lien du marchand reste");
  check((await louise.getByRole("button", { name: M.retirer, exact: true }).count()) === 0, "compte ordinaire : jamais « Retirer l'image »");
  await sansCopie(louise, s, "détail de la publication");
  await capture("08-publication-sans-image");

  await allerA(p, louise, `/envie?id=${c.wishId}`, () => visible(louise, M.partager).waitFor({ timeout: 30_000 }));
  const adresses = z.array(z.string()).parse(await louise.evaluate("[...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src)"));
  check(adresses.some((a) => a.includes("origine-parcours")), "envie : l'image d'origine du marchand, inchangée");
  await capture("09-envie-image-origine");
  await louise.context().close();
}

export async function run(p: Parcours): Promise<void> {
  const problemes: string[] = [];
  const combos = p.args.length > 0 ? COMBOS.filter((combo) => p.args.includes(combo.id)) : COMBOS;
  for (const combo of combos) {
    await p.step(`${combo.id} : retirer l'image (administratrice), la constater (comptes ordinaires)`, async () => {
      const envois: Envoi[] = [];
      const comptes = await preparer(p, combo);
      const partages = await partager(p, comptes);
      await retirer(p, combo, comptes, partages, envois, problemes);
      await constaterChezCamille(p, combo, comptes, partages, envois, problemes);
      await constaterChezLouise(p, combo, comptes, partages, envois, problemes);
    });
  }
  check(problemes.length === 0, `affichage :\n${problemes.join("\n")}`);
}
