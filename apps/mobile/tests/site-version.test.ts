import { describe, expect, it } from "vitest";
import { entryScriptOf, isNewVersion } from "../src/lib/site-version";

// Lot 4 ter : un onglet resté ouvert ne teste jamais une ancienne version sans le savoir.
const PAGE = (hash: string) => `<!DOCTYPE html><html><head><script src="/_expo/static/js/web/entry-${hash}.js" defer></script></head></html>`;

describe("version du site", () => {
  it("lit le programme principal d'une page ou d'une adresse", () => {
    expect(entryScriptOf(PAGE("69002d71f671c7cba1918c504c612501"))).toBe("/_expo/static/js/web/entry-69002d71f671c7cba1918c504c612501.js");
    expect(entryScriptOf("https://spotto.example/_expo/static/js/web/entry-abc123.js")).toBe("/_expo/static/js/web/entry-abc123.js");
  });

  it("serveur de développement ou page illisible : aucune comparaison", () => {
    expect(entryScriptOf("/node_modules/expo-router/entry.bundle?platform=web")).toBeNull();
    expect(isNewVersion(null, "/_expo/static/js/web/entry-abc.js")).toBe(false);
    expect(isNewVersion("/_expo/static/js/web/entry-abc.js", null)).toBe(false);
  });

  it("nouvelle version seulement si le programme a changé", () => {
    const a = entryScriptOf(PAGE("aaa111"));
    expect(isNewVersion(a, entryScriptOf(PAGE("aaa111")))).toBe(false);
    expect(isNewVersion(a, entryScriptOf(PAGE("bbb222")))).toBe(true);
  });
});
