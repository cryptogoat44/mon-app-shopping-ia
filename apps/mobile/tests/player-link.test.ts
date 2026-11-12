import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeVideoLink } from "@monapp/shared-types";
import { isAllowedNavigation, isPlayerPlatform, playerBaseUrl, sameDocument, TIKTOK_ORIGIN, tiktokPlayerUrl, videoOpenUrl } from "../src/lib/player-link";

// Mission « liens vidéo » : du lien à l'adresse du lecteur officiel, sans
// aucun appel réseau de l'app (le serveur reconnaît la vidéo et suit les
// liens courts ; le code Instagram vient de lui).
const ID = "6718335390845095173";

describe("lecteur TikTok : construit depuis l'identifiant seul", () => {
  it("https://www.tiktok.com/player/v1/{id}?autoplay=1", () => {
    expect(TIKTOK_ORIGIN).toBe("https://www.tiktok.com");
    expect(tiktokPlayerUrl(ID)).toBe(`https://www.tiktok.com/player/v1/${ID}?autoplay=1`);
  });

  it("identifiant qui n'est pas fait de 6 à 25 chiffres : refusé", () => {
    for (const id of ["", "12345", "1".repeat(26), "abc123456", `${ID}/`, `${ID}?x=1`, "../1234567", " 1234567"]) expect(tiktokPlayerUrl(id)).toBeNull();
  });

  it("aucun appel réseau dans ce fichier : ni fetch, ni oEmbed, ni lien court suivi par l'app", () => {
    const code = readFileSync(join(__dirname, "../src/lib/player-link.ts"), "utf8");
    expect(code).not.toMatch(/\bfetch\b|oembed|AbortController/i);
  });

  it("plateformes du lecteur", () => {
    expect(isPlayerPlatform("tiktok")).toBe(true);
    expect(isPlayerPlatform("instagram")).toBe(true);
    expect(isPlayerPlatform("pinterest")).toBe(false);
  });
});

describe("« Ouvrir dans TikTok / Instagram » : adresse canonique, revérifiée, jamais le texte collé", () => {
  it("adresse canonique rendue par le serveur", () => {
    const link = normalizeVideoLink(`https://www.tiktok.com/@mode.fr/video/${ID}?_t=abc`);
    expect(videoOpenUrl("https://vm.tiktok.com/ZMabc123/", "tiktok", link)).toBe(`https://www.tiktok.com/@mode.fr/video/${ID}`);
    const reel = normalizeVideoLink("https://www.instagram.com/reel/CWqAgUZgCku/?igsh=abc");
    expect(videoOpenUrl("https://www.instagram.com/reel/CWqAgUZgCku/?igsh=abc", "instagram", reel)).toBe("https://www.instagram.com/reel/CWqAgUZgCku/");
  });

  it("sans réponse du serveur : l'adresse reconstruite depuis le lien (canonique, ou lien court réécrit)", () => {
    expect(videoOpenUrl(`Regarde ! https://m.tiktok.com/v/${ID}.html #fyp`, "tiktok", null)).toBe(`https://www.tiktok.com/@/video/${ID}`);
    expect(videoOpenUrl("https://vm.tiktok.com/ZMabc123/?x=1", "tiktok", null)).toBe("https://vm.tiktok.com/ZMabc123/");
    expect(videoOpenUrl("https://www.instagram.com/mode.fr/reel/CWqAgUZgCku/", "instagram", null)).toBe("https://www.instagram.com/reel/CWqAgUZgCku/");
  });

  it("lien piégé ou d'une autre plateforme : rien à ouvrir", () => {
    for (const raw of ["https://vm.tiktok.com\\@evil.example/", "https://tiktok.com@evil.example/@a/video/1234567", "https://evil.example/@a/video/1234567", "javascript:alert(1)", "pas un lien"]) {
      expect(videoOpenUrl(raw, "tiktok", null), raw).toBeNull();
    }
    expect(videoOpenUrl("https://www.instagram.com/reel/CWqAgUZgCku/", "tiktok", null)).toBeNull();
    // Une adresse « canonique » inattendue (autre hôte) est refusée elle aussi.
    expect(videoOpenUrl("x", "tiktok", { platform: "tiktok", videoKey: ID, canonicalUrl: "https://evil.example/", creatorHandle: null })).toBeNull();
  });
});

describe("vue web : navigations admises", () => {
  const top = ["https://spotto.example/"];

  it("le document principal ne quitte jamais la page hôte ; about:blank admis", () => {
    expect(isAllowedNavigation({ url: "https://spotto.example/#x", isTopFrame: true }, top)).toBe(true);
    expect(isAllowedNavigation({ url: "about:blank", isTopFrame: true }, top)).toBe(true);
    for (const url of ["https://www.tiktok.com/@a/video/1", "instagram://media?id=1", "about:srcdoc", "https://evil.example/"]) {
      expect(isAllowedNavigation({ url, isTopFrame: true }, top), url).toBe(false);
    }
  });

  it("cadres : lecteur TikTok, code Instagram et Meta, en https, comparés au nom d'hôte exact", () => {
    for (const url of [`https://www.tiktok.com/player/v1/${ID}`, "https://www.instagram.com/p/CWqAgUZgCku/embed/captioned/", "https://staticxx.facebook.com/x"]) {
      expect(isAllowedNavigation({ url, isTopFrame: false }, top), url).toBe(true);
    }
    for (const url of ["http://www.tiktok.com/player/v1/1", "https://www.tiktok.com.evil.example/", "https://eviltiktok.com/", "https://user:pw@www.tiktok.com/", "https://www.tiktok.com:8443/", "about:srcdoc", "javascript:alert(1)"]) {
      expect(isAllowedNavigation({ url, isTopFrame: false }, top), url).toBe(false);
    }
  });

  it("origine de la page hôte : le site de l'app ; même document sans le fragment", () => {
    expect(playerBaseUrl("https://spotto.example/chemin?x=1")).toBe("https://spotto.example/");
    expect(sameDocument("https://spotto.example/#a", "https://spotto.example/")).toBe(true);
    expect(sameDocument("https://spotto.example/autre", "https://spotto.example/")).toBe(false);
  });
});
