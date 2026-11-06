import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { consentFor, parseLegalVersion, pendingConsents, splitPlaceholders } from "../src/lib/legal";
import { termsOfUse } from "../src/legal/conditions";
import { privacyPolicy } from "../src/legal/confidentialite";
import { privacyPolicyEn } from "../src/legal/confidentialite.en";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { PUBLISHER, readPublisher } from "../src/legal/publisher";

describe("documents juridiques", () => {
  it("lit la version d'un projet", () => {
    expect(parseLegalVersion("projet-2026-09-25")).toEqual({ isDraft: true, day: "2026-09-25" });
    expect(parseLegalVersion("2027-01-10")).toEqual({ isDraft: false, day: "2027-01-10" });
  });

  it("isole les champs à compléter, à décider ou à vérifier", () => {
    expect(splitPlaceholders("Édité par [À compléter : nom]. Âge : [À décider : 15 ans].")).toEqual([
      { text: "Édité par ", placeholder: false },
      { text: "[À compléter : nom]", placeholder: true },
      { text: ". Âge : ", placeholder: false },
      { text: "[À décider : 15 ans]", placeholder: true },
      { text: ".", placeholder: false },
    ]);
    expect(splitPlaceholders("Aucun champ.")).toEqual([{ text: "Aucun champ.", placeholder: false }]);
  });

  it("retrouve le statut d'un document", () => {
    const statuses = [{ type: "terms" as const, grantedAt: "2026-09-25T10:00:00Z", decidedAt: "2026-09-25T10:00:00Z", version: "v", isCurrent: false }];
    expect(consentFor(statuses, "terms")?.version).toBe("v");
    expect(consentFor(statuses, "privacy_policy")).toBeNull();
  });

  it("les conditions se confirment avec la déclaration d'âge", () => {
    const status = (type: "terms" | "privacy_policy" | "age_declaration", isCurrent: boolean) => ({
      type,
      grantedAt: "2026-09-25T10:00:00Z",
      decidedAt: "2026-09-25T10:00:00Z",
      version: "v",
      isCurrent,
    });
    expect(pendingConsents([], "terms")).toEqual(["terms", "age_declaration"]);
    expect(pendingConsents([status("terms", true)], "terms")).toEqual(["age_declaration"]);
    expect(pendingConsents([status("terms", true), status("age_declaration", true)], "terms")).toEqual([]);
    expect(pendingConsents([status("terms", false), status("age_declaration", true)], "terms")).toEqual(["terms"]);
    // La politique de confidentialité ne demande pas l'âge.
    expect(pendingConsents([], "privacy_policy")).toEqual(["privacy_policy"]);
  });

  it("les deux documents sont des projets, datés, et correspondent aux versions en vigueur", () => {
    for (const doc of [termsOfUse, privacyPolicy]) {
      const version = parseLegalVersion(LEGAL_DOCUMENT_VERSIONS[doc.type]);
      expect(version.isDraft).toBe(true);
      expect(version.day).not.toBeNull();
      expect(doc.sections.length).toBeGreaterThan(5);
    }
  });

  it("identité de l'éditeur : « À compléter » si une variable manque ou est vide, jamais d'erreur", () => {
    expect(readPublisher({})).toEqual({
      name: "[À compléter : nom de l'éditeur]",
      status: "[À compléter : statut de l'éditeur]",
      address: "[À compléter : adresse postale]",
      email: "[À compléter : adresse e-mail de contact]",
      phone: "[À compléter : numéro de téléphone]",
    });
    const filled = readPublisher({ name: " Nom Exemple ", address: "   ", email: "contact@example.com" });
    expect(filled.name).toBe("Nom Exemple");
    expect(filled.address).toBe("[À compléter : adresse postale]");
    expect(filled.email).toBe("contact@example.com");
    // Mis en évidence à l'écran comme les autres champs à compléter.
    expect(splitPlaceholders(`Adresse : ${readPublisher({}).address}.`)[1]).toEqual({ text: "[À compléter : adresse postale]", placeholder: true });
  });

  it("aucune coordonnée personnelle dans le code des documents (dépôt public)", () => {
    const dir = join(__dirname, "../src/legal");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(source, file).not.toMatch(/\b0[1-9](?:[ .]?\d{2}){4}\b/);
    }
  });

  it("reprend l'identité de l'éditeur d'une seule source, et vouvoie partout", () => {
    for (const doc of [termsOfUse, privacyPolicy]) {
      const text = doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");
      expect(text).toContain(PUBLISHER.name);
      expect(text).toContain(PUBLISHER.email);
      expect(text).toContain(PUBLISHER.address);
      expect(text).not.toMatch(/SIRET\s*:?\s*\d/);
      // Limites de mot tenant compte des lettres accentuées (« incomplètes »).
      expect(text).not.toMatch(/(?<!\p{L})(tu|ton|ta|tes|toi|te)(?!\p{L})/iu);
    }
  });
});

// Lot politique exacte (2026-11-05) : la politique décrit la voie C
// interrupteurs allumés, avec les textes « Proposé » du document pour l'avocat
// (variante B pour SerpApi). Elle reste un projet, avec ses « [À vérifier] ».
describe("politique de confidentialité exacte pour la voie C", () => {
  const all = (doc: typeof privacyPolicy) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");
  const section = (doc: typeof privacyPolicy, index: number) => doc.sections[index]!.blocks.flat().join("\n");
  const frText = all(privacyPolicy);
  const enText = all(privacyPolicyEn);

  it("reste un projet daté, avec ses mentions à vérifier, en français comme en anglais", () => {
    expect(parseLegalVersion(LEGAL_DOCUMENT_VERSIONS.privacy_policy)).toEqual({ isDraft: true, day: "2026-11-05" });
    expect(frText.match(/\[À vérifier/g)!.length).toBeGreaterThanOrEqual(10);
    expect(enText.match(/\[To be verified/g)!.length).toBe(frText.match(/\[À vérifier/g)!.length);
    expect(frText).toContain("[À vérifier : exécution du contrat ou intérêt légitime.]");
    expect(enText).toContain("[To be verified: performance of the contract or legitimate interest.]");
    expect(frText).toContain("[À vérifier : durée de conservation des textes de recherche]");
    expect(enText).toContain("[To be verified: retention period of search texts]");
  });

  it("les trois promesses devenues fausses ont disparu", () => {
    expect(frText).not.toContain("ne sont envoyés ni à SerpApi ni à Google");
    expect(enText).not.toContain("are sent neither to SerpApi nor to Google");
    expect(frText).not.toContain("Aucun texte, ni aucune autre donnée vous concernant");
    expect(enText).not.toContain("No text, nor any other data about you");
    expect(frText).not.toContain("uniquement si vous acceptez l'analyse automatique des vidéos");
    expect(enText).not.toContain("only if you accept automatic video analysis");
  });

  it("SerpApi : textes de recherche, pays et langue, cache ; aucun identifiant du compte (variante B)", () => {
    for (const [text, expected] of [
      [frText, ["la courte recherche écrite par l'IA (voir Anthropic ci-dessous)", "vos mots ; il les transmet à Google Shopping", "la région de votre appareil (à défaut, les États-Unis)", "a déjà été analysée dans les 24 heures", "Aucun identifiant de votre compte ne leur est transmis."]],
      [enText, ["the short search written by the AI (see Anthropic below)", "your words; it passes them to Google Shopping", "your device's region (or, failing that, the United States)", "already been analyzed within the last 24 hours", "No identifier of your account is passed to them."]],
    ] as const) {
      for (const sentence of expected) expect(text).toContain(sentence);
    }
    // La variante A (identifiant dans le lien de l'image) n'est pas retenue.
    expect(frText).not.toContain("Le lien temporaire de l'image contient");
    expect(enText).not.toContain("The image's temporary link contains");
  });

  it("Anthropic : deux usages, les titres sans consentement, jamais d'image, de prix ni de mots", () => {
    expect(frText).toContain("Anthropic (Anthropic, PBC, États-Unis) : son IA (Claude) sert à deux choses.");
    expect(enText).toContain("Anthropic (Anthropic, PBC, United States): its AI (Claude) is used for two things.");
    expect(frText).toContain("les titres et les noms de sites des 15 premiers résultats");
    expect(enText).toContain("the titles and site names of the first 15 results");
    expect(frText).toContain("elle ne reçoit ni image, ni prix, ni vos mots, et cet envoi ne dépend pas de votre choix sur l'analyse des vidéos");
    expect(enText).toContain("it receives no image, no price and none of your words, and this sending does not depend on your choice about video analysis");
  });

  it("bases, transferts, durées : la voie C figure dans chaque section concernée", () => {
    // « Pourquoi, et sur quelle base » (index 3), « Transferts » (index 6), « Combien de temps » (index 7).
    expect(section(privacyPolicy, 3)).toContain("Chercher avec vos mots, quand vous lancez « Que cherchez-vous ? »");
    expect(section(privacyPolicyEn, 3)).toContain("Searching with your words, when you start “What are you looking for?”");
    expect(section(privacyPolicy, 6)).toContain("les titres et les noms de sites des premiers résultats, avec le pays et la langue de la recherche : envoyés à Anthropic");
    expect(section(privacyPolicyEn, 6)).toContain("the titles and site names of the first results, with the country and language of the search: sent to Anthropic");
    expect(section(privacyPolicy, 7)).toContain("Les réponses déjà obtenues (cache)");
    expect(section(privacyPolicyEn, 7)).toContain("Answers already obtained (cache)");
    expect(section(privacyPolicy, 7)).toContain("Les réponses du cache, qui ne sont reliées à aucun compte, ne sont pas concernées");
    expect(section(privacyPolicyEn, 7)).toContain("Cached answers, which are linked to no account, are not affected");
    // Statistiques d'usage : jamais les mots tapés.
    expect(frText).toContain("Jamais votre nom, votre e-mail, les mots que vous tapez,");
    expect(enText).toContain("Never your name, email address, the words you type,");
  });

  it("textes de l'app : mots d'une photo (4.1), « Que cherchez-vous ? » (4.2, option A), recherche écrite par une IA (4.3)", () => {
    expect(fr.launch.photoWordsNote).toBe(
      "Vos mots servent seulement à trier les propositions : ils ne partent pas avec l'image vers la recherche. Ils ne sont envoyés à un moteur de recherche que si vous lancez vous-même une recherche avec vos mots."
    );
    expect(en.launch.photoWordsNote).toBe(
      "Your words are only used to sort the suggestions: they aren't sent with the image to the search. They only go to a search engine if you start a search with your words yourself."
    );
    expect(fr.result.textSearchNote).toBe(
      "Vos mots seront envoyés à Google Shopping par notre prestataire SerpApi, sans votre nom ni votre e-mail. Spotto ne les garde pas ; il garde les pièces trouvées avec votre recherche."
    );
    expect(en.result.textSearchNote).toBe(
      "Your words will be sent to Google Shopping through our provider SerpApi, without your name or email address. Spotto doesn't keep them; it keeps the pieces found with your search."
    );
    expect(fr.result.complementQuery("baskets X-200")).toBe("Recherche écrite par une IA : “baskets X-200”");
    expect(en.result.complementQuery("X-200 trainers")).toBe("Search written by an AI: “X-200 trainers”");
  });
});

