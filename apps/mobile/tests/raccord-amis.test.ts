import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Raccord (lot 11 des retours du build 3) : le lot « amis par défaut » posé
// sur la nouvelle interface. Rien ne change dans ce que font les étagères des
// amis (tests/etageres-amis.test.ts) : seulement leur forme, aux règles des
// lots « vitrine », « fidélité aux maquettes », « barre flottante » et
// « couleurs et logo ». Un cas refusé et un cas permis par règle.

const SRC = join(__dirname, "../src");
const source = (path: string) => readFileSync(join(SRC, path), "utf8");

/** La définition d'un style d'une feuille (une ligne `nom: { … }`). */
function styleOf(code: string, name: string): string {
  const line = code.split("\n").find((l) => new RegExp(`^\\s*${name}: \\{`).test(l));
  return line ?? "";
}

const grid = source("components/friend-shelf-grid.tsx");
const setting = source("components/friend-shelves-setting.tsx");
const notice = source("components/friend-shelves-notice.tsx");

describe("étagères d'un ami : la tuile « Écrin » de toute l'app", () => {
  it("permis : la case passe par la tuile de grille, la feuille par la grande tuile", () => {
    expect(grid).toContain('import { PieceTile } from "@/components/piece-tile";');
    expect(grid).toContain('<PieceTile variant="grid" size={shelfCellImageSize(entry.kind)}');
    expect(grid).toContain('<PieceTile variant="hero" size="large"');
    // Sans image : « Image indisponible » à la place de la tuile, au même rayon.
    expect(styleOf(grid, "cellEmpty")).toContain("aspectRatio: 4 / 5");
    expect(styleOf(grid, "cellEmpty")).toContain("radius.pieceGrid");
  });

  it("refusé : plus de cadre à elle (carré, rayon des bulles, image posée à la main)", () => {
    expect(grid).not.toContain("<SpotImage");
    expect(grid).not.toContain("aspectRatio: 1");
    expect(grid).not.toMatch(/radius\.(sm|md)\b.*overflow|borderRadius: radius\.sm/);
    // La case ne dessine plus de fond de pièce : c'est la tuile qui le fait.
    expect(styleOf(grid, "cell")).not.toContain("color.plinthe");
  });

  it("la feuille n'est pas une fiche de pièce : ni zoom ni pleine définition (refusé), largeur du texte (permis)", () => {
    expect(grid).not.toMatch(/enlargeable|fullResolution/);
    expect(styleOf(grid, "image")).toContain("maxWidth: size.contentMaxWidth");
  });

  it("couleur des bords : rien n'est branché pour un ami (la réponse d'une étagère ne la porte pas)", () => {
    expect(grid).not.toContain("edgeColor=");
    // Permis : la grille de son propre Vault la passe, elle (le détecteur voit bien la prop).
    expect(source("app/(app)/(tabs)/profile/index.tsx")).toContain("edgeColor={item.edgeColor}");
  });

  it("« Fermer » de la feuille : un bouton à la couleur du texte (refusé : l'accent sans soulignement)", () => {
    expect(styleOf(grid, "closeLabel")).toContain("color: color.encre");
    expect(styleOf(grid, "closeLabel")).not.toContain("color.vert");
  });
});

describe("Réglages : les deux réglages des amis comme les autres", () => {
  it("permis : l'interrupteur commun (site compris) et ses couleurs communes", () => {
    expect(setting).toContain('import { Switch } from "@/components/switch";');
    expect(setting).toContain("{...couleursInterrupteur(value[shelf])}");
  });

  it("refusé : le Switch brut de React Native et une piste écrite à la main", () => {
    expect(setting).not.toMatch(/import \{[^}]*\bSwitch\b[^}]*\} from "react-native"/);
    expect(setting).not.toMatch(/trackColor|thumbColor/);
  });

  it("permis : une carte par réglage, la ligne, le titre et l'aide de Réglages (components/settings-group.tsx)", () => {
    expect(setting).toContain("section: { ...g.card, marginTop: space.sm }");
    expect(setting).toContain("row: g.row, title: g.rowTitle, hint: g.hint");
    // Les deux lignes sont chacune dans leur carte (la vue de la ligne EST la carte).
    expect(setting.match(/<View style=\{styles\.section\}>/g)?.length).toBe(1);
    expect(setting).toContain('{row("wishes", t.friendShelves.settingWishesTitle, t.friendShelves.settingWishesHelp)}');
    expect(setting).toContain('{row("vault", t.friendShelves.settingVaultTitle, t.friendShelves.settingVaultHelp)}');
  });

  it("refusé : l'ancienne présentation (marge du bas de 24, titre en demi-gras, couleurs écrites dans le composant)", () => {
    expect(setting).not.toContain("marginBottom: space.lg");
    expect(setting).not.toContain('fontWeight: "600"');
    expect(setting).not.toMatch(/color\.(encre|acier|vert)/);
  });

  it("à leur place : dans le groupe de confidentialité, juste après « Proposer mon compte aux autres membres »", () => {
    const settings = source("app/(app)/settings.tsx");
    expect(settings.indexOf("<DiscoverableSetting />")).toBeLessThan(settings.indexOf("<FriendShelvesSetting />"));
    expect(settings.indexOf("<FriendShelvesSetting />")).toBeLessThan(settings.indexOf("<PieceSendsSetting />"));
    // Refusé : la phrase de la première version (« éteints au départ ») n'est plus vraie.
    expect(settings).not.toContain("éteints au départ");
  });
});

describe("la carte d'information : une carte de la nouvelle interface", () => {
  it("permis : la carte de Réglages (surface, coins doux, filet en thème clair seulement), boutons de 44 points", () => {
    expect(notice).toContain("card: { ...settingsGroupValues().card");
    expect(notice).toContain('borderCurve: "continuous"');
    expect(styleOf(notice, "secondary")).toContain("borderWidth: 1, borderColor: color.filet");
    expect(styleOf(notice, "primary")).toContain("backgroundColor: color.vert");
  });

  it("refusé : le cadre d'avant (filet d'un point en thème sombre aussi) et une marge à elle", () => {
    expect(styleOf(notice, "card")).not.toContain("borderWidth: 1");
    expect(styleOf(notice, "card")).not.toContain("marginBottom");
  });
});

describe("la barre flottante : l'espace du bas sur les onglets, rien sur les écrans de la pile", () => {
  it("permis : son propre profil (onglet) garde l'espace de la barre sous ses listes, la carte est dans l'en-tête", () => {
    const own = source("app/(app)/(tabs)/profile/index.tsx");
    expect(own).toContain("const tabBarSpace = useTabBarSpace();");
    expect(own).toContain("<FriendShelvesNotice style={styles.noticeWrap} />");
  });

  it("refusé : le profil d'un ami (écran de la pile, sans barre) ne prend pas l'espace de la barre", () => {
    expect(source("app/(app)/profil.tsx")).not.toContain("useTabBarSpace");
  });
});
