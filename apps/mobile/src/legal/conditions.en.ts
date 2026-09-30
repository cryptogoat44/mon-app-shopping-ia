// Terms of use — English version (lot 3). A TRANSLATION of the French draft
// (conditions.ts), itself a draft: both must be reviewed by a legal
// professional. Same publisher variables, same version number
// (LEGAL_DOCUMENT_VERSIONS): any change to one text must be made to the other.
import { HOSTS_EN, PUBLISHER_EN } from "./publisher";
import type { LegalDocument } from "./types";

export const termsOfUseEn: LegalDocument = {
  type: "terms",
  title: "Terms of use",
  sections: [
    {
      title: "Who publishes Spotto",
      blocks: [
        `Spotto is published by ${PUBLISHER_EN.name}, ${PUBLISHER_EN.status}, ${PUBLISHER_EN.address}.`,
        `Publication director: ${PUBLISHER_EN.name}.`,
        `Contact: ${PUBLISHER_EN.email} — telephone: ${PUBLISHER_EN.phone}.`,
        `Server and website hosting: ${HOSTS_EN.render}.`,
        `Data and photo hosting: ${HOSTS_EN.supabase}; data stored in Ireland.`,
      ],
    },
    {
      title: "Purpose",
      blocks: [
        "These terms govern your use of Spotto, in the app and on the website. By creating your account, you accept them, together with the privacy policy.",
      ],
    },
    {
      title: "Your account",
      blocks: [
        [
          "You must be at least 15 years old to create an account. You confirm this when signing up; no age verification is carried out.",
          "The information you provide must be accurate. Your password is personal: keep it confidential.",
          "You can delete your account at any time: Settings → Delete my account. Deletion is immediate and permanent.",
          "An account with no sign-in for 3 years is deleted, after a warning email.",
        ],
      ],
    },
    {
      title: "What Spotto does",
      blocks: [
        "From an image or a link you submit, Spotto suggests fashion pieces that resemble it. These suggestions come from an automated visual search: they may be inaccurate or incomplete, and a suggested piece is not necessarily the one in the image.",
        "Prices, availability and details shown come from retailers and may have changed: only the information on the retailer's website is authoritative.",
        "Spotto sells nothing. If you buy a piece, you do so directly from the retailer, under its own terms; Spotto is not a party to that purchase.",
        "The number of identifications may be limited over time, to keep the service available to everyone.",
      ],
    },
    {
      title: "Links to retailers",
      blocks: [
        "Links marked “Affiliate link” may, in the future, earn Spotto a commission when you make a purchase, at no extra cost to you. As of this version, no affiliate program is active: Spotto receives no commission.",
      ],
    },
    {
      title: "Your content",
      blocks: [
        "You remain the owner of the photos, texts and comments you publish. So that Spotto can host them and show them to the people you have chosen, you grant the publisher, free of charge and worldwide, the right to store, reproduce (including in reduced size) and display them within Spotto, according to the visibility you have chosen. This right ends when you delete the content or your account.",
        "You guarantee that you hold the necessary rights to what you publish, in particular the consent of any recognizable person in your photos.",
      ],
    },
    {
      title: "Rules of conduct",
      blocks: [
        "You may not publish or send:",
        [
          "illegal, hateful, violent, discriminatory or sexual content;",
          "harassment, threats or insults;",
          "photos of a person without their consent, or personal information about others;",
          "content that infringes the rights of others (copyright, trademarks, image rights);",
          "spam, scams or unsolicited advertising.",
        ],
        "You may also not use Spotto in an automated way (bots, mass data collection) or attempt to circumvent its protections.",
      ],
    },
    {
      title: "Reporting, blocking, moderation",
      blocks: [
        "You can report a post, a comment or an account, and block an account: it no longer sees your posts or your profile, and you no longer see theirs.",
        "The publisher reviews reports and may remove content that breaches these terms or the law, and suspend or delete the account concerned. [To be completed: processing times, and how the author of the content and the author of the report are informed of the decision and its reasons.]",
      ],
    },
    {
      title: "Intellectual property",
      blocks: [
        "The Spotto name, the app, its design and its texts belong to the publisher. Images and names of suggested pieces belong to their owners (brands, retailers); they are displayed from their own websites.",
      ],
    },
    {
      title: "Availability and liability",
      blocks: [
        "The publisher strives to keep Spotto available and reliable, but the service may be interrupted, in particular for maintenance, and may change. [To be verified: liability clauses, to be reviewed by a legal professional.]",
        "The publisher is not responsible for retailers' websites or for the purchases you make there.",
      ],
    },
    {
      title: "Suspension of your account",
      blocks: [
        "In the event of a serious or repeated breach of these terms, the publisher may suspend or delete your account. [To be completed: prior notice and appeal procedure.]",
      ],
    },
    {
      title: "Changes",
      blocks: [
        "These terms may change. Each version is dated; the app records the version you accepted and tells you, in Settings, when a new version is in force.",
      ],
    },
    {
      title: "Governing law and disputes",
      blocks: [
        `These terms are governed by French law. In the event of a dispute, please contact us first: ${PUBLISHER_EN.email}. [To be verified: consumer mediator, if any, and competent court.]`,
      ],
    },
  ],
};
