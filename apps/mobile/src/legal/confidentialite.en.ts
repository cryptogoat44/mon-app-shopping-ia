// Privacy policy — English version (lot 3). A TRANSLATION of the French draft
// (confidentialite.ts), itself a draft: both must be reviewed by a legal
// professional. The error-report, usage-statistics and transfer paragraphs
// reuse the text prepared at lot 2 (docs/lot-2-politique-en.md). Same
// version number as the French text: any change must be made to both.
import { PUBLISHER_EN } from "./publisher";
import type { LegalDocument } from "./types";

export const privacyPolicyEn: LegalDocument = {
  type: "privacy_policy",
  title: "Privacy policy",
  sections: [
    {
      title: "In short",
      blocks: [
        "Spotto helps you identify fashion pieces from an image, keep the ones you own in your Vault, and share your posts with the people of your choice.",
        [
          "We do not sell your data and show no advertising.",
          "Your Vault and your Wishlist are visible to you alone.",
          "The image you submit for analysis is deleted from our servers as soon as the result is known.",
          "Sharing usage statistics is optional, and can be withdrawn at any time.",
          "You can download your data or delete your account at any time, from Settings.",
        ],
      ],
    },
    {
      title: "Who is responsible for your data",
      blocks: [
        `The data controller is the publisher of Spotto: ${PUBLISHER_EN.name}, ${PUBLISHER_EN.status}, ${PUBLISHER_EN.address}.`,
        `For any question about your data, or to exercise your rights: ${PUBLISHER_EN.email}.`,
      ],
    },
    {
      title: "The data we use",
      blocks: [
        "Your account: your email address and your password. The password is never stored in plain text: we do not know it.",
        "Your profile: username, display name, bio, profile photo, your followers and the accounts you follow.",
        "Your searches (Spotter): the image or link (TikTok, Instagram, Pinterest) you submit, the area you select, any text you add, then the suggested results (name of the piece, image, price, retailer, link). Your search history is shown back to you (“Recently spotted”); it is kept for 12 months (see “How long”).",
        "Your Vault and your Wishlist: the pieces you add to them (name, category, photo, link to the original piece).",
        "Your posts and interactions: photos, captions, chosen visibility, comments, likes, notifications, blocked accounts and the reports you make.",
        "Your clicks to retailers: the piece concerned, the place in the app you clicked from, the date, and the technical identification of your browser or phone (“user agent”).",
        "Your consents: the date and version of the documents you accepted, and your declaration that you are at least 15 years old.",
        "Technical data: like any web server, ours receives your IP address and technical information with each request; they appear in its logs, used for security and to fix errors.",
        "Error reports: when an error occurs in the app or on our server, a technical report is created (type of error, screen or feature concerned, browser type) together with the internal identifier of your account — never your name, email address, content, or the parameters of the addresses you visited.",
        "Usage statistics, ONLY if you agree (optional box, unticked by default): the actions you take in the app (for example starting a search, adding a piece, publishing, commenting, following an account), with only the internal identifier of your account and a few predefined details (category, chosen visibility, number of results…). Never your name, email address, the text of your comments or captions, or the addresses of your images.",
        "The photos you send are resized and stripped of their metadata, including any GPS location recorded by your phone.",
      ],
    },
    {
      title: "Why, and on what basis",
      blocks: [
        [
          "Providing the service you request (account, identification of pieces, Vault, Wishlist, posts, follows, notifications): performance of the contract between us (the terms of use).",
          "Keeping the service secure, preventing abuse and handling reports: our legitimate interest.",
          "Measuring clicks to retailers, to understand which pieces are of interest and, once affiliate links are active, to calculate commissions: our legitimate interest.",
          "Keeping proof of your acceptance of the documents: our obligation to be able to demonstrate it.",
          "Detecting and fixing errors (error reports): our legitimate interest in keeping the service working properly.",
          "Understanding how Spotto is used in order to improve it (usage statistics): your consent, which you can withdraw at any time (Settings → Your data); withdrawal stops collection immediately.",
        ],
        "[To be verified: legal bases retained, to be reviewed by a legal professional — in particular the legitimate interest relied on for error reports.]",
      ],
    },
    {
      title: "Who can see what in Spotto",
      blocks: [
        [
          "Your Vault and your Wishlist: you alone.",
          "Your posts: according to the visibility you choose for each one — everyone, your followers, or you alone. You can change it at any time.",
          "Your profile (username, display name, photo, bio, number of followers and accounts followed): other users, except those you have blocked.",
        ],
        "Photos are stored at a long, random web address that cannot be guessed. However, someone who was able to see a photo and kept its address can continue to open it, even if you later change the visibility of the post.",
      ],
    },
    {
      title: "Our providers and third-party services",
      blocks: [
        "We use providers that process data on our behalf, solely to operate Spotto:",
        [
          "Supabase (Supabase Pte. Ltd., Singapore): database, photo storage and authentication. Your data is hosted there in the European Union (Ireland).",
          "Render (Render Services, Inc., United States): hosting of our server, located in the European Union (Frankfurt, Germany), and of the website. All requests from the app go through this server.",
          "SerpApi (SerpApi, LLC, United States): receives a temporary link (valid for 5 minutes) to the image to be analyzed, and any text you added; it passes them to Google's visual search (Google Lens, Google LLC, United States), which downloads the image to find matching pieces. No other data about you (name, email, identifier) is passed to them.",
          "Sentry (Functional Software, Inc., United States): error reports from the app and the server. Data hosted in the European Union (Frankfurt, Germany).",
          "PostHog (PostHog Inc., United States): usage statistics, only with your consent. Data hosted in the European Union (Frankfurt, Germany).",
        ],
        "When you paste a TikTok or Instagram link, our server asks TikTok or Meta for the public preview of the video: only the link is sent to them, never your identity.",
        "Images of suggested pieces are displayed directly from retailers' and Google's websites. Your phone or browser downloads them from those sites, which therefore receive your IP address and the usual technical information of a web request. When you open a link to a retailer, you leave Spotto: its own privacy policy applies.",
        "Finally, we may disclose data to the authorities where the law requires us to.",
      ],
    },
    {
      title: "Transfers outside the European Union",
      blocks: [
        "Some data leaves, or may leave, the European Union:",
        [
          "the image you submit for analysis and any text you add: sent to SerpApi and then to Google, in the United States;",
          "data passing through our server (each request from the app, with your IP address, and the data you view or send): the server is located in the European Union (Frankfurt), but as Render is a US company, access from the United States (maintenance, support) cannot be ruled out; the same applies to the server's technical logs (IP address, request information), kept by Render (see “How long”);",
          "data hosted by Supabase: stored in Ireland, but as Supabase is a company established in Singapore, access from outside the European Union (maintenance, support) cannot be ruled out;",
          "your IP address: received by retailers' websites and by Google when the app displays their images, wherever they are established;",
          "error reports (Sentry) and, if you accept them, usage statistics (PostHog): stored in the European Union (Frankfurt), but as these are US companies, access from the United States (maintenance, support) cannot be ruled out. Sentry states that it participates in the EU–US Data Privacy Framework.",
        ],
        "[To be verified: safeguards covering each of these transfers — the company's Data Privacy Framework certification, or the European Commission's standard contractual clauses signed with it — and the position of Google, which receives the image through SerpApi without a direct contract with the publisher.]",
      ],
    },
    {
      title: "How long",
      blocks: [
        [
          "The image you submit for analysis: deleted from our servers as soon as the search responds, whether it succeeded or not (a few seconds).",
          "Your search history (except the analyzed image, see above): 12 months. Older searches are deleted, together with their results and the clicks to retailers that depend on them, at your next search. Exception: a search from which you kept a piece (Vault, Wishlist, piece shown in a post) is kept for as long as that piece is.",
          "Your account and everything attached to it: for as long as your account exists.",
          "An account with no sign-in for 3 years is deleted, with all its data. An email warns you before deletion.",
          "The server's technical logs: [To be verified: retention period at our hosting provider].",
          "Error reports (Sentry) and usage statistics (PostHog): [To be verified: retention periods of these services for our plan, and the period to retain].",
        ],
        "When you delete your account, your data and photos are erased immediately and permanently: profile, searches, Vault, Wishlist, posts, comments, likes, follows, notifications, clicks to retailers, consents.",
      ],
    },
    {
      title: "On your phone or in your browser",
      blocks: [
        "Spotto stores on your device your sign-in session, so that you do not have to sign in again, a copy of images already displayed, to show them faster, the fact that you have already seen an update notice, so as not to show it again, and the language and theme (light, dark or your device's) you have chosen. These items are essential for the app to work.",
        "Spotto uses no advertising trackers and no advertising cookies. Usage statistics, if you accept them, are sent directly, without cookies or storage on your device, and without IP-based geolocation.",
      ],
    },
    {
      title: "Your rights",
      blocks: [
        "You have the right to access, rectify, erase, restrict, object to and port your data, as well as the right to set instructions for what happens to it after your death.",
        [
          "Download all your data (machine-readable file): Settings → Export my data.",
          "Correct your profile: Settings → Edit profile.",
          "Erase everything: Settings → Delete my account.",
          "Accept or withdraw the sharing of usage statistics: Settings → Your data.",
          `For any other request: ${PUBLISHER_EN.email}.`,
        ],
        "If you believe your rights are not being respected, you can lodge a complaint with the CNIL, the French data protection authority (cnil.fr).",
      ],
    },
    {
      title: "Minimum age",
      blocks: [
        "Spotto is reserved for people aged at least 15. You confirm this when signing up, and this declaration is recorded with its date; no age verification is carried out.",
      ],
    },
    {
      title: "Security",
      blocks: [
        "Exchanges with Spotto are encrypted (HTTPS). Every access is checked by our server: ownership of content, chosen visibility, blocked accounts. Passwords are never stored in plain text.",
      ],
    },
    {
      title: "Changes",
      blocks: [
        "We may update this policy. Each version is dated, and the app records the version you accepted. When a change requires your agreement, the app tells you in Settings. When it is simply for your information (for example a change of hosting location), a short message lets you know, with a link to this page. [To be verified: which changes require a new acceptance, and which are simply for information.]",
      ],
    },
  ],
};
