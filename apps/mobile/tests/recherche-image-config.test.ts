import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configExpo } from "./expo-config";

// Mission « liens vidéo », étape 7 : recherche d'image d'iOS (« Visual
// Intelligence », iOS 26). Le plugin ajoute le fichier Swift à la cible
// principale et écrit dans Info.plist le groupe d'apps et le schéma des liens
// que ce Swift relit. Vérifié sans Xcode.
const require = createRequire(import.meta.url);
const plugin = require("../plugins/recherche-image.js") as {
  FICHIER: string;
  SOURCE: string;
  CLE_GROUPE: string;
  CLE_SCHEMA: string;
  reglages: (props: unknown) => { groupe: string; schema: string };
  completerInfoPlist: (infoPlist: Record<string, unknown>, valeurs: { groupe: string; schema: string }) => Record<string, unknown>;
};
const swift = readFileSync(plugin.SOURCE, "utf8");
/** Code Swift sans ses commentaires. */
const code = swift.replace(/\/\/.*$/gm, "");

describe("plugin de la recherche d'image : réglages", () => {
  it("refuse un réglage absent, vide ou resté entre accolades (repère non complété)", () => {
    for (const props of [undefined, null, {}, { groupe: "group.x" }, { schema: "x" }, { groupe: "", schema: "x" }, { groupe: "{groupeApple}", schema: "x" }, { groupe: "group.x", schema: "{schemaLiens}" }, { groupe: 3, schema: "x" }]) {
      expect(() => plugin.reglages(props), JSON.stringify(props)).toThrow(/réglage/);
    }
    expect(plugin.reglages({ groupe: "group.fr.exemple", schema: "exemple" })).toEqual({ groupe: "group.fr.exemple", schema: "exemple" });
  });

  it("Info.plist : les deux clés relues par le Swift, le reste gardé", () => {
    expect(plugin.CLE_GROUPE).toBe("SpottoAppGroup");
    expect(plugin.CLE_SCHEMA).toBe("SpottoScheme");
    expect(plugin.completerInfoPlist({ CFBundleName: "x" }, { groupe: "group.a", schema: "b" })).toEqual({ CFBundleName: "x", SpottoAppGroup: "group.a", SpottoScheme: "b" });
    expect(swift).toContain('forInfoDictionaryKey: "SpottoAppGroup"');
    expect(swift).toContain('forInfoDictionaryKey: "SpottoScheme"');
  });

  it("inscrit dans app.json avec les repères du fichier de la marque, complétés par app.config.js", () => {
    const appJson = JSON.parse(readFileSync(join(__dirname, "../app.json"), "utf8")) as { expo: { plugins: unknown[] } };
    expect(appJson.expo.plugins).toContainEqual(["./plugins/recherche-image.js", { groupe: "{groupeApple}", schema: "{schemaLiens}" }]);
    const config = configExpo() as { plugins: unknown[]; scheme: string; ios: { bundleIdentifier: string } };
    const entry = config.plugins.find((p) => Array.isArray(p) && p[0] === "./plugins/recherche-image.js") as [string, { groupe: string; schema: string }];
    expect(plugin.reglages(entry[1])).toEqual({ groupe: expect.stringMatching(/^group\./), schema: config.scheme });
  });
});

describe("fichier Swift de la recherche d'image", () => {
  it("sans effet avant iOS 26, ni sans le cadre VisualIntelligence", () => {
    expect(swift).toContain("#if canImport(VisualIntelligence)");
    expect(swift).toContain("import VisualIntelligence");
    expect(swift.trimEnd().endsWith("#endif")).toBe(true);
    for (const declaration of ["enum SpottoCaptures", "struct SpottoCaptureEntity", "struct SpottoCaptureEntityQuery", "struct SpottoVisualSearchQuery", "struct OpenSpottoCaptureIntent"]) {
      expect(swift).toMatch(new RegExp(`@available\\(iOS 26\\.0, \\*\\)\\n${declaration}`));
    }
  });

  it("aucun appel réseau : la capture est seulement rangée, puis l'app ouverte", () => {
    for (const forbidden of ["URLSession", "URLRequest", "dataTask", "NWConnection", "Data(contentsOf: URL(string"]) expect(code, forbidden).not.toContain(forbidden);
  });

  it("JPEG de 1 600 px au plus, qualité 0,8, dans « recherche-image/ » du groupe d'apps ; identifiant toujours un UUID", () => {
    expect(code).toContain("static let maxSide: CGFloat = 1600");
    expect(code).toContain("static let quality: CGFloat = 0.8");
    expect(code).toContain("jpegRepresentation");
    expect(code).toContain('static let folder = "recherche-image"');
    expect(code).toContain('static let pendingFile = "recherche-image-en-attente.txt"');
    expect(code).toContain("guard UUID(uuidString: id) != nil");
    // Dans le texte brut : « // » d'une adresse n'est pas un commentaire.
    expect(swift).toContain('"\\(scheme)://recherche-image?fichier=\\(id.lowercased())"');
  });

  it("les noms partagés avec l'app sont les mêmes des deux côtés", async () => {
    const link = await import("../src/lib/visual-search-link");
    expect(code).toContain(`static let folder = "${link.VISUAL_SEARCH_FOLDER}"`);
    expect(code).toContain(`static let pendingFile = "${link.PENDING_VISUAL_SEARCH_FILE}"`);
  });
});

describe("revue de sécurité : une capture ne reste pas (écrite avant tout choix de la personne)", () => {
  /** Corps de la fonction Swift `name` (jusqu'à la fonction suivante). */
  const body = (name: string) => code.slice(code.indexOf(`static func ${name}(`), code.indexOf("static func", code.indexOf(`static func ${name}(`) + 1));

  it("save() efface TOUTES les captures précédentes avant d'écrire la nouvelle, sans condition d'âge", () => {
    const save = body("save");
    expect(save.indexOf("removeAll()")).toBeGreaterThan(-1);
    expect(save.indexOf("removeAll()")).toBeLessThan(save.indexOf("data.write"));
    const removeAll = body("removeAll");
    expect(removeAll).toContain("contentsOfDirectory(at: directory");
    expect(removeAll).toContain("for file in files { try? FileManager.default.removeItem(at: file) }");
    // Plus aucun délai d'une heure : ni maxAge, ni comparaison de dates.
    for (const gone of ["maxAge", "purge()", "contentModificationDate", "3600"]) expect(code, gone).not.toContain(gone);
  });

  it("le dossier des captures est exclu des sauvegardes iCloud et ordinateur", () => {
    const directory = code.slice(code.indexOf("static var directory: URL?"), code.indexOf("static func fileURL("));
    expect(directory).toContain("URLResourceValues()");
    expect(directory).toContain("isExcludedFromBackup = true");
    expect(directory).toContain("setResourceValues(values)");
  });

  it("le commentaire d'en-tête ne promet plus « effacée au bout d'une heure »", () => {
    expect(swift).not.toMatch(/au bout d'une heure/);
    expect(swift).toContain("TOUTES les précédentes");
  });
});
