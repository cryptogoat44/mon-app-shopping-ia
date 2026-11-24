import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionSummary, Post } from "@monapp/shared-types";

// Publications enregistrées (lot « vie sociale », migration 0048), côté app :
// l'état du signet (affiché tout de suite, confirmé ou annulé), les choix de
// la feuille « Ranger dans une collection », l'adresse de la liste, ce que
// l'app lit de l'état des collections, les appels au serveur, les textes et
// la politique de confidentialité. Sans rendu ; `fetch` est simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
const tracked = vi.hoisted(() => [] as string[]);
vi.mock("../src/lib/analytics", () => ({ track: vi.fn((event: string) => tracked.push(event)), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn(async () => new Blob(["photo"], { type: "image/jpeg" })) }));

import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { ApiError } from "../src/lib/api-error";
import { readCollectionsStatus } from "../src/lib/collections";
import { ANALYTICS_EVENTS } from "../src/lib/analytics-events";
import {
  NOT_SAVED,
  appendSavedPage,
  bookmarkA11y,
  bookmarkShown,
  bookmarkTapAction,
  filedMessage,
  parseSavedListParams,
  saveReducer,
  saveRequestCollection,
  saveSheetOptions,
  saveStateOf,
  savedListEmptyText,
  savedListRoute,
  type SaveState,
} from "../src/lib/saved-posts";

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const POST = "a1000000-0000-4000-8000-000000000001";
const SUMMER = "c5000000-0000-4000-8000-000000000001";
const WINTER = "c5000000-0000-4000-8000-000000000002";
const collection = (id: string, name: string): CollectionSummary => ({ id, name, visibility: "private", itemCount: 0, createdAt: "2026-11-01T00:00:00+00:00", hidden: false });
const COLLECTIONS = [collection(SUMMER, "Été"), collection(WINTER, "Hiver")];
const post = (id: string) => ({ id }) as Post;

afterEach(() => setActiveLocale("fr"));

describe("le signet : seulement quand le serveur connaît les publications enregistrées", () => {
  it("absent d'un serveur sans 0048 (pas de `viewerHasSaved`) ; présent, plein ou vide, sinon", () => {
    expect(bookmarkShown({})).toBe(false);
    expect(bookmarkShown({ viewerHasSaved: undefined })).toBe(false);
    expect(bookmarkShown({ viewerHasSaved: false })).toBe(true);
    expect(bookmarkShown({ viewerHasSaved: true })).toBe(true);
  });

  it("l'état de départ suit le serveur ; une collection n'est lue que pour une publication enregistrée", () => {
    expect(saveStateOf({})).toEqual(NOT_SAVED);
    expect(saveStateOf({ viewerHasSaved: true, viewerSavedCollectionId: SUMMER })).toEqual({ saved: true, collectionId: SUMMER });
    expect(saveStateOf({ viewerHasSaved: true, viewerSavedCollectionId: null })).toEqual({ saved: true, collectionId: null });
    expect(saveStateOf({ viewerHasSaved: true })).toEqual({ saved: true, collectionId: null });
    expect(saveStateOf({ viewerHasSaved: false, viewerSavedCollectionId: SUMMER })).toEqual(NOT_SAVED);
  });
});

describe("l'état du signet : affiché tout de suite, confirmé par le serveur, annulé s'il refuse", () => {
  it("enregistrer : plein tout de suite, sans collection ; déjà enregistrée, la collection reste", () => {
    expect(saveReducer(NOT_SAVED, { type: "save" })).toEqual({ saved: true, collectionId: null });
    const filed: SaveState = { saved: true, collectionId: SUMMER };
    expect(saveReducer(filed, { type: "save" })).toBe(filed);
  });

  it("ranger : dans une collection, ailleurs, nulle part ; retirer : vide", () => {
    let state = saveReducer(NOT_SAVED, { type: "file", collectionId: SUMMER });
    expect(state).toEqual({ saved: true, collectionId: SUMMER });
    state = saveReducer(state, { type: "file", collectionId: WINTER });
    expect(state).toEqual({ saved: true, collectionId: WINTER });
    state = saveReducer(state, { type: "file", collectionId: null });
    expect(state).toEqual({ saved: true, collectionId: null });
    expect(saveReducer(state, { type: "unsave" })).toEqual(NOT_SAVED);
  });

  it("la réponse du serveur fait foi ; un refus ramène exactement l'état d'avant le geste", () => {
    const before: SaveState = { saved: true, collectionId: SUMMER };
    const optimistic = saveReducer(before, { type: "unsave" });
    expect(saveReducer(optimistic, { type: "rollback", state: before })).toEqual(before);
    expect(saveReducer({ saved: true, collectionId: null }, { type: "confirmed", state: { saved: true, collectionId: WINTER } })).toEqual({ saved: true, collectionId: WINTER });
  });

  it("la publication relue fait foi : le signet se recale (enregistrée ou rangée ailleurs) ; rien ne change si l'état est le même", () => {
    const current: SaveState = { saved: true, collectionId: SUMMER };
    expect(saveReducer(current, { type: "synced", state: { saved: true, collectionId: SUMMER } })).toBe(current);
    expect(saveReducer(NOT_SAVED, { type: "synced", state: { saved: true, collectionId: SUMMER } })).toEqual({ saved: true, collectionId: SUMMER });
    expect(saveReducer(current, { type: "synced", state: { saved: true, collectionId: WINTER } })).toEqual({ saved: true, collectionId: WINTER });
    expect(saveReducer(current, { type: "synced", state: NOT_SAVED })).toEqual(NOT_SAVED);
  });

  it("un signet resté en retard ne sort jamais une publication de sa collection", () => {
    // Le fil : P n'est pas enregistrée. Sur l'écran de la publication, le membre la range dans « Été » ;
    // au retour, le fil relu dit « enregistrée, dans Été » à la même carte.
    const shown = saveStateOf({ viewerHasSaved: false });
    const reread = saveStateOf({ viewerHasSaved: true, viewerSavedCollectionId: SUMMER });
    // Recalée, la carte montre le signet plein : le toucher ouvre les choix, rien n'est envoyé.
    expect(bookmarkTapAction(saveReducer(shown, { type: "synced", state: reread }))).toBe("openSheet");
    // Même encore en retard (signet vide) : le toucher enregistre SANS collection envoyée,
    // et le serveur garde « Été » (la réponse le dit, la carte le confirme).
    expect(bookmarkTapAction(shown)).toBe("save");
    expect(saveRequestCollection("save")).toBeUndefined();
    const optimistic = saveReducer(shown, { type: "save" });
    expect(saveReducer(optimistic, { type: "confirmed", state: { saved: true, collectionId: SUMMER } })).toEqual(reread);
    // Un choix de la feuille envoie la collection, ou null pour « Sans collection ».
    expect(saveRequestCollection({ collectionId: WINTER })).toBe(WINTER);
    expect(saveRequestCollection({ collectionId: null })).toBeNull();
  });

  it("le toucher enregistre une publication qui ne l'est pas, et ouvre les choix d'une publication enregistrée (le même chemin sur le site)", () => {
    expect(bookmarkTapAction(NOT_SAVED)).toBe("save");
    expect(bookmarkTapAction({ saved: true, collectionId: null })).toBe("openSheet");
  });

  it("pour les lecteurs d'écran : l'état dans le libellé, et ce que fait le toucher quand il ouvre les choix", () => {
    expect(bookmarkA11y(NOT_SAVED)).toEqual({ label: "Enregistrer la publication", hint: undefined });
    expect(bookmarkA11y({ saved: true, collectionId: null })).toEqual({ label: "Publication enregistrée", hint: "Ouvre les choix : la ranger dans une collection, ou la retirer." });
    setActiveLocale("en");
    expect(bookmarkA11y(NOT_SAVED).label).toBe("Save post");
    expect(bookmarkA11y({ saved: true, collectionId: null }).label).toBe("Post saved");
  });
});

describe("la feuille « Ranger dans une collection »", () => {
  it("ses collections dans leur ordre, puis « Sans collection », puis « Retirer des enregistrées » ; un seul choix coché", () => {
    const options = saveSheetOptions(COLLECTIONS, { saved: true, collectionId: WINTER });
    expect(options.map((option) => [option.kind, option.label, option.selected])).toEqual([
      ["collection", "Été", false],
      ["collection", "Hiver", true],
      ["none", "Sans collection", false],
      ["remove", "Retirer des enregistrées", false],
    ]);
    expect(saveSheetOptions(COLLECTIONS, { saved: true, collectionId: null }).filter((option) => option.selected).map((option) => option.kind)).toEqual(["none"]);
  });

  it("une publication pas encore enregistrée (appui long) : rien de coché, et pas de « Retirer »", () => {
    const options = saveSheetOptions(COLLECTIONS, NOT_SAVED);
    expect(options.map((option) => option.kind)).toEqual(["collection", "collection", "none"]);
    expect(options.some((option) => option.selected)).toBe(false);
  });

  it("collections illisibles : les deux derniers choix restent ; une collection disparue n'est pas cochée (« Sans collection » non plus)", () => {
    expect(saveSheetOptions(null, { saved: true, collectionId: null }).map((option) => option.kind)).toEqual(["none", "remove"]);
    expect(saveSheetOptions([collection(SUMMER, "Été")], { saved: true, collectionId: WINTER }).some((option) => option.selected)).toBe(false);
  });

  it("le message après un choix nomme la collection ; sans collection, le dit", () => {
    expect(filedMessage(SUMMER, COLLECTIONS)).toBe("Rangée dans « Été »");
    expect(filedMessage(null, COLLECTIONS)).toBe("Rangée sans collection");
    expect(filedMessage(SUMMER, null)).toBe("Enregistrée");
    setActiveLocale("en");
    expect(filedMessage(WINTER, COLLECTIONS)).toBe("Added to “Hiver”");
  });

  it("le composant : boutons radio dans un groupe, « Retirer » à part, collections relues à chaque ouverture", () => {
    const sheet = read("components/save-post-sheet.tsx");
    expect(sheet).toContain('accessibilityRole="radiogroup"');
    expect(sheet).toContain('accessibilityRole="radio"');
    expect(sheet).toContain("checked: option.selected");
    expect(sheet).toContain("fetchCollections()");
    expect(sheet).toContain("if (!visible) return;");
    expect(sheet).toContain("t.savedPosts.privateNote");
  });
});

describe("la carte d'une publication", () => {
  const card = read("components/post-card.tsx");

  it("le signet est au bout de la rangée des actions, après « Partager », sans réordonner la rangée", () => {
    const actions = card.slice(card.indexOf("<View style={styles.actions}>"), card.indexOf("{withBookmark ? (\n        <SavePostSheet"));
    const order = ["bouton-jaime", "t.comments.countLabel", "t.comments.share", "bouton-enregistrer"].map((marker) => actions.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("caché sans 0048 ; affiché tout de suite, annulé avec la phrase du serveur ; l'appui long ouvre les choix", () => {
    expect(card).toContain("const withBookmark = bookmarkShown(post);");
    expect(card).toContain("{withBookmark ? (");
    expect(card).toContain('dispatchSave({ type: "rollback", state: before });');
    expect(card).toContain("e instanceof ApiError ? e.message");
    expect(card).toContain("onLongPress={() => setSaveSheetOpen(true)}");
    // Avec VoiceOver, l'action « Ranger » fait la même chose que l'appui long.
    expect(card).toContain('accessibilityActions={[{ name: "file", label: t.savedPosts.file }]}');
    expect(card).toContain("accessibilityLabel={bookmarkA11y(saveState).label}");
    // L'auteur n'apprend rien : aucun compteur d'enregistrements n'est affiché.
    expect(card).not.toMatch(/saveCount|savedCount/);
  });

  it("le signet suit la publication relue (même carte, fil relu), jamais pendant une demande ; un simple toucher n'envoie aucune collection", () => {
    expect(card).toContain('if (!saveBusy) dispatchSave({ type: "synced", state: saveStateOf(post) });');
    expect(card).toContain("}, [post.viewerHasSaved, post.viewerSavedCollectionId]);");
    expect(card).toContain("await savePost(post.id, saveRequestCollection(action), { firstSave: !before.saved });");
    // L'ancien calcul renvoyait null depuis un signet en retard, et sortait la publication de sa collection.
    expect(card).not.toContain("before.saved ? before.collectionId : null");
  });
});

describe("la liste « Publications enregistrées »", () => {
  it("l'adresse : toutes, ou celles d'une de ses collections ; un identifiant qui n'en est pas un ne demande rien au serveur", () => {
    expect(savedListRoute()).toEqual({ pathname: "/enregistrees", params: {} });
    expect(savedListRoute(SUMMER)).toEqual({ pathname: "/enregistrees", params: { collection: SUMMER } });
    expect(parseSavedListParams({})).toEqual({ collectionId: null });
    expect(parseSavedListParams({ collection: "" })).toEqual({ collectionId: null });
    expect(parseSavedListParams({ collection: SUMMER.toUpperCase() })).toEqual({ collectionId: SUMMER });
    expect(parseSavedListParams({ collection: "../profil" })).toBeNull();
    expect(parseSavedListParams({ collection: ["a", "b"] })).toBeNull();
  });

  it("la phrase d'une liste vide, et une page ajoutée sans doublon", () => {
    expect(savedListEmptyText(false)).toBe(fr.savedPosts.listEmpty);
    expect(savedListEmptyText(true)).toBe("Aucune publication rangée dans cette collection.");
    expect(appendSavedPage([post("a"), post("b")], [post("b"), post("c")]).map((value) => value.id)).toEqual(["a", "b", "c"]);
  });

  it("l'écran : la règle des pages vides des listes de membres, « Réessayer », vous seul, relu au retour", () => {
    const screen = read("app/(app)/enregistrees.tsx");
    expect(screen).toContain("nextEmptyStreak(");
    expect(screen).toContain("loadsWithoutTap(emptyStreak)");
    expect(screen).toContain("<LoadFailure");
    expect(screen).toContain("t.savedPosts.privateNote");
    expect(screen).toContain("useFocusEffect(");
    expect(screen).toContain('<Redirect href="/profile" />');
  });

  it("l'entrée, sous les Envies, et le lien d'une collection : seulement quand le serveur les connaît", () => {
    const panel = read("components/wishlist-panel.tsx");
    expect(panel).toContain("{collectionsAvailable.savedPosts ? (");
    expect(panel).toContain("router.push(savedListRoute())");
    // Retours du build 2 : le lien d'une collection passe dans la feuille « … » de la collection choisie.
    expect(panel).toContain("onPosts={(collection) => router.push(savedListRoute(collection.id))}");
    expect(panel).toContain("savedPosts={collectionsAvailable.savedPosts === true}");
    expect(panel.match(/collectionsAvailable\.savedPosts \?/g)).toHaveLength(1);
    const options = read("components/collection-options-sheet.tsx");
    expect(options.match(/\{savedPosts \? \(/g)).toHaveLength(1);
    expect(options).toContain("onPress={() => then(() => onPosts(collection))}");
  });

  it("l'état des collections : `savedPosts` n'est gardé que vrai, et seulement avec les collections", () => {
    expect(readCollectionsStatus({ enabled: true, reportable: true, savedPosts: true })).toEqual({ enabled: true, reportable: true, savedPosts: true });
    expect(readCollectionsStatus({ enabled: true, reportable: true, savedPosts: false })).toEqual({ enabled: true, reportable: true });
    expect(readCollectionsStatus({ enabled: true, reportable: true })).toEqual({ enabled: true, reportable: true });
    expect(readCollectionsStatus({ enabled: false, savedPosts: true })).toEqual({ enabled: false, reportable: false });
    expect(readCollectionsStatus({ enabled: true, savedPosts: "oui" })).toEqual({ enabled: true, reportable: false });
  });
});

describe("appels au serveur", () => {
  function serveur(reponse: unknown = {}, status = 200) {
    const demandes: { method: string; chemin: string; corps: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        demandes.push({ method: init?.method ?? "GET", chemin: url.replace("https://api.exemple.test", ""), corps: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        return new Response(status === 204 ? null : JSON.stringify(reponse), { status });
      })
    );
    return demandes;
  }
  beforeEach(() => {
    vi.unstubAllGlobals();
    tracked.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("enregistrer : PUT avec la collection (null : sans ; absente pour un simple toucher) ; l'événement « post_saved » seulement au premier enregistrement, sans rien d'autre", async () => {
    const { savePost } = await import("../src/lib/api");
    const demandes = serveur({ saved: true, collectionId: SUMMER });
    expect(await savePost(POST, SUMMER, { firstSave: true })).toEqual({ saved: true, collectionId: SUMMER });
    await savePost(POST, null);
    await savePost(POST);
    await savePost(POST, undefined);
    expect(demandes).toEqual([
      { method: "PUT", chemin: `/api/posts/${POST}/save`, corps: { collectionId: SUMMER } },
      { method: "PUT", chemin: `/api/posts/${POST}/save`, corps: { collectionId: null } },
      { method: "PUT", chemin: `/api/posts/${POST}/save`, corps: {} },
      { method: "PUT", chemin: `/api/posts/${POST}/save`, corps: {} },
    ]);
    expect(tracked).toEqual(["post_saved"]);
    expect(ANALYTICS_EVENTS.post_saved).toEqual({});
  });

  it("retirer : DELETE ; la liste : le curseur et la collection dans l'adresse", async () => {
    const { fetchSavedPosts, unsavePost } = await import("../src/lib/api");
    const demandes = serveur({ posts: [], nextCursor: null });
    await fetchSavedPosts();
    await fetchSavedPosts("2026-11-15T10:00:00.123456+00:00", SUMMER);
    serveur({}, 204);
    await unsavePost(POST);
    expect(demandes.map((demande) => [demande.method, demande.chemin])).toEqual([
      ["GET", "/api/saved-posts"],
      ["GET", `/api/saved-posts?cursor=2026-11-15T10%3A00%3A00.123456%2B00%3A00&collectionId=${SUMMER}`],
    ]);
  });

  it("un refus du serveur arrive en ApiError, avec sa phrase (montrée telle quelle par la carte)", async () => {
    const { savePost } = await import("../src/lib/api");
    serveur({ error: "saved_posts_full", message: "Vous avez atteint la limite de publications enregistrées." }, 409);
    const failure = await savePost(POST, null, { firstSave: true }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe("Vous avez atteint la limite de publications enregistrées.");
    expect(tracked).toEqual([]);
  });
});

describe("textes", () => {
  it("la section « savedPosts » est ajoutée à la fin des deux catalogues, avec les textes de la fiche", () => {
    // Puis seulement les sections des fiches suivantes (épingles, migration 0049 ; « Pour vous », 0050).
    for (const catalog of [fr, en]) {
      const keys = Object.keys(catalog);
      expect(keys.slice(keys.indexOf("savedPosts") + 1)).toEqual(["profilePins", "forYou", "activityPush", "look"]);
    }
    const expected: [keyof typeof fr.savedPosts, string, string][] = [
      ["save", "Enregistrer", "Save"],
      ["unsave", "Retirer des enregistrées", "Remove from saved"],
      ["saved", "Enregistrée", "Saved"],
      ["file", "Ranger", "Add to a collection"],
      ["sheetTitle", "Ranger dans une collection", "Add to a collection"],
      ["noCollection", "Sans collection", "No collection"],
      ["listTitle", "Publications enregistrées", "Saved posts"],
      ["listEmpty", "Vous n'avez encore enregistré aucune publication. Touchez le signet sous une publication pour la retrouver ici.", "You have not saved any posts yet. Tap the bookmark under a post to find it here."],
      ["collectionTab", "Publications", "Posts"],
      ["collectionEmpty", "Aucune publication rangée dans cette collection.", "No posts in this collection."],
      ["privateNote", "Vous seul voyez vos publications enregistrées.", "Only you can see your saved posts."],
      ["savedLabel", "Publication enregistrée", "Post saved"],
      ["notSavedLabel", "Enregistrer la publication", "Save post"],
    ];
    for (const [key, french, english] of expected) {
      expect(fr.savedPosts[key], key).toBe(french);
      expect(en.savedPosts[key], key).toBe(english);
    }
    // Jamais de tutoiement.
    for (const text of Object.values(fr.savedPosts)) expect(typeof text === "string" ? text : (text as (a: string) => string)("Été"), "tutoiement").not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
  });

  it("la politique de confidentialité le dit, en français et en anglais (sans changer de version)", () => {
    const frText = JSON.stringify(privacyPolicy);
    const enText = JSON.stringify(privacyPolicyEn);
    expect(frText).toContain(
      "Vous pouvez enregistrer une publication pour la retrouver, et la ranger dans une de vos collections. Vos publications enregistrées ne sont visibles que par vous : ni leur auteur ni vos amis ne les voient. Une publication enregistrée disparaît de votre liste si vous n'avez plus le droit de la voir."
    );
    expect(enText).toContain(
      "You can save a post to find it again, and add it to one of your collections. Your saved posts are visible only to you: neither their author nor your friends can see them. A saved post disappears from your list if you are no longer allowed to see it."
    );
    // Parmi les données gardées, et parmi celles effacées avec le compte.
    expect(frText.match(/publications enregistrées, /g)?.length).toBeGreaterThanOrEqual(2);
    expect(enText.match(/saved posts, /g)?.length).toBeGreaterThanOrEqual(2);
    // Dans la section « Qui peut voir quoi », juste après les identifications.
    expect(frText.indexOf("Vous pouvez enregistrer une publication")).toBeGreaterThan(frText.indexOf("Une publication peut contenir jusqu'à 5 photos."));
  });
});
