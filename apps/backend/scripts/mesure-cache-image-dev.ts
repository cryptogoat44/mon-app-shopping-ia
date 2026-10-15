// Combien de temps une image EFFACÉE du stockage reste visible par son
// adresse publique (réseau de diffusion de Supabase, offre gratuite comme la
// production) — mesure demandée par le fondateur (lot 5, partie B,
// 2026-10-15). spotto-dev UNIQUEMENT.
//
//   pnpm --filter backend mesure-cache-image-dev [--sortie fichier.json]
//
// Deux images de test (vraies JPEG), envoyées comme nos copies d'images
// (post-media, public) : l'une avec la durée de cache par défaut (1 h),
// l'autre avec 5 minutes. Chacune est lue deux fois (pour la mettre dans le
// réseau de diffusion), effacée par l'API du stockage, puis relue juste
// après, puis à 1, 5, 15 et 60 minutes. Seuls des codes de réponse et des
// en-têtes de cache sont affichés.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { assertDevSupabaseUrl } from "./lib/dev-database.js";

interface Lecture {
  quand: string;
  image: string;
  statut: number | null;
  cache: string | null;
  age: string | null;
}

const MINUTES = [0, 1, 5, 15, 60];

async function lire(adresse: string): Promise<Omit<Lecture, "quand" | "image">> {
  try {
    const reponse = await fetch(adresse);
    await reponse.arrayBuffer();
    return { statut: reponse.status, cache: reponse.headers.get("cf-cache-status"), age: reponse.headers.get("age") };
  } catch {
    return { statut: null, cache: null, age: null };
  }
}

async function main() {
  const url = assertDevSupabaseUrl(process.env.SUPABASE_URL, "SUPABASE_URL").origin;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cle) throw new Error("Clé de spotto-dev absente.");
  const admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = admin.storage.from("post-media");
  const image = await sharp({ create: { width: 640, height: 800, channels: 3, background: "#8a5a3c" } }).jpeg({ quality: 80 }).toBuffer();

  const images = [
    { nom: "cache par défaut (1 h)", chemin: `mesure-cache/${randomUUID()}.jpg`, options: { contentType: "image/jpeg", upsert: false } },
    { nom: "cache de 5 minutes", chemin: `mesure-cache/${randomUUID()}.jpg`, options: { contentType: "image/jpeg", upsert: false, cacheControl: "300" } },
  ];
  const lectures: Lecture[] = [];
  const noter = (quand: string, nom: string, l: Omit<Lecture, "quand" | "image">) => {
    lectures.push({ quand, image: nom, ...l });
    console.log(`${quand.padEnd(26)} ${nom.padEnd(24)} réponse ${l.statut ?? "aucune"}  cache ${l.cache ?? "—"}  âge ${l.age ?? "—"}`);
  };

  for (const i of images) {
    const envoi = await bucket.upload(i.chemin, image, i.options);
    if (envoi.error) throw new Error(`Envoi impossible : ${envoi.error.message}`);
  }
  const adresses = images.map((i) => bucket.getPublicUrl(i.chemin).data.publicUrl);
  for (const [n, i] of images.entries()) {
    noter("avant effacement (1re)", i.nom, await lire(adresses[n]!));
    noter("avant effacement (2e)", i.nom, await lire(adresses[n]!));
  }
  const effacement = await bucket.remove(images.map((i) => i.chemin));
  if (effacement.error) throw new Error(`Effacement impossible : ${effacement.error.message}`);
  const debut = Date.now();
  console.log(`Effacées par l'API du stockage à ${new Date(debut).toISOString().slice(11, 19)} UTC.`);

  for (const minute of MINUTES) {
    const attente = debut + minute * 60_000 - Date.now();
    if (attente > 0) await new Promise((resolve) => setTimeout(resolve, attente));
    for (const [n, i] of images.entries()) noter(`${minute} min après effacement`, i.nom, await lire(adresses[n]!));
  }

  const sortie = process.argv.indexOf("--sortie");
  if (sortie >= 0 && process.argv[sortie + 1]) writeFileSync(process.argv[sortie + 1]!, JSON.stringify({ effaceesA: new Date(debut).toISOString(), lectures }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`Mesure impossible : ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
