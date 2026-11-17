import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lot « messages vus » : le réglage « Confirmations de lecture » des
// Réglages. La logique sans rendu (lib/read-receipts.ts) : proposé ou non,
// valeur montrée tout de suite puis enregistrée, retour à l'ancienne valeur
// si le serveur refuse ; l'appel au serveur (`fetch` simulé) ; puis le
// composant et l'écran lus comme du texte, et les textes FR / EN.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { updateReadReceipts } from "../src/lib/api";
import { ApiError } from "../src/lib/api-error";
import { changeReadReceipts, readReceiptsOffered, type ReadReceiptsSteps } from "../src/lib/read-receipts";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";

const read = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

/** L'interrupteur, sans écran : ce qu'il montre, et ce qui s'est passé dans l'ordre. */
function toggle(initial: boolean, save: ReadReceiptsSteps["save"]) {
  const state = { value: initial, error: false };
  const journal: string[] = [];
  const steps: ReadReceiptsSteps = {
    show: (value) => {
      state.value = value;
      journal.push(`montre ${value ? "oui" : "non"}`);
    },
    failed: (value) => {
      state.error = value;
      journal.push(value ? "message d'échec" : "sans message");
    },
    save: async (value) => {
      journal.push(`enregistre ${value ? "oui" : "non"}`);
      await save(value);
    },
    refresh: async () => {
      journal.push("relit le profil");
    },
  };
  return { state, journal, change: (next: boolean) => changeReadReceipts(next, state.value, steps) };
}

describe("proposé ou non", () => {
  it("seulement avec la messagerie, et quand le serveur renvoie le réglage dans le profil", () => {
    expect(readReceiptsOffered(true, { readReceipts: true })).toBe(true);
    expect(readReceiptsOffered(true, { readReceipts: false })).toBe(true);
    // Serveur sans les confirmations de lecture (migration absente), ou plus ancien : le profil n'a pas le réglage.
    expect(readReceiptsOffered(true, {})).toBe(false);
    expect(readReceiptsOffered(true, { readReceipts: undefined })).toBe(false);
    // Profil pas encore chargé, ou messagerie indisponible.
    expect(readReceiptsOffered(true, null)).toBe(false);
    expect(readReceiptsOffered(false, { readReceipts: true })).toBe(false);
  });
});

describe("changer le réglage", () => {
  it("la nouvelle valeur est montrée tout de suite, puis enregistrée, puis le profil est relu", async () => {
    const { state, journal, change } = toggle(true, async () => {});
    const saving = change(false);
    // Avant même la réponse du serveur.
    expect(state).toEqual({ value: false, error: false });
    expect(await saving).toBe(true);
    expect(journal).toEqual(["montre non", "sans message", "enregistre non", "relit le profil"]);
    expect(state).toEqual({ value: false, error: false });
  });

  it("le serveur refuse ou ne répond pas : l'ancienne valeur revient, avec un message ; le profil n'est pas relu", async () => {
    for (const failure of [new ApiError(500, { error: "internal_error", message: "Une erreur est survenue." }), new TypeError("Network request failed")]) {
      const { state, journal, change } = toggle(true, async () => {
        throw failure;
      });
      expect(await change(false)).toBe(false);
      expect(state).toEqual({ value: true, error: true });
      expect(journal).toEqual(["montre non", "sans message", "enregistre non", "montre oui", "message d'échec"]);
    }
  });

  it("un nouvel essai retire le message ; dans l'autre sens aussi (rallumer)", async () => {
    let online = false;
    const { state, change } = toggle(false, async () => {
      if (!online) throw new TypeError("Network request failed");
    });
    expect(await change(true)).toBe(false);
    expect(state).toEqual({ value: false, error: true });
    online = true;
    expect(await change(true)).toBe(true);
    expect(state).toEqual({ value: true, error: false });
  });
});

describe("appel au serveur", () => {
  function server(status: number, body: unknown = null) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(body === null ? null : JSON.stringify(body), { status });
      })
    );
    return calls;
  }

  it("PUT /api/me/read-receipts, avec un vrai oui ou non", async () => {
    const calls = server(204);
    await updateReadReceipts(false);
    await updateReadReceipts(true);
    expect(calls.map((call) => [call.init.method, call.url, call.init.body])).toEqual([
      ["PUT", "https://api.exemple.test/api/me/read-receipts", '{"readReceipts":false}'],
      ["PUT", "https://api.exemple.test/api/me/read-receipts", '{"readReceipts":true}'],
    ]);
    expect(calls[0]!.init.headers).toMatchObject({ "Content-Type": "application/json", Authorization: "Bearer jeton-factice" });
  });

  it("le serveur ne propose pas (ou plus) le réglage : l'interrupteur revient à sa place, avec un message", async () => {
    server(404, { error: "read_receipts_unavailable", message: "Les confirmations de lecture ne sont pas encore disponibles." });
    await expect(updateReadReceipts(false)).rejects.toMatchObject({ status: 404 });
    const { state, change } = toggle(true, updateReadReceipts);
    expect(await change(false)).toBe(false);
    expect(state).toEqual({ value: true, error: true });
  });
});

describe("le composant et l'écran des Réglages (lus comme du texte)", () => {
  const setting = read("components/read-receipts-setting.tsx");

  it("caché tant que le réglage n'est pas proposé ; l'interrupteur suit le profil, allumé par défaut", () => {
    expect(setting).toContain("if (!readReceiptsOffered(enabled, profile)) return null;");
    expect(setting).toContain("const { enabled } = useMessagesStatus();");
    expect(setting).toContain("useState(profile?.readReceipts ?? true)");
    expect(setting).toContain('if (typeof profile?.readReceipts === "boolean") setValue(profile.readReceipts);');
  });

  it("l'interrupteur enregistre par changeReadReceipts, se grise pendant l'envoi, et dit à quoi il sert", () => {
    expect(setting).toContain("await changeReadReceipts(next, value, { show: setValue, failed: setError, save: updateReadReceipts, refresh: refreshProfile });");
    const control = /<Switch\s([\s\S]*?)\/>/.exec(setting);
    expect(control).not.toBeNull();
    const props = control![1]!;
    expect(props).toContain("accessibilityLabel={t.settings.readReceiptsSwitchLabel}");
    expect(props).toContain("value={value}");
    expect(props).toContain("disabled={saving}");
    expect(props).toContain("onValueChange={(next) => void choose(next)}");
    // Le titre, l'explication (toujours affichée) et, en cas d'échec, le message.
    expect(setting).toContain("{t.settings.readReceiptsTitle}");
    expect(setting).toContain("<Text style={styles.body}>{t.settings.readReceiptsHint}</Text>");
    expect(setting).toContain("{error ? <ErrorMessage style={styles.body}>{t.settings.readReceiptsError}</ErrorMessage> : null}");
    // Sur le site comme sur iPhone : aucune condition de plateforme.
    expect(setting).not.toContain("Platform.OS");
  });

  it("dans les Réglages, juste sous « Qui peut m'écrire »", () => {
    const settings = read("app/(app)/settings.tsx");
    const from = settings.indexOf("<MessagesFromSetting />");
    const receipts = settings.indexOf("<ReadReceiptsSetting />");
    expect(from).toBeGreaterThan(-1);
    expect(receipts).toBeGreaterThan(from);
    expect(settings.slice(from + "<MessagesFromSetting />".length, receipts)).not.toMatch(/<[A-Z]\w+ /);
    expect(settings.match(/<ReadReceiptsSetting \/>/g)).toHaveLength(1);
    // L'écran ne demande rien lui-même au serveur pour ce réglage.
    expect(settings).not.toContain("updateReadReceipts");
  });
});

describe("textes FR / EN", () => {
  it("le titre, et l'explication : réciproque", () => {
    expect(fr.settings.readReceiptsTitle).toBe("Confirmations de lecture");
    expect(en.settings.readReceiptsTitle).toBe("Read receipts");
    expect(fr.settings.readReceiptsHint).toBe(
      "Dans une conversation, « Vu » s'affiche sous le dernier message envoyé quand l'autre membre l'a lu. Si vous désactivez ce réglage, l'autre membre ne voit plus « Vu » pour vos lectures, et vous ne voyez plus les siennes."
    );
    expect(en.settings.readReceiptsHint).toBe(
      "In a conversation, “Seen” appears under the last message sent once the other member has read it. If you turn this off, the other member no longer sees “Seen” for your reads, and you no longer see theirs."
    );
    // Le mot de l'explication est celui affiché dans la conversation.
    expect(fr.settings.readReceiptsHint).toContain(`« ${fr.messages.receiptSeen} »`);
    expect(en.settings.readReceiptsHint).toContain(`“${en.messages.receiptSeen}”`);
  });

  it("ce que lit VoiceOver sur l'interrupteur, et le message d'échec", () => {
    expect(fr.settings.readReceiptsSwitchLabel).toBe("Montrer quand j'ai lu un message, et voir quand les miens sont lus");
    expect(en.settings.readReceiptsSwitchLabel).toBe("Show when I've read a message, and see when mine are read");
    expect(fr.settings.readReceiptsError).toBe("Ce réglage n'a pas pu être enregistré. Réessayez.");
    expect(en.settings.readReceiptsError).toBe("This setting couldn't be saved. Please try again.");
  });

  it("vouvoiement en français", () => {
    for (const text of [fr.settings.readReceiptsTitle, fr.settings.readReceiptsSwitchLabel, fr.settings.readReceiptsHint, fr.settings.readReceiptsError]) {
      expect(text).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
    }
  });
});
