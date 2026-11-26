import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { radius } from "../src/theme/tokens";

// Lot « vitrine » (retours du build 3, 26 novembre 2026) : une seule tuile de
// pièce pour toute l'app (« Écrin » : 4:5, coins doux, plus aucune bande, la
// photo entière sur une copie floue d'elle-même, filet très fin en thème
// clair), résultats et écran de publication resserrés, relecture d'une
// recherche pour ses grandes images. Pas de rendu de composants ici
// (vitest.config.ts) : les fichiers sont lus. La logique pure est testée dans
// piece-image.test.ts et spot-result.test.ts.
const MOBILE = join(__dirname, "..");
const SRC = join(MOBILE, "src");
const read = (path: string) => readFileSync(join(MOBILE, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Le contenu des accolades autour d'une position (un objet de style). */
function enclosingStyle(source: string, index: number): string {
  return source.slice(source.lastIndexOf("{", index) + 1, source.indexOf("}", index));
}

/** Une propriété d'un style nommé (`name: { … }`) d'un fichier, telle qu'écrite. */
function styleOf(source: string, name: string): string {
  const start = source.search(new RegExp(`\\n\\s*${name}: \\{`));
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("jetons de rayon des pièces", () => {
  it("permis : 14 pour les grandes images, 10 pour les grilles, 6 pour les vignettes", () => {
    expect(radius.piece).toBe(14);
    expect(radius.pieceGrid).toBe(10);
    expect(radius.pieceThumb).toBe(6);
  });

  it("refusé : radius.sm (bulles, verdict, squelettes) ne change pas", () => {
    expect(radius.sm).toBe(4);
    expect(radius.md).toBe(10);
  });
});

describe("une seule vitrine", () => {
  // Cadres 4:5 sur le fond des pièces encore permis hors de la tuile : aucun ne montre une photo
  // qui laisserait des bandes (case sans image, squelette, petite vignette contenue de la liste
  // triée, vignette de la feuille « Vous l'avez achetée ? », photo de l'ajout au Vault).
  const EXCEPTIONS = new Set([
    "components/piece-tile.tsx",
    "app/(app)/vault-item/new.tsx",
    "components/purchase-question-sheet.tsx",
    "components/proposal-card.tsx#rowImage",
    "components/wishlist-panel.tsx#thumb",
    "app/(app)/(tabs)/profile/index.tsx#vaultThumb",
  ]);

  it("refusé : aucun nouveau cadre 4:5 sur plinthe hors de piece-tile.tsx (les bandes reviendraient)", () => {
    const found: string[] = [];
    for (const path of sources(SRC)) {
      const source = readFileSync(path, "utf8");
      const file = relative(SRC, path);
      for (const match of source.matchAll(/aspectRatio: 4 \/ 5/g)) {
        const style = enclosingStyle(source, match.index!);
        if (!style.includes("color.plinthe")) continue;
        const name = source.slice(source.lastIndexOf("\n", source.lastIndexOf("{", match.index!)) + 1, source.lastIndexOf("{", match.index!)).trim().replace(/:$/, "");
        if (EXCEPTIONS.has(file) || EXCEPTIONS.has(`${file}#${name}`)) continue;
        found.push(`${file}#${name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("permis : l'exception nommée est bien une vignette contenue (refus détectable)", () => {
    // Le détecteur voit bien le cadre de la liste triée : la règle ne passe pas à vide.
    const card = read("src/components/proposal-card.tsx");
    expect(enclosingStyle(card, card.indexOf("aspectRatio: 4 / 5"))).toContain("color.plinthe");
  });

  it("les écrans des pièces utilisent PieceTile", () => {
    for (const path of [
      "src/app/(app)/spot/result.tsx",
      "src/components/proposal-card.tsx",
      "src/components/product-frame.tsx",
      "src/app/(app)/vault-item/[id].tsx",
      "src/app/look.tsx",
      "src/components/wishlist-panel.tsx",
      "src/app/(app)/(tabs)/profile/index.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain('import { PieceTile } from "@/components/piece-tile";');
      expect(source, path).toMatch(/<PieceTile\s/);
      // Refusé : plus de cadre étroit de 360 points.
      expect(source, path).not.toContain("maxWidth: 360");
    }
    // La grille des Envies et du Vault : la tuile de grille ; les grandes images : la grande tuile.
    expect(read("src/components/wishlist-panel.tsx")).toContain('<PieceTile variant="grid" size="card"');
    expect(read("src/components/proposal-card.tsx")).toContain('<PieceTile variant="grid" size="card"');
    expect(read("src/components/product-frame.tsx")).toContain('variant="hero"');
    expect(read("src/components/product-frame.tsx")).toContain("maxWidth: size.contentMaxWidth");
  });
});

describe("la tuile de pièce (components/piece-tile.tsx)", () => {
  const tile = read("src/components/piece-tile.tsx");

  it("fond : la copie floue de la vignette, jamais lue par VoiceOver ; ou la couleur des bords donnée", () => {
    expect(tile).toContain("blurRadius={24}");
    expect(tile).toMatch(/blurRadius=\{24\}\s+cachePolicy="memory-disk"\s+recyclingKey=\{recyclingKey\}\s+accessible=\{false\}/);
    expect(tile).toContain("transform: [{ scale: 1.2 }]");
    expect(tile).toContain("const background = edgeBackground(edgeColor);");
    expect(tile).toContain("{ backgroundColor: background }");
  });

  it("forme : 4:5, coupe aux coins doux en courbe continue, plinthe pendant le chargement", () => {
    expect(tile).toContain("aspectRatio: 4 / 5");
    expect(tile).toContain('overflow: "hidden"');
    expect(tile).toContain('borderCurve: "continuous"');
    expect(tile).toContain("hero: tile(radius.piece)");
    expect(tile).toContain("grid: tile(radius.pieceGrid)");
    expect(tile).toContain("backgroundColor: color.plinthe");
    expect(tile).not.toContain("maxWidth: 360");
  });

  it("filet très fin en thème clair seulement (refusé : un filet en sombre)", () => {
    expect(tile).toContain('borderWidth: getActiveScheme() === "light" ? StyleSheet.hairlineWidth : 0');
    expect(tile).toContain("borderColor: color.filet");
    // Recalculé à chaque thème (themedStyles).
    expect(tile).toContain("const styles = themedStyles(() => ({");
  });

  it("premier plan : remplie quand fillsTile, sinon la taille honnête, centrée", () => {
    expect(tile).toContain("fillsTile(naturalSize, frame, variant)");
    expect(tile).toContain("honestSize(naturalSize, frame, variant)");
    expect(tile).toContain("onImageSize={(measured) => setNatural({ uri: imageKey, size: measured })}");
    // Agrandissable : le libellé est porté une seule fois, par le bouton.
    expect(tile).toContain("accessibilityLabel={enlargeable ? undefined : accessibilityLabel}");
  });

  it("aucune couleur en dur, aucune dépendance nouvelle", () => {
    expect(tile).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    const imports = [...tile.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.filter((name) => !name.startsWith("@/"))).toEqual(["react", "react-native", "expo-image"]);
  });

  it("SpotImage rapporte la taille de l'image réellement affichée, sans changer le reste", () => {
    const image = read("src/components/spot-image.tsx");
    expect(image).toContain("onImageSize?: (size: ImageNaturalSize) => void;");
    expect(image).toContain('useReportSize(showHd && current.hd === "loaded" ? current.hdSize : showThumb ? current.thumbSize : null, onImageSize);');
    // Les cases qui ne demandent rien ne se redessinent pas au chargement.
    expect(image).toContain("onLoad={onImageSize ? (event) => setLoaded({ uri, size: naturalSize(event.source) }) : undefined}");
  });
});

describe("relecture des résultats pour les grandes images", () => {
  const screen = read("src/app/(app)/spot/result.tsx");

  it("fetchSearch à +6 s et +16 s, minuteurs et requête arrêtés quand l'écran se ferme", () => {
    expect(screen).toContain("fetchSearch(hdRereadSearchId, controller.signal)");
    expect(screen).toContain("const timers = [setTimeout(reread, 6000), setTimeout(reread, 16000)];");
    expect(screen).toContain("timers.forEach(clearTimeout);");
    expect(screen).toContain("controller.abort();");
    expect(screen).toContain("const next = withHdImages(current.result, search);");
    // Erreur réseau : ignorée en silence.
    expect(screen).toMatch(/withHdImages[\s\S]{0,400}\.catch\(\(\) => \{\}\);/);
    // Seulement une fois les boutiques arrivées.
    expect(screen).toContain("result && !shopsPending(result) && hdRereadDue(result) ? result.searchId : null");
  });

  it("refusé : lib/api.ts n'est pas modifié par ce lot (fetchSearch existe déjà)", () => {
    const api = read("src/lib/api.ts");
    expect(api).toContain("export async function fetchSearch(searchId: string, signal?: AbortSignal): Promise<ProductSearch>");
    let changed = "";
    try {
      changed = execFileSync("git", ["diff", "--name-only", "885956c", "--", "src/lib/api.ts"], { cwd: MOBILE, encoding: "utf8" });
    } catch {
      // Hors d'un dépôt git complet : la lecture ci-dessus suffit.
    }
    expect(changed.trim()).toBe("");
  });
});

describe("la grande carte et l'écran des résultats, resserrés", () => {
  const screen = read("src/app/(app)/spot/result.tsx");
  const bar = read("src/components/result-sort-bar.tsx");

  it("« Envoyer à un ami » et « Plus disponible ? » : visibles sur la carte, côte à côte, jamais sous « Plus »", () => {
    const links = screen.slice(screen.indexOf("<View style={styles.quietLinks}>"));
    expect(links.indexOf("<SendToFriendLink")).toBeGreaterThan(-1);
    expect(links.indexOf("<StockReportLink")).toBeGreaterThan(links.indexOf("<SendToFriendLink"));
    expect(links.indexOf("<StockReportLink")).toBeLessThan(links.indexOf("</View>"));
    expect(styleOf(screen, "quietLinks")).toContain('flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: space.lg');
    // Refusé : dans une feuille ou dans le menu « … ».
    const sheet = read("src/components/result-feedback-sheet.tsx");
    expect(sheet).not.toContain("SendToFriendLink");
    expect(sheet).not.toContain("StockReportLink");
    expect(read("src/components/stock-report-sheet.tsx")).toContain('testID="plus-disponible"');
  });

  it("le décompte et l'ordre sur une seule ligne grise", () => {
    expect(screen.match(/style=\{styles\.count\}/g)).toHaveLength(1);
    expect(screen).toContain('wordsLine].filter(Boolean).join(" · ")');
    expect(screen).toContain("<Text style={styles.count} numberOfLines={2}>");
    expect(styleOf(screen, "count")).toContain("marginBottom: space.xs");
  });

  it("rythme de la grande carte et de la grille", () => {
    expect(styleOf(screen, "rankLabel")).toContain("marginTop: 12");
    expect(styleOf(screen, "primary")).toContain("minHeight: 48");
    expect(styleOf(screen, "primary")).toContain("marginTop: space.sm");
    expect(styleOf(screen, "actions")).toContain("gap: space.sm, marginTop: space.sm");
    expect(styleOf(screen, "sectionTitle")).toContain("marginTop: space.lg, marginBottom: 12");
    expect(styleOf(screen, "grid")).toContain("rowGap: space.md");
    expect(styleOf(screen, "sendToFriend")).toContain("marginTop: 0");
  });

  it("barre de tri : résumé seul, puis les deux pastilles sur une ligne ; testID conservés", () => {
    expect(styleOf(bar, "bar")).toContain("marginBottom: 12");
    expect(styleOf(bar, "filters")).toContain('flexDirection: "row", flexWrap: "wrap", gap: space.sm');
    expect(bar).not.toContain("stockLine");
    for (const id of ['testID="result-sort-bar"', 'testID="with-price-only"', 'testID="in-stock-only"', 'testID="price-summary"']) expect(bar).toContain(id);
    expect(screen).toContain('testID="verdict-place"');
  });

  it("carte de la grille : « Boutique connue » et « En stock » côte à côte quand ça tient", () => {
    const card = read("src/components/proposal-card.tsx");
    expect(styleOf(card, "marks")).toContain('flexDirection: "row", flexWrap: "wrap", columnGap: space.sm');
    expect(styleOf(card, "rowImage")).toContain("borderRadius: radius.pieceThumb");
  });
});

describe("zones tactiles intactes", () => {
  it("44 points pour les segments, les pastilles, les liens ; aucun hitSlop ajouté", () => {
    const bar = read("src/components/result-sort-bar.tsx");
    expect(styleOf(bar, "segment")).toContain("minHeight: size.touchTarget");
    expect(styleOf(bar, "filter")).toContain("minHeight: size.touchTarget");
    expect(read("src/components/proposal-card.tsx")).toMatch(/shopLink: \{ minHeight: size\.touchTarget/);
    for (const path of ["src/components/send-to-friend-link.tsx", "src/components/stock-report-sheet.tsx", "src/components/spot-corrections.tsx"]) {
      expect(read(path), path).toMatch(/minHeight: (44|size\.touchTarget)/);
    }
    const publish = read("src/app/(app)/post-item/new.tsx");
    expect(styleOf(publish, "mode")).toContain("minHeight: size.touchTarget");
    // Refusé : un hitSlop dans les fichiers resserrés par ce lot (non géré sur le site).
    for (const path of ["src/components/result-sort-bar.tsx", "src/components/proposal-card.tsx", "src/components/piece-tile.tsx", "src/components/product-frame.tsx"]) {
      expect(read(path), path).not.toContain("hitSlop");
    }
  });
});

describe("écran « Nouvelle publication », resserré", () => {
  const publish = read("src/app/(app)/post-item/new.tsx");

  it("case vide pointillée de 168 points ; avec une photo, le carré d'avant, coins doux", () => {
    const empty = styleOf(publish, "photoEmpty");
    expect(empty).toContain("height: 168");
    expect(empty).toContain('borderStyle: "dashed"');
    expect(empty).toContain("borderColor: color.filet");
    expect(empty).not.toContain("aspectRatio");
    expect(styleOf(publish, "photoFilled")).toContain("aspectRatio: 1");
    expect(styleOf(publish, "photoFilled")).toContain("borderRadius: radius.piece");
    expect(publish).toContain("style={imageUri ? styles.photoFilled : styles.photoEmpty}");
  });

  it("marges : 8 en haut, 12 sous les modes et la légende, 16 / 8 autour des titres", () => {
    expect(styleOf(publish, "body")).toContain("paddingTop: space.sm");
    expect(styleOf(publish, "modes")).toContain("marginBottom: 12");
    expect(styleOf(publish, "caption")).toContain("marginTop: 12");
    expect(styleOf(publish, "label")).toContain("marginTop: space.md, marginBottom: space.sm");
  });
});

describe("coins doux partout où une pièce s'affiche", () => {
  const cases: Array<[string, string, string]> = [
    ["src/components/purchase-question-sheet.tsx", "thumb", "radius.pieceThumb"],
    ["src/components/wish-picker.tsx", "thumb", "radius.pieceThumb"],
    ["src/components/received-pieces.tsx", "thumb", "radius.pieceThumb"],
    ["src/app/(app)/collection-ami.tsx", "thumb", "radius.pieceThumb"],
    ["src/components/video-products.tsx", "thumb", "radius.pieceThumb"],
    ["src/components/moderation-item.tsx", "postImage", "radius.pieceThumb"],
    ["src/components/moderation-item.tsx", "itemImage", "radius.pieceThumb"],
    ["src/components/spot-entry.tsx", "thumb", "radius.pieceThumb"],
    ["src/app/(app)/post-item/new.tsx", "vaultThumb", "radius.pieceThumb"],
    ["src/app/(app)/post-item/new.tsx", "stripCell", "radius.pieceThumb"],
    ["src/components/friend-collections.tsx", "cover", "radius.pieceGrid"],
    ["src/components/message-wish-card.tsx", "image", "radius.pieceGrid"],
    ["src/components/message-post-card.tsx", "image", "radius.pieceGrid"],
    ["src/app/(app)/enregistrees.tsx", "cell", "radius.pieceGrid"],
    ["src/app/(app)/profil.tsx", "cell", "radius.pieceGrid"],
    ["src/app/(app)/(tabs)/profile/index.tsx", "thumb", "radius.pieceGrid"],
    ["src/components/post-card.tsx", "media", "radius.piece"],
    ["src/components/post-carousel.tsx", "frame", "radius.piece"],
    ["src/app/(app)/(tabs)/feed/index.tsx", "media", "radius.piece"],
    ["src/app/(app)/spot/video.tsx", "previewBox", "radius.piece"],
    ["src/components/video-link-analysis.tsx", "momentFrame", "radius.piece"],
    ["src/components/video-scrubber.tsx", "strip", "radius.piece"],
    ["src/components/image-unavailable.tsx", "frame", "radius.piece"],
  ];

  it.each(cases)("%s (%s) : %s, courbe continue, l'image suit l'arrondi", (path, name, token) => {
    const style = styleOf(read(path), name);
    expect(style).toContain(`borderRadius: ${token},`);
    expect(style).toContain('borderCurve: "continuous"');
    // Refusé : le coin presque carré d'avant.
    expect(style).not.toContain("radius.sm");
  });

  it("l'image coupée à l'arrondi là où il manquait (publication du fil, vignettes)", () => {
    expect(styleOf(read("src/components/post-card.tsx"), "media")).toContain('overflow: "hidden"');
    expect(styleOf(read("src/components/spot-entry.tsx"), "thumb")).toContain('overflow: "hidden"');
    expect(styleOf(read("src/components/moderation-item.tsx"), "postImage")).toContain('overflow: "hidden"');
  });
});
