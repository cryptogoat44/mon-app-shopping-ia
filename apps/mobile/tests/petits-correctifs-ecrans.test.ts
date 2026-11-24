import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { profileSearchQuery } from "../src/lib/people-search-query";

// Retours du build 2 (24 novembre 2026), lot « petits correctifs d'écran » :
// le champ « Identifier des personnes » au-dessus du clavier (et les feuilles
// voisines), et la recherche de profils claire dans le Fil. Les lignes de
// résultats sans « Envoyer à un ami » ni « Plus disponible ? » sont vérifiées
// dans send-to-friend.test.ts et alertes-prix.test.ts. Écrans lus comme du
// texte, sans rendu.

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const IOS_PADDING = 'behavior={Platform.OS === "ios" ? "padding" : undefined}';

/** Le bloc d'une Modal, de son ouverture à sa fermeture. */
function modalBlock(source: string, opening: string): string {
  const start = source.indexOf(opening);
  expect(start, opening).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("</Modal>", start) + "</Modal>".length);
}

describe("le clavier de l'iPhone ne cache plus les feuilles où l'on écrit", () => {
  const post = read("app/(app)/post-item/new.tsx");
  const nameSheet = read("components/collection-name-sheet.tsx");
  const settingsSheet = read("components/collection-settings-sheet.tsx");

  it("« Identifier des personnes » : la feuille, son champ et la liste sont dans un KeyboardAvoidingView", () => {
    const people = modalBlock(post, "<Modal visible={peopleOpen}");
    const avoider = people.indexOf("<KeyboardAvoidingView");
    expect(avoider).toBeGreaterThan(-1);
    expect(people).toContain(`<KeyboardAvoidingView style={styles.modalAvoider} ${IOS_PADDING}>`);
    expect(avoider).toBeLessThan(people.indexOf("<Pressable style={styles.modalBackdrop}"));
    expect(avoider).toBeLessThan(people.indexOf("placeholder={t.carousel.searchPeople}"));
    const close = people.indexOf("</KeyboardAvoidingView>");
    expect(close).toBeGreaterThan(people.lastIndexOf("</ScrollView>"));
    expect(close).toBeLessThan(people.indexOf("</Modal>"));
    // Sur un petit iPhone, la liste rétrécit et défile : le titre et le champ restent visibles.
    expect(post).toContain('modalAvoider: { flex: 1, justifyContent: "flex-end" },');
    expect(post).toMatch(/modalSheet: \{[^}]*maxHeight: "70%", flexShrink: 1 \}/);
    expect(people).toContain('<ScrollView style={styles.peopleList} keyboardShouldPersistTaps="handled">');
    expect(people).toContain("autoFocus");
  });

  it("refusé : l'ancienne mise en page (le fond posé directement dans la Modal, sans rien qui remonte)", () => {
    const people = modalBlock(post, "<Modal visible={peopleOpen}");
    const backdrop = people.indexOf("<Pressable style={styles.modalBackdrop}");
    expect(people.slice(0, backdrop)).toContain("<KeyboardAvoidingView");
    // La feuille « Ajouter une pièce » n'a pas de champ : elle reste telle quelle.
    expect(modalBlock(post, "<Modal visible={pickerOpen}")).not.toContain("KeyboardAvoidingView");
  });

  it("« Nouvelle collection » et « Gérer » une collection : même protection", () => {
    for (const [name, source, inside] of [
      ["nouvelle collection", nameSheet, 'testID="creer-collection"'],
      ["gérer", settingsSheet, "<CollectionNameField value={name} onChange={setName} onSubmit={handleRename} />"],
    ] as const) {
      const sheet = modalBlock(source, "<Modal visible");
      const avoider = sheet.indexOf(`<KeyboardAvoidingView style={styles.avoider} ${IOS_PADDING}>`);
      expect(avoider, name).toBeGreaterThan(-1);
      expect(avoider, name).toBeLessThan(sheet.indexOf("<Pressable style={styles.backdrop}"));
      expect(avoider, name).toBeLessThan(sheet.indexOf(inside));
      expect(sheet.indexOf("</KeyboardAvoidingView>"), name).toBeGreaterThan(sheet.indexOf(inside));
      expect(source, name).toContain('avoider: { flex: 1, justifyContent: "flex-end" },');
    }
    expect(nameSheet.indexOf("<KeyboardAvoidingView")).toBeLessThan(nameSheet.indexOf("<CollectionNameField value={name}"));
    // « Gérer » : la feuille rétrécit, son contenu défile au-dessus du clavier.
    expect(settingsSheet).toContain('sheet: { maxHeight: "85%", flexShrink: 1,');
  });
});

describe("Fil : une pastille « Rechercher un profil » à la place du lien « Profils »", () => {
  const feed = read("app/(app)/(tabs)/feed/index.tsx");
  const search = read("app/(app)/people-search.tsx");

  it("dans la ligne du titre, au-dessus des segments, avec une loupe, un libellé et une aide pour VoiceOver", () => {
    const header = feed.slice(feed.indexOf("<View style={styles.header}>"), feed.indexOf("{withForYou ? ("));
    expect(header).toContain('onPress={() => router.push("/people-search")}');
    expect(header).toContain("<SearchIcon size={16} tint={color.acierSurPlinthe}");
    expect(header).toContain("{t.feed.searchProfiles}");
    expect(header).toContain("accessibilityLabel={t.feed.searchProfiles}");
    expect(header).toContain("accessibilityHint={t.feed.searchProfilesHint}");
    expect(header).toContain('accessibilityRole="button"');
    expect(feed.indexOf("{t.feed.title}")).toBeLessThan(feed.indexOf("{t.feed.searchProfiles}"));
    expect(feed.indexOf("{t.feed.searchProfiles}")).toBeLessThan(feed.indexOf("<SegmentedChoice"));
    // Zone tactile : 40 points de haut, plus 4 au-dessus et au-dessous.
    expect(feed).toMatch(/searchPill: \{[^}]*minHeight: 40,/);
    expect(header).toContain("hitSlop={{ top: 4, bottom: 4 }}");
  });

  it("refusé : plus de lien « Profils », ni de texte gris ordinaire sur le fond plinthe", () => {
    expect(feed).not.toContain("t.feed.profiles");
    expect(feed).not.toContain("styles.headerLink");
    const pill = feed.slice(feed.indexOf("searchPill: {"), feed.indexOf("searchPillLabel:"));
    expect(pill).toContain("backgroundColor: color.plinthe");
    const label = feed.slice(feed.indexOf("searchPillLabel:"), feed.indexOf("\n", feed.indexOf("searchPillLabel:")));
    expect(label).toContain("color: color.acierSurPlinthe");
    expect(label).not.toMatch(/color\.acier\b(?!SurPlinthe)/);
  });

  it("l'écran de recherche a un titre et s'ouvre clavier ouvert", () => {
    expect(search).toContain('<Text style={styles.navTitle} accessibilityRole="header" numberOfLines={1}>');
    expect(search).toContain("{t.peopleSearch.title}");
    const input = search.slice(search.indexOf("<TextInput"), search.indexOf("/>", search.indexOf("<TextInput")));
    expect(input).toContain("autoFocus");
    expect(input).toContain("placeholder={t.peopleSearch.placeholder}");
    expect(input).toContain("accessibilityLabel={t.peopleSearch.label}");
  });

  it("le bouton du fil vide dit la même chose, avec la loupe", () => {
    const empty = feed.slice(feed.indexOf("{t.feed.emptyPublish}"), feed.indexOf("{t.feed.emptyFind}"));
    expect(empty).toContain('onPress={() => router.push("/people-search")}');
    expect(empty).toContain("<SearchIcon size={18}");
  });

  it("textes FR et EN", () => {
    expect(fr.feed.searchProfiles).toBe("Rechercher un profil");
    expect(en.feed.searchProfiles).toBe("Search for a profile");
    expect(fr.feed.searchProfilesHint).toBe("Ouvre la recherche de membres par nom ou @pseudo");
    expect(en.feed.searchProfilesHint).toBe("Opens the member search by name or @username");
    expect(fr.feed.emptyFind).toBe("Rechercher des profils");
    expect(en.feed.emptyFind).toBe("Search for profiles");
    expect(fr.memberLists.findPeople).toBe(fr.feed.emptyFind);
    expect(en.memberLists.findPeople).toBe(en.feed.emptyFind);
    expect(fr.peopleSearch.title).toBe("Rechercher un profil");
    expect(en.peopleSearch.title).toBe("Search for a profile");
    expect(fr.peopleSearch.placeholder).toBe("Nom ou @pseudo");
    expect(en.peopleSearch.placeholder).toBe("Name or @username");
    expect("profiles" in fr.feed).toBe(false);
    expect("profiles" in en.feed).toBe(false);
    expect(Object.keys(en.feed).sort()).toEqual(Object.keys(fr.feed).sort());
    expect(Object.keys(en.peopleSearch).sort()).toEqual(Object.keys(fr.peopleSearch).sort());
  });
});

describe("Recherche de profils : l'@ du pseudo et le premier toucher", () => {
  const search = read("app/(app)/people-search.tsx");
  const suggestions = read("components/account-suggestions.tsx");

  it("permis : « @marie » cherche « marie », « marie » reste « marie »", () => {
    expect(profileSearchQuery("@marie")).toBe("marie");
    expect(profileSearchQuery("  @@marie ")).toBe("marie");
    expect(profileSearchQuery("marie")).toBe("marie");
    expect(profileSearchQuery("Marie Dupont")).toBe("Marie Dupont");
    expect(search).toContain("const q = profileSearchQuery(text);");
    expect(search).toContain("await searchUsers(q)");
  });

  it("refusé : un « @ » seul n'envoie rien (comme un champ vide), et le texte brut n'est plus envoyé", () => {
    expect(profileSearchQuery("@")).toBe("");
    expect(profileSearchQuery("  @  ")).toBe("");
    expect(profileSearchQuery("")).toBe("");
    expect(search).toContain("if (!q) {");
    expect(search).not.toContain("searchUsers(text.trim())");
    // Un « @ » seul montre les comptes à découvrir, comme un champ vide.
    expect(search).toContain('{profileSearchQuery(query) === "" ? (');
  });

  it("permis : clavier ouvert, le premier toucher sur « Suivre » ou un profil agit (liste de l'écran et liste des suggestions)", () => {
    expect(search).toContain('<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">');
    const list = suggestions.slice(suggestions.indexOf("<FlatList"), suggestions.indexOf("/>", suggestions.indexOf("renderItem")));
    expect(list).toContain('keyboardShouldPersistTaps="handled"');
  });

  it("refusé : plus de liste qui avale le premier toucher pour fermer le clavier", () => {
    expect(search).not.toMatch(/<ScrollView contentContainerStyle=\{styles\.content\}>/);
    expect(search).not.toContain('keyboardShouldPersistTaps="never"');
    expect(suggestions).not.toContain('keyboardShouldPersistTaps="never"');
  });
});
