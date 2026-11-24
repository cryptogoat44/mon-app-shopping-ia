import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOR_YOU_DAYS, type ForYouPage, type Post } from "@monapp/shared-types";

// Fil « Pour vous » et suggestions de comptes (lot « découverte », migration
// 0050), côté app : le choix « Abonnements | Pour vous » gardé pour la
// session, les pages sans doublon, la suite d'une page vide, « Pour vous »
// caché face à un serveur d'avant ce lot, les appels au serveur, les
// statistiques, les textes et la politique de confidentialité. Sans rendu ;
// `fetch` est simulé ; les écrans sont lus comme du texte.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn(async () => new Blob(["photo"], { type: "image/jpeg" })) }));

import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { ApiError } from "../src/lib/api-error";
import { track } from "../src/lib/analytics";
import { ANALYTICS_EVENTS, sanitizeProps } from "../src/lib/analytics-events";
import {
  FEED_SEGMENTS,
  appendUnique,
  discoverableSettingShown,
  fetchUntilShown,
  forYouShown,
  isMissingRoute,
  noteForYouFailure,
  rememberSegment,
  rememberedSegment,
  resetForYouSession,
} from "../src/lib/for-you";

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const post = (id: string) => ({ id }) as Post;
const ids = (posts: readonly Post[]) => posts.map((p) => p.id);
const missing = new ApiError(404, { error: "not_found", message: "Route introuvable." });
const outage = new ApiError(500, { error: "internal_error", message: "Une erreur est survenue." });

beforeEach(() => resetForYouSession());

describe("le choix « Abonnements | Pour vous », gardé pour la session", () => {
  it("deux fils, « Abonnements » au départ ; le dernier choisi revient à l'ouverture de l'écran", () => {
    expect(FEED_SEGMENTS).toEqual(["following", "forYou"]);
    expect(rememberedSegment()).toBe("following");
    rememberSegment("forYou");
    expect(rememberedSegment()).toBe("forYou");
    rememberSegment("following");
    expect(rememberedSegment()).toBe("following");
  });

  it("serveur d'avant ce lot (404) : « Pour vous » est caché pour la session, retour aux abonnements ; une panne ne cache rien", () => {
    rememberSegment("forYou");
    expect(noteForYouFailure(outage)).toBe(false);
    expect(noteForYouFailure(new Error("réseau"))).toBe(false);
    expect(forYouShown()).toBe(true);
    expect(rememberedSegment()).toBe("forYou");
    expect(isMissingRoute(missing)).toBe(true);
    expect(noteForYouFailure(missing)).toBe(true);
    expect(forYouShown()).toBe(false);
    expect(rememberedSegment()).toBe("following");
    // Même choisi ensuite, il ne revient pas pendant la session.
    rememberSegment("forYou");
    expect(rememberedSegment()).toBe("following");
  });

  it("serveur sans la migration 0050 (404 « réglage indisponible ») : « Pour vous » est caché aussi, retour aux abonnements", () => {
    rememberSegment("forYou");
    const withoutSetting = new ApiError(404, { error: "discovery_setting_unavailable", message: "Le réglage « Proposer mon compte aux autres membres » n'est pas encore disponible." });
    expect(noteForYouFailure(withoutSetting)).toBe(true);
    expect(forYouShown()).toBe(false);
    expect(rememberedSegment()).toBe("following");
  });

  it("rien n'est écrit sur le téléphone : ni le choix, ni ce qui a été vu", () => {
    const source = read("lib/for-you.ts");
    expect(source).not.toMatch(/AsyncStorage|SecureStore|localStorage|preferences/);
  });
});

describe("les pages de « Pour vous »", () => {
  it("une page de plus, sans doublon (le classement a pu être refait entre deux pages), dans l'ordre", () => {
    const first = [post("a"), post("b"), post("c")];
    expect(ids(appendUnique(first, [post("c"), post("d"), post("a"), post("e"), post("d")]))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(appendUnique([], [post("x"), post("x")]))).toEqual(["x"]);
    expect(appendUnique(first, [])).toEqual(first);
  });

  it("une page vide alors qu'il en reste : la suivante est demandée tout de suite ; quatre pages au plus", async () => {
    const pages: Record<number, ForYouPage> = {
      0: { posts: [], nextOffset: 15 },
      15: { posts: [], nextOffset: 30 },
      30: { posts: [post("p")], nextOffset: 45 },
      45: { posts: [], nextOffset: null },
    };
    const asked: number[] = [];
    const fetchPage = async (offset: number) => {
      asked.push(offset);
      return pages[offset]!;
    };
    expect(await fetchUntilShown(fetchPage)).toEqual({ posts: [post("p")], nextOffset: 45 });
    expect(asked).toEqual([0, 15, 30]);
    asked.length = 0;
    expect(await fetchUntilShown(fetchPage, 45)).toEqual({ posts: [], nextOffset: null });
    expect(asked).toEqual([45]);
    // Un serveur qui renverrait sans fin des pages vides : quatre demandes, pas une de plus.
    asked.length = 0;
    await fetchUntilShown(async (offset) => {
      asked.push(offset);
      return { posts: [], nextOffset: offset + 15 };
    });
    expect(asked).toEqual([0, 15, 30, 45]);
  });
});

describe("le réglage « Proposer mon compte aux autres membres »", () => {
  it("affiché seulement quand le serveur en parle (migration 0050)", () => {
    expect(discoverableSettingShown({ discoverable: true })).toBe(true);
    expect(discoverableSettingShown({ discoverable: false })).toBe(true);
    expect(discoverableSettingShown({})).toBe(false);
    expect(discoverableSettingShown(null)).toBe(false);
  });

  it("dans les Réglages, juste après « Qui peut me mentionner » ; l'interrupteur revient si l'enregistrement échoue", () => {
    const settings = read("app/(app)/settings.tsx");
    const mentions = settings.indexOf("<MentionsFromSetting />");
    const discoverable = settings.indexOf("<DiscoverableSetting />");
    const pieces = settings.indexOf("<PieceSendsSetting />");
    expect(mentions).toBeGreaterThan(-1);
    expect(discoverable).toBeGreaterThan(mentions);
    expect(pieces).toBeGreaterThan(discoverable);
    const component = read("components/discoverable-setting.tsx");
    expect(component).toContain("if (!discoverableSettingShown(profile)) return null;");
    expect(component).toContain("await updateDiscoverable(next);");
    expect(component).toContain("setValue(previous);");
    expect(component).toContain("accessibilityLabel={t.forYou.settingTitle}");
    expect(component).toContain("{t.forYou.settingHelp}");
  });
});

describe("les écrans, lus comme du texte", () => {
  const feed = read("app/(app)/(tabs)/feed/index.tsx");
  const suggestions = read("components/account-suggestions.tsx");

  it("le fil : « Abonnements | Pour vous » sous le titre, la phrase du classement toujours affichée sous « Pour vous »", () => {
    expect(feed).toContain("<SegmentedChoice");
    expect(feed).toContain("label={t.forYou.tabsLabel}");
    expect(feed).toContain('{ value: "following", label: t.forYou.tabFollowing }');
    expect(feed).toContain('{ value: "forYou", label: t.forYou.tabForYou }');
    expect(feed).toContain('{segment === "forYou" ? <Text style={styles.how}>{t.forYou.how}</Text> : null}');
    // Le titre, puis le choix, puis les fils.
    expect(feed.indexOf("{t.feed.title}")).toBeLessThan(feed.indexOf("<SegmentedChoice"));
    // Le choix est gardé pour la session ; l'ouverture est comptée, sans rien de ce qui est vu.
    expect(feed).toContain("useState<FeedSegment>(rememberedSegment)");
    expect(feed).toContain("rememberSegment(next);");
    expect(feed).toContain('if (next === "forYou") track("for_you_opened");');
  });

  it("chaque fil garde sa liste, sa suite et sa position : les deux restent montés, l'autre est seulement caché", () => {
    expect(feed).toContain("const [forYouPosts, setForYouPosts] = useState<Post[] | null>(null);");
    expect(feed).toContain("const [forYouNext, setForYouNext] = useState<number | null>(null);");
    expect(feed).toContain('segment === "forYou" ? null : styles.hiddenSegment');
    expect(feed).toContain('withForYou && segment === "forYou" ? styles.hiddenSegment : null');
    expect(feed).toContain('hiddenSegment: { display: "none" }');
    expect(feed).toContain("setForYouPosts((prev) => appendUnique(prev ?? [], page.posts));");
    expect(feed).toContain("await fetchUntilShown(fetchForYou, forYouNext)");
  });

  it("« Pour vous » : « Réessayer » dans ce fil seulement ; serveur d'avant ce lot : le choix disparaît ; vide et fin dites", () => {
    expect(feed).toContain("<LoadFailure message={forYouError} onRetry={retryForYou} />");
    expect(feed).toContain("if (noteForYouFailure(e)) {");
    expect(feed).toContain("setWithForYou(false);");
    expect(feed).toContain("{t.forYou.empty}");
    expect(feed).toContain("{t.forYou.end}");
  });

  it("chaque publication de « Pour vous » a « ··· » (signaler, bloquer) ; un blocage ou un signalement la retire des deux fils", () => {
    const forYouList = feed.slice(feed.indexOf("data={forYouPosts}"), feed.indexOf("data={posts ?? []}"));
    expect(forYouList).toContain("onOpenMenu={post.author.id === myId ? undefined : () => setMenuTarget({ userId: post.author.id, postId: post.id })}");
    expect(feed).toContain("setForYouPosts((prev) => (prev ? prev.filter((p) => p.author.id !== userId) : prev));");
    expect(feed).toContain("setForYouPosts((prev) => (prev ? prev.filter((p) => p.id !== postId) : prev));");
  });

  it("les comptes à découvrir : en haut de « Pour vous », dans le fil « Abonnements » vide, dans la recherche au champ vide", () => {
    const forYouList = feed.slice(feed.indexOf("data={forYouPosts}"), feed.indexOf("data={posts ?? []}"));
    expect(forYouList).toContain("<AccountSuggestions hiddenIds={blockedIds} />");
    const followingEmpty = feed.slice(feed.indexOf("ListEmptyComponent={\n              posts !== null"));
    expect(followingEmpty).toContain("<AccountSuggestions hiddenIds={blockedIds} />");
    expect(feed).not.toContain("viendront au lot 7");
    const search = read("app/(app)/people-search.tsx");
    // Champ vide (ou un « @ » seul, qui ne cherche rien) : les comptes à découvrir.
    expect(search).toContain('{profileSearchQuery(query) === "" ? (');
    expect(search).toContain("<AccountSuggestions hiddenIds={blockedIds} />");
  });

  it("la rangée : une liste, chaque carte un bouton (le profil) et le bouton d'abonnement à trois états ; 404 ou panne : rien", () => {
    expect(suggestions).toContain('accessibilityRole="list"');
    expect(suggestions).toContain("horizontal");
    expect(suggestions).toContain("accessibilityLabel={t.common.viewProfile(member.displayName)}");
    expect(suggestions).toContain('setState(await followUser(member.id, "suggestion"));');
    expect(suggestions).toContain("const button = followButton(state, t.peopleSearch.following);");
    expect(suggestions).toContain("accessibilityHint={button.hint}");
    expect(suggestions).toContain("if (unavailable || members === null) return null;");
    for (const key of ["suggestionsTitle", "suggestionsHow", "suggestionsEmpty"]) expect(suggestions, key).toContain(`t.forYou.${key}`);
    // Les boutons font 44 points de haut.
    expect(suggestions).toMatch(/followButton: \{[^}]*minHeight: 44/);
    expect(suggestions).toMatch(/person: \{[^}]*minHeight: 44/);
  });
});

describe("appels au serveur et statistiques", () => {
  function serveur(reponse: unknown = {}, status = 200) {
    const demandes: { method: string; chemin: string; corps: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        demandes.push({ method: init?.method ?? "GET", chemin: url.replace("https://api.exemple.test", ""), corps: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(reponse), { status });
      })
    );
    return demandes;
  }
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(track).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("« Pour vous » : la première page sans paramètre, les suivantes avec `offset` ; les suggestions ; le réglage", async () => {
    const { fetchForYou, fetchSuggestions, updateDiscoverable } = await import("../src/lib/api");
    const demandes = serveur({ posts: [], nextOffset: null, members: [] });
    await fetchForYou();
    await fetchForYou(15);
    await fetchSuggestions();
    serveur(null, 204);
    await updateDiscoverable(false);
    expect(demandes.map((d) => [d.method, d.chemin])).toEqual([
      ["GET", "/api/feed/for-you"],
      ["GET", "/api/feed/for-you?offset=15"],
      ["GET", "/api/users/suggestions"],
    ]);
    const reglage = serveur(null, 204);
    await updateDiscoverable(true);
    expect(reglage).toEqual([{ method: "PUT", chemin: "/api/me/discoverable", corps: { discoverable: true } }]);
    // Lire « Pour vous » n'envoie aucune statistique d'elle-même (l'écran compte l'ouverture).
    expect(track).not.toHaveBeenCalled();
  });

  it("serveur d'avant ce lot : 404 en ApiError, que l'écran reconnaît", async () => {
    const { fetchForYou } = await import("../src/lib/api");
    serveur({ error: "not_found", message: "Route introuvable." }, 404);
    const failure = await fetchForYou().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(isMissingRoute(failure)).toBe(true);
  });

  it("suivre depuis une suggestion : « follow_added » avec le contexte « suggestion », rien d'autre", async () => {
    const { followUser } = await import("../src/lib/api");
    serveur({ state: "following" });
    expect(await followUser("b2000000-0000-4000-8000-000000000002", "suggestion")).toBe("following");
    expect(vi.mocked(track).mock.calls).toEqual([["follow_added", { context: "suggestion" }]]);
    expect(sanitizeProps("follow_added", { context: "suggestion", userId: "x" })).toEqual({ context: "suggestion" });
  });

  it("« for_you_opened » : aucune propriété — ni publication, ni durée, ni position", () => {
    expect(ANALYTICS_EVENTS.for_you_opened).toEqual({});
    expect(sanitizeProps("for_you_opened", { postId: "a1", seconds: 12, offset: 15 })).toEqual({});
  });
});

describe("textes", () => {
  it("la section « forYou » est ajoutée à la fin des deux catalogues, mêmes clés, avec les textes de la fiche", () => {
    // Puis seulement celle des notifications d'activité (migration 0051), du même lot.
    for (const catalog of [fr, en]) expect(Object.keys(catalog).slice(-4)).toEqual(["forYou", "activityPush", "look", "friendShelves"]);
    expect(Object.keys(en.forYou)).toEqual(Object.keys(fr.forYou));
    const expected: [keyof typeof fr.forYou, string, string][] = [
      ["tabFollowing", "Abonnements", "Following"],
      ["tabForYou", "Pour vous", "For you"],
      [
        "how",
        "Des publications publiques récentes de comptes que vous ne suivez pas, classées selon leur date et leur nombre de j'aime et de commentaires. Le classement est le même pour tous les membres.",
        "Recent public posts from accounts you do not follow, ranked by date and by number of likes and comments. The ranking is the same for all members.",
      ],
      ["empty", "Rien de nouveau pour l'instant. Revenez un peu plus tard.", "Nothing new for now. Check back a little later."],
      ["end", "Vous avez tout vu.", "You are all caught up."],
      ["suggestionsTitle", "Comptes à découvrir", "Accounts to discover"],
      ["suggestionsHow", "Des comptes suivis par vos abonnements, puis les comptes publics les plus actifs.", "Accounts followed by people you follow, then the most active public accounts."],
      ["suggestionsEmpty", "Pas de suggestion pour l'instant.", "No suggestions for now."],
      ["settingTitle", "Proposer mon compte aux autres membres", "Suggest my account to other members"],
      [
        "settingHelp",
        "Vos publications publiques peuvent apparaître dans « Pour vous » et votre compte dans les suggestions. Éteint : seuls vos abonnés et les visiteurs de votre profil les voient.",
        "Your public posts may appear in “For you” and your account in suggestions. Off: only your followers and visitors of your profile see them.",
      ],
    ];
    for (const [key, french, english] of expected) {
      expect(fr.forYou[key], key).toBe(french);
      expect(en.forYou[key], key).toBe(english);
    }
  });

  it("au vouvoiement, sans tutoiement", () => {
    for (const text of Object.values(fr.forYou)) expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
  });
});

describe("politique de confidentialité et conditions", () => {
  const text = (doc: typeof privacyPolicy) => doc.sections.flatMap((s) => s.blocks.flat()).join("\n");

  it("« Qui peut voir quoi » : qui voit vos publications publiques dans « Pour vous », comment le fil est classé, comment refuser", () => {
    const section = (doc: typeof privacyPolicy, title: string) => doc.sections.find((s) => s.title.startsWith(title))!.blocks.flat().join("\n");
    const frWho = section(privacyPolicy, "Qui peut voir quoi");
    expect(frWho).toContain(
      "Vos publications publiques peuvent être proposées dans le fil « Pour vous » à des membres qui ne vous suivent pas, et votre compte peut leur être suggéré, sauf si votre compte est privé ou si vous éteignez le réglage « Proposer mon compte aux autres membres ». Ce fil classe les publications publiques des 14 derniers jours selon leur date et leur nombre de j'aime et de commentaires ; le classement est le même pour tous et ne repose sur aucun profil de vos centres d'intérêt. Les suggestions de comptes s'appuient sur les comptes suivis par vos abonnements, puis sur les comptes publics les plus actifs du fil « Pour vous »."
    );
    const enWho = section(privacyPolicyEn, "Who can see what");
    expect(enWho).toContain(
      "Your public posts may be shown in the “For you” feed to members who do not follow you, and your account may be suggested to them, unless your account is private or you turn off the setting “Suggest my account to other members”. This feed ranks public posts from the last 14 days by date and by number of likes and comments; the ranking is the same for everyone and uses no profile of your interests. Account suggestions rely on the accounts followed by the people you follow, then on the most active public accounts of the “For you” feed."
    );
  });

  it("la base retenue (intérêt légitime, droit de s'y opposer par le réglage), à vérifier ; le classement décrit dans les conditions", () => {
    expect(text(privacyPolicy)).toContain("notre intérêt légitime à faire découvrir les membres entre eux. Vous pouvez vous y opposer à tout moment, sans passer en compte privé");
    expect(text(privacyPolicyEn)).toContain("our legitimate interest in helping members discover each other. You can object at any time, without making your account private");
    expect(text(termsOfUse)).toContain("Le classement est le même pour tous les membres et ne repose sur aucun profil de vos centres d'intérêt.");
    expect(text(termsOfUse)).toContain("article 27");
    expect(text(termsOfUseEn)).toContain("The ranking is the same for all members and uses no profile of your interests.");
    // Les deux sources des suggestions, comme dans les conditions et l'app : la politique ne décrit pas seulement la première.
    expect(text(privacyPolicy)).not.toContain("s'appuient sur les comptes suivis par vos abonnements.");
    expect(text(privacyPolicyEn)).not.toContain("rely on the accounts followed by the people you follow.");
    expect(text(termsOfUse)).toContain("puis les comptes publics les plus actifs");
    expect(text(termsOfUseEn)).toContain("then the most active public accounts");
  });

  it(`les ${FOR_YOU_DAYS} jours des textes sont ceux du serveur (constante partagée) : l'explication et le code ne divergent pas`, () => {
    expect(text(privacyPolicy)).toContain(`des ${FOR_YOU_DAYS} derniers jours`);
    expect(text(termsOfUse)).toContain(`des ${FOR_YOU_DAYS} derniers jours`);
    expect(text(privacyPolicyEn)).toContain(`from the last ${FOR_YOU_DAYS} days`);
    expect(text(termsOfUseEn)).toContain(`from the last ${FOR_YOU_DAYS} days`);
  });
});
