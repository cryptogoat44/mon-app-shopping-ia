import { beforeEach, describe, expect, it } from "vitest";
import { SHORT_LINK_CACHE_SIZE, SHORT_LINK_HOSTS, SHORT_LINK_MAX_HOPS, followShortLink, resetShortLinkCache, resolveVideoLink } from "../src/lib/videoLinks.js";

// Mission « liens vidéo », étape 2 : résolution d'un lien court TikTok par le
// serveur. Tout est simulé : aucun appel réel à TikTok. Vérifié ici : seuls
// trois hôtes sont interrogés, 5 sauts au plus, le contenu d'une réponse
// n'est jamais lu, la page de la vidéo n'est jamais demandée, et le résultat
// est gardé en mémoire.

const ID = "7412345678901234567";
const VIDEO = `https://www.tiktok.com/@scout2015/video/${ID}?_r=1&_t=8abc`;
const LINK = { platform: "tiktok", videoKey: ID, canonicalUrl: `https://www.tiktok.com/@scout2015/video/${ID}`, creatorHandle: "scout2015" };

/** Faux TikTok : `routes` associe une adresse à sa réponse (redirection, ou code seul). Note les adresses demandées et si un contenu a été lu. */
function fakeTikTok(routes: Record<string, { status: number; location?: string }>) {
  const asked: string[] = [];
  let bodyRead = false;
  let cancelled = 0;
  const fetcher = async (url: string, init: { method: string; redirect: string }) => {
    asked.push(url);
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return {
      status: route.status,
      headers: new Headers(route.location ? { location: route.location } : {}),
      body: {
        cancel: async () => {
          cancelled += 1;
        },
        getReader: () => {
          bodyRead = true;
          throw new Error("le contenu ne doit jamais être lu");
        },
      } as unknown as ReadableStream<Uint8Array>,
    };
  };
  return { fetcher, asked, bodyRead: () => bodyRead, cancelled: () => cancelled };
}

beforeEach(() => resetShortLinkCache());

describe("followShortLink : suivre la redirection d'un lien court, et rien d'autre", () => {
  it("un saut : l'adresse de la vidéo est lue dans l'en-tête, la page de la vidéo n'est jamais demandée", async () => {
    const tiktok = fakeTikTok({ "https://vm.tiktok.com/ZMabcdEFG/": { status: 301, location: VIDEO } });
    expect(await followShortLink("https://vm.tiktok.com/ZMabcdEFG/", tiktok.fetcher)).toEqual({ ok: true, link: LINK });
    expect(tiktok.asked).toEqual(["https://vm.tiktok.com/ZMabcdEFG/"]);
    expect(tiktok.bodyRead()).toBe(false);
    expect(tiktok.cancelled()).toBe(1);
  });

  it("plusieurs sauts entre les hôtes permis, destination relative comprise", async () => {
    const tiktok = fakeTikTok({
      "https://www.tiktok.com/t/ZTabc123x/": { status: 302, location: "https://vt.tiktok.com/ZSabc123x/" },
      "https://vt.tiktok.com/ZSabc123x/": { status: 307, location: "/ZSsuite999/" },
      "https://vt.tiktok.com/ZSsuite999/": { status: 301, location: `https://m.tiktok.com/v/${ID}.html?share=1` },
    });
    const outcome = await followShortLink("https://www.tiktok.com/t/ZTabc123x/", tiktok.fetcher);
    expect(outcome).toEqual({ ok: true, link: { ...LINK, canonicalUrl: `https://www.tiktok.com/@/video/${ID}`, creatorHandle: null } });
    expect(tiktok.asked).toHaveLength(3);
  });

  it("refuse tout hôte hors des trois permis, au départ comme après une redirection (jamais d'appel vers lui)", async () => {
    expect(SHORT_LINK_HOSTS).toEqual(["vm.tiktok.com", "vt.tiktok.com", "www.tiktok.com"]);
    const departures = [
      "https://exemple-pirate.com/ZMabcdEFG/",
      "https://vm.tiktok.com.exemple-pirate.com/ZMabcdEFG/",
      "http://vm.tiktok.com/ZMabcdEFG/",
      "https://vm.tiktok.com:8443/ZMabcdEFG/",
      "https://vm.tiktok.com@169.254.169.254/ZMabcdEFG/",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/ZMabcdEFG/",
      "https://m.tiktok.com/ZMabcdEFG/",
    ];
    for (const departure of departures) {
      const tiktok = fakeTikTok({});
      expect(await followShortLink(departure, tiktok.fetcher), departure).toEqual({ ok: false, issue: "host_not_allowed" });
      expect(tiktok.asked).toEqual([]);
    }
    for (const destination of ["https://exemple-pirate.com/piege", "http://169.254.169.254/latest/meta-data/", "https://localhost:3000/", "file:///etc/passwd"]) {
      const tiktok = fakeTikTok({ "https://vm.tiktok.com/ZMabcdEFG/": { status: 302, location: destination } });
      expect(await followShortLink("https://vm.tiktok.com/ZMabcdEFG/", tiktok.fetcher), destination).toEqual({ ok: false, issue: "host_not_allowed" });
      expect(tiktok.asked).toEqual(["https://vm.tiktok.com/ZMabcdEFG/"]);
    }
  });

  it(`${SHORT_LINK_MAX_HOPS} sauts au plus`, async () => {
    const routes: Record<string, { status: number; location: string }> = {};
    for (let hop = 0; hop < 10; hop++) routes[`https://vm.tiktok.com/saut${hop}/`] = { status: 302, location: `https://vm.tiktok.com/saut${hop + 1}/` };
    const tiktok = fakeTikTok(routes);
    expect(await followShortLink("https://vm.tiktok.com/saut0/", tiktok.fetcher)).toEqual({ ok: false, issue: "too_many_hops" });
    expect(tiktok.asked).toHaveLength(SHORT_LINK_MAX_HOPS);
  });

  it("lien qui ne mène à aucune vidéo (page, 404, profil) : « pas une vidéo » ; TikTok muet ou en panne : « injoignable »", async () => {
    const notVideo = fakeTikTok({
      "https://vm.tiktok.com/page/": { status: 200 },
      "https://vm.tiktok.com/absent/": { status: 404 },
      "https://vm.tiktok.com/sansdestination/": { status: 302 },
    });
    for (const url of ["https://vm.tiktok.com/page/", "https://vm.tiktok.com/absent/", "https://vm.tiktok.com/sansdestination/"]) {
      expect(await followShortLink(url, notVideo.fetcher), url).toEqual({ ok: false, issue: "not_a_video" });
    }
    const down = fakeTikTok({ "https://vm.tiktok.com/panne/": { status: 503 }, "https://vm.tiktok.com/bride/": { status: 429 } });
    expect(await followShortLink("https://vm.tiktok.com/panne/", down.fetcher)).toEqual({ ok: false, issue: "unreachable" });
    expect(await followShortLink("https://vm.tiktok.com/bride/", down.fetcher)).toEqual({ ok: false, issue: "unreachable" });
    expect(await followShortLink("https://vm.tiktok.com/coupe/", down.fetcher)).toEqual({ ok: false, issue: "unreachable" });
    expect(notVideo.bodyRead() || down.bodyRead()).toBe(false);
  });
});

describe("resolveVideoLink : reconnaître, résoudre un lien court, garder le résultat", () => {
  it("un lien complet (TikTok ou Instagram) ne fait partir aucun appel", async () => {
    const tiktok = fakeTikTok({});
    expect(await resolveVideoLink(VIDEO, { fetcher: tiktok.fetcher })).toEqual({ link: LINK, issue: null });
    expect((await resolveVideoLink("https://www.instagram.com/reel/C8abcDEF123/?igsh=abc", { fetcher: tiktok.fetcher })).link?.videoKey).toBe("C8abcDEF123");
    expect(await resolveVideoLink("Regarde cette veste", { fetcher: tiktok.fetcher })).toEqual({ link: null, issue: null });
    expect(tiktok.asked).toEqual([]);
  });

  it("un lien court est résolu une fois, puis servi par la mémoire pendant 24 h", async () => {
    const tiktok = fakeTikTok({ "https://vm.tiktok.com/ZMabcdEFG/": { status: 301, location: VIDEO } });
    let now = 1_000_000;
    const options = { fetcher: tiktok.fetcher, now: () => now };
    expect(await resolveVideoLink("Découvre la vidéo ! https://vm.tiktok.com/ZMabcdEFG/", options)).toEqual({ link: LINK, issue: null });
    expect(await resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG", options)).toEqual({ link: LINK, issue: null });
    expect(tiktok.asked).toHaveLength(1);
    now += 24 * 60 * 60 * 1000 + 1;
    await resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG/", options);
    expect(tiktok.asked).toHaveLength(2);
  });

  it("deux demandes du même lien en même temps : un seul appel sortant", async () => {
    const tiktok = fakeTikTok({ "https://vm.tiktok.com/ZMabcdEFG/": { status: 301, location: VIDEO } });
    const answers = await Promise.all([1, 2, 3].map(() => resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG/", { fetcher: tiktok.fetcher })));
    expect(answers.every((answer) => answer.link?.videoKey === ID)).toBe(true);
    expect(tiktok.asked).toHaveLength(1);
  });

  it("« pas une vidéo » est gardé 1 h ; « injoignable » n'est jamais gardé (le prochain essai redemande)", async () => {
    const routes: Record<string, { status: number; location?: string }> = { "https://vm.tiktok.com/absent/": { status: 404 } };
    const tiktok = fakeTikTok(routes);
    let now = 5_000_000;
    const options = { fetcher: tiktok.fetcher, now: () => now };
    expect(await resolveVideoLink("https://vm.tiktok.com/absent/", options)).toEqual({ link: null, issue: "not_a_video" });
    await resolveVideoLink("https://vm.tiktok.com/absent/", options);
    expect(tiktok.asked).toHaveLength(1);
    now += 60 * 60 * 1000 + 1;
    await resolveVideoLink("https://vm.tiktok.com/absent/", options);
    expect(tiktok.asked).toHaveLength(2);

    expect(await resolveVideoLink("https://vm.tiktok.com/coupe/", options)).toEqual({ link: null, issue: "unreachable" });
    routes["https://vm.tiktok.com/coupe/"] = { status: 301, location: VIDEO };
    expect(await resolveVideoLink("https://vm.tiktok.com/coupe/", options)).toEqual({ link: LINK, issue: null });
  });

  it("limite de débit : un appel refusé ne part pas ; une réponse déjà en mémoire n'est jamais comptée", async () => {
    const tiktok = fakeTikTok({ "https://vm.tiktok.com/ZMabcdEFG/": { status: 301, location: VIDEO } });
    let asked = 0;
    const allow = (allowed: boolean) => ({
      fetcher: tiktok.fetcher,
      beforeFetch: () => {
        asked += 1;
        return allowed;
      },
    });
    expect(await resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG/", allow(false))).toEqual({ link: null, issue: "rate_limited" });
    expect(tiktok.asked).toEqual([]);
    expect((await resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG/", allow(true))).link).toEqual(LINK);
    expect((await resolveVideoLink("https://vm.tiktok.com/ZMabcdEFG/", allow(false))).link).toEqual(LINK);
    expect(asked).toBe(2);
  });

  it(`la mémoire ne dépasse jamais ${SHORT_LINK_CACHE_SIZE} liens`, async () => {
    const fetcher = async (url: string) => ({ status: 301, headers: new Headers({ location: `https://www.tiktok.com/@a/video/${ID}` }), body: null, url });
    for (let index = 0; index < SHORT_LINK_CACHE_SIZE + 50; index++) await resolveVideoLink(`https://vm.tiktok.com/code${index}/`, { fetcher });
    let calls = 0;
    const counting = async (url: string) => {
      calls += 1;
      return fetcher(url);
    };
    // Le plus ancien est parti (redemandé), le plus récent est resté.
    await resolveVideoLink("https://vm.tiktok.com/code0/", { fetcher: counting });
    await resolveVideoLink(`https://vm.tiktok.com/code${SHORT_LINK_CACHE_SIZE + 49}/`, { fetcher: counting });
    expect(calls).toBe(1);
  });
});
