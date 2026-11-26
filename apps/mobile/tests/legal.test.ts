import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCEPTED_CONSENT_VERSIONS, CONSENT_VERSIONS, LEGAL_DOCUMENT_VERSIONS, VIDEO_LINK_CONSENT_VERSIONS } from "@monapp/shared-types";
import { consentFor, parseLegalVersion, pendingConsents, splitPlaceholders } from "../src/lib/legal";
import { termsOfUse } from "../src/legal/conditions";
import { buildPrivacyPolicy, privacyPolicy } from "../src/legal/confidentialite";
import { buildPrivacyPolicyEn, privacyPolicyEn } from "../src/legal/confidentialite.en";
import { PLACEHOLDER_PATTERN, type LegalDocument, type PrivacyExtra } from "../src/legal/types";
import * as iphoneExtra from "../src/legal-extra/confidentialite-extra";
import * as siteExtra from "../src/legal-extra/confidentialite-extra.web";
import { fr } from "../src/i18n/fr";
import { en } from "../src/i18n/en";
import { PUBLISHER, PUBLISHER_EN, readPublisher } from "../src/legal/publisher";

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
  const FRENCH_MARKS = /[àâçéèêëîïôûùœ«»]|\b(vous|votre|le|la|les|des|une|pour|avec)\b/i;
  const siteFr = buildPrivacyPolicy(siteExtra.privacyExtraFr);
  const siteEn = buildPrivacyPolicyEn(siteExtra.privacyExtraEn);

  it("ni nouvelle version ni nouvelle acceptation : la politique reste le projet du 2026-11-05", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
  });

  // Conception finale (revue du lot « vidéo auto ») : le consentement
  // « analyse_video_ia » passe à une nouvelle version qui couvre aussi les
  // liens, faite côté app (branche lot-video-auto). L'ancienne version reste
  // valable pour une vidéo du téléphone ; l'analyse d'un lien exige la
  // nouvelle (VIDEO_LINK_CONSENT_VERSIONS, côté serveur et app). La version en
  // vigueur est toujours acceptée, avant comme après cette mise à jour.
  it("analyse d'un lien : nouvelle version du consentement, exigée pour un lien, en français comme en anglais", () => {
    expect(ACCEPTED_CONSENT_VERSIONS.analyse_video_ia).toContain(CONSENT_VERSIONS.analyse_video_ia);
    const fr = section(privacyPolicy, VIDEOS);
    const en = section(privacyPolicyEn, VIDEOS_EN);
    expect(fr).toContain("C'est le même consentement que pour une vidéo de votre téléphone, dans une nouvelle version de son texte, qui couvre à la fois les vidéos de votre téléphone et les liens.");
    expect(fr).toContain("Un accord donné sur la version précédente, qui ne parlait que des vidéos de votre téléphone, reste valable pour elles ; pour un lien, l'app vous demande votre accord sur la nouvelle version avant la première analyse.");
    expect(en).toContain("It is the same consent as for a video from your phone, in a new version of its text, which covers both videos from your phone and links.");
    expect(en).toContain("Consent given on the previous version, which only covered videos from your phone, remains valid for them; for a link, the app asks for your consent to the new version before the first analysis.");
    // L'ancienne formule laissait croire que l'accord donné pour une vidéo du téléphone suffisait.
    expect(frText).not.toContain("(le même consentement que pour une vidéo de votre téléphone)");
    expect(enText).not.toContain("(the same consent as for a video from your phone)");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("votre consentement, demandé à la première utilisation et de nouveau quand son texte change, que vous pouvez retirer à tout moment (Réglages → Vos données)");
    expect(section(privacyPolicyEn, "Why, and on what basis")).toContain("your consent, asked the first time you use it and again when its text changes, which you can withdraw at any time (Settings → Your data)");
    // Chaque choix est enregistré avec la version du texte présenté (POST /api/consents).
    expect(section(privacyPolicy, "Les données que nous utilisons")).toContain("pour les statistiques d'usage et l'analyse automatique des vidéos, chacun avec sa date et la version du texte qui vous a été présenté.");
    expect(section(privacyPolicyEn, "The data we use")).toContain("for usage statistics and automatic video analysis, each with its date and the version of the text shown to you.");
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
      "C'est le même consentement que pour une vidéo de votre téléphone, dans une nouvelle version de son texte",
      "Notre service vidéo, un service distinct de notre serveur, hébergé lui aussi par Render dans l'Union européenne (Francfort)",
      "sans garder la vidéo",
      "TikTok ou Meta reçoivent cette demande de notre service, avec l'adresse de la vidéo : jamais votre identité ni votre adresse IP",
      "16 au plus, 512 pixels de côté",
      // Lot « propositions » : ce que vous écrivez devient facultatif.
      "avec, le cas échéant, ce que vous avez écrit, à Anthropic",
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
      "It is the same consent as for a video from your phone, in a new version of its text",
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

  it("site : l'essayage virtuel photo a sa section, juste après les alertes, et chaque section concernée le mentionne", () => {
    const titles = siteFr.sections.map((s) => s.title);
    expect(titles.length).toBe(privacyPolicy.sections.length + 1);
    expect(titles.indexOf("Essayage virtuel photo")).toBe(titles.indexOf("Alertes prix et stock") + 1);
    expect(siteEn.sections.map((s) => s.title).indexOf("Virtual photo try-on")).toBe(titles.indexOf("Essayage virtuel photo"));
    const tryon = section(siteFr, "Essayage virtuel photo");
    for (const sentence of [
      "si vous avez 18 ans ou plus",
      "elle ne démarre qu'avec votre consentement",
      "Ni votre photo ni l'image produite ne servent à entraîner une IA",
      "Sur quelle base : votre consentement",
      "le retrait vaut pour l'avenir",
      "1 296 pixels au plus sur le grand côté",
      "Votre date de naissance sert seulement au calcul : elle n'est jamais conservée",
      "FASHN, au Royaume-Uni",
      "Ni votre nom, ni votre adresse e-mail, ni aucun identifiant de votre compte ne lui sont transmis",
      "Les sous-traitants de FASHN, dont certains sont situés aux États-Unis et en Asie",
      "en mémoire seulement",
      "aucune conservation",
      "Les informations d'usage et vos signalements : 12 mois",
      "compteurs mensuels anonymes",
      "au plus tard sous un jour",
      "pendant 60 minutes",
      "tant que Spotto n'en demande pas la suppression",
      "« Image générée par IA »",
      "DigitalSourceType = trainedAlgorithmicMedia",
      "Aucune donnée de l'essayage n'est envoyée aux statistiques d'usage",
    ]) {
      expect(tryon).toContain(sentence);
    }
    const tryonEn = section(siteEn, "Virtual photo try-on");
    for (const sentence of ["if you are 18 or over", "FASHN, in the United Kingdom", "no retention", "for 60 minutes", "within one day at the latest", "DigitalSourceType = trainedAlgorithmicMedia", "Neither your name, nor your email address, nor any identifier of your account is sent to it"]) {
      expect(tryonEn).toContain(sentence);
    }
    // Chaque liste reçoit son ajout, au bon endroit.
    expect(section(siteFr, "En bref")).toContain("votre photo est envoyée à notre prestataire FASHN pour créer l'image");
    expect(section(siteFr, "Pourquoi, et sur quelle base")).toContain("Créer un essayage virtuel photo, sur le site : votre consentement");
    expect(section(siteFr, "Nos prestataires et les services tiers")).toContain("FASHN (Royaume-Uni) : création de l'essayage virtuel photo");
    expect(section(siteFr, "Transferts hors de l'Union européenne")).toContain("si vous utilisez l'essayage virtuel photo : votre photo et l'image de la pièce, envoyées à FASHN, au Royaume-Uni");
    expect(section(siteFr, "Combien de temps")).toContain("Les données de l'essayage virtuel photo : voir « Essayage virtuel photo »");
    expect(section(siteFr, "Vos droits")).toContain("Retirer votre consentement à l'essayage virtuel photo : Réglages → Vos données.");
    expect(section(siteFr, "Âge minimum")).toContain("réservé aux personnes de 18 ans et plus");
    // Le reste du texte est celui de l'app iPhone, mot pour mot.
    const withoutExtra = (doc: LegalDocument, extra: PrivacyExtra) => {
      const added = new Set([...extra.summary, ...extra.bases, ...extra.providers, ...extra.transfers, ...extra.retention, ...extra.rights, ...extra.age]);
      const extraTitles = new Set(extra.sections.map((s) => s.title));
      return doc.sections
        .filter((s) => !extraTitles.has(s.title))
        .map((s) => ({ ...s, blocks: s.blocks.filter((b) => typeof b !== "string" || !added.has(b)).map((b) => (typeof b === "string" ? b : b.filter((item) => !added.has(item)))) }));
    };
    expect(withoutExtra(siteFr, siteExtra.privacyExtraFr)).toEqual(privacyPolicy.sections);
    expect(withoutExtra(siteEn, siteExtra.privacyExtraEn)).toEqual(privacyPolicyEn.sections);
  });

  it("site : même plan en français et en anglais, anglais sans mot français, aucun champ à compléter ni note pour l'avocat", () => {
    expect(siteEn.sections.length).toBe(siteFr.sections.length);
    siteEn.sections.forEach((s, index) => {
      expect(s.blocks.length, s.title).toBe(siteFr.sections[index]!.blocks.length);
      s.blocks.forEach((block, b) => {
        const french = siteFr.sections[index]!.blocks[b]!;
        expect(typeof block, `${s.title} ${b}`).toBe(typeof french);
        if (typeof block !== "string") expect(block.length, `${s.title} ${b}`).toBe((french as readonly string[]).length);
      });
    });
    const englishLines = siteEn.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).map((line) => line.replace(/\[To be[^\]]*\]/g, ""));
    expect(englishLines.filter((line) => FRENCH_MARKS.test(line))).toEqual([]);
    // Les ajouts du site, sans aucun crochet : ni « [À vérifier] », ni les notes des brouillons (« [à confirmer] »…).
    // Seule exception : l'adresse de contact de l'éditeur, reprise de publisher.ts (« [À compléter] » si absente).
    for (const extra of [siteExtra.privacyExtraFr, siteExtra.privacyExtraEn]) {
      const texts = [...extra.summary, ...extra.bases, ...extra.providers, ...extra.transfers, ...extra.retention, ...extra.rights, ...extra.age, ...extra.sections.flatMap((s) => [s.title, ...s.blocks.flat()])].map((text) =>
        text.replaceAll(PUBLISHER.email, "").replaceAll(PUBLISHER_EN.email, "")
      );
      expect(texts.length).toBeGreaterThan(10);
      expect(texts.filter((text) => PLACEHOLDER_PATTERN.test(text) || /\[/.test(text))).toEqual([]);
    }
    // Autant de mentions « à vérifier » dans les deux langues, sur le site comme dans l'app.
    expect(all(siteEn).match(/\[To be verified/g)!.length).toBe(all(siteFr).match(/\[À vérifier/g)!.length);
    expect(all(siteFr).match(/\[À vérifier/g)!.length).toBe(frText.match(/\[À vérifier/g)!.length);
  });

  it("le nom neutre des deux versions : mêmes noms exportés, importés par les deux textes sans suffixe de plateforme", () => {
    expect(Object.keys(siteExtra).sort()).toEqual(Object.keys(iphoneExtra).sort());
    const dir = join(__dirname, "../src/legal");
    for (const file of ["confidentialite.ts", "confidentialite.en.ts"]) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).toContain('from "../legal-extra/confidentialite-extra";');
      expect(source, file).not.toMatch(/confidentialite-extra\.web/);
    }
  });
});

// Lot prix vidéo (2026-11-17, branche lot-prix-video ; décision du fondateur
// « Automatique (Recommandé) ») : pour une recherche lancée depuis le lien
// d'une vidéo, quand aucun résultat n'affiche de prix, la description écrite
// pour l'analyse part automatiquement à SerpApi puis Google Shopping. Chaque
// section concernée le dit, en français comme en anglais, avec les mêmes faits ;
// la version de la politique et les acceptations ne changent pas.
describe("politique de confidentialité : description d'un lien vidéo envoyée sans prix (lot du 2026-11-17)", () => {
  const section = (doc: LegalDocument, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };
  const VIDEOS = "Vidéos de votre téléphone, de TikTok et d'Instagram";
  const VIDEOS_EN = "Videos from your phone, TikTok and Instagram";

  it("ni nouvelle version ni nouvelle acceptation", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
  });

  it("chaque section concernée le dit, en français et en anglais", () => {
    const expected: [string, string, string, string][] = [
      [
        "En bref",
        "In short",
        // Lot « propositions » : le nom de la pièce choisie suit le même chemin (ARRÊT 3 A).
        "Si les résultats de la recherche qui suit n'affichent aucun prix, ce que vous avez écrit, ou le nom de la pièce choisie parmi les propositions de l'IA, est aussi envoyé automatiquement à notre prestataire SerpApi, qui interroge Google Shopping, pour trouver des boutiques, sans votre nom ni votre e-mail.",
        "If the results of the search that follows show no price, what you wrote, or the name of the piece you chose among the AI's suggestions, is also sent automatically to our provider SerpApi, which queries Google Shopping, to find shops, without your name or email address.",
      ],
      [
        "En bref",
        "In short",
        "Pour une recherche lancée depuis le lien d'une vidéo, quand aucun résultat n'affiche de prix, la description que vous avez écrite (ou le nom de la pièce choisie parmi les propositions de l'IA) est envoyée automatiquement à ce moteur de recherche, de la même façon.",
        "For a search started from a video link, when no result shows a price, the description you wrote (or the name of the piece you chose among the AI's suggestions) is sent automatically to that search engine, in the same way.",
      ],
      [
        "Les données que nous utilisons",
        "The data we use",
        "${BRAND} lance cette recherche de lui-même, une seule fois, avec la description que vous avez écrite pour l'analyse de la vidéo (ou le nom de la pièce choisie parmi les propositions de l'IA) : elle est envoyée de la même façon, sans votre nom ni votre e-mail",
        "${BRAND} starts this search by itself, once, with the description you wrote for the analysis of the video (or the name of the piece you chose among the AI's suggestions): it is sent in the same way, without your name or email address",
      ],
      [
        "Pourquoi, et sur quelle base",
        "Why, and on what basis",
        "Chercher avec la description écrite pour le lien d'une vidéo (ou le nom de la pièce choisie parmi les propositions de l'IA), lancée automatiquement quand aucun résultat n'affiche de prix : exécution du contrat qui nous lie (la recherche de la pièce que vous avez demandée). [À vérifier : base retenue.]",
        "Searching with the description written for a video link (or the name of the piece chosen among the AI's suggestions), started automatically when no result shows a price: performance of the contract between us (the search for the piece that you asked for). [To be verified: basis retained.]",
      ],
      [
        VIDEOS,
        VIDEOS_EN,
        "si aucune proposition n'affiche de prix, ni dans la recherche visuelle ni dans les autres boutiques, notre serveur l'envoie automatiquement, une seule fois, à SerpApi, qui interroge Google Shopping pour trouver des boutiques qui vendent la pièce",
        "if no suggestion shows a price, neither in the visual search nor at other retailers, our server sends it automatically, once, to SerpApi, which queries Google Shopping to find shops that sell the piece",
      ],
      [
        "Nos prestataires et les services tiers",
        "Our providers and third-party services",
        "(pour une recherche lancée depuis le lien d'une vidéo dont aucun résultat n'affiche de prix, automatiquement, avec la description que vous avez écrite ou le nom de la pièce choisie parmi les propositions de l'IA), vos mots ; il les transmet à Google Shopping",
        "(for a search started from a video link where no result shows a price, automatically, with the description you wrote or the name of the piece you chose among the AI's suggestions), your words; it passes them to Google Shopping",
      ],
      [
        "Transferts hors de l'Union européenne",
        "Transfers outside the European Union",
        "vos mots (ou, pour une recherche lancée depuis le lien d'une vidéo dont aucun résultat n'affiche de prix, automatiquement, la description que vous avez écrite ou le nom de la pièce choisie parmi les propositions de l'IA), avec le pays et la langue de la recherche : envoyés à SerpApi puis à Google (Google Shopping)",
        "your words (or, for a search started from a video link where no result shows a price, automatically, the description you wrote or the name of the piece you chose among the AI's suggestions), with the country and language of the search: sent to SerpApi and then to Google (Google Shopping)",
      ],
      [
        "Combien de temps",
        "How long",
        "Les mots de « Que cherchez-vous ? », y compris la description d'un lien vidéo ou le nom de la pièce choisie parmi les propositions de l'IA, envoyés automatiquement quand aucun résultat n'affiche de prix : jamais enregistrés par ${BRAND}",
        "The words of “What are you looking for?”, including the description of a video link or the name of the piece chosen among the AI's suggestions, sent automatically when no result shows a price: never saved by ${BRAND}",
      ],
    ];
    for (const [titleFr, titleEn, sentenceFr, sentenceEn] of expected) {
      expect(section(privacyPolicy, titleFr)).toContain(sentenceFr.replace("${BRAND}", "Spotto"));
      expect(section(privacyPolicyEn, titleEn)).toContain(sentenceEn.replace("${BRAND}", "Spotto"));
    }
  });

  it("les promesses qui restent vraies sont gardées : la description jamais conservée, jamais avec l'image vers la recherche visuelle ; les mots d'une photo trient seulement", () => {
    const fr = section(privacyPolicy, VIDEOS);
    const en = section(privacyPolicyEn, VIDEOS_EN);
    expect(fr).toContain("Ni la vidéo, ni ces images, ni ce que vous avez écrit ne sont conservés par Spotto");
    expect(en).toContain("Neither the video, nor these frames, nor what you wrote are kept by Spotto");
    expect(fr).toContain("Ce que vous avez écrit, ou le nom de la pièce choisie parmi les propositions de l'IA, sert aussi à la recherche qui suit, sans jamais partir avec l'image vers la recherche visuelle");
    expect(en).toContain("What you wrote, or the name of the piece you chose among the AI's suggestions, is also used for the search that follows, never sent with the image to the visual search");
    expect(fr).toContain("Là non plus, Spotto ne l'enregistre pas.");
    expect(en).toContain("There too, Spotto does not save it.");
    expect(section(privacyPolicy, "Les données que nous utilisons")).toContain(
      "Sous une photo, les mots que vous tapez servent seulement à trier les propositions : notre serveur ne les envoie pas avec l'image à la recherche visuelle, et ne les enregistre pas."
    );
    expect(section(privacyPolicyEn, "The data we use")).toContain(
      "Under a photo, the words you type are only used to sort the suggestions: our server does not send them with the image to the visual search, and does not save them."
    );
  });
});

// Lot propositions (Parcours 2, 2026-11-21, branche lot-propositions-pieces ;
// décisions du fondateur, ARRÊT 1 A, 2 A, 3 A) : pour le lien d'une vidéo,
// l'IA peut proposer, sans rien d'écrit, le nom de 3 pièces visibles au plus ;
// ce que vous écrivez devient facultatif, et le nom de la pièce choisie suit
// le chemin de la description. Chaque passage le dit, en français et en
// anglais ; ni nouvelle version de la politique, ni nouvelle version du
// consentement « analyse_video_ia ».
describe("politique de confidentialité : propositions de l'IA (lot du 2026-11-21)", () => {
  const section = (doc: LegalDocument, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };
  const VIDEOS = "Vidéos de votre téléphone, de TikTok et d'Instagram";
  const VIDEOS_EN = "Videos from your phone, TikTok and Instagram";
  const CHOSEN = "ou le nom de la pièce choisie parmi les propositions de l'IA";
  const CHOSEN_EN = "or the name of the piece you chose among the AI's suggestions";

  it("ni nouvelle version de la politique ni nouveau texte d'accord ; l'en-tête des deux fichiers dit le lot", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
    expect(CONSENT_VERSIONS.analyse_video_ia).toBe("analyse-video-ia-2026-11-15");
    const read = (path: string) => readFileSync(join(__dirname, "../src/legal", path), "utf8");
    expect(read("confidentialite.ts")).toContain("// Lot propositions (2026-11-21, branche lot-propositions-pieces), toujours\n// SANS changer LEGAL_DOCUMENT_VERSIONS");
    expect(read("confidentialite.en.ts")).toContain("// Suggestions lot (2026-11-21, branch lot-propositions-pieces), still WITHOUT\n// changing LEGAL_DOCUMENT_VERSIONS");
  });

  it("section « Vidéos » : les propositions sans rien écrire — mêmes images sans texte, 3 noms au plus, jamais une personne, rien de gardé", () => {
    expect(section(privacyPolicy, VIDEOS)).toContain(
      "Vous pouvez aussi, sans rien écrire, demander à l'IA de vous proposer les pièces qu'elle voit : Anthropic reçoit alors les mêmes images et la langue de l'app, sans aucun texte de votre part, et renvoie le nom de 3 pièces visibles au plus (par exemple « Le manteau camel »), avec pour chacune la meilleure image et son emplacement. L'IA a pour consigne de ne jamais désigner une personne, et Spotto écarte les noms qui contiennent certains mots désignant une personne (comme « fille » ou « homme »). Spotto ne conserve pas ces noms."
    );
    expect(section(privacyPolicyEn, VIDEOS_EN)).toContain(
      "You can also, without writing anything, ask the AI to suggest the pieces it sees: Anthropic then receives the same frames and the app's language, without any text from you, and returns the names of up to 3 visible pieces (for example “The camel coat”), each with the best frame and where it is. The AI is instructed never to refer to a person, and Spotto discards names that contain certain words referring to a person (such as “girl” or “man”). Spotto does not keep these names."
    );
    // Refusé : le filtre ne lit qu'une liste fixe de mots ; plus aucune phrase qui promet d'écarter tout nom désignant une personne.
    expect(JSON.stringify(privacyPolicy)).not.toContain("écarte les noms qui contiennent un mot désignant une personne");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("discards names that contain a word referring to a person");
    // Refusé : Anthropic reçoit la langue de l'app ; plus « les mêmes images, sans aucun texte » seules.
    expect(JSON.stringify(privacyPolicy)).not.toContain("les mêmes images, sans aucun texte de votre part");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("the same frames, without any text from you");
  });

  it("ce que vous écrivez devient facultatif (5 passages) ; pour Anthropic, le nom et l'emplacement de quelques pièces visibles", () => {
    const expected: [string, string, string, string][] = [
      ["En bref", "In short", "analysées par une IA avec, le cas échéant, ce que vous avez écrit.", "analyzed by an AI together with, where applicable, what you wrote."],
      ["Pourquoi, et sur quelle base", "Why, and on what basis", "(quelques images réduites et, le cas échéant, votre description, envoyées à Anthropic)", "(a few reduced frames and, where applicable, your description, sent to Anthropic)"],
      [VIDEOS, VIDEOS_EN, "les transmet, avec, le cas échéant, ce que vous avez écrit, à Anthropic", "passes them on, with, where applicable, what you wrote, to Anthropic"],
      [
        "Nos prestataires et les services tiers",
        "Our providers and third-party services",
        "et, le cas échéant, votre description (et, pour les propositions de l'IA, la langue de l'app, pour écrire les noms), et indique les meilleurs moments et l'emplacement de la pièce ou, si vous le demandez, le nom et l'emplacement de quelques pièces visibles.",
        "and, where applicable, your description (and, for the AI's suggestions, the app's language, to write the names), and indicates the best moments and where the piece is or, if you ask for it, the name and location of a few visible pieces.",
      ],
      [
        "Transferts hors de l'Union européenne",
        "Transfers outside the European Union",
        "(d'une vidéo de votre téléphone ou d'un lien TikTok ou Instagram) et, le cas échéant, votre description (et, pour les propositions de l'IA, la langue de l'app, pour écrire les noms), envoyées à Anthropic",
        "(from a video from your phone or from a TikTok or Instagram link) and, where applicable, your description (and, for the AI's suggestions, the app's language, to write the names), sent to Anthropic",
      ],
    ];
    for (const [titleFr, titleEn, fr, en] of expected) {
      expect(section(privacyPolicy, titleFr), titleFr).toContain(fr);
      expect(section(privacyPolicyEn, titleEn), titleEn).toContain(en);
    }
    // Plus aucune phrase qui rendrait la description obligatoire pour Anthropic.
    expect(JSON.stringify(privacyPolicy)).not.toContain("avec ce que vous avez écrit, à Anthropic");
    // Refusé : pour la vidéo, plus aucune liste d'Anthropic qui tait la langue de l'app.
    expect(JSON.stringify(privacyPolicy)).not.toContain("le cas échéant, votre description, et indique");
    expect(JSON.stringify(privacyPolicy)).not.toContain("TikTok ou Instagram) et, le cas échéant, votre description, envoyées à Anthropic");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("where applicable, your description, and indicates");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("TikTok or Instagram link) and, where applicable, your description, sent to Anthropic");
    expect(JSON.stringify(privacyPolicyEn)).not.toContain("with what you wrote, to Anthropic");
  });

  it("le nom de la pièce choisie suit le chemin de la description : les 8 passages qui disent le tri ou l'envoi à SerpApi et Google Shopping", () => {
    const EN_CHOSEN = /or the name of the piece (you chose|chosen) among the AI's suggestions/g;
    const sections: [string, string, number][] = [
      ["En bref", "In short", 2],
      ["Les données que nous utilisons", "The data we use", 1],
      ["Pourquoi, et sur quelle base", "Why, and on what basis", 1],
      [VIDEOS, VIDEOS_EN, 1],
      ["Nos prestataires et les services tiers", "Our providers and third-party services", 1],
      ["Transferts hors de l'Union européenne", "Transfers outside the European Union", 1],
      ["Combien de temps", "How long", 1],
    ];
    for (const [titleFr, titleEn, count] of sections) {
      expect(section(privacyPolicy, titleFr).split(CHOSEN).length - 1, titleFr).toBe(count);
      expect(section(privacyPolicyEn, titleEn).match(EN_CHOSEN)?.length ?? 0, titleEn).toBe(count);
    }
    expect(JSON.stringify(privacyPolicy).split(CHOSEN).length - 1).toBe(8);
    expect(JSON.stringify(privacyPolicyEn).match(EN_CHOSEN)).toHaveLength(8);
    expect(section(privacyPolicyEn, "In short")).toContain(CHOSEN_EN);
    expect(section(privacyPolicy, "Combien de temps")).toContain("y compris la description d'un lien vidéo " + CHOSEN + ", envoyés automatiquement");
    expect(section(privacyPolicyEn, "How long")).toContain("including the description of a video link or the name of the piece chosen among the AI's suggestions, sent automatically");
  });

  it("refusé : l'écran d'accord ne change pas (même texte, même version) — ce qui part reste les images, et même moins (aucun texte) en mode « pièces »", () => {
    expect(fr.videoAuto.consentBody).toHaveLength(5);
    expect(fr.videoAuto.consentBody[0]).toBe(
      "Pour trouver la pièce à votre place, Spotto envoie quelques images réduites de la vidéo et votre description à un prestataire d'intelligence artificielle, Anthropic, situé aux États-Unis."
    );
    expect(fr.videoAuto.consentBody[3]).toContain("Ces images servent uniquement à repérer la pièce.");
    expect(en.videoAuto.consentBody).toHaveLength(5);
    expect(VIDEO_LINK_CONSENT_VERSIONS).toEqual([CONSENT_VERSIONS.analyse_video_ia]);
  });
});

// Retours du build 3 (2026-11-26, branche lot-textes-juridiques) : lecteur
// (le bouton Lecture vaut accord), image du moment par notre service vidéo
// (VIDEO_LINK_FRAME_ENABLED), grandes images des résultats
// (MERCHANT_IMAGE_RESULTS_ENABLED), couleur des bords (EDGE_COLOR_ENABLED),
// dernière vidéo de la galerie, ce que l'app garde sur l'appareil. Toujours
// sans nouvelle version ; une fonction derrière un interrupteur éteint est
// une possibilité (« peut » / "may").
describe("politique de confidentialité : retours du build 3 (lot du 2026-11-26)", () => {
  const section = (doc: LegalDocument, title: string) => {
    const found = doc.sections.find((s) => s.title === title);
    expect(found, title).toBeDefined();
    return found!.blocks.flat().join("\n");
  };
  const all = (doc: LegalDocument) => doc.sections.flatMap((s) => [s.title, ...s.blocks.flat()]).join("\n");
  const frText = all(privacyPolicy);
  const enText = all(privacyPolicyEn);
  const VIDEOS = "Vidéos de votre téléphone, de TikTok et d'Instagram";
  const VIDEOS_EN = "Videos from your phone, TikTok and Instagram";
  const PROVIDERS = "Nos prestataires et les services tiers";
  const PROVIDERS_EN = "Our providers and third-party services";
  const serverEnv = readFileSync(join(__dirname, "../../backend/src/env.ts"), "utf8");

  it("ni nouvelle version ni nouvelle acceptation ; l'en-tête des deux fichiers dit le lot", () => {
    expect(LEGAL_DOCUMENT_VERSIONS.privacy_policy).toBe("projet-2026-11-05");
    expect(ACCEPTED_CONSENT_VERSIONS.privacy_policy.at(-1)).toBe("projet-2026-11-05");
    const read = (path: string) => readFileSync(join(__dirname, "../src/legal", path), "utf8");
    expect(read("confidentialite.ts")).toContain("// Retours du build 3 (2026-11-26, branche lot-textes-juridiques), toujours\n// SANS changer LEGAL_DOCUMENT_VERSIONS");
    expect(read("confidentialite.en.ts")).toContain("// Build 3 feedback (2026-11-26, branch lot-textes-juridiques), still WITHOUT\n// changing LEGAL_DOCUMENT_VERSIONS");
  });

  it("refusé : « l'image recadrée est envoyée » (l'app envoie l'image entière et le rectangle, le serveur recadre) ; permis : l'image entière et le rectangle", () => {
    expect(frText).not.toContain("l'image recadrée est envoyée");
    expect(enText).not.toContain("the cropped image is sent");
    expect(section(privacyPolicy, VIDEOS)).toContain("l'image entière est envoyée pour la recherche, comme une photo, avec, le cas échéant, le rectangle autour de la zone choisie, que notre serveur recadre");
    expect(section(privacyPolicyEn, VIDEOS_EN)).toContain("the whole image is sent for the search, like a photo, with, where applicable, the rectangle around the chosen area, which our server crops");
    // Le code : l'image et le rectangle partent séparément ; le serveur recadre.
    const api = readFileSync(join(__dirname, "../src/lib/api.ts"), "utf8");
    expect(api).toContain('formData.append("crop", JSON.stringify(params.crop))');
    expect(readFileSync(join(__dirname, "../../backend/src/lib/imageProcessing.ts"), "utf8")).toContain("export async function prepareImageForAnalysis(input: Buffer, crop: CropRect | null)");
    // Le cache, lui, est bien rangé sous l'empreinte de l'image recadrée (côté serveur) : gardé.
    expect(section(privacyPolicy, "Combien de temps")).toContain("une empreinte de l'image recadrée");
  });

  it("lecteur : le premier appui sur le bouton de lecture vaut accord, rien n'est chargé avant ; vrai avec les deux écrans (PLAYER_CONSENT_BY_PLAY_BUTTON)", () => {
    expect(section(privacyPolicy, VIDEOS)).toContain("Tant que vous ne l'avez pas donné pour une plateforme, l'app ne charge rien chez elle (ni image de la vidéo, ni lecteur) et, pour Instagram, notre serveur ne demande pas non plus le code d'affichage : l'app vous présente un bouton de lecture, avec une phrase qui dit ce qu'il implique, et votre premier appui sur ce bouton vaut accord.");
    expect(section(privacyPolicyEn, VIDEOS_EN)).toContain("Until you have given it for a platform, the app loads nothing from it (neither an image of the video nor a player) and, for Instagram, our server does not ask for the embed code either: the app shows you a play button, with a sentence saying what it implies, and your first press on that button counts as agreement.");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("(votre premier appui sur le bouton de lecture que l'app vous présente vaut accord)");
    expect(section(privacyPolicyEn, "Why, and on what basis")).toContain("(your first press on the play button the app shows you counts as agreement)");
    // Les deux écrans présentent un bouton de lecture et une phrase : le nouveau (firstPlay) et l'ancien (gate).
    expect(fr.player.firstPlay.play("TikTok")).toMatch(/^Lire/);
    expect(fr.player.gate.play).toMatch(/^Lire/);
    expect(en.player.firstPlay.play("TikTok")).toMatch(/^Play/);
    expect(en.player.gate.play).toMatch(/^Play/);
    // Refusé : un détail propre à un seul des deux écrans (le fond sobre, « Non merci »).
    for (const onlyOne of ["fond sobre", "Non merci", "plain background", "No thanks"]) expect(frText + enText).not.toContain(onlyOne);
  });

  it("image du moment : une possibilité (« peut »), tant que VIDEO_LINK_FRAME_ENABLED n'est allumé que par \"true\" ; rien de gardé ; 30 par heure", () => {
    expect(serverEnv).toMatch(/VIDEO_LINK_FRAME_ENABLED: z\s*\.string\(\)\s*\.optional\(\)\s*\.transform\(\(value\) => value === "true"\)/);
    const fr = section(privacyPolicy, VIDEOS);
    const en = section(privacyPolicyEn, VIDEOS_EN);
    expect(fr).toContain("Pour une vidéo TikTok, notre serveur peut aussi préparer lui-même l'image de ce moment : l'app lui envoie alors l'adresse publique de la vidéo et le moment choisi (à la milliseconde près)");
    expect(en).toContain("For a TikTok video, our server may also prepare the image of this moment itself: the app then sends it the public address of the video and the chosen moment (to the millisecond)");
    expect(fr).toContain("TikTok reçoit l'adresse de la vidéo, jamais votre identité ni votre adresse IP), en extrait une seule image de ce moment, sans IA");
    expect(fr).toContain("Ni cette vidéo ni cette image ne sont conservées par Spotto");
    expect(fr).toContain("Chaque membre peut demander au plus 30 de ces images par heure.");
    expect(en).toContain("Each member can request at most 30 of these images per hour.");
    expect(fr).toContain("sauf si l'app la juge noire, blanche ou floue : elle est alors effacée sans être envoyée");
    // Refusé : la promesse absolue d'une image « nette », et l'indicatif qui dirait la fonction toujours active.
    expect(frText).not.toContain("notre serveur prépare lui-même l'image");
    expect(enText).not.toContain("our server prepares the image");
    expect(frText).not.toContain("seulement si elle est nette");
    // Le reste de la politique suit : Render, TikTok et Meta, base, transferts, durées.
    expect(section(privacyPolicy, PROVIDERS)).toContain("le service vidéo ne reçoit, de notre serveur, que les adresses des vidéos à analyser ou dont vous demandez l'image d'un moment, et ce moment.");
    expect(section(privacyPolicyEn, PROVIDERS_EN)).toContain("the video service only receives, from our server, the addresses of the videos to analyze or whose image of a moment you request, and that moment.");
    expect(frText).not.toContain("le service vidéo ne reçoit que les adresses des vidéos à analyser, de notre serveur.");
    expect(section(privacyPolicy, PROVIDERS)).toContain("Il peut aussi demander à TikTok la vidéo publique dont vous demandez l'image d'un moment");
    expect(section(privacyPolicy, "Pourquoi, et sur quelle base")).toContain("Préparer, pour une vidéo TikTok, l'image du moment que vous choisissez avec « Spotter ce moment »");
    expect(section(privacyPolicy, "Transferts hors de l'Union européenne")).toContain("et les vidéos analysées ou dont une image est extraite)");
    expect(section(privacyPolicyEn, "Transfers outside the European Union")).toContain("and the videos analyzed or from which an image is extracted)");
    expect(section(privacyPolicy, "Combien de temps")).toContain("L'image d'un moment d'une vidéo TikTok préparée par notre service vidéo, et cette vidéo : jamais enregistrées par Spotto");
    expect(section(privacyPolicyEn, "How long")).toContain("The image of a moment of a TikTok video prepared by our video service, and that video: never saved by Spotto");
  });

  it("grandes images : étendues aux résultats (8 au plus par liste, jamais une page de Google), une possibilité tant que MERCHANT_IMAGE_RESULTS_ENABLED n'est allumé que par \"true\"", () => {
    for (const name of ["MERCHANT_IMAGE_UPGRADE_ENABLED", "MERCHANT_IMAGE_RESULTS_ENABLED"]) {
      expect(serverEnv, name).toMatch(new RegExp(`${name}: z\\s*\\.string\\(\\)\\s*\\.optional\\(\\)\\s*\\.transform\\(\\(value\\) => value === "true"\\)`));
    }
    const fr = section(privacyPolicy, PROVIDERS);
    const en = section(privacyPolicyEn, PROVIDERS_EN);
    expect(fr).toContain("Pour une pièce proposée dans vos résultats parmi celles trouvées dans d'autres boutiques ou avec vos mots, ou que vous gardez dans vos Envies ou ajoutez à votre Vault, et qui n'a qu'une petite image, notre serveur peut consulter la page publique de la boutique");
    expect(en).toContain("For a piece suggested in your results among those found at other retailers or with your words, or that you keep in your Wishlist or add to your Vault, and that only has a small image, our server may visit the shop's public page");
    expect(fr).toContain("pour 8 pièces au plus de chacune de ces deux listes (les premières dans l'ordre où l'app les montre par défaut), et jamais pour une page de Google");
    expect(en).toContain("for at most 8 pieces of each of these two lists (the first ones in the order the app shows them by default), and never for a Google page");
    // Refusé : l'ancienne phrase, limitée aux pièces gardées.
    expect(frText).not.toContain("Pour une pièce que vous gardez dans vos Envies ou ajoutez à votre Vault et qui n'a qu'une petite image");
    expect(enText).not.toContain("For a piece you keep in your Wishlist or add to your Vault that only has a small image");
  });

  it("couleur des bords : une possibilité tant que EDGE_COLOR_ENABLED n'est allumé que par \"true\" ; une empreinte et la couleur, en mémoire, 7 jours au plus", () => {
    expect(serverEnv).toMatch(/EDGE_COLOR_ENABLED: z\s*\.string\(\)\s*\.optional\(\)\s*\.transform\(\(value\) => value === "true"\)/);
    const fr = section(privacyPolicy, PROVIDERS);
    const en = section(privacyPolicyEn, PROVIDERS_EN);
    expect(fr).toContain("Notre serveur peut aussi télécharger, de la même façon, la petite image d'une pièce proposée, chez Google ou chez la boutique, pour mesurer la couleur de ses bords");
    expect(en).toContain("Our server may also download, in the same way, the small image of a suggested piece, from Google or from the shop, to measure the colour of its edges");
    expect(fr).toContain("qu'une empreinte de l'adresse de cette petite image avec la couleur mesurée (ou la mention « non mesurable »), 7 jours au plus (1 jour pour « non mesurable »)");
    expect(fr).toContain("Une petite image hébergée par un réseau social, ou qui y renvoie, n'est jamais téléchargée.");
    expect(en).toContain("A small image hosted by a social network, or redirecting to one, is never downloaded.");
    // Refusé : « ne garde que la couleur » (une empreinte de l'adresse est gardée avec elle).
    expect(frText).not.toContain("ne garde que la couleur");
    expect(enText).not.toContain("keeps only the colour");
  });

  it("galerie et appareil : « Proposer ma dernière vidéo » lue sur l'appareil ; carte repliée et aide du zoom gardées sur l'appareil", () => {
    expect(section(privacyPolicy, VIDEOS)).toContain("si vous acceptez « Proposer ma dernière vidéo », l'app repère sur votre appareil la vidéo la plus récente de votre galerie, avec l'accès complet à vos photos que vous demande iOS");
    expect(section(privacyPolicyEn, VIDEOS_EN)).toContain("if you accept “Suggest my latest video”, the app finds on your device the most recent video in your gallery, with the full access to your photos that iOS asks you for");
    expect(fr.settings.latestVideoTitle).toBe("Proposer ma dernière vidéo");
    expect(en.settings.latestVideoTitle).toBe("Suggest my latest video");
    const device = section(privacyPolicy, "Sur votre téléphone ou dans votre navigateur");
    expect(device).toContain("le fait que vous avez replié la carte « Votre dernière vidéo »");
    expect(device).toContain("le fait que l'aide « Pincez pour zoomer » vous a déjà été montrée");
    expect(fr.common.zoomHint).toBe("Pincez pour zoomer");
    expect(en.common.zoomHint).toBe("Pinch to zoom");
    // Refusé : plus aucune politique muette sur la galerie.
    expect(frText).toMatch(/galerie/);
    expect(enText).toMatch(/gallery/);
  });

  it("phrases d'écran du lecteur relues : gardées mot pour mot, vraies avec la politique", () => {
    expect(fr.player.privacy("TikTok")).toBe("Vidéo lue par TikTok, sans téléchargement. Seule l'image de ce moment est envoyée, puis effacée de votre téléphone.");
    expect(fr.player.privacyFrame("TikTok")).toBe("Vidéo lue par TikTok. Pour l'image de ce moment, notre serveur demande la vidéo publique à TikTok, sans votre identité, et ne la garde pas. À défaut, seule l'image prise sur votre téléphone est envoyée, puis effacée de votre téléphone.");
    expect(en.player.privacyFrame("TikTok")).toBe("Video played by TikTok. For the image of this moment, our server requests the public video from TikTok, without your identity, and does not keep it. Failing that, only the frame taken on your phone is sent, then deleted from your phone.");
    expect(fr.player.firstPlay.lineLead("TikTok")).toBe("En touchant Lecture, la vidéo est chargée chez TikTok, qui reçoit votre adresse IP et peut utiliser ses propres traceurs. Modifiable dans ");
  });
});
