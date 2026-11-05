import { describe, expect, it } from "vitest";
import { HOST_MESSAGE_SOURCE, escapeHtmlAttribute, instagramHostPage, tiktokEmbedHostPage, tiktokHostPage } from "../src/lib/player-host-page";

// Lot « lecteur intégré » : la page hôte n'affiche rien d'elle-même et ne fait
// que relayer les messages du lecteur officiel.
const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

describe("page hôte du lecteur", () => {
  it("TikTok : lecteur officiel en plein cadre, aucun texte visible", () => {
    const page = tiktokHostPage("https://www.tiktok.com/player/v1/1?autoplay=1&loop=1", "Vidéo TikTok");
    expect(page).toContain('src="https://www.tiktok.com/player/v1/1?autoplay=1&amp;loop=1"');
    expect(page).toContain('title="Vidéo TikTok"');
    expect(page).toContain('allow="autoplay; encrypted-media"');
    expect(visibleText(page)).toBe("");
  });

  it("Instagram : le code officiel, puis embed.js", () => {
    const page = instagramHostPage('<blockquote class="instagram-media"></blockquote>', "Vidéo Instagram");
    expect(page).toContain('<blockquote class="instagram-media"></blockquote>');
    expect(page).toContain('src="https://www.instagram.com/embed.js"');
    expect(visibleText(page)).toBe("");
  });

  it("TikTok, repli (contre-expertise n° 9) : le blockquote, puis embed.js de TikTok", () => {
    const page = tiktokEmbedHostPage('<blockquote class="tiktok-embed"></blockquote>', "Vidéo TikTok");
    expect(page).toContain('<blockquote class="tiktok-embed"></blockquote>');
    expect(page).toContain('src="https://www.tiktok.com/embed.js"');
    expect(visibleText(page)).toBe("");
  });

  it("attributs échappés", () => {
    expect(escapeHtmlAttribute('a"<b>&')).toBe("a&quot;&lt;b&gt;&amp;");
  });

  it("scripts de relais : syntaxe valide, marque de la page hôte ; taille du code d'intégration envoyée (n° 13)", () => {
    for (const page of [tiktokHostPage("https://x", "t"), instagramHostPage("<blockquote></blockquote>", "t"), tiktokEmbedHostPage("<blockquote></blockquote>", "t")]) {
      const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
      expect(scripts).toHaveLength(1);
      expect(() => new Function(scripts[0] ?? "")).not.toThrow();
      expect(scripts[0]).toContain(HOST_MESSAGE_SOURCE);
    }
    expect(instagramHostPage("<blockquote></blockquote>", "t")).toContain('type: "size"');
  });
});
