// Privacy policy — English version (lot 3). A TRANSLATION of the French draft
// (confidentialite.ts), itself a draft: both must be reviewed by a legal
// professional. The error-report, usage-statistics and transfer paragraphs
// reuse the text prepared at lot 2 (docs/lot-2-politique-en.md). Same
// version number as the French text: any change must be made to both.
// Version "projet-2026-11-05": the retailer search and "What are you looking
// for?" are described with their switches on (lawyer document, 2026-11-05).
// Lot 2 (price and stock alerts, 2026-11-09): a "[To be verified]" paragraph
// added WITHOUT changing LEGAL_DOCUMENT_VERSIONS (founder's instruction): the
// new version will be dated after review, before alerts go live.
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
          "Your Vault is visible to you alone. So is your Wishlist, except the wishes you put in a collection shown to your friends.",
          "The image you submit for analysis is deleted from our servers as soon as the result is known.",
          "If you import a video, it stays on your device: only the frame you choose from it is sent — or, if you accept automatic analysis, a few reduced frames from the video, analyzed by an AI and never kept by Spotto.",
          "To widen the results, Spotto may look for the same piece at other retailers: an AI reads the titles and site names of the first results, never your image or your words, and writes a short search. If you start “What are you looking for?”, your words are sent to a search engine, without your name or email address.",
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
        "Your searches (Spotter): the image or link (TikTok, Instagram, Pinterest) you submit, the area you select, then the suggested results (name of the piece, image, price, retailer, link), including those found at other retailers or with your words, with their origin. Your search history is shown back to you (“Recently spotted”); it is kept for 12 months (see “How long”). Under a photo, the words you type are only used to sort the suggestions: our server does not send them with the image to the visual search, and does not save them. When nothing reliable is found, Spotto may ask you, on the results screen, “What are you looking for?”. If you start this search, the words in the field (it may already contain those typed under the photo; you can change them) are sent by our server to SerpApi, then to Google Shopping (see “Our providers and third-party services”). Spotto does not save these words: not with the search, not in the server's logs, not in its cache (see “How long”). It only keeps the time and outcome of this search, and the pieces found, saved with the search like the other results. To complete the results, Spotto may also look for the same piece at other retailers: an AI (Anthropic) reads the titles and site names of the first results, never your image or your words, and writes a short search, sent to Google Shopping through SerpApi. Searches made up to 27 October 2026 keep any text you had added, until they are deleted (see “How long”). If you import a video (60 seconds and 100 MB at most), it is read only on your device: the video is never sent to our servers nor kept by Spotto; only the chosen frame is sent, like a photo. If you accept automatic analysis, your device picks up to 12 sharp frames from the video, reduced (512 pixels on a side), and sends them with your description to our server, which passes them on to Anthropic to find the best moments and the piece (see “Our providers and third-party services”). These frames and your description are never saved by Spotto: our server deletes them as soon as the answer arrives.",
        "Your Vault and your Wishlist: the pieces you add to them (name, category, photo, link to the original piece).",
        "Your posts and interactions: photos, captions, chosen visibility, comments, likes, notifications, blocked accounts and the reports you make.",
        "Your private messages: the text of your messages, the wish you attach to them (its title, price, link to the shop and a copy of its image made by Spotto), their date, and the state of your conversations (invitation sent, accepted or declined, messages read). Only you and the person you are talking with can see them. The moderation team only reads reported messages, with a few messages around them to understand the context. They are kept until your account is deleted, or the account of the person you are talking with: the conversation then disappears for both of you. [To be verified: legal basis retained (performance of the contract), retention period, and information given to the person who receives an invitation.]",
        "Your Wishlist collections: their name, who can see them and the wishes you put in them. A collection stays private until you choose “My friends”. Your friends, meaning members you follow who follow you back, then see its name and, for each wish, its title, a copy of its image made by Spotto, its price and the link to the shop; never your notes. An account blocked either way sees nothing. The copy of the image is deleted as soon as the wish is no longer shown to your friends, and everything goes when you delete your account. A friend can report a collection: the moderation team then sees its name and its latest wishes (title and image copy), and can hide it from your friends or remove an image copy; you are notified, with the reason. [To be verified: legal basis retained (performance of the contract), and information given to the friends who see these collections.]",
        "Your price and stock alerts: the wishes whose bell you turn on and what you choose to follow (price drop, back in stock), the “Price and stock alerts” switch in Settings (off by default) and your “No longer available” reports. To detect a price drop or a return to stock at the same shop, the results of searches and purchases made in Spotto, and members' “No longer available” reports, are compared with the wishes saved by other members. Nobody is identified to anyone: an alert never says who searched for, bought or reported the piece, nor who else follows it, and Spotto keeps neither the author of the search, nor the buyer, nor the author of the report with an alert. For each wish, Spotto only keeps a fingerprint of the piece (never its link), the name of the shop, the reference price and the last price seen (with their currency and the country of the search), the stock status and their dates to the day, until you remove the wish or delete your account. Alerts are deleted after 30 days; so are your “No longer available” reports (they are used to limit abuse and appear in the export of your data). If you receive alert notifications on your iPhone, each one goes through Expo (650 Industries, Inc., United States), then Apple's notification service (Apple Inc., United States); it contains “Spotto”, the title of the piece, the shop and the price (or “3 of your wishes have news”) and an identifier of the wish, never the name of another member. [To be verified: legal basis chosen (performance of the contract, or legitimate interest for the comparison with other members' wishes), information of the members whose searches and purchases are used for this comparison, retention periods, and a new dated version of this policy before alerts go live.]",
        "Your clicks to retailers: the piece concerned, the place in the app you clicked from, the date, and the technical identification of your browser or phone (“user agent”).",
        "Your consents: the date and version of the documents you accepted, your declaration that you are at least 15 years old, and your choices (consent, refusal or withdrawal) for usage statistics and automatic video analysis.",
        "Technical data: like any web server, ours receives your IP address and technical information with each request; they appear in its logs, used for security and to fix errors.",
        "Error reports: when an error occurs in the app or on our server, a technical report is created (type of error, screen or feature concerned, browser type, or phone model and system version) together with the internal identifier of your account — never your name, email address, content, or the parameters of the addresses you visited. If the iPhone app closes unexpectedly (crash), the report also contains a pseudonymous installation identifier: a code specific to your phone and the app, which contains neither your name nor your email address.",
        "Usage statistics, ONLY if you agree (optional box, unticked by default): the actions you take in the app (for example starting a search, adding a piece, publishing, commenting, following an account), with only the internal identifier of your account and a few predefined details (category, chosen visibility, number of results…). Never your name, email address, the words you type, the text of your comments or captions, or the addresses of your images.",
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
          "Automatically analyzing a video (a few reduced frames sent to Anthropic): your consent, asked the first time you use it, which you can withdraw at any time (Settings → Your data). Without it, no frame is sent: you choose the frame yourself.",
          "Looking for the same piece at other retailers (titles and site names of the first results sent to Anthropic, short search sent to SerpApi and Google): performance of the contract between us. This sending contains no image and does not depend on your consent to video analysis. [To be verified: performance of the contract or legitimate interest.]",
          "Searching with your words, when you start “What are you looking for?”: performance of the contract between us, at your request. [To be verified: basis retained.]",
          "Keeping for 24 hours, with no link to your account, the answers already obtained, so as not to run the same searches again and to answer faster: our legitimate interest. [To be verified: basis retained.]",
        ],
        "[To be verified: legal bases retained, to be reviewed by a legal professional — in particular the legitimate interest relied on for error reports, and the basis relied on for sending the titles of the results to Anthropic without consent.]",
      ],
    },
    {
      title: "Who can see what in Spotto",
      blocks: [
        [
          "Your Vault: you alone. Your Wishlist: you alone, except the wishes you put in a collection shown to your friends.",
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
          "SerpApi (SerpApi, LLC, United States): receives a temporary link (valid for 5 minutes) to the image to be analyzed; it passes it to Google's visual search (Google Lens, Google LLC, United States), which downloads the image to find matching pieces. If the same image, with the same framing, has already been analyzed within the last 24 hours, the stored answer may be reused without sending it again (see “How long”). To look for the piece at other retailers, SerpApi also receives, as text, the short search written by the AI (see Anthropic below) and, if you start “What are you looking for?”, your words; it passes them to Google Shopping (Google LLC, United States). Each request also states the country and language of the search: France and French if the app is in French; if it is in English, your device's region (or, failing that, the United States). These requests are sent by our server, without your name, your email address or your IP address. No identifier of your account is passed to them.",
          "Sentry (Functional Software, Inc., United States): error reports from the app and the server. Data hosted in the European Union (Frankfurt, Germany).",
          "PostHog (PostHog Inc., United States): usage statistics, only with your consent. Data hosted in the European Union (Frankfurt, Germany).",
          "Expo (650 Industries, Inc., United States): if you turn on message notifications on your iPhone, our server hands each notification to Expo, which passes it on to Apple's notification service (Apple Inc., United States) so it shows on your iPhone. A notification only contains “Spotto”, the username of the person writing to you (for example “New message from @alexis”) and an identifier of the conversation, never the text of the message or the attached wish. For this, Spotto keeps your device's technical address, deleted when you turn notifications off, when you sign out or when you delete your account. [To be verified: Expo's role (processor), safeguards for this transfer to the United States, and retention periods at Expo and Apple.]",
          "Anthropic (Anthropic, PBC, United States): its AI (Claude) is used for two things. If you accept automatic video analysis, it receives from our server up to 12 reduced frames from the video and your description, and indicates the best moments and where the piece is. To look for the piece at other retailers, it also receives from our server, during your searches where the visual search found pieces, the titles and site names of the first 15 results (for example “Example Brand X-200 white leather trainers — shop-b.com”), with the country and language of the search, and writes a short search of 2 to 8 words. For this, it receives no image, no price and none of your words, and this sending does not depend on your choice about video analysis. No other data about you (name, email, identifier) is sent to it. Anthropic acts on our behalf, as a processor, under its data processing agreement. What its terms and documentation provide: it may not train its models on this data; it automatically deletes it from its systems no later than 30 days after receiving it, and for the model used, it does not retain it by default. Exceptions: a legal obligation, or content flagged by its automated safety checks, which it may then keep for up to 2 years (and the scores assigned by these checks for up to 7 years). Its data is stored in the United States; the analysis itself may take place in another country where Anthropic runs its models. [To be verified: that the data processing agreement and these terms also apply to sending the titles (same account, same model).]",
        ],
        "When you paste a TikTok or Instagram link, our server asks TikTok or Meta for the public preview of the video: only the link is sent to them, never your identity.",
        "Images of suggested pieces are displayed directly from retailers' and Google's websites. Your phone or browser downloads them from those sites, which therefore receive your IP address and the usual technical information of a web request. When you open a link to a retailer, you leave Spotto: its own privacy policy applies. Among the pieces found at other retailers or with your words, when Google provides no direct link to the retailer, “View offer” opens the piece's page on Google: Google's privacy policy then applies.",
        "Finally, we may disclose data to the authorities where the law requires us to.",
      ],
    },
    {
      title: "Transfers outside the European Union",
      blocks: [
        "Some data leaves, or may leave, the European Union:",
        [
          "the image you submit for analysis: sent to SerpApi and then to Google, in the United States;",
          "the short search written by the AI and, if you start “What are you looking for?”, your words, with the country and language of the search: sent to SerpApi and then to Google (Google Shopping), in the United States;",
          "the titles and site names of the first results, with the country and language of the search: sent to Anthropic, in the United States, and which may be processed in other countries where Anthropic runs its models;",
          "if you accept automatic video analysis: the reduced frames and your description, sent to Anthropic, in the United States, which may be processed in other countries where Anthropic runs its models;",
          "data passing through our server (each request from the app, with your IP address, and the data you view or send): the server is located in the European Union (Frankfurt), but as Render is a US company, access from the United States (maintenance, support) cannot be ruled out; the same applies to the server's technical logs (IP address, request information), kept by Render (see “How long”);",
          "data hosted by Supabase: stored in Ireland, but as Supabase is a company established in Singapore, access from outside the European Union (maintenance, support) cannot be ruled out;",
          "your IP address: received by retailers' websites and by Google when the app displays their images, wherever they are established;",
          "error reports (Sentry) and, if you accept them, usage statistics (PostHog): stored in the European Union (Frankfurt), but as these are US companies, access from the United States (maintenance, support) cannot be ruled out. Sentry states that it participates in the EU–US Data Privacy Framework.",
        ],
        "[To be verified: safeguards covering each of these transfers — the company's Data Privacy Framework certification, or the European Commission's standard contractual clauses signed with it — and the position of Google, which receives the image and the search texts through SerpApi without a direct contract with the publisher. Anthropic: standard contractual clauses (modules 2 and 3) provided for in its data processing addendum; Data Privacy Framework certification not mentioned in that addendum; to be confirmed for sending the titles of the results.]",
      ],
    },
    {
      title: "How long",
      blocks: [
        [
          "The image you submit for analysis: deleted from our servers as soon as the search responds, whether it succeeded or not (a few seconds).",
          "Reduced frames from a video sent for automatic analysis: never saved by Spotto; our server keeps them in memory while waiting for the answer (a few seconds), then deletes them. At Anthropic: see “Our providers and third-party services”.",
          "The words of “What are you looking for?”: never saved by Spotto; our server keeps them in memory while the search runs (a few seconds), then deletes them. At SerpApi and Google: [To be verified: retention period of search texts].",
          "Answers already obtained (cache): so as not to run the same searches again, our server keeps the answers of the visual search, the AI and the retailer search (pieces found, short search written by the AI), with the country and language of the search. Those of the visual search are filed under a fingerprint of the cropped image: a code from which the image cannot be rebuilt, the image itself never being kept. These answers are linked neither to your account nor to your search, and your words never go into them. If you, or someone else, run the same image again with the same framing, language and country within 24 hours, they are reused. Each answer stops being used after 24 hours, then is deleted at the next search started on Spotto.",
          "Your search history (except the analyzed image, see above), with all the suggested pieces, including those found at other retailers or with your words: 12 months. Older searches are deleted, together with their results and the clicks to retailers that depend on them, at your next search. Exception: a search from which you kept a piece (Vault, Wishlist, piece shown in a post) is kept for as long as that piece is.",
          "Your account and everything attached to it: for as long as your account exists.",
          "An account with no sign-in for 3 years is deleted, with all its data. An email warns you before deletion.",
          "The server's technical logs: [To be verified: retention period at our hosting provider].",
          "Error reports (Sentry) and usage statistics (PostHog): [To be verified: retention periods of these services for our plan, and the period to retain].",
        ],
        "When you delete your account, your data and photos are erased immediately and permanently: profile, searches, Vault, Wishlist, collections, posts, comments, likes, follows, notifications, clicks to retailers, consents. Cached answers, which are linked to no account, are not affected: they are deleted on their own (see above).",
      ],
    },
    {
      title: "On your phone or in your browser",
      blocks: [
        "Spotto stores on your device your sign-in session, so that you do not have to sign in again, a copy of images already displayed, to show them faster, the fact that you have already seen an update notice, so as not to show it again, and the language and theme (light, dark or your device's) you have chosen. These items are essential for the app to work. While you choose a frame from a video, or while automatic analysis uses it, the iPhone app keeps a temporary copy of the video, deleted as soon as you leave the search; the small frames prepared for automatic analysis are deleted as soon as they are sent. On the website, the video is read by your browser without being copied.",
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
          "Accept or withdraw automatic video analysis: Settings → Your data.",
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
