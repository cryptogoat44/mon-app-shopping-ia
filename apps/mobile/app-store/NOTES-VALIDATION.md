# Les notes pour l'équipe de validation d'Apple

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Brouillon remis à jour le 10 novembre 2026 (lot « conformité Apple ») : messages, invitations, collections, notifications, alertes, modèle économique, source des résultats, interrupteurs du serveur.*

**Où coller** : App Store Connect → votre app → la version → section **Informations pour la validation de l'app** (*App Review Information*) :
- **Identifiant** et **mot de passe** du compte de démonstration : dans leurs deux cases (pas seulement dans les notes) ;
- **Remarques** (*Notes*) : la **version anglaise** ci-dessous (partie 3). Apple lit l'anglais. **Limite d'Apple : 4 000 caractères.** Le texte anglais en fait **3 857** (3 865 octets), crochets compris : il reste environ 135 caractères de marge. La version française (partie 2, pour vous) en fait **3 990** (4 147 octets : elle n'est pas collée chez Apple).
- **Pièce jointe** (facultative, conseillée) : une courte vidéo d'écran de votre iPhone qui montre le partage d'une photo vers l'app depuis Photos. Elle évite un aller-retour si le testeur ne trouve pas l'extension.

**Règle** : Apple refuse les descriptions vagues (règle 2.3.1 (a) : « All new features, functionality, and product changes must be described with specificity in the Notes for Review section of App Store Connect (generic descriptions will be rejected) and accessible for review. »). Chaque phrase vient du code de la branche du build ; les preuves sont en partie 4. Si le code change d'ici l'envoi, revérifiez le paragraphe concerné, **et recomptez** : `wc -m` sur le texte copié dans un fichier.

Le nom de l'app va changer : le texte dit « the app ». Seuls les libellés lus à l'écran sont cités entre guillemets ; relisez-les sur le build.

---

## 1. Avant de coller : ce qu'il reste à remplir, à vérifier ou à décider

**À remplir** (tous les crochets `[…]` de la version anglaise) :

1. **`[À compléter]`** (4 fois) : l'e-mail et le mot de passe du compte de démonstration ; le nom d'utilisateur du compte **ami** (ils se suivent l'un l'autre) ; celui du **troisième compte**, qui lui a envoyé une invitation. Le scénario à préparer est dans [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E.
2. **`[8]` et `[25]`** : les plafonds réels de Render (`SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP`). 8 et 25 sont les valeurs par défaut du code.
3. **`[ON/OFF]`** (4 fois), l'état **le jour de l'envoi** chez Render (gardez un seul des deux mots) : `PUSH_ENABLED`, `VOIE_C_ENABLED`, `VOIE_C_AI_ENABLED`, et l'analyse des vidéos (ON si `ANTHROPIC_API_KEY` est saisie). Règle 2.5.19 d'Apple : aucune fonction cachée, dormante ou non décrite ; chaque interrupteur est donc décrit avec son état, même coupé.

**À vérifier** (sinon la phrase est fausse : corrigez-la ou retirez-la) :

4. **`ANTHROPIC_PHOTO_ENABLED` et `LINK_PREVIEW_ENABLED` sont bien coupés** chez Render (absents, ou différents de `true`). Les notes disent « OFF » : s'ils sont allumés, n'envoyez pas.
5. **Les migrations en production** ([REGISTRE-MIGRATIONS.md](../../backend/supabase/REGISTRE-MIGRATIONS.md)) : les paragraphes « MESSAGES » et « COLLECTIONS » supposent 0032, 0033 et 0034 (appliquées le 9 novembre 2026) ; « hidden until reviewed » suppose 0030 (appliquée) ; « NOTIFICATIONS AND ALERTS » suppose 0035 et 0036 (**à appliquer** à ce jour : sans elles, l'app cache ces fonctions, et le paragraphe doit partir) ; « (bios and profile photos included) » suppose **0037** (à appliquer : sans elle, retirez ces mots).
6. **« backup copy of photos: 7 days at most »** : vrai si la copie de sécurité hebdomadaire des photos est en service (`apps/backend/supabase/SAUVEGARDE-PHOTOS.md`). Sans copie de sécurité, retirez la parenthèse.
7. **« No link is affiliated today »** : vrai tant qu'aucun programme d'affiliation n'est actif. À réécrire le jour où un lien rapporte une commission.

**À décider** (ce sont des engagements pris en votre nom) :

8. **« We review within 24 hours »** : ne laissez cette phrase que si vous prenez cet engagement (alerte reçue sur votre téléphone, week-end compris).
9. **Si `PUSH_ENABLED` reste coupé le jour de l'envoi** : une personne qui allume la cloche d'une envie lit « les notifications seront bientôt disponibles » (`apps/mobile/src/i18n/fr.ts`, `wishAlerts.pushSoon`). Apple refuse les fonctions annoncées « pour bientôt » (règles 2.1 et 2.2). Deux sorties : allumer les notifications avant l'envoi, ou faire masquer les alertes ou réécrire cette phrase.
10. **Une phrase facultative**, à ajouter à la fin de « SERVER SWITCHES TODAY » seulement si vous vous y tenez : `Switches that are OFF will only be turned on with a new submission.` (67 caractères). C'est la lecture prudente de la règle 2.5.19 : allumer plus tard une fonction qu'Apple n'a pas vue passe par une nouvelle version.
11. **Si le serveur s'endort encore** (offre gratuite de Render) le jour de l'envoi, ajoutez : `SERVER: it may sleep when unused; the first launch can then take up to one minute (a wake-up message is shown).` (111 caractères ; vérifiez que le total reste sous 4 000). Le mieux reste une offre sans veille (CONTROLE-BUILD.md, partie C).

*Lecteur intégré TikTok / Instagram : rien à écrire.* Le module natif qui prenait l'image du lecteur est retiré de l'app depuis le lot « nettoyage avant le premier build » (10 novembre 2026) : le build ne contient aucun code de capture. S'il revenait un jour (`apps/mobile/BUILD-IPHONE.md`, section 9), ces notes devraient le décrire.

*Ce que ces notes ne disent pas, faute de place* : l'écran « Mettez à jour » (`APP_MIN_IOS_BUILD`, coupé par défaut : CONTROLE-BUILD.md, partie C), l'alerte « Épuisé » (construite, cachée dans l'app : décision à prendre, rapport d'audit partie 2), et le détail des « autres boutiques » (3 recherches au plus par photo).

---

## 2. Version française (pour vous : ce que dit le texte anglais)

```text
COMPTE DE DÉMO
E-mail : [À compléter] / Mot de passe : [À compléter]
E-mail confirmé ; exemples : Vault, Envies, collection, publications. Ami @[À compléter] (abonnement mutuel) : publication, commentaire, collection montrée, conversation ouverte. @[À compléter] lui a envoyé une invitation.

POURQUOI UN COMPTE
Recherches gardées et limitées par personne ; Envies, Vault, publications, abonnements et messages demandent une identité. Inscription gratuite (e-mail à confirmer).

SPOTTER UNE PIÈCE (onglet Spotter)
« Ajouter une photo », « Prendre une photo » ou « Ajouter une vidéo » (reste sur l'iPhone). Entourez la pièce, « Lancer » : résultats en 10 à 20 s, prix d'abord. « Garder » > Envies ; « Je l'ai achetée » > Vault. Lien TikTok, Instagram ou Pinterest collé : non lu (l'app explique la capture d'écran).
Extension de partage : Photos > Partager > l'app.

SOURCE DES RÉSULTATS
Google Lens, par notre prestataire SerpApi (image recadrée lue par un lien de 5 minutes) ; mots tapés : Google Shopping, par SerpApi.

MODÈLE ÉCONOMIQUE
Gratuit : ni achat intégré, ni abonnement, ni publicité, ni suivi. Rien n'y est vendu : « Voir chez [boutique] » ouvre le site du marchand (fenêtre Safari intégrée), où se fait l'achat. Aucun lien affilié aujourd'hui ; un tel lien porterait « Lien affilié ».

MESSAGES (onglet Activité > Messages, ou « Message » sur un profil)
Texte (1 000 caractères) et cartes d'envies, pas de photo libre. Entre amis : directement. Sinon UNE invitation : acceptée, refusée (sans le dire ; aucune pendant 30 jours) ou bloquée ; 10 par heure. Réglages > « Qui peut m'écrire » : Tout le monde (par défaut), Comptes que je suis, Mes amis seulement.
Signaler : « ••• » à côté d'un message reçu (ou appui long) > « Signaler ce message ».

COLLECTIONS (Envies)
Groupes d'envies, privés ou montrés aux amis (titre, image, prix, lien ; jamais les notes). Signalables (« ••• »).

NOTIFICATIONS ET ALERTES
Facultatives. Autorisation d'iOS demandée seulement après « Activer les notifications », jamais au lancement. Réglages : « Notifications de messages » (qui écrit, jamais le texte) et « Alertes prix et stock » (cloche d'une envie : pièce moins chère ou de retour en stock dans la même boutique).

INTERRUPTEURS DU SERVEUR
- Notifications (PUSH_ENABLED) : [ON/OFF]. Coupé : autorisation jamais demandée.
- Autres boutiques (VOIE_C_ENABLED) : [ON/OFF] ; étape IA (VOIE_C_AI_ENABLED) : [ON/OFF]. Allumé : une IA (Anthropic) lit titres et noms de sites des 15 premiers résultats, jamais l'image, pour interroger Google Shopping ; on peut aussi taper des mots.
- Analyse des vidéos (clé Anthropic) : [ON/OFF]. Avec accord : un écran nomme Anthropic (États-Unis) avant l'envoi de 12 images réduites au plus ; refuser n'envoie rien.
- ANTHROPIC_PHOTO_ENABLED : OFF. Aucune photo de membre envoyée à une IA.
- LINK_PREVIEW_ENABLED : OFF. Rien n'est demandé à TikTok ni à Meta.

PLAFONDS
[8] recherches par personne et par jour, [25] pour tout le service, 10 par heure (minuit, heure de Paris). À zéro, « Lancer » est désactivé ; rouvrir un résultat est gratuit.

MODÉRATION (1.2)
- Filtre de mots interdits (FR/EN) : légendes, commentaires, messages, noms, bios, noms de collections.
- Signaler : « ••• » de tout contenu (publication, commentaire, profil, pièce ou message reçus, collection d'un ami) ; il disparaît aussitôt pour qui signale.
- Bloquer : même menu ; cache publications et conversation. Réglages > Comptes bloqués.
- 3 signalements de personnes différentes : publication, commentaire, pièce ou collection masqués avant examen.
- Chaque signalement nous prévient. Examen sous 24 heures ; contenus retirés (bios, photos de profil comprises), comptes suspendus.
- Contact : Réglages > Aide et contact.

SUPPRESSION DU COMPTE
Profil > roue dentée > Supprimer mon compte > taper SUPPRIMER > Confirmer. Tout est effacé aussitôt (copie de sécurité des photos : 7 jours au plus).

Autorisations : appareil photo ; photos seulement pour la suggestion « dernière vidéo ».
```

3 990 caractères (4 147 octets), crochets compris.

---

## 3. Version anglaise (à coller dans « Remarques »)

```text
DEMO ACCOUNT
Email: [À compléter] / Password: [À compléter]
Email confirmed; sample Vault, Wishlist, collection, posts. Friend @[À compléter] (mutual follow): a post, a comment, a shared collection, an open conversation. @[À compléter] sent it an invitation. Use them to test Report, Block, messages.

WHY AN ACCOUNT
Searches are saved per person and count against a personal daily limit; Wishlist, Vault, posts, follows and messages need an identity. Sign-up is free (email confirmation).

SPOT A PIECE (Spotter tab)
"Add a photo", "Take a photo" or "Add a video" (stays on device; pick a frame). Circle the piece, tap "Search": results in 10-20 s, priced ones first. "Save" > Wishlist; "I bought it" > Vault. A pasted TikTok/Instagram/Pinterest link is not read: the app shows how to add a screenshot.
Share extension: Photos > Share > the app.

SEARCH SOURCE
Results come from Google Lens via our provider SerpApi (it reads the cropped image through a 5-minute link); typed words go to Google Shopping via SerpApi.

BUSINESS MODEL
Free. No in-app purchase, subscription, ads or tracking. Nothing is sold in the app: "View at [shop]" opens the merchant's own site in an in-app Safari view, where any purchase happens. No link is affiliated today; one that may later earn a commission will be labelled "Affiliate link".

MESSAGES (Activity tab > Messages, or "Message" on a profile)
Text (1,000 characters) and wish cards, no free photos. Friends write directly. Anyone else can send ONE invitation: the recipient accepts, declines (silently; none for 30 days) or blocks. Max 10 invitations per hour. Settings > "Who can write to me": Everyone (default), Accounts I follow, Friends only.
Report a message: tap "..." next to a received message (or long-press it) > "Report this message".

COLLECTIONS (Wishlist)
Groups of wishes, private or shown to friends (title, image, price, shop link; never notes). Reportable from "...".

NOTIFICATIONS AND ALERTS
Optional. iOS permission is asked only after "Enable notifications" on an explanation sheet, never at launch. Two switches in Settings: "Message notifications" (who writes, never the text) and "Price and stock alerts" (bell on a wish: piece seen cheaper or back in stock at the same shop).

SERVER SWITCHES TODAY
- Push (PUSH_ENABLED): [ON/OFF]. Off: permission never asked.
- Other shops (VOIE_C_ENABLED): [ON/OFF]; its AI step (VOIE_C_AI_ENABLED): [ON/OFF]. On: an AI (Anthropic) reads only titles and site names of the first 15 results, never the image, to query Google Shopping; users can also type words.
- Video analysis (Anthropic key): [ON/OFF]. Opt-in: a consent screen names Anthropic (USA) before up to 12 reduced frames are sent; declining sends nothing.
- ANTHROPIC_PHOTO_ENABLED: OFF. No user photo goes to an AI.
- LINK_PREVIEW_ENABLED: OFF. Nothing is fetched from TikTok or Meta.

LIMITS
[8] searches per person per day, [25] for the whole service, 10 per hour (reset at midnight, Paris). At zero "Search" is disabled; past results reopen for free.

MODERATION (1.2)
- Banned-words filter (FR/EN) on captions, comments, messages, names, bios, collection names.
- Report: "..." on any post, comment, profile, received piece or message, friend's collection. It disappears at once for the reporter.
- Block: same menu; hides posts and the conversation. Settings > Blocked accounts.
- A post, comment, piece or collection reported by 3 different people is hidden until reviewed.
- Each report alerts our team. We review within 24 hours, remove content (bios and profile photos included) and suspend accounts.
- Contact: Settings > Help and contact.

ACCOUNT DELETION
Profile > gear > Delete my account > type DELETE > Confirm. Account, data and photos are deleted at once (backup copy of photos: 7 days at most).

Permissions: camera; photos only for the optional "latest video" suggestion.
```

3 857 caractères (3 865 octets), crochets compris. Limite d'Apple : 4 000 caractères.

---

## 4. Les preuves, paragraphe par paragraphe

Les paragraphes déjà présents avant le 10 novembre 2026 ont été vérifiés sur `main` (b99e884) : leurs fichiers sont les bons, leurs numéros de ligne ont pu glisser. Les paragraphes nouveaux citent le fichier et le nom à y chercher, relus sur la branche `lot-conformite-apple`.

- **DEMO ACCOUNT / WHY AN ACCOUNT** : compte obligatoire, groupes d'écrans protégés : `apps/mobile/src/app/_layout.tsx` et `apps/mobile/src/lib/root-route.ts` ; confirmation de l'e-mail : `apps/mobile/src/app/sign-up.tsx` ; recherches comptées par personne : `apps/backend/src/env.ts:22` (`SERPAPI_USER_DAILY_CAP`) ; le fil montre les publications des comptes suivis : `apps/backend/src/routes/posts.ts` ; amis = chacun suit l'autre : `apps/backend/src/lib/messaging.ts:1-12` ; compte de démonstration jamais administrateur (sa suppression serait refusée) : `apps/backend/src/routes/account.ts`.
- **SPOT A PIECE** : les trois boutons : `apps/mobile/src/app/(app)/(tabs)/index.tsx`, textes `fr.ts` (`addPhoto`, `addVideo`) ; « Lancer » : `fr.ts` (`launch.launch`) ; « Garder » : `fr.ts` (`keep`) ; lien non lu : `apps/mobile/src/lib/spot-flags.ts:7`, `apps/mobile/src/lib/link-step.ts` ; extension : `apps/mobile/app.json` (`expo-share-intent`), `apps/mobile/plugins/extension-partage.js`.
- **SEARCH SOURCE** : `apps/backend/src/services/serpapi.ts` (moteurs `google_lens` et `google_shopping`) ; lien signé de 5 minutes vers l'image recadrée : `apps/backend/src/lib/storage.ts` (« Images analysées »).
- **BUSINESS MODEL** : aucun achat intégré ni publicité dans le code ; lien du marchand ouvert dans la fenêtre Safari intégrée : `apps/mobile/src/lib/merchant-links.ts` (`WebBrowser.openBrowserAsync`) ; un lien n'est « affilié » que s'il diffère du lien du marchand : `apps/mobile/src/lib/affiliate-link.ts` ; mention prête : `fr.ts:468` et `en.ts:442` (`affiliateDisclosure`) ; « aucun programme d'affiliation n'est actif » : `apps/mobile/src/legal/conditions.ts:53`.
- **MESSAGES** : règles (amis, une invitation, refus discret, 30 jours, blocage) : `apps/backend/src/lib/messaging.ts:1-12` ; 1 000 caractères et 30 jours : `packages/shared-types/src/index.ts` (`MESSAGE_MAX_LENGTH`, `INVITATION_DECLINE_COOLDOWN_DAYS`) ; 10 invitations par heure : `apps/backend/src/lib/rateLimits.ts` (`messageInvite`) ; « Qui peut m'écrire », défaut « tout le monde » : `packages/shared-types/src/index.ts` (`DEFAULT_MESSAGES_FROM`), `fr.ts` (`messagesFromTitle`) ; entrée « Messages » de l'onglet Activité : `apps/mobile/src/app/(app)/(tabs)/activite.tsx` ; bouton « ••• » d'un message reçu et appui long : `apps/mobile/src/app/(app)/conversation.tsx` (`Bubble`), test `apps/mobile/tests/messages.test.ts` ; filtre de mots sur les messages : `apps/backend/src/routes/conversations.ts`.
- **COLLECTIONS** : privées ou montrées aux amis, ce que les amis voient : `en.ts` (`collections.shareConfirmTitle` et la phrase suivante) ; signalement : `apps/mobile/src/app/(app)/collection-ami.tsx`, `apps/backend/src/lib/collectionModeration.ts`.
- **NOTIFICATIONS AND ALERTS** : coupées par défaut, texte limité à « qui écrit » : `apps/backend/src/lib/push.ts:1-16` ; autorisation demandée seulement après « Activer les notifications » : `apps/mobile/src/lib/push.ts`, `fr.ts` (`offerAccept`) ; les deux interrupteurs : `apps/mobile/src/components/message-push-setting.tsx` et `wish-alerts-setting.tsx` ; cloche et alertes : `fr.ts` (`wishAlerts.sheetIntro`).
- **SERVER SWITCHES TODAY** : `apps/backend/src/env.ts` — `LINK_PREVIEW_ENABLED` (:37), `ANTHROPIC_API_KEY` (:44), `VOIE_C_ENABLED` (:56), `VOIE_C_AI_ENABLED` (:63), `ANTHROPIC_PHOTO_ENABLED` (:71), `PUSH_ENABLED` (:82) : seule la valeur exacte `true` allume ; titres et noms de sites des 15 premiers résultats : `apps/backend/src/services/shoppingQueryAi.ts` ; écran d'accord des vidéos, 12 images au plus : `apps/mobile/src/components/spot-launch-views.tsx`, accord revérifié par `apps/backend/src/routes/videoMoments.ts`.
- **LIMITS** : `apps/backend/src/env.ts:17` et `:22` ; 10 par heure : `apps/backend/src/lib/rateLimits.ts:31` ; minuit de Paris : `apps/backend/src/lib/searchCapacityStatus.ts`.
- **MODERATION** : filtre : `apps/backend/src/lib/contentFilter.ts`, appliqué dans `routes/posts.ts`, `comments.ts`, `conversations.ts`, `me.ts`, `collections.ts` ; six types signalables : `packages/shared-types/src/index.ts` (`REPORT_TARGET_TYPES`) ; disparaît pour qui signale : `apps/backend/src/lib/reportedByViewer.ts` ; blocage : `apps/backend/src/routes/blocks.ts` ; masquage à 3 personnes : `apps/backend/src/lib/autoHide.ts:27` (publication, commentaire, pièce, collection ; pas un message ni un profil) ; alerte à chaque signalement : `apps/backend/ALERTES.md` ; retirer une bio ou une photo de profil : `apps/backend/src/routes/moderation.ts` (route `remove-profile-part`), migration 0037 ; bio et photo d'un compte suspendu cachées : `apps/backend/src/lib/profileModeration.ts` ; « 24 heures » : un ENGAGEMENT du fondateur, pas du code.
- **ACCOUNT DELETION** : `apps/mobile/src/components/delete-account-section.tsx` ; mot à taper : `packages/shared-types/src/index.ts:71` ; suppression des fichiers puis du compte : `apps/backend/src/routes/account.ts` ; copie de sécurité, 7 jours au plus : `apps/backend/supabase/SAUVEGARDE-PHOTOS.md:10`.
- **Permissions** : `apps/mobile/app.json` (phrases de l'appareil photo et des photos, micro coupé).

---

## 5. Si Apple pose une question

Répondez dans App Store Connect (Centre de résolution), en anglais, court et factuel. Les cas les plus probables :
- **« Nous n'avons pas pu nous connecter »** : vérifiez que le compte existe encore (Apple essaie souvent la suppression du compte, et peut l'avoir supprimé), qu'il n'est pas suspendu, puis recréez-le si besoin et redonnez les identifiants.
- **« Le serveur ne répond pas »** : ouvrez https://spotto-api.onrender.com/health puis /health/deep ([CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie F).
- **« Nous ne trouvons pas l'extension de partage »** : joignez la vidéo d'écran (Photos → Partager → Spotto ; si « Spotto » n'apparaît pas, « Modifier les actions » en bas de la feuille de partage).
- **Une question sur l'IA ou les données** : renvoyez aux paragraphes « SEARCH SOURCE » et « SERVER SWITCHES TODAY », et à la politique de confidentialité.
- **« Comment gagnez-vous de l'argent ? »** : le paragraphe « BUSINESS MODEL ». Ne promettez rien de plus que ce qu'il dit.
- **« Pourquoi faut-il un compte ? »** (règle 5.1.1 (v)) : le paragraphe « WHY AN ACCOUNT ».
- **Une question sur vos droits d'afficher les résultats de Google** (règle 5.2.2) : ne répondez pas seul ; c'est un point pour votre avocat (voir le rapport d'audit, partie 2).
