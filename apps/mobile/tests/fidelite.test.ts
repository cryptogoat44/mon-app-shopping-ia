import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { surtitre } from "../src/theme/surtitre";

// Lot « fidélité aux maquettes » (lot 10, 26 novembre 2026) : les vrais écrans
// ressemblent aux maquettes « Écrin » approuvées par le fondateur (« tout ce
// que tu m'as montré me convient »), dans ses limites : « Envoyer à un ami » et
// « Plus disponible ? » jamais sous « Plus », aucun bouton pour une fonction
// absente, aucune phrase nécessaire retirée. Pas de rendu de composants ici
// (vitest.config.ts) : les fichiers sont lus. Un cas refusé et un cas permis par règle.
const SRC = join(__dirname, "..", "src");
const code = (path: string) => readFileSync(join(SRC, path), "utf8");

/** Un style nommé (`name: { … }`) d'un fichier, tel qu'écrit (styles plats, sur une ou plusieurs lignes). */
function styleOf(source: string, name: string): string {
  const start = source.search(new RegExp(`\\n\\s*${name}: \\{`));
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start) + 1);
}

const HOME = "app/(app)/(tabs)/index.tsx";

describe("pièces communes", () => {
  it("surtitre : 11 pt en capitales, défini une fois ; refusé : un surtitre écrit en dur ailleurs", () => {
    expect(surtitre.fontSize).toBe(11);
    expect(surtitre.textTransform).toBe("uppercase");
    expect(surtitre.lineHeight).toBe(14);
    const ecrans = [HOME, "app/(app)/spot/result.tsx", "app/(app)/envie.tsx", "app/(app)/settings.tsx", "components/result-sort-bar.tsx"];
    for (const path of ecrans) expect(code(path), path).not.toContain('textTransform: "uppercase"');
  });

  it("icônes : chevron vers la gauche, lien externe, sac coché ; refusé : l'icône de réglages du Résultat (décision 12)", () => {
    const icons = code("components/icons.tsx");
    expect(icons).toContain('direction: "up" | "down" | "left"');
    expect(icons).toContain("M14.5 6l-6 6 6 6");
    expect(icons).toContain("export function ExternalLinkIcon(");
    expect(icons).toContain("export function BagCheckIcon(");
    expect(icons).not.toContain("SlidersIcon");
  });

  it.each(["app/(app)/spot/lancer.tsx", "app/(app)/spot/lecteur.tsx", "app/(app)/spot/ciblage.tsx", "app/(app)/spot/video.tsx"])(
    "barre du haut de %s : 44 de haut, texte à 16 pt du bord, 17 pt en graisse 400 ; refusé : hitSlop sur la barre",
    (path) => {
      const screen = code(path);
      expect(styleOf(screen, "nav")).toContain("height: 44,");
      expect(styleOf(screen, "nav")).toContain("paddingHorizontal: 8");
      expect(styleOf(screen, "navSide")).toContain("minHeight: 44, minWidth: 44, paddingHorizontal: 8");
      for (const label of ["back", "close"]) expect(styleOf(screen, label)).toContain('fontSize: font.body, fontWeight: "400", color: color.encre');
      expect(screen).not.toMatch(/hitSlop=\{\d+\} style=\{\[?styles\.navSide/);
      expect(screen).not.toContain("height: 47");
    }
  );
});

describe("Spotter (maquettes 1-accueil)", () => {
  const home = code(HOME);
  const entry = code("components/link-entry.tsx");
  const tiles = code("components/spot-entry.tsx");
  const recent = code("components/recent-searches.tsx");

  it("gouttière de 16 pt ; refusé : 24 ; la largeur maximale du site ne change pas", () => {
    expect(styleOf(home, "content")).toContain("paddingHorizontal: space.md");
    expect(styleOf(home, "content")).not.toContain("paddingHorizontal: space.lg");
    expect(styleOf(home, "content")).toContain("maxWidth: 480");
  });

  it("champ du lien : un bloc plein ; refusé : le trait du bas, le texte d'attente supprimé, « Coller » souligné ou de moins de 44 pt", () => {
    expect(entry).not.toContain("t.spotter.linkPlaceholder");
    expect(styleOf(entry, "field")).not.toContain("borderBottomWidth");
    expect(styleOf(entry, "field")).toContain("minHeight: 52");
    expect(styleOf(entry, "field")).toContain("backgroundColor: color.surface");
    expect(styleOf(entry, "field")).toContain('getActiveScheme() === "light" ? 1 : 0');
    expect(styleOf(entry, "field")).not.toMatch(/\bheight: /);
    expect(styleOf(entry, "pasteLabel")).not.toContain("lienSouligne");
    expect(styleOf(entry, "pasteLabel")).toContain("color: color.encre");
    expect(styleOf(entry, "pasteButton")).toContain("minHeight: 44");
    expect(styleOf(entry, "pasteButton")).not.toContain("minHeight: 40");
    // Safari sur iPhone zoome la page sous 16 px : 16 sur le site.
    expect(styleOf(entry, "input")).toContain('fontSize: Platform.OS === "web" ? 16 : font.secondary');
    expect(entry).toContain("placeholder={label}");
    expect(entry).toContain("accessibilityLabel={label}");
    expect(entry).toContain('{Platform.OS === "web" ? <Text style={styles.hint}>{t.player.linkHintWeb}</Text> : null}');
    expect(fr.spotter).not.toHaveProperty("linkPlaceholder");
    expect(en.spotter).not.toHaveProperty("linkPlaceholder");
  });

  it("tuiles pleines aux libellés courts ; refusé : une hauteur fixe", () => {
    expect(styleOf(tiles, "tile")).toContain("minHeight: 76");
    expect(styleOf(tiles, "tile")).not.toMatch(/\n\s*height: /);
    expect(styleOf(tiles, "tile")).toContain("backgroundColor: color.surface");
    expect(tiles).toContain("accessibilityLabel={accessibilityLabel}");
    expect([fr.spotter.tileVideo, fr.spotter.tilePhoto, fr.spotter.tileCamera]).toEqual(["Vidéo", "Photo", "Appareil photo"]);
    expect([en.spotter.tileVideo, en.spotter.tilePhoto, en.spotter.tileCamera]).toEqual(["Video", "Photo", "Camera"]);
    // Toujours lus par VoiceOver, et ailleurs (lecteur, aide).
    for (const catalog of [fr, en]) {
      expect(catalog.spotter.addVideo).toBeTruthy();
      expect(catalog.spotter.addPhoto).toBeTruthy();
      expect(catalog.cameraCapture.takePhoto).toBeTruthy();
    }
  });

  it.each([
    ["fr", fr],
    ["en", en],
  ] as const)("%s : le nom lu de chaque tuile contient son libellé visible (Commande vocale) ; refusé : « Prendre une photo » seul sur la tuile de l'appareil", (_l, catalog) => {
    const lower = (text: string) => text.toLowerCase();
    expect(lower(catalog.spotter.addVideo)).toContain(lower(catalog.spotter.tileVideo));
    expect(lower(catalog.spotter.otherVideo)).toContain(lower(catalog.spotter.tileVideo));
    expect(lower(catalog.spotter.addPhoto)).toContain(lower(catalog.spotter.tilePhoto));
    expect(tiles).toContain("accessibilityLabel={`${t.spotter.tileCamera}, ${t.cameraCapture.takePhoto}`}");
    expect(tiles).not.toContain("accessibilityLabel={t.cameraCapture.takePhoto}");
  });

  it("les phrases qui nommaient les tuiles suivent leur nouveau nom ; refusé : l'ancien nom entre guillemets", () => {
    const anciens = ["« Ajouter une vidéo »", "« Ajouter une photo »", "« Prendre une photo »", "“Add a video”", "“Add a photo”", "“Take a photo”"];
    // Espaces insécables ramenés à des espaces : « » s'écrivent des deux façons dans les catalogues.
    const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");
    for (const path of ["i18n/fr.ts", "i18n/en.ts"]) for (const ancien of anciens) expect(plain(code(path)), `${path} ${ancien}`).not.toContain(ancien);
    expect(home).toContain("t.cameraCapture.unavailable(t.spotter.tilePhoto)");
    expect(home).toContain("t.share.imageUnreadable(t.spotter.tilePhoto)");
    expect(code("components/how-it-works.tsx")).toContain("t.firstTry.howItWorks.steps(t.spotter.tilePhoto)");
    expect(plain(fr.firstTry.howItWorks.steps(fr.spotter.tilePhoto).join(" "))).toContain("« Photo »");
    expect(plain(fr.spotter.latestVideoAskNote)).toContain("« Vidéo »");
    expect(en.settings.latestVideoOff).toContain("“Video”");
  });

  it("tuile « Appareil photo » : iPhone seulement ; refusé : proposée sans condition (le site n'a pas l'appareil)", () => {
    expect(home).toContain('takePhoto: Platform.OS === "ios" ? () => void takePhoto() : undefined,');
    expect(home).not.toMatch(/takePhoto: \(\) => void takePhoto\(\)/);
  });

  it("phrase du quota : gardée, raccourcie, sous le champ de recherche ; refusé : retirée ou au-dessus du champ", () => {
    expect(fr.retrouverPieces.recentLead).toContain("Rouvrir");
    expect(en.retrouverPieces.recentLead).toContain("Reopening");
    const header = home.slice(home.indexOf("function HistoryHeader("), home.indexOf("function HistoryFooter("));
    expect(header.indexOf("<HistorySearchField")).toBeGreaterThan(-1);
    expect(header.indexOf("{t.retrouverPieces.recentLead}")).toBeGreaterThan(header.indexOf("<HistorySearchField"));
  });

  it("« Récemment spottées » en Bodoni 23/34 ; refusé : le titre en police système 17", () => {
    expect(styleOf(home, "recentTitle")).toContain("fontFamily: serifFont");
    expect(styleOf(home, "recentTitle")).toContain("fontSize: font.title, lineHeight: serifLineHeight.title");
    expect(styleOf(home, "recentTitle")).not.toContain("font.body");
  });

  it("grille : 8 pt entre les colonnes, nom sur une ligne ; refusé : deux lignes réservées", () => {
    expect(recent).toContain("cellLeft: { paddingRight: 4 }");
    expect(recent).toContain("cellRight: { paddingLeft: 4 }");
    expect(styleOf(recent, "name")).not.toContain("minHeight");
    expect(recent).toContain("<Text style={styles.name} numberOfLines={1}>");
    expect(styleOf(recent, "searchBar")).toContain("backgroundColor: color.surface");
    expect(styleOf(recent, "searchBar")).not.toContain("radius.full");
  });
});
