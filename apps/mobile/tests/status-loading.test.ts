import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Disponibilités demandées quel que soit l'écran ouvert en premier.
// Constaté sur le site : le profil d'un membre ouvert DIRECTEMENT par son
// adresse (/profil?id=…) ou rechargé dans le navigateur ne montrait ni
// « Message » ni la section « Collections », alors que la messagerie et les
// collections étaient disponibles : seule la barre d'onglets posait la question
// au serveur, et elle n'est pas affichée sur ces écrans. Désormais la mise en
// page commune aux écrans connectés s'en assure (lib/status-loading.ts).
// Logique et appels du serveur, sans rendu ; `fetch` est simulé.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { createStatusLoader } from "../src/lib/status-loading";

const SRC = join(__dirname, "../src");
const source = (path: string) => readFileSync(join(SRC, path), "utf8");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const LOUISE = "compte-louise";
const CAMILLE = "compte-camille";

describe("s'assurer que les disponibilités sont demandées (logique)", () => {
  /** Trois demandes factices, comptées ; `echec` : sans réponse (hors ligne). */
  function fausses() {
    const comptes = { messages: 0, collections: 0, alerts: 0 };
    const echec = { messages: false, collections: false, alerts: false };
    const demande = (kind: keyof typeof comptes) => async () => {
      comptes[kind] += 1;
      if (echec[kind]) throw new TypeError("Network request failed");
      return kind;
    };
    const loader = createStatusLoader({ messages: demande("messages"), collections: demande("collections"), alerts: demande("alerts") });
    return { comptes, echec, loader };
  }

  it("rien de connu : chaque disponibilité est demandée exactement une fois", async () => {
    const { comptes, loader } = fausses();
    await loader.ensure(LOUISE);
    expect(comptes).toEqual({ messages: 1, collections: 1, alerts: 1 });
  });

  it("un deuxième écran ne redemande rien ; deux appels en même temps : une seule demande", async () => {
    const { comptes, loader } = fausses();
    await Promise.all([loader.ensure(LOUISE), loader.ensure(LOUISE), loader.ensure(LOUISE)]);
    expect(comptes).toEqual({ messages: 1, collections: 1, alerts: 1 });
    await loader.ensure(LOUISE);
    await loader.ensure(LOUISE);
    expect(comptes).toEqual({ messages: 1, collections: 1, alerts: 1 });
  });

  it("déconnecté : rien n'est demandé", async () => {
    const { comptes, loader } = fausses();
    await loader.ensure(null);
    await loader.ensure(undefined);
    await loader.ensure("");
    expect(comptes).toEqual({ messages: 0, collections: 0, alerts: 0 });
  });

  it("une demande déjà en route (barre d'onglets) ou déjà répondue n'est pas doublée", async () => {
    const { comptes, loader } = fausses();
    // En route : la barre d'onglets vient de demander la messagerie.
    const enRoute = loader.request("messages");
    await loader.ensure(LOUISE);
    expect(await enRoute).toBe("messages");
    expect(comptes).toEqual({ messages: 1, collections: 1, alerts: 1 });
    // Répondue par une relecture : toujours rien à redemander.
    await loader.request("collections");
    await loader.ensure(LOUISE);
    expect(comptes).toEqual({ messages: 1, collections: 2, alerts: 1 });
  });

  it("les relectures (barre d'onglets, message lu…) partent toujours, même une fois la réponse connue", async () => {
    const { comptes, loader } = fausses();
    await loader.ensure(LOUISE);
    await loader.request("messages");
    await Promise.all([loader.request("messages"), loader.request("messages")]);
    expect(comptes).toEqual({ messages: 4, collections: 1, alerts: 1 });
  });

  it("hors ligne : seul ce qui n'a pas eu de réponse est redemandé au prochain appel", async () => {
    const { comptes, echec, loader } = fausses();
    echec.collections = true;
    await expect(loader.ensure(LOUISE)).resolves.toBeUndefined();
    expect(comptes).toEqual({ messages: 1, collections: 1, alerts: 1 });
    echec.collections = false;
    await loader.ensure(LOUISE);
    expect(comptes).toEqual({ messages: 1, collections: 2, alerts: 1 });
    await loader.ensure(LOUISE);
    expect(comptes).toEqual({ messages: 1, collections: 2, alerts: 1 });
  });

  it("un autre compte sur le même appareil : tout est redemandé pour lui, une fois", async () => {
    const { comptes, loader } = fausses();
    await loader.ensure(LOUISE);
    await loader.ensure(CAMILLE);
    await loader.ensure(CAMILLE);
    expect(comptes).toEqual({ messages: 2, collections: 2, alerts: 2 });
  });
});

describe("écran ouvert directement par son adresse, ou rechargé (appels du serveur)", () => {
  const DISPONIBLE: Record<string, unknown> = {
    "/api/messages/status": { enabled: true, unreadCount: 2, push: false },
    "/api/collections/status": { enabled: true, reportable: true },
    "/api/alerts/status": { available: true, enabled: false, push: false },
  };
  const INDISPONIBLE: Record<string, unknown> = {
    "/api/messages/status": { enabled: false, unreadCount: 0 },
    "/api/collections/status": { enabled: false },
    "/api/alerts/status": { available: false },
  };

  /** Serveur simulé : note chaque adresse demandée ; `porte` : la réponse attend qu'on l'ouvre. */
  function serveur(reponses: Record<string, unknown>, porte: Promise<void> = Promise.resolve()) {
    const demandees: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      const chemin = url.replace("https://api.exemple.test", "");
      demandees.push(chemin);
      await porte;
      return new Response(JSON.stringify(reponses[chemin] ?? {}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return { demandees: () => [...demandees].sort() };
  }

  /** L'app telle qu'au chargement de la page : rien n'est encore connu. */
  async function app() {
    vi.resetModules();
    const api = await import("../src/lib/api");
    const { messagesStatus } = await import("../src/lib/conversations");
    const { collectionsStatus, friendSectionVisible } = await import("../src/lib/collections");
    const { wishAlertsStatus } = await import("../src/lib/wish-alerts");
    return {
      messagesStatus,
      collectionsStatus,
      wishAlertsStatus,
      friendSectionVisible,
      /** Mise en page commune aux écrans connectés, app/(app)/_layout.tsx : les alertes pour le jeton (use-push-notifications.ts), puis tout le reste. */
      miseEnPage: (userId: string | null) => {
        if (userId) api.fetchWishAlertsStatus().catch(() => {});
        return api.ensureStatuses(userId);
      },
      /** Barre d'onglets, app/(app)/(tabs)/_layout.tsx : relue à chaque changement d'écran. */
      barreOnglets: async () => {
        const lues: Promise<unknown>[] = [api.fetchMessagesStatus().catch(() => {})];
        if (!collectionsStatus().enabled) lues.push(api.fetchCollectionsStatus().catch(() => {}));
        await Promise.all(lues);
      },
      /** Résultats, app/(app)/spot/result.tsx : lisait déjà lui-même, à son ouverture. */
      resultats: async () => {
        const lues: Promise<unknown>[] = [];
        if (!messagesStatus().enabled) lues.push(api.fetchMessagesStatus().catch(() => {}));
        if (!wishAlertsStatus().available) lues.push(api.fetchWishAlertsStatus().catch(() => {}));
        await Promise.all(lues);
      },
    };
  }

  const TOUTES_UNE_FOIS = ["/api/alerts/status", "/api/collections/status", "/api/messages/status"];
  const UNE_COLLECTION = [{ id: "c1", name: "Week-end", itemCount: 2, coverUrls: [] }] as never;

  // Écrans (hors barre d'onglets) qui ne lisaient que l'état en mémoire, et ce qu'ils cachaient.
  const ECRANS = [
    { ecran: "app/(app)/profil.tsx", lit: ["const messages = useMessagesStatus();", "{messages.enabled ? (", "<FriendCollections "], cachait: "« Message » et la section « Collections »" },
    { ecran: "components/friend-collections.tsx", lit: ["const status = useCollectionsStatus();", "if (!status.enabled) {"], cachait: "la section « Collections » du profil" },
    { ecran: "app/(app)/collection-ami.tsx", lit: ["const messages = useMessagesStatus();", "const collections = useCollectionsStatus();", "canTalk={messages.enabled}"], cachait: "« En parler » et « Signaler cette collection »" },
    { ecran: "app/(app)/envie.tsx", lit: ["const messages = useMessagesStatus();", "const collections = useCollectionsStatus();", "{collections.enabled ? (", "{messages.enabled ? ("], cachait: "« Ajouter à une collection » et l'envoi dans une conversation" },
    { ecran: "app/(app)/settings.tsx", lit: ["<MessagesFromSetting />", "<MessagePushSetting />"], cachait: "« Qui peut m'écrire »" },
  ];

  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(ECRANS)("$ecran ouvert en premier ($cachait) : chaque disponibilité est demandée exactement une fois", async ({ ecran, lit }) => {
    // L'écran ne lit que l'état en mémoire, et ne demande rien lui-même…
    const texte = source(ecran);
    for (const lecture of lit) expect(texte).toContain(lecture);
    expect(texte).not.toMatch(/fetch(Messages|Collections)Status/);
    // … c'est la mise en page au-dessus de lui (et de la barre d'onglets) qui s'en assure.
    const { demandees } = serveur(DISPONIBLE);
    const { miseEnPage, messagesStatus, collectionsStatus, wishAlertsStatus, friendSectionVisible } = await app();
    await miseEnPage(LOUISE);
    expect(demandees()).toEqual(TOUTES_UNE_FOIS);
    expect(messagesStatus()).toEqual({ enabled: true, unreadCount: 2, push: false });
    expect(collectionsStatus()).toEqual({ enabled: true, reportable: true });
    expect(wishAlertsStatus().available).toBe(true);
    expect(friendSectionVisible(collectionsStatus(), UNE_COLLECTION)).toBe(true);
  });

  it("rien n'est montré avant la réponse du serveur", async () => {
    let ouvrir: () => void = () => {};
    const porte = new Promise<void>((resolve) => {
      ouvrir = resolve;
    });
    const { demandees } = serveur(DISPONIBLE, porte);
    const { miseEnPage, messagesStatus, collectionsStatus, friendSectionVisible } = await app();
    const pret = miseEnPage(LOUISE);
    await vi.waitFor(() => expect(demandees()).toEqual(TOUTES_UNE_FOIS));
    expect(messagesStatus().enabled).toBe(false);
    expect(friendSectionVisible(collectionsStatus(), UNE_COLLECTION)).toBe(false);
    ouvrir();
    await pret;
    expect(messagesStatus().enabled).toBe(true);
    expect(friendSectionVisible(collectionsStatus(), UNE_COLLECTION)).toBe(true);
    expect(demandees()).toEqual(TOUTES_UNE_FOIS);
  });

  it("le serveur dit « indisponible » : tout reste caché, et un deuxième écran ne redemande rien", async () => {
    const { demandees } = serveur(INDISPONIBLE);
    const { miseEnPage, messagesStatus, collectionsStatus, wishAlertsStatus, friendSectionVisible } = await app();
    await miseEnPage(LOUISE);
    expect(messagesStatus().enabled).toBe(false);
    expect(friendSectionVisible(collectionsStatus(), UNE_COLLECTION)).toBe(false);
    expect(wishAlertsStatus().available).toBe(false);
    const { ensureStatuses } = await import("../src/lib/api");
    await ensureStatuses(LOUISE);
    await ensureStatuses(LOUISE);
    expect(demandees()).toEqual(TOUTES_UNE_FOIS);
  });

  it("un deuxième écran (ou la même mise en page rejouée) ne redemande rien", async () => {
    const { demandees } = serveur(DISPONIBLE);
    await (await app()).miseEnPage(LOUISE);
    const { ensureStatuses } = await import("../src/lib/api");
    await Promise.all([ensureStatuses(LOUISE), ensureStatuses(LOUISE)]);
    await ensureStatuses(LOUISE);
    expect(demandees()).toEqual(TOUTES_UNE_FOIS);
  });

  it("déconnecté : aucune demande ne part", async () => {
    const { demandees } = serveur(DISPONIBLE);
    const { miseEnPage, messagesStatus } = await app();
    await miseEnPage(null);
    expect(demandees()).toEqual([]);
    expect(messagesStatus().enabled).toBe(false);
  });

  it("la barre d'onglets marche comme avant : ses lectures ne sont pas doublées, et elle relit toujours les messages non lus", async () => {
    const { demandees } = serveur(DISPONIBLE);
    const { miseEnPage, barreOnglets, messagesStatus, collectionsStatus } = await app();
    // Ouverture sur un onglet : la barre lit d'abord (effets des écrans avant
    // ceux de la mise en page), la mise en page n'ajoute rien à ce qui est en route.
    const onglets = barreOnglets();
    await miseEnPage(LOUISE);
    await onglets;
    expect(demandees()).toEqual(TOUTES_UNE_FOIS);
    expect(messagesStatus().enabled).toBe(true);
    expect(collectionsStatus().enabled).toBe(true);
    // Changement d'écran : les messages non lus sont relus, les collections (connues) non.
    await barreOnglets();
    expect(demandees()).toEqual([...TOUTES_UNE_FOIS, "/api/messages/status"]);
    // Puis un profil ouvert depuis le fil : rien de plus.
    const { ensureStatuses } = await import("../src/lib/api");
    await ensureStatuses(LOUISE);
    expect(demandees()).toEqual([...TOUTES_UNE_FOIS, "/api/messages/status"]);
  });

  it("profil ouvert par son adresse, puis retour aux onglets : seule la relecture habituelle des messages part", async () => {
    const { demandees } = serveur(DISPONIBLE);
    const { miseEnPage, barreOnglets } = await app();
    await miseEnPage(LOUISE);
    await barreOnglets();
    expect(demandees()).toEqual([...TOUTES_UNE_FOIS, "/api/messages/status"]);
  });

  it("l'écran des résultats, qui lisait déjà lui-même, n'est pas doublé", async () => {
    const { demandees } = serveur(DISPONIBLE);
    const { miseEnPage, resultats } = await app();
    const ecran = resultats();
    await miseEnPage(LOUISE);
    await ecran;
    // Les alertes : une fois par l'écran, une fois pour le jeton — comme avant.
    expect(demandees()).toEqual(["/api/alerts/status", ...TOUTES_UNE_FOIS]);
  });
});

describe("branchement dans l'app", () => {
  it("la mise en page commune aux écrans connectés s'en assure, une fois par compte", () => {
    const layout = source("app/(app)/_layout.tsx");
    expect(layout).toContain('import { useStatusesLoaded } from "@/lib/use-statuses-loaded";');
    expect(layout).toContain("  useStatusesLoaded();");
    const hook = source("lib/use-statuses-loaded.ts");
    expect(hook).toContain("const userId = session?.user.id ?? null;");
    expect(hook).toMatch(/useEffect\(\(\) => \{\s*void ensureStatuses\(userId\);\s*\}, \[userId\]\);/);
    // Cette mise en page n'existe que connecté (profil complet).
    expect(source("app/_layout.tsx")).toMatch(/<Stack\.Protected guard=\{route === "app"\}>\s*<Stack\.Screen name="\(app\)" \/>\s*<\/Stack\.Protected>/);
  });

  it("chaque demande de disponibilité passe par le même suivi", () => {
    const api = source("lib/api.ts");
    expect(api).toContain("const statuses = createStatusLoader({ messages: loadMessagesStatus, collections: loadCollectionsStatus, alerts: loadWishAlertsStatus });");
    for (const kind of ["messages", "collections", "alerts"]) expect(api).toContain(`return statuses.request("${kind}");`);
    expect(api).toContain("return statuses.ensure(userId);");
    // Une seule lecture de chaque adresse dans tout le code de l'app.
    for (const chemin of ["/api/messages/status", "/api/collections/status", "/api/alerts/status"]) {
      expect(api.split(`authorizedFetch("${chemin}")`)).toHaveLength(2);
    }
  });

  it("tout écran qui lit une disponibilité est sous cette mise en page", () => {
    const lecteurs = files(join(SRC, "app"))
      .filter((path) => /use(Messages|Collections|WishAlerts)Status\(\)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).split("\\").join("/"));
    expect(lecteurs).toEqual(expect.arrayContaining(["app/(app)/profil.tsx", "app/(app)/collection-ami.tsx", "app/(app)/envie.tsx", "app/(app)/spot/result.tsx"]));
    for (const ecran of lecteurs) expect(ecran.startsWith("app/(app)/")).toBe(true);
  });

  it("la barre d'onglets garde ses propres lectures, inchangées", () => {
    const tabs = source("app/(app)/(tabs)/_layout.tsx");
    expect(tabs).toContain("fetchMessagesStatus().catch(() => {});");
    expect(tabs).toContain("if (!collectionsStatus().enabled) fetchCollectionsStatus().catch(() => {});");
    expect(tabs).toContain("}, [pathname]);");
  });
});
