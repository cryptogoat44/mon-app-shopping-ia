# La fiche App Store de Spotto (textes à coller)

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Brouillon remis à jour le 21 novembre 2026 sur le code de `main` (0474313) : vie sociale (plusieurs photos, identifications, réponses, compte privé, « Pour vous »), messages (« Vu », j'aime, réponses), liens de vidéos, recherche d'image d'iOS, limite du mois. Les alertes et les notifications restent dans un paragraphe à part, à n'ajouter que si elles sont allumées le jour de l'envoi.*

**Où coller** : App Store Connect → Apps → Spotto → onglet **Distribution** → la version (1.0) → une langue à la fois (**Français**, puis **Anglais (États-Unis)** ou **Anglais (Royaume-Uni)** selon les pays choisis).

**Comment copier** : chaque texte est dans un cadre gris. Copiez tout le contenu du cadre, sans rien ajouter. Les longueurs ont été comptées par un script (le nombre est indiqué sous chaque cadre) ; Apple refuse l'enregistrement au-delà de la limite.

**Ce qui est vrai dans tous les cas** : ces textes ne parlent ni de la « voie C » (autres boutiques, « Que cherchez-vous ? »), ni du lecteur intégré, ni de l'analyse d'un lien par le serveur. La phrase sur les liens de vidéos (« Spotto vous guide… ») reste juste avec ou sans lecteur, et que l'analyse d'un lien soit allumée ou coupée. Toutes les fonctions décrites sont en production (migrations appliquées jusqu'à 0053, registre au 20 novembre 2026). Deux réserves : la phrase « Si vous l'acceptez, Spotto peut repérer ce moment pour vous » suppose `ANTHROPIC_API_KEY` saisie chez Render (sinon, retirez-la) ; les notifications dépendent d'un interrupteur du serveur (`PUSH_ENABLED`) : leur paragraphe est facultatif (partie 4), parce qu'une fiche ne doit décrire que ce que l'app fait vraiment (règle 2.3.1 d'Apple). Ils ne citent aucune marque d'une autre société (TikTok, Instagram, Google…) : la règle 2.3.7 d'Apple l'interdit dans les mots-clés, et c'est plus sûr ailleurs aussi. Ils ne décrivent aucune fonction payante : il n'y en a pas dans cette version.

---

## 1. Nom (30 caractères au plus)

```text
Spotto
```
6 caractères. Le même en français et en anglais.

Si Apple répond que « Spotto » est déjà pris, deux replis :

```text
Spotto : trouver la pièce
```
25 caractères (français).

```text
Spotto: Find the Piece
```
22 caractères (anglais).

---

## 2. Sous-titre (30 caractères au plus)

Français :
```text
Trouvez où acheter une pièce
```
28 caractères.

Anglais :
```text
Find where to buy the piece
```
27 caractères.

---

## 3. Texte promotionnel (170 caractères au plus)

Ce texte se change à tout moment, sans nouvelle validation d'Apple.

Français :
```text
Une veste vue dans une vidéo, un sac sur une photo ? Ajoutez une capture d'écran, entourez la pièce : Spotto vous montre où l'acheter, avec le prix quand il le trouve.
```
167 caractères.

Anglais :
```text
Saw a jacket in a video or a bag in a photo? Add a screenshot, circle the piece: Spotto shows you where to buy it, with the price when it finds one.
```
148 caractères.

---

## 4. Description (4 000 caractères au plus)

Elle cite « Partager vers Spotto » (règle 4.4 d'Apple : la fiche décrit l'extension de partage). Dans la feuille de partage d'iOS, l'app s'affiche sous le nom « Spotto ».

Français :
```text
Une veste vue dans une vidéo, un sac aperçu sur une photo, des baskets croisées dans la rue : Spotto vous aide à retrouver la pièce et à savoir où l'acheter.

COMMENT ÇA MARCHE
1. Ajoutez une capture d'écran, une photo de votre galerie ou une vidéo, ou prenez une photo.
2. Entourez la pièce du doigt.
3. Spotto cherche la même pièce, ou les plus proches, et vous montre les boutiques qui la proposent. Les propositions avec un prix passent en premier.

PARTAGER VERS SPOTTO
Depuis Photos ou une autre app, touchez « Partager », puis « Spotto » : la photo ou la vidéo s'ouvre directement dans Spotter, prête à être analysée. Sur les iPhone compatibles, après une capture d'écran, touchez « Recherche d'image », puis Spotto.
Une vidéo vue dans une autre app ? Partagez son lien vers Spotto, ou collez-le : Spotto vous guide pour en tirer l'image de la pièce et, s'il y en a, vous montre les pièces que d'autres membres y ont déjà repérées.

LES VIDÉOS
Choisissez le moment où la pièce se voit bien. Si vous l'acceptez, Spotto peut repérer ce moment pour vous : quelques images réduites de la vidéo sont analysées par une intelligence artificielle. Sans votre accord, aucune image ne part, et la vidéo entière ne quitte jamais votre téléphone.

VOS PIÈCES
• Envies : gardez en un geste les pièces qui vous plaisent.
• Vault : rangez celles que vous possédez, avec leur photo.
• « Récemment spottées » : retrouvez vos dernières recherches.

PARTAGEZ VOTRE STYLE
Publiez vos tenues et vos achats, jusqu'à 5 photos, et identifiez vos amis. Suivez d'autres passionnés de mode, aimez, commentez et répondez. Pour chaque publication, vous choisissez qui la voit : tout le monde, vos abonnés ou vous seul ; votre compte peut aussi être privé. Le fil « Pour vous » propose des publications publiques récentes de comptes que vous ne suivez pas, classées de la même façon pour tous.

ENTRE AMIS
• Messages privés : écrivez à vos amis, ou envoyez une invitation à un autre membre, qui choisit de l'accepter ou non. Aimez un message, répondez-y, envoyez une publication ; « Vu » vous dit quand votre dernier message est lu (réglage réciproque).
• Collections : rangez vos envies par thème, pour vous seul ou pour vos amis. Les publications que vous enregistrez restent visibles par vous seul.

UN ESPACE RESPECTUEUX
Les textes injurieux sont refusés avant publication. Vous pouvez signaler une publication, un commentaire, un message, une collection ou un profil, et bloquer un compte. Vous choisissez qui peut vous écrire, vous mentionner ou vous identifier. Chaque signalement est examiné par notre équipe.

VOS DONNÉES
Aucune publicité, aucune revente de vos données. Le partage de statistiques d'usage est facultatif. Depuis les Réglages, vous pouvez à tout moment télécharger toutes vos données ou supprimer votre compte.

BON À SAVOIR
• Un compte est nécessaire. Spotto est réservé aux personnes de 15 ans et plus.
• Le nombre de recherches est limité, par jour et par mois.
• Spotto ne vend rien lui-même : les liens ouvrent le site du marchand. Les résultats viennent d'une recherche visuelle et ne sont pas toujours exacts : vérifiez la pièce et son prix chez le marchand.
```
3 167 caractères.

Anglais :
```text
A jacket seen in a video, a bag spotted in a photo, sneakers passed in the street: Spotto helps you find the piece and see where to buy it.

HOW IT WORKS
1. Add a screenshot, a photo from your library or a video, or take a photo.
2. Circle the piece with your finger.
3. Spotto looks for the same piece, or the closest ones, and shows you the shops that sell it. Results with a price come first.

SHARE TO SPOTTO
From Photos or another app, tap Share, then "Spotto": the photo or video opens straight in Spotter, ready to be analyzed. On compatible iPhones, take a screenshot, tap Image Search, then Spotto.
Saw a video in another app? Share its link to Spotto, or paste it: Spotto guides you to get a frame of the piece and, if there are any, shows you the pieces other members have already spotted in it.

VIDEOS
Pick the moment where the piece is clearly visible. If you agree, Spotto can find that moment for you: a few reduced frames of the video are analyzed by an artificial intelligence. Without your consent, no frame is sent, and the full video never leaves your phone.

YOUR PIECES
• Wishlist: save the pieces you like in one tap.
• Vault: keep the ones you own, with their photo.
• "Recently spotted": find your latest searches again.

SHARE YOUR STYLE
Post your outfits and purchases, up to 5 photos, and tag your friends. Follow other fashion lovers, like, comment and reply. For each post, you choose who sees it: everyone, your followers, or only you; your account can also be private. The "For you" feed suggests recent public posts from accounts you don't follow, ranked the same way for everyone.

WITH FRIENDS
• Private messages: write to your friends, or send an invitation to another member, who chooses whether to accept it. Like a message, reply to it, send a post; "Seen" tells you when your last message was read (a two-way setting).
• Collections: group your wishes by theme, for yourself or for your friends. The posts you save stay visible to you alone.

A RESPECTFUL SPACE
Abusive text is refused before it is posted. You can report a post, a comment, a message, a collection or a profile, and block an account. You choose who can write to you, mention you or tag you. Every report is reviewed by our team.

YOUR DATA
No ads, and we never sell your data. Sharing usage statistics is optional. From Settings, you can download all your data or delete your account at any time.

GOOD TO KNOW
• An account is required. Spotto is for people aged 15 and over.
• The number of searches is limited, per day and per month.
• Spotto doesn't sell anything itself: links open the shop's website. Results come from a visual search and aren't always exact: check the piece and its price with the shop.
```
2 717 caractères.

**Paragraphe facultatif : alertes et notifications.** À insérer après « ENTRE AMIS » / « WITH FRIENDS » **seulement si**, le jour de l'envoi, `PUSH_ENABLED` vaut `true` chez Render (les migrations utiles, 0035, 0036, 0040, 0041 et 0051, sont appliquées depuis le 20 novembre 2026). Sans notifications, la cloche existe, mais personne n'est « prévenu » : la fiche mentirait. Décision à prendre avec celle des notes ([NOTES-VALIDATION.md](NOTES-VALIDATION.md), partie 1, point 10).

Français :
```text
ALERTES ET NOTIFICATIONS
Activez la cloche d'une envie pour être prévenu quand son prix passe sous le seuil que vous choisissez, ou quand elle revient en stock dans la même boutique. Vous pouvez aussi être prévenu d'un nouveau message, d'un j'aime, d'un commentaire, d'un nouvel abonné ou d'une mention. Tout est facultatif et se règle dans les Réglages.
```
354 caractères (description complète avec lui : 3 523).

Anglais :
```text
ALERTS AND NOTIFICATIONS
Turn on the bell of a wish to be told when its price drops below the threshold you choose, or when it is back in stock at the same shop. You can also be notified of a new message, like, comment, follower or mention. Everything is optional and set in Settings.
```
284 caractères (description complète avec lui : 3 003).

**À relire avant de coller** (ce sont vos affirmations, pas des faits que le code garantit seul) :
- « Aucune publicité, aucune revente de vos données » : vrai aujourd'hui. À préciser le jour où un lien affilié rapporte une commission (décision 10 de l'audit, partie 2).
- « Chaque signalement est examiné par notre équipe » : c'est vous ; l'audit demande qui vous remplace pendant vos absences (décision E).
- « classées de la même façon pour tous » (« Pour vous ») : vrai d'après le code, qui n'enregistre rien de ce qui est vu (`apps/backend/src/lib/forYou.ts`). À réécrire si un jour le fil était personnalisé.
- Le nom de l'app apparaît dans ces textes : il changera avec le nouveau nom (partie 1).

<!--
Preuves (relues le 21 novembre 2026 sur main 0474313 ; fichier et nom à y chercher, les numéros de ligne glissent) :
- capture, photo de la galerie, vidéo, appareil photo : apps/mobile/src/app/(app)/(tabs)/index.tsx, apps/mobile/src/components/spot-entry.tsx ; appareil photo sur iPhone seulement (takePhoto, Platform.OS === "ios")
- entourer la pièce : apps/mobile/src/i18n/fr.ts (targeting) ; propositions avec prix d'abord : fr.ts (result.bestWithPrice, result.withoutPriceTitle)
- partager vers Spotto : apps/mobile/app.json (expo-share-intent), apps/mobile/plugins/extension-partage.js (nom affiché « Spotto ») ; recherche d'image d'iOS : apps/mobile/plugins/recherche-image.js, fr.ts (visualSearchTip)
- liens de vidéos : apps/mobile/src/lib/link-step.ts (TikTok et Instagram : écran « vidéo partagée » ; Pinterest : aide « capture d'écran » ; autre site : « importez une capture d'écran ») ; apps/mobile/src/app/(app)/spot/lecteur.tsx (lecteur officiel, écran de secours, analyse d'un lien) ; pièces déjà repérées, à partir de 2 membres : apps/backend/src/lib/videoMemory.ts (migrations 0038 et 0039)
- vidéo : moment choisi fr.ts (video.caption) ; analyse automatique avec accord : apps/mobile/src/components/spot-launch-views.tsx, apps/backend/src/routes/videoMoments.ts (demande ANTHROPIC_API_KEY) ; la vidéo reste sur l'appareil : fr.ts (video.privacy), apps/mobile/src/legal/confidentialite.ts (section « Vidéos… »)
- Envies (« Garder »), Vault (« Je l'ai achetée », ajout avec photo), « Récemment spottées » : fr.ts (result.keep, result.markAsBought, vaultForm, spotter.recentlySpotted)
- publications : 5 photos et 5 personnes identifiées au plus : packages/shared-types/src/index.ts (POST_PHOTOS_MAX, PEOPLE_TAGS_MAX, migration 0047) ; visibilité public / abonnés / privé (PRIVACY_LEVELS) ; compte privé : apps/backend/src/lib/audience.ts (migration 0045) ; réponses aux commentaires : apps/backend/src/lib/comments.ts (migration 0046) ; « Pour vous », même classement pour tous : apps/backend/src/lib/forYou.ts (migration 0050)
- messages : invitation acceptée ou non : apps/backend/src/lib/messaging.ts ; aimer, répondre, envoyer une publication : apps/backend/src/lib/messageActions.ts (migration 0044) ; « Vu », réglage réciproque : apps/backend/src/lib/readReceipts.ts (migration 0043)
- collections privées ou montrées aux amis : fr.ts (collections.shareConfirm) ; publications enregistrées visibles de vous seul : fr.ts (savedPosts.privateNote, migration 0048)
- textes injurieux refusés : apps/backend/src/lib/contentFilter.ts (publications, commentaires, messages, profil, collections) ; signaler / bloquer : apps/mobile/src/components/report-block-menu.tsx (REPORT_TARGET_TYPES) ; qui peut écrire, mentionner, identifier : DEFAULT_MESSAGES_FROM, DEFAULT_MENTIONS_FROM ; « examiné par l'équipe » : fr.ts (help.faq, « Signaler un contenu »)
- aucune publicité, statistiques facultatives : apps/mobile/src/lib/analytics.ts ; export et suppression : apps/backend/src/routes/account.ts
- 15 ans : MINIMUM_AGE ; recherches limitées par jour et par mois : apps/backend/src/env.ts (SERPAPI_USER_DAILY_CAP), apps/backend/src/lib/memberQuotas.ts (FREE_MONTHLY_SEARCH_CAP, migration 0053)
- paragraphe facultatif : cloche, seuil de prix, retour en stock dans la même boutique : fr.ts (wishAlerts.kindHints, wishAlerts.targetLabel) ; notifications de message et d'activité : fr.ts (push.offerBody, activityPush) ; coupées par défaut sur le serveur : apps/backend/src/env.ts (PUSH_ENABLED)
-->

---

## 5. Mots-clés (100 octets au plus)

Attention : Apple compte en **octets**, pas en caractères. Une lettre accentuée (é, è…) compte pour 2. Pas d'espace après les virgules. Inutile de répéter le nom de l'app, le sous-titre ou la catégorie : Apple les prend déjà en compte.

Français :
```text
mode,tenue,look,style,vetements,habits,shopping,capture,identifier,sac,baskets,robe,veste,dressing
```
98 octets (mots sans accents, pour tenir dans les 100 octets).

Anglais :
```text
fashion,outfit,clothes,style,shopping,screenshot,identify,lookup,dress,sneakers,bag,jacket,wardrobe
```
99 octets.

---

## 6. Catégories conseillées

- **Catégorie principale : Shopping** (Achats). C'est l'usage premier : trouver où acheter une pièce.
- **Catégorie secondaire : Style de vie** (Lifestyle). Le fil, le Vault et les Envies relèvent de la mode au quotidien.

Je déconseille « Réseaux sociaux » en principale : le fil, même avec « Pour vous », n'est pas le cœur de l'app.

---

## 7. Adresses à fournir

| Champ d'App Store Connect | Adresse | Obligatoire ? | État aujourd'hui |
|---|---|---|---|
| **URL d'assistance** (*Support URL*) | `https://mon-app-shopping-ia-web.onrender.com/aide` (ou la même page sur le futur nom de domaine) | Oui | La page existe : « Aide et contact », lisible sans compte (`apps/mobile/src/app/aide.tsx`, ouverte à tous : `apps/mobile/src/app/_layout.tsx:104`). ⚠️ Apple exige qu'elle mène à de vraies coordonnées : l'adresse e-mail n'y apparaît que si `EXPO_PUBLIC_PUBLISHER_EMAIL` est saisie pour le **site** chez Render, puis le site reconstruit (« Clear build cache & deploy »). Sinon la page affiche « [À compléter : …] ». À vérifier en ouvrant la page, déconnecté, avant l'envoi. |
| **URL de la politique de confidentialité** | `https://mon-app-shopping-ia-web.onrender.com/confidentialite` | Oui | La page existe, lisible sans compte (`apps/mobile/src/app/_layout.tsx:102`). Elle doit être la version définitive (sans bandeau « Projet », sans « [À compléter] ») le jour de l'envoi : règle 5.1.1(i) d'Apple, et point 7 de la feuille de route. |
| **URL marketing** | Facultative. Laisser vide, ou mettre l'accueil du site. | Non | — |
| **Copyright** | `2026 [À compléter : nom de l'éditeur]` | Oui | Le nom exact de l'éditeur, comme dans les pages légales. |
| **Coordonnées pour l'équipe de validation** (prénom, nom, téléphone, e-mail) | [À compléter] | Oui | Vos coordonnées, vues seulement par Apple. Jamais dans ce dépôt public. |
| **Compte de démonstration** | voir [NOTES-VALIDATION.md](NOTES-VALIDATION.md) | Oui (l'app demande un compte) | À créer : [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E. |

**Autres réglages de la fiche** (des faits, pour cocher vite) :
- Prix : **gratuit**. Achats intégrés : **aucun** (rien dans le code). Abonnements : **aucun** dans cette version (coupés sur le serveur : `SUBSCRIPTIONS_ENABLED` absent ; ne l'allumez pas sans nouvelle version et sans achat intégré).
- iPad : **non**. L'app est réglée pour l'iPhone seul (`"supportsTablet": false`, `apps/mobile/app.json:20`) : seules les captures iPhone sont demandées.
- Chiffrement : déjà déclaré dans l'app (`ITSAppUsesNonExemptEncryption: false`, `apps/mobile/app.json:23`) : App Store Connect ne pose plus la question à chaque build.
- Connexion « avec Apple » : non requise. Spotto ne propose que l'e-mail et le mot de passe, aucune connexion par un autre service (Google, Facebook…).
- Contrat de licence (EULA) : App Store Connect propose le contrat standard d'Apple, ou un contrat personnalisé. C'est à vous de choisir ; les conditions d'utilisation de Spotto s'affichent de toute façon dans l'app, à l'inscription (case à cocher), et restent dans Réglages → Documents. Elles demandent 15 ans : voir l'effet sur le classement par âge dans [AGE-ET-PAYS.md](AGE-ET-PAYS.md).
- Nouveautés (*What's New*) : rien à écrire pour la version 1.0. Apple, page d'aide d'App Store Connect (relue le 21 novembre 2026) : « This property isn't available for the first version of the app but required for all subsequent versions. »
- Âge et pays : [AGE-ET-PAYS.md](AGE-ET-PAYS.md).
