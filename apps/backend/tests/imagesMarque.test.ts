import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { contourLettre } from "../scripts/lib/contour-police.js";
import { DEMARRAGE, EMAIL, MARQUE, OR_POLI, POLICE_DU_LOGO, SERTISSAGE, S_ANDROID, S_DANS_ICONE, VERNIS, calquesApple, document, icone, sDemarrageSombre } from "../scripts/images-marque.js";

// Lot « identité de marque » (décision du fondateur, 2026-11-17) : l'icône et
// les écrans de démarrage montrent le « S » de Bodoni Moda Medium, lu dans le
// fichier de police du dépôt par scripts/images-marque.ts. Ce fichier vérifie
// la police, la lecture du contour, et que les images enregistrées dans
// apps/mobile/assets sont bien celles que le script produit. Depuis le
// 2026-11-25 (lot « couleurs et logo ») : le dessin « Émail de chevalière »,
// « S » en or poli sur émail vert anglais verni.
// Pas besoin de la base : il tourne aussi dans « Tests serveur hors base ».
// Aucun module du serveur n'est importé ici : le serveur interdit à sharp de
// lire les SVG (lib/imageSafety.ts), le script en a besoin.

const ASSETS = join(__dirname, "../../mobile/assets");
const BODONI_SHA256 = "ba0aaf95aa18d8c91c67f64085cebce6f6000e2b3e4ab3140400e31e803d6b84";
const police = readFileSync(POLICE_DU_LOGO);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

interface Pixels {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

async function pixels(image: string | Buffer): Promise<Pixels> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/** Bornes des pixels pour lesquels `estLettre` dit vrai (bord droit et bas exclus). */
function bornes({ data, width, height, channels }: Pixels, estLettre: (pixel: Buffer) => boolean) {
  let [x0, y0, x1, y1] = [width, height, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const debut = (y * width + x) * channels;
      if (!estLettre(data.subarray(debut, debut + channels))) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
    }
  }
  return { x0, y0, x1, y1, largeur: x1 - x0, hauteur: y1 - y0, centreX: (x0 + x1) / 2, centreY: (y0 + y1) / 2 };
}

/** Écart moyen entre deux images de même taille, de 0 (identiques) à 255. */
function ecartMoyen(a: Pixels, b: Pixels): number {
  expect([a.width, a.height, a.channels]).toEqual([b.width, b.height, b.channels]);
  let total = 0;
  for (let i = 0; i < a.data.length; i++) total += Math.abs(a.data[i]! - b.data[i]!);
  return total / a.data.length;
}

describe("police du logo : un fichier du dépôt, sous licence libre", () => {
  const dossier = dirname(POLICE_DU_LOGO);

  it("Bodoni Moda Medium et sa licence SIL OFL 1.1 sont dans le dépôt, copie exacte du paquet de l'app", () => {
    expect(existsSync(POLICE_DU_LOGO)).toBe(true);
    expect(createHash("sha256").update(police).digest("hex")).toBe(BODONI_SHA256);
    const licence = readFileSync(join(dossier, "OFL-BodoniModa.txt"), "utf8");
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(licence).toContain("Copyright 2020 The Bodoni Moda Project Authors");
    const notice = readFileSync(join(dossier, "LISEZ-MOI.md"), "utf8");
    expect(notice).toContain(BODONI_SHA256);
    expect(notice).toContain("OFL-BodoniModa.txt");
    expect(notice).toContain("@expo-google-fonts/bodoni-moda");
  });

  it("le fichier est bien Bodoni Moda Medium (nom inscrit dans la police)", () => {
    // Les noms sont écrits en UTF-16 dans le fichier.
    expect(police.includes(Buffer.from("Bodoni Moda Medium", "utf16le").swap16())).toBe(true);
  });
});

describe("contour d'une lettre lu dans le fichier de police", () => {
  const nombres = (trace: string) => [...trace.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  it("le « S » : un seul contour fermé, exactement dans les bornes déclarées par la police", () => {
    const s = contourLettre(police, "S");
    expect(s.unitesParCadratin).toBe(2000);
    expect(s.bornes).toEqual({ x0: 108, y0: -29, x1: 1094, y1: 1520 });
    expect(s.trace).toMatch(/^M-?[\d.]+ -?[\d.]+ (?:[LQ]-?[\d.]+(?: -?[\d.]+)+ )+Z$/);
    expect(s.trace.match(/M/g)).toHaveLength(1);
    // Des courbes (un « S » n'a presque pas de droites) et quelques droites (ses empattements).
    expect(s.trace.match(/Q/g)!.length).toBeGreaterThan(30);
    expect(s.trace.match(/L/g)!.length).toBeGreaterThan(5);
    const valeurs = nombres(s.trace);
    const xs = valeurs.filter((_, i) => i % 2 === 0);
    const ys = valeurs.filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]).toEqual([108, -29, 1094, 1520]);
  });

  it("une lettre à deux contours (« O » : l'extérieur et le trou) ; chaque lettre a son dessin", () => {
    const o = contourLettre(police, "O");
    expect(o.trace.match(/M/g)).toHaveLength(2);
    expect(o.trace.match(/Z/g)).toHaveLength(2);
    expect(contourLettre(police, "P").trace).not.toBe(o.trace);
    // Un « H » de Bodoni : rien que des droites.
    expect(contourLettre(police, "H").trace).not.toContain("Q");
  });

  it("le dessin rendu est bien un « S » : plein au centre, en haut à gauche et en bas à droite, vide en haut à droite et en bas à gauche", async () => {
    const { trace, bornes: b } = contourLettre(police, "S");
    const [largeur, hauteur] = [b.x1 - b.x0, b.y1 - b.y0];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur / 10}" height="${hauteur / 10}" viewBox="${b.x0} ${-b.y1} ${largeur} ${hauteur}"><path transform="scale(1 -1)" d="${trace}"/></svg>`;
    const image = await pixels(await sharp(Buffer.from(svg)).ensureAlpha().png().toBuffer());
    const encre = (x: number, y: number) => image.data[(Math.round(y * image.height) * image.width + Math.round(x * image.width)) * image.channels + 3]! > 128;
    // La diagonale du « S » descend de gauche à droite et passe par le centre
    // (une lettre dessinée à l'envers, ou en miroir, échouerait ici).
    expect(encre(0.5, 0.5)).toBe(true);
    expect(encre(0.15, 0.3)).toBe(true);
    expect(encre(0.9, 0.7)).toBe(true);
    expect(encre(0.8, 0.35)).toBe(false);
    expect(encre(0.2, 0.65)).toBe(false);
    const dessin = bornes(image, (pixel) => pixel[3]! > 128);
    expect(Math.abs(dessin.largeur - image.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(dessin.hauteur - image.height)).toBeLessThanOrEqual(2);
  });

  it("ce qui n'est pas géré est refusé par une erreur claire, jamais dessiné à moitié", () => {
    expect(() => contourLettre(police, "É")).toThrow("composé de plusieurs dessins");
    expect(() => contourLettre(police, " ")).toThrow("n'a pas de dessin");
    expect(() => contourLettre(police, "字")).toThrow("ne contient pas le caractère");
    expect(() => contourLettre(police, "SS")).toThrow("Un seul caractère");
    expect(() => contourLettre(police, "")).toThrow("Un seul caractère");
    expect(() => contourLettre(Buffer.from("ceci n'est pas une police"), "S")).toThrow("fichier TrueType");
    expect(() => contourLettre(Buffer.alloc(0), "S")).toThrow("fichier TrueType");
  });
});

describe("le dessin validé : « Émail de chevalière » (2026-11-25)", () => {
  it("émail vert anglais en dégradé vertical, vernis très doux (15 % au plus), or poli à huit arrêts, sertissage à peine visible", () => {
    expect(EMAIL).toEqual([[0, "#004225"], [0.55, "#003B21"], [1, "#00301B"]]);
    expect(Math.max(...VERNIS.arrets.map(([, , opacite]) => opacite ?? 1))).toBeLessThanOrEqual(0.15);
    expect(VERNIS.arrets.at(-1)).toEqual([1, "#7FCFA3", 0]);
    expect(VERNIS.cy).toBeLessThan(1024 / 3);
    expect(OR_POLI.arrets).toHaveLength(8);
    expect(OR_POLI.arrets[0]).toEqual([0, "#F6E096"]);
    expect(OR_POLI.arrets.at(-1)).toEqual([1, "#A8832A"]);
    // Lumière venue du haut à gauche : le dégradé part du haut à gauche du « S » (repère de la police, axe vers le haut).
    const { bornes: b } = contourLettre(police, "S");
    expect(OR_POLI.x1).toBeLessThan(b.x0);
    expect(OR_POLI.y1).toBeGreaterThan(b.y1);
    expect(OR_POLI.x2).toBeGreaterThan(b.x1);
    expect(OR_POLI.y2).toBeLessThan(b.y0);
    expect(SERTISSAGE).toEqual({ couleur: "#001A0D", opacite: 0.12, decalage: 2 });
  });

  it("aucun filtre, aucun texte, aucune image : seulement des formes et des dégradés (le garde-fou voit un filtre)", () => {
    const interdit = /<(filter|text|image|feGaussianBlur)\b/;
    for (const svg of [icone(), calquesApple().s, calquesApple().email, sDemarrageSombre()]) expect(svg).not.toMatch(interdit);
    expect(`<filter id="flou"><feGaussianBlur stdDeviation="4"/></filter>`).toMatch(interdit);
  });
});

describe("images de la marque enregistrées (apps/mobile/assets) : celles que le script produit", () => {
  const vert = rgb(MARQUE.vertAnglais);
  const basEmail = rgb(EMAIL.at(-1)![1]);
  /** Un pixel doré : rouge et vert hauts, bleu nettement plus bas (l'émail vert n'a presque pas de rouge). */
  const estOr = (pixel: Buffer) => pixel[0]! > 120 && pixel[1]! > 90 && pixel[0]! - pixel[2]! > 50;

  it("les dessins vectoriels (référence, et les deux calques de l'icône iPhone) sont exactement ceux du script", () => {
    expect(readFileSync(join(ASSETS, "marque/icone.svg"), "utf8")).toBe(`${document(1024, 1024, icone())}\n`);
    expect(readFileSync(join(ASSETS, "marque/Spotto.icon/Assets/S.svg"), "utf8")).toBe(`${calquesApple().s}\n`);
    expect(readFileSync(join(ASSETS, "marque/Spotto.icon/Assets/Email.svg"), "utf8")).toBe(`${calquesApple().email}\n`);
    expect(icone()).toContain(contourLettre(police, "S").trace);
    expect(calquesApple().s).toContain(contourLettre(police, "S").trace);
    // Icône iPhone (Icon Composer) : fond uni vert anglais, puis deux calques
    // vectoriels — le « S » d'abord (dessus), l'émail plein cadre dessous —,
    // ni verre ni reflet. Aucune autre clé que celles du fichier d'avant.
    const description = JSON.parse(readFileSync(join(ASSETS, "marque/Spotto.icon/icon.json"), "utf8"));
    expect(description.fill).toEqual({ solid: "srgb:0.00000,0.25882,0.14510,1.00000" });
    expect(description.groups).toEqual([
      {
        layers: [
          { glass: false, "image-name": "S.svg", name: "S" },
          { glass: false, "image-name": "Email.svg", name: "Email" },
        ],
        shadow: { kind: "none", opacity: 0 },
        specular: false,
        translucency: { enabled: false, value: 0 },
      },
    ]);
    expect(Object.keys(description).sort()).toEqual(["fill", "groups", "supported-platforms"]);
  });

  it("les deux calques de l'icône iPhone, superposés, donnent exactement l'icône de l'app", async () => {
    const { s, email } = calquesApple();
    const superposes = await sharp(Buffer.from(email)).composite([{ input: await sharp(Buffer.from(s)).png().toBuffer() }]).removeAlpha().png().toBuffer();
    expect(ecartMoyen(await pixels(superposes), await pixels(join(ASSETS, "images/icon.png")))).toBeLessThan(1);
    // Le calque du « S » est transparent hors de la lettre.
    const calque = await pixels(await sharp(Buffer.from(s)).ensureAlpha().png().toBuffer());
    expect(calque.data[3]).toBe(0);
  });

  it("icône de l'app : 1024 × 1024, opaque, « S » or poli centré sur l'émail vert anglais, à 60 % de la hauteur", async () => {
    const fichier = join(ASSETS, "images/icon.png");
    expect(await sharp(fichier).metadata()).toMatchObject({ format: "png", width: 1024, height: 1024, hasAlpha: false });
    const image = await pixels(fichier);
    const s = bornes(image, estOr);
    expect(S_DANS_ICONE).toBe(0.6);
    expect(Math.abs(s.hauteur - 1024 * S_DANS_ICONE)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.centreX - 512)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.centreY - 512)).toBeLessThanOrEqual(1);
    // Marges confortables : au moins 19 % en haut et en bas, 30 % sur les côtés.
    expect(s.y0).toBeGreaterThanOrEqual(1024 * 0.19);
    expect(1024 - s.y1).toBeGreaterThanOrEqual(1024 * 0.19);
    expect(s.x0).toBeGreaterThanOrEqual(1024 * 0.3);
    expect(1024 - s.x1).toBeGreaterThanOrEqual(1024 * 0.3);
    // Les coins : le vert anglais en haut, le bas de l'émail en bas, exactement (le vernis ne touche pas les bords).
    const coin = (x: number, y: number) => [...image.data.subarray((y * 1024 + x) * 3, (y * 1024 + x) * 3 + 3)];
    expect([coin(0, 0), coin(1023, 0)]).toEqual([vert, vert]);
    expect([coin(0, 1023), coin(1023, 1023)]).toEqual([basEmail, basEmail]);
    // Le vernis éclaire le tiers haut : au centre, plus clair en haut qu'en bas.
    expect(coin(512, 120)[1]!).toBeGreaterThan(coin(512, 900)[1]! + 15);
    // … et c'est bien l'image que le script dessine aujourd'hui (au lissage près, d'une machine à l'autre).
    const attendu = await pixels(await sharp(Buffer.from(document(1024, 1024, icone()))).removeAlpha().png().toBuffer());
    expect(ecartMoyen(image, attendu)).toBeLessThan(1);
  });

  it("icône du site : 48 × 48, opaque, le même dessin", async () => {
    const fichier = join(ASSETS, "images/favicon.png");
    expect(await sharp(fichier).metadata()).toMatchObject({ format: "png", width: 48, height: 48, hasAlpha: false });
    const attendu = await pixels(await sharp(Buffer.from(document(1024, 1024, icone(), 48, 48))).removeAlpha().png().toBuffer());
    expect(ecartMoyen(await pixels(fichier), attendu)).toBeLessThan(2);
  });

  it("icônes Android : fond transparent, « S » centré dans la zone sûre (les deux tiers de la taille de l'icône), or poli ou blanc", async () => {
    expect(S_ANDROID).toBeCloseTo(1024 * S_DANS_ICONE * (72 / 108), 6);
    for (const [nom, couleur] of [["android-icon-foreground.png", null], ["android-icon-monochrome.png", rgb(MARQUE.blanc)]] as const) {
      const fichier = join(ASSETS, "images", nom);
      expect(await sharp(fichier).metadata(), nom).toMatchObject({ format: "png", width: 1024, height: 1024, hasAlpha: true });
      const image = await pixels(fichier);
      const s = bornes(image, (pixel) => pixel[3]! > 128);
      expect(Math.abs(s.hauteur - 1024 * S_DANS_ICONE * (72 / 108)), nom).toBeLessThanOrEqual(2);
      expect(Math.abs(s.centreX - 512), nom).toBeLessThanOrEqual(1);
      expect(Math.abs(s.centreY - 512), nom).toBeLessThanOrEqual(1);
      const centre = (512 * 1024 + 512) * 4;
      if (couleur) expect([...image.data.subarray(centre, centre + 4)], nom).toEqual([...couleur, 255]);
      else expect(estOr(image.data.subarray(centre, centre + 4)) && image.data[centre + 3] === 255, nom).toBe(true);
      expect(image.data[3], nom).toBe(0);
    }
  });

  it("écrans de démarrage : carrés de 111 points en ×1, ×2 et ×3, « S » vert anglais en aplat (clair) ou or poli (sombre) sur fond transparent", async () => {
    expect(DEMARRAGE.cotePoints).toBe(111);
    for (const [nom, couleur] of [["image", vert], ["dark_image", null]] as const) {
      for (const [echelle, suffixe] of [[1, ""], [2, "@2x"], [3, "@3x"]] as const) {
        const fichier = join(ASSETS, "marque/demarrage", `${nom}${suffixe}.png`);
        const cote = DEMARRAGE.cotePoints * echelle;
        expect(await sharp(fichier).metadata(), fichier).toMatchObject({ format: "png", width: cote, height: cote, hasAlpha: true });
        const image = await pixels(fichier);
        const s = bornes(image, (pixel) => pixel[3]! > 128);
        // Le « S » occupe toute la hauteur, à un point près en haut et en bas.
        expect(Math.abs(s.hauteur - (DEMARRAGE.cotePoints - 2) * echelle), fichier).toBeLessThanOrEqual(2);
        expect(Math.abs(s.centreX - cote / 2), fichier).toBeLessThanOrEqual(1);
        expect(Math.abs(s.centreY - cote / 2), fichier).toBeLessThanOrEqual(1);
        // Clair : une seule couleur, exactement le vert anglais. Sombre : chaque
        // pixel plein est doré, en dégradé (bien plus que quelques teintes).
        let pleins = 0;
        let autres = 0;
        const teintes = new Set<number>();
        for (let i = 0; i < image.data.length; i += 4) {
          if (image.data[i + 3] !== 255) continue;
          pleins += 1;
          const pixel = image.data.subarray(i, i + 4);
          teintes.add(pixel.readUIntBE(0, 3));
          const juste = couleur ? pixel[0] === couleur[0] && pixel[1] === couleur[1] && pixel[2] === couleur[2] : estOr(pixel);
          if (!juste) autres += 1;
        }
        expect(pleins, fichier).toBeGreaterThan(cote * cote * 0.1);
        expect(autres, fichier).toBe(0);
        if (couleur) expect(teintes.size, fichier).toBe(1);
        else expect(teintes.size, fichier).toBeGreaterThan(20);
        expect(image.data[3], fichier).toBe(0);
      }
    }
  });
});
