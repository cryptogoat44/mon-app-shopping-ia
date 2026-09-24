// Lot F — « le fil vivant » : deux comptes (Louise publie, Camille la suit)
// parcourent réellement l'app : partage d'une pièce, publication « achat »,
// publication photo, fil des deux côtés, commentaire, partage, modification
// de la visibilité, suppression, Envies dans le profil, blocage.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Page } from "playwright-core";
import type { Parcours, TestAccount } from "../boite-a-outils.js";

export const name = "Lot F — le fil vivant";
export const outputDir = "lot-f-captures";

// Image de démonstration lisible (fond coloré + nom de la pièce).
async function demoImage(label: string, background: string): Promise<Buffer> {
  const svg = `<svg width="900" height="1100" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${background}"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="84" fill="#FAF9F7" text-anchor="middle">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

async function addVaultPiece(p: Parcours, account: TestAccount, title: string, category: string, background: string) {
  const form = new FormData();
  form.append("title", title);
  form.append("category", category);
  form.append("file", new Blob([new Uint8Array(await demoImage(title, background))], { type: "image/jpeg" }), "piece.jpg");
  const res = await p.api(account, "POST", "/api/vault", form);
  if (!res.ok) throw new Error(`Ajout au Vault impossible (${res.status})`);
  return (await res.json()) as { id: string; imageUrl: string };
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => {});
}

export async function run(p: Parcours): Promise<void> {
  const louise = await p.createAccount("b", "Louise (test)");
  const camille = await p.createAccount("a", "Camille (test)");

  // Données de départ, par l'API (rapide, sans crédit) : deux pièces dans le
  // Vault de Louise, une Envie pour Camille, une photo à publier.
  const sac = await addVaultPiece(p, louise, "Sac en cuir", "bags", "#6B4A3A");
  await addVaultPiece(p, louise, "Montre Tank", "watches", "#3A4A5A");
  await p.api(camille, "POST", "/api/wishlist", {
    title: "Sac en cuir",
    imageUrl: sac.imageUrl,
    merchantName: "Boutique exemple",
    merchantUrl: "https://example.com/sac",
  });
  const photoDir = mkdtempSync(join(tmpdir(), "parcours-photo-"));
  const photoPath = join(photoDir, "dimanche.jpg");
  writeFileSync(photoPath, await demoImage("Dimanche", "#7A8B6F"));

  const b = await p.newPhone();
  const a = await p.newPhone();

  // ---- Louise ----
  await p.step("Louise se connecte (barre A)", () => louise.signIn(b));
  await p.capture(b, "01-spotter-barre-navigation");

  await p.step("Louise partage une pièce du Vault en Public", async () => {
    await open(b, `${p.siteUrl}/vault-item/${sac.id}`);
    await b.getByText("Sac en cuir").first().waitFor();
    await p.capture(b, "02-piece-avant-partage");
    await b.getByRole("radio", { name: "Public" }).click();
    await b.getByRole("button", { name: "Partager dans mon fil" }).click();
    await b.getByText("Partagée dans votre fil · Public").waitFor();
    await b.waitForTimeout(3500); // le message de confirmation disparaît
    await p.capture(b, "03-piece-partagee-etat");
  });

  await p.step("Louise publie une pièce du Vault depuis « + » (Abonnés)", async () => {
    await open(b, `${p.siteUrl}/post-item/new`);
    await b.getByRole("radio", { name: "Une pièce de mon Vault" }).click();
    await b.getByRole("radio", { name: "Montre Tank" }).click();
    await b.getByRole("radio", { name: "Abonnés" }).click();
    await p.capture(b, "04-plus-piece-du-vault");
    await b.getByRole("button", { name: "Publier" }).click();
    await b.getByText("Publié").first().waitFor();
  });

  await p.step("Louise publie une photo (Public)", async () => {
    await open(b, `${p.siteUrl}/post-item/new`);
    const [chooser] = await Promise.all([b.waitForEvent("filechooser"), b.getByRole("button", { name: "Ajouter une photo" }).click()]);
    await chooser.setFiles(photoPath);
    await b.getByLabel("Légende de la publication").fill("Dimanche au marché");
    await b.getByRole("radio", { name: "Public" }).click();
    await b.getByRole("button", { name: "Publier" }).click();
    await b.getByText("Publié").first().waitFor();
  });

  await p.step("Fil de Louise : ses trois publications", async () => {
    await open(b, `${p.siteUrl}/feed`);
    await b.getByText("Dimanche au marché").first().waitFor();
    await p.capture(b, "05-fil-louise-ses-publications");
  });

  // ---- Camille ----
  await p.step("Camille se connecte : fil vide", async () => {
    await camille.signIn(a);
    await open(a, `${p.siteUrl}/feed`);
    await a.getByText("Votre fil est encore calme").waitFor();
    await p.capture(a, "06-fil-vide-camille");
  });

  await p.step("Camille trouve Louise et la suit", async () => {
    await open(a, `${p.siteUrl}/people-search`);
    await a.getByPlaceholder("Rechercher").fill(louise.username);
    await a.getByRole("link", { name: "Voir le profil de Louise (test)" }).click();
    await a.getByRole("button", { name: "Suivre" }).waitFor();
    await p.capture(a, "07-profil-louise-avant-suivi");
    await a.getByRole("button", { name: "Suivre" }).click();
    await a.getByRole("button", { name: "Ne plus suivre" }).waitFor();
    await p.capture(a, "08-profil-louise-abonnee");
  });

  await p.step("Fil de Camille : les publications de Louise", async () => {
    await open(a, `${p.siteUrl}/feed`);
    await a.getByText("Dimanche au marché").first().waitFor();
    await p.capture(a, "09-fil-camille");
  });

  let sharedLink = "";
  await p.step("Camille commente et partage la photo", async () => {
    await a.getByRole("button", { name: "Commenter" }).first().click();
    await a.getByLabel("Ajouter un commentaire…").fill("Très jolie lumière !");
    await a.getByRole("button", { name: "Publier" }).click();
    await a.getByText("Très jolie lumière !").waitFor();
    await p.capture(a, "10-commentaire");
    // Le menu de partage du système (navigator.share) est intercepté : on
    // vérifie le lien réellement transmis, sans ouvrir de fenêtre.
    // (Code transmis sous forme de texte : l'outil qui exécute ce script
    // ajoute sinon une fonction d'aide inconnue du navigateur.)
    await a.evaluate(`(() => {
      window.__partages = [];
      Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { window.__partages.push(data); } });
    })()`);
    await a.getByRole("button", { name: "Partager la publication" }).first().click();
    await a.waitForFunction("window.__partages.length > 0");
    const shared = (await a.evaluate("window.__partages[0]")) as { text: string; url: string };
    sharedLink = shared.url;
    if (!sharedLink.includes("/publication?id=") || !shared.text.includes("Louise (test) sur Spotto")) {
      throw new Error(`Partage inattendu : ${JSON.stringify(shared)}`);
    }
    process.stdout.write(`  lien partagé : ${sharedLink}\n  message : ${shared.text.replace(/\n/g, " / ")}\n`);
  });

  // ---- Louise ----
  await p.step("Louise voit l'activité et rend la photo privée", async () => {
    await open(b, `${p.siteUrl}/activite`);
    await b.getByText("a commenté votre publication.").waitFor();
    await p.capture(b, "12-activite-commentaire");
    await b.getByText("a commenté votre publication.").click();
    await b.getByText("Très jolie lumière !").waitFor();
    await b.getByRole("radio", { name: "Privé" }).click();
    await b.getByText("Visibilité : Privé").waitFor();
    await p.capture(b, "13-visibilite-privee");
  });

  // ---- Camille ----
  await p.step("Camille : la photo privée disparaît, le lien ne la montre plus", async () => {
    await open(a, `${p.siteUrl}/feed`);
    await a.getByText("Sac en cuir").first().waitFor();
    await p.capture(a, "14-fil-camille-apres-privee");
    await open(a, sharedLink);
    await a.getByText("Cette publication n'est pas disponible.").waitFor();
    await p.capture(a, "15-lien-publication-privee");
  });

  // ---- Louise ----
  await p.step("Louise supprime la publication de la pièce", async () => {
    await open(b, `${p.siteUrl}/vault-item/${sac.id}`);
    await b.getByRole("link", { name: "Voir la publication" }).click();
    await b.getByRole("button", { name: "Supprimer la publication" }).click();
    await p.capture(b, "16-suppression-confirmation");
    await b.getByRole("button", { name: "Supprimer", exact: true }).click();
    await b.getByText("Publication supprimée").waitFor();
    await open(b, `${p.siteUrl}/vault-item/${sac.id}`);
    await b.getByRole("button", { name: "Partager dans mon fil" }).waitFor();
    await p.capture(b, "17-piece-de-nouveau-partageable");
  });

  // ---- Camille ----
  await p.step("Camille : ses Envies dans son Profil", async () => {
    await open(a, `${p.siteUrl}/profile`);
    await a.getByRole("tab", { name: "Envies" }).click();
    await a.getByText("Vos Envies sont privées").waitFor();
    await p.capture(a, "18-envies-dans-le-profil");
  });

  // ---- Louise bloque Camille ----
  await p.step("Louise bloque Camille", async () => {
    await open(b, `${p.siteUrl}/profil?id=${camille.id}`);
    await b.getByRole("button", { name: "Signaler ou bloquer" }).click();
    await b.getByText("Bloquer ce compte").click();
    await b.getByText("Confirmer le blocage").click();
    await b.getByText("Compte bloqué.").waitFor();
  });

  await p.step("Camille : plus rien de Louise", async () => {
    await open(a, `${p.siteUrl}/feed`);
    await a.getByText("Votre fil est encore calme").waitFor();
    await p.capture(a, "19-fil-camille-apres-blocage");
    await open(a, `${p.siteUrl}/profil?id=${louise.id}`);
    await a.getByText("Ce profil n'est pas disponible.").waitFor();
    await p.capture(a, "20-profil-louise-indisponible");
  });
}
