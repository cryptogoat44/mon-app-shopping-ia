import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModerationPreview, Post } from "@monapp/shared-types";

// Épingles et lien en bio (lot « vie sociale », migration 0049), côté app : ce
// que le profil montre du lien (le nom du site en clair), la règle vérifiée
// tout de suite dans « Modifier le profil », ce qui part au serveur, l'adresse
// relue avant d'ouvrir quoi que ce soit, les épinglées en tête sans doublon,
// les appels au serveur, les textes et la politique de confidentialité. Sans
// rendu ; `fetch` est simulé ; les écrans sont lus comme du texte.
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
import { termsOfUse } from "../src/legal/conditions";
import { termsOfUseEn } from "../src/legal/conditions.en";
import { ApiError } from "../src/lib/api-error";
import { bioLinkError, httpsParts, linkDisplay, linkToSend } from "../src/lib/bio-link";
import { appendGridPage, gridCellLabel, pinActionOf, pinEntryShown, pinnedFirst, profileGrid } from "../src/lib/profile-pins";
import { moderationNoticeLines, profileRemovalActions } from "../src/lib/moderation-labels";

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const POST_ID = "a1000000-0000-4000-8000-000000000001";
const USER_ID = "b2000000-0000-4000-8000-000000000002";
const post = (id: string, pinnedAt?: string | null) => ({ id, type: "lifestyle", ...(pinnedAt !== undefined ? { pinnedAt } : {}) }) as Post;
const ids = (posts: readonly Post[]) => posts.map((p) => p.id);

afterEach(() => setActiveLocale("fr"));

describe("le lien sur le profil : le nom du site en clair", () => {
  it("le nom du site seul pour la page d'accueil, suivi de « /… » quand le lien mène plus loin", () => {
    expect(linkDisplay("https://exemple.com/")).toEqual({ host: "exemple.com", label: "exemple.com", href: "https://exemple.com/" });
    expect(linkDisplay("https://exemple.com")).toEqual({ host: "exemple.com", label: "exemple.com", href: "https://exemple.com/" });
    expect(linkDisplay("https://boutique.exemple.fr/robes?taille=38#haut")).toEqual({
      host: "boutique.exemple.fr",
      label: "boutique.exemple.fr/…",
      href: "https://boutique.exemple.fr/robes?taille=38#haut",
    });
    // Le nom du site tel que le lit le parseur standard (en minuscules).
    expect(linkDisplay("https://Exemple.COM/A")?.host).toBe("exemple.com");
  });

  it("rien n'est affiché sans lien, ni pour une adresse que la règle refuserait (même venue du serveur)", () => {
    for (const value of [null, undefined, "", "   "]) expect(linkDisplay(value), String(value)).toBeNull();
    for (const value of [
      "http://exemple.com/",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<b>x</b>",
      "mailto:anna@exemple.com",
      "https://127.0.0.1/",
      "https://nom:secret@exemple.com/",
      "https://exemple.com:8443/",
      "https://xn--exmple-cua.com/",
      "https://exämple.com/",
      "https://localhost/",
    ]) {
      expect(linkDisplay(value), value).toBeNull();
    }
  });
});

describe("l'adresse relue avant d'ouvrir (httpsParts) : jamais autre chose que « https: »", () => {
  it("le nom du site et le reste de l'adresse, séparés", () => {
    expect(httpsParts("https://exemple.com/")).toEqual({ href: "https://exemple.com/", host: "exemple.com", rest: "" });
    expect(httpsParts("https://exemple.com/a/b?c=1")).toEqual({ href: "https://exemple.com/a/b?c=1", host: "exemple.com", rest: "/a/b?c=1" });
  });

  it("refusées : autre protocole (même en majuscules ou coupé d'une tabulation), identifiants, espaces, rien qui ne soit un texte", () => {
    for (const value of [
      "http://exemple.com/",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "ht\ttps://exemple.com/",
      "https:\t//exemple.com/",
      "data:text/html,<script>alert(1)</script>",
      "mailto:anna@exemple.com",
      "file:///etc/passwd",
      "//exemple.com/",
      "https:exemple.com",
      "https://nom:secret@exemple.com/",
      "https://nom@exemple.com/",
      "https://exemple.com/a b",
      "https://exemple.com/a\nb",
      " https://exemple.com/",
    ]) {
      expect(httpsParts(value), JSON.stringify(value)).toBeNull();
    }
    for (const value of [null, undefined, 42, {}, ["https://exemple.com/"]]) expect(httpsParts(value)).toBeNull();
  });
});

describe("« Modifier le profil » : la règle du serveur, vérifiée tout de suite", () => {
  it("vide ou bon : aucune phrase ; refusé : la phrase de la fiche ; trop long : la sienne", () => {
    expect(bioLinkError("")).toBeNull();
    expect(bioLinkError("   ")).toBeNull();
    expect(bioLinkError("https://exemple.com")).toBeNull();
    expect(bioLinkError(" https://exemple.com/boutique ")).toBeNull();
    for (const value of ["exemple.com", "http://exemple.com", "javascript:alert(1)", "https://127.0.0.1", "https://xn--exmple-cua.com", "https://exämple.com", "https://a:b@exemple.com"]) {
      expect(bioLinkError(value), value).toBe("Ce lien n'est pas valide. Il doit commencer par https://.");
    }
    expect(bioLinkError(`https://exemple.com/${"a".repeat(181)}`)).toBe("Ce lien est trop long (200 caractères au plus).");
    setActiveLocale("en");
    expect(bioLinkError("http://exemple.com")).toBe("This link is not valid. It must start with https://.");
    expect(bioLinkError(`https://exemple.com/${"a".repeat(181)}`)).toBe("This link is too long (200 characters maximum).");
  });

  it("ce qui part au serveur : rien quand le lien ne change pas (ou que le serveur ne connaît pas les liens), null pour le retirer, sinon le lien mis en forme", () => {
    // Serveur sans 0049 : le champ n'est jamais envoyé.
    expect(linkToSend(undefined, "https://exemple.com")).toBeUndefined();
    // Inchangé, même écrit autrement : pas envoyé (ne compte pas comme un changement de lien).
    expect(linkToSend("https://exemple.com/", "https://exemple.com")).toBeUndefined();
    expect(linkToSend("https://exemple.com/", "  HTTPS://Exemple.com/  ")).toBeUndefined();
    expect(linkToSend(null, "")).toBeUndefined();
    expect(linkToSend(null, "   ")).toBeUndefined();
    // Retiré.
    expect(linkToSend("https://exemple.com/", "")).toBeNull();
    // Changé : mis en forme comme le serveur le rangera.
    expect(linkToSend(null, " https://Exemple.com/Boutique ")).toBe("https://exemple.com/Boutique");
    expect(linkToSend("https://exemple.com/", "https://autre.fr")).toBe("https://autre.fr/");
    // Refusé : part tel quel (l'écran le bloque avant ; le serveur répondrait avec sa phrase).
    expect(linkToSend(null, " http://exemple.com ")).toBe("http://exemple.com");
  });

  it("l'écran : le champ n'existe que si le serveur connaît les liens ; clavier d'adresse, sans majuscule ; le lien n'est envoyé que s'il change", () => {
    const screen = read("app/(app)/edit-profile.tsx");
    expect(screen).toContain("const linkShown = profile?.linkUrl !== undefined;");
    expect(screen).toContain("{linkShown ? (");
    for (const prop of ['keyboardType="url"', 'autoCapitalize="none"', "autoCorrect={false}", 'placeholder="https://"', "accessibilityLabel={t.profilePins.linkLabel}"]) {
      expect(screen, prop).toContain(prop);
    }
    expect(screen).toContain("const linkUrl = linkToSend(profile?.linkUrl, link);");
    expect(screen).toContain("...(linkUrl !== undefined ? { linkUrl } : {}),");
    // Un lien refusé bloque l'enregistrement, avec sa phrase.
    expect(screen).toContain("const blocked = bioIssue !== null || linkIssue !== null;");
  });
});

describe("« Vous allez quitter Spotto » : rien ne s'ouvre sans confirmation, ni sans https", () => {
  const sheet = read("components/external-link-sheet.tsx");
  const profileLink = read("components/profile-link.tsx");

  it("la feuille relit l'adresse et n'ouvre qu'une adresse « https: » : nouvel onglet sans lien vers Spotto sur le site, Linking sur l'iPhone", () => {
    expect(sheet).toContain("const parts = httpsParts(url);\n  if (!parts) return false;");
    expect(sheet).toContain('window.open(parts.href, "_blank", "noopener,noreferrer");');
    expect(sheet).toContain("Linking.openURL(parts.href)");
    // Jamais l'adresse brute, jamais un clic enregistré, jamais une adresse réécrite.
    expect(sheet).not.toMatch(/openURL\((?!parts\.href)/);
    expect(sheet).not.toMatch(/window\.open\((?!parts\.href)/);
    expect(sheet).not.toMatch(/\btrack\(|analytics|affiliate/i);
    // Fermée tant que l'adresse n'est pas une adresse https.
    expect(sheet).toContain("<Modal visible={parts !== null}");
  });

  it("l'adresse complète : le nom du site seul sur sa ligne, en gras, puis le reste ; le titre, la phrase et les deux boutons", () => {
    expect(sheet).toMatch(/<Text style=\{styles\.host\}[^>]*>\s*\{parts\.host\}/);
    expect(sheet).toMatch(/<Text style=\{styles\.rest\}[^>]*>\s*\{parts\.rest\}/);
    expect(sheet).toMatch(/host: \{[^}]*fontWeight: "700"/);
    for (const key of ["leaveTitle", "leaveBody", "leaveAddress", "open", "cancel"]) expect(sheet, key).toContain(`t.profilePins.${key}`);
    expect(sheet).toContain("accessibilityViewIsModal");
  });

  it("une adresse longue ou un grand texte : tout défile dans la feuille, « Ouvrir le lien » reste atteignable, après l'adresse", () => {
    // La feuille est bornée (80 % de l'écran) : son contenu doit défiler, sinon les boutons sortent de l'écran.
    expect(sheet).toMatch(/sheet: \{[^}]*maxHeight: "80%"/);
    const scrollStart = sheet.indexOf("<ScrollView style={styles.scroll}");
    const scrollEnd = sheet.indexOf("</ScrollView>");
    expect(scrollStart).toBeGreaterThan(sheet.indexOf("<View style={styles.handle} />"));
    // Le titre, la phrase, l'adresse et les deux boutons sont DANS la zone qui défile, dans cet ordre.
    const order = ["t.profilePins.leaveTitle", "t.profilePins.leaveBody", "{parts.host}", 'testID="ouvrir-le-lien"', 'testID="annuler-le-lien"'].map((marker) => sheet.indexOf(marker));
    for (const position of order) {
      expect(position).toBeGreaterThan(scrollStart);
      expect(position).toBeLessThan(scrollEnd);
    }
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // La zone qui défile rétrécit dans la feuille au lieu de la faire déborder.
    expect(sheet).toMatch(/scroll: \{[^}]*flexShrink: 1/);
  });

  it("sur le profil : le toucher ouvre la feuille, jamais le lien directement ; rôle « lien » et sa description", () => {
    expect(profileLink).not.toContain("Linking");
    expect(profileLink).not.toContain("window.open");
    expect(profileLink).toContain("<ExternalLinkSheet url={open ? shown.href : null}");
    expect(profileLink).toContain("onPress={() => setOpen(true)}");
    expect(profileLink).toContain('accessibilityRole="link"');
    expect(profileLink).toContain("accessibilityLabel={t.profilePins.linkA11y(shown.host)}");
    expect(profileLink).toContain("const shown = linkDisplay(url);\n  if (!shown) return null;");
    // Sous la bio, sur les deux profils.
    expect(read("app/(app)/profil.tsx")).toContain("<ProfileLink url={profile.linkUrl} />");
    expect(read("app/(app)/(tabs)/profile/index.tsx")).toContain("<ProfileLink url={profile?.linkUrl}");
  });

  it("la modération voit le lien en texte, jamais un lien qui s'ouvre", () => {
    const item = read("components/moderation-item.tsx");
    const block = item.slice(item.indexOf('testID="lien-du-profil-signale"') - 200, item.indexOf('testID="lien-du-profil-signale"') + 300);
    expect(block).toContain("{preview.linkUrl}");
    expect(block).not.toMatch(/onPress|Linking|ExternalLinkSheet|accessibilityRole="link"/);
  });
});

describe("épingler : l'entrée, et les épinglées en tête sans doublon", () => {
  it("l'entrée : sur ses propres photos, et seulement si le serveur dit où en est l'épingle", () => {
    expect(pinEntryShown({ type: "lifestyle", pinnedAt: null }, true)).toBe(true);
    expect(pinEntryShown({ type: "lifestyle", pinnedAt: "2026-11-19T10:00:00Z" }, true)).toBe(true);
    // Serveur sans 0049.
    expect(pinEntryShown({ type: "lifestyle" }, true)).toBe(false);
    // Une publication d'un autre membre.
    expect(pinEntryShown({ type: "lifestyle", pinnedAt: null }, false)).toBe(false);
    // Un achat, une envie : jamais.
    expect(pinEntryShown({ type: "purchase", pinnedAt: null }, true)).toBe(false);
    expect(pinEntryShown({ type: "wish", pinnedAt: null }, true)).toBe(false);
    expect(pinActionOf({ pinnedAt: null })).toBe("pin");
    expect(pinActionOf({})).toBe("pin");
    expect(pinActionOf({ pinnedAt: "2026-11-19T10:00:00Z" })).toBe("unpin");
  });

  it("sa propre grille : les épinglées d'abord, la plus récemment épinglée en tête, 3 au plus, puis les autres dans leur ordre, chacune une fois", () => {
    const grid = pinnedFirst([
      post("A", null),
      post("B", "2026-11-19T10:00:00Z"),
      post("C", null),
      post("D", "2026-11-19T12:00:00Z"),
      post("E", "2026-11-19T11:00:00Z"),
      // Une quatrième (deux épingles au même instant) : à sa place, sans marque.
      post("F", "2026-11-19T09:00:00Z"),
    ]);
    expect(ids(grid.posts)).toEqual(["D", "E", "B", "A", "C", "F"]);
    expect([...grid.pinnedIds]).toEqual(["D", "E", "B"]);
    // Serveur sans 0049 : l'ordre ne change pas, aucune marque.
    const old = pinnedFirst([post("A"), post("B"), post("C")]);
    expect(ids(old.posts)).toEqual(["A", "B", "C"]);
    expect(old.pinnedIds.size).toBe(0);
  });

  it("le profil d'un autre : `pinned` d'abord, puis la page sans doublon ; une page suivante n'ajoute jamais une publication déjà montrée", () => {
    const grid = profileGrid({ posts: [post("A"), post("B"), post("C")], pinned: [post("C"), post("Z")] });
    expect(ids(grid.posts)).toEqual(["C", "Z", "A", "B"]);
    expect([...grid.pinnedIds]).toEqual(["C", "Z"]);
    // Sans `pinned` (serveur sans 0049, compte privé vu par un inconnu) : la page telle quelle.
    const plain = profileGrid({ posts: [post("A"), post("B")] });
    expect(ids(plain.posts)).toEqual(["A", "B"]);
    expect(plain.pinnedIds.size).toBe(0);
    // Jamais plus de 3, même si le serveur en donnait davantage.
    expect(profileGrid({ posts: [], pinned: [post("P1"), post("P2"), post("P3"), post("P4")] }).pinnedIds.size).toBe(3);
    // L'épinglée « Z » revient à sa place chronologique dans la page suivante : pas deux fois.
    expect(ids(appendGridPage(grid.posts, [post("Z"), post("D")]))).toEqual(["C", "Z", "A", "B", "D"]);
  });

  it("les écrans : l'entrée dans sa publication, la marque sur les épinglées, les deux profils en tête de grille", () => {
    const publication = read("app/(app)/publication.tsx");
    expect(publication).toContain("{pinEntryShown(post, isMine) ? (");
    expect(publication).toContain('await updatePostPin(post.id, action === "pin")');
    // Un refus (3 au plus) : la phrase du serveur.
    expect(publication).toContain("setError(e instanceof ApiError ? e.message : t.profilePins.pinError);");
    const own = read("app/(app)/(tabs)/profile/index.tsx");
    expect(own).toContain("const lifestyleGrid = pinnedFirst(lifestylePosts);");
    const other = read("app/(app)/profil.tsx");
    expect(other.match(/const grid = profileGrid\(page\);/g)).toHaveLength(2);
    expect(other).toContain("setPosts((prev) => appendGridPage(prev ?? [], page.posts));");
    expect(read("components/icons.tsx")).toContain("export function PinIcon(");
  });

  it("épingle et visibilité en même temps : jamais l'ancienne visibilité remise à l'écran par la réponse de l'épingle", () => {
    const publication = read("app/(app)/publication.tsx");
    // La réponse de l'épingle ne change que la date de l'épingle, sur la publication telle qu'elle est à la réponse.
    expect(publication).toContain("setPost((current) => (current ? { ...current, pinnedAt } : current));");
    expect(publication).not.toContain("setPost({ ...post, pinnedAt })");
    // Une seule demande à la fois : les pastilles de visibilité et l'épingle attendent l'une l'autre.
    expect(publication).toContain("const ownerBusy = changingPrivacy || pinning;");
    expect(publication).toContain("if (!post || post.privacy === privacy || ownerBusy) return;");
    expect(publication).toContain("if (!post || ownerBusy) return;");
    expect(publication.match(/disabled=\{ownerBusy\}/g)).toHaveLength(2);
    expect(publication).not.toMatch(/disabled=\{(changingPrivacy|pinning)\}/);
  });

  it("VoiceOver : « Épinglée » est lu dans le libellé de la case, jamais par une marque cachée dans la case", () => {
    expect(gridCellLabel("Robe verte", true)).toBe("Robe verte, Épinglée");
    expect(gridCellLabel("Robe verte", false)).toBe("Robe verte");
    setActiveLocale("en");
    expect(gridCellLabel("Green dress", true)).toBe("Green dress, Pinned");
    setActiveLocale("fr");
    // Les deux grilles : le libellé de la case touchable porte l'épingle ; la
    // marque n'est plus un élément accessible à part (jamais atteint).
    const own = read("app/(app)/(tabs)/profile/index.tsx");
    expect(own).toContain("accessibilityLabel={gridCellLabel(post.caption ?? t.profile.lifestylePhoto, lifestyleGrid.pinnedIds.has(post.id))}");
    const other = read("app/(app)/profil.tsx");
    expect(other).toContain("accessibilityLabel={gridCellLabel(post.caption ?? t.postDetail.title, pinnedIds.has(post.id))}");
    for (const [screen, source] of [["profil", other], ["profile/index", own]] as const) {
      expect(source, screen).toContain('<View style={styles.pinMark} testID="marque-epinglee">');
      expect(source, screen).not.toContain("accessibilityLabel={t.profilePins.pinnedMark}");
    }
  });
});

describe("modération : retirer la bio retire aussi le lien, et chacun le sait", () => {
  const author = { id: "alice", username: "alice", displayName: "Alice", avatarUrl: null, suspended: false };
  const withLink: ModerationPreview = { kind: "user", author, bio: "Une bio", linkUrl: "https://exemple.com/" };
  const withoutLink: ModerationPreview = { kind: "user", author, bio: "Une bio" };

  it("l'avertissement de l'administrateur cite le lien quand il y en a un", () => {
    const [bio] = profileRemovalActions({ preview: withLink, canRemoveBio: true, canRemoveAvatar: false });
    expect(bio?.warning).toContain("Le lien du profil sera retiré avec elle.");
    const [plain] = profileRemovalActions({ preview: withoutLink, canRemoveBio: true, canRemoveAvatar: false });
    expect(plain?.warning).not.toContain("lien");
  });

  it("un lien sans bio : le serveur propose le retrait, le bouton s'appelle « Retirer le lien » (jamais la suspension seule)", () => {
    const linkOnly: ModerationPreview = { kind: "user", author, bio: null, linkUrl: "https://exemple.com/connexion" };
    const [link] = profileRemovalActions({ preview: linkOnly, canRemoveBio: true, canRemoveAvatar: false });
    // La même décision côté serveur (partie « bio »), nommée d'après ce qu'elle retire.
    expect(link).toEqual({
      part: "bio",
      label: "Retirer le lien",
      warning: "Retirer le lien de ce profil ? Il sera effacé : cette décision ne s'annule pas. La personne sera prévenue, avec le motif choisi. Elle pourra en mettre un autre, sauf si son compte est suspendu.",
      saved: "Lien retiré.",
    });
    // Une bio faite d'espaces compte comme vide.
    expect(profileRemovalActions({ preview: { ...linkOnly, bio: "   " }, canRemoveBio: true, canRemoveAvatar: false })[0]?.label).toBe("Retirer le lien");
    // Bio et lien : « Retirer la bio », qui dit que le lien part aussi.
    expect(profileRemovalActions({ preview: withLink, canRemoveBio: true, canRemoveAvatar: false })[0]?.label).toBe("Retirer la bio");
    // Un serveur qui ne le propose pas (ancien, ou sans 0049) : rien.
    expect(profileRemovalActions({ preview: linkOnly, canRemoveBio: false, canRemoveAvatar: false })).toEqual([]);
    expect(profileRemovalActions({ preview: linkOnly })).toEqual([]);
    setActiveLocale("en");
    expect(profileRemovalActions({ preview: linkOnly, canRemoveBio: true, canRemoveAvatar: false })[0]).toMatchObject({ label: "Remove the link", saved: "Link removed." });
  });

  it("la personne concernée apprend que son lien part avec sa bio", () => {
    expect(moderationNoticeLines({ action: "remove_bio", targetType: "user", reason: "spam", note: null })[0]).toBe(
      "Votre bio a été retirée par la modération, avec le lien de votre profil s'il y en avait un."
    );
    setActiveLocale("en");
    expect(moderationNoticeLines({ action: "remove_bio", targetType: "user", reason: "spam", note: null })[0]).toBe(
      "Your bio was removed by moderation, along with your profile link if you had one."
    );
  });
});

describe("appels au serveur", () => {
  function serveur(reponse: unknown = {}, status = 200) {
    const demandes: { method: string; chemin: string; corps: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        demandes.push({ method: init?.method ?? "GET", chemin: url.replace("https://api.exemple.test", ""), corps: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        return new Response(JSON.stringify(reponse), { status });
      })
    );
    return demandes;
  }
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("épingler et retirer l'épingle : PUT avec `pinned`, la date rendue par le serveur", async () => {
    const { updatePostPin } = await import("../src/lib/api");
    const demandes = serveur({ pinnedAt: "2026-11-19T10:00:00.000Z" });
    expect(await updatePostPin(POST_ID, true)).toEqual({ pinnedAt: "2026-11-19T10:00:00.000Z" });
    serveur({ pinnedAt: null });
    await updatePostPin(POST_ID, false);
    expect(demandes).toEqual([{ method: "PUT", chemin: `/api/posts/${POST_ID}/pin`, corps: { pinned: true } }]);
  });

  it("un refus arrive en ApiError avec la phrase du serveur (3 au plus)", async () => {
    const { updatePostPin } = await import("../src/lib/api");
    serveur({ error: "pin_limit", message: "Vous pouvez épingler 3 publications au plus. Retirez-en une d'abord." }, 409);
    const failure = await updatePostPin(POST_ID, true).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe("Vous pouvez épingler 3 publications au plus. Retirez-en une d'abord.");
  });

  it("le profil d'un membre : la première page porte `pinned` ; enregistrer le profil n'envoie `linkUrl` que s'il est donné", async () => {
    const { fetchUserPosts, updateMyProfile } = await import("../src/lib/api");
    const demandes = serveur({ posts: [], nextCursor: null, pinned: [{ id: POST_ID }] });
    expect((await fetchUserPosts(USER_ID)).pinned).toEqual([{ id: POST_ID }]);
    await updateMyProfile({ username: "anna", displayName: "Anna", bio: "" });
    await updateMyProfile({ username: "anna", displayName: "Anna", bio: "", linkUrl: null });
    expect(demandes.map((d) => [d.method, d.chemin, d.corps])).toEqual([
      ["GET", `/api/users/${USER_ID}/posts`, null],
      ["PATCH", "/api/me", { username: "anna", displayName: "Anna", bio: "" }],
      ["PATCH", "/api/me", { username: "anna", displayName: "Anna", bio: "", linkUrl: null }],
    ]);
  });
});

describe("textes", () => {
  it("la section « profilePins » est ajoutée à la fin des deux catalogues, mêmes clés, avec les textes de la fiche", () => {
    // Puis seulement les sections des fiches suivantes (« Pour vous », migration 0050).
    for (const catalog of [fr, en]) {
      const keys = Object.keys(catalog);
      expect(keys.slice(keys.indexOf("profilePins") + 1)).toEqual(["forYou"]);
    }
    expect(Object.keys(en.profilePins)).toEqual(Object.keys(fr.profilePins));
    const expected: [keyof typeof fr.profilePins, string, string][] = [
      ["pin", "Épingler sur mon profil", "Pin to my profile"],
      ["unpin", "Retirer l'épingle", "Unpin"],
      ["pinned", "Publication épinglée.", "Post pinned."],
      ["pinnedMark", "Épinglée", "Pinned"],
      ["linkLabel", "Lien", "Link"],
      ["linkHelp", "Une adresse qui commence par https://. Elle est visible sur votre profil.", "An address starting with https://. It is visible on your profile."],
      ["linkInvalid", "Ce lien n'est pas valide. Il doit commencer par https://.", "This link is not valid. It must start with https://."],
      ["leaveTitle", "Vous allez quitter Spotto", "You are about to leave Spotto"],
      [
        "leaveBody",
        "Ce lien a été ajouté par un membre. Spotto ne contrôle pas ce site et ne peut pas vérifier où il mène. Ne saisissez jamais votre mot de passe Spotto ailleurs que dans l'app.",
        "This link was added by a member. Spotto does not control this site and cannot check where it leads. Never enter your Spotto password anywhere but in the app.",
      ],
      ["open", "Ouvrir le lien", "Open link"],
      ["cancel", "Annuler", "Cancel"],
    ];
    for (const [key, french, english] of expected) {
      expect(fr.profilePins[key], key).toBe(french);
      expect(en.profilePins[key], key).toBe(english);
    }
    expect(fr.profilePins.linkA11y("exemple.com")).toBe("Lien vers exemple.com, s'ouvre hors de Spotto");
    expect(en.profilePins.linkA11y("exemple.com")).toBe("Link to exemple.com, opens outside Spotto");
    // Jamais de tutoiement.
    for (const text of Object.values(fr.profilePins)) {
      expect(typeof text === "string" ? text : (text as (host: string) => string)("exemple.com"), "tutoiement").not.toMatch(/\b(tu|toi|ton|ta|tes)\b/i);
    }
  });

  it("la politique de confidentialité le dit, en français et en anglais (sans changer de version), et les conditions couvrent le lien", () => {
    const frText = JSON.stringify(privacyPolicy);
    const enText = JSON.stringify(privacyPolicyEn);
    expect(frText).toContain(
      "Vous pouvez épingler jusqu'à 3 publications en haut de votre profil et y afficher un lien vers un site web. Ce lien est visible par les membres qui voient votre profil (vos abonnés acceptés seulement, si votre compte est privé). Les sites vers lesquels mènent les liens des membres ne dépendent pas de Spotto ; un écran vous prévient avant de quitter l'app."
    );
    expect(enText).toContain(
      "You can pin up to 3 posts at the top of your profile and display a link to a website. This link is visible to members who can see your profile (only your approved followers, if your account is private). Sites that members link to are outside Spotto's control; a screen warns you before you leave the app."
    );
    // Parmi les données du profil et des publications.
    expect(frText).toContain("bio, lien affiché sur votre profil, photo de profil");
    expect(enText).toContain("bio, link shown on your profile, profile photo");
    expect(frText).toContain("visibilité choisie, publications épinglées, commentaires");
    expect(enText).toContain("chosen visibility, pinned posts, comments");
    // Dans « Qui peut voir quoi », après les publications enregistrées.
    expect(frText.indexOf("Vous pouvez épingler jusqu'à 3 publications")).toBeGreaterThan(frText.indexOf("Vous pouvez enregistrer une publication"));
    expect(JSON.stringify(termsOfUse)).toContain("Ces règles valent aussi pour le lien que vous affichez sur votre profil, comme pour votre bio.");
    expect(JSON.stringify(termsOfUseEn)).toContain("These rules also apply to the link you display on your profile, as they do to your bio.");
  });
});
