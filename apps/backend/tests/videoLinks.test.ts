import { describe, expect, it } from "vitest";
import { VIDEO_LINK_INPUT_MAX_LENGTH, normalizeVideoLink, parseVideoLink, videoPlatformName, type VideoLink } from "@monapp/shared-types";

// Mission « liens vidéo », étape 2 : reconnaître un lien TikTok ou Instagram
// partagé (une adresse seule, ou un texte de partage qui en contient une),
// sans jamais rien télécharger. Logique pure : ni réseau, ni base.

const tiktok = (videoKey: string, handle: string | null, kind = "video"): VideoLink => ({
  platform: "tiktok",
  videoKey,
  canonicalUrl: `https://www.tiktok.com/@${handle ?? ""}/${kind}/${videoKey}`,
  creatorHandle: handle,
});
const instagram = (videoKey: string, kind: "reel" | "p" | "tv", handle: string | null = null): VideoLink => ({
  platform: "instagram",
  videoKey,
  canonicalUrl: `https://www.instagram.com/${kind}/${videoKey}/`,
  creatorHandle: handle,
});

const ID = "7412345678901234567";

describe("normalizeVideoLink : vidéos TikTok", () => {
  const cases: [string, string, VideoLink][] = [
    ["adresse complète", `https://www.tiktok.com/@scout2015/video/6718335390845095173`, tiktok("6718335390845095173", "scout2015")],
    ["paramètres de suivi retirés (_r, _t, utm…)", `https://www.tiktok.com/@mode.paris_1/video/${ID}?_r=1&_t=8abcDEF&utm_source=copy&utm_medium=ios`, tiktok(ID, "mode.paris_1")],
    ["copiée depuis un ordinateur", `https://www.tiktok.com/@scout2015/video/${ID}?is_from_webapp=1&sender_device=pc&web_id=7300000000000000000`, tiktok(ID, "scout2015")],
    ["sans « www »", `https://tiktok.com/@scout2015/video/${ID}`, tiktok(ID, "scout2015")],
    ["hôte et protocole en majuscules, pseudo en majuscules", `HTTPS://WWW.TIKTOK.COM/@Scout2015/video/${ID}`, tiktok(ID, "scout2015")],
    ["http, barre finale et ancre", `http://www.tiktok.com/@scout2015/video/${ID}/#commentaires`, tiktok(ID, "scout2015")],
    ["site mobile", `https://m.tiktok.com/v/${ID}.html`, tiktok(ID, null)],
    ["site mobile avec paramètres", `https://m.tiktok.com/v/${ID}.html?share_app_id=1233&u_code=abc`, tiktok(ID, null)],
    ["sans pseudo connu (« @/video/ID »)", `https://www.tiktok.com/@/video/${ID}`, tiktok(ID, null)],
    ["publication d'images", `https://www.tiktok.com/@scout2015/photo/${ID}?_r=1`, tiktok(ID, "scout2015", "photo")],
    ["adresse du lecteur officiel", `https://www.tiktok.com/player/v1/${ID}?music_info=1`, tiktok(ID, null)],
    ["ancienne adresse d'intégration", `https://www.tiktok.com/embed/v2/${ID}`, tiktok(ID, null)],
    ["écrite sans « https:// »", `www.tiktok.com/@scout2015/video/${ID}`, tiktok(ID, "scout2015")],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(normalizeVideoLink(input)).toEqual(expected);
    expect(parseVideoLink(input)).toEqual({ kind: "video", link: expected });
  });
});

describe("normalizeVideoLink : vidéos Instagram", () => {
  const cases: [string, string, VideoLink][] = [
    ["reel partagé depuis l'app (igsh)", "https://www.instagram.com/reel/C8abcDEF123/?igsh=MWx5dGZ4bGg0cXJ6dA==", instagram("C8abcDEF123", "reel")],
    ["« reels » (au pluriel) devient « reel »", "https://www.instagram.com/reels/C8abcDEF123/", instagram("C8abcDEF123", "reel")],
    ["publication, lien copié sur le web", "https://www.instagram.com/p/CxYz_-12345/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==", instagram("CxYz_-12345", "p")],
    ["vidéo longue (« tv »)", "https://www.instagram.com/tv/B9xyzABC123/", instagram("B9xyzABC123", "tv")],
    ["avec le pseudo dans l'adresse", "https://www.instagram.com/Mode.Paris/reel/C8abcDEF123/?igsh=xyz", instagram("C8abcDEF123", "reel", "mode.paris")],
    ["publication avec le pseudo", "https://www.instagram.com/mode_paris/p/CxYz_-12345/", instagram("CxYz_-12345", "p", "mode_paris")],
    ["sans « www », sans barre finale", "https://instagram.com/reel/C8abcDEF123", instagram("C8abcDEF123", "reel")],
    ["domaine court instagr.am", "https://instagr.am/p/CxYz_-12345/", instagram("CxYz_-12345", "p")],
    ["site mobile, hôte en majuscules : le code garde sa casse", "https://M.INSTAGRAM.COM/reel/C8abcDEF123/", instagram("C8abcDEF123", "reel")],
    ["type en majuscules", "https://www.instagram.com/REEL/C8abcDEF123/", instagram("C8abcDEF123", "reel")],
    ["écrite sans « https:// »", "instagram.com/reel/C8abcDEF123/?igsh=abc", instagram("C8abcDEF123", "reel")],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(normalizeVideoLink(input)).toEqual(expected);
  });

  it("la même vidéo vue comme « p » ou comme « reel » a la même clé", () => {
    expect(normalizeVideoLink("https://www.instagram.com/p/C8abcDEF123/")!.videoKey).toBe(normalizeVideoLink("https://www.instagram.com/reel/C8abcDEF123/")!.videoKey);
  });
});

describe("textes de partage réels : la première adresse TikTok ou Instagram du texte", () => {
  const cases: [string, string, VideoLink][] = [
    ["phrase puis lien", `Regarde cette vidéo ! https://www.tiktok.com/@scout2015/video/${ID}?_r=1&_t=8abc`, tiktok(ID, "scout2015")],
    ["lien suivi d'un point", `C'est ici : https://www.instagram.com/reel/C8abcDEF123/.`, instagram("C8abcDEF123", "reel")],
    ["lien entre parenthèses", `(https://www.instagram.com/p/CxYz_-12345/)`, instagram("CxYz_-12345", "p")],
    ["retours à la ligne et émojis", `🔥🔥\nLa veste de ouf\nhttps://www.tiktok.com/@scout2015/video/${ID}\n#mode`, tiktok(ID, "scout2015")],
    ["une autre adresse avant", `Vu sur https://exemple.fr/article puis https://www.instagram.com/reel/C8abcDEF123/?igsh=abc`, instagram("C8abcDEF123", "reel")],
    ["deux vidéos : la première", `https://www.tiktok.com/@a_b/video/${ID} et https://www.instagram.com/reel/C8abcDEF123/`, tiktok(ID, "a_b")],
    ["espaces autour", `   https://www.instagram.com/reel/C8abcDEF123/   `, instagram("C8abcDEF123", "reel")],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(normalizeVideoLink(input)).toEqual(expected);
  });
});

describe("liens courts TikTok : signalés, à résoudre par le serveur", () => {
  const cases: [string, string, string][] = [
    ["vm.tiktok.com", "https://vm.tiktok.com/ZMabcdEFG/", "https://vm.tiktok.com/ZMabcdEFG/"],
    ["vt.tiktok.com, sans barre finale, avec paramètre", "https://vt.tiktok.com/ZSabc123x?k=1", "https://vt.tiktok.com/ZSabc123x/"],
    ["tiktok.com/t/…", "https://www.tiktok.com/t/ZTabc123x/", "https://www.tiktok.com/t/ZTabc123x/"],
    ["dans un texte de partage", "Découvre la vidéo de Scout ! https://vm.tiktok.com/ZMabcdEFG/ ", "https://vm.tiktok.com/ZMabcdEFG/"],
    ["écrit sans « https:// »", "vm.tiktok.com/ZMabcdEFG", "https://vm.tiktok.com/ZMabcdEFG/"],
  ];
  it.each(cases)("%s", (_name, input, shortUrl) => {
    expect(parseVideoLink(input)).toEqual({ kind: "tiktok_short", shortUrl });
    // Sans le serveur, l'identifiant de la vidéo n'est pas connu.
    expect(normalizeVideoLink(input)).toBeNull();
  });
});

describe("ce qui n'est pas une vidéo reconnue : null", () => {
  const cases: [string, unknown][] = [
    ["rien", ""],
    ["null", null],
    ["undefined", undefined],
    ["un nombre", 42],
    ["texte sans adresse", "Regarde cette veste"],
    ["un autre site", "https://www.youtube.com/watch?v=abcdefghijk"],
    ["profil TikTok", "https://www.tiktok.com/@scout2015"],
    ["identifiant TikTok non numérique", "https://www.tiktok.com/@scout2015/video/abcdef"],
    ["identifiant TikTok trop court", "https://www.tiktok.com/@scout2015/video/123"],
    ["page de recherche TikTok", "https://www.tiktok.com/search?q=veste"],
    ["chemin en trop après la vidéo", `https://www.tiktok.com/@scout2015/video/${ID}/autre`],
    ["profil Instagram", "https://www.instagram.com/mode.paris/"],
    ["story Instagram", "https://www.instagram.com/stories/mode.paris/3412345678901234567/"],
    ["lien de partage Instagram (« share »), non reconnu", "https://www.instagram.com/share/reel/BAbcDEF123"],
    ["explorer", "https://www.instagram.com/explore/tags/mode/"],
    ["code Instagram trop court", "https://www.instagram.com/reel/abc/"],
    ["faux domaine qui commence comme TikTok", `https://www.tiktok.com.exemple-pirate.com/@a/video/${ID}`],
    ["faux domaine qui finit comme TikTok", `https://eviltiktok.com/@a/video/${ID}`],
    ["faux domaine écrit sans « https:// »", `eviltiktok.com/@a/video/${ID}`],
    ["TikTok en identifiant d'un autre site", `https://www.tiktok.com@exemple-pirate.com/@a/video/${ID}`],
    ["TikTok dans le chemin d'un autre site", `https://exemple-pirate.com/www.tiktok.com/@a/video/${ID}`],
    ["sous-domaine inconnu de TikTok", `https://ads.tiktok.com/@a/video/${ID}`],
    ["avec un port", `https://www.tiktok.com:8443/@a/video/${ID}`],
    ["autre protocole", `ftp://www.tiktok.com/@a/video/${ID}`],
    ["javascript", "javascript:alert(1)//www.instagram.com/reel/C8abcDEF123/"],
    ["texte démesuré", `${"a".repeat(VIDEO_LINK_INPUT_MAX_LENGTH)} https://www.instagram.com/reel/C8abcDEF123/`],
    ["pseudo TikTok invalide", `https://www.tiktok.com/@a%20b/video/${ID}`],
    ["lien court avec un chemin en plus", "https://vm.tiktok.com/ZMabcdEFG/autre"],
  ];
  it.each(cases)("%s", (_name, input) => {
    expect(normalizeVideoLink(input as string)).toBeNull();
  });

  it("« javascript: » suivi d'une adresse Instagram écrite en clair : seule l'adresse est lue, jamais le script", () => {
    // Le texte contient bien une adresse Instagram : elle est reconnue, et l'adresse rendue est toujours reconstruite.
    const link = normalizeVideoLink("javascript:alert(1) https://www.instagram.com/reel/C8abcDEF123/");
    expect(link?.canonicalUrl).toBe("https://www.instagram.com/reel/C8abcDEF123/");
  });
});

describe("l'adresse rendue est toujours reconstruite, jamais recopiée", () => {
  it("aucun paramètre, aucune ancre, toujours https et l'hôte officiel", () => {
    const inputs = [
      `http://m.tiktok.com/v/${ID}.html?x=<script>`,
      `https://www.tiktok.com/@scout2015/video/${ID}?redirect=https://exemple-pirate.com`,
      "http://instagr.am/p/CxYz_-12345/?next=//exemple-pirate.com#x",
    ];
    for (const input of inputs) {
      const link = normalizeVideoLink(input)!;
      expect(link.canonicalUrl).toMatch(/^https:\/\/www\.(tiktok|instagram)\.com\/[A-Za-z0-9@._\/-]+$/);
      expect(link.canonicalUrl).not.toMatch(/[?#<>]/);
    }
  });

  it("nom des plateformes pour les textes", () => {
    expect(videoPlatformName("tiktok")).toBe("TikTok");
    expect(videoPlatformName("instagram")).toBe("Instagram");
  });
});
