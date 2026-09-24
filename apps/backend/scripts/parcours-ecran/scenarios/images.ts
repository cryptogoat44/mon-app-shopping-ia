// Netteté des images et fluidité du fil (lot « images et fluidité »).
//
//   pnpm --filter backend parcours-ecran images avant     (ou « apres »)
//
// Prépare un fil réaliste (publications « achat » venues du Spotter, avec
// les vraies images des marchands de l'essai SerpApi n° 3 ; publications
// photo de la taille d'une photo d'iPhone), puis capture le fil et le
// profil, et mesure : nombre et poids des images chargées, nombre d'images
// chargées en même temps, fluidité du défilement (format iPhone et écran
// d'ordinateur). Aucun crédit SerpApi : les résultats sont relus d'un
// fichier d'essai déjà enregistré.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { Page } from "playwright-core";
import type { ImageStats, Parcours, ScrollStats, TestAccount } from "../boite-a-outils.js";

export const name = "Images et fluidité du fil";
export const outputDir = "images-captures";

const ESSAI = fileURLToPath(new URL("../../../../../docs/lot-s-design/essais-serpapi/result-crop-q.json", import.meta.url));

interface EssaiMatch {
  title: string;
  thumbnail: string;
  image?: string;
  source?: string;
  link: string;
  price?: { extracted_value?: number };
}

// Photo « comme un iPhone » : 3024 × 4032, texture fine (poids réaliste).
async function iphonePhoto(label: string, tint: { r: number; g: number; b: number }): Promise<Buffer> {
  const base = await sharp({ create: { width: 3024, height: 4032, channels: 3, background: tint, noise: { type: "gaussian", mean: 128, sigma: 18 } } })
    .tint(tint)
    .png()
    .toBuffer();
  const svg = Buffer.from(
    `<svg width="3024" height="4032" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" font-family="Georgia, serif" font-size="260" fill="#FAF9F7" text-anchor="middle">${label}</text></svg>`
  );
  return sharp(base).composite([{ input: svg }]).jpeg({ quality: 88 }).toBuffer();
}

async function post(p: Parcours, account: TestAccount, fields: Record<string, string>, file?: Buffer) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append("file", new Blob([new Uint8Array(file)], { type: "image/jpeg" }), "photo.jpg");
  const res = await p.api(account, "POST", "/api/posts", form);
  if (!res.ok) throw new Error(`Publication impossible (${res.status}) : ${await res.text()}`);
  return res.json();
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

function formatStats(label: string, images: ImageStats, scroll?: ScrollStats): string {
  const lines = [
    `### ${label}`,
    `- Images chargées : **${images.count}**, poids total **${images.totalKo} Ko** ; jusqu'à **${images.maxConcurrent}** en même temps`,
    `- Les plus lourdes : ${images.largest.map((l) => `${l.ko} Ko (${l.host})`).join(", ") || "—"}`,
  ];
  if (scroll) {
    lines.push(
      `- Défilement : ${scroll.frames} images affichées, **${scroll.slowFrames} saccades** (> 50 ms), pire image **${scroll.worstFrameMs} ms**, ${scroll.longTasks} tâches longues (${scroll.longTasksMs} ms au total)`
    );
  }
  return lines.join("\n");
}

export async function run(p: Parcours): Promise<void> {
  const phase = p.args[0] === "apres" ? "apres" : "avant";
  if (!existsSync(ESSAI)) throw new Error("Fichier d'essai SerpApi introuvable (docs/lot-s-design/essais-serpapi/).");
  const essai = (JSON.parse(readFileSync(ESSAI, "utf8")) as EssaiMatch[]).filter((m) => m.image && m.thumbnail).slice(0, 12);

  const camille = await p.createAccount("a", "Camille (test)");
  const louise = await p.createAccount("b", "Louise (test)");

  // Recherche « Spotter » de Camille, avec les vraies images de l'essai.
  const { data: search } = await p.admin
    .from("product_searches")
    .insert({ user_id: camille.id, source_platform: "photo", method: "manual_screenshot", status: "completed" })
    .select("id")
    .single();
  const { data: matches } = await p.admin
    .from("product_matches")
    .insert(
      essai.map((m, i) => ({
        search_id: search!.id,
        rank: i + 1,
        product_name: m.title,
        image_url: m.thumbnail,
        image_hd_url: m.image ?? null,
        merchant_url: m.link,
        merchant_name: m.source ?? null,
        price_min: m.price?.extracted_value ?? null,
      }))
    )
    .select("id, rank, product_name, image_url");
  const sorted = (matches ?? []).sort((x, y) => x.rank - y.rank);

  await p.step("Préparation : 4 achats, 3 photos d'iPhone, 3 Envies", async () => {
    for (const [index, match] of sorted.slice(0, 4).entries()) {
      const vault = await p.api(camille, "POST", "/api/vault", (() => {
        const form = new FormData();
        form.append("title", match.product_name.slice(0, 60));
        form.append("category", "clothing");
        form.append("productMatchId", match.id);
        return form;
      })());
      const item = (await vault.json()) as { id: string };
      await post(p, camille, { type: "purchase", vaultItemId: item.id, privacy: "public" });
      if (index < 3) {
        const colors = [
          { r: 122, g: 139, b: 111 },
          { r: 107, g: 74, b: 58 },
          { r: 58, g: 74, b: 90 },
        ];
        await post(p, camille, { type: "lifestyle", privacy: "public", caption: `Photo ${index + 1}` }, await iphonePhoto(`Photo ${index + 1}`, colors[index]!));
      }
    }
    for (const match of sorted.slice(4, 7)) {
      await p.api(camille, "POST", "/api/wishlist", { title: match.product_name.slice(0, 60), imageUrl: match.image_url, productMatchId: match.id });
    }
    await p.api(louise, "POST", `/api/follows/${camille.id}`);
  });

  const report: string[] = [`# Mesures — ${phase === "avant" ? "avant" : "après"} corrections`, "", `Fil de 7 publications (4 « achat » avec images de marchands, 3 photos d'iPhone de 3024 × 4032).`, ""];
  const phone = await p.newPhone();
  const desktop = await p.newPhone({ desktop: true });

  await p.step("Fil au format iPhone : chargement et défilement", async () => {
    await camille.signIn(phone);
    const stop = p.trackImages(phone);
    await open(phone, `${p.siteUrl}/feed`);
    await p.capture(phone, `${phase}-01-fil-haut`);
    const initial = stop();
    const scroll = await p.measureScroll(phone, 5000);
    await p.capture(phone, `${phase}-02-fil-apres-defilement`);
    report.push(formatStats("iPhone — ouverture du fil", initial), "", formatStats("iPhone — après défilement complet", stop(), scroll), "");
  });

  await p.step("Profil (propriétaire) : Vault, Lifestyle, Envies", async () => {
    await open(phone, `${p.siteUrl}/profile`);
    await p.capture(phone, `${phase}-03-profil-vault`);
    await phone.getByRole("tab", { name: "Lifestyle" }).click();
    await phone.waitForTimeout(1500);
    await p.capture(phone, `${phase}-04-profil-lifestyle`);
    await phone.getByRole("tab", { name: "Envies" }).click();
    await phone.waitForTimeout(1500);
    await p.capture(phone, `${phase}-05-profil-envies`);
  });

  await p.step("Profil de Camille vu par Louise", async () => {
    const other = await p.newPhone();
    await louise.signIn(other);
    await open(other, `${p.siteUrl}/profil?id=${camille.id}`);
    await p.capture(other, `${phase}-06-profil-vu-par-louise`);
    await open(other, `${p.siteUrl}/feed`);
    await p.capture(other, `${phase}-07-fil-louise`);
  });

  await p.step("Fil sur écran d'ordinateur : chargement et défilement", async () => {
    await camille.signIn(desktop);
    const stop = p.trackImages(desktop);
    await open(desktop, `${p.siteUrl}/feed`);
    const initial = stop();
    const scroll = await p.measureScroll(desktop, 5000);
    report.push(formatStats("Ordinateur — ouverture du fil", initial), "", formatStats("Ordinateur — après défilement complet", stop(), scroll), "");
  });

  report.push("_Mesures prises dans un Chrome invisible sur le Mac : indicatives, à comparer entre « avant » et « après »._");
  p.writeReport(`mesures-${phase}.md`, `${report.join("\n")}\n`);
}
