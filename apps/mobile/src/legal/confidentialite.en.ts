// Privacy policy — English version (lot 3). A TRANSLATION of the French draft
// (confidentialite.ts), itself a draft: both must be reviewed by a legal
// professional. The error-report, usage-statistics and transfer paragraphs
// reuse the text prepared at lot 2 (docs/lot-2-politique-en.md). Same
// version number as the French text: any change must be made to both.
// Version "projet-2026-11-05": the retailer search and "What are you looking
// for?" are described with their switches on (lawyer document, 2026-11-05).
// Policy lot (2026-11-15, branch lot-politique-confidentialite): text updated
// WITHOUT changing LEGAL_DOCUMENT_VERSIONS (founder's instruction; the date
// shown comes from that version and will change with it, on publication,
// after the lawyer's review): new version of price and stock alerts (0040,
// 0041); videos — collective memory (0038, 0039), short links, players,
// iPhone image search, automatic analysis of a link by the video service; the
// old "cover" path (preview asked from TikTok or Meta) is gone from the text.
// Analyse d'un lien et consentement « analyse_video_ia » : même règle que le
// texte français (confidentialite.ts) — nouvelle version du consentement,
// qui couvre les vidéos du téléphone et les liens ; l'ancienne version reste
// valable pour une vidéo du téléphone, la nouvelle est exigée pour un lien ;
// faite côté app (branche lot-video-auto), dans la même mise en ligne.
// Lot prix vidéo (2026-11-17, branch lot-prix-video), still WITHOUT changing
// LEGAL_DOCUMENT_VERSIONS: same facts as the French text — for a search
// started from a video link, when no result shows a price, the description
// written for the analysis is sent automatically, once, to SerpApi and then
// Google Shopping ("What are you looking for?" started by the app).
// Journey measurement lot (2026-11-21, branch lot-mesure-parcours), still
// WITHOUT changing LEGAL_DOCUMENT_VERSIONS: same fact as the French text —
// usage statistics also cover the steps of the journey and waiting times
// ("The data we use"); nothing else changes.
// Suggestions lot (2026-11-21, branch lot-propositions-pieces), still WITHOUT
// changing LEGAL_DOCUMENT_VERSIONS: same facts as the French text — for a
// video link, the AI may suggest, with nothing written, the names of up to 3
// visible pieces ("Videos" section); what you write becomes optional ("where
// applicable"), and the name of the chosen piece follows the path of the
// description (sorting the suggestions, then SerpApi and Google Shopping when
// nothing has a price): In short, data, bases, "Videos" section, providers,
// transfers and how long.
// Journey 3 (2026-11-21, branch lot-achat-alerte), still WITHOUT changing
// LEGAL_DOCUMENT_VERSIONS: same facts as the French text — "Save" turns on
// the piece's price-drop alert (In short, bases, "Price and stock alerts");
// "Price drop" in the app; "Did you buy it?": its memory on the device and
// usage statistics.
// Visible alerts (2026-11-22, branch lot-alertes-visibles), still WITHOUT
// changing LEGAL_DOCUMENT_VERSIONS: one more paragraph in "Price and stock
// alerts" (updates at the top of the Wishlist, "seen" noted on the device);
// their two counts in usage statistics ("The data we use", and the exception
// added after "What our database keeps").
// Website-only features are added by src/legal-extra (.web version), never
// written here (this file also ships in the iPhone app).
import { APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import { privacyExtraEn } from "../legal-extra/confidentialite-extra";
import { PUBLISHER_EN } from "./publisher";
import type { LegalDocument, PrivacyExtra } from "./types";

const VIDEOS = "Videos from your phone, TikTok and Instagram";
const ALERTS = "Price and stock alerts";

/** The policy, with the platform's own additions (none in the iPhone app;
 * the website's come from src/legal-extra). */
export function buildPrivacyPolicyEn(extra: PrivacyExtra): LegalDocument {
  return {
    type: "privacy_policy",
    title: "Privacy policy",
    sections: [
      {
        title: "In short",
        blocks: [
          `${BRAND} helps you identify fashion pieces from an image, keep the ones you own in your Vault, and share your posts with the people of your choice.`,
          [
            "We do not sell your data and show no advertising.",
            "Your Vault is visible to you alone, unless you choose to show it to your friends. So is your Wishlist, unless you choose to show it to your friends, and except the wishes you put in a collection shown to your friends.",
            "The image you submit for analysis is deleted from our servers as soon as the result is known.",
            `If you import a video from your phone, it stays on your device: only the frame you choose from it is sent — or, if you accept automatic analysis, a few reduced frames from the video, analyzed by an AI and never kept by ${BRAND}.`,
            `If you give the link to a public TikTok or Instagram video and accept automatic analysis, our video service fetches the video just long enough to extract a few frames, analyzed by an AI together with, where applicable, what you wrote. Neither the video, nor these frames, nor your words are kept by ${BRAND}. If the results of the search that follows show no price, what you wrote, or the name of the piece you chose among the AI's suggestions, is also sent automatically to our provider SerpApi, which queries Google Shopping, to find shops, without your name or email address.`,
            "Pieces found in a TikTok or Instagram video may be shown to members who open the same video, once found by at least two members, and never with the name of those who found them.",
            "When you save a piece from your results, its price-drop alert turns on, if the piece can be followed; you can turn it off at any time. By default, your searches and reports also help, without your name, other members' alerts: you can turn this off in Settings.",
            `To widen the results, ${BRAND} may look for the same piece at other retailers: an AI reads the titles and site names of the first results, never your image or your words, and writes a short search. If you start “What are you looking for?”, your words are sent to a search engine, without your name or email address. For a search started from a video link, when no result shows a price, the description you wrote (or the name of the piece you chose among the AI's suggestions) is sent automatically to that search engine, in the same way.`,
            ...extra.summary,
            "Sharing usage statistics is optional, and can be withdrawn at any time.",
            "You can download your data or delete your account at any time, from Settings.",
          ],
        ],
      },
      {
        title: "Who is responsible for your data",
        blocks: [
          `The data controller is the publisher of ${BRAND}: ${PUBLISHER_EN.name}, ${PUBLISHER_EN.status}, ${PUBLISHER_EN.address}.`,
          `For any question about your data, or to exercise your rights: ${PUBLISHER_EN.email}.`,
        ],
      },
      {
        title: "The data we use",
        blocks: [
          "Your account: your email address and your password. The password is never stored in plain text: we do not know it.",
          "Your profile: username, display name, bio, link shown on your profile, profile photo, your followers and the accounts you follow.",
          `Your searches (Spotter): the image you submit, the area you select, the public address of the TikTok or Instagram video the image comes from, where applicable, then the suggested results (name of the piece, image, price, retailer, link), including those found at other retailers or with your words, with their origin. Your search history is shown back to you (“Recently spotted”); it is kept for 12 months (see “How long”). Under a photo, the words you type are only used to sort the suggestions: our server does not send them with the image to the visual search, and does not save them. When nothing reliable is found, ${BRAND} may ask you, on the results screen, “What are you looking for?”. If you start this search, the words in the field (it may already contain those typed under the photo; you can change them) are sent by our server to SerpApi, then to Google Shopping (see “Our providers and third-party services”). For a search started from a TikTok or Instagram video link, if no suggestion shows a price (neither in the visual search nor at other retailers), ${BRAND} starts this search by itself, once, with the description you wrote for the analysis of the video (or the name of the piece you chose among the AI's suggestions): it is sent in the same way, without your name or email address, and the same rules apply (see “${VIDEOS}”). ${BRAND} does not save these words: not with the search, not in the server's logs, not in its cache (see “How long”). It only keeps the time and outcome of this search, and the pieces found, saved with the search like the other results. To complete the results, ${BRAND} may also look for the same piece at other retailers: an AI (Anthropic) reads the titles and site names of the first results, never your image or your words, and writes a short search, sent to Google Shopping through SerpApi. Searches made up to 27 October 2026 keep any text you had added, until they are deleted (see “How long”). For a search made from a video (from your phone, or from a TikTok or Instagram link) and for the pieces spotted in a video, see “${VIDEOS}”.`,
          "Your Vault and your Wishlist: the pieces you add to them (name, category, photo, link to the original piece).",
          "Your posts and interactions: photos, captions, chosen visibility, pinned posts, comments, mentions, tagged people, likes, saved posts, notifications, blocked accounts and the reports you make.",
          `Your private messages: the text of your messages, the wish you attach to them (its title, price, link to the shop and a copy of its image made by ${BRAND}), their date, and the state of your conversations (invitation sent, accepted or declined, messages read). Only you and the person you are talking with can see them. The date you last read each conversation is kept with the conversation. When you open a conversation, the other member can therefore see that you have seen their last message (“Seen”; their app does not receive the time you read it, only the fact that this message has been seen), unless one of you has turned off “Read receipts” in Settings. Only what you read while this setting is on is shown. If you turn it off, “Seen” is no longer displayed; what you read while it is off is never shown later, even if you turn it back on: only what you read from that moment on is. The same goes for the other member's setting: what you read while theirs is off is not shown either, even if they turn it back on. What you read before “Seen” arrived in ${BRAND} is not shown either. To apply this rule, ${BRAND} keeps the date this setting was last turned on. As long as you have not accepted an invitation, the person inviting you sees nothing of the kind. The moderation team only reads reported messages, with a few messages around them to understand the context. They are kept until your account is deleted, or the account of the person you are talking with: the conversation then disappears for both of you. [To be verified: legal basis retained (performance of the contract), retention period, information given to the person who receives an invitation, and the “Seen” mention being on by default.]`,
          `Your Wishlist collections: their name, who can see them and the wishes you put in them. A collection stays private until you choose “My friends”. Your friends, meaning members you follow who follow you back, then see its name and, for each wish, its title, a copy of its image made by ${BRAND}, its price and the link to the shop; never your notes. An account blocked either way sees nothing. The copy of the image is deleted as soon as the wish is no longer shown to your friends, and everything goes when you delete your account. A friend can report a collection: the moderation team then sees its name and its latest wishes (title and image copy), and can hide it from your friends or remove an image copy; you are notified, with the reason. [To be verified: legal basis retained (performance of the contract), and information given to the friends who see these collections.]`,
          `Your Wishlist and your Vault shown to your friends: two settings, “Show my Wishlist to my friends” and “Show my Vault to my friends”, off at first and stored with your profile. Your friends are the members you follow who follow you back: a mere follower, a pending follow request or a blocked account, in either direction, sees nothing, and nothing is shown while your account is suspended. With the Wishlist setting on, your friends see all your wishes, including those in your private collections, without the names of those collections: title, a copy of the image made by ${BRAND}, price, shop name and link to the shop; never your notes, your alerts and their thresholds, the pieces you received, your saved posts or the original search. The copy of an image is deleted when you turn the setting off (unless the wish is in a collection shown to your friends), when you remove the wish, and with your account. With the Vault setting on, your friends see each piece in your Vault, its name, its category and its photo as stored, including a photo you took yourself; an image that comes from a shop is loaded by their device from its original site, as for a purchase post. Never the date you added it, the “Verified purchase” mark or the original search. No notification is sent, and ${BRAND} keeps no record of who looked. Unfollowing, blocking or turning the setting off cuts access at once. Both settings are included in your data export. [To be verified: legal basis retained (performance of the contract), and information given to the friends who see this Wishlist and this Vault.]`,
          `Your price and stock alerts: the wishes whose bell you turn on, what you follow (price drop, back in stock), your price thresholds, your “Price and stock alerts” and “Help other members” settings, and your “No longer available” reports. The details, including what other members see, are in “${ALERTS}”.`,
          "Your clicks to retailers: the piece concerned, the place in the app you clicked from, the date, and the technical identification of your browser or phone (“user agent”).",
          "Your consents: the date and version of the documents you accepted, your declaration that you are at least 15 years old, and your choices (consent, refusal or withdrawal) for usage statistics and automatic video analysis, each with its date and the version of the text shown to you.",
          "Technical data: like any web server, ours receives your IP address and technical information with each request; they appear in its logs, used for security and to fix errors.",
          "Error reports: when an error occurs in the app or on our server, a technical report is created (type of error, screen or feature concerned, browser type, or phone model and system version) together with the internal identifier of your account — never your name, email address, content, or the parameters of the addresses you visited. If the iPhone app closes unexpectedly (crash), the report also contains a pseudonymous installation identifier: a code specific to your phone and the app, which contains neither your name nor your email address.",
          "Usage statistics, ONLY if you agree (optional box, unticked by default): the actions you take in the app (for example starting a search, adding a piece, publishing, commenting, following an account), the steps of the journey and waiting times, with only the internal identifier of your account and a few predefined details (category, chosen visibility, number of results…). Never your name, email address, the words you type, the text of your comments or captions, or the addresses of your images.",
          "If you accept them, usage statistics also count your answers to “Did you buy it?”, the time spent in the shop before coming back and the number of “Price drop” labels shown in your Wishlist.",
          "If you accept them, usage statistics also count the number of updates shown at the top of your Wishlist and the kind (price drop or return to stock) of the one you open; never the piece, the shop, the price or the day.",
          "The photos you send are resized and stripped of their metadata, including any GPS location recorded by your phone.",
          `Your search counters and your subscription status: to apply your search limits (see the terms of use), ${BRAND} counts your searches for the day and the calendar month from your search history; no other counter is stored. If you have a subscription, ${BRAND} keeps its type, its end date, where the information came from and the date it was last updated, only to know which limits apply to your account. Your subscription status and your counters for the month are included in your data export.`,
          `Your look pages: if you share the look of a piece, the page that anyone with the link sees (the piece's name, shops, prices and stock seen on the day of the search, a copy of the image made by ${BRAND}), its creation and expiry dates.`,
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
            `Understanding how ${BRAND} is used in order to improve it (usage statistics): your consent, which you can withdraw at any time (Settings → Your data); withdrawal stops collection immediately.`,
            "Automatically analyzing a video from your phone or the link to a TikTok or Instagram video (a few reduced frames and, where applicable, your description, sent to Anthropic): your consent, asked the first time you use it and again when its text changes, which you can withdraw at any time (Settings → Your data). Without it, no video is fetched and no frame is sent: you choose the frame yourself, or take a screenshot.",
            "Showing TikTok's or Instagram's official player in the iPhone app: your agreement, asked before it is first shown, which you can withdraw at any time (Settings → Your data).",
            "Showing members who open the same video the pieces already spotted by at least two members, without saying who found them: our legitimate interest in letting everyone benefit from searches already made. [To be verified: basis retained.]",
            "Letting you know when a wish you follow drops in price or is back in stock (alerts): performance of the contract between us. The price-drop alert turns on when you save a piece from your results, if the piece can be followed; you can turn it off. [To be verified: alert turned on by default when a piece is saved.]",
            "Using, without your name, your searches and your “No longer available” reports for other members' alerts (“Help other members” setting, on by default, which you can turn off): our legitimate interest in making alerts useful to everyone. [To be verified: basis retained, and setting on by default.]",
            "Looking for the same piece at other retailers (titles and site names of the first results sent to Anthropic, short search sent to SerpApi and Google): performance of the contract between us. This sending contains no image and does not depend on your consent to video analysis. [To be verified: performance of the contract or legitimate interest.]",
            "Searching with your words, when you start “What are you looking for?”: performance of the contract between us, at your request. [To be verified: basis retained.]",
            "Searching with the description written for a video link (or the name of the piece chosen among the AI's suggestions), started automatically when no result shows a price: performance of the contract between us (the search for the piece that you asked for). [To be verified: basis retained.]",
            "Keeping for 24 hours, with no link to your account, the answers already obtained, so as not to run the same searches again and to answer faster: our legitimate interest. [To be verified: basis retained.]",
            "Showing your public posts and your account to members who do not follow you (“For you” feed, account suggestions): our legitimate interest in helping members discover each other. You can object at any time, without making your account private (setting “Suggest my account to other members”). [To be verified: basis retained.]",
            ...extra.bases,
          ],
          "[To be verified: legal bases retained, to be reviewed by a legal professional — in particular the legitimate interest relied on for error reports, and the basis relied on for sending the titles of the results to Anthropic without consent.]",
        ],
      },
      {
        title: `Who can see what in ${BRAND}`,
        blocks: [
          [
            "Your Vault: you alone, or your friends if you chose so (“Show my Vault to my friends”). Your Wishlist: you alone, or your friends if you chose so (“Show my Wishlist to my friends”); otherwise only the wishes in a collection shown to your friends.",
            "Your posts: according to the visibility you choose for each one — everyone, your followers, or you alone. You can change it at any time.",
            "Your profile (username, display name, photo, bio, number of followers and accounts followed): other users, except those you have blocked.",
            "Your private messages: you and the person you are talking with. They can also see that you have seen their last message (“Seen”), unless one of you has turned off “Read receipts”. Only what you read while this setting is on is shown.",
            `Pieces found from a TikTok or Instagram video: members who open the same video, once the piece has been found by at least two members, never with your name (see “${VIDEOS}”).`,
            `Your alerts, your price thresholds and your “No longer available” reports: you alone (see “${ALERTS}”).`,
          ],
          "Photos are stored at a long, random web address that cannot be guessed. However, someone who was able to see a photo and kept its address can continue to open it, even if you later change the visibility of the post.",
          "You can make your account private. Your posts, your follower and following lists and your likes are then visible only to followers you have approved. Other members see only your name, photo, bio and your follower and following counts; you no longer appear to them in other accounts' lists. What you write under another member's post remains visible according to that post's visibility; its author is told of your comments and of your likes. A follow request is kept until you answer it or it is cancelled, then erased; a person whose request you decline is not notified, but can see that they may ask again. If you switch back to a public account, pending requests are erased.",
          "Your follower list and your following list are visible to members who can see your profile (only your approved followers if your account is private). You can remove a follower; they are not notified.",
          "When you like a post, members who can see that post can see that you liked it. If your account is private, only your followers and the post's author can see it.",
          "You can reply to a comment, like it and mention a member with @. The setting “Who can mention me” lets you choose who can mention or tag you: everyone, accounts you follow (the starting value), or no one. You are notified when you are mentioned and you can remove the mention. If you block a member, their mentions of you disappear.",
          "A post can contain up to 5 photos. You can tag members in it; only those who allow it (setting “Who can mention me”, which starts at: only accounts they follow themselves) and who can see the post are tagged. A tagged person is notified and can remove the tag at any time; the tag is removed if they can no longer see the post, except when the post is hidden by moderation: the tag is then hidden with it and returns if the post is restored.",
          "You can save a post to find it again, and add it to one of your collections. Your saved posts are visible only to you: neither their author nor your friends can see them. A saved post disappears from your list if you are no longer allowed to see it.",
          `You can pin up to 3 posts at the top of your profile and display a link to a website. This link is visible to members who can see your profile (only your approved followers, if your account is private). Sites that members link to are outside ${BRAND}'s control; a screen warns you before you leave the app.`,
          "Your public posts may be shown in the “For you” feed to members who do not follow you, and your account may be suggested to them, unless your account is private or you turn off the setting “Suggest my account to other members”. This feed ranks public posts from the last 14 days by date and by number of likes and comments; the ranking is the same for everyone and uses no profile of your interests. Account suggestions rely on the accounts followed by the people you follow, then on the most active public accounts of the “For you” feed.",
          "A look page can be seen by anyone who has its link, even without an account. It never shows your photo, your name, your words or a video link. Its address is long and random, impossible to guess, and it is not offered to search engines; but someone who has the link can pass it on. You can stop sharing at any time (Settings → Your data); the page then disappears for everyone.",
          "In a conversation you can like a message, reply to it, send a post and delete your own messages. A deleted message is erased for both of you; only the line “Message deleted” remains. The other member may have read it before. If it had been reported before being deleted, its content is kept for moderation: the other member can no longer read it, and you will find it in your data export. A post you send is shown to the other member only if they are allowed to see it, at the time they look.",
        ],
      },
      {
        title: VIDEOS,
        blocks: [
          `A video from your phone: if you import a video (60 seconds and 100 MB at most), it is read only on your device: the video is never sent to our servers nor kept by ${BRAND}; only the chosen frame is sent, like a photo. If you accept automatic analysis, your device picks up to 12 sharp frames from the video, reduced (512 pixels on a side), and sends them with your description to our server, which passes them on to Anthropic to find the best moments and the piece (see “Our providers and third-party services”). These frames and your description are never saved by ${BRAND}: our server deletes them as soon as the answer arrives.`,
          `The link to a TikTok or Instagram video: when you share or paste this link, ${BRAND} reads from it the platform, the video's identifier and, when it appears in the link, its creator's handle. For a short TikTok link, our server only asks TikTok which address it leads to. The link is kept on your device for 10 minutes: the search you start during that time (shared screenshot, chosen photo, image dropped on the website) is linked to this video, unless you unlink it.`,
          `The official player, in the iPhone app: the video can be played in TikTok's or Instagram's official player, embedded in the app. That player is provided by TikTok (TikTok Technology Limited) or by Meta (Meta Platforms Ireland Limited), which then receive the usual technical information of a web page (IP address, device type) and may set their own trackers, under their own privacy policies. This is why the app asks for your agreement before showing a player for the first time; you can withdraw it at any time (Settings → Your data). For Instagram, our server asks Meta for the post's embed code and keeps it for 24 hours: Meta receives the address of the post, never your identity. When you tap “Spot this moment”, the app takes, on your device, an image of what the player is showing; you circle the piece, then the cropped image is sent for the search, like a photo, and deleted from your phone. It is never shown to other members.`,
          `Automatic analysis of a link: if you accept automatic video analysis, you can ask for it for the link to a public TikTok or Instagram video, by writing in a few words what you are looking for. It is the same consent as for a video from your phone, in a new version of its text, which covers both videos from your phone and links. Consent given on the previous version, which only covered videos from your phone, remains valid for them; for a link, the app asks for your consent to the new version before the first analysis. Our video service, a service separate from our server, also hosted by Render in the European Union (Frankfurt), then fetches the public video from TikTok or Instagram and extracts a few frames from it, without keeping the video. TikTok or Meta receive this request from our service, with the address of the video: never your identity or your IP address. Our server reduces these frames (16 at most, 512 pixels on a side) and passes them on, with, where applicable, what you wrote, to Anthropic, which indicates the best moments and where the piece is (see “Our providers and third-party services”). You can also, without writing anything, ask the AI to suggest the pieces it sees: Anthropic then receives the same frames and the app's language, without any text from you, and returns the names of up to 3 visible pieces (for example “The camel coat”), each with the best frame and where it is. The AI is instructed never to refer to a person, and ${BRAND} discards names that contain certain words referring to a person (such as “girl” or “man”). ${BRAND} does not keep these names. The image of the moments found is returned to your device, and the search goes on as for a photo. Neither the video, nor these frames, nor what you wrote are kept by ${BRAND}: they stay in memory for the time of the analysis (a few seconds), then are deleted; they appear neither in our database, nor in the server's logs, nor in error reports. What you wrote, or the name of the piece you chose among the AI's suggestions, is also used for the search that follows, never sent with the image to the visual search: the app keeps it in memory, without saving it on your device, while the search runs; it sorts the suggestions, like the words typed under a photo; and if no suggestion shows a price, neither in the visual search nor at other retailers, our server sends it automatically, once, to SerpApi, which queries Google Shopping to find shops that sell the piece (like “What are you looking for?”, see “The data we use”). There too, ${BRAND} does not save it. If the analysis fails, you can always take a screenshot of the video.`,
          `AI usage limits: for each automatic analysis, of a video from your phone as of a link, ${BRAND} only notes its time with your account, to apply the usage limits; this note is deleted after 2 days, at a later analysis.`,
          `iPhone image search: on compatible iPhones, you can send a screenshot to ${BRAND} from the system's “Image Search”. To show its suggestion, the app keeps a copy of the image on your device, excluded from backups, and sends nothing. This copy is deleted at the next image search, or at the latest 10 minutes after the app is next opened. If you choose ${BRAND}, the image follows the same path as any photo entrusted for a search, and the copy is deleted once the search has started.`,
          `Pieces already spotted in a video: when a search made from a TikTok or Instagram video succeeds, ${BRAND} keeps the link between the video (platform, identifier, public address, creator's handle when it appeared in the link) and the pieces found, with where the image came from (player, shared screenshot, iPhone image search…) and, when known, the moment in the video. No image of the video is kept. Members who then open the same video see these pieces (“Pieces already spotted in this video”), but a piece is shown only once at least two different members have found it: a single search is never visible to others. Other members see the pieces, never who found them: your identity is neither displayed nor disclosed. If you tap “That's the piece”, this choice is kept with your account, so that it counts only once; other members only see the total. Suspended accounts are not counted, and the moderation team can remove a piece from a video's list.`,
          "How long: the link between one of your searches and a video is deleted with that search (after 12 months) or with your account; your “That's the piece” votes are deleted with your account. The video's own record (platform, identifier, public address, creator's handle) contains nothing about you and has no time limit. This data is included in the export of your data.",
        ],
      },
      {
        title: ALERTS,
        blocks: [
          `What you choose: alerts are optional. You turn on a wish's bell and choose what you follow (price drop, back in stock); the “Price and stock alerts” switch in Settings is off by default. When you save a piece from your results, its “Price drop” bell turns on automatically, if the piece can be followed (shop and product recognised, price shown in the currency of your search's country, or no price), with the last price seen as its threshold or, failing that, the first price seen afterwards; “Turn off alert”, offered right after, or the wish's bell turn it off, and you can also turn on a bell yourself. The switch stays as you chose it: it only controls whether alerts are sent, and even when it is off, a piece that goes below its threshold is marked “Price drop” in the app. For a price drop, you set a threshold: the price you enter or, failing that, the last price seen. ${BRAND} keeps this threshold with its currency, its country and whether it has already been crossed, until you turn off the bell or remove the wish. If a wish's country was not known, setting its bell records the country of your search (France, the United Kingdom, Switzerland or the United States).`,
          "Help other members: this setting is on by default, and saved with your profile. Your searches and your “No longer available” reports are then also used, without your name, for the alerts of members who follow the same piece. If you turn it off (Settings → Price and stock alerts), they are only used for your own wishes: they change nothing for others and do not count in report series; your alerts keep working. A piece marked “I bought it” is never used for other members' alerts: only your own wishes for the same piece are marked as bought.",
          "How an alert comes about: a piece is recognised by a fingerprint of its shop link, once that link is cleaned of its tracking parameters; a piece with no direct link to the shop (only a Google page) never has an alert. Prices and stock are only compared between searches made from the same country, and an out-of-stock status announced by Google only applies to the country of the search. At the time of the comparison, the identifier of the member searching is passed to our database to apply their setting and the report rule; it is not kept. A piece is only marked sold out for members in a country after “No longer available” reports from 3 different members in a row, from that country; until then, only the wishes of the report's author are marked sold out.",
          `Your “No longer available” reports: ${BRAND} keeps with each one its author, the piece (a fingerprint of its link, never the link), the day, the country of your search (France, the United Kingdom, Switzerland or the United States), whether you were helping other members at the time, and whether the report is part of the current series. They are also used to limit abuse. They are deleted after 30 days, appear in the export of your data and are never linked to an alert.`,
          `What is kept to follow a wish: a fingerprint of the piece (never its link), the last price seen (with its currency and the country of the search), the stock status and their dates to the day, until you remove the wish or delete your account. No shop name is kept for this tracking. The last price seen and the stock status are shown on the wish's page. A piece whose “Price drop” bell is on is marked “Price drop” in your Wishlist and on its page when its last price seen goes below its threshold (and below its price when you saved it, if known in the same currency), as long as it is neither bought nor sold out; the app works this out from that data, without storing anything more.`,
          `The alert and its notification: an alert goes out as soon as the price drop or the return to stock is seen, up to 5 alerts a day. If you receive alert notifications on your iPhone, each one is generic: “Price drop on one of your Wishes”, “One of your Wishes is available again” or “Several of your Wishes have news”. It contains neither the title of the piece, nor the shop, nor the price: only an identifier of the wish (none for a grouped notification), passed to Expo and then to Apple (see “Our providers and third-party services”). When you open it, the wish's page shows the last price seen and the stock status, loaded from our server. For an alert, ${BRAND} only keeps the day it was created and the day it was sent; the exact time only exists while it is being sent (15 minutes at most), so that the same alert is not sent twice, then it is deleted. An alert that could not go out expires on the 3rd day. Alerts are deleted after 30 days.`,
          `Updates in the app: at the top of your Wishlist, ${BRAND} shows your alerts from the last 30 days that are still true (the price seen, its day, the shop, and the gap with your threshold; or the return to stock), even when the notification did not go out or has expired. What you have already seen is noted only on your device, for your account (the identifiers of the alerts seen, nothing else): these identifiers are neither sent to ${BRAND} nor kept by our server. If you accept usage statistics, they only count the number of updates shown and the kind of the one you open (see “The data we use”).`,
          "What other members see: nothing about you. An alert never says who searched for or reported the piece, nor who else follows it, and no member can find out who it was. Your Vault remains visible to you alone, unless you choose to show it to your friends: a purchase is only shown to others if you choose to post it or to show your Vault to your friends. Your alerts remain visible to you alone, even if you show your Wishlist or your Vault to your friends.",
          "What our database keeps: nothing in it links an alert to the search, the report or the member that triggered it. There is a limit, however: it keeps the day, the fingerprint of the piece and the price seen; someone with full access to this database could, by cross-checking with that day's searches (kept for 12 months), find the search that probably triggered an alert. The authors of a report series are also known to it, as the rule of 3 members in a row needs them. Neither the member searching or reporting, nor the wishes or members notified, appear in the server's logs, error reports or usage statistics. The exceptions, if you accept them: usage statistics count the number of updates shown at the top of your Wishlist and the kind of the one you open; and, for a wish page opened from an alert notification, the shop click that follows, the return from the shop and the “Did you buy it?” question are counted as coming from an alert, without the piece, the shop or the price.",
        ],
      },
      ...extra.sections,
      {
        title: "Our providers and third-party services",
        blocks: [
          `We use providers that process data on our behalf, solely to operate ${BRAND}:`,
          [
            "Supabase (Supabase Pte. Ltd., Singapore): database, photo storage and authentication. Your data is hosted there in the European Union (Ireland).",
            "Render (Render Services, Inc., United States): hosting of our server and of our video service, located in the European Union (Frankfurt, Germany), and of the website. All requests from the app go through this server; the video service only receives, from our server, the addresses of the videos to analyze.",
            "SerpApi (SerpApi, LLC, United States): receives a temporary link (valid for 5 minutes) to the image to be analyzed; it passes it to Google's visual search (Google Lens, Google LLC, United States), which downloads the image to find matching pieces. If the same image, with the same framing, has already been analyzed within the last 24 hours, the stored answer may be reused without sending it again (see “How long”). To look for the piece at other retailers, SerpApi also receives, as text, the short search written by the AI (see Anthropic below) and, if you start “What are you looking for?” (for a search started from a video link where no result shows a price, automatically, with the description you wrote or the name of the piece you chose among the AI's suggestions), your words; it passes them to Google Shopping (Google LLC, United States). Each request also states the country and language of the search: France and French if the app is in French; if it is in English, your device's region (or, failing that, the United States). These requests are sent by our server, without your name, your email address or your IP address. No identifier of your account is passed to them.",
            "Sentry (Functional Software, Inc., United States): error reports from the app and the server. Data hosted in the European Union (Frankfurt, Germany).",
            "PostHog (PostHog Inc., United States): usage statistics, only with your consent. Data hosted in the European Union (Frankfurt, Germany).",
            `Expo (650 Industries, Inc., United States): if you turn on message notifications or price and stock alert notifications, or activity notifications (likes, comments, followers, mentions), on your iPhone, our server hands each notification to Expo, which passes it on to Apple's notification service (Apple Inc., United States) so it shows on your iPhone. A message notification only contains “${BRAND}”, the username of the person writing to you (for example “New message from @alexis”) and an identifier of the conversation, never the text of the message or the attached wish. An alert notification is generic (“Price drop on one of your Wishes”, “One of your Wishes is available again” or “Several of your Wishes have news”): it contains neither the title of the piece, nor the shop, nor the price, only an identifier of the wish (none for a grouped notification), and never who searched for or reported the piece. An activity notification only contains “${BRAND}”, the member's username and a fixed sentence (for example “@alexis liked your post”), with an identifier of the post or member concerned (none for a follow request, which opens the list of requests): never the text of a comment, a caption or an image. For this, ${BRAND} keeps your device's technical address, with what it receives (messages, alerts, and each kind of activity), as long as one of these notifications is turned on for it; it is deleted when you turn them all off, when you sign out or when you delete your account. [To be verified: Expo's role (processor), safeguards for this transfer to the United States, and retention periods at Expo and Apple.]`,
            "Anthropic (Anthropic, PBC, United States): its AI (Claude) is used for two things. If you accept automatic video analysis, it receives from our server reduced frames from the video (up to 12 for a video from your phone, 16 for the link to a TikTok or Instagram video) and, where applicable, your description (and, for the AI's suggestions, the app's language, to write the names), and indicates the best moments and where the piece is or, if you ask for it, the name and location of a few visible pieces. To look for the piece at other retailers, it also receives from our server, during your searches where the visual search found pieces, the titles and site names of the first 15 results (for example “Example Brand X-200 white leather trainers — shop-b.com”), with the country and language of the search, and writes a short search of 2 to 8 words. For this, it receives no image, no price and none of your words, and this sending does not depend on your choice about video analysis. No other data about you (name, email, identifier) is sent to it. Anthropic acts on our behalf, as a processor, under its data processing agreement. What its terms and documentation provide: it may not train its models on this data; it automatically deletes it from its systems no later than 30 days after receiving it, and for the model used, it does not retain it by default. Exceptions: a legal obligation, or content flagged by its automated safety checks, which it may then keep for up to 2 years (and the scores assigned by these checks for up to 7 years). Its data is stored in the United States; the analysis itself may take place in another country where Anthropic runs its models. [To be verified: that the data processing agreement and these terms also apply to sending the titles (same account, same model).]",
            ...extra.providers,
          ],
          `TikTok and Meta: when you share or paste a video link, our server may ask TikTok which address a short link leads to, and Meta for the embed code of an Instagram post; for the automatic analysis of a link, our video service asks them for the public video. Only the address of the video is sent to them, from our servers, never your identity or your IP address. The official player, if you accept it in the iPhone app, is provided directly by TikTok or Meta, which then receive your IP address and may set their own trackers (see “${VIDEOS}”).`,
          `Images of suggested pieces are displayed directly from retailers' and Google's websites. Your phone or browser downloads them from those sites, which therefore receive your IP address and the usual technical information of a web request. When you open a link to a retailer, you leave ${BRAND}: its own privacy policy applies. Among the pieces found at other retailers or with your words, when Google provides no direct link to the retailer, “View offer” opens the piece's page on Google: Google's privacy policy then applies.`,
          "Finally, we may disclose data to the authorities where the law requires us to.",
        ],
      },
      {
        title: "Transfers outside the European Union",
        blocks: [
          "Some data leaves, or may leave, the European Union:",
          [
            "the image you submit for analysis: sent to SerpApi and then to Google, in the United States;",
            "the short search written by the AI and, if you start “What are you looking for?”, your words (or, for a search started from a video link where no result shows a price, automatically, the description you wrote or the name of the piece you chose among the AI's suggestions), with the country and language of the search: sent to SerpApi and then to Google (Google Shopping), in the United States;",
            "the titles and site names of the first results, with the country and language of the search: sent to Anthropic, in the United States, and which may be processed in other countries where Anthropic runs its models;",
            "if you accept automatic video analysis: the reduced frames (from a video from your phone or from a TikTok or Instagram link) and, where applicable, your description (and, for the AI's suggestions, the app's language, to write the names), sent to Anthropic, in the United States, which may be processed in other countries where Anthropic runs its models;",
            "data passing through our server or our video service (each request from the app, with your IP address, the data you view or send, and the videos analyzed): these services are located in the European Union (Frankfurt), but as Render is a US company, access from the United States (maintenance, support) cannot be ruled out; the same applies to the server's technical logs (IP address, request information), kept by Render (see “How long”);",
            "data hosted by Supabase: stored in Ireland, but as Supabase is a company established in Singapore, access from outside the European Union (maintenance, support) cannot be ruled out;",
            "your IP address: received by retailers' websites and by Google when the app displays their images, and by TikTok or Meta if you accept their official player, wherever they are established;",
            "error reports (Sentry) and, if you accept them, usage statistics (PostHog): stored in the European Union (Frankfurt), but as these are US companies, access from the United States (maintenance, support) cannot be ruled out. Sentry states that it participates in the EU–US Data Privacy Framework.",
            ...extra.transfers,
          ],
          "[To be verified: safeguards covering each of these transfers — the company's Data Privacy Framework certification, or the European Commission's standard contractual clauses signed with it — and the position of Google, which receives the image and the search texts through SerpApi without a direct contract with the publisher. Anthropic: standard contractual clauses (modules 2 and 3) provided for in its data processing addendum; Data Privacy Framework certification not mentioned in that addendum; to be confirmed for sending the titles of the results.]",
        ],
      },
      {
        title: "How long",
        blocks: [
          [
            "The image you submit for analysis: deleted from our servers as soon as the search responds, whether it succeeded or not (a few seconds).",
            `Reduced frames from a video sent for automatic analysis, and the video of a link fetched by our video service: never saved by ${BRAND}; they stay in memory for the time of the analysis (a few seconds), then are deleted. At Anthropic: see “Our providers and third-party services”.`,
            `The words of “What are you looking for?”, including the description of a video link or the name of the piece chosen among the AI's suggestions, sent automatically when no result shows a price: never saved by ${BRAND}; our server keeps them in memory while the search runs (a few seconds), then deletes them. At SerpApi and Google: [To be verified: retention period of search texts].`,
            `Answers already obtained (cache): so as not to run the same searches again, our server keeps the answers of the visual search, the AI and the retailer search (pieces found, short search written by the AI), with the country and language of the search. Those of the visual search are filed under a fingerprint of the cropped image: a code from which the image cannot be rebuilt, the image itself never being kept. These answers are linked neither to your account nor to your search, and your words never go into them. If you, or someone else, run the same image again with the same framing, language and country within 24 hours, they are reused. Each answer stops being used after 24 hours, then is deleted at the next search started on ${BRAND}.`,
            "Your search history (except the analyzed image, see above), with all the suggested pieces, including those found at other retailers or with your words: 12 months. Older searches are deleted, together with their results and the clicks to retailers that depend on them, at your next search. Exception: a search from which you kept a piece (Vault, Wishlist, piece shown in a post) is kept for as long as that piece is.",
            `Videos: the link between one of your searches and a video goes with that search; your “That's the piece” votes, with your account; a video's record, which contains nothing about you, has no time limit (see “${VIDEOS}”).`,
            `Price and stock alerts: alerts and your “No longer available” reports are deleted after 30 days; an alert that could not go out expires on the 3rd day; what is kept to follow a wish, until you remove it; your price threshold, until you turn off the bell or remove the wish (see “${ALERTS}”).`,
            ...extra.retention,
            "A look page disappears 30 days after it is created, as soon as you stop sharing it, with the search it comes from, or with your account.",
            "Your account and everything attached to it: for as long as your account exists.",
            "An account with no sign-in for 3 years is deleted, with all its data. An email warns you before deletion.",
            "The server's technical logs: [To be verified: retention period at our hosting provider].",
            "Error reports (Sentry) and usage statistics (PostHog): [To be verified: retention periods of these services for our plan, and the period to retain].",
          ],
          "When you delete your account, your data and photos are erased immediately and permanently: profile, searches, Vault, Wishlist, collections, posts, comments, mentions, tagged people, likes, saved posts, follows, notifications, alerts and “No longer available” reports, links between your searches and videos, “That's the piece” votes, clicks to retailers, consents. Cached answers, which are linked to no account, are not affected: they are deleted on their own (see above). A video's record, which contains nothing about you, also remains.",
          "Your subscription status: kept for as long as your account exists, updated whenever it changes, and erased with your account. Your search counters are not stored: they are recalculated from your search history.",
        ],
      },
      {
        title: "On your phone or in your browser",
        blocks: [
          `${BRAND} stores on your device your sign-in session, so that you do not have to sign in again, a copy of images already displayed, to show them faster, the fact that you have already seen an update notice, so as not to show it again, and the language and theme (light, dark or your device's) you have chosen. These items are essential for the app to work. While you choose a frame from a video, or while automatic analysis uses it, the iPhone app keeps a temporary copy of the video, deleted as soon as you leave the search; the small frames prepared for automatic analysis are deleted as soon as they are sent. On the website, the video is read by your browser without being copied.`,
          `The link to a TikTok or Instagram video you share or paste is kept on your device for 10 minutes, and deleted when you sign out. In the iPhone app, your agreement to TikTok's or Instagram's official player is saved on the device, and a screenshot received from “Image Search” is kept there briefly (see “${VIDEOS}”). So as not to ask you “Did you buy it?” again on the same day, the app also keeps on your device, for your account, the day of the last question, the number of questions asked that day and the pieces concerned (two at most); on another day, this count starts again from zero.`,
          `${BRAND} uses no advertising trackers and no advertising cookies. Usage statistics, if you accept them, are sent directly, without cookies or storage on your device, and without IP-based geolocation. TikTok's and Instagram's official players, if you agree to show them, may set their own trackers, under those companies' policies.`,
          `Activity notifications: if you turn them on, ${BRAND} sends a notification to your iPhone when a member likes or comments on your post (or replies to your comment), follows you (or asks to follow you, or accepts your request) or mentions you (or tags you in a post). Each type has its own switch in Settings, off at first, and your choices are kept on your iPhone. The notification goes through Expo's service and then Apple; it contains the member's username and a fixed sentence, never the text of a comment or an image.`,
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
            "Withdraw your agreement to TikTok's or Instagram's official player (iPhone app): Settings → Your data.",
            "Turn off your price and stock alerts, or stop helping other members' alerts: Settings → Price and stock alerts.",
            "Stop showing “Seen” to the person you are talking with (you will no longer see theirs either): Settings → Read receipts. What you read while this setting is off is never shown later.",
            ...extra.rights,
            `For any other request: ${PUBLISHER_EN.email}.`,
          ],
          "If you believe your rights are not being respected, you can lodge a complaint with the CNIL, the French data protection authority (cnil.fr).",
        ],
      },
      {
        title: "Minimum age",
        blocks: [
          `${BRAND} is reserved for people aged at least 15. You confirm this when signing up, and this declaration is recorded with its date; no age verification is carried out.`,
          ...extra.age,
        ],
      },
      {
        title: "Security",
        blocks: [
          `Exchanges with ${BRAND} are encrypted (HTTPS). Every access is checked by our server: ownership of content, chosen visibility, blocked accounts. Passwords are never stored in plain text.`,
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
}

export const privacyPolicyEn: LegalDocument = buildPrivacyPolicyEn(privacyExtraEn);
