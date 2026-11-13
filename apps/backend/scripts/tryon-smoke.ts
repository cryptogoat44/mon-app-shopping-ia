// Essai RÉEL de l'essayage virtuel chez FASHN (modèle tryon-v1.6) : le SEUL
// script autorisé à appeler FASHN pour de vrai. Chaque essai réussi coûte
// 1 crédit, soit 0,075 $. Il ne passe ni par le serveur, ni par la base, ni
// par le drapeau : il prend deux fichiers du Mac (votre photo, l'image d'une
// pièce), les prépare comme le serveur (JPEG ré-encodé sans métadonnées,
// 1 296 px au plus), les envoie en base64 à FASHN avec les réglages du
// serveur (modération « conservative »), ajoute le bandeau « Image générée
// par IA », puis écrit le résultat dans un dossier temporaire du Mac, HORS
// du dépôt, et affiche son chemin. Rien d'autre n'est gardé.
//
//   pnpm --filter backend tryon:smoke --photo <chemin de votre photo> --garment <chemin de l'image de la pièce> --i-understand-this-costs-money
//   (--lang en : bandeau en anglais)
//
// Demande FASHN_API_KEY dans apps/backend/.env (et FASHN_API_BASE_URL si
// elle change). Sans --i-understand-this-costs-money, sans clé ou sans les
// deux fichiers : refusé, rien n'est envoyé. La clé n'est jamais affichée.
// Utilisez seulement une photo de vous.
import "dotenv/config";
// Sécurité des images d'abord : seuls les formats d'image permis sont lus.
import "../src/lib/imageSafety.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addAiBand } from "../src/lib/tryon/band.js";
import { readTryonConfig, type TryonEnvSource } from "../src/lib/tryon/config.js";
import { prepareGarmentImage, prepareTryonPhoto } from "../src/lib/tryon/images.js";
import { TryonProviderError } from "../src/lib/tryon/provider.js";
import { FashnProvider } from "../src/lib/tryon/providers/fashn.js";
import { isInsideDirectory, smokeRequest } from "./lib/tryon-admin.js";

/** La racine du dépôt : le résultat ne doit jamais y être écrit. */
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(): Promise<void> {
  const request = smokeRequest(process.argv.slice(2), Boolean(process.env.FASHN_API_KEY?.trim()));
  if ("refused" in request) {
    console.error(request.refused);
    process.exitCode = 1;
    return;
  }
  // Les réglages du serveur, pour FASHN seulement, dans ce script seulement
  // (rien n'est allumé ailleurs) : clé et adresse vérifiées.
  const state = readTryonConfig({ ...(process.env as unknown as TryonEnvSource), TRYON_ENABLED: true, TRYON_PROVIDER: "fashn" }, "production");
  if (state.state !== "ready" || !state.config.apiKey) {
    throw new Error(`Réglages invalides : ${state.state === "invalid" ? state.problems.join(" ; ") : "clé absente"}`);
  }
  const buffers: Buffer[] = [];
  try {
    const photo = await prepareTryonPhoto(readFileSync(request.photo));
    buffers.push(photo);
    const garment = await prepareGarmentImage(readFileSync(request.garment));
    buffers.push(garment);
    console.log("Envoi à FASHN (tryon-v1.6, 1 crédit si l'essai réussit)…");
    const provider = new FashnProvider({ apiKey: state.config.apiKey, baseUrl: state.config.apiBaseUrl });
    const output = await provider.run({ personImage: photo, garmentImage: { kind: "data", jpeg: garment }, locale: request.locale });
    buffers.push(output.image);
    const banded = await addAiBand(output.image, request.locale);
    buffers.push(banded);
    const directory = mkdtempSync(join(tmpdir(), "essayage-smoke-"));
    if (isInsideDirectory(directory, REPOSITORY)) throw new Error("Le dossier temporaire est dans le dépôt : rien n'est écrit.");
    const path = join(directory, "resultat.jpg");
    writeFileSync(path, banded, { mode: 0o600 });
    console.log(`Essai réussi (${output.creditsUsed} crédit(s) consommé(s)). Résultat, hors du dépôt : ${path}`);
  } catch (error) {
    if (error instanceof TryonProviderError) throw new Error(`Essai échoué chez FASHN : ${error.kind}${error.status ? ` (HTTP ${error.status})` : ""}. Un essai échoué n'est pas facturé.`);
    throw error;
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Erreur inattendue.");
  process.exitCode = 1;
});
