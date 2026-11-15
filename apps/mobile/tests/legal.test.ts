import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS } from "@monapp/shared-types";
import { consentFor, parseLegalVersion, pendingConsents, splitPlaceholders } from "../src/lib/legal";
import { termsOfUse } from "../src/legal/conditions";
import { buildPrivacyPolicy, privacyPolicy } from "../src/legal/confidentialite";
import { buildPrivacyPolicyEn, privacyPolicyEn } from "../src/legal/confidentialite.en";
import type { LegalDocument } from "../src/legal/types";
import * as iphoneExtra from "../src/legal-extra/confidentialite-extra";
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
  // Par titre (lot politique du 2026-11-15) : de nouvelles sections ont décalé les rangs.
  const section = (doc: typeof privacyPolicy, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };
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
    const [why, whyEn] = ["Pourquoi, et sur quelle base", "Why, and on what basis"] as const;
    const [transfers, transfersEn] = ["Transferts hors de l'Union européenne", "Transfers outside the European Union"] as const;
    const [howLong, howLongEn] = ["Combien de temps", "How long"] as const;
    expect(section(privacyPolicy, why)).toContain("Chercher avec vos mots, quand vous lancez « Que cherchez-vous ? »");
    expect(section(privacyPolicyEn, whyEn)).toContain("Searching with your words, when you start “What are you looking for?”");
    expect(section(privacyPolicy, transfers)).toContain("les titres et les noms de sites des premiers résultats, avec le pays et la langue de la recherche : envoyés à Anthropic");
    expect(section(privacyPolicyEn, transfersEn)).toContain("the titles and site names of the first results, with the country and language of the search: sent to Anthropic");
    expect(section(privacyPolicy, howLong)).toContain("Les réponses déjà obtenues (cache)");
    expect(section(privacyPolicyEn, howLongEn)).toContain("Answers already obtained (cache)");
    expect(section(privacyPolicy, howLong)).toContain("Les réponses du cache, qui ne sont reliées à aucun compte, ne sont pas concernées");
    expect(section(privacyPolicyEn, howLongEn)).toContain("Cached answers, which are linked to no account, are not affected");
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

// Lot politique du 2026-11-15 (branche lot-politique-confidentialite) :
// vidéos (mémoire collective, lien court, lecteurs, recherche d'image de
// l'iPhone, analyse automatique d'un lien par le service vidéo) et fonctions
// propres au site (src/legal-extra, version .web). Le texte change SANS
// nouvelle version (consigne du fondateur) : la version et les acceptations
// restent celles du 2026-11-05.
describe("politique de confidentialité : vidéos, lien analysé, fonctions du site (lot du 2026-11-15)", () => {
  const all = (doc: LegalDocument) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");
  const section = (doc: LegalDocument, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };
  const frText = all(privacyPolicy);
  const enText = all(privacyPolicyEn);
  const VIDEOS = "Vidéos de votre téléphone, de TikTok et d'Instagram";
  const VIDEOS_EN = "Videos from your phone, TikTok and Instagram";
  /** Mots de l'essayage : jamais dans les textes de l'app iPhone (règle 2.5.19 d'Apple). */
  const SITE_ONLY = /essayage|fashn|try-on|tryon/i;

  it("ni nouvelle version ni nouvelle acceptation : la politique reste le projet du 2026-11-05", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
    expect(CONSENT_VERSIONS.analyse_video_ia).toBe("analyse-video-ia-2026-10-06");
  });

  it("les phrases devenues fausses ont disparu : aperçu demandé à TikTok ou Meta, Pinterest, vidéo « qui reste sur l'appareil » sans nuance", () => {
    for (const gone of ["l'aperçu public de la vidéo", "Pinterest", "Si vous importez une vidéo, elle reste sur votre appareil"]) expect(frText).not.toContain(gone);
    for (const gone of ["public preview of the video", "Pinterest", "If you import a video, it stays on your device"]) expect(enText).not.toContain(gone);
    // La vidéo du téléphone reste sur l'appareil (inchangé), le lien est nuancé.
    expect(frText).toContain("Si vous importez une vidéo de votre téléphone, elle reste sur votre appareil");
    expect(frText).toContain("notre service vidéo récupère la vidéo le temps d'en extraire quelques images");
    expect(enText).toContain("If you import a video from your phone, it stays on your device");
    expect(enText).toContain("our video service fetches the video just long enough to extract a few frames");
  });

  it("une section « Vidéos » : téléphone, lien, lecteur, analyse d'un lien, limites de l'IA, recherche d'image, pièces déjà repérées", () => {
    const fr = section(privacyPolicy, VIDEOS);
    for (const sentence of [
      "la vidéo n'est jamais envoyée à nos serveurs ni conservée",
      "Pour un lien court TikTok, notre serveur demande seulement à TikTok vers quelle adresse il mène",
      "Le lien est gardé 10 minutes sur votre appareil",
      "TikTok (TikTok Technology Limited) ou par Meta (Meta Platforms Ireland Limited)",
      "l'app vous demande votre accord avant d'afficher un lecteur pour la première fois",
      "le garde 24 heures : Meta reçoit l'adresse de la publication, jamais votre identité",
      // L'analyse automatique d'un lien (lot « vidéo auto »).
      "le même consentement que pour une vidéo de votre téléphone",
      "Notre service vidéo, un service distinct de notre serveur, hébergé lui aussi par Render dans l'Union européenne (Francfort)",
      "sans garder la vidéo",
      "TikTok ou Meta reçoivent cette demande de notre service, avec l'adresse de la vidéo : jamais votre identité ni votre adresse IP",
      "16 au plus, 512 pixels de côté",
      "avec ce que vous avez écrit, à Anthropic",
      "Ni la vidéo, ni ces images, ni ce que vous avez écrit ne sont conservés par Spotto",
      "ni dans notre base de données, ni dans les journaux du serveur, ni dans les rapports d'erreur",
      "cette note est effacée après 2 jours",
      "exclue des sauvegardes",
      // Mémoire collective (0038, 0039).
      "une pièce n'est montrée qu'une fois trouvée par au moins deux membres différents",
      "jamais qui les a trouvées : votre identité n'est ni affichée ni communiquée",
      "Aucune image de la vidéo n'est gardée",
      "« C'est bien cette pièce »",
      "l'équipe de modération peut retirer une pièce de la liste d'une vidéo",
      "supprimé avec cette recherche (au bout de 12 mois) ou avec votre compte",
      "ne contient rien sur vous et n'a pas de durée limitée",
    ]) {
      expect(fr).toContain(sentence);
    }
    const en = section(privacyPolicyEn, VIDEOS_EN);
    for (const sentence of [
      "the video is never sent to our servers nor kept",
      "For a short TikTok link, our server only asks TikTok which address it leads to",
      "The link is kept on your device for 10 minutes",
      "the app asks for your agreement before showing a player for the first time",
      "the same consent as for a video from your phone",
      "Our video service, a service separate from our server, also hosted by Render in the European Union (Frankfurt)",
      "TikTok or Meta receive this request from our service, with the address of the video: never your identity or your IP address",
      "16 at most, 512 pixels on a side",
      "Neither the video, nor these frames, nor what you wrote are kept by Spotto",
      "this note is deleted after 2 days",
      "a piece is shown only once at least two different members have found it",
      "never who found them: your identity is neither displayed nor disclosed",
      "“That's the piece”",
      "contains nothing about you and has no time limit",
    ]) {
      expect(en).toContain(sentence);
    }
  });

  it("le reste de la politique suit : base de l'analyse d'un lien, lecteur, mémoire, Anthropic, Render, TikTok et Meta, transferts, durées, appareil, droits", () => {
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("Analyser automatiquement une vidéo de votre téléphone ou le lien d'une vidéo TikTok ou Instagram");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("Sans lui, aucune vidéo n'est récupérée et aucune image ne part");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("Afficher dans l'app iPhone le lecteur officiel de TikTok ou d'Instagram : votre accord");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("Montrer aux membres qui ouvrent la même vidéo les pièces déjà repérées par au moins deux membres");
    expect(section(privacyPolicy, "Qui peut voir quoi dans Spotto")).toContain("Les pièces trouvées à partir d'une vidéo TikTok ou Instagram : les membres qui ouvrent la même vidéo");
    const providers = section(privacyPolicy, "Nos prestataires et les services tiers");
    expect(providers).toContain("hébergement de notre serveur et de notre service vidéo, situés dans l'Union européenne (Francfort, Allemagne)");
    expect(providers).toContain("au plus 12 pour une vidéo de votre téléphone, 16 pour le lien d'une vidéo TikTok ou Instagram");
    expect(providers).toContain("pour l'analyse automatique d'un lien, notre service vidéo leur demande la vidéo publique");
    expect(section(privacyPolicy, "Transferts hors de l'Union européenne")).toContain("les données qui passent par notre serveur ou par notre service vidéo");
    expect(section(privacyPolicy, "Transferts hors de l'Union européenne")).toContain("et par TikTok ou Meta si vous acceptez leur lecteur officiel");
    expect(section(privacyPolicy, "Combien de temps")).toContain("et la vidéo d'un lien récupérée par notre service vidéo : jamais enregistrées par Spotto");
    expect(section(privacyPolicy, "Combien de temps")).toContain("liens entre vos recherches et les vidéos, « C'est bien cette pièce »");
    expect(section(privacyPolicy, "Sur votre téléphone ou dans votre navigateur")).toContain("Les lecteurs officiels de TikTok et d'Instagram, si vous acceptez de les afficher, peuvent déposer leurs propres traceurs");
    expect(section(privacyPolicy, "Vos droits")).toContain("Retirer votre accord pour le lecteur officiel de TikTok ou d'Instagram (app iPhone) : Réglages → Vos données.");
    const providersEn = section(privacyPolicyEn, "Our providers and third-party services");
    expect(providersEn).toContain("hosting of our server and of our video service, located in the European Union (Frankfurt, Germany)");
    expect(providersEn).toContain("up to 12 for a video from your phone, 16 for the link to a TikTok or Instagram video");
    expect(section(privacyPolicyEn, "Your rights")).toContain("Withdraw your agreement to TikTok's or Instagram's official player (iPhone app): Settings → Your data.");
  });

  it("app iPhone : aucun ajout, aucune trace des fonctions du site, même plan en français et en anglais", () => {
    for (const extra of [iphoneExtra.privacyExtraFr, iphoneExtra.privacyExtraEn]) expect(extra).toEqual(iphoneExtra.NO_PRIVACY_EXTRA);
    expect(Object.values(iphoneExtra.NO_PRIVACY_EXTRA).every((list) => list.length === 0)).toBe(true);
    expect(privacyPolicy).toEqual(buildPrivacyPolicy(iphoneExtra.NO_PRIVACY_EXTRA));
    expect(privacyPolicyEn).toEqual(buildPrivacyPolicyEn(iphoneExtra.NO_PRIVACY_EXTRA));
    expect(frText).not.toMatch(SITE_ONLY);
    expect(enText).not.toMatch(SITE_ONLY);
    expect(privacyPolicy.sections.map((s) => s.title)).toEqual([
      "En bref",
      "Qui est responsable de vos données",
      "Les données que nous utilisons",
      "Pourquoi, et sur quelle base",
      "Qui peut voir quoi dans Spotto",
      VIDEOS,
      "Alertes prix et stock",
      "Nos prestataires et les services tiers",
      "Transferts hors de l'Union européenne",
      "Combien de temps",
      "Sur votre téléphone ou dans votre navigateur",
      "Vos droits",
      "Âge minimum",
      "Sécurité",
      "Modifications",
    ]);
  });
});
