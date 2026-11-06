import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveLocale, t } from "../src/i18n";
import { detectLink } from "../src/lib/link-detection";
import {
  canLeaveForSharedItem,
  classifySharedItem,
  isShareOpeningUrl,
  normalizeSharedLink,
  onSharedItemArrival,
  onSharedItemSignedOut,
  PENDING_SHARE_MAX_AGE_MS,
  peekSharedItem,
  pendingShareOpening,
  receiveSharedItem,
  sharedMessageDurationMs,
  sharedRefusalMessage,
  spotterTab,
  subscribeSharedItem,
  takeSharedItem,
  type NavigationStateLike,
  type SharedItem,
} from "../src/lib/shared-item";
import { redirectSystemPath } from "../src/app/+native-intent";

// Lot « partager vers Spotto » : ce que la feuille de partage d'iOS remet à
// Spotto (forme du module expo-share-intent), classé avant d'être ouvert.
const GROUP = "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/";

function file(name: string, mimeType: string | null, extra: Partial<Record<"width" | "height" | "size" | "duration", number>> = {}) {
  return { path: `${GROUP}${name}`, mimeType, fileName: name, width: null, height: null, size: null, duration: null, ...extra };
}

describe("classement de l'élément partagé", () => {
  it("lien partagé par TikTok, Instagram, Pinterest ou Safari : un lien", () => {
    expect(classifySharedItem({ files: null, webUrl: "https://vm.tiktok.com/ZMabc123/", text: "https://vm.tiktok.com/ZMabc123/" })).toEqual({
      kind: "link",
      text: "https://vm.tiktok.com/ZMabc123/",
    });
    expect(classifySharedItem({ files: null, webUrl: "https://www.zara.com/fr/veste-p1.html", text: null })).toEqual({ kind: "link", text: "https://www.zara.com/fr/veste-p1.html" });
  });

  it("phrase de partage avec un lien dedans : le lien seul", () => {
    expect(classifySharedItem({ files: null, webUrl: null, text: "Regarde cette vidéo ! https://vm.tiktok.com/ZMabc123/ #fyp" })).toEqual({
      kind: "link",
      text: "https://vm.tiktok.com/ZMabc123/",
    });
  });

  it("capture d'écran ou photo : une image, avec sa taille quand elle est connue", () => {
    expect(classifySharedItem({ files: [file("A1B2.PNG", "image/png", { width: 1179, height: 2556, size: 812_000 })] })).toEqual({
      kind: "image",
      uri: `${GROUP}A1B2.PNG`,
      width: 1179,
      height: 2556,
    });
    expect(classifySharedItem({ files: [file("IMG_0001.HEIC", "image/heic")] })).toEqual({ kind: "image", uri: `${GROUP}IMG_0001.HEIC`, width: null, height: null });
  });

  it("vidéo (enregistrement d'écran, vidéo de Photos) : une vidéo, avec son poids", () => {
    expect(classifySharedItem({ files: [file("C3D4.MOV", "video/quicktime", { size: 24_000_000, duration: 12_000, width: 886, height: 1920 })] })).toEqual({
      kind: "video",
      uri: `${GROUP}C3D4.MOV`,
      sizeBytes: 24_000_000,
    });
  });

  it("type absent ou générique : l'extension du nom tranche", () => {
    expect(classifySharedItem({ files: [file("E5.mp4", "application/octet-stream")] })).toMatchObject({ kind: "video" });
    expect(classifySharedItem({ files: [file("F6.jpeg", null)] })).toMatchObject({ kind: "image" });
  });

  it("chemin sans « file:// » complété ; adresse non locale refusée", () => {
    expect(classifySharedItem({ files: [{ path: "/private/var/mobile/Containers/Shared/AppGroup/0D1E2F/G7.png", mimeType: "image/png" }] })).toMatchObject({
      kind: "image",
      uri: "file:///private/var/mobile/Containers/Shared/AppGroup/0D1E2F/G7.png",
    });
    expect(classifySharedItem({ files: [{ path: "ph://ED7AC36B/L0/001", mimeType: "image/jpeg" }] })).toEqual({ kind: "refused", reason: "unreadable" });
  });

  it("fichier quelconque, texte sans lien : non pris en charge", () => {
    expect(classifySharedItem({ files: [file("contrat.pdf", "application/pdf")] })).toEqual({ kind: "refused", reason: "unsupported" });
    expect(classifySharedItem({ files: null, webUrl: null, text: "veste en daim marron" })).toEqual({ kind: "refused", reason: "unsupported" });
  });

  it("plusieurs éléments à la fois : refusés, un seul s'ouvre", () => {
    expect(classifySharedItem({ files: [file("A.PNG", "image/png"), file("B.MOV", "video/quicktime")] })).toEqual({ kind: "refused", reason: "several" });
  });

  it("partage vide ou illisible : on le dit", () => {
    expect(classifySharedItem(null)).toEqual({ kind: "refused", reason: "unreadable" });
    expect(classifySharedItem({ files: [], webUrl: null, text: "  " })).toEqual({ kind: "refused", reason: "unreadable" });
    expect(classifySharedItem({ files: [{ path: "", mimeType: "image/png" }] })).toEqual({ kind: "refused", reason: "unreadable" });
  });
});

describe("normalisation du lien partagé", () => {
  it.each([
    ["  https://vm.tiktok.com/ZMabc123/  ", "https://vm.tiktok.com/ZMabc123/"],
    ["Regarde ce reel ! https://www.instagram.com/reel/Cxyz/?igsh=abc.", "https://www.instagram.com/reel/Cxyz/?igsh=abc"],
    ["pin.it/4xYz", "https://pin.it/4xYz"],
    ["http://www.pinterest.fr/pin/123/", "http://www.pinterest.fr/pin/123/"],
  ])("« %s » → %s", (text, url) => {
    expect(normalizeSharedLink(text)).toBe(url);
  });

  it.each([[""], ["veste marron"], ["javascript:alert(1)"], ["file:///var/mobile/x.png"], [`https://exemple.fr/${"a".repeat(2100)}`]])("« %s » : aucun lien", (text) => {
    expect(normalizeSharedLink(text)).toBeNull();
  });

  it("texte partagé : son lien lu comme dans le champ, pas celui que le module en tire (coupé à une virgule ou un accent)", () => {
    // Forme rendue par le module pour un texte : webUrl tiré du texte par sa propre lecture.
    expect(
      classifySharedItem({ webUrl: "https://www.zara.com/fr/fr/veste-p01234567.html?v1=123", text: "Regarde https://www.zara.com/fr/fr/veste-p01234567.html?v1=123,456" })
    ).toEqual({ kind: "link", text: "https://www.zara.com/fr/fr/veste-p01234567.html?v1=123,456" });
    expect(classifySharedItem({ webUrl: "https://boutique.fr/produits/robe-", text: "https://boutique.fr/produits/robe-été-123" })).toEqual({
      kind: "link",
      text: "https://boutique.fr/produits/robe-été-123",
    });
    // Texte sans lien lisible : le lien transmis à part sert de repli.
    expect(classifySharedItem({ webUrl: "https://pin.it/1", text: "épingle" })).toEqual({ kind: "link", text: "https://pin.it/1" });
  });

  it("même lecture que le champ de lien : même lien, même plateforme", () => {
    for (const text of ["Regarde ! https://vm.tiktok.com/ZMabc123/ #fyp", "https://www.instagram.com/reel/abc/", "pin.it/4xYz", "https://www.tiktok.com/@mayela"]) {
      expect(detectLink(normalizeSharedLink(text)!)).toEqual(detectLink(text));
    }
  });
});

describe("mise en attente jusqu'à la connexion", () => {
  beforeEach(() => {
    takeSharedItem();
  });

  it("pas connecté : l'élément attend, intact ; connecté : le Spotter le prend une seule fois", () => {
    const item: SharedItem = { kind: "link", text: "https://vm.tiktok.com/ZMabc123/" };
    receiveSharedItem(item);
    // Aucun écran du Spotter n'existe avant la connexion : rien ne le prend.
    expect(peekSharedItem()).toEqual(item);
    expect(peekSharedItem()).toEqual(item);
    expect(takeSharedItem()).toEqual(item);
    expect(takeSharedItem()).toBeNull();
    expect(peekSharedItem()).toBeNull();
  });

  it("un nouveau partage remplace celui qui attendait, rendu pour effacer sa copie", () => {
    const video: SharedItem = { kind: "video", uri: "file:///cache/A.MOV", sizeBytes: 1_000 };
    const image: SharedItem = { kind: "image", uri: "file:///cache/B.PNG", width: 10, height: 20 };
    expect(receiveSharedItem(video)).toBeNull();
    expect(receiveSharedItem(image)).toEqual(video);
    expect(takeSharedItem()).toEqual(image);
  });

  it("les écrans abonnés sont prévenus à l'arrivée et au retrait, plus après désabonnement", () => {
    const listener = vi.fn();
    const stop = subscribeSharedItem(listener);
    receiveSharedItem({ kind: "refused", reason: "several" });
    takeSharedItem();
    takeSharedItem();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    receiveSharedItem({ kind: "refused", reason: "several" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("élément non pris en charge : message clair, en français et en anglais", () => {
  it("un message différent par cas, jamais vide", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      const messages = (["several", "unsupported", "unreadable"] as const).map(sharedRefusalMessage);
      expect(new Set(messages).size).toBe(3);
      for (const message of messages) expect(message.length).toBeGreaterThan(20);
    }
    setActiveLocale("fr");
  });
});

describe("ouverture de l'app par l'extension de partage", () => {
  it("l'adresse de l'extension ne mène à aucun écran : démarrage à l'accueil, ou on reste où l'on est", () => {
    for (const fragment of ["media", "weburl", "text", "file"]) {
      const url = `spotto://dataUrl=spottoShareKey?nonce=4F1C#${fragment}`;
      expect(isShareOpeningUrl(url)).toBe(true);
      expect(redirectSystemPath({ path: url, initial: true })).toBe("/");
      expect(redirectSystemPath({ path: url, initial: false })).toBeNull();
    }
    for (const path of ["spotto:///", "spotto://nouveau-mot-de-passe", "https://mon-app-shopping-ia-web.onrender.com/spot"]) {
      expect(isShareOpeningUrl(path)).toBe(false);
      expect(redirectSystemPath({ path, initial: true })).toBe(path);
    }
  });

  it("adresse fabriquée à la main (sans type reconnu) : jamais lue comme un partage, le module natif planterait", () => {
    for (const path of [
      "spotto://dataUrl=spottoShareKey",
      "spotto://dataUrl=spottoShareKey?nonce=1",
      "spotto://dataUrl=spottoShareKey#",
      "spotto://dataUrl=spottoShareKey#https://exemple.fr",
      "spotto://dataUrl=spottoShareKeyX#weburl",
      "spotto://dataUrl=spottoShareKey?nonce=1#media#weburl",
    ]) {
      expect(isShareOpeningUrl(path)).toBe(false);
      // Elle suit le chemin de toute adresse : au pire, « page introuvable ».
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
    expect(isShareOpeningUrl("spotto://dataUrl=spottoShareKey#text")).toBe(true);
  });
});

// État de navigation tel qu'expo-router le tient : « __root », pile racine
// (zone connectée « (app) » et pages hors zone), pile de la zone (onglets,
// puis les écrans empilés), onglet affiché.
function navigation(stacked: string[], { tab = "index", above }: { tab?: string; above?: string } = {}): NavigationStateLike {
  const app = { name: "(app)", state: { index: stacked.length, routes: [{ name: "(tabs)", state: { index: 0, routes: [{ name: tab }] } }, ...stacked.map((name) => ({ name }))] } };
  const root = { index: above ? 1 : 0, routes: above ? [app, { name: above }] : [app] };
  return { index: 0, routes: [{ name: "__root", state: root }] };
}

describe("partage reçu pendant qu'un autre écran est affiché (personne connectée)", () => {
  // Écrans de la zone connectée, d'après les fichiers de src/app/(app).
  const APP_DIR = new URL("../src/app/(app)/", import.meta.url);
  const SPOT_SCREENS = ["spot/lancer", "spot/analysis", "spot/result", "spot/ciblage", "spot/apercu", "spot/video"];

  beforeEach(() => {
    takeSharedItem();
  });

  it("onglets et pages de simple lecture : on peut revenir au Spotter", () => {
    for (const tab of ["index", "feed/index", "activite", "profile/index"]) expect(canLeaveForSharedItem(navigation([], { tab }))).toBe(true);
    for (const page of ["recentes", "pieces-recues", "profil", "envie", "blocked-users"]) expect(canLeaveForSharedItem(navigation([page]))).toBe(true);
    expect(canLeaveForSharedItem(navigation(["envie", "profil"]))).toBe(true);
  });

  it("tout le parcours du Spotter retient le partage : une recherche peut-être payée ne se coupe jamais", () => {
    for (const screen of SPOT_SCREENS) {
      expect(existsSync(new URL(`${screen}.tsx`, APP_DIR)), screen).toBe(true);
      expect(canLeaveForSharedItem(navigation([screen])), screen).toBe(false);
      // Ouvert depuis « Tout voir » : même chose.
      expect(canLeaveForSharedItem(navigation(["recentes", screen])), screen).toBe(false);
    }
  });

  it("formulaires et écrans où l'on écrit ou agit : le partage attend", () => {
    for (const screen of ["post-item/new", "vault-item/new", "edit-profile", "envoyer-envie", "people-search", "publication", "vault-item/[id]", "settings", "moderation"]) {
      expect(existsSync(new URL(`${screen}.tsx`, APP_DIR)), screen).toBe(true);
      expect(canLeaveForSharedItem(navigation([screen])), screen).toBe(false);
    }
  });

  it("le retour au Spotter refermerait aussi les écrans d'en dessous : chacun doit pouvoir partir", () => {
    // Profil d'une personne ouvert depuis une publication (commentaire en cours) ou depuis la recherche de personnes.
    expect(canLeaveForSharedItem(navigation(["publication", "profil"]))).toBe(false);
    expect(canLeaveForSharedItem(navigation(["people-search", "profil"]))).toBe(false);
    expect(canLeaveForSharedItem(navigation(["settings", "blocked-users"]))).toBe(false);
  });

  it("page hors de la zone connectée (Conditions, Confidentialité, nouveau mot de passe) : le partage attend, sans second Spotter", () => {
    for (const above of ["conditions", "confidentialite", "nouveau-mot-de-passe"]) {
      expect(canLeaveForSharedItem(navigation([], { above })), above).toBe(false);
      expect(canLeaveForSharedItem(navigation(["spot/lancer"], { above })), above).toBe(false);
    }
  });

  it("écran inconnu (ajouté plus tard) ou état illisible : le partage attend", () => {
    expect(canLeaveForSharedItem(navigation(["nouvel-ecran"]))).toBe(false);
    expect(canLeaveForSharedItem(null)).toBe(false);
    expect(canLeaveForSharedItem(undefined)).toBe(false);
    expect(canLeaveForSharedItem({ routes: [] })).toBe(false);
    expect(canLeaveForSharedItem({ index: 0, routes: [{ name: "__root" }] })).toBe(false);
    expect(canLeaveForSharedItem({ index: 0, routes: [{ name: "__root", state: { routes: [{ name: "(app)" }] } }] })).toBe(false);
  });

  it("la liste blanche ne nomme que des écrans qui existent", () => {
    expect(existsSync(new URL("(tabs)/_layout.tsx", APP_DIR))).toBe(true);
    for (const page of ["recentes", "pieces-recues", "profil", "envie", "blocked-users"]) expect(existsSync(new URL(`${page}.tsx`, APP_DIR)), page).toBe(true);
  });

  it("rien à perdre : retour au Spotter, qui ouvrira l'élément ; aucun message", () => {
    const item: SharedItem = { kind: "link", text: "https://vm.tiktok.com/ZMabc123/" };
    receiveSharedItem(item);
    const actions = { backToSpotter: vi.fn(), say: vi.fn() };
    onSharedItemArrival(navigation(["recentes"]), actions);
    expect(actions.backToSpotter).toHaveBeenCalledTimes(1);
    expect(actions.say).not.toHaveBeenCalled();
    expect(peekSharedItem()).toEqual(item);
  });

  it("recherche en cours : on reste, l'élément attend le Spotter, on le dit", () => {
    const item: SharedItem = { kind: "image", uri: "file:///cache/partages/A.PNG", width: 10, height: 20 };
    receiveSharedItem(item);
    const actions = { backToSpotter: vi.fn(), say: vi.fn() };
    onSharedItemArrival(navigation(["spot/analysis"]), actions);
    expect(actions.backToSpotter).not.toHaveBeenCalled();
    expect(actions.say).toHaveBeenCalledWith(t.share.waiting);
    expect(peekSharedItem()).toEqual(item);
  });

  it("partage refusé pendant une recherche ou une saisie : il attend le Spotter, qui l'affiche en message fixe ; seule l'attente est dite", () => {
    for (const screen of ["spot/lancer", "post-item/new", "settings"]) {
      const refused: SharedItem = { kind: "refused", reason: "several" };
      receiveSharedItem(refused);
      const actions = { backToSpotter: vi.fn(), say: vi.fn() };
      onSharedItemArrival(navigation([screen]), actions);
      expect(actions.backToSpotter, screen).not.toHaveBeenCalled();
      // Le refus ne passe plus en message flottant (2,2 s, sous une feuille ou le clavier) : il n'est pas pris.
      expect(actions.say.mock.calls, screen).toEqual([[t.share.waiting]]);
      expect(peekSharedItem(), screen).toEqual(refused);
    }
  });

  it("un message par arrivée, jamais en boucle ; rien n'est relancé quand le Spotter prend l'élément", () => {
    const actions = { backToSpotter: vi.fn(), say: vi.fn() };
    let shown = navigation(["spot/result"]);
    const stop = subscribeSharedItem(() => onSharedItemArrival(shown, actions));
    receiveSharedItem({ kind: "video", uri: "file:///cache/partages/B.MOV", sizeBytes: 1_000 });
    receiveSharedItem({ kind: "refused", reason: "unsupported" });
    expect(actions.say.mock.calls).toEqual([[t.share.waiting], [t.share.waiting]]);
    receiveSharedItem({ kind: "link", text: "https://pin.it/1" });
    // « Fermer » : retour au Spotter, qui prend l'élément ; aucun nouveau message, aucun retour forcé.
    shown = navigation([]);
    takeSharedItem();
    expect(actions.say).toHaveBeenCalledTimes(3);
    expect(actions.backToSpotter).not.toHaveBeenCalled();
    stop();
  });

  it("nouvelle publication ouverte depuis le Fil : rien ne s'ouvre seul après « Publier » ; l'élément attend le Spotter, marqué d'une pastille", () => {
    const actions = { backToSpotter: vi.fn(), say: vi.fn() };
    let shown = navigation(["post-item/new"], { tab: "feed/index" });
    const stop = subscribeSharedItem(() => onSharedItemArrival(shown, actions));
    const video: SharedItem = { kind: "video", uri: "file:///cache/partages/A.MOV", sizeBytes: 9_000_000 };
    receiveSharedItem(video);
    expect(actions.say.mock.calls).toEqual([[t.share.waiting]]);
    // « Publier » ramène au Fil : aucun écran ne se ferme seul, aucun nouveau message.
    shown = navigation([], { tab: "feed/index" });
    expect(actions.backToSpotter).not.toHaveBeenCalled();
    expect(actions.say).toHaveBeenCalledTimes(1);
    expect(peekSharedItem()).toEqual(video);
    expect(spotterTab(peekSharedItem()).badge).toBe("");
    stop();
  });

  it("onglet Spotter : une pastille tant qu'un partage attend (même refusé), dite par VoiceOver ; rien sinon", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      expect(spotterTab(null)).toEqual({ badge: undefined, accessibilityLabel: t.spotter.title });
      for (const item of [{ kind: "link", text: "https://pin.it/1" }, { kind: "refused", reason: "unsupported" }] as SharedItem[]) {
        const tab = spotterTab(item);
        expect(tab.badge).toBe("");
        expect(tab.accessibilityLabel.startsWith(`${t.spotter.title}, `)).toBe(true);
        expect(tab.accessibilityLabel.length).toBeGreaterThan(t.spotter.title.length + 10);
      }
    }
    setActiveLocale("fr");
    expect(spotterTab({ kind: "link", text: "https://pin.it/1" }).accessibilityLabel).toBe("Spotter, un partage vous attend");
  });

  it("textes en français et en anglais : l'attente est dite sans rien promettre d'autre", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      expect(t.share.waiting.length).toBeGreaterThan(20);
      // « dès que vous aurez fini ici » était faux : rien ne s'ouvre quand on a fini.
      expect(t.share.waiting).not.toMatch(/fini|done|dès que|once/i);
      // « dans Spotter », sans article, comme les autres textes.
      expect(t.share.waiting).not.toMatch(/le Spotter|the Spotter/);
    }
    setActiveLocale("fr");
    expect(t.share.waiting).toBe("Votre partage vous attend dans Spotter.");
    setActiveLocale("en");
    expect(t.share.waiting).toBe("What you shared is waiting for you in Spotter.");
    setActiveLocale("fr");
  });

  it("messages du partage affichés le temps de les lire : au moins 4 s, moins de 3 mots par seconde", () => {
    for (const locale of ["fr", "en"] as const) {
      setActiveLocale(locale);
      for (const message of [t.share.waiting, t.share.signInFirst, ...(["several", "unsupported", "unreadable"] as const).map(sharedRefusalMessage)]) {
        const words = message.split(/\s+/).filter(Boolean).length;
        const duration = sharedMessageDurationMs(message);
        expect(duration, message).toBeGreaterThanOrEqual(4000);
        expect(words / (duration / 1000), message).toBeLessThan(3);
      }
    }
    setActiveLocale("fr");
    // Le plus long (22 mots) : plus de 9 s, contre 2,2 s pour une confirmation ordinaire.
    expect(sharedMessageDurationMs(sharedRefusalMessage("unsupported"))).toBeGreaterThan(9000);
  });
});

describe("partage reçu sans être connecté (accueil)", () => {
  beforeEach(() => {
    takeSharedItem();
  });

  it("élément ouvrable : il s'ouvrira après la connexion, on le dit ; il reste en attente", () => {
    const say = vi.fn();
    receiveSharedItem({ kind: "link", text: "https://vm.tiktok.com/ZMabc123/" });
    onSharedItemSignedOut(say);
    expect(say).toHaveBeenCalledWith(t.share.signInFirst);
    expect(peekSharedItem()).not.toBeNull();
  });

  it("élément refusé : son message tout de suite, plutôt qu'après la connexion", () => {
    const say = vi.fn();
    receiveSharedItem({ kind: "refused", reason: "several" });
    onSharedItemSignedOut(say);
    expect(say).toHaveBeenCalledWith(sharedRefusalMessage("several"));
    expect(peekSharedItem()).toBeNull();
  });

  it("rien en attente : rien à dire", () => {
    const say = vi.fn();
    onSharedItemSignedOut(say);
    expect(say).not.toHaveBeenCalled();
  });
});

describe("repli : partage resté en attente (lot « app iPhone prête »)", () => {
  const NOW = Date.UTC(2026, 10, 6, 12);
  const url = "spotto://dataUrl=spottoShareKey?nonce=A1#media";

  it("seule une adresse d'ouverture exacte, de moins de 24 heures, est relue", () => {
    expect(pendingShareOpening(`${url}\n`, NOW - 60_000, NOW)).toBe(url);
    expect(pendingShareOpening(url, null, NOW)).toBe(url);
    expect(pendingShareOpening(url, NOW - PENDING_SHARE_MAX_AGE_MS - 1, NOW)).toBeNull();
    expect(pendingShareOpening("spotto://dataUrl=spottoShareKey?nonce=A1#inconnu", NOW, NOW)).toBeNull();
    expect(pendingShareOpening("spotto://nouveau-mot-de-passe", NOW, NOW)).toBeNull();
    expect(pendingShareOpening("", NOW, NOW)).toBeNull();
  });
});
