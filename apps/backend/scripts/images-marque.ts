// Images de la marque (lot 3bis) : icône de l'app, écrans de démarrage,
// icônes Android et icône du site. Toutes sont calculées à partir d'un TRACÉ
// vectoriel — le « S » de Bodoni Moda Medium (la police du logo, choisie par
// le fondateur le 2026-11-17), lu dans le fichier de police du dépôt et
// converti en contours — et rendues DIRECTEMENT à leur taille finale : aucune
// image n'est jamais agrandie, aucun filtre ni flou.
//
// Dessin : « Émail de chevalière », validé par le fondateur le 2026-11-25
// (lot « couleurs et logo ») : « S » en or poli (dégradé à huit arrêts,
// lumière venue du haut à gauche) sur un émail vert anglais (dégradé
// vertical), une lueur ovale très douce dans le tiers haut (le vernis) et,
// sous le « S », une ombre à peine visible (le sertissage). Il remplace
// l'aplat sans dégradé du 2026-10-04 (« S » or pâle #D9C48F).
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

/** Couleurs unies de la marque : vert anglais (« British racing green »), fond
 * de l'icône Android et « S » de l'écran de démarrage clair ; blanc de l'icône
 * Android monochrome. */
export const MARQUE = { vertAnglais: "#004225", blanc: "#FFFFFF" } as const;

/** Un arrêt de dégradé : position (0 à 1), couleur, opacité. */
type Arret = readonly [position: number, couleur: string, opacite?: number];

/** L'émail : dégradé vertical du fond, de haut en bas (sans ombre sur les bords). */
export const EMAIL: readonly Arret[] = [
  [0, MARQUE.vertAnglais],
  [0.55, "#003B21"],
  [1, "#00301B"],
];

/** Le vernis : une lueur ovale très douce, centrée dans le tiers haut de
 * l'icône (dessin de 1024 unités), loin des bords ; 15 % d'opacité au plus. */
export const VERNIS = {
  cx: 512,
  cy: 215,
  rayon: 640,
  aplatissement: 0.42,
  arrets: [
    [0, "#7FCFA3", 0.15],
    [0.4, "#7FCFA3", 0.1],
    [0.75, "#7FCFA3", 0.035],
    [1, "#7FCFA3", 0],
  ] as readonly Arret[],
} as const;

/** L'or poli du « S » : huit arrêts, du clair (en haut à gauche) au plus
 * sombre (en bas à droite). Positions données en unités de la police, dans
 * le repère du tracé (axe vertical vers le haut), comme sur le dessin validé :
 * le reflet suit la lettre quelle que soit sa taille. */
export const OR_POLI = {
  x1: 66.5,
  y1: 1582,
  x2: 1226,
  y2: -132,
  arrets: [
    [0, "#F6E096"],
    [0.2, "#EBCB6A"],
    [0.4, "#CFA640"],
    [0.5, "#B8912F"],
    [0.58, "#D9B44E"],
    [0.7, "#F3DC8E"],
    [0.82, "#D4AE45"],
    [1, "#A8832A"],
  ] as readonly Arret[],
} as const;

/** Le sertissage : sous le « S », une ombre à peine visible (décalée de 2
 * unités vers le bas, 12 % d'opacité). */
export const SERTISSAGE = { couleur: "#001A0D", opacite: 0.12, decalage: 2 } as const;

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

function arrets(liste: readonly Arret[]): string {
  return liste.map(([position, couleur, opacite]) => `<stop offset="${position}" stop-color="${couleur}"${opacite === undefined ? "" : ` stop-opacity="${opacite}"`}/>`).join("");
}

/** Les trois dégradés du logo, à placer dans un document : `url(#email)`, `url(#vernis)`, `url(#or)`. */
export function degrades(): string {
  const { cx, cy, rayon, aplatissement } = VERNIS;
  return (
    "<defs>" +
    `<linearGradient id="email" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">${arrets(EMAIL)}</linearGradient>` +
    `<radialGradient id="vernis" cx="${cx}" cy="${cy}" r="${rayon}" gradientUnits="userSpaceOnUse" gradientTransform="translate(${cx} ${cy}) scale(1 ${aplatissement}) translate(${-cx} ${-cy})">${arrets(VERNIS.arrets)}</radialGradient>` +
    `<linearGradient id="or" x1="${OR_POLI.x1}" y1="${OR_POLI.y1}" x2="${OR_POLI.x2}" y2="${OR_POLI.y2}" gradientUnits="userSpaceOnUse">${arrets(OR_POLI.arrets)}</linearGradient>` +
    "</defs>"
  );
}

/** Fond de l'icône (1024 unités) : l'émail et son vernis. */
export function email(): string {
  return `<rect width="1024" height="1024" fill="url(#email)"/><rect width="1024" height="1024" fill="url(#vernis)"/>`;
}

/** Le « S » en or poli posé au centre (cx, cy), haut de `hauteur` unités, sur son sertissage. */
export function sOrPoli(cx: number, cy: number, hauteur: number): string {
  const ombre = `<g transform="translate(0 ${SERTISSAGE.decalage})" opacity="${SERTISSAGE.opacite}">${lettre(SERTISSAGE.couleur, cx, cy, hauteur)}</g>`;
  return `${ombre}${lettre("url(#or)", cx, cy, hauteur)}`;
}

/** Document SVG : dessin de `largeur × hauteur` unités, rendu à `sortieL × sortieH` pixels. */
export function document(largeur: number, hauteur: number, contenu: string, sortieL = largeur, sortieH = hauteur): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sortieL}" height="${sortieH}" viewBox="0 0 ${largeur} ${hauteur}">${contenu}</svg>`;
}

/** Icône carrée (« S » or poli sur émail vert anglais verni), dessinée sur 1024 unités. */
export function icone(): string {
  return `${degrades()}${email()}${sOrPoli(512, 512, 1024 * S_DANS_ICONE)}`;
}

/** Les deux calques de l'icône iPhone (Icon Composer), chacun plein cadre : l'émail verni, et le « S » sur fond transparent. */
export function calquesApple(): { email: string; s: string } {
  return { email: document(1024, 1024, `${degrades()}${email()}`), s: document(1024, 1024, `${degrades()}${sOrPoli(512, 512, 1024 * S_DANS_ICONE)}`) };
}

/** Couleur « #RRGGBB » au format d'Icon Composer (« srgb:r,g,b,a », de 0 à 1). */
function srgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5));
  return `srgb:${r},${g},${b},1.00000`;
}

/** Icône iPhone au format d'Apple (Icon Composer, iOS 26) : deux calques
 * VECTORIELS, que l'iPhone dessine lui-même à chaque taille — le « S » en or
 * poli (en premier : le calque du dessus) et, dessous, l'émail verni plein
 * cadre (même mécanisme que le calque du « S » : aucune clé de dégradé
 * d'Icon Composer, seulement les clés déjà employées ici). Le fond uni vert
 * anglais reste derrière. Le verre (« Liquid Glass »), le reflet, l'ombre et
 * la transparence sont désactivés : avec une simple image, iOS 26 les ajoute
 * d'office (halo et reflet constatés sur le simulateur). Ne peut pas être
 * essayé ici (il faut Xcode) : voir BUILD-IPHONE.md. */
function iconeApple(dossier: string): void {
  mkdirSync(join(dossier, "Assets"), { recursive: true });
  const calques = calquesApple();
  writeFileSync(join(dossier, "Assets", "S.svg"), `${calques.s}\n`);
  writeFileSync(join(dossier, "Assets", "Email.svg"), `${calques.email}\n`);
  const description = {
    fill: { solid: srgb(MARQUE.vertAnglais) },
    groups: [
      {
        layers: [
          { glass: false, "image-name": "S.svg", name: "S" },
          { glass: false, "image-name": "Email.svg", name: "Email" },
        ],
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

/** Android : hauteur du « S » dans l'icône adaptative (zone sûre : 72 sur 108). */
export const S_ANDROID = 1024 * S_DANS_ICONE * (72 / 108);

/** Écran de démarrage clair (fond clair d'app.json) : « S » vert anglais en
 * aplat — un dégradé or ne se lirait pas sur un fond clair. Toute la hauteur
 * de l'image, à un point près en haut et en bas. */
export function sDemarrageClair(): string {
  const cote = DEMARRAGE.cotePoints;
  return lettre(MARQUE.vertAnglais, cote / 2, cote / 2, cote - 2);
}

/** Écran de démarrage sombre : « S » en or poli, sans sertissage (l'ombre
 * vert profond n'a de sens que sur l'émail). */
export function sDemarrageSombre(): string {
  const cote = DEMARRAGE.cotePoints;
  return `${degrades()}${lettre("url(#or)", cote / 2, cote / 2, cote - 2)}`;
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
  for (const [nom, dessin] of [["image", sDemarrageClair], ["dark_image", sDemarrageSombre]] as const) {
    for (const [echelle, suffixe] of [[1, ""], [2, "@2x"], [3, "@3x"]] as const) {
      await png(document(cote, cote, dessin(), cote * echelle, cote * echelle), join(DEMARRAGE_DIR, `${nom}${suffixe}.png`), false);
    }
  }
  // Android (icône adaptative) : « S » en or poli dans la zone sûre, fond uni = couleur d'app.json.
  await png(document(1024, 1024, `${degrades()}${sOrPoli(512, 512, S_ANDROID)}`), join(IMAGES, "android-icon-foreground.png"), false);
  await png(document(1024, 1024, lettre(MARQUE.blanc, 512, 512, S_ANDROID)), join(IMAGES, "android-icon-monochrome.png"), false);
  process.stdout.write("Images de la marque générées : marque/Spotto.icon, icon.png, favicon.png, android-icon-*.png, marque/icone.svg, marque/demarrage/*.png\n");
}

if (process.argv[1]?.endsWith("images-marque.ts")) {
  main().catch((error: unknown) => {
    console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
