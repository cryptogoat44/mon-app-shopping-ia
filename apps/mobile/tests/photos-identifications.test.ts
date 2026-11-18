import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_TYPES, PEOPLE_TAGS_MAX, POST_PHOTOS_MAX, type AppNotification, type Post } from "@monapp/shared-types";

// Plusieurs photos par publication, identifier des personnes (lot « vie
// sociale », migration 0047), côté app : l'envoi photo après photo
// (réessayer, continuer sans), la position dans le carrousel, ce que l'app
// fait de `media` et `people`, les appels au serveur, les textes et la
// politique de confidentialité. Sans rendu ; `fetch` est simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn(async () => new Blob(["photo"], { type: "image/jpeg" })) }));

import { setActiveLocale } from "../src/i18n";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { ApiError } from "../src/lib/api-error";
import { clampIndex, counterText, indexFromOffset, stepIndex } from "../src/lib/carousel";
import { notificationActionText, notificationTarget } from "../src/lib/follow-state";
import { hasSeveralPhotos, peopleOf, peopleShown, photosOf, postExtrasStatus, readPostExtrasStatus, setPostExtrasStatus, withoutPerson } from "../src/lib/post-extras";
import {
  UPLOAD_IDLE,
  isRetryableUploadError,
  mergePicked,
  photoAdded,
  photoFailed,
  postCreated,
  remainingSlots,
  removePhotoAt,
  retryPhoto,
  skipPhoto,
  startUpload,
  uploadBusy,
  uploadMessage,
  type UploadState,
} from "../src/lib/post-upload";

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const POST = "b1000000-0000-4000-8000-000000000001";
const ME = "a0000000-0000-4000-8000-000000000001";
const DORA = "d0000000-0000-4000-8000-000000000004";
const photo = (name: string) => ({ url: `https://stockage.test/${name}.jpg`, thumbUrl: `https://stockage.test/${name}-mini.jpg` });
const person = (id: string, username: string) => ({ id, username, displayName: username.toUpperCase(), avatarUrl: null });
const basePost = { media: undefined, people: undefined, mediaUrl: "https://stockage.test/1.jpg", mediaThumbUrl: "https://stockage.test/1-mini.jpg" } as Pick<Post, "media" | "people" | "mediaUrl" | "mediaThumbUrl">;

afterEach(() => setActiveLocale("fr"));

describe("envoyer plusieurs photos : la publication d'abord, puis chaque photo, l'une après l'autre", () => {
  it("cinq photos : création avec la photo 1, puis les photos 2 à 5, puis fini ; le texte suit « Envoi de la photo i sur n… »", () => {
    let state: UploadState = startUpload(5);
    expect(state).toEqual({ step: "creating", total: 5 });
    expect(uploadMessage(state)).toBe("Envoi de la photo 1 sur 5…");
    expect(uploadBusy(state)).toBe(true);
    state = postCreated(state, POST);
    const seen: string[] = [];
    while (state.step === "adding") {
      seen.push(uploadMessage(state)!);
      state = photoAdded(state);
    }
    expect(seen).toEqual(["Envoi de la photo 2 sur 5…", "Envoi de la photo 3 sur 5…", "Envoi de la photo 4 sur 5…", "Envoi de la photo 5 sur 5…"]);
    expect(state).toEqual({ step: "done", postId: POST, skipped: 0 });
    expect(uploadBusy(state)).toBe(false);
    expect(uploadMessage(state)).toBeNull();
  });

  it("une seule photo : fini dès la création, sans texte d'envoi (comme avant)", () => {
    const creating = startUpload(1);
    expect(uploadMessage(creating)).toBeNull();
    expect(postCreated(creating, POST)).toEqual({ step: "done", postId: POST, skipped: 0 });
    // Jamais plus de 5, jamais moins d'une.
    expect(startUpload(9)).toEqual({ step: "creating", total: POST_PHOTOS_MAX });
    expect(startUpload(0)).toEqual({ step: "creating", total: 1 });
  });

  it("une photo manquée : « Réessayer » renvoie la même photo ; réussie, la suite reprend", () => {
    let state = postCreated(startUpload(3), POST);
    state = photoFailed(state, true);
    expect(state).toMatchObject({ step: "failed", index: 2, retryable: true });
    expect(uploadMessage(state)).toBe("Cette photo n'a pas pu être envoyée.");
    expect(uploadBusy(state)).toBe(true);
    state = retryPhoto(state);
    expect(state).toEqual({ step: "adding", postId: POST, index: 2, total: 3, skipped: 0 });
    state = photoAdded(state);
    expect(state).toMatchObject({ step: "adding", index: 3 });
    expect(photoAdded(state)).toEqual({ step: "done", postId: POST, skipped: 0 });
  });

  it("« Continuer sans cette photo » : la suivante, ou fini ; les photos laissées de côté sont comptées", () => {
    let state = postCreated(startUpload(3), POST);
    state = skipPhoto(photoFailed(state, true));
    expect(state).toEqual({ step: "adding", postId: POST, index: 3, total: 3, skipped: 1 });
    state = skipPhoto(photoFailed(state, false));
    expect(state).toEqual({ step: "done", postId: POST, skipped: 2 });
  });

  it("refusé pour de bon (10 minutes passées, déjà pleine, nouveauté absente, publication introuvable) : pas de « Réessayer »", () => {
    for (const [status, error] of [
      [409, "post_media_closed"],
      [409, "post_media_full"],
      [404, "post_extras_unavailable"],
      [404, "post_not_found"],
    ] as const) {
      expect(isRetryableUploadError(new ApiError(status, { error, message: "…" })), error).toBe(false);
    }
    // Réseau coupé, limite de l'heure, place prise au même moment, panne : on peut réessayer.
    for (const error of [new TypeError("Network request failed"), new ApiError(429, { error: "post_media_limit", message: "…" }), new ApiError(409, { error: "post_media_conflict", message: "…" }), new ApiError(500, { error: "internal_error", message: "…" })]) {
      expect(isRetryableUploadError(error)).toBe(true);
    }
    const refused = photoFailed(postCreated(startUpload(2), POST), false);
    expect(uploadMessage(refused)).toBe("Cette photo ne peut plus être ajoutée à la publication.");
    // « Réessayer » n'y change rien ; seule la suite est possible.
    expect(retryPhoto(refused)).toBe(refused);
    expect(skipPhoto(refused)).toEqual({ step: "done", postId: POST, skipped: 1 });
  });

  it("un geste hors de propos ne change rien", () => {
    const adding = postCreated(startUpload(2), POST);
    expect(retryPhoto(adding)).toBe(adding);
    expect(skipPhoto(adding)).toBe(adding);
    expect(photoAdded(UPLOAD_IDLE)).toBe(UPLOAD_IDLE);
    expect(postCreated(adding, "autre")).toBe(adding);
    expect(uploadBusy(UPLOAD_IDLE)).toBe(false);
  });

  it("les photos choisies : dans l'ordre, sans doublon, 5 au plus ; une se retire ; le sélecteur sait combien il en reste", () => {
    expect(mergePicked([], ["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(mergePicked(["a", "b"], ["c", "d", "e", "f", "g"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(removePhotoAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(remainingSlots(["a", "b"])).toBe(3);
    expect(remainingSlots(["a", "b", "c", "d", "e"])).toBe(0);
  });
});

describe("le carrousel : une photo à la fois, sans jamais sortir de la liste", () => {
  it("la page la plus proche après un défilement ; bornée aux deux bouts", () => {
    expect(indexFromOffset(0, 390, 5)).toBe(0);
    expect(indexFromOffset(390 * 2 + 100, 390, 5)).toBe(2);
    expect(indexFromOffset(390 * 2 + 300, 390, 5)).toBe(3);
    expect(indexFromOffset(-80, 390, 5)).toBe(0);
    expect(indexFromOffset(390 * 9, 390, 5)).toBe(4);
    // Largeur pas encore connue : la première.
    expect(indexFromOffset(500, 0, 5)).toBe(0);
  });

  it("photo suivante, photo précédente (boutons du site, VoiceOver) ; le compteur « 2/5 »", () => {
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(clampIndex(Number.NaN, 3)).toBe(0);
    expect(clampIndex(4, 0)).toBe(0);
    expect(counterText(1, 5)).toBe("2/5");
    expect(counterText(7, 5)).toBe("5/5");
  });

  it("chaque photo a son libellé « Photo i sur n », en français et en anglais", () => {
    expect(fr.carousel.position(2, 5)).toBe("Photo 2 sur 5");
    expect(en.carousel.position(2, 5)).toBe("Photo 2 of 5");
    const carousel = read("components/post-carousel.tsx");
    expect(carousel).toContain("accessibilityLabel={t.carousel.position(position + 1, count)}");
    // Utilisable sans glisser : réglable avec VoiceOver, boutons sur le site.
    expect(carousel).toContain('accessibilityRole="adjustable"');
    expect(carousel).toContain('{ name: "increment" }, { name: "decrement" }');
    expect(carousel).toContain('Platform.OS === "web" && current > 0');
    expect(carousel).toContain("accessibilityLabel={t.carousel.previous}");
    expect(carousel).toContain("accessibilityLabel={t.carousel.next}");
    // Le double toucher passe toujours au « j'aime » de la carte.
    expect(carousel).toContain("<Pressable onPress={onPress}");
    expect(read("components/post-card.tsx")).toContain("<PostCarousel photos={photos} label={mediaLabel(post)} recyclingKey={post.id} onPress={handleMediaPress} />");
  });
});

describe("ce que l'app fait de `media` et `people`", () => {
  it("la disponibilité : seul `true` montre la nouveauté ; un serveur sans elle vaut « non »", () => {
    expect(readPostExtrasStatus({ carousel: true, peopleTags: true })).toEqual({ carousel: true, peopleTags: true });
    expect(readPostExtrasStatus({ carousel: "oui" })).toEqual({ carousel: false, peopleTags: false });
    expect(readPostExtrasStatus(null)).toEqual({ carousel: false, peopleTags: false });
    expect(postExtrasStatus()).toEqual({ carousel: false, peopleTags: false });
    setPostExtrasStatus({ carousel: true, peopleTags: true });
    expect(postExtrasStatus()).toEqual({ carousel: true, peopleTags: true });
    setPostExtrasStatus({ carousel: false, peopleTags: false });
  });

  it("une publication d'avant (sans `media`) garde sa seule photo ; avec `media`, toutes, la première comprise", () => {
    expect(photosOf(basePost)).toEqual([{ url: "https://stockage.test/1.jpg", thumbUrl: "https://stockage.test/1-mini.jpg" }]);
    expect(hasSeveralPhotos(basePost)).toBe(false);
    const several = { ...basePost, media: [photo("1"), photo("2"), photo("3")] };
    expect(photosOf(several).map((item) => item.url)).toEqual(["1", "2", "3"].map((name) => `https://stockage.test/${name}.jpg`));
    expect(hasSeveralPhotos(several)).toBe(true);
    // Image retirée par la modération : rien à montrer.
    expect(photosOf({ ...basePost, mediaUrl: null })).toEqual([]);
    // Une miniature absente : la photo elle-même.
    expect(photosOf({ ...basePost, media: [photo("1"), { url: "https://stockage.test/2.jpg", thumbUrl: "" }] })[1]!.thumbUrl).toBe("https://stockage.test/2.jpg");
  });

  it("les personnes : celles que le serveur donne ; « Retirer mon identification » retire sa ligne", () => {
    const tagged = { people: [person(ME, "moi"), person(DORA, "dora")] };
    expect(peopleOf(tagged).map((item) => item.id)).toEqual([ME, DORA]);
    expect(peopleOf({ people: undefined })).toEqual([]);
    expect(withoutPerson(tagged, ME).people?.map((item) => item.id)).toEqual([DORA]);
    expect(withoutPerson({ people: [person(ME, "moi")] }, ME)).not.toHaveProperty("people");
  });

  it("la carte suit la publication reçue : une personne que le serveur ne renvoie plus disparaît ; un retrait fait sur la carte tient", () => {
    const before = { people: [person(ME, "moi"), person(DORA, "dora")] };
    expect(peopleShown(before, []).map((item) => item.id)).toEqual([ME, DORA]);
    // Fil relu après un blocage, visibilité passée à « Moi seul » : le serveur ne renvoie plus DORA, ou plus personne.
    expect(peopleShown({ people: [person(ME, "moi")] }, []).map((item) => item.id)).toEqual([ME]);
    expect(peopleShown({ people: undefined }, [])).toEqual([]);
    // « Retirer mon identification » sur cette carte : la ligne part tout de suite, même si la publication en main est l'ancienne.
    expect(peopleShown(before, [ME]).map((item) => item.id)).toEqual([DORA]);
    const card = read("components/post-card.tsx");
    // Relue à chaque affichage, pas copiée une fois au premier.
    expect(card).not.toContain("useState(() => peopleOf(post))");
    expect(card).toContain("const people = peopleShown(post, removedIds);");
    expect(card).toContain("onRemoved={(userId) => setRemovedIds((ids) => [...ids, userId])}");
  });

  it("la carte : l'icône des personnes n'apparaît qu'avec au moins une personne ; seule SA ligne propose de se retirer", () => {
    const card = read("components/post-card.tsx");
    expect(card).toContain("{people.length > 0 ? (");
    expect(card).toContain("accessibilityLabel={t.carousel.showPeople(people.length)}");
    const sheet = read("components/tagged-people-sheet.tsx");
    expect(sheet).toContain("{person.id === viewerId ? (");
    expect(sheet).toContain("await removePeopleTag(postId, viewerId);");
    expect(sheet).toContain("showToast(t.carousel.tagRemoved);");
    expect(fr.carousel.showPeople(1)).toBe("Une personne identifiée, voir la liste");
    expect(fr.carousel.showPeople(3)).toBe("3 personnes identifiées, voir la liste");
    expect(en.carousel.showPeople(3)).toBe("3 people tagged, see the list");
  });

  it("les grilles des profils portent une petite marque « plusieurs photos »", () => {
    for (const screen of ["app/(app)/profil.tsx", "app/(app)/(tabs)/profile/index.tsx"]) {
      const source = read(screen);
      expect(source, screen).toContain("{hasSeveralPhotos(post) ? (");
      expect(source, screen).toContain("accessibilityLabel={t.carousel.morePhotos}");
    }
  });

  it("la modération voit toutes les photos d'une publication signalée", () => {
    const item = read("components/moderation-item.tsx");
    expect(item).toContain("{preview.images && preview.images.length > 1 ? (");
    expect(item).toContain("t.carousel.position(index + 1, preview.images!.length)");
  });
});

describe("l'écran « Nouvelle publication »", () => {
  const screen = read("app/(app)/post-item/new.tsx");

  it("plusieurs photos seulement si le serveur sait les garder : sélection multiple ordonnée, 5 au plus ; sinon une seule, comme avant", () => {
    expect(screen).toContain("const extras = usePostExtrasStatus();");
    expect(screen).toMatch(/if \(extras\.carousel\) \{\s*const slots = remainingSlots\(photos\);/);
    expect(screen).toContain("allowsMultipleSelection: true,");
    expect(screen).toContain("selectionLimit: slots,");
    expect(screen).toContain("orderedSelection: true,");
    expect(screen).toContain('const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });');
    expect(screen).toContain("sending.current = extras.carousel ? photos.slice(0, POST_PHOTOS_MAX) : [imageUri];");
  });

  it("la publication part avec la photo 1, puis les autres une par une ; « Réessayer » ou « Continuer sans cette photo »", () => {
    expect(screen).toContain("postId = (await createLifestylePost({ caption: caption.trim(), imageUri, privacy, taggedPieces, peopleTags })).id;");
    expect(screen).toContain("await addPostPhoto(state.postId, sending.current[state.index - 1]!);");
    expect(screen).toContain("{upload.retryable ? (");
    expect(screen).toContain("{t.carousel.publishWithout}");
    // L'écran reste ouvert : « Annuler » et « Publier » inactifs pendant l'envoi.
    expect(screen).toContain("disabled={busy}");
    expect(screen).toContain('pointerEvents={busy ? "none" : "auto"}');
  });

  it("« Identifier des personnes » seulement si le serveur sait les garder ; 5 au plus ; ni soi-même ; la note le dit", () => {
    expect(PEOPLE_TAGS_MAX).toBe(5);
    expect(screen).toContain("{extras.peopleTags ? (");
    expect(screen).toContain("const peopleTags = extras.peopleTags ? people.map((person) => person.id) : [];");
    expect(screen).toContain("{people.length < PEOPLE_TAGS_MAX ? (");
    expect(screen).toContain("person.id !== profile?.id");
    expect(screen).toContain("{t.carousel.peopleNote}");
  });
});

describe("appels au serveur", () => {
  /** Serveur simulé : note chaque demande (méthode, adresse, champs du formulaire). */
  function serveur(reponse: unknown = {}, status = 200) {
    const demandes: { method: string; chemin: string; champs: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const champs: Record<string, string> = {};
        if (init?.body instanceof FormData) for (const [key, value] of init.body.entries()) champs[key] = typeof value === "string" ? value : "(fichier)";
        demandes.push({ method: init?.method ?? "GET", chemin: url.replace("https://api.exemple.test", ""), champs });
        return new Response(JSON.stringify(reponse), { status });
      })
    );
    return demandes;
  }
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("publier avec des personnes : le champ « peopleTags » (JSON) ; sans personne, aucun champ (un serveur sans 0047 publie comme avant)", async () => {
    const { createLifestylePost } = await import("../src/lib/api");
    const demandes = serveur({ id: POST, privacy: "public" });
    await createLifestylePost({ caption: "Look", imageUri: "file:///a.jpg", privacy: "public", peopleTags: [DORA] });
    await createLifestylePost({ caption: "Look", imageUri: "file:///a.jpg", privacy: "public", peopleTags: [] });
    expect(demandes[0]).toMatchObject({ method: "POST", chemin: "/api/posts", champs: { type: "lifestyle", peopleTags: JSON.stringify([DORA]), file: "(fichier)" } });
    expect(demandes[1]!.champs).not.toHaveProperty("peopleTags");
  });

  it("ajouter une photo : une requête par photo, vers la publication ; retirer une identification : DELETE", async () => {
    const { addPostPhoto, removePeopleTag } = await import("../src/lib/api");
    const demandes = serveur({ media: [photo("1"), photo("2")] }, 201);
    expect((await addPostPhoto(POST, "file:///b.jpg")).media).toHaveLength(2);
    await removePeopleTag(POST, ME);
    expect(demandes.map((demande) => [demande.method, demande.chemin])).toEqual([
      ["POST", `/api/posts/${POST}/media`],
      ["DELETE", `/api/posts/${POST}/people-tags/${ME}`],
    ]);
    expect(demandes[0]!.champs).toEqual({ file: "(fichier)" });
  });

  it("une photo refusée par le serveur arrive en ApiError, avec son code", async () => {
    const { addPostPhoto } = await import("../src/lib/api");
    serveur({ error: "post_media_closed", message: "Cette publication ne peut plus recevoir de photo." }, 409);
    const failure = await addPostPhoto(POST, "file:///b.jpg").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(isRetryableUploadError(failure)).toBe(false);
  });
});

describe("onglet Activité : « vous a identifié(e) dans une publication »", () => {
  it("le texte, en français et en anglais ; la ligne mène à la publication", () => {
    expect(NOTIFICATION_TYPES).toContain("tag");
    expect(notificationActionText("tag")).toBe("vous a identifié(e) dans une publication.");
    setActiveLocale("en");
    expect(notificationActionText("tag")).toBe("tagged you in a post.");
    const notice = { type: "tag", postId: POST } as Pick<AppNotification, "type" | "postId">;
    expect(notificationTarget(notice, ME)).toEqual({ screen: "post", id: POST });
  });
});

describe("textes", () => {
  it("la section « carousel » est ajoutée à la fin des deux catalogues, avec les textes de la fiche", () => {
    expect(Object.keys(fr).at(-1)).toBe("carousel");
    expect(Object.keys(en).at(-1)).toBe("carousel");
    expect(fr.carousel.addPhotos).toBe("Ajouter jusqu'à 5 photos");
    expect(en.carousel.addPhotos).toBe("Add up to 5 photos");
    expect(fr.carousel.uploading(2, 5)).toBe("Envoi de la photo 2 sur 5…");
    expect(en.carousel.uploading(2, 5)).toBe("Uploading photo 2 of 5…");
    expect(fr.carousel.publishWithout).toBe("Continuer sans cette photo");
    expect(fr.carousel.tagPeople).toBe("Identifier des personnes");
    expect(en.carousel.peopleTitle).toBe("People in this post");
    expect(fr.carousel.removeMyTag).toBe("Retirer mon identification");
    expect(fr.carousel.peopleNote).toBe("Une personne n'apparaît que si elle accepte d'être identifiée. 5 personnes au plus.");
    expect(en.carousel.peopleNote).toBe("A person only appears if they allow being tagged. 5 people at most.");
    // Jamais de tutoiement.
    for (const text of Object.values(fr.carousel)) expect(typeof text === "string" ? text : (text as (a: number, b: number) => string)(2, 5), "tutoiement").not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
  });

  it("la politique de confidentialité le dit, en français et en anglais (sans changer de version)", () => {
    const frText = JSON.stringify(privacyPolicy);
    const enText = JSON.stringify(privacyPolicyEn);
    expect(frText).toContain("Une publication peut contenir jusqu'à 5 photos.");
    expect(frText).toContain("seuls ceux qui l'acceptent (réglage « Qui peut me mentionner », au départ : les comptes que vous suivez) et qui peuvent voir la publication sont identifiés");
    expect(frText).toContain("elle la perd si elle ne peut plus voir la publication.");
    expect(frText).toContain("commentaires, mentions, personnes identifiées, « j'aime »");
    expect(enText).toContain("A post can contain up to 5 photos.");
    expect(enText).toContain("the tag is removed if they can no longer see the post.");
    expect(enText).toContain("comments, mentions, tagged people, likes");
  });
});
