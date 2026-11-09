import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Lot « profil et icône des réglages » : l'icône des Réglages et l'avatar
// partagé, vérifiés dans le code (les tests de l'app ne dessinent pas
// d'écran). Les autres tests du lot : avatar-look, avatar-crop,
// avatar-photo, bio-input.
const ROOT = join(__dirname, "../src");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Taille et épaisseur de trait par défaut d'une icône de components/icons.tsx. */
function iconDefaults(name: string): { size: number; strokeWidth: number; viewBox: string } {
  const source = read("components/icons.tsx");
  const start = source.indexOf(`export function ${name}(`);
  if (start === -1) throw new Error(`${name} absente`);
  const block = source.slice(start, source.indexOf("\n}\n", start));
  const size = /size = ([\d.]+)/.exec(block);
  const stroke = /strokeWidth = ([\d.]+)/.exec(block);
  const viewBox = /viewBox="([^"]+)"/.exec(block);
  return { size: Number(size?.[1]), strokeWidth: Number(stroke?.[1]), viewBox: viewBox?.[1] ?? "" };
}

describe("icône des Réglages", () => {
  it("même taille, même trait et même grille que les icônes de la barre d'onglets (Profil, Activité, Fil)", () => {
    const settings = iconDefaults("SettingsIcon");
    for (const tab of ["PersonIcon", "BellIcon", "FeedIcon"]) expect(settings, tab).toEqual(iconDefaults(tab));
    expect(settings).toEqual({ size: 24, strokeWidth: 1.4, viewBox: "0 0 24 24" });
  });

  it("une roue dentée au trait (un contour fermé et un rond), plus l'ancien soleil à rayons", () => {
    const source = read("components/icons.tsx");
    const block = source.slice(source.indexOf("export function SettingsIcon("), source.indexOf("export function PlusIcon("));
    expect(block).toMatch(/<Path\s+d="M[\d. ]+L[^"]*Z"/);
    expect((block.match(/A8\.6 8\.6/g) ?? []).length).toBe(6);
    expect(block).toContain('strokeLinejoin="round"');
    expect(block).toContain("<Circle cx={12} cy={12} r={2.8}");
    expect(source).not.toContain("GearIcon");
    expect(files(ROOT).filter((file) => readFileSync(file, "utf8").includes("GearIcon"))).toEqual([]);
  });

  it("l'onglet Profil l'affiche à sa taille d'origine, avec un libellé pour VoiceOver", () => {
    const screen = read("app/(app)/(tabs)/profile/index.tsx");
    expect(screen).toContain("<SettingsIcon tint={color.encre} />");
    expect(screen).toMatch(/accessibilityLabel=\{t\.settings\.title\}>\s*<SettingsIcon/);
  });
});

describe("avatar partagé partout où une personne apparaît", () => {
  const PLACES = [
    "app/(app)/(tabs)/profile/index.tsx", // profil
    "app/(app)/profil.tsx", // profil vu par les autres
    "app/(app)/edit-profile.tsx",
    "components/post-card.tsx", // fil
    "components/comments-section.tsx", // commentaires
    "app/(app)/conversation.tsx", // messages
    "components/conversation-row.tsx", // conversations
    "app/(app)/choisir-conversation.tsx",
    "app/(app)/collection-ami.tsx", // collections
    "components/moderation-item.tsx", // modération
    "app/(app)/(tabs)/activite.tsx",
    "app/(app)/people-search.tsx",
    "app/(app)/envoyer-envie.tsx",
    "app/(app)/blocked-users.tsx",
  ];

  it("chaque écran utilise <Avatar>, avec l'identifiant (couleur) et le nom (initiales)", () => {
    for (const place of PLACES) {
      const source = read(place);
      expect(source, place).toContain('import { Avatar } from "@/components/avatar";');
      expect(source, place).toMatch(/<Avatar uri=\{[^}]+\} userId=\{[^}]+\} displayName=\{[^}]+\}/);
    }
  });

  it("plus aucune photo de profil dessinée à la main, ni silhouette à la place des initiales", () => {
    const leftovers = files(ROOT)
      .filter((file) => !file.endsWith("components/avatar.tsx"))
      .filter((file) => /source=\{\{ uri: [\w?.]+\.avatarUrl/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(leftovers).toEqual([]);
    const silhouettes = files(ROOT)
      .filter((file) => !/components\/(avatar|icons)\.tsx$/.test(file) && !file.endsWith("(tabs)/_layout.tsx"))
      .filter((file) => readFileSync(file, "utf8").includes("<PersonIcon"))
      .map((file) => relative(ROOT, file));
    expect(silhouettes).toEqual([]);
  });

  it("la bio et la photo se modifient depuis l'onglet Profil (« Modifier le profil », appui sur la photo)", () => {
    const screen = read("app/(app)/(tabs)/profile/index.tsx");
    expect(screen).toContain('router.push("/edit-profile")');
    expect(screen).toContain("<AvatarPhotoFlow open={photoOpen}");
    const edit = read("app/(app)/edit-profile.tsx");
    expect(edit).toContain("nextBioInput(previous, typed)");
    expect(edit).toContain("<AvatarPhotoFlow open={photoOpen}");
  });
});
