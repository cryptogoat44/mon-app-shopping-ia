import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lot « messages vus » : le réglage « Confirmations de lecture » des
// Réglages. La logique sans rendu (lib/read-receipts.ts) : proposé ou non,
// valeur montrée tout de suite puis enregistrée, retour à l'ancienne valeur
// si le serveur refuse ; l'appel au serveur (`fetch` simulé) ; puis le
// composant et l'écran lus comme du texte, les textes FR / EN, et ce qu'en
// dit la politique de confidentialité.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.exemple.test";
});
vi.mock("../src/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jeton-factice" } } }) } } }));
vi.mock("../src/lib/analytics", () => ({ track: vi.fn(), setAnalyticsConsent: vi.fn() }));
vi.mock("../src/lib/image-file", () => ({ imageFileFromUri: vi.fn() }));

import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { updateReadReceipts } from "../src/lib/api";
import { ApiError } from "../src/lib/api-error";
import { changeReadReceipts, readReceiptsOffered, type ReadReceiptsSteps } from "../src/lib/read-receipts";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";

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

describe("politique de confidentialité", () => {
  const section = (doc: typeof privacyPolicy, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };

  it("les données : la date de la dernière lecture est gardée ; l'autre membre voit « Vu », sauf réglage éteint chez l'un des deux, jamais pour une invitation non acceptée", () => {
    const data = section(privacyPolicy, "Les données que nous utilisons");
    for (const sentence of [
      "La date de votre dernière lecture de chaque conversation est conservée avec la conversation.",
      "Quand vous ouvrez une conversation, l'autre membre peut ainsi voir que vous avez vu son dernier message (mention « Vu » ; son app ne reçoit pas l'heure de votre lecture, seulement le fait que ce message a été vu), sauf si l'un de vous deux a désactivé « Confirmations de lecture » dans les Réglages.",
      "Tant que vous n'avez pas accepté une invitation, la personne qui vous invite ne voit rien de tel.",
    ]) {
      expect(data).toContain(sentence);
    }
    // Jamais une lecture du passé : dit simplement, dans l'ordre, juste après la phrase du réglage.
    expect(data).toContain(
      "dans les Réglages. Seules vos lectures faites pendant que ce réglage est activé sont montrées. Si vous le désactivez, la mention « Vu » n'est plus affichée ; ce que vous lisez pendant qu'il est désactivé n'est jamais montré ensuite, même si vous le réactivez : seules vos lectures faites à partir de ce moment le sont. Il en va de même pour le réglage de l'autre membre : ce que vous lisez pendant que le sien est désactivé n'est pas montré non plus, même s'il le réactive. Ce que vous avez lu avant l'arrivée de cette mention dans Spotto n'est pas montré non plus. Pour appliquer cette règle, Spotto conserve la date à laquelle ce réglage a été activé pour la dernière fois. Tant que vous n'avez pas accepté une invitation,"
    );
    // Plus aucune phrase ne dit que l'app de l'autre membre reçoit la date de la lecture.
    expect(JSON.stringify(privacyPolicy)).not.toContain("reçoit cette date");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("receives that date");
    // Ce qui était déjà dit des messages reste dit.
    expect(data).toContain("l'état de vos conversations (invitation envoyée, acceptée ou refusée, messages lus)");
    expect(data).toContain("Seuls vous et la personne avec qui vous échangez les voyez.");
    expect(data).toContain("L'équipe de modération ne lit que les messages signalés, avec quelques messages autour pour comprendre le contexte.");
    expect(data).toContain("la conversation disparaît alors pour vous deux.");
    // Le point reste à relire par l'avocat, avec la mention activée par défaut.
    expect(data).toContain("[À vérifier : base légale retenue (exécution du contrat), durée de conservation, information de la personne qui reçoit une invitation, et mention « Vu » activée par défaut.]");
  });

  it("les mêmes faits en anglais", () => {
    const data = section(privacyPolicyEn, "The data we use");
    for (const sentence of [
      "The date you last read each conversation is kept with the conversation.",
      "When you open a conversation, the other member can therefore see that you have seen their last message (“Seen”; their app does not receive the time you read it, only the fact that this message has been seen), unless one of you has turned off “Read receipts” in Settings.",
      "As long as you have not accepted an invitation, the person inviting you sees nothing of the kind.",
    ]) {
      expect(data).toContain(sentence);
    }
    expect(data).toContain(
      "in Settings. Only what you read while this setting is on is shown. If you turn it off, “Seen” is no longer displayed; what you read while it is off is never shown later, even if you turn it back on: only what you read from that moment on is. The same goes for the other member's setting: what you read while theirs is off is not shown either, even if they turn it back on. What you read before “Seen” arrived in Spotto is not shown either. To apply this rule, Spotto keeps the date this setting was last turned on. As long as you have not accepted an invitation,"
    );
    expect(data).toContain("Only you and the person you are talking with can see them.");
    expect(data).toContain("[To be verified: legal basis retained (performance of the contract), retention period, information given to the person who receives an invitation, and the “Seen” mention being on by default.]");
  });

  it("« Qui peut voir quoi » et « Vos droits » : qui voit « Vu », où le couper, et jamais une lecture faite réglage désactivé", () => {
    expect(section(privacyPolicy, "Qui peut voir quoi dans Spotto")).toContain(
      "Vos messages privés : vous et la personne avec qui vous échangez. Elle peut aussi voir que vous avez vu son dernier message (mention « Vu »), sauf si l'un de vous deux a désactivé « Confirmations de lecture ». Seules vos lectures faites pendant que ce réglage est activé sont montrées."
    );
    expect(section(privacyPolicyEn, "Who can see what in Spotto")).toContain(
      "Your private messages: you and the person you are talking with. They can also see that you have seen their last message (“Seen”), unless one of you has turned off “Read receipts”. Only what you read while this setting is on is shown."
    );
    expect(section(privacyPolicy, "Vos droits")).toContain(
      "Ne plus montrer la mention « Vu » à la personne avec qui vous échangez (vous ne verrez plus la sienne non plus) : Réglages → Confirmations de lecture. Ce que vous lisez pendant que ce réglage est désactivé n'est jamais montré ensuite."
    );
    expect(section(privacyPolicyEn, "Your rights")).toContain(
      "Stop showing “Seen” to the person you are talking with (you will no longer see theirs either): Settings → Read receipts. What you read while this setting is off is never shown later."
    );
  });

  it("vouvoiement en français pour ces phrases, et les mêmes trois faits dans les deux langues", () => {
    const frData = section(privacyPolicy, "Les données que nous utilisons");
    const start = frData.indexOf("Seules vos lectures faites pendant");
    const added = frData.slice(start, frData.indexOf("Tant que vous n'avez pas accepté une invitation", start));
    expect(added.length).toBeGreaterThan(100);
    expect(added).not.toMatch(/\b(tu|toi|ton|ta|tes|t')\b/i);
    const enData = section(privacyPolicyEn, "The data we use");
    for (const [frWords, enWords] of [
      ["pendant que ce réglage est activé", "while this setting is on"],
      ["n'est plus affichée", "is no longer displayed"],
      ["n'est jamais montré ensuite, même si vous le réactivez", "is never shown later, even if you turn it back on"],
      // Réciproque dans le temps : une lecture faite pendant que le réglage de l'AUTRE est désactivé n'est pas montrée non plus.
      ["ce que vous lisez pendant que le sien est désactivé n'est pas montré non plus, même s'il le réactive", "what you read while theirs is off is not shown either, even if they turn it back on"],
      // L'heure de la lecture ne sort pas du serveur.
      ["son app ne reçoit pas l'heure de votre lecture, seulement le fait que ce message a été vu", "their app does not receive the time you read it, only the fact that this message has been seen"],
    ] as const) {
      expect(frData).toContain(frWords);
      expect(enData).toContain(enWords);
    }
  });

  it("la politique emploie les mots de l'app : le nom du réglage et la mention affichée", () => {
    const frText = JSON.stringify(privacyPolicy);
    const enText = JSON.stringify(privacyPolicyEn);
    expect(frText).toContain(`« ${fr.settings.readReceiptsTitle} »`);
    expect(frText).toContain(`Réglages → ${fr.settings.readReceiptsTitle}`);
    expect(frText).toContain(`mention « ${fr.messages.receiptSeen} »`);
    expect(enText).toContain(`“${en.settings.readReceiptsTitle}”`);
    expect(enText).toContain(`Settings → ${en.settings.readReceiptsTitle}`);
    expect(enText).toContain(`“${en.messages.receiptSeen}”`);
  });

  it("la version de la politique n'a pas changé (ni une nouvelle acceptation, ni un message : à dater par le fondateur)", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
  });
});
