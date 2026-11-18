// Images de la marque (lot 3bis) : icône de l'app, écrans de démarrage,
// icônes Android et icône du site. Toutes sont calculées à partir d'un TRACÉ
// vectoriel — le « S » de Bodoni Moda Medium (la police du logo, choisie par
// le fondateur le 2026-11-17), lu dans le fichier de police du dépôt et
// converti en contours — et rendues DIRECTEMENT à leur taille finale : aucune
// image n'est jamais agrandie ; aucun flou, ombre, lueur ni dégradé (décision
// du fondateur, 2026-10-04).
//
//   pnpm --filter backend images-marque
//
// Police Bodoni Moda : SIL Open Font License 1.1 (usage dans un logo permis) ;
// fichier et licence dans assets/fonts/ (voir LISEZ-MOI.md, au même endroit).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { contourLettre } from "./lib/contour-police.js";

const MOBILE = join(import.meta.dirname, "../../mobile");
const IMAGES = join(MOBILE, "assets/images");
const MARQUE_DIR = join(MOBILE, "assets/marque");
/** Images de l'écran de démarrage, aux noms attendus par Xcode : recopiées
 * telles quelles par apps/mobile/plugins/demarrage-exact.js. */
const DEMARRAGE_DIR = join(MARQUE_DIR, "demarrage");

/** Fichier de la police du logo : Bodoni Moda Medium, droite. */
export const POLICE_DU_LOGO = join(import.meta.dirname, "../assets/fonts/BodoniModa_500Medium.ttf");

/** Couleurs de la marque : vert anglais (« British racing green ») et or pâle. */
export const MARQUE = { vertAnglais: "#004225", orPale: "#D9C48F", blanc: "#FFFFFF" } as const;

/** Part de la hauteur de l'icône occupée par le « S » : 60 %, comme sur
 * l'aperçu du logo « Maison » validé par le fondateur (2026-11-17). */
export const S_DANS_ICONE = 0.6;
/** Écran de démarrage : image CARRÉE de 111 points de côté (Expo n'accepte
 * que des images carrées : une autre forme serait réduite, donc adoucie),
 * fournie en @3x exact (333 × 333 px). */
export const DEMARRAGE = { cotePoints: 111 } as const;

// « S » de Bodoni Moda Medium (unités de la police, axe vertical vers le
// haut) et ses bornes exactes, débordements compris.
const { trace: S_TRACE, bornes: S_BORNES } = contourLettre(readFileSync(POLICE_DU_LOGO), "S");

/** Le « S » posé au centre (cx, cy), haut de `hauteur` unités du dessin. */
export function lettre(couleur: string, cx: number, cy: number, hauteur: number): string {
  const k = hauteur / (S_BORNES.y1 - S_BORNES.y0);
  const tx = cx - ((S_BORNES.x0 + S_BORNES.x1) / 2) * k;
  const ty = cy + ((S_BORNES.y0 + S_BORNES.y1) / 2) * k;
  return `<path fill="${couleur}" transform="translate(${tx} ${ty}) scale(${k} ${-k})" d="${S_TRACE}"/>`;
}

/** Document SVG : dessin de `largeur × hauteur` unités, rendu à `sortieL × sortieH` pixels. */
export function document(largeur: number, hauteur: number, contenu: string, sortieL = largeur, sortieH = hauteur): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sortieL}" height="${sortieH}" viewBox="0 0 ${largeur} ${hauteur}">${contenu}</svg>`;
}

/** Icône carrée (fond vert anglais, « S » or pâle), dessinée sur 1024 unités. */
export function icone(): string {
  return `<rect width="1024" height="1024" fill="${MARQUE.vertAnglais}"/>${lettre(MARQUE.orPale, 512, 512, 1024 * S_DANS_ICONE)}`;
}

/** Couleur « #RRGGBB » au format d'Icon Composer (« srgb:r,g,b,a », de 0 à 1). */
function srgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5));
  return `srgb:${r},${g},${b},1.00000`;
}

/** Icône iPhone au format d'Apple (Icon Composer, iOS 26) : fond uni et
 * « S » VECTORIEL, que l'iPhone dessine lui-même à chaque taille. Le verre
 * (« Liquid Glass »), le reflet, l'ombre et la transparence sont désactivés :
 * avec une simple image, iOS 26 les ajoute d'office (halo et reflet
 * constatés sur le simulateur). */
function iconeApple(dossier: string): void {
  mkdirSync(join(dossier, "Assets"), { recursive: true });
  writeFileSync(join(dossier, "Assets", "S.svg"), `${document(1024, 1024, lettre(MARQUE.orPale, 512, 512, 1024 * S_DANS_ICONE))}\n`);
  const description = {
    fill: { solid: srgb(MARQUE.vertAnglais) },
    groups: [
      {
        layers: [{ glass: false, "image-name": "S.svg", name: "S" }],
        shadow: { kind: "none", opacity: 0 },
        specular: false,
        translucency: { enabled: false, value: 0 },
      },
    ],
    "supported-platforms": { squares: "shared" },
  };
  writeFileSync(join(dossier, "icon.json"), `${JSON.stringify(description, null, 2)}\n`);
}

/** Rendu PNG d'un SVG à sa taille exacte ; `opaque` retire la couche de transparence (exigé par Apple). */
async function png(svg: string, fichier: string, opaque: boolean): Promise<void> {
  const image = sharp(Buffer.from(svg));
  await (opaque ? image.removeAlpha() : image).png({ compressionLevel: 9 }).toFile(fichier);
}

function verifierAppJson(): { clair: string; sombre: string } {
  const app = JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")) as {
    expo: { android: { adaptiveIcon: { backgroundColor: string } }; plugins: unknown[] };
  };
  if (app.expo.android.adaptiveIcon.backgroundColor !== MARQUE.vertAnglais) {
    throw new Error("app.json : le fond de l'icône Android doit être le vert anglais.");
  }
  const splash = app.expo.plugins.find((p): p is [string, { backgroundColor: string; imageWidth: number; dark: { backgroundColor: string } }] => Array.isArray(p) && p[0] === "expo-splash-screen");
  if (!splash || splash[1].imageWidth !== DEMARRAGE.cotePoints) {
    throw new Error(`app.json : l'écran de démarrage doit avoir imageWidth = ${DEMARRAGE.cotePoints}.`);
  }
  return { clair: splash[1].backgroundColor, sombre: splash[1].dark.backgroundColor };
}

async function main(): Promise<void> {
  verifierAppJson();
  mkdirSync(MARQUE_DIR, { recursive: true });
  // Source vectorielle de référence.
  writeFileSync(join(MARQUE_DIR, "icone.svg"), `${document(1024, 1024, icone())}\n`);
  // iPhone : format d'Apple, vectoriel (voir iconeApple).
  iconeApple(join(MARQUE_DIR, "Spotto.icon"));
  // Image 1024 × 1024 opaque : icône de secours (Android, aperçus), même dessin.
  await png(document(1024, 1024, icone()), join(IMAGES, "icon.png"), true);
  // Site : 48 × 48, rendu directement à cette taille.
  await png(document(1024, 1024, icone(), 48, 48), join(IMAGES, "favicon.png"), true);
  // Écrans de démarrage (fond transparent : la couleur de fond vient
  // d'app.json), rendus directement à chaque échelle d'écran (×1, ×2, ×3).
  mkdirSync(DEMARRAGE_DIR, { recursive: true });
  const cote = DEMARRAGE.cotePoints;
  for (const [nom, couleur] of [["image", MARQUE.vertAnglais], ["dark_image", MARQUE.orPale]] as const) {
    for (const [echelle, suffixe] of [[1, ""], [2, "@2x"], [3, "@3x"]] as const) {
      const svg = document(cote, cote, lettre(couleur, cote / 2, cote / 2, cote - 2), cote * echelle, cote * echelle);
      await png(svg, join(DEMARRAGE_DIR, `${nom}${suffixe}.png`), false);
    }
  }
  // Android (icône adaptative) : « S » dans la zone sûre, fond = couleur d'app.json.
  const android = 1024 * S_DANS_ICONE * (72 / 108);
  await png(document(1024, 1024, lettre(MARQUE.orPale, 512, 512, android)), join(IMAGES, "android-icon-foreground.png"), false);
  await png(document(1024, 1024, lettre(MARQUE.blanc, 512, 512, android)), join(IMAGES, "android-icon-monochrome.png"), false);
  process.stdout.write("Images de la marque générées : marque/Spotto.icon, icon.png, favicon.png, android-icon-*.png, marque/icone.svg, marque/demarrage/*.png\n");
}

if (process.argv[1]?.endsWith("images-marque.ts")) {
  main().catch((error: unknown) => {
    console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
