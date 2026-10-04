// Images de la marque (lot 3bis) : icône de l'app, écrans de démarrage,
// icônes Android et icône du site. Toutes sont calculées à partir d'un TRACÉ
// vectoriel — le « S » de Newsreader Medium (la police du logo), converti en
// contours — et rendues DIRECTEMENT à leur taille finale : aucune image n'est
// jamais agrandie ; aucun flou, ombre, lueur ni dégradé (décision du
// fondateur, 2026-10-04).
//
//   pnpm --filter backend images-marque
//
// Police Newsreader : SIL Open Font License 1.1 (usage dans un logo permis).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const MOBILE = join(import.meta.dirname, "../../mobile");
const IMAGES = join(MOBILE, "assets/images");
const MARQUE_DIR = join(MOBILE, "assets/marque");
/** Images de l'écran de démarrage, aux noms attendus par Xcode : recopiées
 * telles quelles par apps/mobile/plugins/demarrage-exact.js. */
const DEMARRAGE_DIR = join(MARQUE_DIR, "demarrage");

/** Couleurs de la marque : vert anglais (« British racing green ») et or pâle. */
export const MARQUE = { vertAnglais: "#004225", orPale: "#D9C48F", blanc: "#FFFFFF" } as const;

/** Part de la hauteur de l'icône occupée par le « S » (choisie sur essai : 56 %). */
const S_DANS_ICONE = 0.56;
/** Écran de démarrage : image CARRÉE de 111 points de côté (Expo n'accepte
 * que des images carrées : une autre forme serait réduite, donc adoucie),
 * fournie en @3x exact (333 × 333 px). */
export const DEMARRAGE = { cotePoints: 111 } as const;

// « S » de Newsreader Medium (unités de la police : 2000 par cadratin, axe
// vertical vers le haut) et ses bornes exactes, débordements compris.
const S_TRACE =
  "M933 1292 783 1324 902 1417 H942 L998 958 L929 950 L760 1258 L810 1198 Q756 1236 698.5 1252.5 Q641 " +
  "1269 575 1269 Q445 1269 376.0 1215.0 Q307 1161 307 1064 Q307 1001 335.0 958.5 Q363 916 412.0 886.5 " +
  "Q461 857 523.5 835.5 Q586 814 654 792 Q723 770 791.5 742.0 Q860 714 917.0 671.0 Q974 628 1008.5 " +
  "561.0 Q1043 494 1043 395 Q1043 257 977.0 164.5 Q911 72 794.5 25.0 Q678 -22 524 -22 Q420 -22 338.0 " +
  "-9.5 Q256 3 169 37 L87 404 H163 L407 39 L213 168 Q294 126 358.5 107.5 Q423 89 501 89 Q614 89 691.0 " +
  "115.0 Q768 141 807.5 195.0 Q847 249 847 331 Q847 404 812.5 451.5 Q778 499 720.5 529.5 Q663 560 594.5 " +
  "582.0 Q526 604 459 627 Q391 650 330.5 679.0 Q270 708 223.5 749.5 Q177 791 150.5 852.0 Q124 913 124 " +
  "1000 Q124 1116 180.5 1200.0 Q237 1284 343.0 1329.0 Q449 1374 594 1374 Q688 1374 768.5 1354.5 Q849 " +
  "1335 933 1292 Z ";
const S_BORNES = { x0: 87, y0: -22, x1: 1043, y1: 1417 } as const;

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
